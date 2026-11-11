package ontology.curation

import cats.effect.{IO, Ref as Cell}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import java.util.UUID
import ontology.*
import ontology.api.*
import ontology.domain.*

final class CurationCoordinator private (repo: CurationRepository, inputs: GraphReadRepository, principal: Principal,
  model: CuratorModel, cursors: CursorSigner, queries: QueryLimits, config: CurationCycleConfig, ids: IO[UUID],
  diagnostics: CurationDiagnostics, cleanup: CurationCleanup, serial: Semaphore[IO], stop: Cell[IO, Option[CycleStop]],
  progress: Cell[IO, CurationCoordinator.Progress]) {
  import CurationCoordinator.*
  private def check(value: Boolean): Unit = Require(value, "coordinator-result", "coordinator acknowledgment mismatch")
  def stopped: IO[Option[CycleStop]] = stop.get
  def stopAdmissions(reason: CycleStop): IO[Unit] = stop.update(_.orElse(Some(reason))) *>
    diagnostics.stopped(reason).handleErrorWith(_ => stop.set(Some(CycleStop.DiagnosticFailure)))
  private def accepting: IO[Unit] = stop.get.flatMap(value => IO(Require(value.isEmpty, "coordinator-stopped", "admissions stopped")))
  private def note(value: ScopeOutcome): IO[Unit] = diagnostics.outcome(value).handleErrorWith(_ => stopAdmissions(CycleStop.DiagnosticFailure))
  private def published(a: CurationAttempt, r: CurationPublicationReceipt): ScopeOutcome = {
    val c = a.claim
    check(r.attemptId == c.attemptId && r.scope == c.scope && r.generation == Math.addExact(c.baseGeneration, 1L) &&
      r.frontier == c.frontier && r.coveredFrontier == c.frontier && r.input == CurationIdentity.input(c.scope, c.attemptId))
    ScopeOutcome.Published(r)
  }
  private def ended(a: CurationAttempt): ScopeOutcome = {
    check(!CurationGuards.active(a.state))
    if (a.state == CurationAttemptState.Published) published(a, a.publication.getOrElse(throw Fault("coordinator-result", "publication missing")))
    else ScopeOutcome.Terminal(a.claim.scope, a.claim.attemptId, a.state, a.terminalCode)
  }
  private def inspect(a: CurationAttempt): IO[CurationAttempt] = repo.inspect(principal, a.claim.scope, a.claim.attemptId).map { view =>
    check(view.attempt.claim == a.claim)
    view.attempt
  }
  private def result(a: CurationAttempt, value: CurationWriteResult): ScopeOutcome = value match {
    case CurationWriteResult.Published(receipt, _) => published(a, receipt)
    case CurationWriteResult.Terminal(found) => check(found.claim == a.claim); ended(found)
    case _: CurationWriteResult.Advanced => throw Fault("coordinator-result", "unexpected active publication acknowledgment")
  }
  private def observe(a: CurationAttempt, work: IO[ScopeOutcome], failure: CycleStop): IO[ScopeOutcome] =
    cleanup.observe(config.cleanupBudget, work, stopAdmissions(CycleStop.CleanupOverBudget)).attempt.flatMap {
      case Right(CleanupObservation.Observed(value)) => IO.pure(value)
      case _ => stopAdmissions(failure).as(ScopeOutcome.Uncertain(a.claim.scope, a.claim.attemptId))
    }
  private def settle(a: CurationAttempt, reason: CurationStop): IO[ScopeOutcome] = inspect(a).flatMap { found =>
    if (!CurationGuards.active(found.state)) IO(ended(found))
    else repo.stop(a.claim.fence, a.claim.scope, a.claim.attemptId, reason).attempt.flatMap {
      case Right(value) => IO(result(a, value))
      case Left(_) => inspect(a).flatMap(last => IO(ended(last)))
    }
  }
  private def commit(a: CurationAttempt, candidate: CurationCandidate, hostId: UUID): IO[ScopeOutcome] = {
    val send = accepting *> IO.defer(repo.publish(a.claim.fence, a.claim.scope, a.claim.attemptId, candidate, hostId))
    def retained: IO[ScopeOutcome] = inspect(a).flatMap { value => IO {
      check(!CurationGuards.active(value.state))
      if (value.state == CurationAttemptState.Published) check(value.candidate.contains(candidate))
      ended(value)
    } }
    send.attempt.flatMap {
      case Right(value) => IO(result(a, value))
      case Left(fault: Fault) if fault.code == "coordinator-stopped" => IO.raiseError(fault)
      case Left(_) =>
        val reconcile = inspect(a).flatMap { value =>
          if (!CurationGuards.active(value.state)) IO {
            if (value.state == CurationAttemptState.Published) check(value.candidate.contains(candidate))
            ended(value)
          }
          else send.flatMap(value => IO(result(a, value))).handleErrorWith(_ => retained)
        }
        observe(a, reconcile, CycleStop.PublicationUncertain)
    }
  }
  private def failureCode(error: Throwable): String = error match {
    case fault: Fault if fault.code.matches("[a-z][a-z0-9-]{0,63}") => fault.code
    case _ => "curator-invocation-failed"
  }
  private def owned(a: CurationAttempt): IO[ScopeOutcome] = {
    val work = repo.seal(a.claim.fence, a.claim.scope, a.claim.attemptId).flatMap {
      case CurationWriteResult.Advanced(sealedAttempt, false) => for {
        _ <- IO(check(sealedAttempt.claim == a.claim && sealedAttempt.state == CurationAttemptState.InputSealed))
        frozen <- repo.frozen(principal, a.claim.scope, a.claim.attemptId)
        _ <- IO {
          check(frozen.claim == a.claim && sealedAttempt.inputManifest.contains(frozen.material.manifest))
          check(model.profile == CurationProfilePin(a.claim.profileId, a.claim.profileDigest, a.claim.schemaDigest))
        }
        reader <- IO(new FrozenCurationReader(frozen, inputs, principal, cursors, queries))
        audit <- RepositoryCurationAudit.create(repo, frozen)
        _ <- accepting
        proposal <- IO.defer(model.propose(frozen.material.input, reader, audit))
        candidate = CurationCandidate(a.claim.attemptId, frozen.material.manifest.inputDigest, proposal.responseOrdinal, proposal.responseDigest,
          proposal.proposal, Digests.text(Wire.encode(CurationProposal.codecJson, proposal.proposal).noSpaces))
        hostId <- ids
        outcome <- commit(a, candidate, hostId)
      } yield outcome
      case CurationWriteResult.Advanced(found, true) => IO {
        check(found.claim == a.claim)
        ScopeOutcome.Replayed(a.claim.scope, a.claim.attemptId)
      }
      case other => IO(result(a, other))
    }
    work.handleErrorWith(error => stop.get.flatMap { reason =>
      val terminal = if (reason.nonEmpty) CurationStop.Interrupted("coordinator-stopped") else CurationStop.Failed(failureCode(error))
      observe(a, settle(a, terminal), CycleStop.CleanupUncertain)
    })
  }
  private def cancelOwned(a: CurationAttempt): IO[Unit] = stopAdmissions(CycleStop.Cancelled) *>
    observe(a, settle(a, CurationStop.Interrupted("coordinator-cancelled")), CycleStop.CleanupUncertain).flatMap(note)
  private def one(fence: CoordinatorFence, scope: String): IO[ScopeOutcome] = IO.uncancelable { poll =>
    poll(ids).flatMap { id => stop.get.flatMap {
      case Some(_) => IO.pure(ScopeOutcome.NotStarted(scope))
      case None =>
        val pin = model.profile
        principal.require(scope, Capability.Read)
        principal.require(scope, Capability.Mutate)
        poll(IO.defer(repo.claim(fence, scope, id, pin))).onCancel(stopAdmissions(CycleStop.ClaimUncertain)).attempt.flatMap {
          case Left(_) => stopAdmissions(CycleStop.ClaimUncertain).as(ScopeOutcome.Uncertain(scope, id))
          case Right(CurationClaimResult.Ineligible(status)) => IO { check(status.scope == scope); ScopeOutcome.Ineligible(scope) }
          case Right(CurationClaimResult.Replayed(a)) => IO {
            check(a.claim.scope == scope && a.claim.attemptId == id && a.claim.fence == fence)
            ScopeOutcome.Replayed(scope, id)
          }
          case Right(CurationClaimResult.Claimed(a)) =>
            val matching = a.claim.scope == scope && a.claim.attemptId == id && a.claim.fence == fence && a.state == CurationAttemptState.Claimed &&
              CurationProfilePin(a.claim.profileId, a.claim.profileDigest, a.claim.schemaDigest) == pin
            if (!matching) stopAdmissions(CycleStop.ClaimUncertain).as(ScopeOutcome.Uncertain(scope, id))
            else poll(owned(a)).onCancel(cancelOwned(a))
        }
    } }
  }
  def cycle(fence: CoordinatorFence): IO[CycleReport] = serial.permit.use { _ =>
    def report: IO[CycleReport] = (progress.get, stop.get).mapN((p, stopped) => CycleReport(p.recovery, p.scan, p.outcomes, stopped))
    val work = stop.get.flatMap {
      case Some(_) => report
      case None => repo.recoverOlderFences(fence, config.recoveryLimit).flatMap { recovered =>
        progress.update(_.copy(recovery = Some(recovered))) *>
          (if (recovered.more) report else repo.eligibleScopes(fence, config.scanLimit).flatMap { scanned =>
            progress.update(_.copy(scan = Some(scanned))) *> scanned.scopes.sorted.traverse_ { scope => stop.get.flatMap {
              case Some(_) => IO.unit
              case None => one(fence, scope).flatMap(value => progress.update(p => p.copy(outcomes = p.outcomes :+ value)) *> note(value))
            } } *> report
          })
      }
    }
    (progress.set(Progress(None, None, Nil)) *> work).handleErrorWith(_ => stopAdmissions(CycleStop.StoreUncertain) *> report)
      .onCancel(stopAdmissions(CycleStop.Cancelled))
  }
}
object CurationCoordinator {
  private final case class Progress(recovery: Option[CurationRecoveryBatch], scan: Option[CurationScopeBatch], outcomes: List[ScopeOutcome])
  def create(repo: CurationRepository, inputs: GraphReadRepository, principal: Principal, model: CuratorModel,
             cursors: CursorSigner, queries: QueryLimits, config: CurationCycleConfig, ids: IO[UUID],
             diagnostics: CurationDiagnostics, cleanup: CurationCleanup): IO[CurationCoordinator] = for {
    _ <- IO(Require(principal.actor.kind == ActorKind.Agent, "config", "curation coordinator requires a configured Agent"))
    serial <- Semaphore[IO](1)
    stopped <- Cell.of[IO, Option[CycleStop]](None)
    progress <- Cell.of[IO, Progress](Progress(None, None, Nil))
  } yield new CurationCoordinator(repo, inputs, principal, model, cursors, queries, config, ids, diagnostics, cleanup, serial, stopped, progress)
}
