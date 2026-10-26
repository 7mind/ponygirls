import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package chronicle.api {
  sealed trait McpTestItem extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = McpTestItem.baboonDomainVersion
    override def baboonDomainIdentifier: String = McpTestItem.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = McpTestItem.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = McpTestItem.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = McpTestItem.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = McpTestItem.baboonMinReaderVersions
  }
  
  object McpTestItem {
    final case class ToolCall(
      callId: String,
      tool: String,
      partIndex: Int,
      partCount: Int,
      argumentsJsonPart: String
    ) extends McpTestItem with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = McpTestItem.ToolCall.baboonDomainVersion
      override def baboonDomainIdentifier: String = McpTestItem.ToolCall.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = McpTestItem.ToolCall.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = McpTestItem.ToolCall.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = McpTestItem.ToolCall.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = McpTestItem.ToolCall.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = McpTestItem.ToolCall.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = McpTestItem.ToolCall.baboonAdtType
    }
    
    object ToolCall {
      def baboonDomainVersion: String = "1.4.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall"
      private lazy val _baboonSameInVersions: List[String] = List("1.4.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#McpTestItem"
      def baboonAdtType: _root_.java.lang.Class[?] = McpTestItem.getClass
      def codecJson: BaboonJsonCodec[McpTestItem.ToolCall] = McpTestItem.ToolCall_JsonCodec.instance
    }
    
    object ToolCall_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[McpTestItem.ToolCall, BaboonJsonCodec[McpTestItem.ToolCall]] {
      def encode(ctx: BaboonCodecContext, value: McpTestItem.ToolCall): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "callId" -> Json.fromString(value.callId),
          "tool" -> Json.fromString(value.tool),
          "partIndex" -> Json.fromInt(value.partIndex),
          "partCount" -> Json.fromInt(value.partCount),
          "argumentsJsonPart" -> Json.fromString(value.argumentsJsonPart)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpTestItem.ToolCall] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              callId <- getField(jsonObject, "callId").flatMap(v => decodeString(v.hcursor))
              tool <- getField(jsonObject, "tool").flatMap(v => decodeString(v.hcursor))
              partIndex <- getField(jsonObject, "partIndex").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              partCount <- getField(jsonObject, "partCount").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              argumentsJsonPart <- getField(jsonObject, "argumentsJsonPart").flatMap(v => decodeString(v.hcursor))
            } yield McpTestItem.ToolCall(callId,tool,partIndex,partCount,argumentsJsonPart)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ToolCall: object expected"))
        }
      }
    
      def baboonDomainVersion: String = McpTestItem.ToolCall.baboonDomainVersion
      
      def baboonDomainIdentifier: String = McpTestItem.ToolCall.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = McpTestItem.ToolCall.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = McpTestItem.ToolCall.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = McpTestItem.ToolCall.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpTestItem.ToolCall]] = Lazy(McpTestItem.ToolCall_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[McpTestItem.ToolCall]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[McpTestItem.ToolCall] = LazyInstance.value
    }
    
    
    final case class ToolResult(
      callId: String,
      partIndex: Int,
      partCount: Int,
      resultJsonPart: String
    ) extends McpTestItem with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = McpTestItem.ToolResult.baboonDomainVersion
      override def baboonDomainIdentifier: String = McpTestItem.ToolResult.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = McpTestItem.ToolResult.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = McpTestItem.ToolResult.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = McpTestItem.ToolResult.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = McpTestItem.ToolResult.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = McpTestItem.ToolResult.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = McpTestItem.ToolResult.baboonAdtType
    }
    
    object ToolResult {
      def baboonDomainVersion: String = "1.4.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult"
      private lazy val _baboonSameInVersions: List[String] = List("1.4.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#McpTestItem"
      def baboonAdtType: _root_.java.lang.Class[?] = McpTestItem.getClass
      def codecJson: BaboonJsonCodec[McpTestItem.ToolResult] = McpTestItem.ToolResult_JsonCodec.instance
    }
    
    object ToolResult_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[McpTestItem.ToolResult, BaboonJsonCodec[McpTestItem.ToolResult]] {
      def encode(ctx: BaboonCodecContext, value: McpTestItem.ToolResult): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "callId" -> Json.fromString(value.callId),
          "partIndex" -> Json.fromInt(value.partIndex),
          "partCount" -> Json.fromInt(value.partCount),
          "resultJsonPart" -> Json.fromString(value.resultJsonPart)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpTestItem.ToolResult] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              callId <- getField(jsonObject, "callId").flatMap(v => decodeString(v.hcursor))
              partIndex <- getField(jsonObject, "partIndex").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              partCount <- getField(jsonObject, "partCount").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              resultJsonPart <- getField(jsonObject, "resultJsonPart").flatMap(v => decodeString(v.hcursor))
            } yield McpTestItem.ToolResult(callId,partIndex,partCount,resultJsonPart)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ToolResult: object expected"))
        }
      }
    
      def baboonDomainVersion: String = McpTestItem.ToolResult.baboonDomainVersion
      
      def baboonDomainIdentifier: String = McpTestItem.ToolResult.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = McpTestItem.ToolResult.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = McpTestItem.ToolResult.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = McpTestItem.ToolResult.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpTestItem.ToolResult]] = Lazy(McpTestItem.ToolResult_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[McpTestItem.ToolResult]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[McpTestItem.ToolResult] = LazyInstance.value
    }
    
    
    final case class Response(
      partIndex: Int,
      partCount: Int,
      textPart: String
    ) extends McpTestItem with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = McpTestItem.Response.baboonDomainVersion
      override def baboonDomainIdentifier: String = McpTestItem.Response.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = McpTestItem.Response.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = McpTestItem.Response.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = McpTestItem.Response.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = McpTestItem.Response.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = McpTestItem.Response.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = McpTestItem.Response.baboonAdtType
    }
    
    object Response {
      def baboonDomainVersion: String = "1.4.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#McpTestItem]#Response"
      private lazy val _baboonSameInVersions: List[String] = List("1.4.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#McpTestItem"
      def baboonAdtType: _root_.java.lang.Class[?] = McpTestItem.getClass
      def codecJson: BaboonJsonCodec[McpTestItem.Response] = McpTestItem.Response_JsonCodec.instance
    }
    
    object Response_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[McpTestItem.Response, BaboonJsonCodec[McpTestItem.Response]] {
      def encode(ctx: BaboonCodecContext, value: McpTestItem.Response): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "partIndex" -> Json.fromInt(value.partIndex),
          "partCount" -> Json.fromInt(value.partCount),
          "textPart" -> Json.fromString(value.textPart)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpTestItem.Response] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              partIndex <- getField(jsonObject, "partIndex").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              partCount <- getField(jsonObject, "partCount").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              textPart <- getField(jsonObject, "textPart").flatMap(v => decodeString(v.hcursor))
            } yield McpTestItem.Response(partIndex,partCount,textPart)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Response: object expected"))
        }
      }
    
      def baboonDomainVersion: String = McpTestItem.Response.baboonDomainVersion
      
      def baboonDomainIdentifier: String = McpTestItem.Response.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = McpTestItem.Response.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = McpTestItem.Response.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = McpTestItem.Response.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpTestItem.Response]] = Lazy(McpTestItem.Response_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[McpTestItem.Response]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[McpTestItem.Response] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#McpTestItem"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[McpTestItem] = McpTestItem_JsonCodec.instance
  }
  
  object McpTestItem_JsonCodec extends BaboonJsonCodec.BaseGenerated[McpTestItem, BaboonJsonCodec[McpTestItem]] {
    def encode(ctx: BaboonCodecContext, value: McpTestItem): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case toolcall: McpTestItem.ToolCall => Json.obj("ToolCall" -> McpTestItem.ToolCall_JsonCodec.instance.encode(ctx, toolcall))
        
        case toolresult: McpTestItem.ToolResult => Json.obj("ToolResult" -> McpTestItem.ToolResult_JsonCodec.instance.encode(ctx, toolresult))
        
        case response: McpTestItem.Response => Json.obj("Response" -> McpTestItem.Response_JsonCodec.instance.encode(ctx, response))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpTestItem] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "ToolCall" =>
                  McpTestItem.ToolCall_JsonCodec.instance.decode(ctx, json)
                
                case "ToolResult" =>
                  McpTestItem.ToolResult_JsonCodec.instance.decode(ctx, json)
                
                case "Response" =>
                  McpTestItem.Response_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to McpTestItem: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to McpTestItem: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to McpTestItem: object expected"))
      }
    }
  
    def baboonDomainVersion: String = McpTestItem.baboonDomainVersion
    
    def baboonDomainIdentifier: String = McpTestItem.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = McpTestItem.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpTestItem]] = Lazy(McpTestItem_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[McpTestItem]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[McpTestItem] = LazyInstance.value
  }
}