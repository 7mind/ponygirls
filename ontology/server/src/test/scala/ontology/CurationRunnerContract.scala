package ontology

import cats.effect.{Deferred, IO, Ref as Cell, Resource}
import cats.syntax.all.*
import java.util.UUID
import ontology.api.*
import ontology.curation.*
import ontology.domain.*
import scala.concurrent.duration.*

abstract class CurationRunnerContract extends CurationCoordinatorSupport {
  private val cycleConfig = CurationCycleConfig(2, 1, 100.millis)
  private val runConfig = CurationRunnerConfig(100.millis, 50.millis, 100.millis)
  private final class RunLog(val events: Cell[IO, List[RunnerEvent]]) extends CurationRunnerDiagnostics {
    def emit(event: RunnerEvent): IO[Unit] = events.update(_ :+ event)
  }
  private def runnerLog: IO[RunLog] = Cell.of[IO, List[RunnerEvent]](Nil).map(new RunLog(_))
  private def runner(owner: CurationRepository, repo: GraphRepository, settings: CurationStoreSettings, model: CuratorModel,
    cycleLog: CurationDiagnostics, log: CurationRunnerDiagnostics, ids: IO[UUID]): CurationRunner =
    new CurationRunner(owner, settings, cycleConfig, runConfig, ids,
      config => CurationCoordinator.create(owner, repo, settings.principal, model, new CursorSigner(Array.fill[Byte](32)(4)),
        QueryLimits(100, 64, 65536, 2048), config, IO(UUID.randomUUID()), cycleLog, new SupervisedCurationCleanup),
      new SupervisedCurationCleanup, log, TestProjectionRuntime.factory(repo, settings), TestProjectionRuntime.noServer)
  for (origin <- List("capture", "command")) test(s"automatic polling for $origin publishes once and shutdown releases ownership") { check { (repo, settings, scope) => for {
    _ <- if (origin == "command") mutate(repo, scope).void else capture(repo, scope).void
    calls <- Cell.of[IO, Int](0)
    renewals <- Cell.of[IO, Int](0)
    published <- Deferred[IO, Unit]
    renewed <- Deferred[IO, Unit]
    log <- runnerLog
    cycle = new CurationDiagnostics {
      def outcome(value: ScopeOutcome): IO[Unit] = value match {
        case _: ScopeOutcome.Published => published.complete(()).void
        case _ => IO.unit
      }
      def stopped(value: CycleStop): IO[Unit] = IO.unit
    }
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def renew(fence: CoordinatorFence): IO[CoordinatorLease] = repo.curation.renew(fence).flatTap(_ => renewals.update(_ + 1) *> renewed.complete(()).void)
    }
    service = runner(owner, repo, settings, controlled(calls, IO.unit), cycle, log, IO(UUID.randomUUID()))
    _ <- Resource.make(service.run.start)(_.cancel).use { fiber => for {
      _ <- published.get.timeout(5.seconds)
      _ <- renewed.get.timeout(5.seconds)
      _ <- IO.sleep(250.millis)
      count <- calls.get
      _ = assertEquals(count, 1)
      _ <- fiber.cancel
      previous <- renewals.get
      _ <- IO.sleep(150.millis)
      next <- renewals.get
      _ = assertEquals(next, previous)
    } yield () }
    _ <- leased(repo)(_ => IO.unit)
    graph <- repo.read(scope)
    _ = assertEquals((graph.sourceFrontier, graph.coveredFrontier), (1L, 1L))
  } yield () } }

  test("renewal remains owned while shutdown settles a held attempt") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    modelEntered <- Deferred[IO, Unit]
    cleanupEntered <- Deferred[IO, Unit]
    cleanupRelease <- Deferred[IO, Unit]
    renewedDuringCleanup <- Deferred[IO, Unit]
    phase <- Cell.of[IO, Boolean](false)
    log <- runnerLog
    cycle <- recorder
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def inspect(principal: Principal, name: String, id: UUID): IO[CurationAttemptView] = phase.set(true) *>
        cleanupEntered.complete(()).void *> IO.uncancelable(_ => cleanupRelease.get *> repo.curation.inspect(principal, name, id))
      override def renew(fence: CoordinatorFence): IO[CoordinatorLease] = repo.curation.renew(fence).flatTap(_ =>
        phase.get.flatMap(active => if (active) renewedDuringCleanup.complete(()).void else IO.unit))
    }
    service = runner(owner, repo, settings, controlled(calls, modelEntered.complete(()).void *> IO.never[Unit]), cycle, log, IO(UUID.randomUUID()))
    _ <- Resource.make(service.run.start)(fiber => cleanupRelease.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- modelEntered.get.timeout(5.seconds)
      cancellation <- fiber.cancel.start
      _ <- cleanupEntered.get.timeout(5.seconds)
      _ <- renewedDuringCleanup.get.timeout(5.seconds)
      _ <- cleanupRelease.complete(())
      _ <- cancellation.joinWithNever
    } yield () }
    actual <- repo.curation.status(settings.principal, scope)
    _ = assertEquals(actual.state, CurationState.Interrupted)
    _ = assert(actual.attempt.exists(_.auditUncertain))
    _ <- leased(repo)(_ => IO.unit)
  } yield () } }
  test("renewal loss cancels work before blocked diagnostics and admits no second scope") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    _ <- capture(repo, scope + "-other")
    calls <- Cell.of[IO, Int](0)
    modelEntered <- Deferred[IO, Unit]
    diagnosticEntered <- Deferred[IO, Unit]
    log <- runnerLog
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def renew(fence: CoordinatorFence): IO[CoordinatorLease] = modelEntered.get *> IO.raiseError(new java.io.IOException("controlled renewal failure"))
      override def inspect(principal: Principal, name: String, id: UUID): IO[CurationAttemptView] = diagnosticEntered.get *> repo.curation.inspect(principal, name, id)
    }
    cycle = new CurationDiagnostics {
      def outcome(value: ScopeOutcome): IO[Unit] = IO.unit
      def stopped(value: CycleStop): IO[Unit] = if (value == CycleStop.OwnershipLost) diagnosticEntered.complete(()).void *> IO.never[Unit] else IO.unit
    }
    service = runner(owner, repo, settings, controlled(calls, modelEntered.complete(()).void *> IO.never[Unit]), cycle, log, IO(UUID.randomUUID()))
    result <- service.run.timeout(5.seconds)
    _ = assertEquals(result.reason, CycleStop.OwnershipLost)
    _ = assertEquals(result.stopped, Some(CycleStop.OwnershipLost))
    actual <- repo.curation.status(settings.principal, scope)
    _ = assertEquals(actual.state, CurationState.Interrupted)
    other <- repo.curation.status(settings.principal, scope + "-other")
    _ = assertEquals(other.attempt, None)
    count <- calls.get
    _ = assertEquals(count, 1)
    _ <- leased(repo)(_ => IO.unit)
  } yield () } }

  test("lost claim acknowledgment releases ownership for later fenced recovery without model work") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    cycle <- recorder
    log <- runnerLog
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def claim(fence: CoordinatorFence, name: String, id: UUID, pin: CurationProfilePin): IO[CurationClaimResult] =
        repo.curation.claim(fence, name, id, pin) *> IO.raiseError(new java.io.IOException("controlled claim acknowledgment loss"))
    }
    service = runner(owner, repo, settings, controlled(calls, IO.unit), cycle, log, IO(UUID.randomUUID()))
    result <- service.run.timeout(5.seconds)
    _ = assertEquals(result.reason, CycleStop.ClaimUncertain)
    count <- calls.get
    _ = assertEquals(count, 0)
    _ <- leased(repo) { lease => repo.curation.recoverOlderFences(lease.fence, 1).map { recovered =>
      assertEquals(recovered.attempts.map(_.state), List(CurationAttemptState.Interrupted))
    } }
  } yield () } }
  for (diagnosticFailure <- List(false, true)) test(s"release acknowledgment loss preserves uncertainty and diagnostic failure=$diagnosticFailure") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    owners <- Cell.of[IO, Int](0)
    cycle <- recorder
    log <- runnerLog
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def recoverOlderFences(fence: CoordinatorFence, limit: Int): IO[CurationRecoveryBatch] = IO.raiseError(new java.io.IOException("controlled scan failure"))
      override def release(fence: CoordinatorFence): IO[Unit] = repo.curation.release(fence) *> IO.raiseError(new java.io.IOException("controlled release acknowledgment loss"))
    }
    diagnostics = new CurationRunnerDiagnostics {
      def emit(event: RunnerEvent): IO[Unit] = log.emit(event) *> (if (diagnosticFailure && event == RunnerEvent.CleanupUncertain(RunnerCleanupStage.Release))
        IO.raiseError(new java.io.IOException("controlled diagnostic failure")) else IO.unit)
    }
    service = runner(owner, repo, settings, controlled(calls, IO.unit), cycle, diagnostics, owners.update(_ + 1) *> IO(UUID.randomUUID()))
    result <- service.run.attempt
    _ = fault(result, "curation-release-uncertain")
    secondary = result.left.toOption.toList.flatMap(_.getSuppressed.toList.collect { case error: Fault => error.code })
    _ = assertEquals(secondary.contains("curation-diagnostic"), diagnosticFailure)
    events <- log.events.get
    _ = assert(events.contains(RunnerEvent.CleanupUncertain(RunnerCleanupStage.Release)))
    count <- owners.get
    _ = assertEquals(count, 1)
    _ <- leased(repo)(_ => IO.unit)
  } yield () } }

  test("overdue release and its diagnostic can both fail without losing either qualification") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    cycle <- recorder
    log <- runnerLog
    entered <- Deferred[IO, Unit]
    unblock <- Deferred[IO, Unit]
    reported <- Deferred[IO, Unit]
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def recoverOlderFences(fence: CoordinatorFence, limit: Int): IO[CurationRecoveryBatch] = IO.raiseError(new java.io.IOException("controlled scan failure"))
      override def release(fence: CoordinatorFence): IO[Unit] = entered.complete(()).void *> unblock.get *>
        repo.curation.release(fence) *> IO.raiseError(new java.io.IOException("controlled release acknowledgment loss"))
    }
    diagnostics = new CurationRunnerDiagnostics {
      def emit(event: RunnerEvent): IO[Unit] = log.emit(event) *> (if (event == RunnerEvent.CleanupOverBudget(RunnerCleanupStage.Release))
        reported.complete(()).void *> IO.raiseError(new java.io.IOException("controlled budget diagnostic failure")) else IO.unit)
    }
    service = runner(owner, repo, settings, controlled(calls, IO.unit), cycle, diagnostics, IO(UUID.randomUUID()))
    result <- Resource.make(service.run.attempt.start)(fiber => unblock.complete(()).void *> fiber.cancel).use { fiber =>
      entered.get *> reported.get.timeout(1.second) *> unblock.complete(()) *> fiber.joinWithNever
    }
    _ = fault(result, "curation-release-uncertain")
    secondary = result.left.toOption.toList.flatMap(_.getSuppressed.toList.collect { case error: Fault => error.code })
    _ = assert(secondary.contains("curation-diagnostic"))
    events <- log.events.get
    _ = assert(events.contains(RunnerEvent.CleanupUncertain(RunnerCleanupStage.Release)))
    _ <- leased(repo)(_ => IO.unit)
  } yield () } }

  test("acquisition failure retains a secondary diagnostic failure") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    cycle <- recorder
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def acquire(id: UUID): IO[CoordinatorLease] = IO.raiseError(Fault("coordinator", "controlled acquisition failure"))
    }
    diagnostics = new CurationRunnerDiagnostics {
      def emit(event: RunnerEvent): IO[Unit] = IO.raiseError(new java.io.IOException("controlled diagnostic failure"))
    }
    service = runner(owner, repo, settings, controlled(calls, IO.unit), cycle, diagnostics, IO(UUID.randomUUID()))
    result <- service.run.attempt
    _ = fault(result, "curation-acquire-uncertain")
    secondary = result.left.toOption.toList.flatMap(_.getSuppressed.toList.collect { case error: Fault => error.code })
    _ = assert(secondary.contains("curation-diagnostic"))
  } yield () } }

  test("invalid cadence and a stopped kernel reject before lease acquisition") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    acquisitions <- Cell.of[IO, Int](0)
    cycle <- recorder
    log <- runnerLog
    kernel <- coordinator(repo.curation, repo, settings, controlled(calls, IO.unit), cycle, IO(UUID.randomUUID()))
    _ <- kernel.stopAdmissions(CycleStop.Cancelled)
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def acquire(id: UUID): IO[CoordinatorLease] = acquisitions.update(_ + 1) *> repo.curation.acquire(id)
    }
    _ = assertEquals(intercept[Fault](new CurationRunner(owner, settings, cycleConfig,
      runConfig.copy(renewEvery = settings.leaseDuration.toNanos.nanos), IO(UUID.randomUUID()), _ => IO.pure(kernel), new SupervisedCurationCleanup, log, TestProjectionRuntime.factory(repo, settings), TestProjectionRuntime.noServer)).code, "config")
    service = new CurationRunner(owner, settings, cycleConfig, runConfig, IO(UUID.randomUUID()), _ => IO.pure(kernel), new SupervisedCurationCleanup, log, TestProjectionRuntime.factory(repo, settings), TestProjectionRuntime.noServer)
    result <- service.run.attempt
    _ = fault(result, "config")
    count <- acquisitions.get
    _ = assertEquals(count, 0)
  } yield () } }
}

final class MemoryCurationRunnerSuite extends CurationRunnerContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] =
    Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresCurationRunnerSuite extends CurationRunnerContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
