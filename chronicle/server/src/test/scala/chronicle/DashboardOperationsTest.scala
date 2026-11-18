package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import java.time.Clock
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

final class DashboardOperationsTest extends munit.FunSuite {
  private final case class Context(app: Application,auth: Auth,archive: PostgresArchive,db: Database,config: Config,owner: Identity,providerCalls: AtomicInteger)
  private def database(f: Context => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped")
    }
    val config=Fixtures.config()
    val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_groups,ch_sessions,ch_mutations CASCADE")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val auth=new Auth(db,config); val archive=new PostgresArchive(db,config)
    val calls=new AtomicInteger(0)
    val embedder=new Embedder {
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO { calls.incrementAndGet(); throw new AssertionError("metadata operation invoked embedding") }
      def query(owner: String,text: String): IO[List[Double]] = IO { calls.incrementAndGet(); throw new AssertionError("metadata operation invoked embedding") }
    }
    val app=new Application(archive,new PostgresSearch(db,archive,config),embedder,auth,db,new CollectorProgress(new PostgresCollectorProgressStore(db),Clock.systemUTC()),new PostgresArchiveIndex(db,archive,config),new PostgresActivity(db,Clock.systemUTC()),new PostgresExpressionHintIndex(db,archive,Clock.systemUTC()),ModelFixtures.usage(config))
    val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    f(Context(app,auth,archive,db,config,owner,calls))
  }
  private def run(c: Context,identity: Identity,operation: Operation): Result =
    c.app.operationVersion(identity,ClientEnvelope(UUID.randomUUID(),operation),"1.9.0").unsafeRunSync()

  test("Blackbox-GoodCommunication: authorized completion and usage remain available through retained 1.4 without inference") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot())
    val hints=run(c,c.owner,Operation.ExpressionHints(ExpressionHintQuery(ExpressionHintTarget.Archive(),"proj",4,20))).asInstanceOf[Result.ExpressionHints].result
    assert(hints.hints.exists(_.insertText=="project:"))
    val usage=run(c,c.owner,Operation.ModelUsage()).asInstanceOf[Result.ModelUsage].result
    assertEquals(usage.samples.map(_.purpose),List(ModelPurpose.Annotation,ModelPurpose.DocumentEmbedding,ModelPurpose.QueryEmbedding,ModelPurpose.McpTest))
    assert(usage.samples.forall(sample => sample.inFlight==0 && sample.input.tokensPerSecond.isEmpty))
    assertEquals(c.providerCalls.get(),0)
  }}
  test("Blackbox-GoodCommunication: passage pages require exact immutable views; a retired generation with an old-format label answers indexed-view-retired") { database { c =>
    val source=c.archive.ingest("a",Fixtures.snapshot())
    val sourceView=ContentView(1,None)
    val unindexed=run(c,c.owner,Operation.GetPassages(source.sessionId,sourceView,0,40)).asInstanceOf[Result.Passages].result
    assertEquals(unindexed,PassagesResult(sourceView,PassageFormat.Unindexed,Nil,0L,0))
    // A tombstone as the legacy retirement leaves it: the row with its revision and its historical format and profile labels.
    val tombstone=ContentView(1,Some(UUID.randomUUID()))
    c.db.transaction(x => Sql.exec(x,"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,retired) VALUES(?,?,1,'retired-policy-profile','LegacyAnnotations',true)",tombstone.generationId.get,source.sessionId))
    List(Operation.GetPassages(source.sessionId,tombstone,0,40),Operation.GetPassageSpans(source.sessionId,tombstone,UUID.randomUUID(),0,40),Operation.GetSession(source.sessionId,Some(tombstone))).foreach { operation =>
      assertEquals(intercept[DomainError](run(c,c.owner,operation)).code,"indexed-view-retired")
    }
    assertEquals(run(c,c.owner,Operation.GetPassages(source.sessionId,sourceView,0,40)),Result.Passages(unindexed))
    val missing=ContentView(1,Some(UUID.randomUUID()))
    assertEquals(intercept[DomainError](run(c,c.owner,Operation.GetPassages(source.sessionId,missing,0,40))).code,"not-found")
    val other=c.auth.browser(c.auth.login(LoginRequest("b","synthetic"))._2)
    assertEquals(intercept[DomainError](run(c,other,Operation.GetPassages(source.sessionId,tombstone,0,40))).code,"not-found")
    assertEquals(c.providerCalls.get(),0)
  }}
  test("Effectual-GoodCommunication: owner preview routes to browser-only current authorization without mutation or inference") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot())
    val result=run(c,c.owner,Operation.PreviewOwnerReindex()).asInstanceOf[Result.OwnerReindexPreview].result
    assertEquals(result,c.auth.previewOwnerReindex(c.owner))
    assertEquals(result.heads,1L)
    assertEquals(c.db.transaction(x => Sql.one(x,"SELECT count(*) FROM ch_mutations")(_.getLong(1)).get),0L)
    c.auth.logout(c.owner)
    assertEquals(intercept[DomainError](run(c,c.owner,Operation.PreviewOwnerReindex())).code,"unauthorized")
    assertEquals(c.providerCalls.get(),0)
  }}
}
