import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  final case class Span(
    messageId: String,
    start: Int,
    `end`: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = Span.baboonDomainVersion
    override def baboonDomainIdentifier: String = Span.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Span.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Span.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Span.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Span.baboonMinReaderVersions
  }
  
  object Span {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#Span"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Span] = Span_JsonCodec.instance
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  object Span_JsonCodec extends BaboonJsonCodec.BaseGenerated[Span, BaboonJsonCodec[Span]] {
    def encode(ctx: BaboonCodecContext, value: Span): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "messageId" -> Json.fromString(value.messageId),
        "start" -> Json.fromInt(value.start),
        "end" -> Json.fromInt(value.`end`)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Span] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            messageId <- getField(jsonObject, "messageId").flatMap(v => decodeString(v.hcursor))
            start <- getField(jsonObject, "start").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            `end` <- getField(jsonObject, "end").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield Span(messageId,start,`end`)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Span: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Span.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Span.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Span.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Span]] = Lazy(Span_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Span]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Span] = LazyInstance.value
  }
}