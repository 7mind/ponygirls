import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CurationStatus(
    scope: String,
    generation: Long,
    frontier: Long,
    coveredFrontier: Long,
    state: CurationState,
    failure: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationStatus.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationStatus.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationStatus.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationStatus.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationStatus.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationStatus.baboonMinReaderVersions
  }
  
  object CurationStatus {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationStatus"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationStatus] = CurationStatus_JsonCodec.instance
  }
  
  object CurationStatus_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationStatus, BaboonJsonCodec[CurationStatus]] {
    def encode(ctx: BaboonCodecContext, value: CurationStatus): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "coveredFrontier" -> Json.fromString(value.coveredFrontier.toString),
        "state" -> CurationState_JsonCodec.instance.encode(ctx, value.state),
        "failure" -> value.failure.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationStatus] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            coveredFrontier <- getField(jsonObject, "coveredFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => CurationState_JsonCodec.circeDecoder(v.hcursor))
            failure <- getField(jsonObject, "failure").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield CurationStatus(scope,generation,frontier,coveredFrontier,state,failure)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationStatus: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationStatus.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationStatus.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationStatus.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationStatus]] = Lazy(CurationStatus_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationStatus]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationStatus] = LazyInstance.value
  }
}