import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ExpressionHintQuery(
    target: ExpressionHintTarget,
    expression: String,
    caretUtf16: Int,
    limit: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ExpressionHintQuery.baboonDomainVersion
    override def baboonDomainIdentifier: String = ExpressionHintQuery.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ExpressionHintQuery.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ExpressionHintQuery.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ExpressionHintQuery.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ExpressionHintQuery.baboonMinReaderVersions
  }
  
  object ExpressionHintQuery {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ExpressionHintQuery"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ExpressionHintQuery] = ExpressionHintQuery_JsonCodec.instance
  }
  
  object ExpressionHintQuery_JsonCodec extends BaboonJsonCodec.BaseGenerated[ExpressionHintQuery, BaboonJsonCodec[ExpressionHintQuery]] {
    def encode(ctx: BaboonCodecContext, value: ExpressionHintQuery): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "target" -> ExpressionHintTarget_JsonCodec.instance.encode(ctx, value.target),
        "expression" -> Json.fromString(value.expression),
        "caretUtf16" -> Json.fromInt(value.caretUtf16),
        "limit" -> Json.fromInt(value.limit)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpressionHintQuery] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            target <- getField(jsonObject, "target").flatMap(v => ExpressionHintTarget_JsonCodec.circeDecoder(v.hcursor))
            expression <- getField(jsonObject, "expression").flatMap(v => decodeString(v.hcursor))
            caretUtf16 <- getField(jsonObject, "caretUtf16").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield ExpressionHintQuery(target,expression,caretUtf16,limit)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ExpressionHintQuery: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ExpressionHintQuery.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ExpressionHintQuery.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ExpressionHintQuery.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpressionHintQuery]] = Lazy(ExpressionHintQuery_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpressionHintQuery]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ExpressionHintQuery] = LazyInstance.value
  }
}