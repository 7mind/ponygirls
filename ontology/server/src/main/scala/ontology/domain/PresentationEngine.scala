package ontology.domain

import ontology.api.*
import ontology.{Digests, ReviewCall, Wire}
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.UUID

final case class PresentationLimits(maxTargets: Int, maxRecords: Int, maxPayloadBytes: Int) {
  Require(maxTargets > 0 && maxRecords > 0 && maxPayloadBytes > 0, "config", "positive presentation limits required")
}

object PresentationEngine {
  private def check(value: Boolean, message: String): Unit = Require(value, "presentation", message)
  def reservedRef(id: UUID): Ref = Ref(UUID.nameUUIDFromBytes(("ontology:derived-presentation-source:v1:" + id).getBytes(UTF_8)), 1)
  def canonical(payload: PresentationPayload): Array[Byte] = Wire.encode(PresentationPayload.codecJson, payload).noSpaces.getBytes(UTF_8)
  private def timestamp(value: String): Unit = {
    try Instant.parse(value)
    catch { case _: DateTimeParseException => throw Fault("presentation", "invalid preparation timestamp") }
  }
  private def authority(call: ReviewCall, scope: String): Unit = {
    Require(call.scope == scope, "forbidden", "review scope mismatch")
    call.principal.require(scope, Capability.Read)
    call.principal.require(scope, Capability.Review)
    Require(call.principal.actor.kind == ActorKind.Human && call.ingress.transport == RequestTransport.Cookie, "forbidden", "Human cookie review required")
  }
  private def payloadBytes(payload: PresentationPayload, limits: PresentationLimits): Array[Byte] = {
    check(payload.generation >= 0, "invalid presentation generation")
    check(payload.targets.nonEmpty && payload.targets.size <= limits.maxTargets && payload.targets.distinct == payload.targets, "invalid presentation targets")
    check(payload.records.size <= limits.maxRecords, "presentation record capacity exceeded")
    val bytes = canonical(payload)
    check(bytes.length <= limits.maxPayloadBytes, "presentation payload capacity exceeded")
    bytes
  }
  def prepare(graph: GraphSnapshot, request: PresentRequest, call: ReviewCall, id: UUID, recordedAt: String, limits: PresentationLimits): Presentation = {
    authority(call, request.scope)
    Graph.validateCounters(graph)
    check(graph.scope == request.scope, "snapshot scope mismatch")
    Require(graph.generation == request.expectedGeneration, "conflict", "presentation generation changed")
    check(request.targets.nonEmpty && request.targets.size <= limits.maxTargets && request.targets.distinct == request.targets, "invalid presentation targets")
    timestamp(recordedAt)
    Contexts.server(call.ingress, Contexts.ProtocolLimits)
    val reserved = reservedRef(id)
    val all = Graph.records(graph)
    check(!all.exists(record => Graph.recordRef(record).id == reserved.id), "reserved source identity collision")
    val get = PresentationRecords.lookup(all)
    var pending = request.targets
    var seen = Map.empty[Ref, GraphRecord]
    while (pending.nonEmpty) {
      val ref = pending.head
      pending = pending.tail
      if (!seen.contains(ref)) {
        check(seen.size < limits.maxRecords, "presentation record capacity exceeded")
        val record = get(ref)
        val linked = PresentationRecords.references(record, graph.scope)
        seen = seen.updated(ref, record)
        pending = linked ++ pending
      }
    }
    val records = seen.values.toList.sortBy(record => { val ref = Graph.recordRef(record); (ref.id.toString, ref.revision) })
    val payload = PresentationPayload(graph.scope, graph.generation, request.targets, records,
      PresentationRecords.sources(records), PresentationRecords.manifest(request.targets, get, reserved))
    Presentation(id, call.principal.actor, reserved, payload, Digests.bytes(payloadBytes(payload, limits)), recordedAt, call.ingress)
  }

  /** Uses the owner's retained presentation, never a caller-supplied presentation object. */
  def validateRetained(presentation: Presentation, limits: PresentationLimits): Unit = {
    val payload = presentation.payload
    check(presentation.owner.kind == ActorKind.Human && presentation.preparationTrace.transport == RequestTransport.Cookie, "invalid retained preparation identity")
    Contexts.server(presentation.preparationTrace, Contexts.ProtocolLimits)
    timestamp(presentation.createdAt)
    check(presentation.reservedSourceRef == reservedRef(presentation.id), "reservation mismatch")
    check(Digests.bytes(payloadBytes(payload, limits)) == presentation.payloadDigest, "presentation digest mismatch")
    val get = PresentationRecords.lookup(payload.records)
    check(!payload.records.exists(record => Graph.recordRef(record).id == presentation.reservedSourceRef.id), "prepared payload contains its own derived source")
    payload.records.foreach(record => PresentationRecords.references(record, payload.scope).foreach(ref => { get(ref); () }))
    check(payload.sourceRefs == PresentationRecords.sources(payload.records), "presentation source index mismatch")
    check(payload.manifest == PresentationRecords.manifest(payload.targets, get, presentation.reservedSourceRef), "presentation manifest mismatch")
  }

  def validateSelection(presentation: Presentation, action: ReviewAction, limits: PresentationLimits): Unit = {
    validateRetained(presentation, limits)
    val payload = presentation.payload
    action match {
      case _: ReviewAction.Review => ()
      case value: ReviewAction.Choose => check(payload.manifest.choices.contains(value.selection), "selection is not an exact presented option")
      case value: ReviewAction.Adopt => check(payload.manifest.adoptionTargets.contains(value.target), "target is not explicitly adoptable")
    }
  }

  def validateAction(presentation: Presentation, action: ReviewAction, call: ReviewCall, limits: PresentationLimits): Unit = {
    authority(call, presentation.payload.scope)
    Require(presentation.owner == call.principal.actor, "forbidden", "presentation owner mismatch")
    validateSelection(presentation, action, limits)
  }
}
