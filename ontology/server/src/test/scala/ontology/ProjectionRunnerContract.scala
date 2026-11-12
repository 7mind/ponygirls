package ontology

import cats.effect.{Deferred, IO, Ref as Cell, Resource}
import cats.syntax.all.*
import java.util.UUID
import ontology.api.*
import ontology.curation.*
import ontology.domain.*
import scala.concurrent.duration.*

abstract class ProjectionRunnerContract extends CurationCoordinatorSupport {
  private val cycleConfig = CurationCycleConfig(2, 1, 100.millis)
  private val runConfig = CurationRunnerConfig(100.millis, 50.millis, 100.millis)
  private def runner(owner: CurationRepository, repo: GraphRepository, settings: CurationStoreSettings, model: CuratorModel,
    factory: ProjectionFactory, child: ProjectionAttachment => Resource[IO, Unit], lifecycle: CurationRunnerDiagnostics): CurationRunner =
    new CurationRunner(owner, settings, cycleConfig, runConfig, IO(UUID.randomUUID()), config =>
      CurationCoordinator.create(owner, repo, settings.principal, model, new CursorSigner(Array.fill[Byte](32)(4)), QueryLimits(100, 64, 65536, 2048),
        config, IO(UUID.randomUUID()), new CurationDiagnostics {
          def outcome(value: ScopeOutcome): IO[Unit] = IO.unit
          def stopped(reason: CycleStop): IO[Unit] = IO.unit
        }, new SupervisedCurationCleanup), new SupervisedCurationCleanup, lifecycle, factory, child)
  private val closeBudget = 200.millis
  private def projectionSettings(settings: CurationStoreSettings): ProjectionSettings = ProjectionSettings(
    Principal("runner-projector", Actor("runner-projector", ActorKind.Service), settings.scopes, Set(Capability.Read)), "runner-projection", settings.scopes, 1)
  private def projection(owner: ProjectionRepository, settings: ProjectionSettings, cleanup: CurationCleanup): ProjectionFactory =
    new RdfProjectionFactory(owner, settings, RdfStorage.Memory, ProjectionResourceConfig(10, 5.seconds, closeBudget), ProjectionStepConfig(5.seconds),
      IO(UUID.randomUUID()), IO(UUID.randomUUID()), IO(UUID.randomUUID()), new ProjectionDiagnostics { def emit(event: ProjectionEvent): IO[Unit] = IO.unit }, cleanup)
  private def recordClose(factory: ProjectionFactory, record: CleanupObservation[Unit] => IO[Unit]): ProjectionFactory = new ProjectionFactory {
    def open(fence: CoordinatorFence, control: ProjectionResourceControl): Resource[IO, ProjectionAttachment] = factory.open(fence, new ProjectionResourceControl {
      def stopped: IO[Option[CycleStop]] = control.stopped
      def halt(reason: CycleStop): IO[Unit] = control.halt(reason)
      def diagnosticFailure: IO[Unit] = control.diagnosticFailure
      def resourceClosed(value: CleanupObservation[Unit]): IO[Unit] = control.resourceClosed(value) *> record(value)
    })
  }
  test("renewal starts during session bootstrap and all head batches precede model work") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    heads <- Cell.of[IO, Int](0)
    bootstrap <- Deferred[IO, Unit]
    release <- Deferred[IO, Unit]
    renewed <- Deferred[IO, Unit]
    modelEntered <- Deferred[IO, Unit]
    childEntered <- Cell.of[IO, Boolean](false)
    ready <- Deferred[IO, Unit]
    cfg = projectionSettings(settings)
    actual = repo.projections(cfg)
    projected = new ProjectionRepositoryDelegate(actual) {
      override def open(id: UUID, fence: CoordinatorFence, instance: ProjectionInstance): IO[ProjectionSession] = bootstrap.complete(()).void *> release.get *> actual.open(id, fence, instance)
      override def acknowledge(input: ProjectionAckInput, observation: ProjectionObservation): IO[ProjectionAckResult] = actual.acknowledge(input, observation).flatTap(_ =>
        if (input.target.origin == ProjectionTargetOrigin.Head) heads.update(_ + 1) else IO.unit)
    }
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def renew(fence: CoordinatorFence): IO[CoordinatorLease] = bootstrap.get *> repo.curation.renew(fence).flatTap(_ => renewed.complete(()).void)
    }
    lifecycle = new CurationRunnerDiagnostics {
      def emit(event: RunnerEvent): IO[Unit] = event match {
        case _: RunnerEvent.ResourcesReady => childEntered.get.flatMap(value => IO(assert(value))) *> ready.complete(()).void
        case _ => IO.unit
      }
    }
    model = controlled(calls, heads.get.flatMap(value => IO(assertEquals(value, settings.scopes.size))) *> modelEntered.complete(()).void *> IO.never)
    child = (_: ProjectionAttachment) => Resource.eval(childEntered.set(true))
    service = runner(owner, repo, settings, model, projection(projected, cfg, new SupervisedCurationCleanup), child, lifecycle)
    _ <- Resource.make(service.run.start)(fiber => release.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- bootstrap.get.timeout(5.seconds)
      _ <- renewed.get.timeout(5.seconds)
      before <- calls.get
      exposed <- childEntered.get
      _ = assertEquals(before, 0)
      _ = assert(!exposed)
      _ <- release.complete(())
      _ <- ready.get.timeout(5.seconds)
      _ <- modelEntered.get.timeout(5.seconds)
      _ <- fiber.cancel
    } yield () }
  } yield () } }
  test("ownership loss during held bootstrap closes RDF without exposing child or model") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    childCalls <- Cell.of[IO, Int](0)
    entered <- Deferred[IO, Unit]
    closed <- Deferred[IO, CleanupObservation[Unit]]
    cfg = projectionSettings(settings)
    actual = repo.projections(cfg)
    projected = new ProjectionRepositoryDelegate(actual) {
      override def open(id: UUID, fence: CoordinatorFence, instance: ProjectionInstance): IO[ProjectionSession] = entered.complete(()).void *> IO.never
    }
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def renew(fence: CoordinatorFence): IO[CoordinatorLease] = entered.get *> IO.raiseError(new java.io.IOException("controlled bootstrap ownership loss"))
    }
    factory = recordClose(projection(projected, cfg, new SupervisedCurationCleanup), value => closed.complete(value).void)
    service = runner(owner, repo, settings, controlled(calls, IO.unit), factory, _ => Resource.eval(childCalls.update(_ + 1)),
      new CurationRunnerDiagnostics { def emit(event: RunnerEvent): IO[Unit] = IO.unit })
    result <- service.run.timeout(5.seconds)
    closure <- closed.get
    invoked <- calls.get
    exposed <- childCalls.get
    _ = assertEquals(result.reason, CycleStop.OwnershipLost)
    _ = assertEquals(closure, CleanupObservation.Observed(()))
    _ = assertEquals((invoked, exposed), (0, 0))
    _ <- leased(repo)(_ => IO.unit)
  } yield () } }
  test("renewal continues through overdue RDF close and release follows closure") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    ready <- Deferred[IO, Unit]
    closeEntered <- Deferred[IO, Unit]
    releaseClose <- Deferred[IO, Unit]
    closeDone <- Deferred[IO, CleanupObservation[Unit]]
    renewed <- Deferred[IO, Unit]
    overdue <- Deferred[IO, Unit]
    releases <- Cell.of[IO, Int](0)
    cfg = projectionSettings(settings)
    cleanup = new CurationCleanup {
      private val actual = new SupervisedCurationCleanup
      def observe[A](budget: FiniteDuration, work: IO[A], over: IO[Unit]): IO[CleanupObservation[A]] =
        actual.observe(budget, if (budget == closeBudget) closeEntered.complete(()).void *> releaseClose.get *> work else work, over)
    }
    factory = recordClose(projection(repo.projections(cfg), cfg, cleanup), value => closeDone.complete(value).void)
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def renew(fence: CoordinatorFence): IO[CoordinatorLease] = repo.curation.renew(fence).flatTap(_ => closeEntered.tryGet.flatMap {
        case Some(_) => renewed.complete(()).void
        case None => IO.unit
      })
      override def release(fence: CoordinatorFence): IO[Unit] = closeDone.tryGet.flatMap(value => IO(assertEquals(value, Some(CleanupObservation.Observed(()))))) *> releases.update(_ + 1) *> repo.curation.release(fence)
    }
    log = new CurationRunnerDiagnostics {
      def emit(event: RunnerEvent): IO[Unit] = event match {
        case _: RunnerEvent.ResourcesReady => ready.complete(()).void
        case RunnerEvent.CleanupOverBudget(RunnerCleanupStage.Work) => overdue.complete(()).void
        case _ => IO.unit
      }
    }
    service = runner(owner, repo, settings, controlled(calls, IO.unit), factory, TestProjectionRuntime.noServer, log)
    _ <- Resource.make(service.run.start)(fiber => releaseClose.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- ready.get.timeout(5.seconds)
      _ <- Resource.make(fiber.cancel.start)(cancel => releaseClose.complete(()).void *> cancel.joinWithNever).use { cancel => for {
        _ <- closeEntered.get.timeout(5.seconds)
        _ <- renewed.get.timeout(5.seconds)
        _ <- overdue.get.timeout(5.seconds)
        before <- releases.get
        _ = assertEquals(before, 0)
        _ <- releaseClose.complete(())
        _ <- cancel.joinWithNever
      } yield () }
    } yield () }
    count <- releases.get
    _ = assertEquals(count, 1)
  } yield () } }

  test("before and after phases project command and curator cuts without primary feedback") { check { (repo, settings, scope) => for {
    _ <- mutate(repo, scope)
    calls <- Cell.of[IO, Int](0)
    published <- Deferred[IO, Unit]
    attached <- Cell.of[IO, Option[RdfProjection]](None)
    cfg = projectionSettings(settings)
    actual = repo.projections(cfg)
    owner = new ProjectionRepositoryDelegate(actual) {
      override def acknowledge(input: ProjectionAckInput, observation: ProjectionObservation): IO[ProjectionAckResult] = actual.acknowledge(input, observation).flatTap(_ =>
        if (input.target.scope == scope && input.observed.generation == 2L) published.complete(()).void else IO.unit)
    }
    child = (value: ProjectionAttachment) => Resource.make(attached.set(Some(value.rdf)))(_ => attached.set(None))
    service = runner(repo.curation, repo, settings, controlled(calls, IO.unit), projection(owner, cfg, new SupervisedCurationCleanup), child,
      new CurationRunnerDiagnostics { def emit(event: RunnerEvent): IO[Unit] = IO.unit })
    _ <- Resource.make(service.run.start)(_.cancel).use { fiber => for {
      _ <- published.get.timeout(5.seconds)
      rdf <- attached.get.map(_.get)
      graph <- repo.read(scope)
      observed <- rdf.observe(scope).map(_.get)
      invoked <- calls.get
      _ = assertEquals(observed.snapshot, graph)
      _ = assertEquals((graph.generation, graph.sourceFrontier, graph.coveredFrontier), (2L, 1L, 1L))
      _ = assertEquals(invoked, 1)
      _ <- fiber.cancel
    } yield () }
    after <- attached.get
    _ = assertEquals(after, None)
  } yield () } }

  test("successful RDF close with failed diagnostics is not downgraded to cleanup uncertainty") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    ready <- Deferred[IO, Unit]
    overdue <- Deferred[IO, Unit]
    releaseClose <- Deferred[IO, Unit]
    closed <- Deferred[IO, CleanupObservation[Unit]]
    events <- Cell.of[IO, List[RunnerEvent]](Nil)
    cfg = projectionSettings(settings)
    cleanup = new CurationCleanup {
      private val actual = new SupervisedCurationCleanup
      def observe[A](budget: FiniteDuration, work: IO[A], over: IO[Unit]): IO[CleanupObservation[A]] =
        actual.observe(budget, if (budget == closeBudget) releaseClose.get *> work else work, over)
    }
    projectionLog = new ProjectionDiagnostics {
      def emit(event: ProjectionEvent): IO[Unit] = event match {
        case ProjectionEvent.OverBudget(ProjectionStage.RdfClose) => overdue.complete(()).void *> IO.raiseError(new java.io.IOException("controlled close diagnostic failure"))
        case _ => IO.unit
      }
    }
    actualFactory = new RdfProjectionFactory(repo.projections(cfg), cfg, RdfStorage.Memory, ProjectionResourceConfig(10, 5.seconds, closeBudget), ProjectionStepConfig(5.seconds),
      IO(UUID.randomUUID()), IO(UUID.randomUUID()), IO(UUID.randomUUID()), projectionLog, cleanup)
    factory = recordClose(actualFactory, value => closed.complete(value).void)
    log = new CurationRunnerDiagnostics {
      def emit(event: RunnerEvent): IO[Unit] = events.update(_ :+ event) *> (event match {
        case _: RunnerEvent.ResourcesReady => ready.complete(()).void
        case _ => IO.unit
      })
    }
    service = runner(repo.curation, repo, settings, controlled(calls, IO.unit), factory, TestProjectionRuntime.noServer, log)
    _ <- Resource.make(service.run.start)(fiber => releaseClose.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- ready.get.timeout(5.seconds)
      _ <- Resource.make(fiber.cancel.start)(cancel => releaseClose.complete(()).void *> cancel.joinWithNever).use { cancel =>
        overdue.get.timeout(5.seconds) *> releaseClose.complete(()).void *> cancel.joinWithNever
      }
    } yield () }
    evidence <- closed.get
    observed <- events.get
    _ = assertEquals(evidence, CleanupObservation.ObservedDiagnosticFailure(()))
    _ = assert(!observed.contains(RunnerEvent.CleanupUncertain(RunnerCleanupStage.Work)), "known RDF close was converted to uncertainty")
    _ = assert(observed.contains(RunnerEvent.CleanupDiagnosticFailure(RunnerCleanupStage.Work)))
  } yield () } }

  for (childFails <- List(false, true)) test(s"readiness diagnostic qualification survives child cleanup: childFails=$childFails") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    closed <- Deferred[IO, CleanupObservation[Unit]]
    events <- Cell.of[IO, List[RunnerEvent]](Nil)
    factory = recordClose(TestProjectionRuntime.factory(repo, settings), value => closed.complete(value).void)
    log = new CurationRunnerDiagnostics {
      def emit(event: RunnerEvent): IO[Unit] = event match {
        case _: RunnerEvent.ResourcesReady => IO.raiseError(new java.io.IOException("controlled readiness diagnostic failure"))
        case other => events.update(_ :+ other)
      }
    }
    child = (_: ProjectionAttachment) => Resource.make(IO.unit)(_ => if (childFails) IO.raiseError[Unit](new java.io.IOException("controlled child finalizer failure")) else IO.unit)
    service = runner(repo.curation, repo, settings, controlled(calls, IO.unit), factory, child, log)
    result <- service.run.attempt
    evidence <- closed.get
    observed <- events.get
    _ = assertEquals(evidence, CleanupObservation.Observed(()))
    _ = if (childFails) {
      fault(result, "curation-work-uncertain")
      assert(result.swap.toOption.get.getSuppressed.exists { case f: Fault => f.code == "curation-diagnostic"; case _ => false }, "readiness diagnostic qualification disappeared")
    } else {
      assert(!observed.contains(RunnerEvent.CleanupUncertain(RunnerCleanupStage.Work)), "reporting failure was reclassified as uncertain cleanup")
      result match {
        case Right(value) => assertEquals(value.stopped, Some(CycleStop.DiagnosticFailure))
        case Left(value: Fault) => assertEquals(value.code, "curation-diagnostic")
        case Left(value) => fail(value.getClass.getName)
      }
    }
  } yield () } }

  test("external cancellation retains RDF close uncertainty even with a canceled worker outcome") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    ready <- Deferred[IO, Unit]
    events <- Cell.of[IO, List[RunnerEvent]](Nil)
    closed <- Deferred[IO, CleanupObservation[Unit]]
    cfg = projectionSettings(settings)
    cleanup = new CurationCleanup {
      private val actual = new SupervisedCurationCleanup
      def observe[A](budget: FiniteDuration, work: IO[A], overdue: IO[Unit]): IO[CleanupObservation[A]] =
        if (budget == closeBudget) work.as(CleanupObservation.Uncertain: CleanupObservation[A]) else actual.observe(budget, work, overdue)
    }
    factory = recordClose(projection(repo.projections(cfg), cfg, cleanup), value => closed.complete(value).void)
    diagnostics = new CurationRunnerDiagnostics {
      def emit(event: RunnerEvent): IO[Unit] = events.update(_ :+ event) *> (event match {
        case _: RunnerEvent.ResourcesReady => ready.complete(()).void
        case _ => IO.unit
      })
    }
    service = runner(repo.curation, repo, settings, controlled(calls, IO.unit), factory, TestProjectionRuntime.noServer, diagnostics)
    _ <- Resource.make(service.run.start)(_.cancel).use { fiber => ready.get.timeout(5.seconds) *> fiber.cancel *> fiber.join.void }
    evidence <- closed.get
    observed <- events.get
    _ = assertEquals(evidence, CleanupObservation.Uncertain)
    _ = assert(observed.contains(RunnerEvent.CleanupUncertain(RunnerCleanupStage.Work)))
    _ <- leased(repo)(_ => IO.unit)
  } yield () } }

  for (kind <- List("uncertain", "child")) test(s"combined cleanup and diagnostic failure retains both qualifications: $kind") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    closed <- Deferred[IO, CleanupObservation[Unit]]
    cfg = projectionSettings(settings)
    cleanup = new CurationCleanup {
      private val actual = new SupervisedCurationCleanup
      def observe[A](budget: FiniteDuration, work: IO[A], over: IO[Unit]): IO[CleanupObservation[A]] =
        if (budget != closeBudget) actual.observe(budget, work, over)
        else work.map(value => if (kind == "child") CleanupObservation.ObservedDiagnosticFailure(value) else CleanupObservation.UncertainDiagnosticFailure)
    }
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def claim(fence: CoordinatorFence, name: String, id: UUID, pin: CurationProfilePin): IO[CurationClaimResult] =
        IO.raiseError(new java.io.IOException("controlled stop before model"))
    }
    factory = recordClose(projection(repo.projections(cfg), cfg, cleanup), value => closed.complete(value).void)
    child = (_: ProjectionAttachment) => Resource.make(IO.unit)(_ =>
      if (kind == "child") IO.raiseError(new java.io.IOException("controlled child close failure")) else IO.unit)
    service = runner(owner, repo, settings, controlled(calls, IO.unit), factory, child,
      new CurationRunnerDiagnostics { def emit(event: RunnerEvent): IO[Unit] = IO.unit })
    result <- service.run.attempt
    _ = fault(result, "curation-work-uncertain")
    error = result.swap.toOption.get
    _ = assert(error.getSuppressed.exists { case f: Fault => f.code == "curation-diagnostic"; case _ => false }, "secondary diagnostic failure disappeared")
    evidence <- closed.get
    _ = assertEquals(evidence, if (kind == "child") CleanupObservation.ObservedDiagnosticFailure(()) else CleanupObservation.UncertainDiagnosticFailure)
  } yield () } }

  test("external cancellation cannot hide child-resource finalizer failure") { check { (repo, settings, scope) => for {
    calls <- Cell.of[IO, Int](0)
    entered <- Deferred[IO, Unit]
    events <- Cell.of[IO, List[RunnerEvent]](Nil)
    diagnostics = new CurationRunnerDiagnostics { def emit(event: RunnerEvent): IO[Unit] = events.update(_ :+ event) }
    child = (_: ProjectionAttachment) => Resource.make(entered.complete(()).void)(_ => IO.raiseError[Unit](new java.io.IOException("controlled child finalizer failure")))
    service = runner(repo.curation, repo, settings, controlled(calls, IO.unit), TestProjectionRuntime.factory(repo, settings), child, diagnostics)
    _ <- Resource.make(service.run.start)(_.cancel).use { fiber => entered.get.timeout(5.seconds) *> fiber.cancel *> fiber.join.void }
    observed <- events.get
    _ = assert(observed.contains(RunnerEvent.CleanupUncertain(RunnerCleanupStage.Work)), "child finalizer failure disappeared from owned cleanup evidence")
    _ <- leased(repo)(_ => IO.unit)
  } yield () } }
}
final class MemoryProjectionRunnerSuite extends ProjectionRunnerContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresProjectionRunnerSuite extends ProjectionRunnerContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
