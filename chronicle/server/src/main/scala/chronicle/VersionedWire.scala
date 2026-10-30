package chronicle

import chronicle.api.*
import chronicle.protocol.ProtocolConversions
import io.circe.Json

/** One protocol codec and conversion registry set per application DI graph. */
final class VersionedWire(conversions: ProtocolConversions) {
  import Wire.{decode,encode}
  private def upgrade17(envelope: chronicle.api.v1_7_0.ClientEnvelope): ClientEnvelope = conversions.up1_7_0.convert[chronicle.api.v1_7_0.ClientEnvelope,ClientEnvelope](envelope)
  private def upgrade16(envelope: chronicle.api.v1_6_0.ClientEnvelope): ClientEnvelope = upgrade17(conversions.up1_6_0.convert[chronicle.api.v1_6_0.ClientEnvelope,chronicle.api.v1_7_0.ClientEnvelope](envelope))
  private def upgrade15(envelope: chronicle.api.v1_5_0.ClientEnvelope): ClientEnvelope = upgrade16(conversions.up1_5_0.convert[chronicle.api.v1_5_0.ClientEnvelope,chronicle.api.v1_6_0.ClientEnvelope](envelope))
  private def upgrade14(envelope: chronicle.api.v1_4_0.ClientEnvelope): ClientEnvelope = upgrade15(conversions.up1_4_0.convert[chronicle.api.v1_4_0.ClientEnvelope,chronicle.api.v1_5_0.ClientEnvelope](envelope))
  private def upgrade13(envelope: chronicle.api.v1_3_0.ClientEnvelope): ClientEnvelope = upgrade14(conversions.up1_3_0.convert[chronicle.api.v1_3_0.ClientEnvelope,chronicle.api.v1_4_0.ClientEnvelope](envelope))
  private def upgrade12(envelope: chronicle.api.v1_2_0.ClientEnvelope): ClientEnvelope = upgrade13(conversions.up1_2_0.convert[chronicle.api.v1_2_0.ClientEnvelope,chronicle.api.v1_3_0.ClientEnvelope](envelope))
  private def downgrade17(envelope: ServerEnvelope): chronicle.api.v1_7_0.ServerEnvelope = conversions.down1_7_0.convert[ServerEnvelope,chronicle.api.v1_7_0.ServerEnvelope](envelope)
  private def downgrade16(envelope: ServerEnvelope): chronicle.api.v1_6_0.ServerEnvelope = conversions.down1_6_0.convert[chronicle.api.v1_7_0.ServerEnvelope,chronicle.api.v1_6_0.ServerEnvelope](downgrade17(envelope))
  private def downgrade15(envelope: ServerEnvelope): chronicle.api.v1_5_0.ServerEnvelope = conversions.down1_5_0.convert[chronicle.api.v1_6_0.ServerEnvelope,chronicle.api.v1_5_0.ServerEnvelope](downgrade16(envelope))
  private def downgrade14(envelope: ServerEnvelope): chronicle.api.v1_4_0.ServerEnvelope = conversions.down1_4_0.convert[chronicle.api.v1_5_0.ServerEnvelope,chronicle.api.v1_4_0.ServerEnvelope](downgrade15(envelope))
  private def downgrade13(envelope: ServerEnvelope): chronicle.api.v1_3_0.ServerEnvelope = conversions.down1_3_0.convert[chronicle.api.v1_4_0.ServerEnvelope,chronicle.api.v1_3_0.ServerEnvelope](downgrade14(envelope))
  private def downgrade12(envelope: ServerEnvelope): chronicle.api.v1_2_0.ServerEnvelope = conversions.down1_2_0.convert[chronicle.api.v1_3_0.ServerEnvelope,chronicle.api.v1_2_0.ServerEnvelope](downgrade13(envelope))
  def decodeClient(version: String,json: Json): ClientEnvelope = version match {
    case "1.0.0" => upgrade12(conversions.up1_1_0.convert[chronicle.api.v1_1_0.ClientEnvelope,chronicle.api.v1_2_0.ClientEnvelope](conversions.up1_0_0.convert[chronicle.api.v1_0_0.ClientEnvelope,chronicle.api.v1_1_0.ClientEnvelope](decode(chronicle.api.v1_0_0.ClientEnvelope.codecJson,json))))
    case "1.1.0" => upgrade12(conversions.up1_1_0.convert[chronicle.api.v1_1_0.ClientEnvelope,chronicle.api.v1_2_0.ClientEnvelope](decode(chronicle.api.v1_1_0.ClientEnvelope.codecJson,json)))
    case "1.2.0" => upgrade12(decode(chronicle.api.v1_2_0.ClientEnvelope.codecJson,json))
    case "1.3.0" => upgrade13(decode(chronicle.api.v1_3_0.ClientEnvelope.codecJson,json))
    case "1.4.0" => upgrade14(decode(chronicle.api.v1_4_0.ClientEnvelope.codecJson,json))
    case "1.5.0" => upgrade15(decode(chronicle.api.v1_5_0.ClientEnvelope.codecJson,json))
    case "1.6.0" => upgrade16(decode(chronicle.api.v1_6_0.ClientEnvelope.codecJson,json))
    case "1.7.0" => upgrade17(decode(chronicle.api.v1_7_0.ClientEnvelope.codecJson,json))
    case "1.8.0" => decode(ClientEnvelope.codecJson,json)
    case _ => throw DomainError("version-mismatch","unsupported API version")
  }
  def encodeServer(version: String,envelope: ServerEnvelope): Json = version match {
    case "1.0.0" => encode(chronicle.api.v1_0_0.ServerEnvelope.codecJson,conversions.down1_0_0.convert[chronicle.api.v1_1_0.ServerEnvelope,chronicle.api.v1_0_0.ServerEnvelope](conversions.down1_1_0.convert[chronicle.api.v1_2_0.ServerEnvelope,chronicle.api.v1_1_0.ServerEnvelope](downgrade12(envelope))))
    case "1.1.0" => encode(chronicle.api.v1_1_0.ServerEnvelope.codecJson,conversions.down1_1_0.convert[chronicle.api.v1_2_0.ServerEnvelope,chronicle.api.v1_1_0.ServerEnvelope](downgrade12(envelope)))
    case "1.2.0" => encode(chronicle.api.v1_2_0.ServerEnvelope.codecJson,downgrade12(envelope))
    case "1.3.0" => encode(chronicle.api.v1_3_0.ServerEnvelope.codecJson,downgrade13(envelope))
    case "1.4.0" => encode(chronicle.api.v1_4_0.ServerEnvelope.codecJson,downgrade14(envelope))
    case "1.5.0" => encode(chronicle.api.v1_5_0.ServerEnvelope.codecJson,downgrade15(envelope))
    case "1.6.0" => encode(chronicle.api.v1_6_0.ServerEnvelope.codecJson,downgrade16(envelope))
    case "1.7.0" => encode(chronicle.api.v1_7_0.ServerEnvelope.codecJson,downgrade17(envelope))
    case "1.8.0" => encode(ServerEnvelope.codecJson,envelope)
    case _ => throw DomainError("version-mismatch","unsupported API version")
  }
}
