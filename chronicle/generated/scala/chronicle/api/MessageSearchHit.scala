import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class MessageSearchHit(
    messageId: String,
    position: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = MessageSearchHit.baboonDomainVersion
    override def baboonDomainIdentifier: String = MessageSearchHit.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = MessageSearchHit.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = MessageSearchHit.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = MessageSearchHit.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = MessageSearchHit.baboonMinReaderVersions
  }
  
  object MessageSearchHit {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#MessageSearchHit"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[MessageSearchHit] = MessageSearchHit_JsonCodec.instance
  }
  
  object MessageSearchHit_JsonCodec extends BaboonJsonCodec.BaseGenerated[MessageSearchHit, BaboonJsonCodec[MessageSearchHit]] {
    def encode(ctx: BaboonCodecContext, value: MessageSearchHit): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "messageId" -> Json.fromString(value.messageId),
        "position" -> Json.fromInt(value.position)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, MessageSearchHit] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            messageId <- getField(jsonObject, "messageId").flatMap(v => decodeString(v.hcursor))
            position <- getField(jsonObject, "position").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield MessageSearchHit(messageId,position)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to MessageSearchHit: object expected"))
      }
    }
  
    def baboonDomainVersion: String = MessageSearchHit.baboonDomainVersion
    
    def baboonDomainIdentifier: String = MessageSearchHit.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = MessageSearchHit.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[MessageSearchHit]] = Lazy(MessageSearchHit_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[MessageSearchHit]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[MessageSearchHit] = LazyInstance.value
  }
}