import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class DeliveryRequest(
    scope: String,
    requestId: UUID,
    capsuleId: UUID,
    capsulePayloadDigest: String,
    workContext: String,
    reportedContext: Option[ContextRecordInput],
    boundary: DeliveryBoundary,
    reportedAt: Option[String],
    reportedBoundaryPayload: Option[ReportedBoundaryDigest]
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
        "capsulePayloadDigest" -> Json.fromString(value.capsulePayloadDigest),
        "workContext" -> Json.fromString(value.workContext),
        "reportedContext" -> value.reportedContext.map(v => ContextRecordInput_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "boundary" -> DeliveryBoundary_JsonCodec.instance.encode(ctx, value.boundary),
        "reportedAt" -> value.reportedAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "reportedBoundaryPayload" -> value.reportedBoundaryPayload.map(v => ReportedBoundaryDigest_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
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
            capsulePayloadDigest <- getField(jsonObject, "capsulePayloadDigest").flatMap(v => decodeString(v.hcursor))
            workContext <- getField(jsonObject, "workContext").flatMap(v => decodeString(v.hcursor))
            reportedContext <- getField(jsonObject, "reportedContext").flatMap(v => decodeOption(ContextRecordInput_JsonCodec.circeDecoder)(v.hcursor))
            boundary <- getField(jsonObject, "boundary").flatMap(v => DeliveryBoundary_JsonCodec.circeDecoder(v.hcursor))
            reportedAt <- getField(jsonObject, "reportedAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            reportedBoundaryPayload <- getField(jsonObject, "reportedBoundaryPayload").flatMap(v => decodeOption(ReportedBoundaryDigest_JsonCodec.circeDecoder)(v.hcursor))
          } yield DeliveryRequest(scope,requestId,capsuleId,capsulePayloadDigest,workContext,reportedContext,boundary,reportedAt,reportedBoundaryPayload)
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