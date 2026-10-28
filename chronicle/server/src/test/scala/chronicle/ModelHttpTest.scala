package chronicle
import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import org.http4s.{Message as _,*}
import org.http4s.ember.server.EmberServerBuilder
import com.comcast.ip4s.*
import io.circe.Json
import scala.concurrent.duration.*
class ModelHttpTest extends munit.FunSuite {
  def simulator(status: Status,response: String,test: (ModelHttp,String) => IO[Unit]): Unit = {
    val app: HttpApp[IO] = cats.data.Kleisli { request =>
      IO { assertEquals(request.headers.get(org.typelevel.ci.CIString("Authorization")),None); Response[IO](status).withEntity(response) }
    }
    (for {
      server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(app).build
      client <- ModelHttp.client(Fixtures.config())
    } yield (server,client)).use { case (server,client) => test(ModelFixtures.http(client,Fixtures.config()),s"http://127.0.0.1:${server.address.getPort}/v1/operation") }.unsafeRunSync()
  }
  test("BG-GoodCommunication: model annotations classify the complete original source window") {
    val reply="""{"choices":[{"finish_reason":"stop","message":{"content":"{\"parts\":[{\"kind\":\"Problem\",\"start\":{\"fragmentIndex\":0,\"scalarOffset\":0},\"end\":{\"fragmentIndex\":2,\"scalarOffset\":0},\"continuePrevious\":false,\"summary\":\"both\",\"tags\":[\"synthetic\"]}]}"}}]}"""
    simulator(Status.Ok,reply,(http,url) => {
      val c=Fixtures.config(); val messages=List(Message("u",None,"user","first",None,0),Message("a",Some("u"),"assistant","second",None,1))
      val window=ProblemPassages.Source(messages).next(ProblemPassages.SourceCursor.start).get
      new OpenAIProblemPassageAnnotator(http,c.copy(annotation=c.annotation.copy(endpoint=url))).annotate("a",window,None).map { decision =>
        val delta=ProblemPassages.accept(ProblemPassages.State.start(java.util.UUID.randomUUID(),java.util.UUID.randomUUID()),window,decision)
        assertEquals(delta.pieces.map(_.chunk.text),Vector("first","second"))
      }
    })
  }
  test("BG-GoodCommunication regression: annotation envelope exposes fragment indices without competing byte offsets") {
    val messages=List(Message("u",None,"user","first🙂",None,0),Message("a",Some("u"),"assistant","secondé",None,1))
    val window=ProblemPassages.Source(messages).next(ProblemPassages.SourceCursor.start).get
    val reply="""{"choices":[{"finish_reason":"stop","message":{"content":"{\"parts\":[{\"kind\":\"Problem\",\"start\":{\"fragmentIndex\":0,\"scalarOffset\":0},\"end\":{\"fragmentIndex\":2,\"scalarOffset\":0},\"continuePrevious\":false,\"summary\":\"both\",\"tags\":[\"synthetic\"]}]}"}}]}"""
    val endpoint: HttpApp[IO]=cats.data.Kleisli { request => request.as[String].map { body =>
      val payload=Wire.parse(body).hcursor.get[List[Json]]("messages").toOption.get
      val source=Wire.parse(payload(1).hcursor.get[String]("content").toOption.get).hcursor.get[List[Json]]("fragments").toOption.get
      assertEquals(source.map(_.asObject.get.keys.toSet),List.fill(2)(Set("index","role","text","messageId","messagePosition","scalarCount","lineStarts")))
      assertEquals(source.map(_.hcursor.get[Int]("index").toOption.get),List(0,1))
      Response[IO](Status.Ok).withEntity(reply)
    }}
    val http=ModelFixtures.http(org.http4s.client.Client.fromHttpApp(endpoint),Fixtures.config())
    new OpenAIProblemPassageAnnotator(http,Fixtures.config()).annotate("a",window,None).map { decision =>
      val delta=ProblemPassages.accept(ProblemPassages.State.start(java.util.UUID.randomUUID(),java.util.UUID.randomUUID()),window,decision)
      assertEquals(delta.pieces.map(_.chunk.text),Vector("first🙂","secondé"))
      assertEquals(delta.pieces.map(_.sourceSpan.messagePosition),Vector(0,1))
    }.unsafeRunSync()
  }
  test("BG-GoodCommunication: OpenAI embeddings require count indices dimensions finite nonzero") {
    val replies=List(
      """{"data":[{"index":0,"embedding":[1,0,0]}]}""" -> true,
      """{"data":[]}""" -> false,
      """{"data":[{"index":1,"embedding":[1,0,0]}]}""" -> false,
      """{"data":[{"index":0,"embedding":[1,0]}]}""" -> false,
      """{"data":[{"index":0,"embedding":[0,0,0]}]}""" -> false,
      """{"data":[{"index":0,"embedding":[null,0,0]}]}""" -> false
    )
    replies.foreach { case (response,valid) => simulator(Status.Ok,response,(http,url) => {
      val c=Fixtures.config(); new OpenAIEmbedder(http,c.copy(embedding=c.embedding.copy(endpoint=url))).query("a","synthetic").attempt.map(r => assertEquals(r.isRight,valid))
    }) }
  }
  test("Blackbox-GoodCommunication regression: fixed-dimension endpoints reject truncation parameters; dimensional request is explicit opt-in") {
    List(false,true).foreach { sendDimensions =>
      val requests=new java.util.concurrent.atomic.AtomicInteger()
      val endpoint: HttpApp[IO]=cats.data.Kleisli { request => request.as[String].map { body =>
        requests.incrementAndGet()
        val payload=Wire.parse(body)
        val dimensions=payload.hcursor.get[Int]("dimensions").toOption
        val correct=if(sendDimensions) dimensions.contains(3) else payload.hcursor.downField("dimensions").focus.isEmpty
        Response[IO](if(correct) Status.Ok else Status.BadRequest).withEntity(if(correct) """{"data":[{"index":0,"embedding":[1,0,0]}]}""" else """{"error":"unsupported dimensions parameter"}""")
      }}
      (for {
        server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(endpoint).build
        client <- ModelHttp.client(Fixtures.config())
      } yield (server,client)).use { case (server,client) =>
        val original=Fixtures.config(); val config=original.copy(embedding=original.embedding.copy(endpoint=s"http://127.0.0.1:${server.address.getPort}/embedding",sendDimensions=sendDimensions))
        new OpenAIEmbedder(ModelFixtures.http(client,Fixtures.config()),config).query("a","synthetic fixed-dimension request").map { values => assertEquals(values,List(1.0,0.0,0.0)); assertEquals(requests.get(),1) }
      }.unsafeRunSync()
    }
  }
  test("Blackbox-Atomic: embedding sendDimensions defaults only at the public config boundary and changes profile identity") {
    val config=Fixtures.config()
    val json=Wire.parse("""{"endpoint":"http://127.0.0.1:1","model":"fixed","revision":"v1","credentialFile":"unused","timeoutSeconds":1,"maxResponseBytes":1024,"dimensions":3,"queryPrefix":"","documentPrefix":""}""")
    import Config.given
    assertEquals(json.as[EmbeddingConfig].toOption.get.sendDimensions,false)
    assert(json.mapObject(_.add("sendDimensions",Json.fromString("invalid"))).as[EmbeddingConfig].isLeft)
    assert(json.mapObject(_.add("sendDimensions",Json.Null)).as[EmbeddingConfig].isLeft)
    assertNotEquals(config.profile,config.copy(embedding=config.embedding.copy(sendDimensions=true)).profile)
  }
  test("BG-GoodCommunication: HTTP429 malformed JSON and bounded response fail observably") {
    List((Status.TooManyRequests,"{}",65536),(Status.Ok,"not-json",65536),(Status.Ok," "*100,10)).foreach { case (status,response,bound) => simulator(status,response,(http,url) => {
      val c=Fixtures.config(); http.post(ModelCallContext("a",ModelWorkload.IndexAnnotation),url,c.annotation.credentialFile,1,bound,Json.obj()).attempt.map(r => assert(r.isLeft))
    }) }
  }
}
