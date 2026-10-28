import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  final case class JobInfo(
    id: UUID,
    sessionId: UUID,
    revision: Int,
    state: JobState,
    attempts: Int,
    error: Option[String],
    completedWindows: Int,
    totalWindows: Option[Int]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = JobInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = JobInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = JobInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = JobInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = JobInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = JobInfo.baboonMinReaderVersions
  }
  
  object JobInfo {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#JobInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "prefix-compact")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[JobInfo] = JobInfo_JsonCodec.instance
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  object JobInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[JobInfo, BaboonJsonCodec[JobInfo]] {
    def encode(ctx: BaboonCodecContext, value: JobInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "sessionId" -> Json.fromString(value.sessionId.toString()),
        "revision" -> Json.fromInt(value.revision),
        "state" -> JobState_JsonCodec.instance.encode(ctx, value.state),
        "attempts" -> Json.fromInt(value.attempts),
        "error" -> value.error.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "completedWindows" -> Json.fromInt(value.completedWindows),
        "totalWindows" -> value.totalWindows.map(v => Json.fromInt(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, JobInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => JobState_JsonCodec.circeDecoder(v.hcursor))
            attempts <- getField(jsonObject, "attempts").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            error <- getField(jsonObject, "error").flatMap(v => decodeOption(decodeString)(v.hcursor))
            completedWindows <- getField(jsonObject, "completedWindows").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            totalWindows <- getField(jsonObject, "totalWindows").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
          } yield JobInfo(id,sessionId,revision,state,attempts,error,completedWindows,totalWindows)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to JobInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = JobInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = JobInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = JobInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[JobInfo]] = Lazy(JobInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[JobInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[JobInfo] = LazyInstance.value
  }
}