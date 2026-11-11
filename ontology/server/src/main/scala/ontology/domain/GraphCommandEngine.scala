package ontology.domain

import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import io.circe.Json
import ontology.{Digests, Wire}
import ontology.api.*

final case class Commanded(snapshot: GraphSnapshot, event: CapturedEvent, result: ApplyResult, receipt: InputReceipt)

object GraphCommandIdentity {
  val Encoding = "ontology.api.ApplyRequest/0.1.0 canonical JSON"
  private def coordinates(scope: String, actor: Actor): List[Json] = List(Json.fromString(scope), Json.fromString(actor.kind.toString), Json.fromString(actor.id))
  def namespace(scope: String, actor: Actor): String = "graph-command:" + Digests.text(Json.fromValues(coordinates(scope, actor)).noSpaces)
  def source(scope: String, actor: Actor, requestId: UUID): Ref = Ref(UUID.nameUUIDFromBytes(Json.fromValues(
    List(Json.fromString("ontology.graph-command.source/v1")) ++ coordinates(scope, actor) ++ List(Json.fromString(requestId.toString))).noSpaces.getBytes(UTF_8)), 1)
  def operation(requestId: UUID, alias: String): Ref = Ref(UUID.nameUUIDFromBytes((requestId.toString + ":" + alias).getBytes(UTF_8)), 1)
  def created(request: ApplyRequest): List[AliasRef] = request.operations.map {
    case v: Operation.Create => AliasRef(v.alias, operation(request.requestId, v.alias))
    case v: Operation.Relate => AliasRef(v.alias, operation(request.requestId, v.alias))
    case v: Operation.Bind => AliasRef(v.alias, operation(request.requestId, v.alias))
    case v: Operation.SelectBinding => AliasRef(v.alias, operation(request.requestId, v.alias))
    case v: Operation.State => AliasRef(v.alias, operation(request.requestId, v.alias))
    case v: Operation.Revise => AliasRef(v.alias, Ref(v.ref.id, Math.addExact(v.ref.revision, 1)))
    case v: Operation.ReviseRelation => AliasRef(v.alias, Ref(v.ref.id, Math.addExact(v.ref.revision, 1)))
  }
  def event(request: ApplyRequest, receipt: InputReceipt, frontier: Long): CapturedEvent = {
    val ref = source(request.scope, receipt.contributor, request.requestId)
    CapturedEvent(ref.id, request.scope, namespace(request.scope, receipt.contributor), frontier,
      Contexts.server(receipt.ingress, Contexts.ProtocolLimits), EventOrigin.GraphCommand,
      CaptureMetadata(request.requestId.toString, None, None, SourceRepresentation.GraphCommand, Nil, Nil), receipt.content,
      Observation.None(), None, Provenance(receipt.contributor, receipt.recorder, receipt.ref.id, receipt.recordedAt))
  }
  def definition(event: CapturedEvent, result: ApplyResult): Definition = {
    val base = CaptureIdentity.definition(event)
    base.copy(content = base.content.asInstanceOf[Content.Source].copy(context = result.created.map(_.ref).distinct))
  }
  def append(applied: Applied, event: CapturedEvent): GraphSnapshot = {
    val source = definition(event, applied.result)
    Require(!Graph.exists(applied.snapshot, source.ref), "identity", "command source identity already exists")
    val actors = List(event.provenance.contributor, event.provenance.recorder).distinct.filterNot(a => applied.snapshot.actors.exists(_.value == a)).map { actor =>
      ActorRecord(Ref(UUID.nameUUIDFromBytes(("actor:" + actor.kind + ":" + actor.id).getBytes(UTF_8)), 1), actor)
    }
    val snapshot = applied.snapshot.copy(sourceFrontier = event.frontier, definitions = applied.snapshot.definitions :+ source, actors = applied.snapshot.actors ++ actors)
    Applicabilities.validate(snapshot, source.applicability, true)
    Graph.validateCounters(snapshot)
    snapshot
  }
}

final class GraphCommandEngine(engine: AdmissionEngine) {
  def apply(base: GraphSnapshot, request: ApplyRequest, admission: Admission): Commanded = {
    Require(admission.recorder.kind == ActorKind.Service, "actor", "command recorder must be a service")
    val applied = engine(base, request, admission)
    val body = Wire.encode(ApplyRequest.codecJson, request).noSpaces
    val receipt = InputReceipts.create(admission.provenance.input, request.scope, applied.snapshot.generation, InputKind.GraphMutation,
      admission.actor, admission.recorder, admission.actor, GraphCommandIdentity.Encoding, body, admission.recordedAt,
      Contexts.contribution(request.contributionContext, admission.ingress, Contexts.ProtocolLimits), admission.ingress)
    val event = GraphCommandIdentity.event(request, receipt, Math.addExact(base.sourceFrontier, 1L))
    val snapshot = GraphCommandIdentity.append(applied, event)
    GraphCommandIntegrity.validate(snapshot, event, applied.result, receipt, base, admission.reviewEvidence, engine)
    Commanded(snapshot, event, applied.result, receipt)
  }
}
