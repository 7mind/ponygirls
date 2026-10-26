package chronicle

import cats.effect.IO
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8

object ProblemPassageHttp {
  def request(config: ModelConfig,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): Json = {
    val source=window.sourceJson.mapObject(_.add("previous",previous.map(ProblemPassages.carryJson).getOrElse(Json.Null)))
    val payload=Json.obj("model"->Json.fromString(config.model),"temperature"->Json.fromInt(0),"max_tokens"->Json.fromInt(config.requestPolicy.responseTokens),
      "response_format"->ProblemPassages.responseFormat(window),"messages"->Json.arr(
        Json.obj("role"->Json.fromString("system"),"content"->Json.fromString(ProblemPassages.systemPrompt)),
        Json.obj("role"->Json.fromString("user"),"content"->Json.fromString(source.noSpaces))))
    val request=config.requestPolicy match {
      case AnnotationRequestPolicy.StrictJsonSchema => payload
      case AnnotationRequestPolicy.GlmMaxReasoning => payload.mapObject(_.add("chat_template_kwargs",Json.obj("reasoning_effort"->Json.fromString("max"))))
    }
    val size=request.noSpaces.getBytes(UTF_8).length
    Check(size-window.encodedSourceContentBytes<=ProblemPassages.requestReserveBytes,"config","passage request exceeds reserved context/schema budget")
    Check(size<=ProblemPassages.maximumRequestBytes,"invalid","passage request byte bound")
    request
  }

  def response(window: ProblemPassages.Window,hasPrevious: Boolean,json: Json): ProblemPassages.Decision = {
    val choices=json.hcursor.get[List[Json]]("choices").fold(_ => throw DomainError("model-output","missing passage choices"),identity)
    Check(choices.size==1,"model-output","invalid passage choice count")
    val choice=choices.head.hcursor
    val finish=choice.get[String]("finish_reason").fold(_ => throw DomainError("model-output","missing passage finish reason"),identity)
    Check(finish!="length","model-output/truncated","passage token limit reached")
    Check(finish=="stop","model-output","passage annotation did not complete")
    val message=choice.downField("message")
    Check(List("refusal","tool_calls","function_call").forall(field => message.downField(field).focus.forall(_.isNull)),"model-output","passage refusal or tool call")
    val content=message.get[String]("content").fold(_ => throw DomainError("model-output","missing passage content"),identity)
    Check(content.nonEmpty,"model-output","empty passage content")
    ProblemPassages.decode(window,hasPrevious,ModelOutput.parse(content))
  }
}

final class OpenAIProblemPassageAnnotator(http: ModelHttp,config: Config) extends ProblemPassageAnnotator {
  def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO.defer {
    val cfg=config.annotation
    val request=ProblemPassageHttp.request(cfg,window,previous)
    http.post(ModelCallContext(owner,ModelWorkload.IndexAnnotation),cfg.endpoint,cfg.credentialFile,cfg.timeoutSeconds,cfg.maxResponseBytes,request).map(ProblemPassageHttp.response(window,previous.nonEmpty,_))
  }
}
