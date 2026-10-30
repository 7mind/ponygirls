import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class RetryFailedPlan(
    targetProfile: String,
    selectionHash: String,
    counts: RetryFailedCounts
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RetryFailedPlan.baboonDomainVersion
    override def baboonDomainIdentifier: String = RetryFailedPlan.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RetryFailedPlan.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RetryFailedPlan.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RetryFailedPlan.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RetryFailedPlan.baboonMinReaderVersions
  }
  
  object RetryFailedPlan {
    def baboonDomainVersion: String = "1.8.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#RetryFailedPlan"
    private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RetryFailedPlan] = RetryFailedPlan_JsonCodec.instance
  }
  
  object RetryFailedPlan_JsonCodec extends BaboonJsonCodec.BaseGenerated[RetryFailedPlan, BaboonJsonCodec[RetryFailedPlan]] {
    def encode(ctx: BaboonCodecContext, value: RetryFailedPlan): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "targetProfile" -> Json.fromString(value.targetProfile),
        "selectionHash" -> Json.fromString(value.selectionHash),
        "counts" -> RetryFailedCounts_JsonCodec.instance.encode(ctx, value.counts)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RetryFailedPlan] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            targetProfile <- getField(jsonObject, "targetProfile").flatMap(v => decodeString(v.hcursor))
            selectionHash <- getField(jsonObject, "selectionHash").flatMap(v => decodeString(v.hcursor))
            counts <- getField(jsonObject, "counts").flatMap(v => RetryFailedCounts_JsonCodec.circeDecoder(v.hcursor))
          } yield RetryFailedPlan(targetProfile,selectionHash,counts)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetryFailedPlan: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RetryFailedPlan.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RetryFailedPlan.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RetryFailedPlan.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RetryFailedPlan]] = Lazy(RetryFailedPlan_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RetryFailedPlan]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RetryFailedPlan] = LazyInstance.value
  }
}