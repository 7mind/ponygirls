import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CapsuleRequest(
    scope: String,
    requestId: UUID,
    workContext: String,
    reportedContext: Option[ContextRecordInput],
    expectedFrontier: Long,
    previousCapsuleId: Option[UUID]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapsuleRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapsuleRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapsuleRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapsuleRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapsuleRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapsuleRequest.baboonMinReaderVersions
  }
  
  object CapsuleRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapsuleRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapsuleRequest] = CapsuleRequest_JsonCodec.instance
  }
  
  object CapsuleRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapsuleRequest, BaboonJsonCodec[CapsuleRequest]] {
    def encode(ctx: BaboonCodecContext, value: CapsuleRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "workContext" -> Json.fromString(value.workContext),
        "reportedContext" -> value.reportedContext.map(v => ContextRecordInput_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "expectedFrontier" -> Json.fromString(value.expectedFrontier.toString),
        "previousCapsuleId" -> value.previousCapsuleId.map(v => Json.fromString(v.toString())).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsuleRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            workContext <- getField(jsonObject, "workContext").flatMap(v => decodeString(v.hcursor))
            reportedContext <- getField(jsonObject, "reportedContext").flatMap(v => decodeOption(ContextRecordInput_JsonCodec.circeDecoder)(v.hcursor))
            expectedFrontier <- getField(jsonObject, "expectedFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            previousCapsuleId <- getField(jsonObject, "previousCapsuleId").flatMap(v => decodeOption(decodeUUID)(v.hcursor))
          } yield CapsuleRequest(scope,requestId,workContext,reportedContext,expectedFrontier,previousCapsuleId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapsuleRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapsuleRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapsuleRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapsuleRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsuleRequest]] = Lazy(CapsuleRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsuleRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsuleRequest] = LazyInstance.value
  }
}