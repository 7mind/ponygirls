import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_7_0 {
  @deprecated("Version 1.7.0 is deprecated, you should migrate to 1.8.0")
  final case class ActivityJobsResult(
    observedAt: String,
    jobs: List[ActivityJob],
    total: Long,
    nextCursor: Option[String]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ActivityJobsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityJobsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityJobsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityJobsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityJobsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityJobsResult.baboonMinReaderVersions
  }
  
  object ActivityJobsResult {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityJobsResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.7.0", "prefix-any-mode" -> "1.7.0", "identical" -> "1.7.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ActivityJobsResult] = ActivityJobsResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.7.0 is deprecated, you should migrate to 1.8.0")
  object ActivityJobsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityJobsResult, BaboonJsonCodec[ActivityJobsResult]] {
    def encode(ctx: BaboonCodecContext, value: ActivityJobsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "observedAt" -> Json.fromString(value.observedAt),
        "jobs" -> Json.fromValues(value.jobs.map(e => ActivityJob_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromString(value.total.toString),
        "nextCursor" -> value.nextCursor.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            observedAt <- getField(jsonObject, "observedAt").flatMap(v => decodeString(v.hcursor))
            jobs <- getField(jsonObject, "jobs").flatMap(v => decodeList(ActivityJob_JsonCodec.circeDecoder)(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            nextCursor <- getField(jsonObject, "nextCursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield ActivityJobsResult(observedAt,jobs,total,nextCursor)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityJobsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityJobsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityJobsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityJobsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobsResult]] = Lazy(ActivityJobsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityJobsResult] = LazyInstance.value
  }
}