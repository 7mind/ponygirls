package ontology.domain

import ontology.api.*
import ontology.Digests
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8

object InputReceipts {
  def id(kind: InputKind, namespace: String, requestId: UUID): UUID = UUID.nameUUIDFromBytes(("input:" + kind + ":" + namespace + ":" + requestId).getBytes(UTF_8))
  def graphId(actor: Actor, requestId: UUID): UUID = id(InputKind.GraphMutation, actor.kind.toString + ":" + actor.id, requestId)
  def create(id: UUID, scope: String, generation: Long, kind: InputKind, contributor: Actor, recorder: Actor, submitter: Actor, encoding: String, content: String, recordedAt: String): InputReceipt =
    InputReceipt(Ref(id, 1), scope, generation, kind, contributor, recorder, submitter, encoding, content, Digests.text(content), recordedAt)
}
