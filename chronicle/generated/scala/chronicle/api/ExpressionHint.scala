import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ExpressionHint(
    kind: ExpressionHintKind,
    label: String,
    insertText: String,
    caretOffsetUtf16: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ExpressionHint.baboonDomainVersion
    override def baboonDomainIdentifier: String = ExpressionHint.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ExpressionHint.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ExpressionHint.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ExpressionHint.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ExpressionHint.baboonMinReaderVersions
  }
  
  object ExpressionHint {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ExpressionHint"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ExpressionHint] = ExpressionHint_JsonCodec.instance
  }
  
  object ExpressionHint_JsonCodec extends BaboonJsonCodec.BaseGenerated[ExpressionHint, BaboonJsonCodec[ExpressionHint]] {
    def encode(ctx: BaboonCodecContext, value: ExpressionHint): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "kind" -> ExpressionHintKind_JsonCodec.instance.encode(ctx, value.kind),
        "label" -> Json.fromString(value.label),
        "insertText" -> Json.fromString(value.insertText),
        "caretOffsetUtf16" -> Json.fromInt(value.caretOffsetUtf16)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpressionHint] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            kind <- getField(jsonObject, "kind").flatMap(v => ExpressionHintKind_JsonCodec.circeDecoder(v.hcursor))
            label <- getField(jsonObject, "label").flatMap(v => decodeString(v.hcursor))
            insertText <- getField(jsonObject, "insertText").flatMap(v => decodeString(v.hcursor))
            caretOffsetUtf16 <- getField(jsonObject, "caretOffsetUtf16").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield ExpressionHint(kind,label,insertText,caretOffsetUtf16)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ExpressionHint: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ExpressionHint.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ExpressionHint.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ExpressionHint.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpressionHint]] = Lazy(ExpressionHint_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpressionHint]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ExpressionHint] = LazyInstance.value
  }
}