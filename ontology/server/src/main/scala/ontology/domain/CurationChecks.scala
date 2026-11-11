package ontology.domain

import ontology.api.*
import ontology.Digests
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.time.format.DateTimeParseException

final case class CurationGuardLimits(maxOrdinals: Int, maxAuditBytes: Int, maxInputBytes: Long, maxPins: Int, maxLabelChars: Int) {
  Require(maxOrdinals > 0 && maxAuditBytes > 0 && maxInputBytes > 0 && maxPins > 0 && maxLabelChars > 0,
    "config", "positive curation bounds required")
}
final case class CurationPublicationPlan(generation: Long, frontier: Long, coveredFrontier: Long)

private[domain] object CurationChecks {
  def check(value: Boolean, message: String): Unit = Require(value, "curation", message)
  def instant(value: String): Instant = try Instant.parse(value) catch {
    case _: DateTimeParseException => throw Fault("curation", "invalid stored curation timestamp")
  }
  def digest(value: String): Unit = check(value.matches("[0-9a-f]{64}"), "invalid curation digest")
  def label(value: String, limits: CurationGuardLimits): Unit =
    check(value.trim.nonEmpty && value.length <= limits.maxLabelChars, "invalid bounded curation label")
  def payload(value: CurationAuditPayload, limits: CurationGuardLimits): Unit = {
    label(value.encoding, limits)
    check(UTF_8.newEncoder().canEncode(value.content), "invalid audit text")
    val bytes = value.content.getBytes(UTF_8)
    check(bytes.length <= limits.maxAuditBytes && value.bytes == bytes.length.toLong && value.digest == Digests.bytes(bytes), "audit payload binding mismatch")
  }
}
