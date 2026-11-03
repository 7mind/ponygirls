import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package haystack.api {
  final case class PutRequest(
    key: String,
    document: DocumentPayload,
    expectedRevision: Int,
    requestId: UUID
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = PutRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = PutRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PutRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PutRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PutRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PutRequest.baboonMinReaderVersions
  }
  
  object PutRequest {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#PutRequest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[PutRequest] = PutRequest_JsonCodec.instance
  }
  
  object PutRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[PutRequest, BaboonJsonCodec[PutRequest]] {
    def encode(ctx: BaboonCodecContext, value: PutRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "key" -> Json.fromString(value.key),
        "document" -> DocumentPayload_JsonCodec.instance.encode(ctx, value.document),
        "expectedRevision" -> Json.fromInt(value.expectedRevision),
        "requestId" -> Json.fromString(value.requestId.toString())
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PutRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            key <- getField(jsonObject, "key").flatMap(v => decodeString(v.hcursor))
            document <- getField(jsonObject, "document").flatMap(v => DocumentPayload_JsonCodec.circeDecoder(v.hcursor))
            expectedRevision <- getField(jsonObject, "expectedRevision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
          } yield PutRequest(key,document,expectedRevision,requestId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PutRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PutRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PutRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PutRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PutRequest]] = Lazy(PutRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PutRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PutRequest] = LazyInstance.value
  }
}