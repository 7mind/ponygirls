package chronicle

import chronicle.api.*
import io.circe.Json

enum McpResponseFormat { case Json,Text }

object McpPresentation {
  def format(arguments: Json): McpResponseFormat = {
    Check(arguments.isObject,"invalid","arguments object required")
    arguments.hcursor.downField("responseFormat").focus match {
      case None => McpResponseFormat.Json
      case Some(value) if value.asString.contains("json") => McpResponseFormat.Json
      case Some(value) if value.asString.contains("text") => McpResponseFormat.Text
      case _ => throw DomainError("invalid","responseFormat must be json or text")
    }
  }
  private def content(text: String,error: Boolean): Json = Json.obj(
    "content"->Json.arr(Json.obj("type"->Json.fromString("text"),"text"->Json.fromString(text))),"isError"->Json.fromBoolean(error))

  def result(value: Result,selected: McpResponseFormat,sessionId: Option[String]): Json = {
    val canonical=Wire.encode(Result.codecJson,value)
    selected match {
      case McpResponseFormat.Json => content(canonical.noSpaces,false)
      case McpResponseFormat.Text => bounded(content(McpText.render(value,sessionId),false).mapObject(_.add("structuredContent",canonical)))
    }
  }
  def failure(value: Failure,selected: McpResponseFormat): Json = selected match {
    case McpResponseFormat.Json => content(Wire.encode(Failure.codecJson,value).noSpaces,true)
    case McpResponseFormat.Text => bounded(content(McpText.failure(value),true).mapObject(_.add("structuredContent",Wire.encode(Failure.codecJson,value))))
  }
  private def bounded(value: Json): Json = {
    McpRunJson.check(value,McpRunLimits.maximumResultBytes,"mcp-result-limit")
    value
  }

  /** Only opt-in text is projected; legacy model input is byte-for-byte unchanged. */
  def modelContent(arguments: Json,value: Json): String = format(arguments) match {
    case McpResponseFormat.Json => value.noSpaces
    case McpResponseFormat.Text =>
      Check(value.asObject.exists(_.keys.toSet==Set("content","isError","structuredContent")),"mcp-result-limit","invalid text result envelope")
      val c=value.hcursor
      val blocks=c.get[List[Json]]("content").fold(_ => throw DomainError("mcp-result-limit","invalid text content"),identity)
      Check(blocks.size==1 && blocks.head.asObject.exists(_.keys.toSet==Set("type","text")) && blocks.head.hcursor.get[String]("type").toOption.contains("text"),"mcp-result-limit","one text block required")
      val text=blocks.head.hcursor.get[String]("text").fold(_ => throw DomainError("mcp-result-limit","text required"),identity)
      val error=c.get[Boolean]("isError").fold(_ => throw DomainError("mcp-result-limit","isError required"),identity)
      val canonical=c.downField("structuredContent").focus.get
      val expected=if(error) McpText.failure(Wire.decode(Failure.codecJson,canonical))
        else McpText.render(Wire.decode(Result.codecJson,canonical),arguments.hcursor.get[String]("sessionId").toOption)
      Check(text==expected,"mcp-result-limit","text does not match the canonical presentation")
      text
  }
}
