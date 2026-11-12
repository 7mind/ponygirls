package ontology.http

import io.circe.Json
import ontology.WireSchemas
import ontology.api.*

final class CompiledToolSchemas extends ToolSchemas {
  val find: Json = WireSchemas.schema(FindRequest.codecJson)
  val read: Json = WireSchemas.schema(ReadRequest.codecJson)
  val apply: Json = WireSchemas.schema(ApplyRequest.codecJson)
}
