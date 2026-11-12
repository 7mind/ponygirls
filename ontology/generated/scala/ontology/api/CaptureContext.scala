import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CaptureContext(
    sessionId: String,
    rootSessionId: Option[String],
    parentSessionId: Option[String],
    lineage: LineageStatus,
    branch: String,
    epoch: UUID
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CaptureContext.baboonDomainVersion
    override def baboonDomainIdentifier: String = CaptureContext.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CaptureContext.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CaptureContext.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CaptureContext.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CaptureContext.baboonMinReaderVersions
  }
  
  object CaptureContext {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CaptureContext"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CaptureContext] = CaptureContext_JsonCodec.instance
  }
  
  object CaptureContext_JsonCodec extends BaboonJsonCodec.BaseGenerated[CaptureContext, BaboonJsonCodec[CaptureContext]] {
    def encode(ctx: BaboonCodecContext, value: CaptureContext): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sessionId" -> Json.fromString(value.sessionId),
        "rootSessionId" -> value.rootSessionId.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "parentSessionId" -> value.parentSessionId.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "lineage" -> LineageStatus_JsonCodec.instance.encode(ctx, value.lineage),
        "branch" -> Json.fromString(value.branch),
        "epoch" -> Json.fromString(value.epoch.toString())
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CaptureContext] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeString(v.hcursor))
            rootSessionId <- getField(jsonObject, "rootSessionId").flatMap(v => decodeOption(decodeString)(v.hcursor))
            parentSessionId <- getField(jsonObject, "parentSessionId").flatMap(v => decodeOption(decodeString)(v.hcursor))
            lineage <- getField(jsonObject, "lineage").flatMap(v => LineageStatus_JsonCodec.circeDecoder(v.hcursor))
            branch <- getField(jsonObject, "branch").flatMap(v => decodeString(v.hcursor))
            epoch <- getField(jsonObject, "epoch").flatMap(v => decodeUUID(v.hcursor))
          } yield CaptureContext(sessionId,rootSessionId,parentSessionId,lineage,branch,epoch)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CaptureContext: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CaptureContext.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CaptureContext.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CaptureContext.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CaptureContext]] = Lazy(CaptureContext_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CaptureContext]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CaptureContext] = LazyInstance.value
  }
}