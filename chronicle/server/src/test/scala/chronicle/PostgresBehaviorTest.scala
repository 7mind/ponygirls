package chronicle
import chronicle.api.*
import java.util.UUID
import cats.effect.IO
import cats.effect.unsafe.implicits.global
class PostgresBehaviorTest extends munit.FunSuite {
  def database(f: (Config,Database,PostgresArchive,Auth) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val c=Fixtures.config(); val db=new Database(c,IndexProfileCatalog.legacyOnly(c)); db.initialize()
    db.transaction(x => { Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations CASCADE"); Sql.exec(x,"UPDATE ch_profile SET active=?,target=?,maintenance=false",c.profile,c.profile); Sql.exec(x,"UPDATE ch_owner_targets SET profile=?,epoch=0",c.profile) })
    f(c,db,new PostgresArchive(db,c),new Auth(db,c))
  }
  def browser(auth: Auth,login: String): Identity = { val (_,cookie)=auth.login(LoginRequest(login,"synthetic")); auth.browser(cookie) }
  def mutation(auth: Auth,i: Identity,op: Operation): Result = auth.mutate(i,ClientEnvelope(UUID.randomUUID(),op))
  def entity(r: Result): UUID = r.asInstanceOf[Result.Mutation].receipt.entityId.get
  def annotatedTags(c: Config,a: PostgresArchive): IngestReceipt = {
    val r=Fixtures.snapshot(); val request=r.copy(metadata=r.metadata.copy(tags=Nil))
    val out=a.ingest("a",request); val claim=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    val chunk=Fragments.split(request.messages).head.copy(sessionId=out.sessionId,tags=List("debugging"))
    assert(a.publish(claim,List(IndexedChunk(chunk,List(1.0,0.0,0.0)),IndexedChunk(chunk.copy(id=UUID.randomUUID()),List(1.0,0.0,0.0)),IndexedChunk(chunk.copy(id=UUID.randomUUID(),tags=List("review")),List(1.0,0.0,0.0)))))
    out
  }
  test("BG-GoodCommunication regression: merged semantic chunks preserve lexical words at message boundaries") { database { (c,db,a,auth) =>
    val original=Fixtures.snapshot()
    val raw="""{"id":"alpha","text":"alpha"}
{"id":"beta","text":"beta"}
"""
    val request=original.copy(messages=List(Message("alpha",None,"user","alpha",None,0),Message("beta",Some("alpha"),"assistant","beta",None,1)),files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
    val out=a.ingest("a",request); val claim=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    val fragments=Fragments.split(request.messages).map(_.copy(sessionId=out.sessionId))
    val chunks=AnnotationPartition.project(fragments,Wire.parse("""{"chunks":[{"first":0,"last":1,"summary":"unrelated","tags":[]}]}"""))
    assert(a.publish(claim,chunks.map(chunk => IndexedChunk(chunk,List(1.0,0.0,0.0)))))
    val embedder=new Embedder { def query(text: String)=IO.pure(List(1.0,0.0,0.0)); def documents(text: List[String])=IO.pure(text.map(_ => List(1.0,0.0,0.0))) }
    val app=new Application(a,new PostgresSearch(db,a,c),embedder,auth,db,new CollectorProgress(new PostgresCollectorProgressStore(db),java.time.Clock.systemUTC()),new PostgresArchiveIndex(db,a,c),new PostgresActivity(db,java.time.Clock.systemUTC())); val owner=browser(auth,"a")
    List("alpha","beta").foreach { word =>
      val result=app.operation(owner,ClientEnvelope(UUID.randomUUID(),Operation.Search(SearchQuery(word,SearchMode.Lexical,SearchFilter(None,None,None,None,Nil),20,0)))).unsafeRunSync().asInstanceOf[Result.Search].result
      assertEquals(result.total,1,s"original word $word remains searchable")
      assertEquals(result.hits.head.chunks.head.spans,fragments.flatMap(_.spans))
    }
  }}
  List(false,true).foreach { running =>
    test(s"BG-GoodCommunication regression: resumed heads terminalize superseded ${if(running) "Running" else "Queued"} jobs") { database { (c,db,a,auth) =>
      val request=Fixtures.snapshot(); val old=a.ingest("a",request)
      val stale=if(running) a.claim(Set(c.profile),ClaimScope.AllOwners,300) else None
      a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
      val current=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get; assertEquals(current.revision,2); assert(a.publish(current,Nil))
      stale.foreach { claim => assert(!a.publish(claim,Nil)); a.fail(claim,"late-model-failure") }
      assertEquals(a.claim(Set(c.profile),ClaimScope.AllOwners,300),None)
      val jobs=a.statuses("a",0,100).jobs
      val superseded=jobs.find(_.id==old.jobId).get
      assertEquals(superseded.state,JobState.Failed)
      assertEquals(superseded.error,Some("superseded-revision"))
      assertEquals(jobs.find(_.id==current.jobId).get.state,JobState.Complete)
    }}
  }
  test("BG-GoodCommunication regression: retry rejects obsolete revisions rather than acknowledging ineligible work") { database { (c,db,a,auth) =>
    val request=Fixtures.snapshot(); val old=a.ingest("a",request)
    a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    val owner=browser(auth,"a")
    assertEquals(intercept[DomainError](a.retry("a",old.jobId)).code,"conflict")
    assertEquals(intercept[DomainError](mutation(auth,owner,Operation.RetryJob(old.jobId))).code,"conflict")
    assertEquals(a.claim(Set(c.profile),ClaimScope.AllOwners,300).get.revision,2)
  }}
  test("BG-GoodCommunication regression: startup reconciles pre-existing obsolete unfinished jobs without deleting published history") { database { (c,db,a,auth) =>
    val request=Fixtures.snapshot(); val first=a.ingest("a",request)
    assert(a.publish(a.claim(Set(c.profile),ClaimScope.AllOwners,300).get,Nil))
    val published=a.session("a",first.sessionId).view
    val second=a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=2))
    db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET state='Running',error=NULL,lease_until=now()+interval '300 seconds' WHERE id=?",second.jobId))
    db.initialize()
    val jobs=a.statuses("a",0,100).jobs
    assertEquals(jobs.find(_.id==second.jobId).get.state,JobState.Failed)
    assertEquals(jobs.find(_.id==second.jobId).get.error,Some("superseded-revision"))
    assertEquals(jobs.find(_.id==first.jobId).get.state,JobState.Complete)
    assertEquals(a.readSession("a",first.sessionId,Some(published)).session.view,published)
  }}
  List(false,true).foreach { browserMutation =>
    test(s"BG-GoodCommunication regression: ${if(browserMutation) "browser" else "archive"} retry rejects same-head jobs from an obsolete target profile") { database { (c,db,a,auth) =>
      val out=a.ingest("a",Fixtures.snapshot())
      (1 to 5).foreach(_ => a.fail(a.claim(Set(c.profile),ClaimScope.AllOwners,300).get,"model-http"))
      assertEquals(a.statuses("a",0,100).jobs.head.state,JobState.Failed)
      val next=c.copy(embedding=c.embedding.copy(revision="retry-target")); val replacement=new PostgresArchive(db,next)
      replacement.beginMaintenance(); assert(replacement.publish(replacement.claim(Set(next.profile),ClaimScope.AllOwners,300).get,Nil)); assert(replacement.finishMaintenance())
      assertEquals(replacement.session("a",out.sessionId).revision,1)
      val error=intercept[DomainError] {
        if(browserMutation) mutation(auth,browser(auth,"a"),Operation.RetryJob(out.jobId)) else a.retry("a",out.jobId)
      }
      assertEquals(error.code,"conflict")
      assertEquals(a.statuses("a",0,100).jobs.find(_.id==out.jobId).get.state,JobState.Failed)
    }}
  }
  test("BG-GoodCommunication regression: structured filters include generated annotation work tags") { database { (c,db,a,auth) =>
    annotatedTags(c,a)
    val q=SearchQuery("",SearchMode.Lexical,SearchFilter(None,None,None,None,List("debugging")),20,0)
    val index=new PostgresSearch(db,a,c)
    assertEquals(index.search("a",q,None).total,1); assertEquals(index.search("c",q,None).total,0)
    assertEquals(index.search("a",q.copy(filter=q.filter.copy(tags=List("debugging","review"))),None).total,1)
  }}
  test("BG-GoodCommunication regression: work tag facets deduplicate sessions and retain ACL") { database { (c,db,a,auth) =>
    annotatedTags(c,a)
    val index=new PostgresSearch(db,a,c); val f=SearchFilter(None,None,None,None,Nil)
    assertEquals(index.facets("a",f).tags,List(Facet("debugging",1),Facet("review",1)))
    assertEquals(index.facets("c",f).tags,Nil)
  }}
  def pendingRevision(c: Config,a: PostgresArchive): (IngestReceipt,IngestRequest) = {
    val original=Fixtures.snapshot()
    val oldRaw=original.files.head.content.replace("synthetic PostgreSQL archive","message-old")
    val first=original.copy(metadata=original.metadata.copy(project=Some("project-old")),messages=original.messages.map(_.copy(text="message-old")),files=List(original.files.head.copy(content=oldRaw,sha256=Wire.hash(oldRaw))),digest=Wire.hash(oldRaw))
    val out=a.ingest("a",first); val claim=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    assert(a.publish(claim,List(IndexedChunk(Fragments.split(first.messages).head.copy(sessionId=out.sessionId),List(1.0,0.0,0.0)))))
    val newRaw=oldRaw.replace("message-old","new")
    a.ingest("a",first.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=first.metadata.copy(project=Some("project-new")),messages=first.messages.map(_.copy(text="new")),files=List(first.files.head.copy(content=newRaw,sha256=Wire.hash(newRaw))),digest=Wire.hash(newRaw)))
    (out,first)
  }
  test("BG-GoodCommunication regression: search metadata belongs to ranked immutable source revision") { database { (c,db,a,auth) =>
    val (out,first)=pendingRevision(c,a)
    val result=new PostgresSearch(db,a,c).search("a",SearchQuery("message-old",SearchMode.Lexical,SearchFilter(Some("project-old"),None,None,None,Nil),20,0),None)
    assertEquals(result.hits.size,1)
    assertEquals(result.hits.head.session.metadata.project,Some("project-old"))
    assertEquals(result.hits.head.session.revision,2)
    assertEquals(result.hits.head.session.indexedRevision,Some(1))
  }}
  test("BG-GoodCommunication regression: default annotated transcript retains producing message bytes during indexing lag") { database { (c,db,a,auth) =>
    val (out,first)=pendingRevision(c,a)
    val embedder=new Embedder { def query(text: String)=IO.pure(List(1.0,0.0,0.0)); def documents(text: List[String])=IO.pure(text.map(_ => List(1.0,0.0,0.0))) }
    val app=new Application(a,new PostgresSearch(db,a,c),embedder,auth,db,new CollectorProgress(new PostgresCollectorProgressStore(db),java.time.Clock.systemUTC()),new PostgresArchiveIndex(db,a,c),new PostgresActivity(db,java.time.Clock.systemUTC()))
    val result=app.operation(browser(auth,"a"),ClientEnvelope(UUID.randomUUID(),Operation.GetMessages(out.sessionId,0,100,None))).unsafeRunSync().asInstanceOf[Result.Messages].result
    assertEquals(result.messages.head.text,"message-old")
  }}
  test("BG-GoodCommunication regression: immutable view pins survive later publication for transcript chunks metadata and raw") { database { (c,db,a,auth) =>
    val (out,first)=pendingRevision(c,a)
    val embedder=new Embedder { def query(text: String)=IO.pure(List(1.0,0.0,0.0)); def documents(text: List[String])=IO.pure(text.map(_ => List(1.0,0.0,0.0))) }
    val app=new Application(a,new PostgresSearch(db,a,c),embedder,auth,db,new CollectorProgress(new PostgresCollectorProgressStore(db),java.time.Clock.systemUTC()),new PostgresArchiveIndex(db,a,c),new PostgresActivity(db,java.time.Clock.systemUTC()))
    val owner=browser(auth,"a"); val unrelated=browser(auth,"c")
    def call(i: Identity,op: Operation): Result = app.operation(i,ClientEnvelope(UUID.randomUUID(),op)).unsafeRunSync()
    val original=call(owner,Operation.GetSession(out.sessionId,None)).asInstanceOf[Result.Session].result
    val pin=original.session.view
    assertEquals(pin.revision,1); assert(pin.generationId.isDefined)
    val originalChunk=original.chunks.head
    assertEquals(originalChunk.spans.head.end,"message-old".getBytes(java.nio.charset.StandardCharsets.UTF_8).length)
    val newestRaw=call(owner,Operation.GetRaw(out.sessionId,None)).asInstanceOf[Result.Raw].result
    assertEquals(newestRaw.revision,2); assert(newestRaw.files.head.content.contains("new"))
    val pending=call(owner,Operation.GetMessages(out.sessionId,0,100,Some(ContentView(2,None)))).asInstanceOf[Result.Messages].result
    assertEquals(pending.view,ContentView(2,None)); assertEquals(pending.messages.head.text,"new")
    val latest=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    assert(a.publish(latest,List(IndexedChunk(Fragments.split(latest.snapshot.messages).head.copy(sessionId=out.sessionId),List(0.0,1.0,0.0)))))
    val pinnedSession=call(owner,Operation.GetSession(out.sessionId,Some(pin))).asInstanceOf[Result.Session].result
    assertEquals(pinnedSession.session.view,pin); assertEquals(pinnedSession.session.revision,2); assertEquals(pinnedSession.session.indexedRevision,Some(2)); assertEquals(pinnedSession.session.metadata.project,Some("project-old"))
    val pinnedMessages=call(owner,Operation.GetMessages(out.sessionId,0,100,Some(pin))).asInstanceOf[Result.Messages].result
    assertEquals(pinnedMessages.view,pin); assertEquals(pinnedMessages.messages.head.text,"message-old")
    val pinnedChunks=call(owner,Operation.GetChunks(out.sessionId,0,100,Some(pin))).asInstanceOf[Result.Chunks].result
    assertEquals(pinnedChunks.view,pin); assertEquals(pinnedChunks.chunks,List(originalChunk))
    val pinnedRaw=call(owner,Operation.GetRaw(out.sessionId,Some(pin.revision))).asInstanceOf[Result.Raw].result
    assertEquals(pinnedRaw.revision,1); assertEquals(pinnedRaw.files,first.files)
    val newDefault=call(owner,Operation.GetMessages(out.sessionId,0,100,None)).asInstanceOf[Result.Messages].result
    assertEquals(newDefault.view.revision,2); assertEquals(newDefault.messages.head.text,"new")
    assertEquals(intercept[DomainError](call(owner,Operation.GetMessages(out.sessionId,0,100,Some(pin.copy(revision=2))))).code,"not-found")
    List(Operation.GetSession(out.sessionId,Some(pin)),Operation.GetMessages(out.sessionId,0,100,Some(pin)),Operation.GetChunks(out.sessionId,0,100,Some(pin)),Operation.GetRaw(out.sessionId,Some(1))).foreach(op => assertEquals(intercept[DomainError](call(unrelated,op)).code,"not-found"))
    val index=new PostgresSearch(db,a,c)
    assertEquals(index.search("a",SearchQuery("",SearchMode.Lexical,SearchFilter(Some("project-old"),None,None,None,Nil),20,0),None).total,0)
    assertEquals(index.facets("a",SearchFilter(None,None,None,None,Nil)).projects,List(Facet("project-new",1)))
  }}
  test("BG-GoodCommunication regression: concurrent archive heads never relabel raw bytes with another revision") { database { (c,db,a,auth) =>
    val base=Fixtures.snapshot()
    def revision(n: Int): IngestRequest = {
      val text=s"revision-$n"
      val bytes=base.files.head.content.replace("synthetic PostgreSQL archive",text)
      base.copy(requestId=UUID.randomUUID(),expectedRevision=n-1,digest=Wire.hash(bytes),messages=base.messages.map(_.copy(text=text)),files=List(base.files.head.copy(content=bytes,sha256=Wire.hash(bytes))))
    }
    val out=a.ingest("a",revision(1))
    val writer=IO.blocking((2 to 30).foreach(n => a.ingest("a",revision(n))))
    val reader=IO.blocking((1 to 100).foreach { _ =>
      val raw=a.raw("a",out.sessionId,None)
      assert(raw.files.head.content.contains(s"\"text\":\"revision-${raw.revision}\""),"raw bytes and result revision must derive from the same snapshot")
    })
    IO.both(writer,reader).unsafeRunSync()
    assertEquals(a.raw("a",out.sessionId,Some(1)).files,revision(1).files)
  }}
  test("BG-GoodCommunication: chunk pages exceed100 without omissions and retain source order ACL") { database { (c,db,a,auth) =>
    val request=Fixtures.snapshot(); val out=a.ingest("a",request); val claim=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    val chunks=(0 until 201).map { index => IndexedChunk(Chunk(new UUID(0,201-index),out.sessionId,s"source-$index","summary",Nil,List(Span("u",0,1)),0.0),List(1.0,0.0,0.0)) }.toList
    assert(a.publish(claim,chunks))
    val first=a.pageChunks("a",out.sessionId,0,100,None); val second=a.pageChunks("a",out.sessionId,100,100,None); val third=a.pageChunks("a",out.sessionId,200,100,None)
    assertEquals(first.total,201); assertEquals(second.total,201)
    assertEquals((first.chunks++second.chunks++third.chunks).map(_.text),(0 until 201).map(i => s"source-$i").toList)
    assertEquals(a.pageChunks("a",out.sessionId,201,100,None).chunks,Nil)
    assertEquals(intercept[DomainError](a.pageChunks("c",out.sessionId,100,100,None)).code,"not-found")
  }}
  test("BG-GoodCommunication: direct groups never confer transitive ACL; counts/status/raw honor removal") { database { (c,db,a,auth) =>
    val ia=browser(auth,"a"); val ib=browser(auth,"b"); val ic=browser(auth,"c")
    val ab=entity(mutation(auth,ia,Operation.CreateGroup("AB"))); val invite=entity(mutation(auth,ia,Operation.Invite(ab,"b")))
    assertEquals(intercept[DomainError](mutation(auth,ic,Operation.AcceptInvite(invite,true))).code,"not-found")
    mutation(auth,ib,Operation.AcceptInvite(invite,true))
    val bc=entity(mutation(auth,ib,Operation.CreateGroup("BC"))); val inviteC=entity(mutation(auth,ib,Operation.Invite(bc,"c"))); mutation(auth,ic,Operation.AcceptInvite(inviteC,true))
    val out=a.ingest("a",Fixtures.snapshot()); val claim=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    val chunk=Fragments.split(claim.snapshot.messages).head.copy(sessionId=out.sessionId,summary="synthetic archive")
    assert(a.publish(claim,List(IndexedChunk(chunk,List(1.0,0.0,0.0)))))
    assertEquals(a.headSnapshot("b",out.sessionId).messages.head.id,"u")
    assertEquals(intercept[DomainError](a.headSnapshot("c",out.sessionId)).code,"not-found")
    val index=new PostgresSearch(db,a,c); val q=SearchQuery("archive",SearchMode.Lexical,SearchFilter(None,None,None,None,Nil),1,0)
    assertEquals(index.search("b",q,None).total,1); assertEquals(index.search("c",q,None).total,0)
    assertEquals(index.facets("c",q.filter).projects,Nil); assertEquals(a.statuses("c",0,100).total,0)
    mutation(auth,ia,Operation.RemoveMember(ab,"b"))
    assertEquals(index.search("b",q,None).total,0); assertEquals(a.statuses("b",0,100).total,0)
    assertEquals(intercept[DomainError](a.headSnapshot("b",out.sessionId)).code,"not-found")
    db.transaction(x => Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id='a'"))
    assertEquals(index.search("a",q,None).total,0)
  }}
  test("BG-GoodCommunication: token scopes receipt replay secret once revocation and browser-only management") { database { (c,db,a,auth) =>
    val i=browser(auth,"a"); val request=ClientEnvelope(UUID.randomUUID(),Operation.MintToken("synthetic",List(Scope.Read)))
    val minted=auth.mutate(i,request).asInstanceOf[Result.Token].result
    val token=auth.bearer(minted.secret.get)
    token.requireScope(Scope.Read); intercept[DomainError](token.requireScope(Scope.Ingest)); intercept[DomainError](token.requireScope(Scope.Raw))
    assertEquals(auth.mutate(i,request).asInstanceOf[Result.Token].result.secret,None)
    assertEquals(auth.receipt(i,request.requestId).asInstanceOf[Result.Token].result.secret,None)
    intercept[DomainError](auth.mutate(i,request.copy(operation=Operation.MintToken("different",List(Scope.Read)))))
    intercept[DomainError](mutation(auth,token,Operation.CreateGroup("forged")))
    mutation(auth,i,Operation.RevokeToken(minted.token.id)); intercept[DomainError](auth.bearer(minted.secret.get))
  }}
  test("BG-GoodCommunication: expired leases fence old workers; final crashed attempt becomes visible failure") { database { (c,db,a,auth) =>
    val out=a.ingest("a",Fixtures.snapshot())
    val old=a.claim(Set(c.profile),ClaimScope.AllOwners,0).get
    val fresh=a.claim(Set(c.profile),ClaimScope.AllOwners,0).get
    assert(fresh.fence>old.fence); assert(!a.publish(old,Nil))
    (1 to 3).foreach(_ => assert(a.claim(Set(c.profile),ClaimScope.AllOwners,0).isDefined))
    assertEquals(a.claim(Set(c.profile),ClaimScope.AllOwners,0),None)
    assertEquals(a.statuses("a",0,100).jobs.head.state,JobState.Failed)
    a.retry("a",out.jobId); assert(a.claim(Set(c.profile),ClaimScope.AllOwners,300).isDefined)
  }}
  def awaitBlocked(db: Database,prefix: String): Unit = {
    val deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(3)
    def blocked: Boolean=db.transaction(x => Sql.one(x,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ?",prefix+"%")(_.getInt(1)).get>0)
    while(!blocked && System.nanoTime()<deadline) Thread.sleep(10)
    assert(blocked,s"expected database lock wait: $prefix")
  }
  test("BG-GoodCommunication: new-head supersession and publication use source-before-job lock order") { database { (c,db,a,auth) =>
    val timed=c.copy(jdbcUrl=c.jdbcUrl+"?options=-c%20statement_timeout%3D5000"); val timedDb=new Database(timed,IndexProfileCatalog.legacyOnly(timed))
    val archive=new PostgresArchive(timedDb,timed); val request=Fixtures.snapshot()
    archive.ingest("a",request); val old=archive.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    val executor=java.util.concurrent.Executors.newFixedThreadPool(2)
    var ingesting: java.util.concurrent.Future[IngestReceipt]=null
    var publishing: java.util.concurrent.Future[Boolean]=null
    try {
      db.transaction { held =>
        Sql.one(held,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",old.jobId)(_.getString(1))
        ingesting=executor.submit(new java.util.concurrent.Callable[IngestReceipt] { def call(): IngestReceipt=archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1)) })
        awaitBlocked(timedDb,"UPDATE ch_jobs SET state='Failed',error=")
        publishing=executor.submit(new java.util.concurrent.Callable[Boolean] { def call(): Boolean=archive.publish(old,Nil) })
        awaitBlocked(timedDb,"SELECT id FROM ch_sources")
      }
      assertEquals(ingesting.get(5,java.util.concurrent.TimeUnit.SECONDS).revision,2)
      assertEquals(publishing.get(5,java.util.concurrent.TimeUnit.SECONDS),false)
      assertEquals(archive.statuses("a",0,100).jobs.find(_.id==old.jobId).get.error,Some("superseded-revision"))
    } finally { executor.shutdownNow(); executor.awaitTermination(6,java.util.concurrent.TimeUnit.SECONDS) }
  }}
  test("BG-GoodCommunication regression: maintenance target switch serializes behind in-flight old publication") { database { (c,db,a,auth) =>
    val timed=c.copy(jdbcUrl=c.jdbcUrl+"?options=-c%20statement_timeout%3D5000")
    val timedDb=new Database(timed,IndexProfileCatalog.legacyOnly(timed)); val oldArchive=new PostgresArchive(timedDb,timed)
    val out=oldArchive.ingest("a",Fixtures.snapshot())
    val old=oldArchive.claim(Set(timed.profile),ClaimScope.AllOwners,300).get
    val next=timed.copy(embedding=timed.embedding.copy(revision="maintenance-race"))
    val replacement=new PostgresArchive(timedDb,next)
    val executor=java.util.concurrent.Executors.newFixedThreadPool(2)
    var pending: java.util.concurrent.Future[Boolean]=null
    var switching: java.util.concurrent.Future[Unit]=null
    try {
      db.transaction { held =>
        Sql.one(held,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",old.jobId)(_.getString(1))
        pending=executor.submit(new java.util.concurrent.Callable[Boolean] { def call(): Boolean=oldArchive.publish(old,Nil) })
        awaitBlocked(timedDb,"SELECT j.id FROM ch_jobs")
        switching=executor.submit(new java.util.concurrent.Callable[Unit] { def call(): Unit=replacement.beginMaintenance() })
        awaitBlocked(timedDb,"SELECT profile FROM ch_owner_targets")
      }
      assertEquals(pending.get(5,java.util.concurrent.TimeUnit.SECONDS),true)
      switching.get(5,java.util.concurrent.TimeUnit.SECONDS)
      assert(replacement.publish(replacement.claim(Set(next.profile),ClaimScope.AllOwners,300).get,Nil)); assert(replacement.finishMaintenance())
      assertEquals(oldArchive.publish(old,Nil),false)
      assertEquals(timedDb.transaction(x => Sql.one(x,"SELECT g.profile FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.id=?",out.sessionId)(_.getString(1)).get),next.profile)
    } finally { executor.shutdownNow(); executor.awaitTermination(6,java.util.concurrent.TimeUnit.SECONDS) }
  }}
  test("BG-GoodCommunication regression: publisher waiting for a target switch rechecks the committed target") { database { (c,db,a,auth) =>
    val timed=c.copy(jdbcUrl=c.jdbcUrl+"?options=-c%20statement_timeout%3D5000")
    val timedDb=new Database(timed,IndexProfileCatalog.legacyOnly(timed)); val oldArchive=new PostgresArchive(timedDb,timed)
    oldArchive.ingest("a",Fixtures.snapshot()); val old=oldArchive.claim(Set(timed.profile),ClaimScope.AllOwners,300).get
    val next=timed.copy(embedding=timed.embedding.copy(revision="maintenance-first"))
    val executor=java.util.concurrent.Executors.newSingleThreadExecutor()
    var pending: java.util.concurrent.Future[Boolean]=null
    try {
      db.transaction { held =>
        IndexProfileCatalog.legacyOnly(next).register(held)
        Sql.exec(held,"UPDATE ch_owner_targets SET profile=?,epoch=epoch+1 WHERE owner='a'",next.profile)
        pending=executor.submit(new java.util.concurrent.Callable[Boolean] { def call(): Boolean=oldArchive.publish(old,Nil) })
        awaitBlocked(timedDb,"SELECT profile,epoch FROM ch_owner_targets")
      }
      assertEquals(pending.get(5,java.util.concurrent.TimeUnit.SECONDS),false)
    } finally { executor.shutdownNow(); executor.awaitTermination(6,java.util.concurrent.TimeUnit.SECONDS) }
  }}
  test("BG-GoodCommunication regression: maintenance can return A to B to A on the same archived revision") { database { (c,db,a,auth) =>
    val out=a.ingest("a",Fixtures.snapshot())
    assert(a.publish(a.claim(Set(c.profile),ClaimScope.AllOwners,300).get,Nil)); val original=a.session("a",out.sessionId).view
    val next=c.copy(embedding=c.embedding.copy(revision="profile-B")); val b=new PostgresArchive(db,next)
    b.beginMaintenance(); assert(b.publish(b.claim(Set(next.profile),ClaimScope.AllOwners,300).get,Nil)); assert(b.finishMaintenance())
    val middle=b.session("a",out.sessionId).view
    a.beginMaintenance(); assert(!a.finishMaintenance())
    val rebuilding=a.claim(Set(c.profile),ClaimScope.AllOwners,300)
    assert(rebuilding.isDefined,"previously completed target job must become eligible when publication belongs to B")
    a.beginMaintenance()
    assert(a.publish(rebuilding.get,Nil),"resuming maintenance must not fence eligible in-progress target work")
    assert(a.finishMaintenance()); assertEquals(a.session("a",out.sessionId).revision,1)
    assertEquals(a.readSession("a",out.sessionId,Some(original)).session.view,original)
    assertEquals(a.readSession("a",out.sessionId,Some(middle)).session.view,middle)
    a.beginMaintenance(); assert(a.finishMaintenance()); assertEquals(a.claim(Set(c.profile),ClaimScope.AllOwners,300),None)
  }}
  test("BG-GoodCommunication: maintenance profile migration is explicit resumable and pauses semantic only") { database { (c,db,a,auth) =>
    val out=a.ingest("a",Fixtures.snapshot()); assert(a.publish(a.claim(Set(c.profile),ClaimScope.AllOwners,300).get,Nil))
    val next=c.copy(embedding=c.embedding.copy(revision="new-deployment"))
    val replacement=new PostgresArchive(db,next); replacement.beginMaintenance()
    val q=SearchQuery("",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),20,0)
    intercept[DomainError](new PostgresSearch(db,replacement,next).search("a",q,Some(List(1.0,0.0,0.0))))
    assert(!replacement.finishMaintenance()); replacement.beginMaintenance()
    assert(replacement.publish(replacement.claim(Set(next.profile),ClaimScope.AllOwners,300).get,Nil)); assert(replacement.finishMaintenance())
    assertEquals(new PostgresSearch(db,replacement,next).search("a",q,Some(List(1.0,0.0,0.0))).total,0)
    assertEquals(a.headSnapshot("a",out.sessionId).messages.size,1)
  }}
}
