package ontology

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import munit.FunSuite
import java.time.Duration
import java.util.UUID
import ontology.domain.AdmissionEngine
import scala.concurrent.duration.*

final class PackagedLeaseControls extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  test("acceptance rejects expired ownership without durable release") {
    RepositoryReproductionDatabase.resource.use { db =>
      val settings = TestCuration.settings(Set("packaged-release-control")).copy(leaseDuration = Duration.ofSeconds(1))
      val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
      for {
        _ <- repo.initialize
        lease <- repo.curation.acquire(UUID.randomUUID())
        result <- (IO.sleep(1100.millis) *> PackagedRuntimeAcceptance.verifyRelease(repo, db, lease.fence)).attempt
          .guarantee(repo.curation.release(lease.fence).attempt.void)
        _ = assert(result.isLeft, "expiry and reacquisition were accepted as proof of release")
      } yield ()
    }.unsafeRunSync()(using runtime)
  }
}
