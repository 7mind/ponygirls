import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class RunResult(
    run: RunInfo
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RunResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RunResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RunResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RunResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RunResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RunResult.baboonMinReaderVersions
  }
  
  object RunResult {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#RunResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RunResult] = RunResult_JsonCodec.instance
  }
  
  object RunResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RunResult, BaboonJsonCodec[RunResult]] {
    def encode(ctx: BaboonCodecContext, value: RunResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "run" -> RunInfo_JsonCodec.instance.encode(ctx, value.run)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RunResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            run <- getField(jsonObject, "run").flatMap(v => RunInfo_JsonCodec.circeDecoder(v.hcursor))
          } yield RunResult(run)
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