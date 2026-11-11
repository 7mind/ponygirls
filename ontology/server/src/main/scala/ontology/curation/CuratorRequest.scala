package ontology.curation

import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import ontology.Digests
import ontology.api.CurationInputManifest
import ontology.domain.{Fault, Require}

object CuratorRequest {
  def verifyInput(request: Json, manifest: CurationInputManifest): Unit = {
    def check(value: Boolean, message: String): Unit = Require(value, "curation", message)
    val messages = request.hcursor.get[Vector[Json]]("messages").fold(_ => throw Fault("curation", "prepared request messages missing"), identity)
    check(messages.size >= 2, "prepared request prefix missing")
    def role(message: Json): String = message.hcursor.get[String]("role").fold(_ => throw Fault("curation", "prepared message role missing"), identity)
    check(role(messages.head) == "system" && messages.head.hcursor.get[String]("content").isRight && role(messages(1)) == "user" &&
      messages(1).asObject.exists(_.keys.toSet == Set("role", "content")), "prepared input message differs from protocol")
    check(messages.drop(2).forall(message => Set("assistant", "tool").contains(role(message))), "prepared continuation changes the input boundary")
    val content = messages(1).hcursor.get[String]("content").fold(_ => throw Fault("curation", "prepared input text missing"), identity)
    check(manifest.encoding == CurationInputs.Encoding && UTF_8.newEncoder().canEncode(content), "unsupported prepared input encoding")
    val bytes = content.getBytes(UTF_8)
    check(bytes.length.toLong == manifest.inputBytes && Digests.bytes(bytes) == manifest.inputDigest, "prepared request differs from sealed input bytes")
  }
}
