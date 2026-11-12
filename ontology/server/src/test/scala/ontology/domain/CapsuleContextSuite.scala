package ontology.domain

import java.util.UUID
import munit.FunSuite
import ontology.{Principal, ServiceCall}
import ontology.api.*

final class CapsuleContextSuite extends FunSuite {
  private val scope = "controlled"
  private val semantic = "named-work"
  private val actor = Actor("fixture-agent", ActorKind.Agent)
  private val principal = Principal("fixture", actor, Set(scope), Set(Capability.Read))
  private val settings = CapsuleSettings(Set(WorkContextKey(scope, semantic)), CapsuleLimits(16, 65536))
  private val native = CaptureContext("reported-session", None, None, LineageStatus.Unknown, "reported-branch", UUID.randomUUID())
  private val reported = ContextRecord(OriginContext.ReportedNative(native), Nil)
  private def capsule(context: ContextRecord): Capsule = Capsule(UUID.randomUUID(), UUID.randomUUID(), actor,
    CapsulePayload(scope, semantic, context, CapsuleCut(0L, 0L, 0L, None, None), None, CapsulePolicyIdentity("fixture", "a" * 64), Nil,
      CapsuleManifest(Nil, Nil, Nil), "Context-only fixture"), "b" * 64, settings.limits, "2026-11-11T00:00:00Z",
    RequestTrace(UUID.randomUUID(), "capsule.prepare", RequestTransport.Internal))

  test("explicit semantic context is independent of native labels and read permission") {
    val call = ServiceCall.internal(principal, "capsule.prepare", UUID.randomUUID())
    CapsuleContext.authorize(call, scope, semantic, settings)
    assertEquals(intercept[Fault](CapsuleContext.authorize(call, scope, native.branch, settings)).code, "work-context")
    val denied = ServiceCall.internal(principal.copy(scopes = Set("elsewhere")), "capsule.prepare", UUID.randomUUID())
    assertEquals(intercept[Fault](CapsuleContext.authorize(denied, scope, "unknown", settings)).code, "forbidden")
  }
  test("missing reported context stays Unknown even for internal callers") {
    val context = CapsuleContext.reported(None)
    assertEquals(context.origin, OriginContext.Unknown(CapsuleContext.MissingReportedContext))
    assertEquals(context.reportedInherited, Nil)
  }
  test("baselines require the same owner and exact reported native origin") {
    val previous = capsule(reported)
    CapsuleContext.baseline(previous, actor, scope, semantic, reported)
    assertEquals(intercept[Fault](CapsuleContext.baseline(previous, actor.copy(id = "another"), scope, semantic, reported)).code, "forbidden")
    assertEquals(intercept[Fault](CapsuleContext.baseline(previous, actor, scope, semantic, reported.copy(origin = OriginContext.ReportedNative(native.copy(epoch = UUID.randomUUID()))))).code, "context")
    val unknown = CapsuleContext.reported(None)
    assertEquals(intercept[Fault](CapsuleContext.baseline(capsule(unknown), actor, scope, semantic, unknown)).code, "context")
  }
  test("delivery compares reported origin while graph freshness is separately qualified") {
    CapsuleContext.delivery(capsule(reported), reported)
    assertEquals(intercept[Fault](CapsuleContext.delivery(capsule(reported), CapsuleContext.reported(None))).code, "context")
    val old = CapsuleCut(5L, 3L, 3L, Some(4L), None)
    assertEquals(CapsuleContext.comparison(old, old), DeliveryCutComparison.SameGraphAndCoverage)
    assertEquals(CapsuleContext.comparison(old, old.copy(generation = 6L)), DeliveryCutComparison.ChangedGraphOrCoverage)
    assertEquals(CapsuleContext.comparison(old, old.copy(frontier = 4L)), DeliveryCutComparison.ChangedGraphOrCoverage)
  }
}
