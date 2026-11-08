import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package rites.api {
  final case class RunInfo(
    id: UUID,
    repositoryId: String,
    riteId: String,
    trigger: RunTrigger,
    scheduledFor: String,
    createdAt: String,
    startedAt: Option[String],
    finishedAt: Option[String],
    state: RunState,
    failureCode: Option[String],
    baseRevision: Option[String],
    promptDigest: Option[String],
    branch: Option[String],
    proposalUrl: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RunInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = RunInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RunInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RunInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RunInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RunInfo.baboonMinReaderVersions
  }
  
  object RunInfo {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#RunInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RunInfo] = RunInfo_JsonCodec.instance
  }
  
  object RunInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[RunInfo, BaboonJsonCodec[RunInfo]] {
    def encode(ctx: BaboonCodecContext, value: RunInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "repositoryId" -> Json.fromString(value.repositoryId),
        "riteId" -> Json.fromString(value.riteId),
        "trigger" -> RunTrigger_JsonCodec.instance.encode(ctx, value.trigger),
        "scheduledFor" -> Json.fromString(value.scheduledFor),
        "createdAt" -> Json.fromString(value.createdAt),
        "startedAt" -> value.startedAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "finishedAt" -> value.finishedAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "state" -> RunState_JsonCodec.instance.encode(ctx, value.state),
        "failureCode" -> value.failureCode.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "baseRevision" -> value.baseRevision.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "promptDigest" -> value.promptDigest.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "branch" -> value.branch.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "proposalUrl" -> value.proposalUrl.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RunInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            repositoryId <- getField(jsonObject, "repositoryId").flatMap(v => decodeString(v.hcursor))
            riteId <- getField(jsonObject, "riteId").flatMap(v => decodeString(v.hcursor))
            trigger <- getField(jsonObject, "trigger").flatMap(v => RunTrigger_JsonCodec.circeDecoder(v.hcursor))
            scheduledFor <- getField(jsonObject, "scheduledFor").flatMap(v => decodeString(v.hcursor))
            createdAt <- getField(jsonObject, "createdAt").flatMap(v => decodeString(v.hcursor))
            startedAt <- getField(jsonObject, "startedAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            finishedAt <- getField(jsonObject, "finishedAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => RunState_JsonCodec.circeDecoder(v.hcursor))
            failureCode <- getField(jsonObject, "failureCode").flatMap(v => decodeOption(decodeString)(v.hcursor))
            baseRevision <- getField(jsonObject, "baseRevision").flatMap(v => decodeOption(decodeString)(v.hcursor))
            promptDigest <- getField(jsonObject, "promptDigest").flatMap(v => decodeOption(decodeString)(v.hcursor))
            branch <- getField(jsonObject, "branch").flatMap(v => decodeOption(decodeString)(v.hcursor))
            proposalUrl <- getField(jsonObject, "proposalUrl").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield RunInfo(id,repositoryId,riteId,trigger,scheduledFor,createdAt,startedAt,finishedAt,state,failureCode,baseRevision,promptDigest,branch,proposalUrl)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RunInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RunInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RunInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RunInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RunInfo]] = Lazy(RunInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RunInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RunInfo] = LazyInstance.value
  }
}