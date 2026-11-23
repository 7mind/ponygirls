package chronicle

import cats.effect.{Deferred,IO,OutcomeIO}
import cats.effect.unsafe.implicits.global
import distage.*
import org.http4s.{Http as _,*}
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import java.util.concurrent.CountDownLatch
import scala.util.Using
import scala.concurrent.duration.*

final class WorkerFailureServeTest extends munit.FunSuite {
  private val answerBound = 1.second
  test("Blackbox-GoodCommunication regression: /api/versions keeps answering while the worker's database path is blocked and its failure record fails") {
    CurrentIndexDatabase.withDatabase { (fixture,db,archive) =>
      val port=Using.resource(new java.net.ServerSocket(0))(_.getLocalPort)
      // One lane; every worker statement waits at most one second for the source row held below.
      val config=fixture.copy(listenPort=port,allowedOrigin=s"http://127.0.0.1:$port",indexing=fixture.indexing.copy(annotationSessions=1),
        databaseLimits=fixture.databaseLimits.copy(statementTimeout=1.second,lockTimeout=1.second))
      val held=new CountDownLatch(1); val release=new CountDownLatch(1)
      (for {
        annotating <- Deferred[IO,Unit]
        annotated <- Deferred[IO,Unit]
        recordFailed <- Deferred[IO,Unit]
        claimedAgain <- Deferred[IO,Unit]
        terminated <- Deferred[IO,OutcomeIO[Nothing]]
        annotator=new ProblemPassageAnnotator {
          def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] =
            annotating.complete(()) *> annotated.get.as(ProblemPassages.Decision(Vector(ProblemPassages.Part(ProblemPassages.Point(0,0),window.terminal,false,"synthetic goal",Nil))))
        }
        production: Module=_root_.chronicle.plugins.ChroniclePlugin
        module=production.overriddenBy(new ModuleDef {
          make[Config].fromValue(config)
          make[Client[IO]].fromValue(Client.fromHttpApp[IO](HttpApp.notFound[IO]))
          make[ProblemPassageAnnotator].fromValue(annotator)
          make[Worker.FailureBackoff].fromValue(ModelFixtures.failureBackoff)
          // A transient failure's record is tried again until the lease ends: a lease of 2 s.
          make[Worker.Leases].fromValue(Worker.Leases.production.copy(lease=2.seconds,skewMargin=Duration.Zero))
          make[WorkerArchive].from { (db: Database,config: Config) => WorkerArchive(new ForwardingArchive(new PostgresArchive(db.background,config)) {
            override def claim(profiles: Set[String],scope: ClaimScope,lease: Int,large: LargeJobs): Option[Claim] = {
              if(recordFailed.tryGet.unsafeRunSync().nonEmpty) claimedAgain.complete(()).unsafeRunSync()
              super.claim(profiles,scope,lease,large)
            }
            private def observed[A](record: => A): A = try record catch { case error: Exception => recordFailed.complete(()).unsafeRunSync(); throw error }
            override def fail(c: Claim,code: String): Unit = observed(super.fail(c,code))
            override def fail(c: Claim,code: String,stage: IndexingStage): Unit = observed(super.fail(c,code,stage))
            override def holdTransient(c: Claim,stage: Option[IndexingStage],deadline: Deadline): TransientOutcome = observed(super.holdTransient(c,stage,deadline))
          })}
        })
        _ <- ChronicleInjector().produceGet[RuntimeServices](module).use { services =>
          val versions: IO[List[FiniteDuration]] = EmberClientBuilder.default[IO].build.use { client =>
            client.expect[String](Uri.unsafeFromString(s"http://127.0.0.1:$port/api/versions")).timed.timeout(answerBound).map(_._1).replicateA(5)
          }
          for {
            server <- Main.serve(config,services,true).guaranteeCase(outcome => terminated.complete(outcome).void).start
            receipt <- IO.blocking(archive.ingest("a",Fixtures.snapshot()))
            _ <- annotating.get.timeout(10.seconds)
            // The source row is held as a long ingest held it: the checkpoint write and the failure record both time out.
            holder <- IO.blocking(db.transaction { c =>
              Sql.one(c,"SELECT id FROM ch_sources WHERE id=? FOR UPDATE",receipt.sessionId)(_ => ()); held.countDown(); release.await()
            }).start
            _ <- IO.blocking(held.await())
            _ <- annotated.complete(())
            _ <- recordFailed.get.timeout(10.seconds)
            ended <- IO.race(terminated.get,claimedAgain.get).timeout(10.seconds)
            _ <- IO(ended.left.foreach(outcome => fail(s"the server ended after the failure record failed: $outcome")))
            latencies <- versions
            _ <- IO(assert(terminated.tryGet.unsafeRunSync().isEmpty,"the server keeps running"))
            _ <- IO(release.countDown()) *> holder.joinWithNever
            _ <- server.cancel
          } yield assert(latencies.forall(_<answerBound),latencies.toString)
        }
      } yield ()).guarantee(IO(release.countDown())).unsafeRunSync()
    }
  }
}
