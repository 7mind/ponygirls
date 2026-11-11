package ontology

import java.time.Instant
import ontology.api.*
import ontology.domain.*

private[ontology] object CapsuleRows {
  def digest(request: CapsuleRequest): String = Digests.text(StoredJson.encode(CapsuleRequest.codecJson, request))
  def digest(request: DeliveryRequest): String = Digests.text(StoredJson.encode(DeliveryRequest.codecJson, request))
  def time(value: String): Instant = try Instant.parse(value) catch {
    case _: java.time.format.DateTimeParseException => throw Fault("corrupt", "invalid ledger observation time")
  }
  def capsule(row: CapsuleRow): Unit = {
    val r = row.request; val value = row.value
    Require(row.requestDigest == digest(r) && r.scope == value.payload.scope && r.requestId == value.requestId &&
      r.workContext == value.payload.workContext && r.expectedFrontier == value.payload.cut.frontier &&
      r.previousCapsuleId == value.payload.previousCapsuleId && CapsuleContext.reported(r.reportedContext) == value.payload.reportedContext,
      "corrupt", "capsule differs from retained preparation request")
    CapsuleProjection.envelope(value)
  }
  def delivery(row: DeliveryRow): Unit = {
    val r = row.request; val value = row.value
    Require(row.requestDigest == digest(r) && r.scope == value.scope && r.requestId == value.requestId && r.capsuleId == value.capsuleId &&
      r.capsulePayloadDigest == value.capsulePayloadDigest && r.workContext == value.workContext && r.boundary == value.boundary &&
      r.reportedAt == value.reportedAt && r.reportedBoundaryPayload == value.reportedBoundaryPayload &&
      CapsuleContext.reported(r.reportedContext) == value.reportedContext, "corrupt", "delivery differs from retained request")
    Contexts.server(value.ingress, Contexts.ProtocolLimits)
    time(value.receivedAt)
    ()
  }
}
