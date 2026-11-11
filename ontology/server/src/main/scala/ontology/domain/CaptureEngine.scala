package ontology.domain

import ontology.api.*
import ontology.{Digests, Principal, Wire}
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.UUID

final case class Captured(snapshot: GraphSnapshot, event: CapturedEvent, result: IngestResult, receipt: InputReceipt)
object CaptureIdentity {
  def event(namespace: String, id: UUID): UUID = UUID.nameUUIDFromBytes(("capture:" + namespace + ":" + id).getBytes(UTF_8))
  def source(namespace: String, id: UUID): Ref = Ref(event(namespace, id), 1)
  def artifactKey(scope: String, namespace: String, context: CaptureContext, value: Observation.FileVersion): String = io.circe.Json.arr(io.circe.Json.fromString(scope), io.circe.Json.fromString(namespace), io.circe.Json.fromString(context.epoch.toString), io.circe.Json.fromString(value.path), io.circe.Json.fromString(value.generation.toString), io.circe.Json.fromString(value.digest)).noSpaces
  def artifacts(event: CapturedEvent): List[Ref] = event.observation match {
    case value: Observation.FileVersion => List(Ref(UUID.nameUUIDFromBytes(("artifact:" + artifactKey(event.scope, event.sourceNamespace, Contexts.reportedNative(event.context, Contexts.ProtocolLimits), value)).getBytes(UTF_8)), 1))
    case _ => Nil
  }
  def definition(event: CapturedEvent): Definition = {
    Require(event.reviewResponse.isEmpty, "corrupt", "generic capture cannot contain a protected review response")
    val source = Ref(event.id, 1)
    val execution = event.observation match { case value: Observation.Execution => value.contract.toList ++ value.artifacts; case _ => Nil }
    val content = Content.Source(event.text, (artifacts(event) ++ execution).distinct, Digests.text(event.text),
      SourceDescriptor.PrimaryCapture(event.id, event.sourceNamespace, event.context, event.metadata, event.origin, event.observation, None))
    Definition(source, event.scope, Applicability.Captured(source), content, Standing.Active, Nil, None, event.provenance)
  }
  private def payload(scope: String, eventId: UUID, context: ContextRecord, origin: EventOrigin, metadata: CaptureMetadata, text: String, observation: Observation, reviewResponse: Option[ReviewResponseLink]): io.circe.Json =
    io.circe.Json.obj("scope" -> io.circe.Json.fromString(scope), "eventId" -> io.circe.Json.fromString(eventId.toString), "context" -> Wire.encode(ContextRecord.codecJson, context), "origin" -> Wire.encode(EventOrigin_JsonCodec.instance, origin), "metadata" -> Wire.encode(CaptureMetadata.codecJson, metadata), "text" -> io.circe.Json.fromString(text), "observation" -> Wire.encode(Observation.codecJson, observation), "reviewResponse" -> reviewResponse.fold(io.circe.Json.Null)(Wire.encode(ReviewResponseLink.codecJson, _)))
  private def fingerprint(namespace: String, value: io.circe.Json): String =
    Digests.text(io.circe.Json.obj("namespace" -> io.circe.Json.fromString(namespace), "event" -> value).noSpaces)
  def fingerprint(event: CapturedEvent, eventId: UUID): String =
    fingerprint(event.sourceNamespace, payload(event.scope, eventId, event.context, event.origin, event.metadata, event.text, event.observation, event.reviewResponse))
  def occurrence(request: IngestRequest): ContextRecord = Contexts.normalize(request.occurrenceContext, Contexts.MissingOccurrence, Contexts.ProtocolLimits)
  def fingerprint(namespace: String, request: IngestRequest): String =
    fingerprint(namespace, payload(request.scope, request.eventId, occurrence(request), request.origin, request.metadata, request.text, request.observation, None))
}
final class CaptureEngine {
  private def path(value: String): Unit = Require(value.nonEmpty && value.length <= 4096 && !value.startsWith("/") && !value.contains('\\') && value.split("/", -1).forall(p => p.nonEmpty && p != "." && p != ".."), "observation", "portable workspace-relative path required")
  private def file(observation: Observation): Option[(String, Long)] = observation match {
    case value: Observation.FileVersion => Some((value.path, value.generation))
    case value: Observation.FileAbsent => Some((value.path, value.generation))
    case _ => None
  }
  def validateIngress(input: IngestRequest, principal: Principal): Unit = {
    principal.require(input.scope, Capability.Capture)
    CaptureIdentity.occurrence(input)
    Contexts.normalize(input.contributionContext, Contexts.MissingContribution, Contexts.ProtocolLimits)
    Require(input.metadata.sourceId.nonEmpty && input.metadata.sourceId.length <= 1024 && input.metadata.omissions.size <= 64 && input.metadata.omissions.forall(x => x.nonEmpty && x.length <= 1024), "capture", "invalid source metadata")
    input.metadata.observedAt.foreach { value => try Instant.parse(value) catch { case _: Exception => throw Fault("capture", "invalid source-reported timestamp") } }
    val noObservation = input.observation.isInstanceOf[Observation.None]
    principal.actor.kind match {
      case ActorKind.Human => Require(input.origin == EventOrigin.UserMessage && input.metadata.representation == SourceRepresentation.Text && noObservation, "capture-origin", "Human text ingress cannot mint host facts")
      case ActorKind.Agent => Require(input.origin == EventOrigin.WorkerMessage && input.metadata.representation == SourceRepresentation.Text && noObservation, "capture-origin", "Agent ingress is a worker account only")
      case ActorKind.Collector => Require(Set(EventOrigin.UserMessage, EventOrigin.WorkerMessage, EventOrigin.ToolOutput).contains(input.origin) && input.metadata.representation == SourceRepresentation.PiTranscript && noObservation, "capture-origin", "transcript capture is not a host attestation")
      case ActorKind.Service =>
        principal.require(input.scope, Capability.HostCapture)
        Require(input.origin == EventOrigin.ToolOutput && input.metadata.representation == SourceRepresentation.HostReceipt && !noObservation, "capture-origin", "host ingress requires an explicit observation")
        Contexts.reportedNative(CaptureIdentity.occurrence(input), Contexts.ProtocolLimits)
      case _ => throw Fault("capture-origin", "unsupported capture principal")
    }
  }
  def apply(base: GraphSnapshot, prior: List[CapturedEvent], frontier: Long, input: IngestRequest, principal: Principal, recorder: Actor, receivedAt: String, ingress: RequestTrace): Captured = {
    validateIngress(input, principal)
    Graph.validateCounters(base)
    Require(input.scope == base.scope && frontier == base.sourceFrontier, "scope", "capture scope/frontier mismatch")
    val context = CaptureIdentity.occurrence(input)
    input.observation match {
      case value: Observation.FileVersion =>
        path(value.path); Require(value.generation > 0 && value.length >= 0 && value.digest.matches("[0-9a-f]{64}"), "observation", "invalid file witness")
      case value: Observation.FileAbsent => path(value.path); Require(value.generation > 0, "observation", "invalid absent-file generation")
      case value: Observation.Execution =>
        Require(value.action.nonEmpty && value.checker.nonEmpty, "observation", "action and checker identities required")
        value.contract.foreach(ref => Graph.binding(base, ref))
        value.artifacts.foreach(ref => Require(Graph.node(base, ref).content.isInstanceOf[Content.Artifact], "observation", "execution input must reference captured artifact"))
      case _: Observation.None => ()
    }
    file(input.observation).foreach { coordinate =>
      prior.filter(e => e.sourceNamespace == principal.credentialId && Contexts.nativeOption(e.context).map(_.epoch) == Contexts.nativeOption(context).map(_.epoch) && file(e.observation).contains(coordinate)).foreach { previous =>
        Require(previous.observation == input.observation, "observation-conflict", "one observation generation has conflicting values")
      }
    }
    val source = CaptureIdentity.source(principal.credentialId, input.eventId)
    Require(!Graph.exists(base, source), "identity", "capture reference already exists")
    val contributor = if (principal.actor.kind == ActorKind.Collector) Actor("unattributed:" + source.id, ActorKind.Unknown) else principal.actor
    val inputId = InputReceipts.id(InputKind.Capture, principal.credentialId, input.requestId)
    val provenance = Provenance(contributor, recorder, inputId, receivedAt)
    val event = CapturedEvent(source.id, input.scope, principal.credentialId, Math.addExact(frontier, 1L), context, input.origin, input.metadata, input.text, input.observation, None, provenance)
    val artifacts = input.observation match {
      case value: Observation.FileVersion =>
        val key = CaptureIdentity.artifactKey(input.scope, principal.credentialId, Contexts.reportedNative(context, Contexts.ProtocolLimits), value)
        val ref = CaptureIdentity.artifacts(event).head
        List(Definition(ref, input.scope, Applicability.Captured(source), Content.Artifact("Host file witness: " + value.path, value.digest, "application/octet-stream", "urn:ontology:observed-file:" + Digests.text(key), value.generation), Standing.Active, Nil, None, provenance))
      case _ => Nil
    }
    val artifactRefs = artifacts.map(_.ref)
    val definition = CaptureIdentity.definition(event)
    val actors = List(contributor, recorder, principal.actor).distinct.filterNot(a => base.actors.exists(_.value == a)).map { actor => ActorRecord(Ref(UUID.nameUUIDFromBytes(("actor:" + actor.kind + ":" + actor.id).getBytes(UTF_8)), 1), actor) }
    val additions = artifacts.filterNot(a => base.definitions.exists(_.ref == a.ref))
    val changed = base.copy(generation = Math.addExact(base.generation, 1L), sourceFrontier = event.frontier, definitions = base.definitions ++ additions :+ definition, actors = base.actors ++ actors)
    (additions :+ definition).foreach(value => Applicabilities.validate(changed, value.applicability, true))
    val receipt = InputReceipts.create(inputId, input.scope, changed.generation, InputKind.Capture, contributor, recorder, principal.actor, "ontology.api.IngestRequest/0.1.0 canonical JSON", Wire.encode(IngestRequest.codecJson, input).noSpaces, receivedAt, Contexts.contribution(input.contributionContext, ingress, Contexts.ProtocolLimits), ingress)
    Captured(changed, event, IngestResult(input.scope, input.requestId, input.eventId, principal.credentialId, source, artifactRefs, event.frontier, false), receipt)
  }
}
