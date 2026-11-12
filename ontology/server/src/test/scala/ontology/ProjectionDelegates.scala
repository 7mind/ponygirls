package ontology

import cats.effect.IO
import java.util.UUID
import ontology.api.*
import ontology.domain.*

class ProjectionRepositoryDelegate(underlying: ProjectionRepository) extends ProjectionRepository {
  def open(id: UUID, fence: CoordinatorFence, instance: ProjectionInstance): IO[ProjectionSession] = underlying.open(id, fence, instance)
  def reconcileHeads(sessionId: UUID): IO[ProjectionWorkBatch] = underlying.reconcileHeads(sessionId)
  def pending(sessionId: UUID): IO[ProjectionWorkBatch] = underlying.pending(sessionId)
  def acknowledge(input: ProjectionAckInput, observation: ProjectionObservation): IO[ProjectionAckResult] = underlying.acknowledge(input, observation)
  def receipt(principal: Principal, scope: String, sessionId: UUID, requestId: UUID): IO[Option[ProjectionAckReceipt]] = underlying.receipt(principal, scope, sessionId, requestId)
  def checkpoint(principal: Principal, instance: ProjectionInstance, scope: String): IO[Option[ProjectionCheckpoint]] = underlying.checkpoint(principal, instance, scope)
}
class RdfProjectionDelegate(underlying: RdfProjection) extends RdfProjection {
  def instance: ProjectionInstance = underlying.instance
  def observe(scope: String): IO[Option[ProjectionObservation]] = underlying.observe(scope)
  def publish(snapshot: GraphSnapshot): IO[Long] = underlying.publish(snapshot)
  def snapshot(scope: String, expectedGeneration: Long): IO[GraphSnapshot] = underlying.snapshot(scope, expectedGeneration)
  def subjects(scope: String, expectedGeneration: Long, predicate: String, target: Ref): IO[List[Ref]] = underlying.subjects(scope, expectedGeneration, predicate, target)
}
