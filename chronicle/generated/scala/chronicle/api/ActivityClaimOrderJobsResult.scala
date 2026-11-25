import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ActivityClaimOrderJobsResult(
    page: ActivityJobsResult,
    claimOrder: ActivityClaimOrder,
    jobs: List[ActivityJobClaimOrder]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityClaimOrderJobsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityClaimOrderJobsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityClaimOrderJobsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityClaimOrderJobsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityClaimOrderJobsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityClaimOrderJobsResult.baboonMinReaderVersions
  }
  
  object ActivityClaimOrderJobsResult {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityClaimOrderJobsResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityClaimOrderJobsResult] = ActivityClaimOrderJobsResult_JsonCodec.instance
  }
  
  object ActivityClaimOrderJobsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityClaimOrderJobsResult, BaboonJsonCodec[ActivityClaimOrderJobsResult]] {
    def encode(ctx: BaboonCodecContext, value: ActivityClaimOrderJobsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "page" -> ActivityJobsResult_JsonCodec.instance.encode(ctx, value.page),
        "claimOrder" -> ActivityClaimOrder_JsonCodec.instance.encode(ctx, value.claimOrder),
        "jobs" -> Json.fromValues(value.jobs.map(e => ActivityJobClaimOrder_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityClaimOrderJobsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            page <- getField(jsonObject, "page").flatMap(v => ActivityJobsResult_JsonCodec.circeDecoder(v.hcursor))
            claimOrder <- getField(jsonObject, "claimOrder").flatMap(v => ActivityClaimOrder_JsonCodec.circeDecoder(v.hcursor))
            jobs <- getField(jsonObject, "jobs").flatMap(v => decodeList(ActivityJobClaimOrder_JsonCodec.circeDecoder)(v.hcursor))
          } yield ActivityClaimOrderJobsResult(page,claimOrder,jobs)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityClaimOrderJobsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityClaimOrderJobsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityClaimOrderJobsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityClaimOrderJobsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrderJobsResult]] = Lazy(ActivityClaimOrderJobsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrderJobsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityClaimOrderJobsResult] = LazyInstance.value
  }
}