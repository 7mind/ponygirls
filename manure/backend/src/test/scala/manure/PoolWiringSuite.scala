package manure

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import distage.*
import manure.{api => wire}
import manure.plugins.{ManurePlugin,RuntimeServices}
import manure.storage.{ConfinedDirectory,RootLease}
import org.http4s.{Header,Method,Request,Status,Uri}
import org.typelevel.ci.CIString
import ponygirls.auth.CredentialGate
import ponygirls.retrieval.{EmbeddingClient,EmbeddingEndpoint}
import ponygirls.runtime.{CatsIOInjector,JdbcDatabase,JdbcPoolSizing,RuntimeFailure}
import java.util.UUID
import java.util.concurrent.CountDownLatch
import scala.concurrent.duration.*
import munit.FunSuite

/** The server's pool (restart-robustness spec §5, §7 D8, D9-style), through the production plugin graph: the search
  * worker and the sweeper on the background admission, requests on the request admission, a request that finds the
  * database unavailable answered 503 with Retry-After 5. Every transaction of the graph runs under the root lease, one at
  * a time; the admissions are held directly on the pool. */
final class PoolWiringSuite extends FunSuite:
  /** `count` transactions of `transaction` held until the returned release runs. */
  private def held(count: Int)(transaction: (java.sql.Connection => Unit) => IO[Unit]): IO[IO[Unit]] = for
    entered <- IO(new CountDownLatch(count)); release <- IO(new CountDownLatch(1))
    fibers <- List.fill(count)(transaction(_ => { entered.countDown(); release.await() })).traverse(_.start)
    _ <- IO.blocking(entered.await())
  yield IO(release.countDown()) *> fibers.traverse_(_.joinWithNever)
  private val embedding: EmbeddingClient = new EmbeddingClient:
    def documents(text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("no embedding"))
    def query(text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no embedding"))

  test("D8 the search worker and the sweeper run on the background admission: saturated, the worker's claim fails admission-timeout and the sweep waits on it while a list is served; a saturated request admission answers 503 with Retry-After 5") {
    BackendFixture.resource(true).use { f =>
      // maxConnections 8, keys omitted: 3 request + 3 background connections (spec §5); a 1 s queue timeout; an embedding
      // the worker never reaches (its claim fails first).
      val limits = f.config.database.limits.copy(maxConnections=8,queueTimeout=1.second)
      val config = f.config.copy(apiOrigin=ApiOrigin.parse("http://127.0.0.1:47329"),port=47329,database=f.config.database.copy(limits=limits),
        databasePool=JdbcPoolSizing.partitioned(limits,None,None,0).toOption.get,
        embedding=Some(EmbeddingSettings(EmbeddingEndpoint("http://127.0.0.1:1/embeddings","fixture","immutable",3,false,"","","cosine","/nonexistent-unused",
          5.seconds,1024,1,1024,4096),1,1,1,30,1.second)))
      assertEquals((config.databasePool.request,config.databasePool.background),(3,3))
      val list = Request[IO](Method.POST,Uri.unsafeFromString("/api/current"))
        .withEntity(CurrentWire.encode(wire.ClientEnvelope.codecJson,wire.ClientEnvelope(UUID.randomUUID(),"1.0.0",
          wire.Command.ListArtifacts(wire.CatalogueQuery("",false,None,None,wire.CatalogueSort.Name,wire.SortDirection.Asc,20,None,Nil,None,None)))).noSpaces)
        .putHeaders(Header.Raw(CIString("Host"),"127.0.0.1:47329"),Header.Raw(CIString("Authorization"),"Bearer "+f.token),Header.Raw(CIString("Content-Type"),"application/json"))
      (JdbcDatabase.resource(config.database,config.databasePool),CredentialGate.resource,cats.effect.Resource.eval(Semaphore[IO](1L))).tupled.use { (pool,credentials,gate) =>
        CatsIOInjector().produceGet[RuntimeServices](new ModuleDef {
          include(ManurePlugin)
          make[Config].fromValue(config)
          make[ConfinedDirectory].fromValue(f.root)
          make[RootLease].fromValue(f.lease)
          make[JdbcDatabase].fromValue(pool)
          make[Option[EmbeddingClient]].fromValue(Some(embedding))
          make[Semaphore[IO]].fromValue(gate)
          make[CredentialGate].fromValue(credentials)
        }).use { services => for
          releaseBackground <- held(3)(f => pool.background.transaction(f))
          outcomes <- (services.worker.once().attempt,services.artifacts.sweep().attempt.timed,services.http.app.run(list)).tupled.guarantee(releaseBackground)
          (claimed,(sweptAfter,swept),served) = outcomes
          _ <- IO {
            assertEquals(claimed,Left(RuntimeFailure("admission-timeout")))
            assertEquals(swept,Left(RuntimeFailure("admission-timeout")))
            assert(sweptAfter>=limits.queueTimeout,sweptAfter.toString)
            assertEquals(served.status,Status.Ok)
          }
          releaseRequests <- held(3)(f => pool.transaction(f))
          refused <- services.http.app.run(list).flatMap(response => response.as[String].map((response,_))).guarantee(releaseRequests)
          _ <- IO {
            assertEquals((refused._1.status,refused._1.headers.get(CIString("Retry-After")).map(_.head.value)),(Status.ServiceUnavailable,Some("5")))
            assert(refused._2.toLowerCase.contains("unavailable"),refused._2)
          }
        yield () }
      }
    }.unsafeRunSync()
  }
