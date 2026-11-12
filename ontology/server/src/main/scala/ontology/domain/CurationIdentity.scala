package ontology.domain

import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import ontology.api.*

object CurationIdentity {
  val Operation = "curation.publish"
  val Encoding = "ontology.api.CurationPublicationInput/0.1.0 canonical JSON"
  def input(scope: String, attemptId: UUID): Ref = Ref(InputReceipts.id(InputKind.Curation, scope, attemptId), 1)
  def record(scope: String, attemptId: UUID, alias: String): Ref = {
    val parts = List("ontology-curation-v1", "record", scope, attemptId.toString, alias)
    Ref(UUID.nameUUIDFromBytes(Json.fromValues(parts.map(Json.fromString)).noSpaces.getBytes(UTF_8)), 1)
  }
}
