package ontology

import cats.effect.IO
import java.time.{Duration, Instant}
import java.util.UUID
import ontology.api.*
import ontology.domain.*

final case class CurationStoreSettings(principal: Principal, service: Actor, scopes: Set[String], leaseDuration: Duration, attemptDuration: Duration,
  guards: CurationGuardLimits, maxScanScopes: Int, maxRecoveryAttempts: Int) {
  Require(principal.actor.kind == ActorKind.Agent && principal.actor.id.trim.nonEmpty && service.kind == ActorKind.Service && service.id.trim.nonEmpty,
    "config", "curator Agent and service identity required")
  Require(scopes.nonEmpty && scopes.forall(_.trim.nonEmpty), "config", "explicit curation scopes required")
  Require(!leaseDuration.isZero && !leaseDuration.isNegative && !attemptDuration.isZero && !attemptDuration.isNegative && maxScanScopes > 0 && maxRecoveryAttempts > 0, "config", "positive curation lease and capacities required")
  scopes.foreach { scope => principal.require(scope, Capability.Read); principal.require(scope, Capability.Mutate) }
}
final case class CurationProfilePin(id: String, profileDigest: String, schemaDigest: String)
enum CurationClaimResult {
  case Claimed(attempt: CurationAttempt)
  case Replayed(attempt: CurationAttempt)
  case Ineligible(status: CurationStatus)
}
enum CurationWriteResult {
  case Advanced(attempt: CurationAttempt, replayed: Boolean)
  case Terminal(attempt: CurationAttempt)
  case Published(receipt: CurationPublicationReceipt, replayed: Boolean)
}
enum CurationStop {
  case Failed(code: String)
  case Interrupted(code: String)
}
final case class CurationAttemptView(attempt: CurationAttempt, journal: List[CurationAuditRecord])
final case class CurationFrozenView(claim: CurationClaim, snapshot: GraphSnapshot, material: SealedCurationInput)
final case class CurationScopeBatch(scopes: List[String], more: Boolean)
final case class CurationRecoveryBatch(attempts: List[CurationAttemptSummary], more: Boolean)
trait CurationAuditWriter {
  def appendAudit(fence: CoordinatorFence, scope: String, attemptId: UUID, ordinal: Int, stage: CurationAuditStage,
                  requestDigest: String, payload: Option[CurationAuditPayload]): IO[CurationWriteResult]
}
trait CurationRepository extends CurationAuditWriter {
  def acquire(ownerId: UUID): IO[CoordinatorLease]
  def renew(fence: CoordinatorFence): IO[CoordinatorLease]
  def release(fence: CoordinatorFence): IO[Unit]
  def eligibleScopes(fence: CoordinatorFence, limit: Int): IO[CurationScopeBatch]
  def recoverOlderFences(fence: CoordinatorFence, limit: Int): IO[CurationRecoveryBatch]
  def claim(fence: CoordinatorFence, scope: String, attemptId: UUID, profile: CurationProfilePin): IO[CurationClaimResult]
  def seal(fence: CoordinatorFence, scope: String, attemptId: UUID): IO[CurationWriteResult]
  def publish(fence: CoordinatorFence, scope: String, attemptId: UUID, candidate: CurationCandidate, hostRequestId: UUID): IO[CurationWriteResult]
  def stop(fence: CoordinatorFence, scope: String, attemptId: UUID, reason: CurationStop): IO[CurationWriteResult]
  def inspect(principal: Principal, scope: String, attemptId: UUID): IO[CurationAttemptView]
  def frozen(principal: Principal, scope: String, attemptId: UUID): IO[CurationFrozenView]
  def status(principal: Principal, scope: String): IO[CurationStatus]
}

private[ontology] final case class CoordinatorState(epoch: Long, lease: Option[CoordinatorLease])
private[ontology] trait CurationTransactions {
  def run[A](body: CurationTransaction => A): IO[A]
}
private[ontology] trait CurationEvidence {
  def history(scope: String, generation: Long): GraphSnapshot
  def sources(graph: GraphSnapshot, after: Long): List[CapturedEvent]
  def input(scope: String, ref: Ref): InputReceipt
  def reviewEvidence(graph: GraphSnapshot, request: ApplyRequest): List[ReviewEvidence]
  def publications(scope: String, throughGeneration: Long): List[CurationAttemptView]
}
private[ontology] trait CurationReadTransactions {
  def run[A](scope: String)(body: CurationReadContext => A): IO[A]
}
private[ontology] trait CurationReadContext extends CurationEvidence {
  def head(scope: String): GraphSnapshot
  def find(scope: String, id: UUID): Option[CurationAttemptView]
  def latest(scope: String, publishedOnly: Boolean): Option[CurationAttemptView]
}
private[ontology] trait CurationTransaction extends CurationReadContext {
  def now: Instant
  def coordinator: CoordinatorState
  def saveCoordinator(value: CoordinatorState): Unit
  def lock(scope: String): Unit
  def containsAttempt(id: UUID): Boolean
  def olderActive(scopes: Set[String], fence: CoordinatorFence, limit: Int): List[CurationAttemptView]
  def saveAttempt(value: CurationAttempt, insert: Boolean): Unit
  def append(entry: CurationAuditRecord): Unit
  def savePublication(before: GraphSnapshot, value: PublishedCuration): Unit
}
