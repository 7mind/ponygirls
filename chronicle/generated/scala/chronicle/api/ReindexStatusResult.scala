import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class ReindexStatusResult(
    requestId: UUID,
    targetProfile: String,
    total: Long,
    complete: Long,
    superseded: Long,
    failed: Long,
    pending: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ReindexStatusResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ReindexStatusResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ReindexStatusResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ReindexStatusResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ReindexStatusResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ReindexStatusResult.baboonMinReaderVersions
  }
  
  object ReindexStatusResult {
    def baboonDomainVersion: String = "1.8.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ReindexStatusResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.7.0", "prefix-compact" -> "1.7.0", "prefix-any-mode" -> "1.7.0", "identical" -> "1.7.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ReindexStatusResult] = ReindexStatusResult_JsonCodec.instance
  }
  
  object ReindexStatusResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ReindexStatusResult, BaboonJsonCodec[ReindexStatusResult]] {
    def encode(ctx: BaboonCodecContext, value: ReindexStatusResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "targetProfile" -> Json.fromString(value.targetProfile),
        "total" -> Json.fromString(value.total.toString),
        "complete" -> Json.fromString(value.complete.toString),
        "superseded" -> Json.fromString(value.superseded.toString),
        "failed" -> Json.fromString(value.failed.toString),
        "pending" -> Json.fromString(value.pending.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReindexStatusResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            targetProfile <- getField(jsonObject, "targetProfile").flatMap(v => decodeString(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            complete <- getField(jsonObject, "complete").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            superseded <- getField(jsonObject, "superseded").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            failed <- getField(jsonObject, "failed").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            pending <- getField(jsonObject, "pending").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield ReindexStatusResult(requestId,targetProfile,total,complete,superseded,failed,pending)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReindexStatusResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ReindexStatusResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ReindexStatusResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ReindexStatusResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReindexStatusResult]] = Lazy(ReindexStatusResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ReindexStatusResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ReindexStatusResult] = LazyInstance.value
  }
}