package ontology.domain

import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.UUID
import ontology.{ContextAccess, Digests, ServiceCall, Wire}
import ontology.api.*

final case class CapsuleBlueprint(plan: CapsulePlan, changes: CapsuleChangeSet)
object CapsuleProjection {
  def blueprint(graph: GraphSnapshot, workContext: String, pending: List[CapturedEvent], previous: Option[CapsuleBaseline], limits: CapsuleLimits): CapsuleBlueprint = {
    val current = CapsuleSelection.plan(graph, workContext, pending, Nil, limits)
    val changes = previous match {
      case None => CapsuleChangeSet(Nil, Nil)
      case Some(base) =>
        Require(base.snapshot.scope == graph.scope && base.snapshot.generation <= graph.generation && base.capsule.payload.cut.generation == base.snapshot.generation &&
          base.capsule.payload.cut.frontier == base.snapshot.sourceFrontier && base.capsule.payload.cut.coveredFrontier == base.snapshot.coveredFrontier,
          "corrupt", "baseline differs from retained snapshot")
        val old = CapsuleSelection.plan(base.snapshot, workContext, base.pending, Nil, base.capsule.limits)
        CapsuleChanges.compare(graph, workContext, current, old)
    }
    CapsuleBlueprint(CapsuleSelection.plan(graph, workContext, pending, changes.references, limits), changes)
  }
  private def bytes(value: CapsulePayload, limits: CapsuleLimits): Array[Byte] = {
    Require(limits.maxRecords > 0 && limits.maxPayloadBytes > 0 && limits.maxPayloadBytes <= Wire.MaxBodyBytes, "corrupt", "invalid retained capsule limits")
    val encoded = Wire.encode(CapsulePayload.codecJson, value).noSpaces
    Require(UTF_8.newEncoder().canEncode(encoded), "capsule", "invalid capsule UTF-8")
    val result = encoded.getBytes(UTF_8)
    Require(value.records.size <= limits.maxRecords && result.length <= limits.maxPayloadBytes, "capacity", "complete capsule payload exceeds capacity")
    result
  }
  def payload(material: CapsuleMaterial, workContext: String, context: ContextRecord, previous: Option[CapsuleBaseline], limits: CapsuleLimits): CapsulePayload = {
    Contexts.validateShape(context, Contexts.ProtocolLimits)
    ContextAccess.validate(List(context), material.contextSnapshots)
    Require(!context.origin.isInstanceOf[OriginContext.ServiceRequest], "context", "reported capsule context cannot become a service request")
    val prepared = blueprint(material.snapshot, workContext, material.pending, previous, limits)
    val records = CapsuleRecords.attach(material, prepared.plan, limits)
    val manifest = CapsuleManifestBuilder.build(material, prepared.plan, records, context, workContext, prepared.changes)
    val text = CapsuleRendering.text(material.snapshot.scope, workContext, material.cut, context, records, manifest)
    val result = CapsulePayload(material.snapshot.scope, workContext, context, material.cut, previous.map(_.capsule.id), CapsuleRendering.Policy, records, manifest, text)
    bytes(result, limits)
    result
  }
  def prepare(material: CapsuleMaterial, request: CapsuleRequest, call: ServiceCall, id: UUID, at: Instant, settings: CapsuleSettings,
              previous: Option[CapsuleBaseline]): Capsule = {
    CapsuleContext.authorize(call, request.scope, request.workContext, settings)
    Require(request.scope == material.snapshot.scope && request.expectedFrontier == material.snapshot.sourceFrontier, "stale-frontier", "capsule frontier changed")
    Require(request.previousCapsuleId == previous.map(_.capsule.id) && !request.previousCapsuleId.contains(id), "capsule", "explicit baseline was not resolved")
    val context = CapsuleContext.reported(request.reportedContext)
    ContextAccess.requiredSnapshots(call.principal, List(context))
    previous.foreach { baseline =>
      envelope(baseline.capsule)
      CapsuleContext.baseline(baseline.capsule, call.principal.actor, request.scope, request.workContext, context)
      Require(!at.isBefore(Instant.parse(baseline.capsule.preparedAt)), "capsule", "preparation precedes its baseline")
    }
    val value = payload(material, request.workContext, context, previous, settings.limits)
    val result = Capsule(id, request.requestId, call.principal.actor, value, Digests.bytes(bytes(value, settings.limits)), settings.limits, at.toString, call.ingress)
    envelope(result)
    result
  }
  def envelope(capsule: Capsule): Unit = {
    Contexts.server(capsule.preparationTrace, Contexts.ProtocolLimits)
    try Instant.parse(capsule.preparedAt) catch { case _: java.time.format.DateTimeParseException => throw Fault("corrupt", "invalid capsule preparation time") }
    Require(capsule.owner.id.trim.nonEmpty && capsule.payload.scope.trim.nonEmpty && capsule.payload.workContext.trim.nonEmpty, "corrupt", "invalid capsule owner or semantic context")
    val cut = capsule.payload.cut
    Require(cut.generation >= 0 && cut.coveredFrontier >= 0 && cut.coveredFrontier <= cut.frontier && cut.lastPublicationGeneration.forall(g => g > 0 && g <= cut.generation) &&
      (cut.lastPublicationGeneration.nonEmpty || cut.coveredFrontier == 0L), "corrupt", "invalid capsule cut")
    Contexts.validateShape(capsule.payload.reportedContext, Contexts.ProtocolLimits)
    Require(capsule.payload.policy == CapsuleRendering.Policy && !capsule.payload.previousCapsuleId.contains(capsule.id), "corrupt", "unsupported capsule policy or self baseline")
    Require(capsule.payloadDigest == Digests.bytes(bytes(capsule.payload, capsule.limits)), "corrupt", "capsule payload digest differs")
    val refs = capsule.payload.records.map(Graph.recordRef)
    Require(refs.distinct == refs && capsule.payload.manifest.entries.map(_.ref) == refs, "corrupt", "capsule manifest does not account for every exact record")
    val present = refs.toSet
    capsule.payload.manifest.entries.foreach { entry =>
      Require(entry.roles.nonEmpty && entry.roles.distinct == entry.roles && entry.evidence.forall(present), "corrupt", "invalid capsule entry roles/evidence")
    }
    capsule.payload.manifest.changes.foreach { change =>
      Require((change.previous.nonEmpty || change.current.nonEmpty) && change.previous != change.current &&
        (change.previous.toList ++ change.current.toList ++ List(change.account) ++ change.basis ++ change.humanBasis).forall(present), "corrupt", "invalid capsule change references")
    }
    Require(capsule.payload.manifest.qualifications.flatMap(_.subjects).forall(present), "corrupt", "capsule qualification is detached")
    Require(Wire.encode(Capsule.codecJson, capsule).noSpaces.getBytes(UTF_8).length <= Wire.MaxBodyBytes, "capacity", "complete capsule envelope exceeds transport capacity")
  }
  def validate(capsule: Capsule, material: CapsuleMaterial, previous: Option[CapsuleBaseline]): Unit = {
    envelope(capsule)
    Require(capsule.payload.previousCapsuleId == previous.map(_.capsule.id), "corrupt", "capsule baseline linkage differs")
    previous.foreach { base =>
      CapsuleContext.baseline(base.capsule, capsule.owner, capsule.payload.scope, capsule.payload.workContext, capsule.payload.reportedContext)
      Require(!Instant.parse(capsule.preparedAt).isBefore(Instant.parse(base.capsule.preparedAt)), "corrupt", "capsule preparation precedes its baseline")
    }
    Require(capsule.payload == payload(material, capsule.payload.workContext, capsule.payload.reportedContext, previous, capsule.limits), "corrupt", "capsule differs from exact recorded cut and projection policy")
  }
}
