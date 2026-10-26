import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.4.0")
  final case class MessageLocation(
    view: ContentView,
    position: Int,
    total: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = MessageLocation.baboonDomainVersion
    override def baboonDomainIdentifier: String = MessageLocation.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = MessageLocation.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = MessageLocation.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = MessageLocation.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = MessageLocation.baboonMinReaderVersions
  }
  
  object MessageLocation {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#MessageLocation"
    private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[MessageLocation] = MessageLocation_JsonCodec.instance
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.4.0")
  object MessageLocation_JsonCodec extends BaboonJsonCodec.BaseGenerated[MessageLocation, BaboonJsonCodec[MessageLocation]] {
    def encode(ctx: BaboonCodecContext, value: MessageLocation): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "view" -> ContentView_JsonCodec.instance.encode(ctx, value.view),
        "position" -> Json.fromInt(value.position),
        "total" -> Json.fromInt(value.total)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, MessageLocation] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            view <- getField(jsonObject, "view").flatMap(v => ContentView_JsonCodec.circeDecoder(v.hcursor))
            position <- getField(jsonObject, "position").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield MessageLocation(view,position,total)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to MessageLocation: object expected"))
      }
    }
  
    def baboonDomainVersion: String = MessageLocation.baboonDomainVersion
    
    def baboonDomainIdentifier: String = MessageLocation.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = MessageLocation.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[MessageLocation]] = Lazy(MessageLocation_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[MessageLocation]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[MessageLocation] = LazyInstance.value
  }
}