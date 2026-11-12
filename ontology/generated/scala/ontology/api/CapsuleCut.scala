import io.circe.Decoder.decodeOption
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CapsuleCut(
    generation: Long,
    frontier: Long,
    coveredFrontier: Long,
    lastPublicationGeneration: Option[Long],
    attempt: Option[CurationAttemptSummary]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapsuleCut.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapsuleCut.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapsuleCut.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapsuleCut.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapsuleCut.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapsuleCut.baboonMinReaderVersions
  }
  
  object CapsuleCut {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapsuleCut"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapsuleCut] = CapsuleCut_JsonCodec.instance
  }
  
  object CapsuleCut_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapsuleCut, BaboonJsonCodec[CapsuleCut]] {
    def encode(ctx: BaboonCodecContext, value: CapsuleCut): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "generation" -> Json.fromString(value.generation.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "coveredFrontier" -> Json.fromString(value.coveredFrontier.toString),
        "lastPublicationGeneration" -> value.lastPublicationGeneration.map(v => Json.fromString(v.toString)).getOrElse(Json.Null),
        "attempt" -> value.attempt.map(v => CurationAttemptSummary_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsuleCut] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            coveredFrontier <- getField(jsonObject, "coveredFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            lastPublicationGeneration <- getField(jsonObject, "lastPublicationGeneration").flatMap(v => decodeOption(BaboonJsonCodec.decodeLong)(v.hcursor))
            attempt <- getField(jsonObject, "attempt").flatMap(v => decodeOption(CurationAttemptSummary_JsonCodec.circeDecoder)(v.hcursor))
          } yield CapsuleCut(generation,frontier,coveredFrontier,lastPublicationGeneration,attempt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapsuleCut: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapsuleCut.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapsuleCut.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapsuleCut.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsuleCut]] = Lazy(CapsuleCut_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsuleCut]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsuleCut] = LazyInstance.value
  }
}