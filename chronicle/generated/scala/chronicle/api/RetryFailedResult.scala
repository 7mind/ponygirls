import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class RetryFailedResult(
    requestId: UUID,
    targetProfile: String,
    retried: Long,
    counts: RetryFailedCounts
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RetryFailedResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RetryFailedResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RetryFailedResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RetryFailedResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RetryFailedResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RetryFailedResult.baboonMinReaderVersions
  }
  
  object RetryFailedResult {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#RetryFailedResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RetryFailedResult] = RetryFailedResult_JsonCodec.instance
  }
  
  object RetryFailedResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RetryFailedResult, BaboonJsonCodec[RetryFailedResult]] {
    def encode(ctx: BaboonCodecContext, value: RetryFailedResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "targetProfile" -> Json.fromString(value.targetProfile),
        "retried" -> Json.fromString(value.retried.toString),
        "counts" -> RetryFailedCounts_JsonCodec.instance.encode(ctx, value.counts)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RetryFailedResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            targetProfile <- getField(jsonObject, "targetProfile").flatMap(v => decodeString(v.hcursor))
            retried <- getField(jsonObject, "retried").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            counts <- getField(jsonObject, "counts").flatMap(v => RetryFailedCounts_JsonCodec.circeDecoder(v.hcursor))
          } yield RetryFailedResult(requestId,targetProfile,retried,counts)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetryFailedResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RetryFailedResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RetryFailedResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RetryFailedResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RetryFailedResult]] = Lazy(RetryFailedResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RetryFailedResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RetryFailedResult] = LazyInstance.value
  }
}