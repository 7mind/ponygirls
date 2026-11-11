package ontology.curation

import io.circe.Json
import ontology.api.*
import ontology.Wire

object CurationInputs {
  val Encoding = "ontology.curation.CurationInput/0.1.0 canonical JSON"
  def json(input: CurationInput): Json = Json.obj(
    "scope" -> Json.fromString(input.scope),
    "generation" -> Json.fromString(input.generation.toString),
    "frontier" -> Json.fromString(input.frontier.toString),
    "previousCoveredFrontier" -> Json.fromString(input.previousCoveredFrontier.toString),
    "seed" -> Json.arr(input.seed.map(Wire.encode(GraphRecord.codecJson, _))*),
    "sources" -> Json.arr(input.sources.map(Wire.encode(CapturedEvent.codecJson, _))*)
  )
}
