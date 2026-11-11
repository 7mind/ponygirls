package ontology.domain

import ontology.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

object ReviewIdentity {
  private def identity(kind: String, scope: String, actor: Actor, requestId: UUID): UUID = UUID.nameUUIDFromBytes(
    Json.arr(Json.fromString("ontology-review-v1"), Json.fromString(kind), Json.fromString(scope), Json.fromString(actor.kind.toString), Json.fromString(actor.id), Json.fromString(requestId.toString)).noSpaces.getBytes(UTF_8))
  def judgment(scope: String, actor: Actor, requestId: UUID): UUID = identity("judgment", scope, actor, requestId)
  def source(scope: String, actor: Actor, requestId: UUID): Ref = Ref(identity("action-source", scope, actor, requestId), 1)
  def relation(scope: String, actor: Actor, requestId: UUID): Ref = Ref(identity("action-relation", scope, actor, requestId), 1)
  def input(namespace: String, requestId: UUID): Ref = Ref(InputReceipts.id(InputKind.Judgment, namespace, requestId), 1)
}
