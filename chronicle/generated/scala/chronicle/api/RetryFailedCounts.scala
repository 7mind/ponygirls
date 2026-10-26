import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class RetryFailedCounts(
    eligibleCurrentFailed: Long,
    supersededRevisionFailed: Long,
    obsoleteProfileFailed: Long,
    supersededRevisionAndProfileFailed: Long,
    unchangedQueued: Long,
    unchangedRunning: Long,
    unchangedComplete: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RetryFailedCounts.baboonDomainVersion
    override def baboonDomainIdentifier: String = RetryFailedCounts.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RetryFailedCounts.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RetryFailedCounts.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RetryFailedCounts.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RetryFailedCounts.baboonMinReaderVersions
  }
  
  object RetryFailedCounts {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#RetryFailedCounts"
    private lazy val _baboonSameInVersions: List[String] = List("1.3.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RetryFailedCounts] = RetryFailedCounts_JsonCodec.instance
  }
  
  object RetryFailedCounts_JsonCodec extends BaboonJsonCodec.BaseGenerated[RetryFailedCounts, BaboonJsonCodec[RetryFailedCounts]] {
    def encode(ctx: BaboonCodecContext, value: RetryFailedCounts): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "eligibleCurrentFailed" -> Json.fromString(value.eligibleCurrentFailed.toString),
        "supersededRevisionFailed" -> Json.fromString(value.supersededRevisionFailed.toString),
        "obsoleteProfileFailed" -> Json.fromString(value.obsoleteProfileFailed.toString),
        "supersededRevisionAndProfileFailed" -> Json.fromString(value.supersededRevisionAndProfileFailed.toString),
        "unchangedQueued" -> Json.fromString(value.unchangedQueued.toString),
        "unchangedRunning" -> Json.fromString(value.unchangedRunning.toString),
        "unchangedComplete" -> Json.fromString(value.unchangedComplete.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RetryFailedCounts] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            eligibleCurrentFailed <- getField(jsonObject, "eligibleCurrentFailed").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            supersededRevisionFailed <- getField(jsonObject, "supersededRevisionFailed").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            obsoleteProfileFailed <- getField(jsonObject, "obsoleteProfileFailed").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            supersededRevisionAndProfileFailed <- getField(jsonObject, "supersededRevisionAndProfileFailed").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            unchangedQueued <- getField(jsonObject, "unchangedQueued").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            unchangedRunning <- getField(jsonObject, "unchangedRunning").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            unchangedComplete <- getField(jsonObject, "unchangedComplete").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield RetryFailedCounts(eligibleCurrentFailed,supersededRevisionFailed,obsoleteProfileFailed,supersededRevisionAndProfileFailed,unchangedQueued,unchangedRunning,unchangedComplete)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetryFailedCounts: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RetryFailedCounts.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RetryFailedCounts.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RetryFailedCounts.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RetryFailedCounts]] = Lazy(RetryFailedCounts_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RetryFailedCounts]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RetryFailedCounts] = LazyInstance.value
  }
}