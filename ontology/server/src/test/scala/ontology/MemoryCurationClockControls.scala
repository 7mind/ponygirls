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

  private def bounded(body: (GraphRepository, CurationStoreSettings, String) => IO[Unit]): Unit = {
    val scope = "deadline-" + UUID.randomUUID()
    val settings = TestCuration.settings(Set(scope)).copy(attemptDuration = java.time.Duration.ofSeconds(5))
    run(repository(settings).use(repo => IO(clock.set(start)) *> body(repo, settings, scope)))
  }

  for (stage <- List("seal", "prepare", "dispatch")) test(s"renewal cannot admit $stage at the fixed attempt deadline") { bounded { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    id = UUID.randomUUID()
    claimed <- repo.curation.claim(lease.fence, scope, id, profile)
    attempt = claimed.asInstanceOf[CurationClaimResult.Claimed].attempt
    _ = assertEquals(attempt.claim.deadlineAt, start.plusSeconds(5).toString)
    _ <- if (stage == "seal") IO.unit else repo.curation.seal(lease.fence, scope, id).void
    request <- if (stage == "seal") IO.pure(io.circe.Json.obj()) else repo.curation.frozen(settings.principal, scope, id).map(preparedRequest)
    body = payload(request)
    _ <- if (stage == "dispatch") repo.curation.appendAudit(lease.fence, scope, id, 1, CurationAuditStage.RequestPrepared, body.digest, Some(body)).void else IO.unit
    _ <- IO(clock.set(start.plusSeconds(5)))
    renewed <- repo.curation.renew(lease.fence)
    _ = assert(Instant.parse(renewed.expiresAt).isAfter(Instant.parse(attempt.claim.deadlineAt)))
    result <- stage match {
      case "seal" => repo.curation.seal(lease.fence, scope, id)
      case "prepare" => repo.curation.appendAudit(lease.fence, scope, id, 1, CurationAuditStage.RequestPrepared, body.digest, Some(body))
      case "dispatch" => repo.curation.appendAudit(lease.fence, scope, id, 1, CurationAuditStage.DispatchPossible, body.digest, None)
    }
    _ = assert(result.isInstanceOf[CurationWriteResult.Terminal])
    retained <- repo.curation.inspect(settings.principal, scope, id)
    _ = assertEquals(retained.attempt.terminalCode, Some("curation-expired"))
    _ = assertEquals(retained.journal.size, if (stage == "dispatch") 1 else 0)
    graph <- repo.read(scope)
    _ = assertEquals((graph.generation, graph.sourceFrontier, graph.coveredFrontier), (1L, 1L, 0L))
  } yield () } } }

  test("renewed ownership cannot publish at the attempt deadline") { bounded { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, Nil)
    _ <- observe(repo, scope, lease, value)
    _ <- IO(clock.set(Instant.parse(value.attempt.claim.deadlineAt)))
    _ <- repo.curation.renew(lease.fence)
    result <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    _ = assert(result.isInstanceOf[CurationWriteResult.Terminal])
    status <- repo.curation.status(settings.principal, scope)
    _ = assertEquals(status.failure, Some("curation-expired"))
    _ = assertEquals((status.frontier, status.coveredFrontier), (1L, 0L))
    unchanged <- repo.curation.claim(lease.fence, scope, UUID.randomUUID(), profile)
    _ = assert(unchanged.isInstanceOf[CurationClaimResult.Ineligible])
  } yield () } } }

  test("late response is retained and terminalized without publication") { bounded { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, Nil)
    _ <- IO(clock.set(Instant.parse(value.attempt.claim.deadlineAt)))
    _ <- repo.curation.renew(lease.fence)
    result <- repo.curation.appendAudit(lease.fence, scope, value.attempt.claim.attemptId, 1, CurationAuditStage.ResponseObserved, value.request.digest, Some(value.response))
    _ = assert(result.isInstanceOf[CurationWriteResult.Terminal])
    retained <- repo.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId)
    _ = assertEquals(retained.journal.last.stage, CurationAuditStage.ResponseObserved)
    _ = assertEquals(retained.attempt.terminalCode, Some("curation-expired"))
    _ = assert(!retained.attempt.auditUncertain)
    denied <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    _ = assertEquals(denied, result)
  } yield () } } }

  test("a valid publication remains readable after its deadline and lease expire") { bounded { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, Nil)
    _ <- observe(repo, scope, lease, value)
    _ <- IO(clock.set(Instant.parse(value.attempt.claim.deadlineAt).minusNanos(1)))
    result <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    receipt = published(result)
    _ <- IO(clock.set(start.plusSeconds(100)))
    old <- repo.input(scope, receipt.input)
    _ = assertEquals(old.generation, receipt.generation)
    replay <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    _ = assertEquals(replay, CurationWriteResult.Published(receipt, true))
  } yield () } } }

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
