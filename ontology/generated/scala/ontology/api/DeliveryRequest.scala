import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class DeliveryRequest(
    scope: String,
    requestId: UUID,
    capsuleId: UUID,
    generation: Long,
    frontier: Long,
    context: CaptureContext,
    payloadDigest: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = DeliveryRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = DeliveryRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = DeliveryRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = DeliveryRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = DeliveryRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = DeliveryRequest.baboonMinReaderVersions
  }
  
  object DeliveryRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#DeliveryRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[DeliveryRequest] = DeliveryRequest_JsonCodec.instance
  }
  
  object DeliveryRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[DeliveryRequest, BaboonJsonCodec[DeliveryRequest]] {
    def encode(ctx: BaboonCodecContext, value: DeliveryRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "capsuleId" -> Json.fromString(value.capsuleId.toString()),
        "generation" -> Json.fromString(value.generation.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "context" -> CaptureContext_JsonCodec.instance.encode(ctx, value.context),
        "payloadDigest" -> Json.fromString(value.payloadDigest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, DeliveryRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            capsuleId <- getField(jsonObject, "capsuleId").flatMap(v => decodeUUID(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            context <- getField(jsonObject, "context").flatMap(v => CaptureContext_JsonCodec.circeDecoder(v.hcursor))
            payloadDigest <- getField(jsonObject, "payloadDigest").flatMap(v => decodeString(v.hcursor))
          } yield DeliveryRequest(scope,requestId,capsuleId,generation,frontier,context,payloadDigest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to DeliveryRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = DeliveryRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = DeliveryRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = DeliveryRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[DeliveryRequest]] = Lazy(DeliveryRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[DeliveryRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[DeliveryRequest] = LazyInstance.value
  }
}