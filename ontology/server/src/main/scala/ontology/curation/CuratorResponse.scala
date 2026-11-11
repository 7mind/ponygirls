package ontology.curation

import io.circe.{Json, JsonObject}
import ontology.api.CurationProposal
import ontology.{Wire}
import ontology.domain.{Fault, Require}
import java.nio.charset.StandardCharsets.UTF_8

final case class AssistantResponse(finish: String, content: Option[String], toolCalls: Vector[Json])
object CuratorResponse {
  private def protocol(message: String): Nothing = throw Fault("curator-protocol", message)
  private def obj(value: Json): JsonObject = value.asObject.getOrElse(protocol("model object required"))
  private def field(value: JsonObject, name: String): Json = value(name).getOrElse(protocol("model field missing"))
  private def text(value: JsonObject, name: String): String = field(value, name).asString.getOrElse(protocol("model string field required"))

  def envelope(value: Json): AssistantResponse = {
    val root = obj(value)
    Require(root("error").forall(_.isNull), "curator-protocol", "model returned an error envelope")
    val choices = field(root, "choices").asArray.getOrElse(protocol("model choices array required"))
    Require(choices.size == 1, "curator-protocol", "exactly one model choice required")
    val choice = obj(choices.head)
    choice("index").foreach(index => Require(index.asNumber.flatMap(_.toInt).contains(0), "curator-protocol", "invalid choice index"))
    val message = obj(field(choice, "message"))
    Require(text(message, "role") == "assistant", "curator-protocol", "assistant role required")
    Require(message("refusal").forall(_.isNull), "curator-protocol", "model refusal")
    Require(message("function_call").forall(_.isNull), "curator-protocol", "legacy function calls forbidden")
    val content = message("content") match {
      case None => None
      case Some(json) if json.isNull => None
      case Some(json) => Some(json.asString.getOrElse(protocol("plain assistant text required")))
    }
    val calls = message("tool_calls") match {
      case None => Vector.empty
      case Some(json) if json.isNull => Vector.empty
      case Some(json) => json.asArray.getOrElse(protocol("tool calls array required"))
    }
    AssistantResponse(text(choice, "finish_reason"), content, calls)
  }

  def proposal(generation: Long, frontier: Long, response: AssistantResponse): CurationProposal = {
    Require(response.finish == "stop" && response.toolCalls.isEmpty, "curator-protocol", "final proposal cannot contain tool calls or an incomplete finish")
    val content = response.content.getOrElse(protocol("final proposal text required"))
    Require(UTF_8.newEncoder().canEncode(content), "curator-protocol", "invalid proposal text")
    val value = Wire.decode(CurationProposal.codecJson, Wire.parse(content.getBytes(UTF_8)))
    Require(value.expectedGeneration == generation && value.frontier == frontier, "curator-snapshot", "proposal differs from frozen coordinates")
    value
  }
}
