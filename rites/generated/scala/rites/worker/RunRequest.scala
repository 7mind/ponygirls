import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package rites.worker {
  final case class RunRequest(
    protocolVersion: String,
    runId: UUID,
    prompt: String,
    model: ModelSelection
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RunRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = RunRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RunRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RunRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RunRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RunRequest.baboonMinReaderVersions
  }
  
  object RunRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.worker"
    def baboonTypeIdentifier: String = "rites.worker/:#RunRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RunRequest] = RunRequest_JsonCodec.instance
  }
  
  object RunRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[RunRequest, BaboonJsonCodec[RunRequest]] {
    def encode(ctx: BaboonCodecContext, value: RunRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "protocolVersion" -> Json.fromString(value.protocolVersion),
        "runId" -> Json.fromString(value.runId.toString()),
        "prompt" -> Json.fromString(value.prompt),
        "model" -> ModelSelection_JsonCodec.instance.encode(ctx, value.model)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RunRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            protocolVersion <- getField(jsonObject, "protocolVersion").flatMap(v => decodeString(v.hcursor))
            runId <- getField(jsonObject, "runId").flatMap(v => decodeUUID(v.hcursor))
            prompt <- getField(jsonObject, "prompt").flatMap(v => decodeString(v.hcursor))
            model <- getField(jsonObject, "model").flatMap(v => ModelSelection_JsonCodec.circeDecoder(v.hcursor))
          } yield RunRequest(protocolVersion,runId,prompt,model)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RunRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RunRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RunRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RunRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RunRequest]] = Lazy(RunRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RunRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RunRequest] = LazyInstance.value
  }
}