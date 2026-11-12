package ontology

import cats.effect.IO
import java.time.Instant
import java.util.UUID
import ontology.api.*
import ontology.domain.*

final case class ProjectionSettings(principal: Principal, targetId: String, scopes: Set[String], batchLimit: Int) {
  Require(principal.actor.kind == ActorKind.Service && principal.actor.id.trim.nonEmpty && scopes.nonEmpty && batchLimit > 0 && batchLimit < Int.MaxValue,
    "config", "configured projection service scopes and batch limit required")
  try ProjectionProtocol.targetId(targetId) catch { case _: Fault => throw Fault("config", "invalid configured projection target") }
  scopes.foreach(principal.require(_, Capability.Read))
}
final case class ProjectionWork(target: ProjectionTarget, snapshot: GraphSnapshot)
final case class ProjectionWorkBatch(session: ProjectionSession, work: List[ProjectionWork], reconciliationComplete: Boolean)
final case class ProjectionAckResult(receipt: ProjectionAckReceipt, replayed: Boolean)
trait ProjectionRepository {
  def open(id: UUID, fence: CoordinatorFence, instance: ProjectionInstance): IO[ProjectionSession]
  def reconcileHeads(sessionId: UUID): IO[ProjectionWorkBatch]
  def pending(sessionId: UUID): IO[ProjectionWorkBatch]
  def acknowledge(input: ProjectionAckInput, observation: ProjectionObservation): IO[ProjectionAckResult]
  def receipt(principal: Principal, scope: String, sessionId: UUID, requestId: UUID): IO[Option[ProjectionAckReceipt]]
  def checkpoint(principal: Principal, instance: ProjectionInstance, scope: String): IO[Option[ProjectionCheckpoint]]
}
private[ontology] final case class ProjectionSessionRow(session: ProjectionSession, progress: ProjectionProgress)
private[ontology] trait ProjectionTransactions {
  def run[A](body: ProjectionTransaction => A): IO[A]
}
private[ontology] trait ProjectionTransaction {
  def now: Instant
  def coordinator: CoordinatorState
  def lock(scope: String): Unit
  def head(scope: String): GraphSnapshot
  def history(scope: String, generation: Long): GraphSnapshot
  def session(id: UUID): Option[ProjectionSessionRow]
  def acquisition(instance: ProjectionInstance, fence: CoordinatorFence): Option[ProjectionSessionRow]
  def insertSession(row: ProjectionSessionRow): Unit
  def saveProgress(sessionId: UUID, progress: ProjectionProgress): Unit
  def acknowledgment(sessionId: UUID, requestId: UUID): Option[ProjectionAckReceipt]
  def headAcknowledgments(sessionId: UUID): List[ProjectionAckReceipt]
  def accepted(instance: ProjectionInstance, scope: String): List[ProjectionAckReceipt]
  def insertAcknowledgment(receipt: ProjectionAckReceipt): Unit
  def checkpoint(instance: ProjectionInstance, scope: String): Option[ProjectionCheckpointWitness]
  def saveCheckpoint(value: ProjectionCheckpointWitness): Unit
  def outbox(scope: String, afterGeneration: Long, limit: Int): List[Long]
  def containsOutbox(scope: String, generation: Long): Boolean
}
