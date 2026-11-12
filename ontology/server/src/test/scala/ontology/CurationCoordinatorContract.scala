package ontology

import cats.effect.{IO, Ref as Cell, Resource}
import cats.syntax.all.*
import io.circe.Json
import java.util.UUID
import ontology.api.*
import ontology.curation.*
import ontology.domain.*
import scala.concurrent.duration.*

abstract class CurationCoordinatorSupport extends CurationRepositorySupport {
  protected final class Recorder(val outcomes: Cell[IO, List[ScopeOutcome]], val stops: Cell[IO, List[CycleStop]]) extends CurationDiagnostics {
    def outcome(value: ScopeOutcome): IO[Unit] = outcomes.update(_ :+ value)
    def stopped(value: CycleStop): IO[Unit] = stops.update(_ :+ value)
  }
  protected def recorder: IO[Recorder] = (Cell.of[IO, List[ScopeOutcome]](Nil), Cell.of[IO, List[CycleStop]](Nil)).mapN(new Recorder(_, _))
  protected def controlled(calls: Cell[IO, Int], beforeResponse: IO[Unit]): CuratorModel = new CuratorModel {
    val profile: CurationProfilePin = CurationCoordinatorSupport.this.profile
    def propose(input: CurationInput, reader: CurationReader, audit: CurationAudit): IO[AuditedProposal] = IO.defer {
      val request = Json.obj("messages" -> Json.arr(Json.obj("role" -> Json.fromString("system"), "content" -> Json.fromString("Controlled policy")),
        Json.obj("role" -> Json.fromString("user"), "content" -> Json.fromString(CurationInputs.json(input).noSpaces))))
      val proposal = CurationProposal(input.generation, input.frontier, Nil)
      val response = Json.obj("choices" -> Json.arr(Json.obj("finish_reason" -> Json.fromString("stop"), "message" -> Json.obj(
        "role" -> Json.fromString("assistant"), "content" -> Json.fromString(StoredJson.encode(CurationProposal.codecJson, proposal))))))
      calls.update(_ + 1) *> audit.request(1, request) *> audit.dispatchPossible(1) *> beforeResponse *>
        audit.response(1, response).as(AuditedProposal(proposal, 1, Digests.text(response.noSpaces)))
    }
  }
  protected def coordinator(owner: CurationRepository, repo: GraphRepository, settings: CurationStoreSettings, model: CuratorModel,
    diagnostics: CurationDiagnostics, ids: IO[UUID]): IO[CurationCoordinator] = CurationCoordinator.create(owner, repo, settings.principal, model,
    new CursorSigner(Array.fill[Byte](32)(3)), QueryLimits(100, 64, 65536, 2048), CurationCycleConfig(2, 1, 2.seconds), ids, diagnostics, new SupervisedCurationCleanup)

}

