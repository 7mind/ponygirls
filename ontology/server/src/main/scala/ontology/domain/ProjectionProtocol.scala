package ontology.domain

import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import ontology.{Digests, StoredJson}
import ontology.api.*

final case class ProjectionReconciliation(acknowledged: Int, remaining: List[ProjectionTarget], complete: Boolean)

object ProjectionProtocol {
  private def label(value: String): Unit = Require(value.trim.nonEmpty && value.length <= Contexts.MaximumTextLength && UTF_8.newEncoder().canEncode(value),
    "corrupt", "invalid projection label")
  private def time(value: String): Instant = try Instant.parse(value) catch {
    case _: java.time.format.DateTimeParseException => throw Fault("corrupt", "invalid projection timestamp")
  }
  def targetId(value: String): Unit = label(value)
  def instance(value: ProjectionInstance): Unit = targetId(value.targetId)
  def session(value: ProjectionSession): Unit = {
    instance(value.instance); label(value.actor.id)
    Require(value.actor.kind == ActorKind.Service && value.fence.epoch > 0 && value.batchLimit > 0 && value.batchLimit < Int.MaxValue &&
      value.scopes.nonEmpty && value.scopes == value.scopes.distinct.sorted, "corrupt", "invalid projection session")
    value.scopes.foreach(label)
    time(value.openedAt)
    ()
  }
  def target(value: ProjectionTarget): Unit = {
    label(value.scope)
    Require(value.generation >= 0 && value.digest.matches("[0-9a-f]{64}") &&
      (value.origin != ProjectionTargetOrigin.Outbox || value.generation > 0), "corrupt", "invalid projection target")
  }
  def target(snapshot: GraphSnapshot, origin: ProjectionTargetOrigin): ProjectionTarget = {
    Graph.validateCounters(snapshot)
    val value = ProjectionTarget(snapshot.scope, snapshot.generation, Digests.text(StoredJson.encode(GraphSnapshot.codecJson, snapshot)), origin)
    target(value)
    value
  }
  def receipt(owner: ProjectionSession, value: ProjectionAckReceipt): Unit = {
    session(owner)
    val input = value.input; val observed = input.observed
    target(input.target); instance(observed.instance)
    Require(input.sessionId == owner.id && owner.scopes.contains(input.target.scope) && observed.instance == owner.instance &&
      observed.scope == input.target.scope && observed.generation >= input.target.generation && observed.digest.matches("[0-9a-f]{64}") &&
      !time(value.recordedAt).isBefore(time(owner.openedAt)), "corrupt", "projection acknowledgment differs from session or target")
    val disposition = if (observed.generation == input.target.generation) ProjectionDisposition.ExactCheckpoint else ProjectionDisposition.SupersededByCheckpoint
    Require(value.disposition == disposition && (disposition != ProjectionDisposition.ExactCheckpoint || observed.digest == input.target.digest),
      "corrupt", "projection acknowledgment disposition or exact digest differs")
  }
  def reconciliation(owner: ProjectionSession, value: ProjectionProgress, acknowledgments: List[ProjectionAckReceipt]): ProjectionReconciliation = {
    session(owner)
    acknowledgments.foreach { ack =>
      receipt(owner, ack)
      Require(ack.input.target.origin == ProjectionTargetOrigin.Head, "corrupt", "outbox acknowledgment cannot prove head reconciliation")
    }
    val ordered = acknowledgments.sortBy(_.input.target.scope)
    val scopes = ordered.map(_.input.target.scope)
    Require(scopes == scopes.distinct && scopes == owner.scopes.take(scopes.size) && scopes.size <= owner.scopes.size,
      "corrupt", "head acknowledgments do not form this session's configured prefix")
    val count = scopes.size
    Require(value.issuedThrough >= 0 && value.issuedThrough <= owner.scopes.size &&
      (value.issuedThrough == owner.scopes.size || value.issuedThrough % owner.batchLimit == 0), "corrupt", "invalid issued-through position")
    value.batch match {
      case None =>
        Require(count == value.issuedThrough, "corrupt", "reconciliation position has no matching acknowledgments")
        ProjectionReconciliation(count, Nil, count == owner.scopes.size)
      case Some(batch) =>
        Require(batch.startIndex >= 0 && batch.startIndex < owner.scopes.size && batch.startIndex % owner.batchLimit == 0,
          "corrupt", "invalid issued batch start")
        val size = math.min(owner.batchLimit, owner.scopes.size - batch.startIndex)
        Require(batch.targets.size == size && batch.targets.map(_.scope) == owner.scopes.slice(batch.startIndex, batch.startIndex + size) &&
          value.issuedThrough == batch.startIndex + size && count >= batch.startIndex && count <= value.issuedThrough,
          "corrupt", "issued batch differs from configured scope interval")
        batch.targets.foreach { point =>
          target(point)
          Require(point.origin == ProjectionTargetOrigin.Head, "corrupt", "head batch contains an outbox target")
          ordered.find(_.input.target.scope == point.scope).foreach(ack => Require(ack.input.target == point, "corrupt", "acknowledged head differs from issued target"))
        }
        ProjectionReconciliation(count, batch.targets.drop(count - batch.startIndex), false)
    }
  }
  def issue(owner: ProjectionSession, before: ProjectionProgress, acknowledgments: List[ProjectionAckReceipt], targets: List[ProjectionTarget]): ProjectionProgress = {
    val state = reconciliation(owner, before, acknowledgments)
    Require(before.batch.isEmpty && !state.complete, "projection-progress", "head batch cannot be replaced or reissued")
    val after = ProjectionProgress(Math.addExact(before.issuedThrough, targets.size), Some(ProjectionIssuedBatch(before.issuedThrough, targets)))
    reconciliation(owner, after, acknowledgments)
    after
  }
  def settle(owner: ProjectionSession, before: ProjectionProgress, acknowledgments: List[ProjectionAckReceipt]): ProjectionProgress = {
    val state = reconciliation(owner, before, acknowledgments)
    if (before.batch.nonEmpty && state.remaining.isEmpty) before.copy(batch = None) else before
  }
  def requireNextHead(owner: ProjectionSession, progress: ProjectionProgress, acknowledgments: List[ProjectionAckReceipt], requested: ProjectionTarget): Unit = {
    val state = reconciliation(owner, progress, acknowledgments)
    Require(state.remaining.headOption.contains(requested), "projection-progress", "head acknowledgment is not the first outstanding target")
  }
}
