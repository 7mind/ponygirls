package ontology

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.time.{Clock, Instant, ZoneId, ZoneOffset}
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import ontology.api.*
import ontology.domain.AdmissionEngine

final class MemoryCurationClockControls extends CurationRepositorySupport {
  private final class ControlledClock(value: AtomicReference[Instant], zone: ZoneId) extends Clock {
    def getZone: ZoneId = zone
    override def withZone(next: ZoneId): Clock = new ControlledClock(value, next)
    def instant(): Instant = value.get()
    def set(next: Instant): Unit = value.set(next)
  }
  private val start = Instant.parse("2026-11-11T00:00:00Z")
  private val clock = new ControlledClock(new AtomicReference(start), ZoneOffset.UTC)
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] =
    Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, clock)))

  test("clock rollback and exact lease expiry cannot authorize new audit evidence") { check { (repo, settings, scope) => for {
    _ <- IO(clock.set(start))
    _ <- capture(repo, scope)
    old <- repo.curation.acquire(UUID.randomUUID())
    _ <- IO(clock.set(start.minusNanos(1)))
    rollback <- repo.curation.renew(old.fence).attempt
    _ = fault(rollback, "coordinator")
    acquisition <- repo.curation.acquire(old.fence.ownerId).attempt
    _ = fault(acquisition, "coordinator")
    _ <- IO(clock.set(start.plusSeconds(1)))
    value <- begin(repo, settings, scope, old, Nil)
    _ <- IO(clock.set(Instant.parse(old.expiresAt)))
    expired <- repo.curation.appendAudit(old.fence, scope, value.attempt.claim.attemptId, 1, CurationAuditStage.ResponseObserved, value.request.digest, Some(value.response)).attempt
    _ = fault(expired, "coordinator")
    unchanged <- repo.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId)
    _ = assertEquals(unchanged.journal.size, 2)
    _ = assert(unchanged.attempt.auditUncertain)
    _ <- leased(repo) { next => for {
      _ <- IO(assertEquals(next.fence.epoch, old.fence.epoch + 1L))
      recovered <- repo.curation.recoverOlderFences(next.fence, 1)
      _ = assertEquals(recovered.attempts.map(_.state), List(CurationAttemptState.Interrupted))
      _ = assert(recovered.attempts.head.auditUncertain)
      graph <- repo.read(scope)
      _ = assertEquals((graph.sourceFrontier, graph.coveredFrontier), (1L, 0L))
    } yield () }
  } yield () } }
}
