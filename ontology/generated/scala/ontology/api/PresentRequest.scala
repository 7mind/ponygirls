import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class PresentRequest(
    scope: String,
    targets: List[Ref],
    expectedGeneration: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = PresentRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = PresentRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PresentRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PresentRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PresentRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PresentRequest.baboonMinReaderVersions
  }
  
  object PresentRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#PresentRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[PresentRequest] = PresentRequest_JsonCodec.instance
  }
  
  object PresentRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[PresentRequest, BaboonJsonCodec[PresentRequest]] {
    def encode(ctx: BaboonCodecContext, value: PresentRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "targets" -> Json.fromValues(value.targets.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "expectedGeneration" -> Json.fromString(value.expectedGeneration.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            targets <- getField(jsonObject, "targets").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            expectedGeneration <- getField(jsonObject, "expectedGeneration").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield PresentRequest(scope,targets,expectedGeneration)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PresentRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PresentRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PresentRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PresentRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentRequest]] = Lazy(PresentRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PresentRequest] = LazyInstance.value
  }
}