package ontology.domain

import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.UUID
import ontology.{ContextAccess, ServiceCall}
import ontology.api.*

object DeliveryEngine {
  private def instant(value: String): Instant = try Instant.parse(value) catch { case _: DateTimeParseException => throw Fault("delivery", "invalid reported or retained time") }
  private def build(request: DeliveryRequest, owner: Actor, trace: RequestTrace, id: UUID, at: Instant, observed: CapsuleCut,
                    retained: CapsuleBaseline, contexts: List[GraphSnapshot]): DeliveryReceipt = {
    val capsule = retained.capsule
    Require(capsule.owner == owner, "forbidden", "capsule belongs to another authenticated actor")
    Require(request.scope == capsule.payload.scope && request.workContext == capsule.payload.workContext && request.capsuleId == capsule.id &&
      request.capsulePayloadDigest == capsule.payloadDigest, "delivery", "delivery capsule identity or payload differs")
    Contexts.server(trace, Contexts.ProtocolLimits)
    val context = CapsuleContext.reported(request.reportedContext)
    CapsuleContext.delivery(capsule, context)
    ContextAccess.validate(List(context), contexts)
    request.reportedAt.foreach { value =>
      Require(value.length <= Contexts.MaximumTextLength, "delivery", "reported timestamp exceeds capacity")
      instant(value)
    }
    request.reportedBoundaryPayload.foreach { value =>
      Require(value.encoding.trim.nonEmpty && value.encoding.length <= Contexts.MaximumTextLength && value.digest.matches("[0-9a-f]{64}"),
        "delivery", "invalid client-reported boundary digest")
    }
    Require(!at.isBefore(instant(capsule.preparedAt)), "delivery", "receipt time precedes capsule preparation")
    val before = capsule.payload.cut
    Require(observed.generation >= before.generation && observed.frontier >= before.frontier && observed.coveredFrontier >= before.coveredFrontier &&
      observed.coveredFrontier <= observed.frontier && observed.lastPublicationGeneration.forall(g => g > 0 && g <= observed.generation) &&
      (observed.lastPublicationGeneration.nonEmpty || observed.coveredFrontier == 0L) &&
      before.lastPublicationGeneration.forall(old => observed.lastPublicationGeneration.exists(_ >= old)), "delivery", "observed scope cut regressed")
    DeliveryReceipt(id, request.requestId, owner, request.scope, capsule.id, capsule.payloadDigest, request.workContext, context,
      request.boundary, request.reportedAt, request.reportedBoundaryPayload, at.toString, trace, observed, CapsuleContext.comparison(before, observed))
  }
  def record(request: DeliveryRequest, call: ServiceCall, retained: CapsuleBaseline, observed: CapsuleCut,
             contexts: List[GraphSnapshot], id: UUID, at: Instant): DeliveryReceipt = {
    call.principal.require(request.scope, Capability.Read)
    ContextAccess.requiredSnapshots(call.principal, List(CapsuleContext.reported(request.reportedContext)))
    build(request, call.principal.actor, call.ingress, id, at, observed, retained, contexts)
  }
  def validate(receipt: DeliveryReceipt, request: DeliveryRequest, retained: CapsuleBaseline, contexts: List[GraphSnapshot]): Unit = try {
    val expected = build(request, receipt.owner, receipt.ingress, receipt.id, instant(receipt.receivedAt), receipt.observedCut, retained, contexts)
    Require(expected == receipt, "corrupt", "delivery receipt differs from retained request and capsule")
  } catch { case _: Fault => throw Fault("corrupt", "invalid retained delivery correspondence") }
}
