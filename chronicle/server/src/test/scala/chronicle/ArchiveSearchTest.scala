package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Clock
import java.util.UUID
import java.util.concurrent.{CompletableFuture,TimeUnit}

// Specified blackbox/GoodCommunication cases: exact PostgreSQL Unicode, ANN, isolation and admission semantics.
class ArchiveSearchTest extends munit.FunSuite {
  private final case class Fixture(config: Config,db: Database,archive: PostgresArchive,index: PostgresArchiveIndex) {
    def vectors(parsed: ParsedArchiveExpression): List[ArchiveVector] = if(parsed.mode==SearchMode.Lexical) Nil else parsed.textOperands.map(value => ArchiveVector(value,List(1.0,0.0,0.0)))
    def search(q: ArchiveQuery,reader: String): ArchiveSearchResult = {
      val parsed=ArchiveExpression.parse(q.expression)
      index.sourceSearch(reader,q,parsed,vectors(parsed),ReadMaterialization.unrestricted)
    }
    def browse(q: ArchiveQuery,reader: String): ArchiveResult = {
      val parsed=ArchiveExpression.parse(q.expression)
      index.browse(reader,q,parsed,vectors(parsed))
    }
  }
  private def database(run: Fixture => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config)
    run(Fixture(config,db,archive,new PostgresArchiveIndex(db,archive,config)))
  }
  private def snapshot(texts: List[String]): IngestRequest = {
    val base=Fixtures.snapshot()
    base.copy(messages=texts.zipWithIndex.map { (text,index) => Message(s"m$index",None,"user",text,Some("2026-01-01T00:00:00Z"),index) },metadata=base.metadata.copy(title="metadata-only-token",model=Some("model")))
  }
  private def query(expression: String): ArchiveQuery = ArchiveQuery(expression,ArchiveSort.LastTimestamp,SortDirection.Desc,None,10,true)
  private def publish(f: Fixture,owner: String,request: IngestRequest): UUID = {
    val out=f.archive.ingest(owner,request)
    val claim=f.archive.claim(Set(f.config.profile),ClaimScope.Owner(owner),300).get
    assertEquals(claim.sessionId,out.sessionId)
    assert(f.archive.publish(claim,Fragments.split(request.messages).map(chunk => IndexedChunk(chunk.copy(sessionId=out.sessionId),List(1.0,0.0,0.0)))))
    out.sessionId
  }
  test("same Archive kernel preserves every field, Boolean mode, order, exact cursor and all-HEAD count scope") { database { f =>
    publish(f,"a",snapshot(List("needle amber")))
    f.archive.ingest("a",snapshot(List("amber unindexed")))
    publish(f,"b",snapshot(List("needle private")))
    val bodies=List("","needle","needle AND amber","needle OR amber","NOT needle","NOT NOT needle","NOT (needle OR absent)","needle OR NOT absent","(needle AND project:project) OR amber","user:a tag:synthetic project:project branch:main producer:pi model:model format:pi agent:main status:Complete after:2025-01-01T00:00:00Z before:2027-01-01T00:00:00Z","yolo-profile:missing OR status:Queued","metadata-only-token")
    for(mode <- List("lexical","semantic","hybrid"); body <- bodies; relevance <- List(false,true)) {
      val q=query(s"mode:$mode ($body)".replace("()", "")).copy(limit=1,preferRelevance=relevance)
      var cursor=Option.empty[String]; var more=true; var seen=List.empty[UUID]
      while(more) {
        val current=q.copy(cursor=cursor)
        val actual=f.search(current,"a")
        assertEquals(actual.page,f.browse(current,"a"),s"$mode $body relevance=$relevance")
        assertEquals(actual.evidence.map(_.sessionId),actual.page.rows.map(_.head.id))
        assert(actual.evidence.forall(_.matches.size<=ArchiveSearchPolicy.maximumMatches))
        seen++=actual.page.rows.map(_.head.id); cursor=actual.page.nextCursor; more=cursor.nonEmpty
      }
      assertEquals(seen.distinct,seen)
    }
    for(sort <- ArchiveSort.all; direction <- List(SortDirection.Asc,SortDirection.Desc)) {
      val q=query("mode:lexical (needle OR amber)").copy(sort=sort,direction=direction,preferRelevance=false,limit=1)
      val first=f.search(q,"a"); assertEquals(first.page,f.browse(q,"a"))
      assertEquals(f.search(q.copy(cursor=first.page.nextCursor),"a").page,f.browse(q.copy(cursor=first.page.nextCursor),"a"))
    }
  }}
  test("positive literal evidence is query-local exact original UTF8, including expansion, contextual sigma and huge late matches") { database { f =>
    val text="x"*(2*1024*1024)+"🙂İΣΑ ΟΣ K e\u0301 late-needle %_\\ end"
    val out=f.archive.ingest("a",snapshot(List(text)))
    val suffix=text.indexOf("🙂")
    val cases=List("i"->"İ","\u0307"->"İ","i\u0307"->"İ","σ"->"Σ","ος"->"ΟΣ","ς"->"Σ","k"->"K","🙂"->"🙂","e\u0301"->"e\u0301","late-needle"->"late-needle","%_\\"->"%_\\")
    cases.foreach { (literal,expected) =>
      val result=f.search(query("mode:lexical "+Json.fromString(literal).noSpaces),"a")
      assertEquals(result.page.total,1L,literal)
      val evidence=result.evidence.head.matches.head
      assertEquals(evidence.kind,ArchiveMatchKind.Literal); assertEquals(evidence.view,ContentView(1,None))
      assert(evidence.span.start>=text.take(suffix).getBytes(UTF_8).length)
      val bytes=text.getBytes(UTF_8)
      assertEquals(new String(bytes.slice(evidence.span.start,evidence.span.end),UTF_8),expected,literal)
      val context=f.archive.readMessageContext("a",out.sessionId,evidence.view,evidence.span,4,4)
      assertEquals(context.anchor.start,evidence.span.start)
    }
  }}
  test("metadata-only, metadata-text-only and negative-only branches never fabricate first-chunk evidence") { database { f =>
    publish(f,"a",snapshot(List("unrelated source")))
    List("project:project","mode:lexical metadata-only-token","mode:lexical NOT absent","mode:semantic (project:project OR NOT absent)").foreach { expression =>
      val result=f.search(query(expression),"a")
      assertEquals(result.page.total,1L); assertEquals(result.evidence.head.matches,Nil)
    }
    val double=f.search(query("mode:lexical NOT NOT unrelated"),"a")
    assertEquals(double.evidence.head.matches.head.operand,"unrelated")
  }}
  test("semantic witnesses come from exact retained candidates, not first chunks, and coexist with a newer HEAD pin") { database { f =>
    val original=snapshot(List("first irrelevant chunk","selected semantic chunk"))
    val id=publish(f,"a",original)
    val published=f.archive.session("a",id).view
    f.db.transaction { c =>
      Sql.exec(c,"UPDATE ch_search_chunks SET embedding='[-1,0,0]'::vector WHERE session_id=? AND id=(SELECT id FROM ch_chunks WHERE generation=? AND value->'spans'->0->>'messageId'='m0')",id,published.generationId.get)
    }
    f.archive.ingest("a",snapshot(List("new HEAD needle")).copy(source=original.source,expectedRevision=1))
    val result=f.search(query("needle"),"a")
    assertEquals(result.page.rows.head.matchedView,Some(ContentView(2,None)))
    val matches=result.evidence.head.matches
    assertEquals(matches.map(_.kind),List(ArchiveMatchKind.Literal,ArchiveMatchKind.Semantic))
    assertEquals(matches.map(_.view),List(ContentView(2,None),published))
    assertEquals(matches.last.span.messageId,"m1")
    assertEquals(f.archive.messages("a",id,0,10,Some(matches.last.view)).messages(1).text,"selected semantic chunk")
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_generations SET retired=true WHERE id=?",published.generationId.get))
    assertEquals(intercept[DomainError](f.search(query("mode:semantic needle"),"a")).code,"indexed-view-retired")
  }}
  test("same-session candidate ACL is applied before LIMIT, and source delivery rechecks live sharing and enabled owners") { database { f =>
    publish(f,"b",snapshot(List("private vector")))
    assertEquals(f.search(query("mode:semantic needle"),"a").page.total,0L)
    val group=UUID.randomUUID()
    f.db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','shared')",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group) }
    assertEquals(f.search(query("mode:semantic needle"),"a").page.total,1L)
    f.db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group))
    assertEquals(f.search(query("mode:semantic needle"),"a").page.total,0L)
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='b'"))
    assertEquals(intercept[DomainError](f.search(query("mode:semantic needle"),"b")).code,"unauthorized")
  }}
  test("mandatory page metadata and chunk JSON budgets reject before decoding even with an unrestricted caller") { database { f =>
    val out=f.archive.ingest("a",snapshot(List("tiny")))
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_revision_info SET metadata=jsonb_build_object('invalid',repeat('x',70000)) WHERE session_id=?",out.sessionId))
    assertEquals(intercept[DomainError](f.search(query(""),"a")).code,"read-budget")
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_sources SET tombstone=true WHERE id=?",out.sessionId))
    val id=publish(f,"a",snapshot(List("small source")))
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_chunks SET value=jsonb_build_object('invalid',repeat('x',70000)) WHERE generation=(SELECT published FROM ch_sources WHERE id=?)",id))
    assertEquals(intercept[DomainError](f.search(query("mode:semantic needle"),"a")).code,"read-budget")
    assertEquals(intercept[DomainError](f.search(query("").copy(limit=11),"a")).code,"invalid")
  }}
  test("page and semantic witness remain in one repeatable-read snapshot across concurrent publication") { database { f =>
    val original=snapshot(List("old immutable evidence"))
    val id=publish(f,"a",original)
    val pinned=f.archive.session("a",id).view
    var switched=false
    val caller=ReadMaterialization.admitted(new ReadAdmission {
      def consume(bytes: Long): Unit = {
        assert(bytes>=0)
        if(!switched) {
          switched=true
          val updated=snapshot(List("new publication")).copy(source=original.source,expectedRevision=1)
          publish(f,"a",updated)
        }
      }
    })
    val q=query("mode:semantic needle"); val parsed=ArchiveExpression.parse(q.expression)
    val result=f.index.sourceSearch("a",q,parsed,f.vectors(parsed),caller)
    assert(switched)
    assertEquals(result.page.rows.head.head.view,ContentView(1,None))
    assertEquals(result.evidence.head.matches.head.view,pinned)
    assertEquals(f.archive.session("a",id).view.revision,2)
    assertEquals(f.archive.messages("a",id,0,10,Some(pinned)).messages.head.text,"old immutable evidence")
  }}
  test("caller admission is cumulative and never reset or enlarged by per-row evidence selection") { database { f =>
    f.archive.ingest("a",snapshot(List("needle one")))
    f.archive.ingest("a",snapshot(List("needle two")))
    var consumed=0L; var calls=0
    val caller=ReadMaterialization.admitted(new ReadAdmission {
      def consume(bytes: Long): Unit = { calls+=1; consumed+=bytes; Check(calls<3,"read-budget","synthetic caller budget exhausted") }
    })
    val q=query("mode:lexical needle"); val parsed=ArchiveExpression.parse(q.expression)
    assertEquals(intercept[DomainError](f.index.sourceSearch("a",q,parsed,Nil,caller)).code,"read-budget")
    assertEquals(calls,3); assert(consumed>0)
  }}
  test("stricter inherited SQL deadlines cover witness lock waits and remain observable") { database { f =>
    f.archive.ingest("a",snapshot(List("needle")))
    val separator=if(f.config.jdbcUrl.contains("?")) "&" else "?"
    val options=java.net.URLEncoder.encode("-c statement_timeout=150",UTF_8)
    val config=f.config.copy(jdbcUrl=f.config.jdbcUrl+separator+"options="+options)
    val db=new Database(config,IndexProfileCatalog.current(config))
    val index=new PostgresArchiveIndex(db,new PostgresArchive(db,config),config)
    val locked=new CompletableFuture[Boolean]; val release=new CompletableFuture[Boolean]
    val lock=CompletableFuture.runAsync(() => f.db.transaction { c => Sql.exec(c,"LOCK TABLE ch_messages IN ACCESS EXCLUSIVE MODE"); locked.complete(true); release.get(15,TimeUnit.SECONDS); () })
    locked.get(5,TimeUnit.SECONDS)
    try {
      val parsed=ArchiveExpression.parse("mode:lexical needle")
      val start=System.nanoTime()
      assertEquals(intercept[DomainError](index.sourceSearch("a",query("mode:lexical needle"),parsed,Nil,ReadMaterialization.unrestricted)).code,"deadline")
      assert((System.nanoTime()-start)/1000000<3000,"stricter inherited deadline was enlarged")
    } finally { release.complete(true); lock.get(5,TimeUnit.SECONDS) }
  }}
  test("ordinary browser dispatch uses shared planning, explicit fresh authority, no MCP tool exposure, and no per-card embeddings") { database { f =>
    var queries=0
    val embedder=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO { queries+=1; List(1.0,0.0,0.0) }
      def documents(owner: String,texts: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("no source embedding"))
    }
    val auth=new Auth(f.db,f.config)
    val app=new Application(f.archive,new PostgresSearch(f.db,f.archive,f.config),embedder,auth,f.db,new CollectorProgress(new PostgresCollectorProgressStore(f.db),Clock.systemUTC()),f.index,new PostgresActivity(f.db,Clock.systemUTC()),new PostgresExpressionHintIndex(f.db,f.archive,Clock.systemUTC()),ModelFixtures.usage(f.config))
    publish(f,"a",snapshot(List("needle")))
    val identity=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    def call(q: ArchiveQuery): Result = app.operation(identity,ClientEnvelope(UUID.randomUUID(),Operation.ArchiveSearch(q))).unsafeRunSync()
    assert(call(query("needle OR amber")).isInstanceOf[Result.ArchiveSearch]); assertEquals(queries,2)
    assertEquals(intercept[DomainError](call(query("needle").copy(limit=11))).code,"invalid"); assertEquals(queries,2)
    assertEquals(intercept[DomainError](call(query("needle").copy(cursor=Some("invalid")))).code,"invalid"); assertEquals(queries,2)
    assertEquals(intercept[DomainError](call(query("mode:lexical OR needle"))).code,"invalid")
    assert(!new Mcp(app).tools.asArray.get.exists(_.hcursor.get[String]("name").exists(_.contains("archive"))))
    var fresh=0
    val access=ReadAccess(IO { fresh+=1; Check(fresh<3,"unauthorized","synthetic revocation before delivery"); identity },ReadMaterialization.unrestricted)
    assertEquals(intercept[DomainError](app.read(access,Operation.ArchiveSearch(query("mode:lexical needle"))).unsafeRunSync()).code,"unauthorized")
  }}
}
