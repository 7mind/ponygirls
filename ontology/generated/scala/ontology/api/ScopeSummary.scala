import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ScopeSummary(
    scope: String,
    generation: Long,
    frontier: Long,
    coveredFrontier: Long,
    curation: CurationState,
    failure: Option[String],
    rdfGeneration: Option[Long],
    lastPublicationGeneration: Option[Long],
    attempt: Option[CurationAttemptSummary]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ScopeSummary.baboonDomainVersion
    override def baboonDomainIdentifier: String = ScopeSummary.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ScopeSummary.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ScopeSummary.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ScopeSummary.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ScopeSummary.baboonMinReaderVersions
  }
  
  object ScopeSummary {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ScopeSummary"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ScopeSummary] = ScopeSummary_JsonCodec.instance
  }
  
  object ScopeSummary_JsonCodec extends BaboonJsonCodec.BaseGenerated[ScopeSummary, BaboonJsonCodec[ScopeSummary]] {
    def encode(ctx: BaboonCodecContext, value: ScopeSummary): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "coveredFrontier" -> Json.fromString(value.coveredFrontier.toString),
        "curation" -> CurationState_JsonCodec.instance.encode(ctx, value.curation),
        "failure" -> value.failure.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "rdfGeneration" -> value.rdfGeneration.map(v => Json.fromString(v.toString)).getOrElse(Json.Null),
        "lastPublicationGeneration" -> value.lastPublicationGeneration.map(v => Json.fromString(v.toString)).getOrElse(Json.Null),
        "attempt" -> value.attempt.map(v => CurationAttemptSummary_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ScopeSummary] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            coveredFrontier <- getField(jsonObject, "coveredFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            curation <- getField(jsonObject, "curation").flatMap(v => CurationState_JsonCodec.circeDecoder(v.hcursor))
            failure <- getField(jsonObject, "failure").flatMap(v => decodeOption(decodeString)(v.hcursor))
            rdfGeneration <- getField(jsonObject, "rdfGeneration").flatMap(v => decodeOption(BaboonJsonCodec.decodeLong)(v.hcursor))
            lastPublicationGeneration <- getField(jsonObject, "lastPublicationGeneration").flatMap(v => decodeOption(BaboonJsonCodec.decodeLong)(v.hcursor))
            attempt <- getField(jsonObject, "attempt").flatMap(v => decodeOption(CurationAttemptSummary_JsonCodec.circeDecoder)(v.hcursor))
          } yield ScopeSummary(scope,generation,frontier,coveredFrontier,curation,failure,rdfGeneration,lastPublicationGeneration,attempt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ScopeSummary: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ScopeSummary.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ScopeSummary.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ScopeSummary.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ScopeSummary]] = Lazy(ScopeSummary_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ScopeSummary]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ScopeSummary] = LazyInstance.value
  }
}