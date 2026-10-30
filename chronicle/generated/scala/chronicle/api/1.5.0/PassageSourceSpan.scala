import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  final case class PassageSourceSpan(
    messageId: String,
    messagePosition: Int,
    start: Int,
    `end`: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = PassageSourceSpan.baboonDomainVersion
    override def baboonDomainIdentifier: String = PassageSourceSpan.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PassageSourceSpan.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PassageSourceSpan.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PassageSourceSpan.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PassageSourceSpan.baboonMinReaderVersions
  }
  
  object PassageSourceSpan {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#PassageSourceSpan"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[PassageSourceSpan] = PassageSourceSpan_JsonCodec.instance
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  object PassageSourceSpan_JsonCodec extends BaboonJsonCodec.BaseGenerated[PassageSourceSpan, BaboonJsonCodec[PassageSourceSpan]] {
    def encode(ctx: BaboonCodecContext, value: PassageSourceSpan): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "messageId" -> Json.fromString(value.messageId),
        "messagePosition" -> Json.fromInt(value.messagePosition),
        "start" -> Json.fromInt(value.start),
        "end" -> Json.fromInt(value.`end`)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PassageSourceSpan] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            messageId <- getField(jsonObject, "messageId").flatMap(v => decodeString(v.hcursor))
            messagePosition <- getField(jsonObject, "messagePosition").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            start <- getField(jsonObject, "start").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            `end` <- getField(jsonObject, "end").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield PassageSourceSpan(messageId,messagePosition,start,`end`)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PassageSourceSpan: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PassageSourceSpan.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PassageSourceSpan.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PassageSourceSpan.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PassageSourceSpan]] = Lazy(PassageSourceSpan_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PassageSourceSpan]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PassageSourceSpan] = LazyInstance.value
  }
}