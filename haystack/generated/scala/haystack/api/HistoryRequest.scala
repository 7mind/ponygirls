import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class HistoryRequest(
    key: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = HistoryRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = HistoryRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = HistoryRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = HistoryRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = HistoryRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = HistoryRequest.baboonMinReaderVersions
  }
  
  object HistoryRequest {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#HistoryRequest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[HistoryRequest] = HistoryRequest_JsonCodec.instance
  }
  
  object HistoryRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[HistoryRequest, BaboonJsonCodec[HistoryRequest]] {
    def encode(ctx: BaboonCodecContext, value: HistoryRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "key" -> Json.fromString(value.key)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, HistoryRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            key <- getField(jsonObject, "key").flatMap(v => decodeString(v.hcursor))
          } yield HistoryRequest(key)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to HistoryRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = HistoryRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = HistoryRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = HistoryRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[HistoryRequest]] = Lazy(HistoryRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[HistoryRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[HistoryRequest] = LazyInstance.value
  }
}