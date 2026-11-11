import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CurationAuditRecord(
    attemptId: UUID,
    scope: String,
    fence: CoordinatorFence,
    ordinal: Int,
    stage: CurationAuditStage,
    requestDigest: String,
    payload: Option[CurationAuditPayload],
    observedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationAuditRecord.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationAuditRecord.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationAuditRecord.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationAuditRecord.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationAuditRecord.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationAuditRecord.baboonMinReaderVersions
  }
  
  object CurationAuditRecord {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationAuditRecord"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationAuditRecord] = CurationAuditRecord_JsonCodec.instance
  }
  
  object CurationAuditRecord_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationAuditRecord, BaboonJsonCodec[CurationAuditRecord]] {
    def encode(ctx: BaboonCodecContext, value: CurationAuditRecord): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "attemptId" -> Json.fromString(value.attemptId.toString()),
        "scope" -> Json.fromString(value.scope),
        "fence" -> CoordinatorFence_JsonCodec.instance.encode(ctx, value.fence),
        "ordinal" -> Json.fromInt(value.ordinal),
        "stage" -> CurationAuditStage_JsonCodec.instance.encode(ctx, value.stage),
        "requestDigest" -> Json.fromString(value.requestDigest),
        "payload" -> value.payload.map(v => CurationAuditPayload_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "observedAt" -> Json.fromString(value.observedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationAuditRecord] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            attemptId <- getField(jsonObject, "attemptId").flatMap(v => decodeUUID(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            fence <- getField(jsonObject, "fence").flatMap(v => CoordinatorFence_JsonCodec.circeDecoder(v.hcursor))
            ordinal <- getField(jsonObject, "ordinal").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            stage <- getField(jsonObject, "stage").flatMap(v => CurationAuditStage_JsonCodec.circeDecoder(v.hcursor))
            requestDigest <- getField(jsonObject, "requestDigest").flatMap(v => decodeString(v.hcursor))
            payload <- getField(jsonObject, "payload").flatMap(v => decodeOption(CurationAuditPayload_JsonCodec.circeDecoder)(v.hcursor))
            observedAt <- getField(jsonObject, "observedAt").flatMap(v => decodeString(v.hcursor))
          } yield CurationAuditRecord(attemptId,scope,fence,ordinal,stage,requestDigest,payload,observedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationAuditRecord: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationAuditRecord.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationAuditRecord.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationAuditRecord.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationAuditRecord]] = Lazy(CurationAuditRecord_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationAuditRecord]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationAuditRecord] = LazyInstance.value
  }
}