import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class McpTestLimits(
    maximumRounds: Int,
    maximumToolCalls: Int,
    maximumPromptBytes: Int,
    maximumSourceBytes: Int,
    maximumResultBytes: Int,
    maximumRequestBytes: Int,
    maximumTraceBytes: Int,
    maximumEvents: Int,
    pageBytes: Int,
    deadlineSeconds: Int,
    retentionSeconds: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = McpTestLimits.baboonDomainVersion
    override def baboonDomainIdentifier: String = McpTestLimits.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = McpTestLimits.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = McpTestLimits.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = McpTestLimits.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = McpTestLimits.baboonMinReaderVersions
  }
  
  object McpTestLimits {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#McpTestLimits"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[McpTestLimits] = McpTestLimits_JsonCodec.instance
  }
  
  object McpTestLimits_JsonCodec extends BaboonJsonCodec.BaseGenerated[McpTestLimits, BaboonJsonCodec[McpTestLimits]] {
    def encode(ctx: BaboonCodecContext, value: McpTestLimits): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "maximumRounds" -> Json.fromInt(value.maximumRounds),
        "maximumToolCalls" -> Json.fromInt(value.maximumToolCalls),
        "maximumPromptBytes" -> Json.fromInt(value.maximumPromptBytes),
        "maximumSourceBytes" -> Json.fromInt(value.maximumSourceBytes),
        "maximumResultBytes" -> Json.fromInt(value.maximumResultBytes),
        "maximumRequestBytes" -> Json.fromInt(value.maximumRequestBytes),
        "maximumTraceBytes" -> Json.fromInt(value.maximumTraceBytes),
        "maximumEvents" -> Json.fromInt(value.maximumEvents),
        "pageBytes" -> Json.fromInt(value.pageBytes),
        "deadlineSeconds" -> Json.fromInt(value.deadlineSeconds),
        "retentionSeconds" -> Json.fromInt(value.retentionSeconds)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpTestLimits] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            maximumRounds <- getField(jsonObject, "maximumRounds").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maximumToolCalls <- getField(jsonObject, "maximumToolCalls").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maximumPromptBytes <- getField(jsonObject, "maximumPromptBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maximumSourceBytes <- getField(jsonObject, "maximumSourceBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maximumResultBytes <- getField(jsonObject, "maximumResultBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maximumRequestBytes <- getField(jsonObject, "maximumRequestBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maximumTraceBytes <- getField(jsonObject, "maximumTraceBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maximumEvents <- getField(jsonObject, "maximumEvents").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            pageBytes <- getField(jsonObject, "pageBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            deadlineSeconds <- getField(jsonObject, "deadlineSeconds").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            retentionSeconds <- getField(jsonObject, "retentionSeconds").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield McpTestLimits(maximumRounds,maximumToolCalls,maximumPromptBytes,maximumSourceBytes,maximumResultBytes,maximumRequestBytes,maximumTraceBytes,maximumEvents,pageBytes,deadlineSeconds,retentionSeconds)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to McpTestLimits: object expected"))
      }
    }
  
    def baboonDomainVersion: String = McpTestLimits.baboonDomainVersion
    
    def baboonDomainIdentifier: String = McpTestLimits.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = McpTestLimits.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpTestLimits]] = Lazy(McpTestLimits_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[McpTestLimits]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[McpTestLimits] = LazyInstance.value
  }
}