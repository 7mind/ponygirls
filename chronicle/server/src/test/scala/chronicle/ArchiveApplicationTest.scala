package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.time.Clock
import java.util.UUID

class ArchiveApplicationTest extends munit.FunSuite {
  private final class FailingEmbedder extends Embedder {
    var queries=0
    def query(owner: String,text: String): IO[List[Double]] = IO { queries+=1; throw DomainError("model-http","synthetic unavailable model") }
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("archive must not embed source documents"))
  }
  private def database(f: (Config,Database,PostgresArchive,Application,FailingEmbedder) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.legacyOnly(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config); val embedder=new FailingEmbedder
    val app=new Application(archive,new PostgresSearch(db,archive,config),embedder,new Auth(db,config),db,new CollectorProgress(new PostgresCollectorProgressStore(db),Clock.systemUTC()),new PostgresArchiveIndex(db,archive,config),new PostgresActivity(db,Clock.systemUTC()))
    f(config,db,archive,app,embedder)
  }
  private val reader=Identity(UserInfo("a","a",List(Scope.Read)),false,"synthetic")
  private def query(expression: String,cursor: Option[String]): ArchiveQuery = ArchiveQuery(expression,ArchiveSort.LastTimestamp,SortDirection.Desc,cursor,100)
  private def call(app: Application,operation: Operation): Result = app.operation(reader,ClientEnvelope(UUID.randomUUID(),operation)).unsafeRunSync()
  test("BG GoodCommunication specified: empty/metadata/mode-only/lexical reads do not invoke any model or require semantic readiness") { database { (config,db,archive,app,embedder) =>
    val receipt=archive.ingest("a",Fixtures.snapshot())
    db.transaction(c => Sql.exec(c,"UPDATE ch_profile SET active='unavailable',maintenance=true"))
    List("","mode:semantic","project:project","NOT project:missing","mode:lexical PostgreSQL").foreach { expression =>
      val result=call(app,Operation.Archive(query(expression,None))).asInstanceOf[Result.Archive].result
      assertEquals(result.total,1L); assertEquals(result.textScope,ArchiveTextScope.ExactLexical)
    }
    assertEquals(embedder.queries,0)
    val tools=new Mcp(app).tools.asArray.get
    List("get_messages","get_chunks").foreach { name =>
      val tool=tools.find(_.hcursor.get[String]("name").contains(name)).get
      assertEquals(tool.hcursor.downField("inputSchema").downField("properties").downField("offset").get[Int]("maximum"),Right(Int.MaxValue))
    }
    val location=call(app,Operation.LocateMessage(receipt.sessionId,ContentView(1,None),"u")).asInstanceOf[Result.LocatedMessage].result
    assertEquals(location.position,0); assertEquals(location.total,1)
    assertEquals(intercept[DomainError](call(app,Operation.GetRaw(receipt.sessionId,Some(1)))).code,"forbidden")
  }}
  test("BG GoodCommunication specified: validate before embeddings and never silently return metadata when a text model fails") { database { (config,db,archive,app,embedder) =>
    archive.ingest("a",Fixtures.snapshot())
    assertEquals(intercept[DomainError](call(app,Operation.Archive(query("mode:lexical AND text OR project:project",None)))).code,"invalid")
    assertEquals(intercept[DomainError](call(app,Operation.Archive(query("text",Some("invalid-cursor"))))).code,"invalid")
    assertEquals(embedder.queries,0)
    List("project:project OR text","NOT text").foreach { expression =>
      assertEquals(intercept[DomainError](call(app,Operation.Archive(query(expression,None)))).code,"unavailable")
    }
    assertEquals(embedder.queries,2)
  }}
}
