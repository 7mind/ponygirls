import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class JobInfo(
    id: UUID,
    sessionId: UUID,
    revision: Int,
    state: JobState,
    attempts: Int,
    error: Option[String],
    completedWindows: Int,
    totalWindows: Option[Int],
    failureStage: Option[IndexingFailureStage]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = JobInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = JobInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = JobInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = JobInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = JobInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = JobInfo.baboonMinReaderVersions
  }
  
  object JobInfo {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#JobInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.7.0", "identical" -> "1.7.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[JobInfo] = JobInfo_JsonCodec.instance
  }
  
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
        "totalWindows" -> value.totalWindows.map(v => Json.fromInt(v)).getOrElse(Json.Null),
        "failureStage" -> value.failureStage.map(v => IndexingFailureStage_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
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
            failureStage <- getField(jsonObject, "failureStage").flatMap(v => decodeOption(IndexingFailureStage_JsonCodec.circeDecoder)(v.hcursor))
          } yield JobInfo(id,sessionId,revision,state,attempts,error,completedWindows,totalWindows,failureStage)
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