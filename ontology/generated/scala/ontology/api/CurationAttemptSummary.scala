import io.circe.Decoder.{decodeBoolean, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CurationAttemptSummary(
    attemptId: UUID,
    baseGeneration: Long,
    frontier: Long,
    previousCoveredFrontier: Long,
    state: CurationAttemptState,
    inputDigest: Option[String],
    lastOrdinal: Option[Int],
    lastStage: Option[CurationAuditStage],
    terminalCode: Option[String],
    auditUncertain: Boolean,
    claimedAt: String,
    deadlineAt: String,
    finishedAt: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationAttemptSummary.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationAttemptSummary.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationAttemptSummary.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationAttemptSummary.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationAttemptSummary.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationAttemptSummary.baboonMinReaderVersions
  }
  
  object CurationAttemptSummary {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationAttemptSummary"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationAttemptSummary] = CurationAttemptSummary_JsonCodec.instance
  }
  
  object CurationAttemptSummary_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationAttemptSummary, BaboonJsonCodec[CurationAttemptSummary]] {
    def encode(ctx: BaboonCodecContext, value: CurationAttemptSummary): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "attemptId" -> Json.fromString(value.attemptId.toString()),
        "baseGeneration" -> Json.fromString(value.baseGeneration.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "previousCoveredFrontier" -> Json.fromString(value.previousCoveredFrontier.toString),
        "state" -> CurationAttemptState_JsonCodec.instance.encode(ctx, value.state),
        "inputDigest" -> value.inputDigest.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "lastOrdinal" -> value.lastOrdinal.map(v => Json.fromInt(v)).getOrElse(Json.Null),
        "lastStage" -> value.lastStage.map(v => CurationAuditStage_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "terminalCode" -> value.terminalCode.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "auditUncertain" -> Json.fromBoolean(value.auditUncertain),
        "claimedAt" -> Json.fromString(value.claimedAt),
        "deadlineAt" -> Json.fromString(value.deadlineAt),
        "finishedAt" -> value.finishedAt.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationAttemptSummary] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            attemptId <- getField(jsonObject, "attemptId").flatMap(v => decodeUUID(v.hcursor))
            baseGeneration <- getField(jsonObject, "baseGeneration").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            previousCoveredFrontier <- getField(jsonObject, "previousCoveredFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => CurationAttemptState_JsonCodec.circeDecoder(v.hcursor))
            inputDigest <- getField(jsonObject, "inputDigest").flatMap(v => decodeOption(decodeString)(v.hcursor))
            lastOrdinal <- getField(jsonObject, "lastOrdinal").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
            lastStage <- getField(jsonObject, "lastStage").flatMap(v => decodeOption(CurationAuditStage_JsonCodec.circeDecoder)(v.hcursor))
            terminalCode <- getField(jsonObject, "terminalCode").flatMap(v => decodeOption(decodeString)(v.hcursor))
            auditUncertain <- getField(jsonObject, "auditUncertain").flatMap(v => decodeBoolean(v.hcursor))
            claimedAt <- getField(jsonObject, "claimedAt").flatMap(v => decodeString(v.hcursor))
            deadlineAt <- getField(jsonObject, "deadlineAt").flatMap(v => decodeString(v.hcursor))
            finishedAt <- getField(jsonObject, "finishedAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield CurationAttemptSummary(attemptId,baseGeneration,frontier,previousCoveredFrontier,state,inputDigest,lastOrdinal,lastStage,terminalCode,auditUncertain,claimedAt,deadlineAt,finishedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationAttemptSummary: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationAttemptSummary.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationAttemptSummary.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationAttemptSummary.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationAttemptSummary]] = Lazy(CurationAttemptSummary_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationAttemptSummary]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationAttemptSummary] = LazyInstance.value
  }
}