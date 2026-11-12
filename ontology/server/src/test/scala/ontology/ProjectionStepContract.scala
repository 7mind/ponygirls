package ontology

import cats.effect.{Deferred, IO, Ref as Cell, Resource}
import cats.syntax.all.*
import java.util.UUID
import ontology.api.*
import ontology.curation.*
import ontology.domain.*
import scala.concurrent.duration.*

abstract class ProjectionStepContract extends CurationRepositorySupport {
  private final class Control(val state: Cell[IO, Option[CycleStop]]) extends ProjectionControl {
    def stopped: IO[Option[CycleStop]] = state.get
    def halt(reason: CycleStop): IO[Unit] = state.update(_.orElse(Some(reason)))
    def diagnosticFailure: IO[Unit] = state.set(Some(CycleStop.DiagnosticFailure))
  }
  private final class Log(val events: Cell[IO, List[ProjectionEvent]]) extends ProjectionDiagnostics {
    def emit(event: ProjectionEvent): IO[Unit] = events.update(_ :+ event)
  }
  private final case class Fixture(owner: ProjectionRepository, rdf: RdfProjection, session: ProjectionSession, principal: Principal, control: Control, log: Log)
  private def fixture(repo: GraphRepository, settings: CurationStoreSettings, lease: CoordinatorLease, batch: Int): Resource[IO, Fixture] =
    RdfProjection.resource(RdfStorage.Memory, "step", 10, IO(UUID.randomUUID())).evalMap { rdf =>
      val principal = Principal("projector", Actor("projector", ActorKind.Service), settings.scopes, Set(Capability.Read))
      val owner = repo.projections(ProjectionSettings(principal, "step", settings.scopes, batch))
      for {
        session <- owner.open(UUID.randomUUID(), lease.fence, rdf.instance)
        state <- Cell.of[IO, Option[CycleStop]](None)
        events <- Cell.of[IO, List[ProjectionEvent]](Nil)
      } yield Fixture(owner, rdf, session, principal, new Control(state), new Log(events))
    }
  private def step(f: Fixture, owner: ProjectionRepository, rdf: RdfProjection, diagnostics: ProjectionDiagnostics): IO[ProjectionStep] =
    SerialProjectionStep.create(owner, f.principal, rdf, f.session, ProjectionStepConfig(2.seconds), IO(UUID.randomUUID()), f.control, diagnostics, new SupervisedCurationCleanup)

