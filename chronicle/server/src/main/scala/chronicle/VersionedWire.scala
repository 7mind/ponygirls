package chronicle

import chronicle.api.*
import chronicle.protocol.ProtocolConversions
import io.circe.Json

/** One protocol codec and conversion registry set per application DI graph. */
final class VersionedWire(conversions: ProtocolConversions) {
  import Wire.{decode,encode}
  def decodeClient(version: String,json: Json): ClientEnvelope = version match {
    case "1.0.0" => conversions.up1_1_0.convert[chronicle.api.v1_1_0.ClientEnvelope,ClientEnvelope](conversions.up1_0_0.convert[chronicle.api.v1_0_0.ClientEnvelope,chronicle.api.v1_1_0.ClientEnvelope](decode(chronicle.api.v1_0_0.ClientEnvelope.codecJson,json)))
    case "1.1.0" => conversions.up1_1_0.convert[chronicle.api.v1_1_0.ClientEnvelope,ClientEnvelope](decode(chronicle.api.v1_1_0.ClientEnvelope.codecJson,json))
    case "1.2.0" => decode(ClientEnvelope.codecJson,json)
    case _ => throw DomainError("version-mismatch","unsupported API version")
  }
  def encodeServer(version: String,envelope: ServerEnvelope): Json = version match {
    case "1.0.0" => encode(chronicle.api.v1_0_0.ServerEnvelope.codecJson,conversions.down1_0_0.convert[chronicle.api.v1_1_0.ServerEnvelope,chronicle.api.v1_0_0.ServerEnvelope](conversions.down1_1_0.convert[ServerEnvelope,chronicle.api.v1_1_0.ServerEnvelope](envelope)))
    case "1.1.0" => encode(chronicle.api.v1_1_0.ServerEnvelope.codecJson,conversions.down1_1_0.convert[ServerEnvelope,chronicle.api.v1_1_0.ServerEnvelope](envelope))
    case "1.2.0" => encode(ServerEnvelope.codecJson,envelope)
    case _ => throw DomainError("version-mismatch","unsupported API version")
  }
}
