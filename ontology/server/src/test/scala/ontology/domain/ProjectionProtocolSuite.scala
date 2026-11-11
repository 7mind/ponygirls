package ontology.domain

import java.util.UUID
import munit.FunSuite
import ontology.api.*

final class ProjectionProtocolSuite extends FunSuite {
  private val at = "2026-11-11T00:00:00Z"
  private val owner = ProjectionSession(UUID.randomUUID(), CoordinatorFence(UUID.randomUUID(), 1L), ProjectionInstance("target", UUID.randomUUID()),
    Actor("projector", ActorKind.Service), List("a", "b", "c"), 2, at)
  private val targets = owner.scopes.map(scope => ProjectionProtocol.target(Graph.empty(scope), ProjectionTargetOrigin.Head))
  private val initial = ProjectionProgress(0, None)
  private def ack(target: ProjectionTarget): ProjectionAckReceipt = ProjectionAckReceipt(
    ProjectionAckInput(owner.id, UUID.randomUUID(), target, ProjectionCheckpoint(owner.instance, target.scope, target.generation, target.digest)),
    ProjectionDisposition.ExactCheckpoint, at)

  test("partial acknowledgments retain exact outstanding targets and original batch boundaries") {
    val issued = ProjectionProtocol.issue(owner, initial, Nil, targets.take(2))
    val first = ack(targets.head)
    ProjectionProtocol.requireNextHead(owner, issued, Nil, targets.head)
    val partial = ProjectionProtocol.settle(owner, issued, List(first))
    assertEquals(partial, issued)
    assertEquals(ProjectionProtocol.reconciliation(owner, partial, List(first)).remaining, List(targets(1)))
    val second = ack(targets(1))
    val done = ProjectionProtocol.settle(owner, partial, List(first, second))
    assertEquals(done, ProjectionProgress(2, None))
    assert(!ProjectionProtocol.reconciliation(owner, done, List(first, second)).complete)
    val last = ProjectionProtocol.issue(owner, done, List(first, second), targets.drop(2))
    val all = List(first, second, ack(targets(2)))
    val settled = ProjectionProtocol.settle(owner, last, all)
    assert(ProjectionProtocol.reconciliation(owner, settled, all).complete)
  }
  test("a cursor without this session's complete acknowledgment prefix cannot skip heads") {
    assertEquals(intercept[Fault](ProjectionProtocol.reconciliation(owner, ProjectionProgress(3, None), Nil)).code, "corrupt")
    val foreign = ack(targets.head).copy(input = ack(targets.head).input.copy(sessionId = UUID.randomUUID()))
    assertEquals(intercept[Fault](ProjectionProtocol.reconciliation(owner, ProjectionProgress(1, None), List(foreign))).code, "corrupt")
    assertEquals(intercept[Fault](ProjectionProtocol.reconciliation(owner, ProjectionProgress(1, None), List(ack(targets(1))))).code, "corrupt")
  }
  test("a valid prefix cannot make a partially acknowledged fixed batch disappear") {
    assertEquals(intercept[Fault](ProjectionProtocol.reconciliation(owner, ProjectionProgress(1, None), List(ack(targets.head)))).code, "corrupt")
    val shifted = ProjectionProgress(3, Some(ProjectionIssuedBatch(1, targets.drop(1))))
    assertEquals(intercept[Fault](ProjectionProtocol.reconciliation(owner, shifted, List(ack(targets.head)))).code, "corrupt")
  }
  test("outbox acknowledgments and reordered head work cannot establish reconciliation") {
    val issued = ProjectionProtocol.issue(owner, initial, Nil, targets.take(2))
    assertEquals(intercept[Fault](ProjectionProtocol.requireNextHead(owner, issued, Nil, targets(1))).code, "projection-progress")
    val outbox = targets.head.copy(generation = 1L, origin = ProjectionTargetOrigin.Outbox)
    assertEquals(intercept[Fault](ProjectionProtocol.reconciliation(owner, issued, List(ack(outbox)))).code, "corrupt")
  }
  test("changed batch targets and duplicate head acknowledgments reject") {
    val issued = ProjectionProtocol.issue(owner, initial, Nil, targets.take(2))
    val first = ack(targets.head)
    val altered = issued.copy(batch = issued.batch.map(b => b.copy(targets = b.targets.updated(0, targets.head.copy(digest = "a" * 64)))))
    assertEquals(intercept[Fault](ProjectionProtocol.reconciliation(owner, altered, List(first))).code, "corrupt")
    assertEquals(intercept[Fault](ProjectionProtocol.reconciliation(owner, issued, List(first, first))).code, "corrupt")
    assertEquals(intercept[Fault](ProjectionProtocol.issue(owner, issued, Nil, targets.take(2))).code, "projection-progress")
  }
  test("disposition and instance bind acknowledgment evidence") {
    val exact = ack(targets.head)
    ProjectionProtocol.receipt(owner, exact)
    val newer = exact.copy(input = exact.input.copy(observed = exact.input.observed.copy(generation = 1L, digest = "b" * 64)), disposition = ProjectionDisposition.SupersededByCheckpoint)
    ProjectionProtocol.receipt(owner, newer)
    assertEquals(intercept[Fault](ProjectionProtocol.receipt(owner, newer.copy(disposition = ProjectionDisposition.ExactCheckpoint))).code, "corrupt")
    assertEquals(intercept[Fault](ProjectionProtocol.receipt(owner, exact.copy(input = exact.input.copy(observed = exact.input.observed.copy(instance = owner.instance.copy(incarnation = UUID.randomUUID())))))).code, "corrupt")
  }
}
