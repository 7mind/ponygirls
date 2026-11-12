package ontology

import java.util.UUID
import ontology.api.*
import ontology.domain.*

private[ontology] final class ProjectionEvidence(tx: ProjectionTransaction) {
  def session(id: UUID): ProjectionSessionRow = {
    val row = tx.session(id).getOrElse(throw Fault("not-found", "projection session not found"))
    Require(row.session.id == id, "corrupt", "projection session lookup differs")
    ProjectionProtocol.session(row.session)
    row
  }
  def history(scope: String, generation: Long): GraphSnapshot = {
    Require(generation >= 0, "corrupt", "negative projection revision")
    val graph = if (generation == 0L) Graph.empty(scope) else tx.history(scope, generation)
    Require(graph.scope == scope && graph.generation == generation, "corrupt", "projection authority cut differs")
    graph
  }
  def work(target: ProjectionTarget): ProjectionWork = {
    ProjectionProtocol.target(target)
    val graph = history(target.scope, target.generation)
    Require(ProjectionProtocol.target(graph, target.origin) == target, "corrupt", "projection target differs from authority")
    if (target.origin == ProjectionTargetOrigin.Outbox) Require(tx.containsOutbox(target.scope, target.generation), "corrupt", "projection publication ledger entry missing")
    ProjectionWork(target, graph)
  }
  def receipt(value: ProjectionAckReceipt): ProjectionAckReceipt = {
    val owner = session(value.input.sessionId).session
    ProjectionProtocol.receipt(owner, value)
    work(value.input.target)
    val observed = value.input.observed
    val graph = history(observed.scope, observed.generation)
    Require(ProjectionProtocol.target(graph, ProjectionTargetOrigin.Head).digest == observed.digest, "corrupt", "projection acknowledgment observation differs from authority")
    value
  }
  def checkpoint(instance: ProjectionInstance, scope: String): Option[ProjectionCheckpointWitness] = {
    val accepted = tx.accepted(instance, scope).map { value =>
      Require(value.input.observed.instance == instance && value.input.target.scope == scope, "corrupt", "accepted projection observation index differs")
      receipt(value).input.observed
    }
    val maximum = accepted.maxByOption(_.generation)
    val retained = tx.checkpoint(instance, scope)
    Require(retained.nonEmpty == maximum.nonEmpty, "corrupt", "checkpoint presence differs from accepted observations")
    retained.map { value =>
      Require(maximum.contains(value.checkpoint), "corrupt", "checkpoint differs from greatest accepted observation")
      val witness = tx.acknowledgment(value.sessionId, value.requestId).getOrElse(throw Fault("corrupt", "projection checkpoint witness missing"))
      Require(witness.input.sessionId == value.sessionId && witness.input.requestId == value.requestId && receipt(witness).input.observed == value.checkpoint,
        "corrupt", "projection checkpoint witness differs")
      value
    }
  }
  def headReceipts(owner: ProjectionSession): List[ProjectionAckReceipt] = {
    val values = tx.headAcknowledgments(owner.id)
    values.foreach(value => Require(value.input.sessionId == owner.id && value.input.target.origin == ProjectionTargetOrigin.Head,
      "corrupt", "invalid reconciliation acknowledgment index"))
    values.map(receipt)
  }
}
