import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class JobCounts(
    total: Long,
    queued: Long,
    running: Long,
    failed: Long,
    complete: Long,
    activeRunning: Long,
    expiredRunning: Long,
    unleasedRunning: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = JobCounts.baboonDomainVersion
    override def baboonDomainIdentifier: String = JobCounts.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = JobCounts.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = JobCounts.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = JobCounts.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = JobCounts.baboonMinReaderVersions
  }
  
  object JobCounts {
    def baboonDomainVersion: String = "1.8.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#JobCounts"
    private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[JobCounts] = JobCounts_JsonCodec.instance
  }
  
  object JobCounts_JsonCodec extends BaboonJsonCodec.BaseGenerated[JobCounts, BaboonJsonCodec[JobCounts]] {
    def encode(ctx: BaboonCodecContext, value: JobCounts): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "total" -> Json.fromString(value.total.toString),
        "queued" -> Json.fromString(value.queued.toString),
        "running" -> Json.fromString(value.running.toString),
        "failed" -> Json.fromString(value.failed.toString),
        "complete" -> Json.fromString(value.complete.toString),
        "activeRunning" -> Json.fromString(value.activeRunning.toString),
        "expiredRunning" -> Json.fromString(value.expiredRunning.toString),
        "unleasedRunning" -> Json.fromString(value.unleasedRunning.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, JobCounts] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            queued <- getField(jsonObject, "queued").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            running <- getField(jsonObject, "running").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            failed <- getField(jsonObject, "failed").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            complete <- getField(jsonObject, "complete").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            activeRunning <- getField(jsonObject, "activeRunning").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            expiredRunning <- getField(jsonObject, "expiredRunning").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            unleasedRunning <- getField(jsonObject, "unleasedRunning").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield JobCounts(total,queued,running,failed,complete,activeRunning,expiredRunning,unleasedRunning)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to JobCounts: object expected"))
      }
    }
  
    def baboonDomainVersion: String = JobCounts.baboonDomainVersion
    
    def baboonDomainIdentifier: String = JobCounts.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = JobCounts.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[JobCounts]] = Lazy(JobCounts_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[JobCounts]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[JobCounts] = LazyInstance.value
  }
}