abstract class CurationCoordinatorContract extends CurationCoordinatorSupport {
  test("a cycle publishes once and does not invoke the model again for an unchanged frontier") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    log <- recorder
    worker <- coordinator(repo.curation, repo, settings, controlled(calls, IO.unit), log, IO(UUID.randomUUID()))
    first <- worker.cycle(lease.fence)
    _ = assertEquals(first.stopped, None)
    _ = assertEquals(first.outcomes.size, 1)
    _ = assert(first.outcomes.head.isInstanceOf[ScopeOutcome.Published])
    next <- worker.cycle(lease.fence)
    _ = assertEquals(next.outcomes, Nil)
    count <- calls.get
    _ = assertEquals(count, 1)
    graph <- repo.read(scope)
    _ = assertEquals((graph.generation, graph.sourceFrontier, graph.coveredFrontier), (2L, 1L, 1L))
    outcomes <- log.outcomes.get
    _ = assertEquals(outcomes, first.outcomes)
  } yield () } } }

  test("model failure records a terminal outcome and only new primary input permits another invocation") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    log <- recorder
    worker <- coordinator(repo.curation, repo, settings, controlled(calls, IO.raiseError(Fault("controlled-model", "fixture failure"))), log, IO(UUID.randomUUID()))
    failed <- worker.cycle(lease.fence)
    _ = assertEquals(failed.stopped, None)
    _ = assert(failed.outcomes.head.isInstanceOf[ScopeOutcome.Terminal])
    status <- repo.curation.status(settings.principal, scope)
    _ = assertEquals(status.failure, Some("controlled-model"))
    _ = assert(status.attempt.exists(_.auditUncertain))
    _ <- worker.cycle(lease.fence)
    firstCount <- calls.get
    _ = assertEquals(firstCount, 1)
    _ <- capture(repo, scope)
    _ <- worker.cycle(lease.fence)
    secondCount <- calls.get
    _ = assertEquals(secondCount, 2)
    graph <- repo.read(scope)
    _ = assertEquals(graph.coveredFrontier, 0L)
  } yield () } } }

  test("a replayed claim neither dispatches nor terminalizes the retained invocation") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    id = UUID.randomUUID()
    _ <- repo.curation.claim(lease.fence, scope, id, profile)
    calls <- Cell.of[IO, Int](0)
    log <- recorder
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def eligibleScopes(fence: CoordinatorFence, limit: Int): IO[CurationScopeBatch] = IO.pure(CurationScopeBatch(List(scope), false))
    }
    worker <- coordinator(owner, repo, settings, controlled(calls, IO.unit), log, IO.pure(id))
    result <- worker.cycle(lease.fence)
    _ = assertEquals(result.outcomes, List(ScopeOutcome.Replayed(scope, id)))
    count <- calls.get
    _ = assertEquals(count, 0)
    retained <- repo.curation.inspect(settings.principal, scope, id)
    _ = assertEquals(retained.attempt.state, CurationAttemptState.Claimed)
  } yield () } } }
  test("lost claim acknowledgment stops admissions and never starts the model") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    id = UUID.randomUUID()
    _ <- leased(repo) { lease => for {
      calls <- Cell.of[IO, Int](0)
      log <- recorder
      owner = new CurationRepositoryDelegate(repo.curation) {
        override def claim(fence: CoordinatorFence, name: String, attemptId: UUID, pin: CurationProfilePin): IO[CurationClaimResult] =
          repo.curation.claim(fence, name, attemptId, pin) *> IO.raiseError(new java.io.IOException("controlled claim acknowledgment discard"))
      }
      worker <- coordinator(owner, repo, settings, controlled(calls, IO.unit), log, IO.pure(id))
      result <- worker.cycle(lease.fence)
      _ = assertEquals(result.stopped, Some(CycleStop.ClaimUncertain))
      _ = assertEquals(result.outcomes, List(ScopeOutcome.Uncertain(scope, id)))
      _ <- worker.cycle(lease.fence)
      count <- calls.get
      _ = assertEquals(count, 0)
      retained <- repo.curation.inspect(settings.principal, scope, id)
      _ = assertEquals(retained.attempt.state, CurationAttemptState.Claimed)
    } yield () }
    _ <- leased(repo)(lease => repo.curation.recoverOlderFences(lease.fence, 1).map(result => assertEquals(result.attempts.map(_.state), List(CurationAttemptState.Interrupted))))
  } yield () } }

  for (committed <- List(false, true)) test(s"publication uncertainty reconciles without another model invocation with committed=$committed") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    publications <- Cell.of[IO, Int](0)
    log <- recorder
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def publish(fence: CoordinatorFence, name: String, id: UUID, candidate: CurationCandidate, hostId: UUID): IO[CurationWriteResult] =
        publications.updateAndGet(_ + 1).flatMap { count =>
          if (count == 1) (if (committed) repo.curation.publish(fence, name, id, candidate, hostId).void else IO.unit) *>
            IO.raiseError(new java.io.IOException("controlled publication acknowledgment failure"))
          else repo.curation.publish(fence, name, id, candidate, hostId)
        }
    }
    worker <- coordinator(owner, repo, settings, controlled(calls, IO.unit), log, IO(UUID.randomUUID()))
    result <- worker.cycle(lease.fence)
    _ = assertEquals(result.stopped, None)
    _ = assert(result.outcomes.head.isInstanceOf[ScopeOutcome.Published])
    count <- calls.get
    writes <- publications.get
    _ = assertEquals(count, 1)
    _ = assertEquals(writes, if (committed) 1 else 2)
    graph <- repo.read(scope)
    _ = assertEquals((graph.generation, graph.sourceFrontier, graph.coveredFrontier), (2L, 1L, 1L))
  } yield () } } }

  test("known earlier outcomes survive a later ID-source failure") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    _ <- capture(repo, scope + "-other")
    calls <- Cell.of[IO, Int](0)
    ids <- Cell.of[IO, Int](0)
    log <- recorder
    source = ids.updateAndGet(_ + 1).flatMap(count => if (count < 3) IO(UUID.randomUUID()) else IO.raiseError(new java.io.IOException("controlled ID failure")))
    worker <- coordinator(repo.curation, repo, settings, controlled(calls, IO.unit), log, source)
    result <- worker.cycle(lease.fence)
    _ = assertEquals(result.stopped, Some(CycleStop.StoreUncertain))
    _ = assert(result.recovery.nonEmpty && result.scan.nonEmpty)
    _ = assertEquals(result.outcomes.size, 1)
    _ = assert(result.outcomes.head.isInstanceOf[ScopeOutcome.Published])
    count <- calls.get
    _ = assertEquals(count, 1)
    untouched <- repo.curation.status(settings.principal, scope + "-other")
    _ = assertEquals(untouched.attempt, None)
  } yield () } } }
  test("stop admission during model work prevents publication and preserves a terminal outcome") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    writes <- Cell.of[IO, Int](0)
    entered <- cats.effect.Deferred[IO, Unit]
    release <- cats.effect.Deferred[IO, Unit]
    log <- recorder
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def publish(fence: CoordinatorFence, name: String, id: UUID, candidate: CurationCandidate, hostId: UUID): IO[CurationWriteResult] =
        writes.update(_ + 1) *> repo.curation.publish(fence, name, id, candidate, hostId)
    }
    worker <- coordinator(owner, repo, settings, controlled(calls, entered.complete(()).void *> release.get), log, IO(UUID.randomUUID()))
    result <- Resource.make(worker.cycle(lease.fence).start)(fiber => release.complete(()).void *> fiber.cancel).use { fiber =>
      entered.get *> worker.stopAdmissions(CycleStop.OwnershipLost) *> release.complete(()) *> fiber.joinWithNever
    }
    _ = assertEquals(result.stopped, Some(CycleStop.OwnershipLost))
    _ = assert(result.outcomes.head.isInstanceOf[ScopeOutcome.Terminal])
    count <- writes.get
    _ = assertEquals(count, 0)
    status <- repo.curation.status(settings.principal, scope)
    _ = assertEquals(status.state, CurationState.Interrupted)
    _ = assertEquals(status.coveredFrontier, 0L)
  } yield () } } }

  test("cancellation at the acknowledged-claim handoff settles the known claim before owned work starts") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    entered = new java.util.concurrent.CountDownLatch(1)
    unblock = new java.util.concurrent.CountDownLatch(1)
    log <- recorder
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def seal(fence: CoordinatorFence, name: String, id: UUID): IO[CurationWriteResult] = {
        // Pause effect assembly after the positive claim acknowledgment, before poll owns the returned effect.
        entered.countDown()
        Require(unblock.await(5, java.util.concurrent.TimeUnit.SECONDS), "fixture", "claim handoff barrier timed out")
        repo.curation.seal(fence, name, id)
      }
    }
    worker <- coordinator(owner, repo, settings, controlled(calls, IO.unit), log, IO(UUID.randomUUID()))
    _ <- Resource.make(worker.cycle(lease.fence).start)(fiber => IO(unblock.countDown()) *> fiber.cancel).use { fiber => for {
      acknowledged <- IO.blocking(entered.await(3, java.util.concurrent.TimeUnit.SECONDS))
      _ = assert(acknowledged, "fixture must reach owned assembly after claim acknowledgment")
      cancelling <- fiber.cancel.start
      _ <- IO.sleep(100.millis)
      _ <- IO(unblock.countDown())
      _ <- cancelling.joinWithNever
    } yield () }
    actual <- repo.curation.status(settings.principal, scope)
    _ = assertEquals(actual.attempt.map(_.state), Some(CurationAttemptState.Interrupted))
    _ = assertEquals(actual.failure, Some("coordinator-cancelled"))
    count <- calls.get
    _ = assertEquals(count, 0)
  } yield () } } }

  test("cancellation terminalizes only the positively claimed invocation") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    entered <- cats.effect.Deferred[IO, Unit]
    log <- recorder
    worker <- coordinator(repo.curation, repo, settings, controlled(calls, entered.complete(()).void *> IO.never[Unit]), log, IO(UUID.randomUUID()))
    fiber <- worker.cycle(lease.fence).start
    _ <- entered.get
    _ <- fiber.cancel
    status <- repo.curation.status(settings.principal, scope)
    _ = assertEquals(status.state, CurationState.Interrupted)
    _ = assert(status.attempt.exists(_.auditUncertain))
    stopped <- worker.stopped
    _ = assertEquals(stopped, Some(CycleStop.Cancelled))
    _ <- worker.cycle(lease.fence)
    count <- calls.get
    _ = assertEquals(count, 1)
  } yield () } } }

  test("bounded recovery defers new claims until older fences have been handled") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    _ <- capture(repo, scope + "-other")
    _ <- leased(repo)(lease => List(scope, scope + "-other").traverse_(name => repo.curation.claim(lease.fence, name, UUID.randomUUID(), profile)))
    _ <- leased(repo) { lease => for {
      calls <- Cell.of[IO, Int](0)
      log <- recorder
      worker <- coordinator(repo.curation, repo, settings, controlled(calls, IO.unit), log, IO(UUID.randomUUID()))
      first <- worker.cycle(lease.fence)
      _ = assert(first.recovery.exists(_.more))
      _ = assertEquals(first.scan, None)
      _ = assertEquals(first.outcomes, Nil)
      second <- worker.cycle(lease.fence)
      _ = assert(second.recovery.exists(value => !value.more))
      _ = assert(second.scan.exists(_.scopes.isEmpty))
      count <- calls.get
      _ = assertEquals(count, 0)
    } yield () }
  } yield () } }

  test("cleanup budget stops further claims but preserves the eventual observed terminal result") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    _ <- capture(repo, scope + "-other")
    calls <- Cell.of[IO, Int](0)
    entered <- cats.effect.Deferred[IO, Unit]
    unblock <- cats.effect.Deferred[IO, Unit]
    overdue <- cats.effect.Deferred[IO, Unit]
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def inspect(principal: Principal, name: String, id: UUID): IO[CurationAttemptView] =
        entered.complete(()).void *> IO.uncancelable(_ => unblock.get *> repo.curation.inspect(principal, name, id))
    }
    diagnostics = new CurationDiagnostics {
      def outcome(value: ScopeOutcome): IO[Unit] = IO.unit
      def stopped(value: CycleStop): IO[Unit] = if (value == CycleStop.CleanupOverBudget) overdue.complete(()).void else IO.unit
    }
    worker <- CurationCoordinator.create(owner, repo, settings.principal, controlled(calls, IO.raiseError(Fault("controlled-model", "fixture"))),
      new CursorSigner(Array.fill[Byte](32)(3)), QueryLimits(100, 64, 65536, 2048), CurationCycleConfig(2, 1, 50.millis), IO(UUID.randomUUID()), diagnostics, new SupervisedCurationCleanup)
    result <- Resource.make(worker.cycle(lease.fence).start)(fiber => unblock.complete(()).void *> fiber.cancel).use { fiber =>
      entered.get *> overdue.get.timeout(1.second) *> unblock.complete(()) *> fiber.joinWithNever
    }
    _ = assertEquals(result.stopped, Some(CycleStop.CleanupOverBudget))
    _ = assertEquals(result.outcomes.size, 1)
    _ = assert(result.outcomes.head.isInstanceOf[ScopeOutcome.Terminal])
    untouched <- repo.curation.status(settings.principal, scope + "-other")
    _ = assertEquals(untouched.attempt, None)
  } yield () } } }

  test("unavailable terminal recording is uncertain and stops further work") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    log <- recorder
    owner = new CurationRepositoryDelegate(repo.curation) {
      override def inspect(principal: Principal, name: String, id: UUID): IO[CurationAttemptView] = IO.raiseError(new java.io.IOException("controlled inspection failure"))
    }
    worker <- coordinator(owner, repo, settings, controlled(calls, IO.raiseError(Fault("controlled-model", "fixture"))), log, IO(UUID.randomUUID()))
    result <- worker.cycle(lease.fence)
    _ = assertEquals(result.stopped, Some(CycleStop.CleanupUncertain))
    _ = assert(result.outcomes.head.isInstanceOf[ScopeOutcome.Uncertain])
    actual <- repo.curation.status(settings.principal, scope)
    _ = assertEquals(actual.state, CurationState.Running)
    _ <- worker.cycle(lease.fence)
    count <- calls.get
    _ = assertEquals(count, 1)
  } yield () } } }

  test("diagnostic failure remains observable without erasing a committed result") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    _ <- capture(repo, scope + "-other")
    calls <- Cell.of[IO, Int](0)
    failing = new CurationDiagnostics {
      def outcome(value: ScopeOutcome): IO[Unit] = IO.raiseError(new java.io.IOException("controlled diagnostics failure"))
      def stopped(reason: CycleStop): IO[Unit] = IO.raiseError(new java.io.IOException("controlled diagnostics failure"))
    }
    worker <- coordinator(repo.curation, repo, settings, controlled(calls, IO.unit), failing, IO(UUID.randomUUID()))
    result <- worker.cycle(lease.fence)
    _ = assertEquals(result.stopped, Some(CycleStop.DiagnosticFailure))
    _ = assertEquals(result.outcomes.size, 1)
    _ = assert(result.outcomes.head.isInstanceOf[ScopeOutcome.Published])
    count <- calls.get
    _ = assertEquals(count, 1)
  } yield () } } }
}

final class MemoryCurationCoordinatorSuite extends CurationCoordinatorContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] =
    Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresCurationCoordinatorSuite extends CurationCoordinatorContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
