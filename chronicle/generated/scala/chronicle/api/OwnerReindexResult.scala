import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class OwnerReindexResult(
    requestId: UUID,
    targetProfile: String,
    heads: Long,
    queued: Long,
    alreadyCurrent: Long,
    invalidatedClaims: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = OwnerReindexResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = OwnerReindexResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = OwnerReindexResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = OwnerReindexResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = OwnerReindexResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = OwnerReindexResult.baboonMinReaderVersions
  }
  
  object OwnerReindexResult {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#OwnerReindexResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[OwnerReindexResult] = OwnerReindexResult_JsonCodec.instance
  }
  
  object OwnerReindexResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[OwnerReindexResult, BaboonJsonCodec[OwnerReindexResult]] {
    def encode(ctx: BaboonCodecContext, value: OwnerReindexResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "targetProfile" -> Json.fromString(value.targetProfile),
        "heads" -> Json.fromString(value.heads.toString),
        "queued" -> Json.fromString(value.queued.toString),
        "alreadyCurrent" -> Json.fromString(value.alreadyCurrent.toString),
        "invalidatedClaims" -> Json.fromString(value.invalidatedClaims.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OwnerReindexResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            targetProfile <- getField(jsonObject, "targetProfile").flatMap(v => decodeString(v.hcursor))
            heads <- getField(jsonObject, "heads").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            queued <- getField(jsonObject, "queued").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            alreadyCurrent <- getField(jsonObject, "alreadyCurrent").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            invalidatedClaims <- getField(jsonObject, "invalidatedClaims").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield OwnerReindexResult(requestId,targetProfile,heads,queued,alreadyCurrent,invalidatedClaims)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to OwnerReindexResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = OwnerReindexResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = OwnerReindexResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = OwnerReindexResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OwnerReindexResult]] = Lazy(OwnerReindexResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[OwnerReindexResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[OwnerReindexResult] = LazyInstance.value
  }
}