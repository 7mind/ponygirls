package ontology

import cats.effect.{Deferred, IO, Ref as Cell, Resource}
import cats.syntax.all.*
import java.util.UUID
import ontology.api.*
import ontology.curation.*
import ontology.domain.*
import scala.concurrent.duration.*

abstract class ProjectionFactoryContract extends CurationRepositorySupport {
  private val closeBudget = 500.millis
  private final class Control(val state: Cell[IO, Option[CycleStop]], val closures: Cell[IO, List[CleanupObservation[Unit]]]) extends ProjectionResourceControl {
    def stopped: IO[Option[CycleStop]] = state.get
    def halt(reason: CycleStop): IO[Unit] = state.update(_.orElse(Some(reason)))
    def diagnosticFailure: IO[Unit] = state.set(Some(CycleStop.DiagnosticFailure))
    def resourceClosed(value: CleanupObservation[Unit]): IO[Unit] = closures.update(_ :+ value)
  }
  private def control: IO[Control] = (Cell.of[IO, Option[CycleStop]](None), Cell.of[IO, List[CleanupObservation[Unit]]](Nil)).mapN(new Control(_, _))
  private def settings(value: CurationStoreSettings): ProjectionSettings = ProjectionSettings(
    Principal("factory", Actor("factory", ActorKind.Service), value.scopes, Set(Capability.Read)), "factory", value.scopes, 1)
  private def factory(owner: ProjectionRepository, config: ProjectionSettings, incarnation: IO[UUID], log: Cell[IO, List[ProjectionEvent]], cleanup: CurationCleanup): RdfProjectionFactory =
    new RdfProjectionFactory(owner, config, RdfStorage.Memory, ProjectionResourceConfig(10, 2.seconds, closeBudget), ProjectionStepConfig(2.seconds),
      IO(UUID.randomUUID()), incarnation, IO(UUID.randomUUID()), new ProjectionDiagnostics { def emit(event: ProjectionEvent): IO[Unit] = log.update(_ :+ event) }, cleanup)

