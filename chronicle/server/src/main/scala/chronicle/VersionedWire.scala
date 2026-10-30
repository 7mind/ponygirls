package chronicle

import chronicle.api.*
import io.circe.Json

/** The sole supported protocol codec boundary, scoped to the application DI graph. */
final class VersionedWire {
  def decodeClient(version: String,json: Json): ClientEnvelope = {
    Check(version==Wire.versions.current,"version-mismatch","unsupported API version")
    Wire.decode(ClientEnvelope.codecJson,json)
  }
  def encodeServer(version: String,envelope: ServerEnvelope): Json = {
    Check(version==Wire.versions.current,"version-mismatch","unsupported API version")
    Wire.encode(ServerEnvelope.codecJson,envelope)
  }
}
