package ontology.domain

import munit.FunSuite
import ontology.api.*
import java.util.UUID

final class ContextsSuite extends FunSuite {
  private val limits = Contexts.ProtocolLimits
  private val epoch = UUID.randomUUID()
  private val native = CaptureContext("session", None, None, LineageStatus.Unknown, "branch", epoch)
  private def reported(value: CaptureContext): ContextRecord = ContextRecord(OriginContext.ReportedNative(value), Nil)
  private val unknown = ContextRecord(OriginContext.Unknown("No native metadata"), Nil)
  private val ref = Ref(UUID.randomUUID(), 1)
  private val cut = ReportedInheritance(InheritanceKind.Import, "source", 1L, 1L, 0L, Nil, List(ref), None)

  test("normalization preserves explicit unknown and reported claims without fabricating native fields") {
    assertEquals(Contexts.normalize(None, "Missing occurrence", limits), ContextRecord(OriginContext.Unknown("Missing occurrence"), Nil))
    assertEquals(Contexts.normalize(Some(ContextRecordInput(OriginContextInput.ReportedNative(native), List(cut))), "unused", limits), reported(native).copy(reportedInherited = List(cut)))
    assertEquals(Contexts.nativeOption(unknown), None)
    assertEquals(intercept[Fault](Contexts.reportedNative(unknown, limits)).code, "context-unknown")
  }
  test("lineage contradictions reject rather than guessing root or parent") {
    val values = List(native.copy(rootSessionId = Some("root")), native.copy(parentSessionId = Some("parent")),
      native.copy(lineage = LineageStatus.Recorded),
      native.copy(lineage = LineageStatus.Recorded, rootSessionId = Some("root"), parentSessionId = Some("session")),
      native.copy(lineage = LineageStatus.Recorded, rootSessionId = Some("session"), parentSessionId = Some("parent")))
    values.foreach(value => assertEquals(intercept[Fault](Contexts.validateShape(reported(value), limits)).code, "context"))
    Contexts.validateShape(reported(native.copy(lineage = LineageStatus.Recorded, rootSessionId = Some("session"))), limits)
  }
  test("inherited metadata is bounded and does not admit duplicate or unlisted anchors") {
    val values = List(unknown.copy(reportedInherited = List(cut, cut)),
      unknown.copy(reportedInherited = List(cut.copy(sourceFrontier = 0L, coveredFrontier = 1L))),
      unknown.copy(reportedInherited = List(cut.copy(generation = -1L))),
      unknown.copy(reportedInherited = List(cut.copy(sourceRefs = List(ref, ref)))),
      unknown.copy(reportedInherited = List(cut.copy(sourceRefs = List(ref.copy(revision = 0))))),
      unknown.copy(reportedInherited = List(cut.copy(anchor = Some(InheritanceAnchor.ReportedParent(ref, epoch))))),
      unknown.copy(reportedInherited = List(cut.copy(anchor = Some(InheritanceAnchor.ReportedEpoch(Ref(UUID.randomUUID(), 1), epoch))))))
    values.foreach(value => assertEquals(intercept[Fault](Contexts.validateShape(value, limits)).code, "context"))
    assertEquals(intercept[Fault](Contexts.validateShape(unknown.copy(reportedInherited = List(cut)), ContextLimits(0, 1, 100))).code, "context")
    assertEquals(intercept[Fault](Contexts.validateShape(unknown.copy(reportedInherited = List(cut.copy(bindingRefs = List(ref)))), ContextLimits(1, 1, 100))).code, "context")
    assertEquals(intercept[Fault](Contexts.validateShape(unknown, ContextLimits(1, 1, 1))).code, "context")
  }
}
