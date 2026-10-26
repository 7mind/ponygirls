package chronicle

import cats.effect.{Deferred,IO,Outcome,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import org.http4s.{Message as _,*}
import org.http4s.client.Client
import java.nio.charset.StandardCharsets.UTF_8
import scala.concurrent.duration.*
import ProblemPassages.*
import ProblemPassageFixtures.*

class ProblemPassageHttpTest extends ProblemPassageContract {
  private lazy val config = {
    val base=Fixtures.config()
    base.copy(annotation=base.annotation.copy(model="synthetic-configured-model",timeoutSeconds=900,requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning))
  }
  private def inspect(payload: Json): Json = {
    assertEquals(payload.hcursor.get[String]("model").toOption,Some(config.annotation.model))
    assertEquals(payload.hcursor.get[Int]("max_tokens").toOption,Some(65536))
    assertEquals(payload.hcursor.downField("chat_template_kwargs").get[String]("reasoning_effort").toOption,Some("max"))
    assert(payload.noSpaces.getBytes(UTF_8).length<=maximumRequestBytes)
    val format=payload.hcursor.downField("response_format")
    assertEquals(format.get[String]("type").toOption,Some("json_schema"))
    assertEquals(format.downField("json_schema").get[String]("name").toOption,Some("contiguous_problem_passages"))
    assertEquals(format.downField("json_schema").get[Boolean]("strict").toOption,Some(true))
    assertEquals(format.downField("json_schema").downField("schema").get[Boolean]("additionalProperties").toOption,Some(false))
    val messages=payload.hcursor.get[Vector[Json]]("messages").toOption.get
    assertEquals(messages.size,2); assertEquals(messages.head.hcursor.get[String]("content").toOption,Some(systemPrompt))
    val source=Wire.parse(messages(1).hcursor.get[String]("content").toOption.get)
    assertEquals(source.asObject.get.keys.toSet,Set("fragments","previous"))
    val fragments=source.hcursor.get[Vector[Json]]("fragments").toOption.get
    fragments.zipWithIndex.foreach { (fragment,index) =>
      assertEquals(fragment.asObject.get.keys.toSet,Set("index","messageId","messagePosition","role","text","scalarCount","lineStarts"))
      assertEquals(fragment.hcursor.get[Int]("index").toOption,Some(index))
      val text=fragment.hcursor.get[String]("text").toOption.get
      assertEquals(fragment.hcursor.get[Int]("scalarCount").toOption,Some(text.codePointCount(0,text.length)))
    }
    val count=fragments.map(_.hcursor.get[Int]("scalarCount").toOption.get).sum
    assertEquals(format.downField("json_schema").downField("schema").downField("properties").downField("parts").get[Int]("maxItems").toOption,Some(count))
    source.hcursor.downField("previous").focus.filterNot(_.isNull).foreach { previous =>
      assertEquals(previous.asObject.get.keys.toSet,Set("initialSummary","updatedSummary","tags","sourceBytes","omittedPrefixBytes","sourceTail"))
      assert(previous.hcursor.get[Long]("omittedPrefixBytes").toOption.get>=0)
    }
    source
  }
  protected def annotator: Resource[IO,ProblemPassageAnnotator] = {
    val app: HttpApp[IO]=cats.data.Kleisli { request => request.as[String].map { body =>
      assertEquals(request.headers.get(org.typelevel.ci.CIString("Authorization")),None)
      val source=inspect(Wire.parse(body))
      val texts=source.hcursor.get[Vector[Json]]("fragments").toOption.get.map(_.hcursor.get[String]("text").toOption.get)
      val previous=source.hcursor.downField("previous").get[List[String]]("tags").toOption.flatMap(_.headOption)
      Response[IO](Status.Ok).withEntity(envelope(json(plan(texts,previous)).noSpaces,"stop").noSpaces)
    }}
    Resource.pure(new OpenAIProblemPassageAnnotator(ModelFixtures.http(Client.fromHttpApp(app),config),config))
  }
  private def window: Window = Source(List(message("u","A🙂\nα","user",13),message("t"," tool result","tool",3))).next(SourceCursor.start).get
  private def runResponse(response: String,status: Status,inspectRequest: Json => Unit): Either[Throwable,Decision] = {
    val app: HttpApp[IO]=cats.data.Kleisli(request => request.as[String].map { body => inspectRequest(Wire.parse(body)); Response[IO](status).withEntity(response) })
    new OpenAIProblemPassageAnnotator(ModelFixtures.http(Client.fromHttpApp(app),config),config).annotate("a",window,None).attempt.unsafeRunSync()
  }

  test("BG: strict passage schema remains distinct from unchanged legacy AnnotationPartition") {
    val value=window
    val payload=ProblemPassageHttp.request(config.annotation,value,None)
    inspect(payload)
    assertEquals(payload.hcursor.downField("response_format").focus,Some(responseFormat(value)))
    assertNotEquals(payload.hcursor.downField("response_format").focus,Some(AnnotationPartition.responseFormat(2)))
    assertEquals(ModelHttp.transportTimeout(config),900.seconds)
    val point=responseFormat(value).hcursor.downField("json_schema").downField("schema").downField("properties").downField("parts").downField("items").downField("properties").downField("start")
    assertEquals(point.get[Boolean]("additionalProperties").toOption,Some(false))
    assertEquals(point.get[List[String]]("required").toOption,Some(List("fragmentIndex","scalarOffset")))
    assertEquals(point.downField("properties").downField("fragmentIndex").get[Int]("maximum").toOption,Some(value.fragments.size))
  }
  test("BA: complete encoded requests fit even maximum admitted IDs/roles, escaped source, initial+updated metadata and source tail") {
    val maximumInitial="\u0001"*summaryScalars
    val maximumUpdated="\u0002"*summaryScalars
    val tags=(1 to maximumTags).map(i => i.toChar.toString*tagScalars).toList
    List("\u0003"*2048,"\\\""*1024,"\n"*2048,"🙂"*512).foreach { text =>
      val messages=(0 until 96).map(i => message("\u0001"*253+f"$i%03d",text,"\u0002"*64,i)).toList
      val source=Source(messages)
      var state=State.start(sessionId,namespace); var count=0; var texts=Vector.empty[String]
      var pending=source.next(state.nextSource)
      while(pending.nonEmpty) {
        val value=pending.get
        assert(value.fragments.size<=maximumWindowFragments)
        assertEquals(value.encodedSourceBytes,value.sourceJson.noSpaces.getBytes(UTF_8).length)
        assert(value.encodedSourceBytes<=maximumSourceJsonBytes)
        assert(value.encodedSourceContentBytes<=maximumRequestBytes-requestReserveBytes)
        val payload=ProblemPassageHttp.request(config.annotation,value,state.carry)
        assert(payload.noSpaces.getBytes(UTF_8).length<=maximumRequestBytes)
        assert(payload.noSpaces.getBytes(UTF_8).length-value.encodedSourceContentBytes<=requestReserveBytes)
        val roundTrip=Wire.parse(payload.hcursor.get[Vector[Json]]("messages").toOption.get(1).hcursor.get[String]("content").toOption.get)
        assertEquals(roundTrip.hcursor.get[Vector[Json]]("fragments").toOption.get.map(_.hcursor.get[String]("text").toOption.get),value.fragments.map(_.text))
        state.carry.foreach { previous =>
          assertEquals(previous.initialSummary,maximumInitial)
          assertEquals(previous.updatedSummary,if(count==1) maximumInitial else maximumUpdated)
          assertEquals(previous.tags,tags)
          assertEquals(roundTrip.hcursor.downField("previous").get[String]("initialSummary").toOption,Some(maximumInitial))
        }
        val delta=accept(state,value,one(value,state.open.nonEmpty,if(count==0) maximumInitial else maximumUpdated,tags))
        state=delta.state; texts=texts++delta.pieces.map(_.chunk.text); count+=1
        pending=source.next(state.nextSource)
      }
      assert(count>1); assertEquals(texts.mkString,messages.map(_.text).mkString)
      assert(state.carry.get.omittedPrefixBytes>0)
      finish(state,source)
    }
  }
  test("BA: complete request reserve violation fails explicitly rather than trimming metadata/source or reducing model budget") {
    val tooLarge=config.annotation.copy(model="synthetic"*requestReserveBytes)
    assertEquals(intercept[DomainError](ProblemPassageHttp.request(tooLarge,window,None)).code,"config")
  }
  test("BG: exact length finish reason alone is truncation; malformed, refusal, tools and other finishes are not retried by adapter") {
    val value=window
    val valid=json(one(value,false,"summary",Nil)).noSpaces
    def reply(finish: Json,message: Json): Json = Json.obj("choices"->Json.arr(Json.obj("finish_reason"->finish,"message"->message)))
    val cases=List(
      reply(Json.fromString("length"),Json.obj()) -> "model-output/truncated",
      reply(Json.fromString("length"),Json.obj("content"->Json.fromString("malformed"))) -> "model-output/truncated",
      reply(Json.fromString("max_tokens"),Json.obj("content"->Json.fromString(valid))) -> "model-output",
      reply(Json.Null,Json.obj("content"->Json.fromString(valid))) -> "model-output",
      reply(Json.fromString("stop"),Json.obj("content"->Json.Null)) -> "model-output",
      reply(Json.fromString("stop"),Json.obj("content"->Json.fromString(""))) -> "model-output",
      reply(Json.fromString("stop"),Json.obj("content"->Json.fromString("not-json"))) -> "model-output",
      reply(Json.fromString("stop"),Json.obj("content"->Json.fromString(valid),"refusal"->Json.fromString("refused"))) -> "model-output",
      reply(Json.fromString("stop"),Json.obj("content"->Json.fromString(valid),"tool_calls"->Json.arr())) -> "model-output",
      reply(Json.fromString("stop"),Json.obj("content"->Json.fromString(valid),"function_call"->Json.obj())) -> "model-output",
      Json.obj("choices"->Json.arr()) -> "model-output",
      Json.obj("choices"->Json.arr(Json.obj(),Json.obj())) -> "model-output"
    )
    cases.foreach { (response,code) =>
      val requests=new java.util.concurrent.atomic.AtomicInteger()
      val result=runResponse(response.noSpaces,Status.Ok,payload => { inspect(payload); requests.incrementAndGet(); () })
      assertEquals(result.swap.toOption.map(_.asInstanceOf[DomainError].code),Some(code)); assertEquals(requests.get(),1)
    }
  }
  test("BG: adapter rejects invalid partitions rather than returning plausible source rewrites or reopening IDs") {
    val value=window; val part=one(value,false,"summary",Nil).parts.head
    val bad=List(Decision(Vector(part.copy(start=Point(0,1)))),Decision(Vector(part.copy(continuePrevious=true))),
      Decision(Vector(part.copy(end=Point(0,value.fragments.head.scalarCount)))) ,Decision(Vector(part.copy(summary="\u0000"))))
    bad.foreach { decision =>
      val result=runResponse(envelope(json(decision).noSpaces,"stop").noSpaces,Status.Ok,_ => ())
      assertEquals(result.swap.toOption.map(_.asInstanceOf[DomainError].code),Some("model-output"))
    }
  }
  test("BG: HTTP and outer model JSON failures propagate existing classifications without own retries") {
    List((Status.TooManyRequests,"{}","model-http"),(Status.Ok,"not-json","model-output")).foreach { (status,response,code) =>
      val requests=new java.util.concurrent.atomic.AtomicInteger()
      val result=runResponse(response,status,_ => { requests.incrementAndGet(); () })
      assertEquals(result.swap.toOption.map(_.asInstanceOf[DomainError].code),Some(code)); assertEquals(requests.get(),1)
    }
    val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.pure(Response[IO](Status.Ok).withEntity(" "*129)))
    val bounded=config.copy(annotation=config.annotation.copy(maxResponseBytes=128))
    val result=new OpenAIProblemPassageAnnotator(ModelFixtures.http(Client.fromHttpApp(app),config),bounded).annotate("a",window,None).attempt.unsafeRunSync()
    assertEquals(result.swap.toOption.map(_.asInstanceOf[DomainError].code),Some("model-output"))
  }
  test("BG: cancellation propagates through the model boundary without replaying or yielding a partial decision") {
    val checked=for {
      entered <- Deferred[IO,Unit]
      cancelled <- Deferred[IO,Unit]
      calls <- Ref.of[IO,Int](0)
      app: HttpApp[IO]=cats.data.Kleisli(_ => calls.update(_+1) *> entered.complete(()).void *> IO.never[Response[IO]].onCancel(cancelled.complete(()).void))
      service=new OpenAIProblemPassageAnnotator(ModelFixtures.http(Client.fromHttpApp(app),config),config)
      fiber <- service.annotate("a",window,None).start
      _ <- entered.get.timeout(2.seconds)
      _ <- fiber.cancel
      _ <- cancelled.get.timeout(2.seconds)
      result <- fiber.join
      count <- calls.get
    } yield { assert(result.isInstanceOf[Outcome.Canceled[IO,Throwable,Decision]]); assertEquals(count,1) }
    checked.unsafeRunSync()
  }
  test("BG: configured whole-call deadline cancels in-process provider and returns model-timeout without retries") {
    val checked=for {
      cancelled <- Deferred[IO,Unit]
      calls <- Ref.of[IO,Int](0)
      app: HttpApp[IO]=cats.data.Kleisli(_ => calls.update(_+1) *> IO.never[Response[IO]].onCancel(cancelled.complete(()).void))
      short=config.copy(annotation=config.annotation.copy(timeoutSeconds=1))
      result <- new OpenAIProblemPassageAnnotator(ModelFixtures.http(Client.fromHttpApp(app),config),short).annotate("a",window,None).attempt
      _ <- cancelled.get.timeout(2.seconds)
      count <- calls.get
    } yield { assertEquals(result.swap.toOption.map(_.asInstanceOf[DomainError].code),Some("model-timeout")); assertEquals(count,1) }
    checked.unsafeRunSync()
  }
}
