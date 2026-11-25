import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ActivityClaimOrderSummaryResult(
    observedAt: String,
    queue: ActivityQueue
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityClaimOrderSummaryResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityClaimOrderSummaryResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityClaimOrderSummaryResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityClaimOrderSummaryResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityClaimOrderSummaryResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityClaimOrderSummaryResult.baboonMinReaderVersions
  }
  
  object ActivityClaimOrderSummaryResult {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityClaimOrderSummaryResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityClaimOrderSummaryResult] = ActivityClaimOrderSummaryResult_JsonCodec.instance
  }
  
  object ActivityClaimOrderSummaryResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityClaimOrderSummaryResult, BaboonJsonCodec[ActivityClaimOrderSummaryResult]] {
    def encode(ctx: BaboonCodecContext, value: ActivityClaimOrderSummaryResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "observedAt" -> Json.fromString(value.observedAt),
        "queue" -> ActivityQueue_JsonCodec.instance.encode(ctx, value.queue)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityClaimOrderSummaryResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            observedAt <- getField(jsonObject, "observedAt").flatMap(v => decodeString(v.hcursor))
            queue <- getField(jsonObject, "queue").flatMap(v => ActivityQueue_JsonCodec.circeDecoder(v.hcursor))
          } yield ActivityClaimOrderSummaryResult(observedAt,queue)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityClaimOrderSummaryResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityClaimOrderSummaryResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityClaimOrderSummaryResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityClaimOrderSummaryResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrderSummaryResult]] = Lazy(ActivityClaimOrderSummaryResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrderSummaryResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityClaimOrderSummaryResult] = LazyInstance.value
  }
}