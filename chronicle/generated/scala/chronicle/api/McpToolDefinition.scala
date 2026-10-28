import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class McpToolDefinition(
    name: String,
    description: String,
    inputSchemaJson: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = McpToolDefinition.baboonDomainVersion
    override def baboonDomainIdentifier: String = McpToolDefinition.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = McpToolDefinition.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = McpToolDefinition.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = McpToolDefinition.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = McpToolDefinition.baboonMinReaderVersions
  }
  
  object McpToolDefinition {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#McpToolDefinition"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[McpToolDefinition] = McpToolDefinition_JsonCodec.instance
  }
  
  object McpToolDefinition_JsonCodec extends BaboonJsonCodec.BaseGenerated[McpToolDefinition, BaboonJsonCodec[McpToolDefinition]] {
    def encode(ctx: BaboonCodecContext, value: McpToolDefinition): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "name" -> Json.fromString(value.name),
        "description" -> Json.fromString(value.description),
        "inputSchemaJson" -> Json.fromString(value.inputSchemaJson)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpToolDefinition] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            name <- getField(jsonObject, "name").flatMap(v => decodeString(v.hcursor))
            description <- getField(jsonObject, "description").flatMap(v => decodeString(v.hcursor))
            inputSchemaJson <- getField(jsonObject, "inputSchemaJson").flatMap(v => decodeString(v.hcursor))
          } yield McpToolDefinition(name,description,inputSchemaJson)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to McpToolDefinition: object expected"))
      }
    }
  
    def baboonDomainVersion: String = McpToolDefinition.baboonDomainVersion
    
    def baboonDomainIdentifier: String = McpToolDefinition.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = McpToolDefinition.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpToolDefinition]] = Lazy(McpToolDefinition_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[McpToolDefinition]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[McpToolDefinition] = LazyInstance.value
  }
}