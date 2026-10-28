import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ActivityCollector(
    collectorId: String,
    status: Option[CollectorStatus],
    archiveHeads: Long,
    headsWithoutTargetJob: Long,
    current: JobCounts,
    historical: JobCounts
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityCollector.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityCollector.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityCollector.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityCollector.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityCollector.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityCollector.baboonMinReaderVersions
  }
  
  object ActivityCollector {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityCollector"
    private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityCollector] = ActivityCollector_JsonCodec.instance
  }
  
  object ActivityCollector_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityCollector, BaboonJsonCodec[ActivityCollector]] {
    def encode(ctx: BaboonCodecContext, value: ActivityCollector): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "collectorId" -> Json.fromString(value.collectorId),
        "status" -> value.status.map(v => CollectorStatus_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "archiveHeads" -> Json.fromString(value.archiveHeads.toString),
        "headsWithoutTargetJob" -> Json.fromString(value.headsWithoutTargetJob.toString),
        "current" -> JobCounts_JsonCodec.instance.encode(ctx, value.current),
        "historical" -> JobCounts_JsonCodec.instance.encode(ctx, value.historical)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityCollector] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            collectorId <- getField(jsonObject, "collectorId").flatMap(v => decodeString(v.hcursor))
            status <- getField(jsonObject, "status").flatMap(v => decodeOption(CollectorStatus_JsonCodec.circeDecoder)(v.hcursor))
            archiveHeads <- getField(jsonObject, "archiveHeads").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            headsWithoutTargetJob <- getField(jsonObject, "headsWithoutTargetJob").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            current <- getField(jsonObject, "current").flatMap(v => JobCounts_JsonCodec.circeDecoder(v.hcursor))
            historical <- getField(jsonObject, "historical").flatMap(v => JobCounts_JsonCodec.circeDecoder(v.hcursor))
          } yield ActivityCollector(collectorId,status,archiveHeads,headsWithoutTargetJob,current,historical)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityCollector: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityCollector.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityCollector.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityCollector.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityCollector]] = Lazy(ActivityCollector_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityCollector]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityCollector] = LazyInstance.value
  }
}