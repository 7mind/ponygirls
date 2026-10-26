package chronicle
import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import org.http4s.{Message as _,*}
import org.http4s.client.Client
import io.circe.Json
class AnnotationRequestTest extends munit.FunSuite {
  private val messages=List(Message("m",None,"user","synthetic🙂",None,0))
  private val content="""{"chunks":[{"first":0,"last":0,"summary":"x","tags":[]}]}"""
  private def reply(finish: Json,message: Json): Json = Json.obj("choices"->Json.arr(Json.obj("finish_reason"->finish,"message"->message)))
  private def run(response: String,inspect: Json => Unit,policy: AnnotationRequestPolicy): Either[Throwable,List[Chunk]] = {
    val app: HttpApp[IO]=cats.data.Kleisli { request => request.as[String].map { body => inspect(Wire.parse(body)); Response[IO](Status.Ok).withEntity(response) }}
    val config=Fixtures.config()
    new OpenAIAnnotator(new ModelHttp(Client.fromHttpApp(app)),config.copy(annotation=config.annotation.copy(requestPolicy=policy))).annotate(Fragments.split(messages),messages).attempt.unsafeRunSync()
  }
  test("BG regression: annotation transport requests strict bounded structured output") {
    val response=reply(Json.fromString("stop"),Json.obj("content"->Json.fromString(content)))
    val result=run(response.noSpaces,payload => {
      val format=payload.hcursor.downField("response_format")
      assertEquals(format.get[String]("type").toOption,Some("json_schema"))
      assertEquals(format.downField("json_schema").get[Boolean]("strict").toOption,Some(true))
      val schema=format.downField("json_schema").downField("schema")
      assertEquals(schema.get[Boolean]("additionalProperties").toOption,Some(false))
      assertEquals(schema.downField("properties").downField("chunks").get[Int]("maxItems").toOption,Some(1))
    },AnnotationRequestPolicy.StrictJsonSchema)
    result.fold(throw _,chunks => assertEquals(chunks.head.text,"synthetic🙂"))
  }
  test("BG: policy sends GLM extension only by explicit selection and changes profile") {
    AnnotationRequestPolicy.values.foreach { policy =>
      val result=run(reply(Json.fromString("stop"),Json.obj("content"->Json.fromString(content))).noSpaces,payload => {
        assertEquals(payload.hcursor.get[Int]("max_tokens").toOption,Some(if(policy==AnnotationRequestPolicy.StrictJsonSchema) 2048 else 65536))
        assertEquals(payload.hcursor.downField("chat_template_kwargs").focus,if(policy==AnnotationRequestPolicy.GlmMaxReasoning) Some(Json.obj("reasoning_effort"->Json.fromString("max"))) else None)
      },policy)
      assert(result.isRight)
    }
    val config=Fixtures.config()
    assertNotEquals(config.profile,config.copy(annotation=config.annotation.copy(requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning)).profile)
  }
  test("BA: transport supports the longest configured model deadline without a 120 second cap") {
    import scala.concurrent.duration.*
    val config=Fixtures.config()
    assertEquals(ModelHttp.transportTimeout(config.copy(annotation=config.annotation.copy(timeoutSeconds=900))),900.seconds)
    assertEquals(ModelHttp.transportTimeout(config.copy(embedding=config.embedding.copy(timeoutSeconds=1200))),1200.seconds)
  }
  test("BA: annotation config policy is required and typed") {
    import Config.given
    val base=Wire.parse("""{"endpoint":"http://127.0.0.1:1","model":"x","revision":"1","credentialFile":"unused","timeoutSeconds":1,"maxResponseBytes":1024}""")
    assert(base.as[ModelConfig].isLeft)
    List(Json.Null,Json.fromString("json-object"),Json.fromString("glm-low-reasoning"),Json.fromInt(1)).foreach(value => assert(base.mapObject(_.add("requestPolicy",value)).as[ModelConfig].isLeft))
    List("strict-json-schema","glm-max-reasoning").foreach(value => assert(base.mapObject(_.add("requestPolicy",Json.fromString(value))).as[ModelConfig].isRight))
  }
  test("BA: exact bounded schema for every supported window") {
    (1 to 4).foreach { size =>
      def string(value: String)=Json.fromString(value)
      def integer(value: Int)=Json.fromInt(value)
      val index=Json.obj("type"->string("integer"),"minimum"->integer(0),"maximum"->integer(size-1))
      val chunk=Json.obj("type"->string("object"),"additionalProperties"->Json.False,"required"->Json.arr(List("first","last","summary","tags").map(string)*),
        "properties"->Json.obj("first"->index,"last"->index,"summary"->Json.obj("type"->string("string"),"maxLength"->integer(1000)),"tags"->Json.obj("type"->string("array"),"maxItems"->integer(16),"items"->Json.obj("type"->string("string"),"minLength"->integer(1),"maxLength"->integer(64)))))
      val schema=Json.obj("type"->string("object"),"additionalProperties"->Json.False,"required"->Json.arr(string("chunks")),"properties"->Json.obj("chunks"->Json.obj("type"->string("array"),"minItems"->integer(1),"maxItems"->integer(size),"items"->chunk)))
      assertEquals(AnnotationPartition.responseFormat(size),Json.obj("type"->string("json_schema"),"json_schema"->Json.obj("name"->string("annotation_partition"),"strict"->Json.True,"schema"->schema)))
    }
  }
  List(
    "length" -> reply(Json.fromString("length"),Json.obj("content"->Json.fromString(content))),
    "null" -> reply(Json.fromString("stop"),Json.obj("content"->Json.Null)),
    "empty" -> reply(Json.fromString("stop"),Json.obj("content"->Json.fromString(""))),
    "malformed" -> reply(Json.fromString("stop"),Json.obj("content"->Json.fromString("not-json"))),
    "refusal" -> reply(Json.fromString("stop"),Json.obj("content"->Json.fromString(content),"refusal"->Json.fromString("refused"))),
    "missing finish" -> Json.obj("choices"->Json.arr(Json.obj("message"->Json.obj("content"->Json.fromString(content)))))
  ).foreach { case (name,response) => test(s"BG regression: annotation $name fails with model-specific classification") {
    val result=run(response.noSpaces,_ => (),AnnotationRequestPolicy.StrictJsonSchema)
    val error=result.swap.toOption.getOrElse(fail("expected model failure"))
    assertEquals(error.asInstanceOf[DomainError].code,if(name=="length") "model-output/truncated" else "model-output")
  }}
}
