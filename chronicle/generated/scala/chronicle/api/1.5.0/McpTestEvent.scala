import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  final case class McpTestEvent(
    sequence: Long,
    observedAt: String,
    item: McpTestItem
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = McpTestEvent.baboonDomainVersion
    override def baboonDomainIdentifier: String = McpTestEvent.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = McpTestEvent.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = McpTestEvent.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = McpTestEvent.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = McpTestEvent.baboonMinReaderVersions
  }
  
  object McpTestEvent {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#McpTestEvent"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[McpTestEvent] = McpTestEvent_JsonCodec.instance
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  object McpTestEvent_JsonCodec extends BaboonJsonCodec.BaseGenerated[McpTestEvent, BaboonJsonCodec[McpTestEvent]] {
    def encode(ctx: BaboonCodecContext, value: McpTestEvent): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sequence" -> Json.fromString(value.sequence.toString),
        "observedAt" -> Json.fromString(value.observedAt),
        "item" -> McpTestItem_JsonCodec.instance.encode(ctx, value.item)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpTestEvent] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sequence <- getField(jsonObject, "sequence").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            observedAt <- getField(jsonObject, "observedAt").flatMap(v => decodeString(v.hcursor))
            item <- getField(jsonObject, "item").flatMap(v => McpTestItem_JsonCodec.circeDecoder(v.hcursor))
          } yield McpTestEvent(sequence,observedAt,item)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to McpTestEvent: object expected"))
      }
    }
  
    def baboonDomainVersion: String = McpTestEvent.baboonDomainVersion
    
    def baboonDomainIdentifier: String = McpTestEvent.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = McpTestEvent.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpTestEvent]] = Lazy(McpTestEvent_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[McpTestEvent]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[McpTestEvent] = LazyInstance.value
  }
}