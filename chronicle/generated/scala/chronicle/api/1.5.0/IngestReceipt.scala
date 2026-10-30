import io.circe.Decoder.decodeUUID
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  final case class IngestReceipt(
    requestId: UUID,
    sessionId: UUID,
    revision: Int,
    jobId: UUID
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = IngestReceipt.baboonDomainVersion
    override def baboonDomainIdentifier: String = IngestReceipt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = IngestReceipt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = IngestReceipt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = IngestReceipt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = IngestReceipt.baboonMinReaderVersions
  }
  
  object IngestReceipt {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#IngestReceipt"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[IngestReceipt] = IngestReceipt_JsonCodec.instance
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  object IngestReceipt_JsonCodec extends BaboonJsonCodec.BaseGenerated[IngestReceipt, BaboonJsonCodec[IngestReceipt]] {
    def encode(ctx: BaboonCodecContext, value: IngestReceipt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "sessionId" -> Json.fromString(value.sessionId.toString()),
        "revision" -> Json.fromInt(value.revision),
        "jobId" -> Json.fromString(value.jobId.toString())
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, IngestReceipt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            jobId <- getField(jsonObject, "jobId").flatMap(v => decodeUUID(v.hcursor))
          } yield IngestReceipt(requestId,sessionId,revision,jobId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to IngestReceipt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = IngestReceipt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = IngestReceipt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = IngestReceipt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[IngestReceipt]] = Lazy(IngestReceipt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[IngestReceipt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[IngestReceipt] = LazyInstance.value
  }
}