  test("bounded serial step preserves issued historical cuts and later projects pending commands") { check { (repo, settings, scope) =>
    capture(repo, scope) *> leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
      changed <- Cell.of[IO, Boolean](false)
      owner = new ProjectionRepositoryDelegate(f.owner) {
        override def reconcileHeads(id: UUID): IO[ProjectionWorkBatch] = f.owner.reconcileHeads(id).flatTap { _ =>
          changed.getAndSet(true).flatMap(previous => if (previous) IO.unit else mutate(repo, scope).void)
        }
      }
      worker <- step(f, owner, f.rdf, f.log)
      first <- worker.advance
      _ = assert(!first.reconciliationComplete && first.stopped.isEmpty)
      _ = assertEquals(first.outcomes.collect { case ProjectionOutcome.Confirmed(r, _) => r.input.observed.generation }, List(1L))
      second <- worker.advance
      _ = assert(!second.reconciliationComplete && second.outcomes.size == 1)
      third <- worker.advance
      _ = assert(third.reconciliationComplete && third.stopped.isEmpty)
      _ = assertEquals(third.outcomes.collect { case ProjectionOutcome.Confirmed(r, _) => r.input.observed.generation }, List(2L))
      graph <- repo.read(scope)
      _ = assertEquals((graph.generation, graph.sourceFrontier, graph.coveredFrontier), (2L, 2L, 0L))
    } yield () } }
  } }
  test("lost RDF publish return is reconciled by actual observation without another write") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    writes <- Cell.of[IO, Int](0)
    rdf = new RdfProjectionDelegate(f.rdf) {
      override def publish(graph: GraphSnapshot): IO[Long] = writes.update(_ + 1) *> f.rdf.publish(graph) *> IO.raiseError(new java.io.IOException("controlled returned-result loss"))
    }
    worker <- step(f, f.owner, rdf, f.log)
    report <- worker.advance
    count <- writes.get
    _ = assertEquals(count, 1)
    _ = assert(report.stopped.isEmpty && report.outcomes.head.isInstanceOf[ProjectionOutcome.Confirmed])
    stored <- f.owner.checkpoint(f.principal, f.rdf.instance, report.outcomes.collect { case ProjectionOutcome.Confirmed(r, _) => r.input.target.scope }.head)
    _ = assert(stored.nonEmpty)
  } yield () } } } }
  test("failed publish without a qualifying observation stays unacknowledged") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    rdf = new RdfProjectionDelegate(f.rdf) { override def publish(graph: GraphSnapshot): IO[Long] = IO.raiseError(new java.io.IOException("controlled pre-write failure")) }
    worker <- step(f, f.owner, rdf, f.log)
    report <- worker.advance
    _ = assertEquals(report.stopped, Some(CycleStop.ProjectionUncertain))
    _ = assert(!report.outcomes.exists(_.isInstanceOf[ProjectionOutcome.Confirmed]))
    stored <- f.owner.checkpoint(f.principal, f.rdf.instance, f.session.scopes.head)
    _ = assertEquals(stored, None)
  } yield () } } } }
  for (committed <- List(false, true)) test(s"ACK uncertainty preserves immutable request and observation: committed=$committed") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    calls <- Cell.of[IO, List[(ProjectionAckInput, ProjectionObservation)]](Nil)
    owner = new ProjectionRepositoryDelegate(f.owner) {
      override def acknowledge(input: ProjectionAckInput, observed: ProjectionObservation): IO[ProjectionAckResult] = calls.modify(values => (values :+ (input -> observed), values.isEmpty)).flatMap { first =>
        if (!first) f.owner.acknowledge(input, observed)
        else (if (committed) f.owner.acknowledge(input, observed).void else IO.unit) *> IO.raiseError(new java.io.IOException("controlled ACK response loss"))
      }
    }
    worker <- step(f, owner, f.rdf, f.log)
    report <- worker.advance
    recorded <- calls.get
    _ = assertEquals(recorded.size, if (committed) 1 else 2)
    _ = assertEquals(recorded.distinct.size, 1)
    _ = assert(report.stopped.isEmpty && report.outcomes.head.isInstanceOf[ProjectionOutcome.Confirmed])
    retained <- f.owner.receipt(f.principal, recorded.head._1.target.scope, f.session.id, recorded.head._1.requestId)
    _ = assert(retained.nonEmpty)
  } yield () } } } }
  test("a definite stale ACK re-observes once and uses a new immutable request") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    initial <- step(f, f.owner, f.rdf, f.log)
    _ <- initial.advance
    _ <- initial.advance
    ready <- initial.advance
    _ = assert(ready.reconciliationComplete)
    _ <- mutate(repo, scope)
    calls <- Cell.of[IO, List[ProjectionAckInput]](Nil)
    owner = new ProjectionRepositoryDelegate(f.owner) {
      override def acknowledge(input: ProjectionAckInput, observed: ProjectionObservation): IO[ProjectionAckResult] = calls.modify(values => (values :+ input, values.isEmpty)).flatMap { first =>
        val advance = if (!first) IO.unit else for {
          _ <- mutate(repo, scope)
          current <- repo.read(scope)
          _ <- f.rdf.publish(current)
          newer <- f.rdf.observe(scope).map(_.get)
          _ <- f.owner.acknowledge(ProjectionAckInput(f.session.id, UUID.randomUUID(), ProjectionProtocol.target(current, ProjectionTargetOrigin.Outbox), newer.checkpoint), newer)
        } yield ()
        advance *> f.owner.acknowledge(input, observed)
      }
    }
    observations <- Cell.of[IO, Int](0)
    rdf = new RdfProjectionDelegate(f.rdf) {
      override def observe(scope: String): IO[Option[ProjectionObservation]] = observations.update(_ + 1) *> f.rdf.observe(scope)
    }
    worker <- step(f, owner, rdf, f.log)
    report <- worker.advance
    recorded <- calls.get
    count <- observations.get
    _ = assertEquals(count, 2)
    _ = assertEquals(recorded.size, 2)
    _ = assert(recorded.head.requestId != recorded.last.requestId)
    _ = assertEquals(recorded.map(_.target).distinct.size, 1)
    _ = assertEquals(recorded.map(_.observed.generation), List(1L, 2L))
    _ = assert(report.stopped.isEmpty)
    _ = assertEquals(report.outcomes.collect { case ProjectionOutcome.Confirmed(r, _) => r.disposition }, List(ProjectionDisposition.SupersededByCheckpoint))
  } yield () } } } }

  test("a later failed item does not erase an earlier confirmed acknowledgment") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 2).use { f => for {
    calls <- Cell.of[IO, Int](0)
    rdf = new RdfProjectionDelegate(f.rdf) {
      override def publish(graph: GraphSnapshot): IO[Long] = calls.updateAndGet(_ + 1).flatMap(n => if (n == 1) f.rdf.publish(graph) else IO.raiseError(new java.io.IOException("controlled second write failure")))
    }
    worker <- step(f, f.owner, rdf, f.log)
    report <- worker.advance
    retained <- worker.report
    _ = assertEquals(retained, report)
    _ = assertEquals(report.outcomes.count(_.isInstanceOf[ProjectionOutcome.Confirmed]), 1)
    _ = assertEquals(report.outcomes.count(_.isInstanceOf[ProjectionOutcome.Unconfirmed]), 1)
    _ = assertEquals(report.stopped, Some(CycleStop.ProjectionUncertain))
  } yield () } } } }
  for (rejection <- List("scope", "identity", "reference")) test(s"known pre-write RDF rejection cannot acknowledge an existing image: $rejection") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    batch <- f.owner.reconcileHeads(f.session.id)
    _ <- f.rdf.publish(batch.work.head.snapshot)
    rdf = new RdfProjectionDelegate(f.rdf) { override def publish(graph: GraphSnapshot): IO[Long] = IO.raiseError(Fault(rejection, "controlled validation rejection")) }
    worker <- step(f, f.owner, rdf, f.log)
    result <- worker.advance
    _ = assertEquals(result.stopped, Some(CycleStop.ProjectionRejected))
    _ = assert(!result.outcomes.exists(_.isInstanceOf[ProjectionOutcome.Confirmed]))
    checkpoint <- f.owner.checkpoint(f.principal, f.rdf.instance, batch.work.head.target.scope)
    _ = assertEquals(checkpoint, None)
  } yield () } } } }

  for (committedAck <- List(false, true)) test(s"cancelled reports retain admitted work and reconcile a committed ACK: committedAck=$committedAck") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    entered <- Deferred[IO, Unit]
    release <- Deferred[IO, Unit]
    owner = new ProjectionRepositoryDelegate(f.owner) {
      override def acknowledge(input: ProjectionAckInput, observed: ProjectionObservation): IO[ProjectionAckResult] = f.owner.acknowledge(input, observed).flatTap(_ =>
        if (committedAck) entered.complete(()).void *> release.get else IO.unit)
    }
    rdf = new RdfProjectionDelegate(f.rdf) {
      override def publish(graph: GraphSnapshot): IO[Long] =
        (if (!committedAck) entered.complete(()).void *> release.get else IO.unit) *> f.rdf.publish(graph)
    }
    worker <- step(f, owner, rdf, f.log)
    _ <- Resource.make(worker.advance.start)(fiber => release.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- entered.get.timeout(5.seconds)
      _ <- fiber.cancel
      result <- worker.report
      _ = assertEquals(result.stopped, Some(CycleStop.Cancelled))
      _ = assert(result.outcomes.nonEmpty, "admitted operation vanished from cancellation report")
      _ = assertEquals(result.outcomes.count(_.isInstanceOf[ProjectionOutcome.Confirmed]), if (committedAck) 1 else 0)
    } yield () }
  } yield () } } } }

  test("cancelled unresolved ACK retains its immutable descriptor and later advance cannot erase it") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    entered <- Deferred[IO, Unit]
    release <- Deferred[IO, Unit]
    saved <- Cell.of[IO, Option[PendingProjectionAck]](None)
    owner = new ProjectionRepositoryDelegate(f.owner) {
      override def acknowledge(input: ProjectionAckInput, observed: ProjectionObservation): IO[ProjectionAckResult] =
        saved.set(Some(PendingProjectionAck(input, observed))) *> entered.complete(()).void *> release.get *> f.owner.acknowledge(input, observed)
    }
    worker <- step(f, owner, f.rdf, f.log)
    _ <- Resource.make(worker.advance.start)(fiber => release.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- entered.get.timeout(5.seconds)
      _ <- fiber.cancel
      descriptor <- saved.get
      report <- worker.report
      again <- worker.advance
      _ = assertEquals(report.pending.flatMap(_.acknowledgment), descriptor)
      _ = assertEquals(again, report)
      _ = assertEquals(report.stopped, Some(CycleStop.Cancelled))
    } yield () }
  } yield () } } } }

  test("unconfirmed outcome is retained before the stop signal can cancel diagnostics") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    halted <- Deferred[IO, Unit]
    release <- Deferred[IO, Unit]
    control = new ProjectionControl {
      def stopped: IO[Option[CycleStop]] = f.control.stopped
      def diagnosticFailure: IO[Unit] = f.control.diagnosticFailure
      def halt(reason: CycleStop): IO[Unit] = f.control.halt(reason) *> halted.complete(()).void *> release.get
    }
    rdf = new RdfProjectionDelegate(f.rdf) { override def publish(graph: GraphSnapshot): IO[Long] = IO.raiseError(new java.io.IOException("controlled failure")) }
    worker <- SerialProjectionStep.create(f.owner, f.principal, rdf, f.session, ProjectionStepConfig(2.seconds), IO(UUID.randomUUID()), control, f.log, new SupervisedCurationCleanup)
    _ <- Resource.make(worker.advance.start)(fiber => release.complete(()).void *> fiber.cancel).use { _ => for {
      _ <- halted.get.timeout(5.seconds)
      report <- worker.report
      _ = assert(report.outcomes.nonEmpty, "stop signal preceded retained failure evidence")
    } yield () }
  } yield () } } } }

  for (failure <- List("id", "ack", "receipt")) test(s"post-publication failure retains its target and actual stage: $failure") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    owner = new ProjectionRepositoryDelegate(f.owner) {
      override def acknowledge(input: ProjectionAckInput, observed: ProjectionObservation): IO[ProjectionAckResult] = f.owner.acknowledge(input, observed).flatMap { value =>
        if (failure == "receipt") IO.raiseError(new java.io.IOException("controlled returned ACK loss"))
        else if (failure == "ack") IO.pure(value.copy(receipt = value.receipt.copy(input = input.copy(requestId = UUID.randomUUID()))))
        else IO.pure(value)
      }
      override def receipt(principal: Principal, scope: String, sessionId: UUID, requestId: UUID): IO[Option[ProjectionAckReceipt]] =
        f.owner.receipt(principal, scope, sessionId, requestId).map(_.map(value => if (failure == "receipt") value.copy(input = value.input.copy(requestId = UUID.randomUUID())) else value))
    }
    ids = if (failure == "id") IO.raiseError[UUID](new java.io.IOException("controlled ID allocation failure")) else IO(UUID.randomUUID())
    worker <- SerialProjectionStep.create(owner, f.principal, f.rdf, f.session, ProjectionStepConfig(2.seconds), ids, f.control, f.log, new SupervisedCurationCleanup)
    result <- worker.advance
    failed = result.outcomes.collect { case value: ProjectionOutcome.Unconfirmed => value }.last
    _ = assertEquals(failed.target.map(_.scope), Some(f.session.scopes.head))
    _ = assertEquals(failed.stage, if (failure == "receipt") ProjectionStage.Receipt else ProjectionStage.Acknowledge)
    actual <- f.rdf.observe(f.session.scopes.head)
    _ = assert(actual.nonEmpty)
  } yield () } } } }

  test("overdue publish is joined and diagnostic failure does not become a false ACK") { check { (repo, settings, scope) => leased(repo) { lease => fixture(repo, settings, lease, 1).use { f => for {
    entered <- Deferred[IO, Unit]
    release <- Deferred[IO, Unit]
    overdue <- Deferred[IO, Unit]
    rdf = new RdfProjectionDelegate(f.rdf) {
      override def publish(graph: GraphSnapshot): IO[Long] = entered.complete(()).void *> release.get *> f.rdf.publish(graph)
    }
    diagnostics = new ProjectionDiagnostics {
      def emit(event: ProjectionEvent): IO[Unit] = event match {
        case ProjectionEvent.OverBudget(ProjectionStage.Publish) => overdue.complete(()).void *> IO.raiseError(new java.io.IOException("controlled diagnostic failure"))
        case _ => f.log.emit(event)
      }
    }
    worker <- step(f, f.owner, rdf, diagnostics)
    _ <- Resource.make(worker.advance.start)(fiber => release.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- entered.get.timeout(5.seconds)
      _ <- overdue.get.timeout(5.seconds)
      _ <- release.complete(())
      report <- fiber.joinWithNever
      _ = assertEquals(report.stopped, Some(CycleStop.DiagnosticFailure))
      _ = assert(!report.outcomes.exists(_.isInstanceOf[ProjectionOutcome.Confirmed]))
      actual <- f.rdf.observe(f.session.scopes.head)
      stored <- f.owner.checkpoint(f.principal, f.rdf.instance, f.session.scopes.head)
      _ = assert(actual.nonEmpty)
      _ = assertEquals(stored, None)
    } yield () }
  } yield () } } } }
}
final class MemoryProjectionStepSuite extends ProjectionStepContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresProjectionStepSuite extends ProjectionStepContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
