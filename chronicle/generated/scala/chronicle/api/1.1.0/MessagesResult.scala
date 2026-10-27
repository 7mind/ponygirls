import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.5.0")
  final case class MessagesResult(
    messages: List[Message],
    total: Int,
    offset: Int,
    view: ContentView
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = MessagesResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = MessagesResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = MessagesResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = MessagesResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = MessagesResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = MessagesResult.baboonMinReaderVersions
  }
  
  object MessagesResult {
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#MessagesResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical", "1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[MessagesResult] = MessagesResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.5.0")
  object MessagesResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[MessagesResult, BaboonJsonCodec[MessagesResult]] {
    def encode(ctx: BaboonCodecContext, value: MessagesResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "messages" -> Json.fromValues(value.messages.map(e => Message_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromInt(value.total),
        "offset" -> Json.fromInt(value.offset),
        "view" -> ContentView_JsonCodec.instance.encode(ctx, value.view)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, MessagesResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            messages <- getField(jsonObject, "messages").flatMap(v => decodeList(Message_JsonCodec.circeDecoder)(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            view <- getField(jsonObject, "view").flatMap(v => ContentView_JsonCodec.circeDecoder(v.hcursor))
          } yield MessagesResult(messages,total,offset,view)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to MessagesResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = MessagesResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = MessagesResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = MessagesResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[MessagesResult]] = Lazy(MessagesResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[MessagesResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[MessagesResult] = LazyInstance.value
  }
}