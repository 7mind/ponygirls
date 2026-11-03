import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class ValuesRequest(
    field: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ValuesRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = ValuesRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ValuesRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ValuesRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ValuesRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ValuesRequest.baboonMinReaderVersions
  }
  
  object ValuesRequest {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#ValuesRequest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ValuesRequest] = ValuesRequest_JsonCodec.instance
  }
  
  object ValuesRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[ValuesRequest, BaboonJsonCodec[ValuesRequest]] {
    def encode(ctx: BaboonCodecContext, value: ValuesRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "field" -> Json.fromString(value.field)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ValuesRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            field <- getField(jsonObject, "field").flatMap(v => decodeString(v.hcursor))
          } yield ValuesRequest(field)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ValuesRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ValuesRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ValuesRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ValuesRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ValuesRequest]] = Lazy(ValuesRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ValuesRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ValuesRequest] = LazyInstance.value
  }
}