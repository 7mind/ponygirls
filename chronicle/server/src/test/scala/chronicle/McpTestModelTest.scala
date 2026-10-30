package chronicle

import cats.effect.{IO,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.nio.file.Files
import org.http4s.{Message as _,*}
import org.http4s.client.Client
import org.http4s.ember.server.EmberServerBuilder
import com.comcast.ip4s.*
import org.typelevel.ci.CIString
import scala.concurrent.duration.*

class McpTestModelTest extends munit.FunSuite {
  import McpTestFixtures.*
  override val munitTimeout = 120.seconds
  private def http(client: Client[IO]): ModelHttp = {
    val base=Fixtures.config()
    ModelFixtures.http(client,base.copy(users=List(base.users.head.copy(id=identity.user.id))))
  }
  private val initial=Vector(Json.obj("role"->Json.fromString("system"),"content"->Json.fromString(McpToolModelCodec.system)),Json.obj("role"->Json.fromString("user"),"content"->Json.fromString("synthetic tool request")))
  private def code(result: Either[Throwable,?]): String = result.left.toOption match {
    case Some(error: DomainError) => error.code
    case Some(error) => throw error
    case None => fail("expected failure")
  }
  private def credential: Resource[IO,String] = Resource.make(IO {
    val path=Files.createTempFile("mcp-test-model-",".credential")
    Files.writeString(path,"synthetic-api-key\n")
    path
  })(path => IO(Files.delete(path))).map(_.toString)

  private def withMessage(reply: Json)(change: Json => Json): Json = reply.mapObject { root =>
    root.add("choices",Json.arr(reply.hcursor.get[List[Json]]("choices").toOption.get.map(choice => choice.mapObject(obj => obj.add("message",change(obj("message").get))))*))
  }
  private def field(reply: Json,name: String,value: Json): Json = withMessage(reply)(_.mapObject(_.add(name,value)))
  private def finish(reply: Json,value: String): Json = reply.mapObject(root => root.add("choices",Json.arr(reply.hcursor.get[List[Json]]("choices").toOption.get.map(_.mapObject(_.add("finish_reason",Json.fromString(value))))*)))
  private def callField(reply: Json,name: String,value: Json): Json = withMessage(reply)(_.mapObject { message =>
    message.add("tool_calls",Json.arr(message("tool_calls").get.asArray.get.map(call => call.mapObject(_.add(name,value)))*))
  })
  private def args(reply: Json,value: String): Json = withMessage(reply)(_.mapObject { message =>
    message.add("tool_calls",Json.arr(message("tool_calls").get.asArray.get.map(call => call.mapObject(obj => obj.add("function",obj("function").get.mapObject(_.add("arguments",Json.fromString(value))))))*))
  })

  test("BG: exact configured model, MAX reasoning, real function schemas, credential header and metadata; no annotation response format") {
    credential.use { file =>
      val configured=config.copy(endpoint="http://127.0.0.1:1/v1/tool-chat",credentialFile=file)
      val app: HttpApp[IO]=cats.data.Kleisli { request => request.as[String].map { body =>
        assertEquals(request.method,Method.POST)
        assertEquals(request.uri.path.renderString,"/v1/tool-chat")
        assertEquals(request.headers.get(CIString("Authorization")).map(_.head.value),Some("Bearer synthetic-api-key"))
        assertEquals(request.headers.get(CIString("Content-Type")).map(_.head.value),Some("application/json"))
        val payload=Wire.parse(body)
        assertEquals(payload.hcursor.get[String]("model").toOption,Some("approved-model"))
        assertEquals(payload.hcursor.get[Int]("max_tokens").toOption,Some(65536))
        assertEquals(payload.hcursor.downField("chat_template_kwargs").get[String]("reasoning_effort").toOption,Some("max"))
        assertEquals(payload.hcursor.get[Boolean]("stream").toOption,Some(false))
        assert(payload.hcursor.downField("response_format").focus.isEmpty)
        val functions=payload.hcursor.get[List[Json]]("tools").toOption.get
        assertEquals(functions.map(_.hcursor.downField("function").get[String]("name").toOption.get),definitions.map(_.name))
        assertEquals(functions.map(_.hcursor.downField("function").downField("parameters").focus.get),definitions.map(_.inputSchemaJson))
        Response[IO](Status.Ok).withEntity(finalReply("valid final").noSpaces)
      }}
      val adapter=new OpenAIMcpTestModel(http(Client.fromHttpApp(app)),configured)
      adapter.complete(identity.user.id,adapter.request(initial,definitions),definitions).map { reply =>
        assertEquals(reply.response,Some("valid final"))
        assertEquals(adapter.metadata,McpRunModel("approved-model","pinned-revision",65536,"max"))
      }
    }.unsafeRunSync()
  }

  test("BG-GoodCommunication: actual loopback tool response follows configured HTTP transport") {
    credential.use { file =>
      val app: HttpApp[IO]=cats.data.Kleisli { _ => IO.pure(Response[IO](Status.Ok).withEntity(toolReply(List(("tcp-call","search",Json.obj())),Some("transient reasoning")).noSpaces)) }
      (for {
        server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(app).build
        client <- ModelHttp.client(Fixtures.config())
      } yield (server,client)).use { case (server,client) =>
        val cfg=config.copy(endpoint=s"http://127.0.0.1:${server.address.getPort}/chat",credentialFile=file)
        val adapter=new OpenAIMcpTestModel(http(client),cfg)
        adapter.complete(identity.user.id,adapter.request(initial,definitions),definitions).map { reply =>
          assertEquals(reply.calls.map(_.name),List("search"))
          assertEquals(reply.assistant.hcursor.get[String]("reasoning_content").toOption,Some("transient reasoning"))
          assertEquals(reply.response,None)
          assert(!reply.toString.contains("transient reasoning"))
        }
      }
    }.unsafeRunSync()
  }

  test("BA regression: nine read-only calls fit the existing execution resource bounds") {
    val requiredCalls=9
    val reply=McpToolModelCodec.reply(toolReply((0 until requiredCalls).map(i => (s"source-$i","search",Json.obj())).toList,None),definitions)
    assertEquals(reply.calls.size,requiredCalls)
    assertEquals(reply.response,None)
  }

  test("BG: refusals, truncation, malformed choices, invalid finish/calls/IDs/argument types fail once with no retries") {
    val call=toolReply(List(("id","search",Json.obj())),None)
    val deep=List.fill(40)("{\"nested\":").mkString+"{}"+List.fill(40)("}").mkString
    val invalid=List(
      Json.obj() -> "model-output",
      Json.obj("choices"->Json.arr()) -> "model-output",
      Json.obj("choices"->Json.arr(Json.obj(),Json.obj())) -> "model-output",
      finish(finalReply("x"),"length") -> "model-output/truncated",
      finish(finalReply("x"),"content_filter") -> "model-output",
      field(finalReply("x"),"refusal",Json.fromString("synthetic refusal")) -> "model-output/refusal",
      field(finalReply("x"),"role",Json.fromString("user")) -> "model-output",
      field(finalReply("x"),"content",Json.Null) -> "model-output",
      finalReply(" \n\t") -> "model-output",
      finish(call,"stop") -> "model-output",
      finish(finalReply("x"),"tool_calls") -> "model-output",
      callField(call,"type",Json.fromString("computer")) -> "model-output",
      callField(call,"id",Json.fromString("")) -> "model-output",
      toolReply(List(("id","missing",Json.obj())),None) -> "model-output/unknown-tool",
      toolReply(List(("id","search",Json.obj()),("id","read",Json.obj())),None) -> "model-output",
      args(call,"[]") -> "model-output",
      args(call,"null") -> "model-output",
      args(call,"invalid JSON private content") -> "model-output",
      args(call,deep) -> "model-output",
      args(call,"{\"large\":\""+"x"*McpRunLimits.maximumArgumentBytes+"\"}") -> "model-output",
      field(call,"reasoning_content",Json.fromInt(42)) -> "model-output",
      field(call,"function_call",Json.obj()) -> "model-output",
      toolReply((0 to McpRunLimits.maximumToolCalls).map(i => (s"id$i","search",Json.obj())).toList,None) -> "model-output"
    )
    credential.use { file => invalid.traverse_ { case (reply,expected) =>
      for {
        calls <- Ref.of[IO,Int](0)
        app: HttpApp[IO] = cats.data.Kleisli(_ => calls.update(_+1).as(Response[IO](Status.Ok).withEntity(reply.noSpaces)))
        adapter = new OpenAIMcpTestModel(http(Client.fromHttpApp(app)),config.copy(credentialFile=file))
        result <- adapter.complete(identity.user.id,adapter.request(initial,definitions),definitions).attempt
        count <- calls.get
        _ <- IO { assertEquals(code(result),expected); assertEquals(count,1); assert(!result.left.toOption.get.getMessage.contains("private content")) }
      } yield ()
    }}.unsafeRunSync()
  }

  test("BA: write-capable function never executes without explicit approval; malformed catalogs fail before provider IO") {
    val write=definitions.map(_.copy(readOnly=false))
    assertEquals(intercept[DomainError](McpToolModelCodec.reply(toolReply(List(("id","search",Json.obj())),None),write)).code,"mcp-approval-required")
    val catalogs=List(
      Nil,
      definitions++definitions,
      List(definitions.head.copy(name="invalid.name")),
      List(definitions.head.copy(inputSchemaJson=Json.arr())),
      List(definitions.head.copy(description="x"*McpRunLimits.maximumCatalogBytes)),
      (0 to McpRunLimits.maximumCatalogTools).map(i => definitions.head.copy(name=s"tool$i")).toList
    )
    catalogs.foreach(catalog => assertEquals(intercept[DomainError](McpToolModelCodec.request(config,initial,catalog)).code,"mcp-catalog"))
  }

  test("BG: configured provider response cap and absolute four-MiB ceiling precede JSON interpretation") {
    credential.use { file => List(32,5*1024*1024).traverse_ { configuredLimit =>
      val bound=configuredLimit.min(McpRunLimits.maximumProviderBytes)
      val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.pure(Response[IO](Status.Ok).withEntity(" "*(bound+1))))
      val adapter=new OpenAIMcpTestModel(http(Client.fromHttpApp(app)),config.copy(credentialFile=file,maxResponseBytes=configuredLimit))
      adapter.complete(identity.user.id,adapter.request(initial,definitions),definitions).attempt.map(result => assertEquals(code(result),"model-output"))
    }}.unsafeRunSync()
  }

  test("BA: complete encoded context includes system, catalog, hidden reasoning, assistant/tool messages and JSON escaping") {
    val escaped="\"\\\n"*100000
    val hidden=Json.obj("role"->Json.fromString("assistant"),"content"->Json.Null,"reasoning_content"->Json.fromString(escaped))
    val error=intercept[DomainError](McpToolModelCodec.request(config,initial :+ hidden,definitions))
    assertEquals(error.code,"mcp-context-limit")
    val response=toolReply(List(("id","search",Json.obj())),Some("reasoning"))
    val parsed=McpToolModelCodec.reply(response,definitions)
    val next=McpToolModelCodec.request(config,initial :+ parsed.assistant :+ Json.obj("role"->Json.fromString("tool"),"tool_call_id"->Json.fromString("id"),"content"->Json.fromString("result")),definitions)
    assert(next.noSpaces.contains("reasoning_content"))
    assert(next.noSpaces.contains("synthetic search"))
    assert(next.noSpaces.contains(McpToolModelCodec.system))
    assertEquals(intercept[DomainError](McpRunJson.check(Json.arr(List.fill(McpRunLimits.maximumJsonElements)(Json.Null)*),Int.MaxValue,"limit")).code,"limit")
    assertEquals(intercept[DomainError](McpRunJson.scalar("\ud800","invalid")).code,"invalid")
  }

  test("BG: the actual MCP model adapter records provider usage only for its explicit owner and purpose") {
    credential.use { file =>
      val usage=Json.obj("prompt_tokens"->Json.fromInt(11),"completion_tokens"->Json.fromInt(7),"completion_tokens_details"->Json.obj("reasoning_tokens"->Json.fromInt(3)))
      val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.pure(Response[IO](Status.Ok).withEntity(finalReply("synthetic response").mapObject(_.add("usage",usage)).noSpaces)))
      for {
        store <- ModelTelemetry.make(new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO]),Set(identity.user.id,"other"))
        admission <- ModelAdmission.make(IndexingCapacity.defaults)
        model=new OpenAIMcpTestModel(new ModelHttp(Client.fromHttpApp(app),store,admission),config.copy(credentialFile=file))
        _ <- model.complete(identity.user.id,model.request(initial,definitions),definitions)
        owner <- store.snapshot(identity.user.id)
        other <- store.snapshot("other")
        _ <- IO {
          val sample=owner.samples.find(_.purpose==ModelWorkload.McpTest).get
          assertEquals(sample.finishedCalls,1L); assertEquals(sample.inFlight,0)
          assertEquals(sample.input.knownTokens,11L); assertEquals(sample.output.get.knownTokens,7L)
          assertEquals(sample.reasoningSubset.get.knownTokens,3L)
          assert(owner.samples.filterNot(_.purpose==ModelWorkload.McpTest).forall(_.finishedCalls==0L))
          assert(other.samples.forall(_.finishedCalls==0L))
        }
      } yield ()
    }.unsafeRunSync()
  }

  test("BA: strict-json configured policy is preserved without annotation schema or implicit model substitution") {
    val cfg=config.copy(requestPolicy=AnnotationRequestPolicy.StrictJsonSchema)
    val payload=McpToolModelCodec.request(cfg,initial,definitions)
    assertEquals(payload.hcursor.get[Int]("max_tokens").toOption,Some(2048))
    assert(payload.hcursor.downField("chat_template_kwargs").focus.isEmpty)
    assert(payload.hcursor.downField("response_format").focus.isEmpty)
    assertEquals(payload.hcursor.get[String]("model").toOption,Some(cfg.model))
  }
}
