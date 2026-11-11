package ontology.curation

import io.circe.Json
import ontology.WireSchemas
import ontology.api.*

final class CompiledCurationSchemas extends CurationSchemas {
  val find: Json = WireSchemas.schema(FindRequest.codecJson)
  val read: Json = WireSchemas.schema(ReadRequest.codecJson)
  val proposal: Json = WireSchemas.schema(CurationProposal.codecJson)
}
