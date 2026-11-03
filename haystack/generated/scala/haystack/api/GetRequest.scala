import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class GetRequest(
    key: String,
    revision: Option[Int]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = GetRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = GetRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = GetRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = GetRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = GetRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = GetRequest.baboonMinReaderVersions
  }
  
  object GetRequest {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#GetRequest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[GetRequest] = GetRequest_JsonCodec.instance
  }
  
  object GetRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[GetRequest, BaboonJsonCodec[GetRequest]] {
    def encode(ctx: BaboonCodecContext, value: GetRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "key" -> Json.fromString(value.key),
        "revision" -> value.revision.map(v => Json.fromInt(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GetRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            key <- getField(jsonObject, "key").flatMap(v => decodeString(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
          } yield GetRequest(key,revision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = GetRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = GetRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = GetRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GetRequest]] = Lazy(GetRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[GetRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[GetRequest] = LazyInstance.value
  }
}