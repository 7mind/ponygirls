package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Clock
import java.util.{Base64,UUID}

class ArchiveRelevanceTest extends munit.FunSuite {
  private final class QueryEmbedder extends Embedder {
    var queries=List.empty[String]
    var failure=Option.empty[DomainError]
    def query(owner: String,text: String): IO[List[Double]] = IO {
      queries=queries :+ text
      failure.foreach(throw _)
      if(text=="west") List(0.0,1.0,0.0) else List(1.0,0.0,0.0)
    }
    def documents(owner: String,texts: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("archive reads must not embed documents"))
  }
  private final case class Fixture(config: Config,db: Database,archive: PostgresArchive,index: ArchiveIndex,app: Application,embedder: QueryEmbedder)
  private def database(run: Fixture => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config); val embedder=new QueryEmbedder
    val index=new PostgresArchiveIndex(db,archive,config)
    val app=new Application(archive,new PostgresSearch(db,archive,config),embedder,new Auth(db,config),db,new CollectorProgress(new PostgresCollectorProgressStore(db),Clock.systemUTC()),index,new PostgresActivity(db,Clock.systemUTC()),new PostgresExpressionHintIndex(db,archive,Clock.systemUTC()),ModelFixtures.usage(config))
    run(Fixture(config,db,archive,index,app,embedder))
  }
  private def snapshot(texts: List[String],time: Option[String],title: String): IngestRequest = {
    val base=Fixtures.snapshot()
    val messages=texts.zipWithIndex.map { (text,index) => Message(s"m$index",None,"user",text,time,index) }
    val raw=messages.map(value => Wire.encode(Message.codecJson,value).noSpaces).mkString("","\n","\n")
    base.copy(metadata=base.metadata.copy(title=title,tags=Nil,startedAt=None,endedAt=None),messages=messages,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private def publish(f: Fixture,owner: String,texts: List[String],vectors: List[List[Double]],time: Option[String],title: String): UUID = {
    assertEquals(texts.size,vectors.size)
    val request=snapshot(texts,time,title); val receipt=f.archive.ingest(owner,request)
    val claim=f.archive.claim(Set(f.config.profile),ClaimScope.Owner(owner),300).get
    assertEquals(claim.sessionId,receipt.sessionId)
    val chunks=request.messages.zip(vectors).map { (message,vector) => IndexedChunk(Fragments.split(List(message)).head.copy(sessionId=receipt.sessionId),vector) }
    assert(f.archive.publish(claim,chunks))
    receipt.sessionId
  }
  private def query(expression: String): ArchiveQuery = ArchiveQuery(expression,ArchiveSort.LastTimestamp,SortDirection.Desc,None,100,true)
  private def call(f: Fixture,q: ArchiveQuery,owner: String): ArchiveResult = {
    val identity=Identity(UserInfo(owner,owner,List(Scope.Read)),false,"synthetic")
    f.app.operation(identity,ClientEnvelope(UUID.randomUUID(),Operation.Archive(q))).unsafeRunSync().asInstanceOf[Result.Archive].result
  }
  private def all(f: Fixture,q: ArchiveQuery,owner: String): List[ArchiveRow] = {
    val result=List.newBuilder[ArchiveRow]; var cursor=Option.empty[String]; var more=true
    while(more) {
      val page=call(f,q.copy(cursor=cursor),owner)
      result++=page.rows; cursor=page.nextCursor; more=cursor.nonEmpty
    }
    result.result()
  }
  private def cursorJson(value: String): Json = Wire.parse(new String(Base64.getUrlDecoder.decode(value),UTF_8))
  private def changeCursor(value: String)(change: Json => Json): String = Base64.getUrlEncoder.withoutPadding.encodeToString(change(cursorJson(value)).noSpaces.getBytes(UTF_8))
  private def score(value: String): String = cursorJson(value).hcursor.downField("last").as[List[Json]].toOption.get.head.asString.get
  private def reciprocal(f: Fixture,rank: Int): String = f.db.transaction(c => Sql.one(c,"SELECT (1::numeric/(60+?))::text",rank)(_.getString(1)).get)

  test("Blackbox-GoodCommunication: distinct query vectors stay bound to the positive operand when another operand is negated") { database { f =>
    val east=publish(f,"a",List("first record"),List(List(1.0,0.0,0.0)),Some("2026-01-01T00:00:00Z"),"east")
    val west=publish(f,"a",List("second record"),List(List(0.0,1.0,0.0)),Some("2026-03-01T00:00:00Z"),"west")
    val middle=publish(f,"a",List("third record"),List(List(1.0,1.0,0.0)),Some("2026-02-01T00:00:00Z"),"middle")
    assertEquals(call(f,query("mode:semantic (east OR NOT west)"),"a").rows.map(_.head.id),List(east,middle,west))
    assertEquals(f.embedder.queries,List("east","west"))
    f.embedder.queries=Nil
    assertEquals(call(f,query("mode:semantic (west OR NOT east)"),"a").rows.map(_.head.id),List(west,middle,east))
    assertEquals(f.embedder.queries,List("west","east"))
  }}
  test("Blackbox-GoodCommunication: zero-evidence null-time relevance anchors page correctly while text-free preferences retain v2 cursors") { database { f =>
    val positive=f.archive.ingest("a",snapshot(List("needle"),None,"a")).sessionId
    val zeros=List("b","c").map(title => f.archive.ingest("a",snapshot(List("opaque"),None,title)).sessionId).sortBy(_.toString)
    val q=query("mode:lexical (needle OR NOT missing)").copy(limit=1)
    val first=call(f,q,"a")
    val second=call(f,q.copy(cursor=first.nextCursor),"a")
    assertEquals(first.rows.map(_.head.id),List(positive))
    assertEquals(second.rows.map(_.head.id),List(zeros.head))
    assertEquals(score(second.nextCursor.get),"0")
    assertEquals(cursorJson(second.nextCursor.get).hcursor.downField("last").as[List[Json]],Right(List(Json.fromString("0"),Json.Null)))
    val third=call(f,q.copy(cursor=second.nextCursor),"a")
    assertEquals(third.rows.map(_.head.id),List(zeros.last))
    assertEquals(third.nextCursor,None)
    val browse=call(f,query("mode:semantic").copy(limit=1),"a")
    assert(!browse.relevanceOrdered)
    assertEquals(cursorJson(browse.nextCursor.get).hcursor.get[Int]("version"),Right(2))
    assertEquals(f.embedder.queries,Nil)
  }}
  test("Blackbox-GoodCommunication: lexical relevance rewards positive operand coverage before recency and preserves manual sorts") { database { f =>
    val older=f.archive.ingest("a",snapshot(List("needle amber"),Some("2026-01-01T00:00:00Z"),"z"))
    val newer=f.archive.ingest("a",snapshot(List("needle"),Some("2026-02-01T00:00:00Z"),"a"))
    val newest=f.archive.ingest("a",snapshot(List("amber"),Some("2026-03-01T00:00:00Z"),"m"))
    val q=query("mode:lexical (needle OR amber)")
    val ranked=call(f,q,"a")
    assertEquals(ranked.rows.map(_.head.id),List(older.sessionId,newest.sessionId,newer.sessionId))
    assert(ranked.relevanceOrdered)
    assertEquals(all(f,q.copy(sort=ArchiveSort.Title,direction=SortDirection.Asc,limit=1),"a").map(_.head.id),ranked.rows.map(_.head.id))
    assertEquals(call(f,q.copy(preferRelevance=false),"a").rows.map(_.head.id),List(newest.sessionId,newer.sessionId,older.sessionId))
    assertEquals(call(f,q.copy(preferRelevance=false,sort=ArchiveSort.Title,direction=SortDirection.Asc),"a").rows.map(_.head.id),List(newer.sessionId,newest.sessionId,older.sessionId))
    assertEquals(f.embedder.queries,Nil)
  }}
  test("Blackbox-GoodCommunication: semantic relevance uses full cosine before recency and equal vectors share one session rank") { database { f =>
    val many=publish(f,"a",List("first", "second", "third"),List.fill(3)(List(1.0,0.0,0.0)),Some("2026-01-01T00:00:00Z"),"many")
    val tied=publish(f,"a",List("fourth"),List(List(1.0,0.0,0.0)),Some("2026-02-01T00:00:00Z"),"tied")
    val farther=publish(f,"a",List("fifth"),List(List(0.0,1.0,0.0)),Some("2026-03-01T00:00:00Z"),"farther")
    val farthest=publish(f,"a",List("sixth"),List(List(-1.0,0.0,0.0)),Some("2026-04-01T00:00:00Z"),"farthest")
    val q=query("mode:semantic needle")
    assertEquals(call(f,q,"a").rows.map(_.head.id),List(tied,many,farther,farthest))
    assertEquals(all(f,q.copy(limit=1),"a").map(_.head.id),List(tied,many,farther,farthest))
    val first=call(f,q.copy(limit=1),"a")
    val second=call(f,q.copy(limit=1,cursor=first.nextCursor),"a")
    assertEquals(score(first.nextCursor.get),reciprocal(f,1))
    assertEquals(score(second.nextCursor.get),reciprocal(f,1))
    val third=call(f,q.copy(limit=1,cursor=second.nextCursor),"a")
    assertEquals(score(third.nextCursor.get),reciprocal(f,3))
    assertEquals(first.total,4L)
  }}
  test("Blackbox-GoodCommunication: hybrid keeps unindexed HEAD literals and fuses literal plus semantic evidence without a cutoff") { database { f =>
    val both=publish(f,"a",List("needle support"),List(List(0.0,1.0,0.0)),Some("2026-01-01T00:00:00Z"),"both")
    val nearest=publish(f,"a",List("opaque record"),List(List(1.0,0.0,0.0)),Some("2026-02-01T00:00:00Z"),"nearest")
    val literal=f.archive.ingest("a",snapshot(List("needle fresh"),Some("2026-03-01T00:00:00Z"),"literal"))
    val q=query("needle")
    val page=call(f,q,"a")
    assertEquals(page.rows.map(_.head.id),List(both,literal.sessionId,nearest))
    assertEquals(page.rows.find(_.head.id==literal.sessionId).get.matchedView,Some(ContentView(1,None)))
    assertEquals(page.rows.find(_.head.id==literal.sessionId).get.publishedView,None)
    assertEquals(page.annChunkLimitPerOperand,Some(1000))
    assertEquals(page.textScope,ArchiveTextScope.BoundedCandidateSets)
    assertEquals(all(f,q.copy(limit=1),"a").map(_.head.id),page.rows.map(_.head.id))
  }}
  test("Blackbox-GoodCommunication: relevance preserves Boolean membership and HEAD versus stale publication provenance in every mode") { database { f =>
    val original=publish(f,"a",List("needle first"),List(List(1.0,0.0,0.0)),Some("2026-01-01T00:00:00Z"),"first")
    publish(f,"a",List("amber second"),List(List(0.0,1.0,0.0)),Some("2026-02-01T00:00:00Z"),"second")
    publish(f,"b",List("needle amber private"),List(List(1.0,0.0,0.0)),Some("2026-03-01T00:00:00Z"),"private")
    val old=f.archive.session("a",original)
    val changed=snapshot(List("successor"),Some("2026-04-01T00:00:00Z"),"first").copy(source=old.source,expectedRevision=1)
    f.archive.ingest("a",changed)
    for(mode <- List("lexical","semantic","hybrid"); body <- List("needle OR amber","needle AND NOT amber","NOT (needle OR amber)","NOT NOT needle","needle OR project:project","(needle AND project:project) OR amber","successor")) {
      val q=query(s"mode:$mode ($body)")
      val ranked=call(f,q,"a"); val columns=call(f,q.copy(preferRelevance=false),"a")
      assertEquals(ranked.total,columns.total,s"$mode $body")
      assertEquals(ranked.rows.map(row => row.head.id->row.matchedView).toMap,columns.rows.map(row => row.head.id->row.matchedView).toMap,s"$mode $body")
    }
    val literal=call(f,query("successor"),"a").rows.find(_.head.id==original).get
    val semantic=call(f,query("mode:semantic needle"),"a").rows.find(_.head.id==original).get
    assertEquals(literal.matchedView,Some(ContentView(2,None)))
    assertEquals(semantic.matchedView,Some(old.view))
  }}
  test("Blackbox-GoodCommunication: text-free preferences keep requested column order and remain provider free while negation never boosts") { database { f =>
    f.archive.ingest("a",snapshot(List("needle"),None,"a"))
    f.archive.ingest("a",snapshot(List("amber"),None,"z"))
    List("","mode:semantic","project:project","NOT project:missing","mode:lexical NOT missing").foreach { expression =>
      val q=query(expression).copy(sort=ArchiveSort.Title,direction=SortDirection.Desc)
      val result=call(f,q,"a")
      assert(!result.relevanceOrdered,expression)
      assertEquals(result.rows.map(_.head.metadata.title),List("z","a"))
    }
    assertEquals(f.embedder.queries,Nil)
    val q=query("mode:lexical (needle OR NOT missing)").copy(limit=1)
    val first=call(f,q,"a")
    assertEquals(first.rows.head.head.metadata.title,"a")
    val last=call(f,q.copy(cursor=first.nextCursor),"a")
    assertEquals(last.rows.head.head.metadata.title,"z")
  }}
  test("Blackbox-GoodCommunication: score cursors page null timestamps and tied scores deterministically beyond fifty rows") { database { f =>
    val ids=(0 until 57).map { index => f.archive.ingest("a",snapshot(List("needle"),if(index%3==0) None else Some("2026-01-01T00:00:00Z"),s"row-$index")).sessionId }.toSet
    val q=query("mode:lexical needle")
    val expected=call(f,q,"a")
    assertEquals(expected.rows.map(_.head.id).toSet,ids)
    assertEquals(all(f,q.copy(limit=7),"a").map(_.head.id),expected.rows.map(_.head.id))
    assertEquals(all(f,q.copy(limit=50),"a").map(_.head.id),expected.rows.map(_.head.id))
    val first=call(f,q.copy(limit=1),"a")
    assertEquals(cursorJson(first.nextCursor.get).hcursor.get[Int]("version"),Right(3))
    assertEquals(score(first.nextCursor.get),reciprocal(f,1))
    val columns=call(f,q.copy(preferRelevance=false,limit=1),"a")
    assertEquals(cursorJson(columns.nextCursor.get).hcursor.get[Int]("version"),Right(2))
  }}
  test("Blackbox-GoodCommunication: malformed and mixed-version cursors fail before query embedding without relaxing numeric column anchors") { database { f =>
    publish(f,"a",List("one"),List(List(1.0,0.0,0.0)),None,"one")
    publish(f,"a",List("two"),List(List(0.0,1.0,0.0)),None,"two")
    val q=query("mode:semantic needle").copy(limit=1)
    val current=call(f,q,"a").nextCursor.get
    val old=call(f,q.copy(preferRelevance=false),"a").nextCursor.get
    val badValues=List("NaN","1e3","-0.1","1.0","0."+"1"*41)
    val altered=badValues.map(value => changeCursor(current)(_.mapObject(_.add("last",Json.arr(Json.fromString(value),Json.Null)))))
    val wrongTime=changeCursor(current)(_.mapObject(_.add("last",Json.arr(Json.fromString("0.1"),Json.fromString("1e1000000")))))
    val wrongSort=changeCursor(current)(_.mapObject(_.add("sort",Json.fromString("Title"))))
    f.embedder.queries=Nil
    (altered++List(wrongTime,wrongSort,old)).foreach { cursor => assertEquals(intercept[DomainError](call(f,q.copy(cursor=Some(cursor)),"a")).code,"invalid") }
    assertEquals(intercept[DomainError](call(f,q.copy(preferRelevance=false,cursor=Some(current)),"a")).code,"invalid")
    assertEquals(f.embedder.queries,Nil)
  }}
  test("Blackbox-GoodCommunication: private nearer publications do not occupy ranks and semantic outages remain explicit failures") { database { f =>
    val visible=publish(f,"a",List("visible"),List(List(0.0,1.0,0.0)),None,"visible")
    publish(f,"a",List("other"),List(List(-1.0,0.0,0.0)),None,"other")
    publish(f,"b",List("private"),List(List(1.0,0.0,0.0)),None,"private")
    val q=query("mode:semantic needle").copy(limit=1)
    val result=call(f,q,"a")
    assertEquals(result.rows.head.head.id,visible)
    assertEquals(result.total,2L)
    assertEquals(score(result.nextCursor.get),reciprocal(f,1))
    f.embedder.failure=Some(DomainError("model-http","synthetic unavailable model"))
    assertEquals(intercept[DomainError](call(f,q,"a")).code,"unavailable")
  }}
}
