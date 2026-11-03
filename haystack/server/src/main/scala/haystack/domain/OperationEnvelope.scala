package haystack.domain

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale
import ponygirls.losslessjson.LosslessJson

final case class OperationDigest(format: String, hex: String)
object OperationDigest {
  /** One current format. Intentionally not the historical JavaScript digest:
    * versioned shared encoding includes original numeric tokens and UTF-16 key
    * ordering. Deployments must preserve existing acknowledged writes/history;
    * this does not imply old wire/replay digest interoperability.
    */
  val Format = "haystack-op-scala-v1"
  val ApiVersion = "v1"

  def canonicalBytes(key: ItemKey, expectedRevision: Long, documentCanonical: String): Array[Byte] = {
    if (expectedRevision < 0) throw Fault("bad-envelope", "expected_revision must be nonnegative")
    canonicalBytes(key, expectedRevision, DocumentCodec.parseRaw(documentCanonical))
  }
  def canonicalBytes(key: ItemKey, expectedRevision: Long, document: LosslessJson.Value): Array[Byte] = {
    if (expectedRevision < 0) throw Fault("bad-envelope", "expected_revision must be nonnegative")
    val canonical = LosslessJson.encode(document)
    ("[" + JsonText.quote(Format) + "," + JsonText.quote(LosslessJson.EncodingVersion) + "," +
      JsonText.quote(ApiVersion) + "," + JsonText.quote(key.qualified) + "," + expectedRevision + "," + canonical + "]")
      .getBytes(StandardCharsets.UTF_8)
  }
  def compute(key: ItemKey, expectedRevision: Long, documentCanonical: String): OperationDigest =
    OperationDigest(Format, sha256(canonicalBytes(key, expectedRevision, documentCanonical)))

  def compute(key: ItemKey, expectedRevision: Long, document: LosslessJson.Value): OperationDigest =
    OperationDigest(Format, sha256(canonicalBytes(key, expectedRevision, document)))

  private[domain] def sha256(bytes: Array[Byte]): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).map(b => f"${b & 255}%02x").mkString
}

/** Accepted syntax can still have a terminal invalid-document outcome. A
  * repository records that Left under exactly the same replay/CAS identity as
  * a successful write; it must check replay before returning this outcome.
  */
final case class AcceptedOperation(
    key: ItemKey,
    requestId: String,
    expectedRevision: Long,
    documentCanonical: String,
    digest: OperationDigest,
    document: Either[Fault, ItemDocument]
)

object OperationEnvelope {
  private val RequestId = "(?i)^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$".r

  /** Uppercase UUID spellings normalize to one replay identity, not aliases. */
  def validateRequestId(requestId: String): String = {
    if (!RequestId.matches(requestId)) throw Fault("bad-envelope", "request_id must be a UUIDv7")
    requestId.toLowerCase(Locale.ROOT)
  }

  def accept(qualifiedKey: String, documentJson: String, expectedRevision: Long, requestId: String): AcceptedOperation = {
    val key = QualifiedId.decodeKey(qualifiedKey)
    val normalizedId = validateRequestId(requestId)
    if (expectedRevision < 0) throw Fault("bad-envelope", "expected_revision must be nonnegative")
    val raw = DocumentCodec.parseRaw(documentJson)
    val canonical = LosslessJson.encode(raw)
    val digest = OperationDigest.compute(key, expectedRevision, raw)
    val document = try Right(DocumentCodec.validate(raw)) catch { case fault: Fault => Left(fault) }
    AcceptedOperation(key, normalizedId, expectedRevision, canonical, digest, document)
  }
}
