import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
  final case class Message(
    id: String,
    parentId: Option[String],
    role: String,
    text: String,
    timestamp: Option[String],
    recordIndex: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = Message.baboonDomainVersion
    override def baboonDomainIdentifier: String = Message.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Message.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Message.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Message.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Message.baboonMinReaderVersions
  }
  
  object Message {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#Message"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Message] = Message_JsonCodec.instance
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
  object Message_JsonCodec extends BaboonJsonCodec.BaseGenerated[Message, BaboonJsonCodec[Message]] {
    def encode(ctx: BaboonCodecContext, value: Message): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "parentId" -> value.parentId.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "role" -> Json.fromString(value.role),
        "text" -> Json.fromString(value.text),
        "timestamp" -> value.timestamp.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "recordIndex" -> Json.fromInt(value.recordIndex)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Message] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            parentId <- getField(jsonObject, "parentId").flatMap(v => decodeOption(decodeString)(v.hcursor))
            role <- getField(jsonObject, "role").flatMap(v => decodeString(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
            timestamp <- getField(jsonObject, "timestamp").flatMap(v => decodeOption(decodeString)(v.hcursor))
            recordIndex <- getField(jsonObject, "recordIndex").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield Message(id,parentId,role,text,timestamp,recordIndex)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Message: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Message.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Message.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Message.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Message]] = Lazy(Message_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Message]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Message] = LazyInstance.value
  }
}