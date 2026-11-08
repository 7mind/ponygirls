import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package rites.worker {
  final case class RunResult(
    protocolVersion: String,
    runId: UUID,
    outcome: RunOutcome,
    failureCode: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RunResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RunResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RunResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RunResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RunResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RunResult.baboonMinReaderVersions
  }
  
  object RunResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.worker"
    def baboonTypeIdentifier: String = "rites.worker/:#RunResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RunResult] = RunResult_JsonCodec.instance
  }
  
  object RunResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RunResult, BaboonJsonCodec[RunResult]] {
    def encode(ctx: BaboonCodecContext, value: RunResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "protocolVersion" -> Json.fromString(value.protocolVersion),
        "runId" -> Json.fromString(value.runId.toString()),
        "outcome" -> RunOutcome_JsonCodec.instance.encode(ctx, value.outcome),
        "failureCode" -> value.failureCode.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RunResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            protocolVersion <- getField(jsonObject, "protocolVersion").flatMap(v => decodeString(v.hcursor))
            runId <- getField(jsonObject, "runId").flatMap(v => decodeUUID(v.hcursor))
            outcome <- getField(jsonObject, "outcome").flatMap(v => RunOutcome_JsonCodec.circeDecoder(v.hcursor))
            failureCode <- getField(jsonObject, "failureCode").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield RunResult(protocolVersion,runId,outcome,failureCode)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RunResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RunResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RunResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RunResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RunResult]] = Lazy(RunResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RunResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RunResult] = LazyInstance.value
  }
}