  test("factory exposes its actual RDF and records joined resource closure") { check { (repo, curation, scope) => leased(repo) { lease => for {
    cfg = settings(curation)
    gate <- control
    log <- Cell.of[IO, List[ProjectionEvent]](Nil)
    value = factory(repo.projections(cfg), cfg, IO(UUID.randomUUID()), log, new SupervisedCurationCleanup)
    _ <- value.open(lease.fence, gate).use { attached => for {
      result <- attached.step.advance
      observed <- attached.rdf.observe(cfg.scopes.toList.sorted.head)
      _ = assert(result.stopped.isEmpty)
      _ = assertEquals(observed.map(_.checkpoint.instance), Some(attached.rdf.instance))
    } yield () }
    closed <- gate.closures.get
    _ = assertEquals(closed, List(CleanupObservation.Observed(())))
  } yield () } } }
  test("uncertain session opening retries the same ID and instance once") { check { (repo, curation, scope) => leased(repo) { lease => for {
    cfg = settings(curation)
    actual = repo.projections(cfg)
    calls <- Cell.of[IO, List[(UUID, CoordinatorFence, ProjectionInstance)]](Nil)
    owner = new ProjectionRepositoryDelegate(actual) {
      override def open(id: UUID, fence: CoordinatorFence, instance: ProjectionInstance): IO[ProjectionSession] = calls.modify(values => (values :+ ((id, fence, instance)), values.isEmpty)).flatMap { first =>
        actual.open(id, fence, instance).flatMap(value => if (first) IO.raiseError(new java.io.IOException("controlled open acknowledgment loss")) else IO.pure(value))
      }
    }
    gate <- control
    log <- Cell.of[IO, List[ProjectionEvent]](Nil)
    _ <- factory(owner, cfg, IO(UUID.randomUUID()), log, new SupervisedCurationCleanup).open(lease.fence, gate).use(_.step.advance)
    recorded <- calls.get
    _ = assertEquals(recorded.size, 2)
    _ = assertEquals(recorded.distinct.size, 1)
    closed <- gate.closures.get
    _ = assertEquals(closed, List(CleanupObservation.Observed(())))
  } yield () } } }
  test("stop during allocation prevents session admission and still closes the acquired RDF") { check { (repo, curation, scope) => leased(repo) { lease => for {
    cfg = settings(curation)
    calls <- Cell.of[IO, Int](0)
    actual = repo.projections(cfg)
    owner = new ProjectionRepositoryDelegate(actual) { override def open(id: UUID, fence: CoordinatorFence, instance: ProjectionInstance): IO[ProjectionSession] = calls.update(_ + 1) *> actual.open(id, fence, instance) }
    gate <- control
    log <- Cell.of[IO, List[ProjectionEvent]](Nil)
    result <- factory(owner, cfg, gate.halt(CycleStop.OwnershipLost) *> IO(UUID.randomUUID()), log, new SupervisedCurationCleanup).open(lease.fence, gate).use(_ => IO.unit).attempt
    _ = assert(result.isLeft)
    count <- calls.get
    _ = assertEquals(count, 0)
    closed <- gate.closures.get
    _ = assertEquals(closed, List(CleanupObservation.Observed(())))
  } yield () } } }
  test("mismatched bootstrap response is rejected before attachment exposure") { check { (repo, curation, scope) => leased(repo) { lease => for {
    cfg = settings(curation)
    actual = repo.projections(cfg)
    owner = new ProjectionRepositoryDelegate(actual) {
      override def open(id: UUID, fence: CoordinatorFence, instance: ProjectionInstance): IO[ProjectionSession] = actual.open(id, fence, instance).map(value => value.copy(instance = instance.copy(incarnation = UUID.randomUUID())))
    }
    gate <- control
    log <- Cell.of[IO, List[ProjectionEvent]](Nil)
    result <- factory(owner, cfg, IO(UUID.randomUUID()), log, new SupervisedCurationCleanup).open(lease.fence, gate).use(_ => IO.raiseError[Unit](new AssertionError("invalid attachment exposed"))).attempt
    _ = assert(result.left.toOption.exists(_.isInstanceOf[Fault]))
    stopped <- gate.stopped
    _ = assertEquals(stopped, Some(CycleStop.ProjectionRejected))
    closed <- gate.closures.get
    _ = assertEquals(closed, List(CleanupObservation.Observed(())))
  } yield () } } }
  for (cancelled <- List(false, true)) test(s"close uncertainty remains recorded even when outer cancellation dominates: cancelled=$cancelled") { check { (repo, curation, scope) => leased(repo) { lease => for {
    cfg = settings(curation)
    gate <- control
    log <- Cell.of[IO, List[ProjectionEvent]](Nil)
    cleanup = new CurationCleanup {
      private val actual = new SupervisedCurationCleanup
      def observe[A](budget: FiniteDuration, work: IO[A], overdue: IO[Unit]): IO[CleanupObservation[A]] =
        if (budget == closeBudget) work.as(CleanupObservation.Uncertain: CleanupObservation[A]) else actual.observe(budget, work, overdue)
    }
    value = factory(repo.projections(cfg), cfg, IO(UUID.randomUUID()), log, cleanup)
    entered <- Deferred[IO, Unit]
    _ <- if (cancelled) Resource.make(value.open(lease.fence, gate).use(_ => entered.complete(()).void *> IO.never).start)(_.cancel).use { fiber =>
      entered.get.timeout(5.seconds) *> fiber.cancel *> fiber.join.void
    } else value.open(lease.fence, gate).use(_ => IO.unit).attempt.map(result => assert(result.isLeft))
    closed <- gate.closures.get
    stopped <- gate.stopped
    _ = assertEquals(closed, List(CleanupObservation.Uncertain))
    _ = assertEquals(stopped, Some(CycleStop.ProjectionUncertain))
  } yield () } } }
}
final class MemoryProjectionFactorySuite extends ProjectionFactoryContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresProjectionFactorySuite extends ProjectionFactoryContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
