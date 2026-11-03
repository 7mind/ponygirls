import io.circe.Decoder.{decodeBoolean, decodeList}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class AnalyzeResult(
    valid: Boolean,
    spans: List[Span]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = AnalyzeResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = AnalyzeResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = AnalyzeResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = AnalyzeResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = AnalyzeResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = AnalyzeResult.baboonMinReaderVersions
  }
  
  object AnalyzeResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#AnalyzeResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[AnalyzeResult] = AnalyzeResult_JsonCodec.instance
  }
  
  object AnalyzeResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[AnalyzeResult, BaboonJsonCodec[AnalyzeResult]] {
    def encode(ctx: BaboonCodecContext, value: AnalyzeResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "valid" -> Json.fromBoolean(value.valid),
        "spans" -> Json.fromValues(value.spans.map(e => Span_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, AnalyzeResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            valid <- getField(jsonObject, "valid").flatMap(v => decodeBoolean(v.hcursor))
            spans <- getField(jsonObject, "spans").flatMap(v => decodeList(Span_JsonCodec.circeDecoder)(v.hcursor))
          } yield AnalyzeResult(valid,spans)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to AnalyzeResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = AnalyzeResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = AnalyzeResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = AnalyzeResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[AnalyzeResult]] = Lazy(AnalyzeResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[AnalyzeResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[AnalyzeResult] = LazyInstance.value
  }
}