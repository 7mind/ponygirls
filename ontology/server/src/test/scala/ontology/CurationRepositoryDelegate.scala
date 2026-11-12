package ontology

import cats.effect.IO
import java.util.UUID
import ontology.api.*

abstract class CurationRepositoryDelegate(delegate: CurationRepository) extends CurationRepository {
  def acquire(ownerId: UUID): IO[CoordinatorLease] = delegate.acquire(ownerId)
  def renew(fence: CoordinatorFence): IO[CoordinatorLease] = delegate.renew(fence)
  def release(fence: CoordinatorFence): IO[Unit] = delegate.release(fence)
  def eligibleScopes(fence: CoordinatorFence, limit: Int): IO[CurationScopeBatch] = delegate.eligibleScopes(fence, limit)
  def recoverOlderFences(fence: CoordinatorFence, limit: Int): IO[CurationRecoveryBatch] = delegate.recoverOlderFences(fence, limit)
  def claim(fence: CoordinatorFence, scope: String, attemptId: UUID, profile: CurationProfilePin): IO[CurationClaimResult] = delegate.claim(fence, scope, attemptId, profile)
  def seal(fence: CoordinatorFence, scope: String, attemptId: UUID): IO[CurationWriteResult] = delegate.seal(fence, scope, attemptId)
  def appendAudit(fence: CoordinatorFence, scope: String, attemptId: UUID, ordinal: Int, stage: CurationAuditStage, requestDigest: String,
    payload: Option[CurationAuditPayload]): IO[CurationWriteResult] = delegate.appendAudit(fence, scope, attemptId, ordinal, stage, requestDigest, payload)
  def publish(fence: CoordinatorFence, scope: String, attemptId: UUID, candidate: CurationCandidate, hostRequestId: UUID): IO[CurationWriteResult] =
    delegate.publish(fence, scope, attemptId, candidate, hostRequestId)
  def stop(fence: CoordinatorFence, scope: String, attemptId: UUID, reason: CurationStop): IO[CurationWriteResult] = delegate.stop(fence, scope, attemptId, reason)
  def inspect(principal: Principal, scope: String, attemptId: UUID): IO[CurationAttemptView] = delegate.inspect(principal, scope, attemptId)
  def frozen(principal: Principal, scope: String, attemptId: UUID): IO[CurationFrozenView] = delegate.frozen(principal, scope, attemptId)
  def status(principal: Principal, scope: String): IO[CurationStatus] = delegate.status(principal, scope)
}
