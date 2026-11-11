package ontology.domain

import ontology.api.*
import ontology.{Digests, StoredJson}
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8

object InputReceipts {
  def id(kind: InputKind, namespace: String, requestId: UUID): UUID = UUID.nameUUIDFromBytes(("input:" + kind + ":" + namespace + ":" + requestId).getBytes(UTF_8))
  def graphId(actor: Actor, requestId: UUID): UUID = id(InputKind.GraphMutation, actor.kind.toString + ":" + actor.id, requestId)
  def validateContext(receipt: InputReceipt): Unit = try {
    Contexts.server(receipt.ingress, Contexts.ProtocolLimits)
    Contexts.validateShape(receipt.contributionContext, Contexts.ProtocolLimits)
    val expected = receipt.kind match {
      case InputKind.GraphMutation => Some(StoredJson.decode(ApplyRequest.codecJson, receipt.content).contributionContext)
      case InputKind.Capture => Some(StoredJson.decode(IngestRequest.codecJson, receipt.content).contributionContext)
      case InputKind.Curation => None
    }
    expected.foreach(input => Require(receipt.contributionContext == Contexts.contribution(input, receipt.ingress, Contexts.ProtocolLimits), "corrupt", "receipt context differs from retained contribution"))
  } catch { case _: Fault => throw Fault("corrupt", "invalid retained receipt context") }
  def create(id: UUID, scope: String, generation: Long, kind: InputKind, contributor: Actor, recorder: Actor, submitter: Actor, encoding: String, content: String, recordedAt: String, contributionContext: ContextRecord, ingress: RequestTrace): InputReceipt =
    InputReceipt(Ref(id, 1), scope, generation, kind, contributor, recorder, submitter, encoding, content, Digests.text(content), recordedAt, contributionContext, ingress)
}
