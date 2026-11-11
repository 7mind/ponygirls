package ontology

import cats.effect.IO
import java.time.Instant
import java.util.UUID
import ontology.api.*
import ontology.domain.*

private[ontology] final class ProjectionStore(transactions: ProjectionTransactions, settings: ProjectionSettings) extends ProjectionRepository {
  private def time(value: String): Instant = try Instant.parse(value) catch {
    case _: java.time.format.DateTimeParseException => throw Fault("corrupt", "invalid projection session time")
  }
  private def actor(owner: ProjectionSession): Unit = Require(owner.actor == settings.principal.actor && owner.instance.targetId == settings.targetId,
    "forbidden", "projection session belongs to another configured service or target")
  private def authorize(owner: ProjectionSession): Unit = { actor(owner); owner.scopes.foreach(settings.principal.require(_, Capability.Read)) }
  private def live(tx: ProjectionTransaction, owner: ProjectionSession): Instant = {
    val now = tx.now
    CoordinatorLeases.live(tx.coordinator, owner.fence, now)
    Require(!now.isBefore(time(owner.openedAt)), "coordinator", "clock precedes projection session")
    now
  }
  private def progress(evidence: ProjectionEvidence, row: ProjectionSessionRow): (List[ProjectionAckReceipt], ProjectionReconciliation) = {
    val acks = evidence.headReceipts(row.session)
    val state = ProjectionProtocol.reconciliation(row.session, row.progress, acks)
    Require(ProjectionProtocol.settle(row.session, row.progress, acks) == row.progress, "corrupt", "completed projection batch was not settled atomically")
    (acks, state)
  }
  def open(id: UUID, fence: CoordinatorFence, instance: ProjectionInstance): IO[ProjectionSession] = transactions.run { tx =>
    ProjectionProtocol.instance(instance)
    Require(instance.targetId == settings.targetId, "projection-target", "projection instance target differs from configuration")
    settings.scopes.foreach(settings.principal.require(_, Capability.Read))
    val evidence = new ProjectionEvidence(tx)
    tx.session(id) match {
      case Some(_) =>
        val row = evidence.session(id)
        val expected = ProjectionSession(id, fence, instance, settings.principal.actor, settings.scopes.toList.sorted, settings.batchLimit, row.session.openedAt)
        Require(row.session == expected, "replay-conflict", "projection session ID has different opening parameters")
        authorize(row.session)
        progress(evidence, row)
        live(tx, row.session)
        row.session
      case None =>
        Require(tx.acquisition(instance, fence).isEmpty, "identity", "projection acquisition already has a session")
        val now = tx.now
        CoordinatorLeases.live(tx.coordinator, fence, now)
        val owner = ProjectionSession(id, fence, instance, settings.principal.actor, settings.scopes.toList.sorted, settings.batchLimit, now.toString)
        ProjectionProtocol.session(owner)
        tx.insertSession(ProjectionSessionRow(owner, ProjectionProgress(0, None)))
        owner
    }
  }
  def reconcileHeads(sessionId: UUID): IO[ProjectionWorkBatch] = transactions.run { tx =>
    val evidence = new ProjectionEvidence(tx)
    val row = evidence.session(sessionId); val owner = row.session
    authorize(owner)
    val (acks, state) = progress(evidence, row)
    if (state.complete) {
      live(tx, owner)
      ProjectionWorkBatch(owner, Nil, true)
    } else row.progress.batch match {
      case Some(_) =>
        state.remaining.map(_.scope).foreach(tx.lock)
        val work = state.remaining.map(evidence.work)
        live(tx, owner)
        ProjectionWorkBatch(owner, work, false)
      case None =>
        val scopes = owner.scopes.drop(row.progress.issuedThrough).take(owner.batchLimit)
        scopes.foreach(tx.lock)
        val work = scopes.map { scope =>
          val graph = tx.head(scope)
          Require(graph.scope == scope, "corrupt", "projection head scope differs")
          ProjectionWork(ProjectionProtocol.target(graph, ProjectionTargetOrigin.Head), graph)
        }
        val next = ProjectionProtocol.issue(owner, row.progress, acks, work.map(_.target))
        live(tx, owner)
        tx.saveProgress(owner.id, next)
        ProjectionWorkBatch(owner, work, false)
    }
  }
  def pending(sessionId: UUID): IO[ProjectionWorkBatch] = transactions.run { tx =>
    val evidence = new ProjectionEvidence(tx)
    val row = evidence.session(sessionId); val owner = row.session
    authorize(owner)
    Require(progress(evidence, row)._2.complete, "projection-progress", "head reconciliation is incomplete")
    val work = List.newBuilder[ProjectionWork]
    var remaining = owner.batchLimit
    owner.scopes.iterator.takeWhile(_ => remaining > 0).foreach { scope =>
      tx.lock(scope)
      val checkpoint = evidence.checkpoint(owner.instance, scope).getOrElse(throw Fault("corrupt", "reconciled scope has no checkpoint"))
      val generations = tx.outbox(scope, checkpoint.checkpoint.generation, remaining)
      Require(generations == generations.distinct.sorted && generations.size <= remaining && generations.forall(_ > checkpoint.checkpoint.generation),
        "corrupt", "invalid pending projection publication inventory")
      generations.foreach { generation =>
        val target = ProjectionProtocol.target(evidence.history(scope, generation), ProjectionTargetOrigin.Outbox)
        work += evidence.work(target)
      }
      remaining -= generations.size
    }
    live(tx, owner)
    ProjectionWorkBatch(owner, work.result(), true)
  }
  private def observation(evidence: ProjectionEvidence, input: ProjectionAckInput, value: ProjectionObservation): Unit = {
    Require(value.checkpoint == input.observed && value.snapshot.scope == input.observed.scope && value.snapshot.generation == input.observed.generation &&
      ProjectionProtocol.target(value.snapshot, ProjectionTargetOrigin.Head).digest == input.observed.digest,
      "projection-observation", "projection observation differs from its checkpoint")
    Require(value.snapshot == evidence.history(input.observed.scope, input.observed.generation), "projection-observation", "observed RDF snapshot differs from authority")
  }
  def acknowledge(input: ProjectionAckInput, observed: ProjectionObservation): IO[ProjectionAckResult] = IO.defer {
    settings.principal.require(input.target.scope, Capability.Read)
    transactions.run { tx =>
      val evidence = new ProjectionEvidence(tx)
      val row = evidence.session(input.sessionId); val owner = row.session
      actor(owner)
      Require(owner.scopes.contains(input.target.scope), "forbidden", "projection scope is outside session")
      tx.lock(input.target.scope)
      tx.acknowledgment(input.sessionId, input.requestId) match {
        case Some(old) =>
          Require(old.input.sessionId == input.sessionId && old.input.requestId == input.requestId, "corrupt", "projection receipt lookup differs")
          Require(old.input == input, "replay-conflict", "projection acknowledgment ID has different content")
          val retained = evidence.receipt(old)
          observation(evidence, input, observed)
          ProjectionAckResult(retained, true)
        case None =>
          authorize(owner)
          val (acks, state) = progress(evidence, row)
          if (input.target.origin == ProjectionTargetOrigin.Head) ProjectionProtocol.requireNextHead(owner, row.progress, acks, input.target)
          else Require(state.complete, "projection-progress", "head reconciliation is incomplete")
          val disposition = if (input.observed.generation == input.target.generation) ProjectionDisposition.ExactCheckpoint else ProjectionDisposition.SupersededByCheckpoint
          val draft = ProjectionAckReceipt(input, disposition, live(tx, owner).toString)
          evidence.receipt(draft)
          observation(evidence, input, observed)
          val prior = evidence.checkpoint(owner.instance, input.target.scope)
          prior.foreach { current =>
            Require(input.observed.generation >= current.checkpoint.generation, "projection-stale", "checkpoint advanced; reconcile the original request before re-observing RDF")
            Require(input.observed.generation != current.checkpoint.generation || input.observed.digest == current.checkpoint.digest,
              "projection-conflict", "equal projection generation has a different digest")
          }
          val value = draft.copy(recordedAt = live(tx, owner).toString)
          ProjectionProtocol.receipt(owner, value)
          val next = if (input.target.origin == ProjectionTargetOrigin.Head) ProjectionProtocol.settle(owner, row.progress, acks :+ value) else row.progress
          tx.insertAcknowledgment(value)
          tx.saveCheckpoint(ProjectionCheckpointWitness(input.observed, owner.id, input.requestId))
          if (next != row.progress) tx.saveProgress(owner.id, next)
          ProjectionAckResult(value, false)
      }
    }
  }
  def receipt(principal: Principal, scope: String, sessionId: UUID, requestId: UUID): IO[Option[ProjectionAckReceipt]] = IO.defer {
    principal.require(scope, Capability.Read)
    transactions.run { tx =>
      tx.lock(scope)
      tx.acknowledgment(sessionId, requestId).map { value =>
        Require(value.input.target.scope == scope, "not-found", "projection receipt not found in scope")
        Require(value.input.sessionId == sessionId && value.input.requestId == requestId, "corrupt", "projection receipt lookup differs")
        new ProjectionEvidence(tx).receipt(value)
      }
    }
  }
  def checkpoint(principal: Principal, instance: ProjectionInstance, scope: String): IO[Option[ProjectionCheckpoint]] = IO.defer {
    principal.require(scope, Capability.Read)
    transactions.run { tx => tx.lock(scope); new ProjectionEvidence(tx).checkpoint(instance, scope).map(_.checkpoint) }
  }
}
