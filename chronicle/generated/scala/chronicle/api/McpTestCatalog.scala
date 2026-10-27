import io.circe.Decoder.{decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class McpTestCatalog(
    instanceId: UUID,
    model: String,
    modelRevision: String,
    maximumOutputTokens: Int,
    reasoningPolicy: String,
    limits: McpTestLimits,
    tools: List[McpToolDefinition]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = McpTestCatalog.baboonDomainVersion
    override def baboonDomainIdentifier: String = McpTestCatalog.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = McpTestCatalog.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = McpTestCatalog.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = McpTestCatalog.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = McpTestCatalog.baboonMinReaderVersions
  }
  
  object McpTestCatalog {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#McpTestCatalog"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[McpTestCatalog] = McpTestCatalog_JsonCodec.instance
  }
  
  object McpTestCatalog_JsonCodec extends BaboonJsonCodec.BaseGenerated[McpTestCatalog, BaboonJsonCodec[McpTestCatalog]] {
    def encode(ctx: BaboonCodecContext, value: McpTestCatalog): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "instanceId" -> Json.fromString(value.instanceId.toString()),
        "model" -> Json.fromString(value.model),
        "modelRevision" -> Json.fromString(value.modelRevision),
        "maximumOutputTokens" -> Json.fromInt(value.maximumOutputTokens),
        "reasoningPolicy" -> Json.fromString(value.reasoningPolicy),
        "limits" -> McpTestLimits_JsonCodec.instance.encode(ctx, value.limits),
        "tools" -> Json.fromValues(value.tools.map(e => McpToolDefinition_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpTestCatalog] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            instanceId <- getField(jsonObject, "instanceId").flatMap(v => decodeUUID(v.hcursor))
            model <- getField(jsonObject, "model").flatMap(v => decodeString(v.hcursor))
            modelRevision <- getField(jsonObject, "modelRevision").flatMap(v => decodeString(v.hcursor))
            maximumOutputTokens <- getField(jsonObject, "maximumOutputTokens").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            reasoningPolicy <- getField(jsonObject, "reasoningPolicy").flatMap(v => decodeString(v.hcursor))
            limits <- getField(jsonObject, "limits").flatMap(v => McpTestLimits_JsonCodec.circeDecoder(v.hcursor))
            tools <- getField(jsonObject, "tools").flatMap(v => decodeList(McpToolDefinition_JsonCodec.circeDecoder)(v.hcursor))
          } yield McpTestCatalog(instanceId,model,modelRevision,maximumOutputTokens,reasoningPolicy,limits,tools)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to McpTestCatalog: object expected"))
      }
    }
  
    def baboonDomainVersion: String = McpTestCatalog.baboonDomainVersion
    
    def baboonDomainIdentifier: String = McpTestCatalog.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = McpTestCatalog.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpTestCatalog]] = Lazy(McpTestCatalog_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[McpTestCatalog]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[McpTestCatalog] = LazyInstance.value
  }
}