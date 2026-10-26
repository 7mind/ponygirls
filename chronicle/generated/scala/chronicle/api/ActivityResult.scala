import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ActivityResult(
    observedAt: String,
    user: UserInfo,
    archiveHeads: Long,
    headsWithoutTargetJob: Long,
    current: JobCounts,
    historical: JobCounts,
    collectors: List[ActivityCollector],
    totalCollectors: Long,
    allCollectors: Long,
    nextCursor: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityResult.baboonMinReaderVersions
  }
  
  object ActivityResult {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.3.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityResult] = ActivityResult_JsonCodec.instance
  }
  
  object ActivityResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityResult, BaboonJsonCodec[ActivityResult]] {
    def encode(ctx: BaboonCodecContext, value: ActivityResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "observedAt" -> Json.fromString(value.observedAt),
        "user" -> UserInfo_JsonCodec.instance.encode(ctx, value.user),
        "archiveHeads" -> Json.fromString(value.archiveHeads.toString),
        "headsWithoutTargetJob" -> Json.fromString(value.headsWithoutTargetJob.toString),
        "current" -> JobCounts_JsonCodec.instance.encode(ctx, value.current),
        "historical" -> JobCounts_JsonCodec.instance.encode(ctx, value.historical),
        "collectors" -> Json.fromValues(value.collectors.map(e => ActivityCollector_JsonCodec.instance.encode(ctx, e))),
        "totalCollectors" -> Json.fromString(value.totalCollectors.toString),
        "allCollectors" -> Json.fromString(value.allCollectors.toString),
        "nextCursor" -> value.nextCursor.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            observedAt <- getField(jsonObject, "observedAt").flatMap(v => decodeString(v.hcursor))
            user <- getField(jsonObject, "user").flatMap(v => UserInfo_JsonCodec.circeDecoder(v.hcursor))
            archiveHeads <- getField(jsonObject, "archiveHeads").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            headsWithoutTargetJob <- getField(jsonObject, "headsWithoutTargetJob").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            current <- getField(jsonObject, "current").flatMap(v => JobCounts_JsonCodec.circeDecoder(v.hcursor))
            historical <- getField(jsonObject, "historical").flatMap(v => JobCounts_JsonCodec.circeDecoder(v.hcursor))
            collectors <- getField(jsonObject, "collectors").flatMap(v => decodeList(ActivityCollector_JsonCodec.circeDecoder)(v.hcursor))
            totalCollectors <- getField(jsonObject, "totalCollectors").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            allCollectors <- getField(jsonObject, "allCollectors").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            nextCursor <- getField(jsonObject, "nextCursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield ActivityResult(observedAt,user,archiveHeads,headsWithoutTargetJob,current,historical,collectors,totalCollectors,allCollectors,nextCursor)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityResult]] = Lazy(ActivityResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityResult] = LazyInstance.value
  }
}