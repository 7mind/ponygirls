package haystack.auth

import cats.effect.{IO,Ref}
import cats.syntax.all.*
import haystack.application.ItemService
import haystack.http.{Http,LiveHub}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import org.http4s.{Header,Method,Request,Status,Uri}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.retrieval.{EmbeddingClient,EmbeddingSpace,RetrievalProfile}
import ponygirls.retrieval.postgres.{IndexingEvent,PostgresRetrieval}
import ponygirls.runtime.{JdbcDatabase,JdbcPoolSizing,RuntimeFailure}
import java.util.concurrent.CountDownLatch
import scala.concurrent.duration.*

/** The server's pool (restart-robustness spec §5, §7 D8, D9-style): the indexing worker on the background admission,
  * requests on the request admission, a request that finds the database unavailable answered 503 `unavailable`. */
class PoolWiringTest extends ContractSuite {
  import AuthFixtures.*
  private val embedding: EmbeddingClient = new EmbeddingClient {
    def documents(text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
    def query(text: String): IO[List[Double]] = IO.pure(List(1.0,0.0,0.0))
  }
  /** `count` transactions of `transaction` held until the returned release runs. */
  private def held(count: Int)(transaction: (java.sql.Connection => Unit) => IO[Unit]): IO[IO[Unit]] = for {
    entered <- IO(new CountDownLatch(count)); release <- IO(new CountDownLatch(1))
    fibers <- List.fill(count)(transaction(_ => { entered.countDown(); release.await() })).traverse(_.start)
    _ <- IO.blocking(entered.await())
  } yield IO(release.countDown()) *> fibers.traverse_(_.joinWithNever)

  test("D8 the indexing worker runs on the background admission: saturated, its claim reports admission-timeout while an item GET is served; a saturated request admission answers 503 unavailable") { directory { dir =>
    val auth=Auth.load(config(dir))
    // maxConnections 8, keys omitted: 3 request + 3 background connections (spec §5); a 1 s queue timeout.
    val limits=TestSupport.databaseConfig.limits.copy(maxConnections=8,queueTimeout=1.second)
    val sizing=JdbcPoolSizing.partitioned(limits,None,None,0).toOption.get
    assertEquals((sizing.request,sizing.background),(3,3))
    run(JdbcDatabase.resource(TestSupport.databaseConfig.copy(limits=limits),sizing).use { db => for {
      _ <- Migrations.initialize(db,TestSupport.Activity) *> TestSupport.wipe(db)
      policy=ProjectionPolicy("pool-wiring-test",true,Vector.empty,4096)
      retrieval=new HaystackRetrieval(db,policy,new PostgresRetrieval("haystack",Some(RetrievalProfile(EmbeddingSpace("synthetic-fixture","v1",3,false,"","","cosine"),policy.id))),Some(embedding),4)
      repository=new PostgresItemRepository(db,Some(retrieval))
      _ <- repository.initializeProjection()
      _ <- repository.commit(TestSupport.op("p:pool"),TestSupport.Bot,TestSupport.Now)
      hub <- LiveHub.create
      http=new Http(()=>auth,new ItemService(repository,(_,_)=>IO.unit),hub,None,retrieval,new AccountService(db,()=>auth,imperative))
      ws <- WebSocketBuilder2[IO]
      get=Request[IO](Method.POST,Uri.unsafeFromString("/api/v1/get")).withEntity("""{"key":"p:pool","revision":null}""")
        .putHeaders(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Authorization"),"Bearer "+AliceToken),Header.Raw(CIString("Content-Type"),"application/json"))
      item=http.routes(ws).orNotFound(get).flatMap(response => response.as[String].map(body => (response.status,body)))
      events <- Ref[IO].of(Vector.empty[String])
      worker=retrieval.worker(event => events.update(_ :+ event.line)).get
      releaseBackground <- held(3)(f => db.background.transaction(f))
      claimed <- worker.once.attempt.guarantee(releaseBackground)
      logged <- events.get
      _=assertEquals(claimed,Left(RuntimeFailure("admission-timeout")))
      _=assertEquals(logged,Vector("retrieval indexing claim failed namespace=haystack code=admission-timeout"))
      releaseBackground <- held(3)(f => db.background.transaction(f))
      served <- item.guarantee(releaseBackground)
      _=assertEquals(served._1,Status.Ok,served._2)
      releaseRequests <- held(3)(f => db.transaction(f))
      refused <- item.guarantee(releaseRequests)
      _=assertEquals((refused._1,refused._2.contains("\"unavailable\"")),(Status.ServiceUnavailable,true),refused._2)
    } yield () })
  }}
}
