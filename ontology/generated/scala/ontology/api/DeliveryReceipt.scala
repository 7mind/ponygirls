import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class DeliveryReceipt(
    id: UUID,
    requestId: UUID,
    owner: Actor,
    scope: String,
    capsuleId: UUID,
    capsulePayloadDigest: String,
    workContext: String,
    reportedContext: ContextRecord,
    boundary: DeliveryBoundary,
    reportedAt: Option[String],
    reportedBoundaryPayload: Option[ReportedBoundaryDigest],
    receivedAt: String,
    ingress: RequestTrace,
    observedCut: CapsuleCut,
    cutComparison: DeliveryCutComparison
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = DeliveryReceipt.baboonDomainVersion
    override def baboonDomainIdentifier: String = DeliveryReceipt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = DeliveryReceipt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = DeliveryReceipt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = DeliveryReceipt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = DeliveryReceipt.baboonMinReaderVersions
  }
  
  object DeliveryReceipt {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#DeliveryReceipt"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[DeliveryReceipt] = DeliveryReceipt_JsonCodec.instance
  }
  
  object DeliveryReceipt_JsonCodec extends BaboonJsonCodec.BaseGenerated[DeliveryReceipt, BaboonJsonCodec[DeliveryReceipt]] {
    def encode(ctx: BaboonCodecContext, value: DeliveryReceipt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "owner" -> Actor_JsonCodec.instance.encode(ctx, value.owner),
        "scope" -> Json.fromString(value.scope),
        "capsuleId" -> Json.fromString(value.capsuleId.toString()),
        "capsulePayloadDigest" -> Json.fromString(value.capsulePayloadDigest),
        "workContext" -> Json.fromString(value.workContext),
        "reportedContext" -> ContextRecord_JsonCodec.instance.encode(ctx, value.reportedContext),
        "boundary" -> DeliveryBoundary_JsonCodec.instance.encode(ctx, value.boundary),
        "reportedAt" -> value.reportedAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "reportedBoundaryPayload" -> value.reportedBoundaryPayload.map(v => ReportedBoundaryDigest_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "receivedAt" -> Json.fromString(value.receivedAt),
        "ingress" -> RequestTrace_JsonCodec.instance.encode(ctx, value.ingress),
        "observedCut" -> CapsuleCut_JsonCodec.instance.encode(ctx, value.observedCut),
        "cutComparison" -> DeliveryCutComparison_JsonCodec.instance.encode(ctx, value.cutComparison)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, DeliveryReceipt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            owner <- getField(jsonObject, "owner").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            capsuleId <- getField(jsonObject, "capsuleId").flatMap(v => decodeUUID(v.hcursor))
            capsulePayloadDigest <- getField(jsonObject, "capsulePayloadDigest").flatMap(v => decodeString(v.hcursor))
            workContext <- getField(jsonObject, "workContext").flatMap(v => decodeString(v.hcursor))
            reportedContext <- getField(jsonObject, "reportedContext").flatMap(v => ContextRecord_JsonCodec.circeDecoder(v.hcursor))
            boundary <- getField(jsonObject, "boundary").flatMap(v => DeliveryBoundary_JsonCodec.circeDecoder(v.hcursor))
            reportedAt <- getField(jsonObject, "reportedAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            reportedBoundaryPayload <- getField(jsonObject, "reportedBoundaryPayload").flatMap(v => decodeOption(ReportedBoundaryDigest_JsonCodec.circeDecoder)(v.hcursor))
            receivedAt <- getField(jsonObject, "receivedAt").flatMap(v => decodeString(v.hcursor))
            ingress <- getField(jsonObject, "ingress").flatMap(v => RequestTrace_JsonCodec.circeDecoder(v.hcursor))
            observedCut <- getField(jsonObject, "observedCut").flatMap(v => CapsuleCut_JsonCodec.circeDecoder(v.hcursor))
            cutComparison <- getField(jsonObject, "cutComparison").flatMap(v => DeliveryCutComparison_JsonCodec.circeDecoder(v.hcursor))
          } yield DeliveryReceipt(id,requestId,owner,scope,capsuleId,capsulePayloadDigest,workContext,reportedContext,boundary,reportedAt,reportedBoundaryPayload,receivedAt,ingress,observedCut,cutComparison)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to DeliveryReceipt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = DeliveryReceipt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = DeliveryReceipt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = DeliveryReceipt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[DeliveryReceipt]] = Lazy(DeliveryReceipt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[DeliveryReceipt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[DeliveryReceipt] = LazyInstance.value
  }
}