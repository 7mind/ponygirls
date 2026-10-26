import io.circe.Decoder.{decodeBoolean, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.4.0")
  final case class ActivityJob(
    job: JobInfo,
    profile: String,
    classification: ActivityJobClass,
    leaseExpiresAt: Option[String],
    leaseActive: Boolean,
    retryable: Boolean,
    collectorId: String,
    session: SessionInfo,
    lastTimestamp: Option[String]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ActivityJob.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityJob.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityJob.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityJob.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityJob.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityJob.baboonMinReaderVersions
  }
  
  object ActivityJob {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityJob"
    private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ActivityJob] = ActivityJob_JsonCodec.instance
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.4.0")
  object ActivityJob_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityJob, BaboonJsonCodec[ActivityJob]] {
    def encode(ctx: BaboonCodecContext, value: ActivityJob): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "job" -> JobInfo_JsonCodec.instance.encode(ctx, value.job),
        "profile" -> Json.fromString(value.profile),
        "classification" -> ActivityJobClass_JsonCodec.instance.encode(ctx, value.classification),
        "leaseExpiresAt" -> value.leaseExpiresAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "leaseActive" -> Json.fromBoolean(value.leaseActive),
        "retryable" -> Json.fromBoolean(value.retryable),
        "collectorId" -> Json.fromString(value.collectorId),
        "session" -> SessionInfo_JsonCodec.instance.encode(ctx, value.session),
        "lastTimestamp" -> value.lastTimestamp.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJob] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            job <- getField(jsonObject, "job").flatMap(v => JobInfo_JsonCodec.circeDecoder(v.hcursor))
            profile <- getField(jsonObject, "profile").flatMap(v => decodeString(v.hcursor))
            classification <- getField(jsonObject, "classification").flatMap(v => ActivityJobClass_JsonCodec.circeDecoder(v.hcursor))
            leaseExpiresAt <- getField(jsonObject, "leaseExpiresAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            leaseActive <- getField(jsonObject, "leaseActive").flatMap(v => decodeBoolean(v.hcursor))
            retryable <- getField(jsonObject, "retryable").flatMap(v => decodeBoolean(v.hcursor))
            collectorId <- getField(jsonObject, "collectorId").flatMap(v => decodeString(v.hcursor))
            session <- getField(jsonObject, "session").flatMap(v => SessionInfo_JsonCodec.circeDecoder(v.hcursor))
            lastTimestamp <- getField(jsonObject, "lastTimestamp").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield ActivityJob(job,profile,classification,leaseExpiresAt,leaseActive,retryable,collectorId,session,lastTimestamp)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityJob: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityJob.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityJob.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityJob.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJob]] = Lazy(ActivityJob_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJob]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityJob] = LazyInstance.value
  }
}