import io.circe.Decoder.{decodeBoolean, decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  final case class ExpressionHintsResult(
    queryHash: String,
    observedAt: String,
    replaceStartUtf16: Int,
    replaceEndUtf16: Int,
    hints: List[ExpressionHint],
    truncated: Boolean
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ExpressionHintsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ExpressionHintsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ExpressionHintsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ExpressionHintsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ExpressionHintsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ExpressionHintsResult.baboonMinReaderVersions
  }
  
  object ExpressionHintsResult {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ExpressionHintsResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ExpressionHintsResult] = ExpressionHintsResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  object ExpressionHintsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ExpressionHintsResult, BaboonJsonCodec[ExpressionHintsResult]] {
    def encode(ctx: BaboonCodecContext, value: ExpressionHintsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "queryHash" -> Json.fromString(value.queryHash),
        "observedAt" -> Json.fromString(value.observedAt),
        "replaceStartUtf16" -> Json.fromInt(value.replaceStartUtf16),
        "replaceEndUtf16" -> Json.fromInt(value.replaceEndUtf16),
        "hints" -> Json.fromValues(value.hints.map(e => ExpressionHint_JsonCodec.instance.encode(ctx, e))),
        "truncated" -> Json.fromBoolean(value.truncated)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpressionHintsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            queryHash <- getField(jsonObject, "queryHash").flatMap(v => decodeString(v.hcursor))
            observedAt <- getField(jsonObject, "observedAt").flatMap(v => decodeString(v.hcursor))
            replaceStartUtf16 <- getField(jsonObject, "replaceStartUtf16").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            replaceEndUtf16 <- getField(jsonObject, "replaceEndUtf16").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            hints <- getField(jsonObject, "hints").flatMap(v => decodeList(ExpressionHint_JsonCodec.circeDecoder)(v.hcursor))
            truncated <- getField(jsonObject, "truncated").flatMap(v => decodeBoolean(v.hcursor))
          } yield ExpressionHintsResult(queryHash,observedAt,replaceStartUtf16,replaceEndUtf16,hints,truncated)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ExpressionHintsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ExpressionHintsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ExpressionHintsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ExpressionHintsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpressionHintsResult]] = Lazy(ExpressionHintsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpressionHintsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ExpressionHintsResult] = LazyInstance.value
  }
}