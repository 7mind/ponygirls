package ontology.domain

import io.circe.Json
import ontology.api.*
import ontology.{Digests, Wire}
import ontology.curation.{CurationInput, CurationInputs}
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant

final case class SealedCurationInput(input: CurationInput, manifest: CurationInputManifest)
object CurationMaterial {
  import CurationChecks.*
  def graphDigest(graph: GraphSnapshot): String = Digests.text(Wire.encode(GraphSnapshot.codecJson, graph).noSpaces)
  def sourceDigest(sources: List[CapturedEvent]): String = Digests.text(Json.fromValues(sources.map(Wire.encode(CapturedEvent.codecJson, _))).noSpaces)

  def frozen(claim: CurationClaim, graph: GraphSnapshot, sources: List[CapturedEvent]): Unit = {
    Graph.validateCounters(graph)
    check(graph.scope == claim.scope && graph.generation == claim.baseGeneration && graph.sourceFrontier == claim.frontier &&
      graph.coveredFrontier == claim.previousCoveredFrontier && graphDigest(graph) == claim.graphDigest, "frozen graph differs from claim")
    check(sources.size.toLong == claim.frontier - claim.previousCoveredFrontier && sources.map(_.id).distinct.size == sources.size,
      "incomplete or duplicate frozen source cut")
    sources.zipWithIndex.foreach { case (event, index) =>
      check(event.scope == claim.scope && event.frontier == claim.previousCoveredFrontier + index.toLong + 1L, "source outside frozen ordered cut")
      val definition = Graph.node(graph, Ref(event.id, 1))
      val content = definition.content match { case value: Content.Source => value; case _ => throw Fault("curation", "frozen Source missing") }
      check(definition.scope == claim.scope && definition.provenance == event.provenance && content.text == event.text && content.rawDigest == Digests.text(event.text) &&
        content.descriptor == SourceDescriptor.PrimaryCapture(event.id, event.sourceNamespace, event.context, event.metadata, event.origin, event.observation, event.reviewResponse),
        "frozen event and Source differ")
    }
    check(sourceDigest(sources) == claim.sourceCutDigest, "frozen source-cut digest mismatch")
  }

  def seal(claim: CurationClaim, graph: GraphSnapshot, sources: List[CapturedEvent], at: Instant, limits: CurationGuardLimits): SealedCurationInput = {
    frozen(claim, graph, sources)
    check(!at.isBefore(instant(claim.claimedAt)), "input seal precedes claim")
    val seed = Graph.records(graph)
    check(seed.map(Graph.recordRef).distinct.size == seed.size && seed.size.toLong + sources.size.toLong <= limits.maxPins, "invalid or oversized frozen pin set")
    val input = CurationInput(claim.scope, claim.baseGeneration, claim.frontier, claim.previousCoveredFrontier, seed, sources)
    val encoded = CurationInputs.json(input).noSpaces
    check(UTF_8.newEncoder().canEncode(encoded), "invalid frozen input text")
    val bytes = encoded.getBytes(UTF_8)
    check(bytes.length.toLong <= limits.maxInputBytes, "frozen input exceeds capacity")
    val records = seed.map(record => CurationRecordPin(Graph.recordRef(record), Digests.text(Wire.encode(GraphRecord.codecJson, record).noSpaces)))
    val events = sources.map(event => CurationSourcePin(Ref(event.id, 1), event.frontier, Digests.text(Wire.encode(CapturedEvent.codecJson, event).noSpaces)))
    SealedCurationInput(input, CurationInputManifest(claim.attemptId, records, events, CurationInputs.Encoding, Digests.bytes(bytes), bytes.length.toLong, at.toString))
  }

  def verify(claim: CurationClaim, graph: GraphSnapshot, sources: List[CapturedEvent], manifest: CurationInputManifest, limits: CurationGuardLimits): Unit =
    check(seal(claim, graph, sources, instant(manifest.sealedAt), limits).manifest == manifest, "input manifest differs from actual frozen bytes and pins")
}
