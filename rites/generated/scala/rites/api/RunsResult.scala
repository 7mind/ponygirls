import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class RunsResult(
    items: List[RunInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RunsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RunsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RunsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RunsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RunsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RunsResult.baboonMinReaderVersions
  }
  
  object RunsResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#RunsResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RunsResult] = RunsResult_JsonCodec.instance
  }
  
  object RunsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RunsResult, BaboonJsonCodec[RunsResult]] {
    def encode(ctx: BaboonCodecContext, value: RunsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => RunInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RunsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(RunInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield RunsResult(items)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RunsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RunsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RunsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RunsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RunsResult]] = Lazy(RunsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RunsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RunsResult] = LazyInstance.value
  }
}