package chronicle

import chronicle.api.*
import cats.effect.{Deferred,IO,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import org.http4s.{Message as _,*}
import org.http4s.client.Client
import org.http4s.ember.server.EmberServerBuilder
import com.comcast.ip4s.*
import io.circe.Json
import scala.concurrent.duration.*

abstract class ModelAccountingContract extends munit.FunSuite {
  protected def connection(app: HttpApp[IO],config: Config): Resource[IO,(Client[IO],String)]
  private def configured: Config = {
    val base=Fixtures.config()
    base.copy(annotation=base.annotation.copy(timeoutSeconds=900,requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning),indexing=IndexingCapacity(2,1,2))
  }
  private def telemetry(config: Config): IO[ModelTelemetry] = ModelTelemetry.make(new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO]),config.users.map(_.id).toSet)
  private def row(value: ModelUsageSnapshot,purpose: ModelWorkload): ModelWorkloadUsage = value.samples.find(_.purpose==purpose).get
  private val usage=Json.obj("prompt_tokens"->Json.fromInt(11),"completion_tokens"->Json.fromInt(7),"completion_tokens_details"->Json.obj("reasoning_tokens"->Json.fromInt(3)))
  private def reply(finish: String,content: String): Json = Json.obj("usage"->usage,"choices"->Json.arr(Json.obj("finish_reason"->Json.fromString(finish),"message"->Json.obj("content"->Json.fromString(content)))))
  private def post(http: ModelHttp,config: Config,url: String,context: ModelCallContext): IO[Json] = http.post(context,url,config.annotation.credentialFile,1,65536,Json.obj())

  test("BG/GoodCommunication: actual annotation HTTP usage survives truncation and downstream schema failures without changing model policy") {
    val config=configured
    val valid="""{"chunks":[{"first":0,"last":0,"summary":"synthetic","tags":[]}]}"""
    val responses=List(reply("length",""),reply("stop","{}"),reply("stop",valid).mapObject(_.remove("usage")),reply("stop",valid).mapObject(_.add("usage",usage.mapObject(_.add("prompt_tokens",Json.fromString("bad"))))))
    (for {
      index <- Ref.of[IO,Int](0)
      app: HttpApp[IO]=cats.data.Kleisli(request => request.as[String].flatMap { body =>
        val payload=Wire.parse(body)
        IO {
          assertEquals(payload.hcursor.get[Int]("max_tokens").toOption,Some(65536))
          assertEquals(payload.hcursor.downField("chat_template_kwargs").get[String]("reasoning_effort").toOption,Some("max"))
        } *> index.getAndUpdate(_+1).map(i => Response[IO](Status.Ok).withEntity(responses(i).noSpaces))
      })
      store <- telemetry(config)
      admission <- ModelAdmission.make(config.indexing)
      _ <- connection(app,config).use { (client,url) =>
        val service=new OpenAIAnnotator(new ModelHttp(client,store,admission),config.copy(annotation=config.annotation.copy(endpoint=url)))
        val messages=List(Message("u",None,"user","synthetic",None,0))
        for {
          results <- responses.traverse(_ => service.annotate("a",Fragments.split(messages),messages).attempt)
          snapshot <- store.snapshot("a")
          _ <- IO {
            assertEquals(results.take(2).map(_.swap.toOption.get.asInstanceOf[DomainError].code),List("model-output/truncated","model-output"))
            assert(results.drop(2).forall(_.isRight))
            val value=row(snapshot,ModelWorkload.IndexAnnotation)
            assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,4L); assertEquals(value.failedCalls,0L); assertEquals(value.invalidUsageCalls,1L)
            assertEquals(value.input.knownTokens,22L); assertEquals(value.input.reportedCalls,2L); assertEquals(value.input.unknownCalls,2L); assertEquals(value.input.tokensPerSecond,None)
            assertEquals(value.output.get.knownTokens,21L); assertEquals(value.output.get.unknownCalls,1L); assertEquals(value.reasoningSubset.get.knownTokens,9L)
          }
        } yield ()
      }
    } yield ()).unsafeRunSync()
  }
  test("BG/GoodCommunication: embedding adapters thread exact owners and index/query purposes with inapplicable output") {
    val config=configured
    val app: HttpApp[IO]=cats.data.Kleisli(request => request.as[String].map { body =>
      val size=Wire.parse(body).hcursor.get[List[String]]("input").toOption.get.size
      val json=Json.obj("usage"->Json.obj("prompt_tokens"->Json.fromInt(13)),"data"->Json.arr((0 until size).map(i => Json.obj("index"->Json.fromInt(i),"embedding"->Json.arr(Json.fromInt(1),Json.fromInt(0),Json.fromInt(0))))*))
      Response[IO](Status.Ok).withEntity(json.noSpaces)
    })
    (for {
      store <- telemetry(config)
      admission <- ModelAdmission.make(config.indexing)
      _ <- connection(app,config).use { (client,url) =>
        val service=new OpenAIEmbedder(new ModelHttp(client,store,admission),config.copy(embedding=config.embedding.copy(endpoint=url)))
        for {
          _ <- service.documents("a",List("one","two"))
          _ <- service.query("b","query")
          a <- store.snapshot("a")
          b <- store.snapshot("b")
          _ <- IO {
            assertEquals(row(a,ModelWorkload.IndexEmbedding).input.knownTokens,13L); assertEquals(row(b,ModelWorkload.QueryEmbedding).input.knownTokens,13L)
            assertEquals(row(a,ModelWorkload.QueryEmbedding).finishedCalls,0L); assertEquals(row(b,ModelWorkload.IndexEmbedding).finishedCalls,0L)
            assertEquals(row(a,ModelWorkload.IndexEmbedding).output,None); assertEquals(row(b,ModelWorkload.QueryEmbedding).reasoningSubset,None)
          }
        } yield ()
      }
    } yield ()).unsafeRunSync()
  }
  test("BG/GoodCommunication: shared gates bound index/query embedding requests and annotation/MCP-shaped HTTP calls") {
    val config=configured
    final case class Counts(annotation: Int,embedding: Int,maximumAnnotation: Int,maximumEmbedding: Int);
    (for {
      counts <- Ref.of[IO,Counts](Counts(0,0,0,0))
      app: HttpApp[IO]=cats.data.Kleisli(request => request.as[String].flatMap { body =>
        val embedding=Wire.parse(body).hcursor.get[Boolean]("embedding").toOption.get
        val enter=counts.update { value =>
          if(embedding) value.copy(embedding=value.embedding+1,maximumEmbedding=value.maximumEmbedding.max(value.embedding+1))
          else value.copy(annotation=value.annotation+1,maximumAnnotation=value.maximumAnnotation.max(value.annotation+1))
        }
        val leave=counts.update(value => if(embedding) value.copy(embedding=value.embedding-1) else value.copy(annotation=value.annotation-1))
        (enter *> IO.sleep(30.millis) *> IO.pure(Response[IO](Status.Ok).withEntity("{}"))).guarantee(leave)
      })
      store <- telemetry(config)
      admission <- ModelAdmission.make(config.indexing)
      _ <- connection(app,config).use { (client,url) =>
        val http=new ModelHttp(client,store,admission)
        List.fill(6)(ModelWorkload.values.toList).flatten.parTraverse_ { purpose =>
          http.post(ModelCallContext("a",purpose),url,config.annotation.credentialFile,3,65536,Json.obj("embedding"->Json.fromBoolean(!purpose.hasOutput))).void
        }
      }
      finalCounts <- counts.get
      snapshot <- store.snapshot("a")
      _ <- IO {
        assertEquals(finalCounts,Counts(0,0,2,1))
        snapshot.samples.foreach(value => { assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,6L); assertEquals(value.input.unknownCalls,6L) })
      }
    } yield ()).unsafeRunSync()
  }
  test("BG/GoodCommunication: cancellation while waiting for admission creates no ticket and leaks no permit") {
    val config=configured.copy(indexing=IndexingCapacity(1,1,1))
    (for {
      entered <- Deferred[IO,Unit]
      release <- Deferred[IO,Unit]
      calls <- Ref.of[IO,Int](0)
      app: HttpApp[IO]=cats.data.Kleisli(_ => calls.getAndUpdate(_+1).flatMap { i =>
        (if(i==0) entered.complete(()).void *> release.get else IO.unit).as(Response[IO](Status.Ok).withEntity("{}"))
      })
      store <- telemetry(config)
      admission <- ModelAdmission.make(config.indexing)
      _ <- connection(app,config).use { (client,url) =>
        val http=new ModelHttp(client,store,admission)
        val context=ModelCallContext("a",ModelWorkload.McpTest)
        for {
          first <- post(http,config,url,context).start
          _ <- entered.get.timeout(2.seconds)
          waiting <- post(http,config,url,context).start
          _ <- IO.sleep(30.millis)
          before <- store.snapshot("a")
          _ <- waiting.cancel
          _ <- release.complete(())
          _ <- first.joinWithNever
          _ <- post(http,config,url,context)
          after <- store.snapshot("a")
          count <- calls.get
          _ <- IO {
            assertEquals(row(before,context.purpose).inFlight,1); assertEquals(row(before,context.purpose).finishedCalls,0L)
            assertEquals(row(after,context.purpose).inFlight,0); assertEquals(row(after,context.purpose).finishedCalls,2L); assertEquals(count,2)
          }
        } yield ()
      }
    } yield ()).unsafeRunSync()
  }
  test("BG/GoodCommunication: cancellation and whole-request deadlines release actual HTTP attempts with unknown usage") {
    val config=configured
    List(false,true).traverse_ { cancel =>
      for {
        entered <- Deferred[IO,Unit]
        release <- Deferred[IO,Unit]
        calls <- Ref.of[IO,Int](0)
        app: HttpApp[IO]=cats.data.Kleisli(_ => calls.getAndUpdate(_+1).flatMap { index =>
          (if(index==0) entered.complete(()).void *> release.get else IO.unit).as(Response[IO](Status.Ok).withEntity("{}"))
        })
        store <- telemetry(config)
        admission <- ModelAdmission.make(config.indexing)
        _ <- connection(app,config).use { (client,url) =>
          val http=new ModelHttp(client,store,admission)
          val context=ModelCallContext("a",ModelWorkload.McpTest)
          for {
            fiber <- post(http,config,url,context).attempt.start
            _ <- entered.get.timeout(2.seconds)
            _ <- if(cancel) fiber.cancel else fiber.joinWithNever.flatMap(value => IO(assertEquals(value.swap.toOption.get.asInstanceOf[DomainError].code,"model-timeout")))
            _ <- release.complete(())
            _ <- post(http,config,url,context)
            snapshot <- store.snapshot("a")
            _ <- IO {
              val value=row(snapshot,context.purpose)
              assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,2L); assertEquals(value.input.unknownCalls,2L)
              assertEquals(value.cancelledCalls,if(cancel) 1L else 0L); assertEquals(value.failedCalls,if(cancel) 0L else 1L)
            }
          } yield ()
        }
      } yield ()
    }.unsafeRunSync()
  }
  test("BG/GoodCommunication: transport errors, invalid JSON and body bounds finish as unknown failures") {
    val config=configured
    List((Status.TooManyRequests,"{}",65536),(Status.Ok,"not-json",65536),(Status.Ok,"x"*100,10)).foreach { (status,body,bound) =>
      val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.pure(Response[IO](status).withEntity(body)))
      (for {
        store <- telemetry(config)
        admission <- ModelAdmission.make(config.indexing)
        _ <- connection(app,config).use { (client,url) =>
          new ModelHttp(client,store,admission).post(ModelCallContext("a",ModelWorkload.McpTest),url,config.annotation.credentialFile,1,bound,Json.obj()).attempt.flatMap { result =>
            store.snapshot("a").map { snapshot =>
              assert(result.isLeft); val value=row(snapshot,ModelWorkload.McpTest)
              assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,1L); assertEquals(value.failedCalls,1L); assertEquals(value.input.unknownCalls,1L)
            }
          }
        }
      } yield ()).unsafeRunSync()
    }
  }
}
class InProcessModelAccountingTest extends ModelAccountingContract {
  protected def connection(app: HttpApp[IO],config: Config): Resource[IO,(Client[IO],String)] = Resource.pure((Client.fromHttpApp(app),"http://127.0.0.1/model"))
  test("BG: cancellation during ticket acquisition installs its terminal finalizer before releasing admission") {
    val config=Fixtures.config().copy(indexing=IndexingCapacity(1,1,1))
    (for {
      real <- ModelTelemetry.make(new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO]),Set("a"))
      acquired <- Deferred[IO,Unit]
      release <- Deferred[IO,Unit]
      calls <- Ref.of[IO,Int](0)
      wrapped=new ModelTelemetry {
        def begin(context: ModelCallContext): IO[ModelCallTicket] = real.begin(context).flatTap(_ => acquired.complete(()).void *> release.get)
        def finish(ticket: ModelCallTicket,outcome: ModelCallOutcome,usage: ProviderUsage): IO[Unit] = real.finish(ticket,outcome,usage)
        def snapshot(owner: String): IO[ModelUsageSnapshot] = real.snapshot(owner)
      }
      admission <- ModelAdmission.make(config.indexing)
      app: HttpApp[IO]=cats.data.Kleisli(_ => calls.update(_+1).as(Response[IO](Status.Ok).withEntity("{}")))
      http=new ModelHttp(Client.fromHttpApp(app),wrapped,admission)
      request=http.post(ModelCallContext("a",ModelWorkload.McpTest),config.annotation.endpoint,config.annotation.credentialFile,1,65536,Json.obj())
      fiber <- request.start
      _ <- acquired.get
      cancelling <- fiber.cancel.start
      _ <- release.complete(())
      _ <- cancelling.joinWithNever
      snapshot <- real.snapshot("a")
      count <- calls.get
      _ <- IO {
        val value=snapshot.samples.find(_.purpose==ModelWorkload.McpTest).get
        assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,1L); assertEquals(value.cancelledCalls,1L); assertEquals(count,0)
      }
      _ <- admission.request(ModelWorkload.McpTest).use(_ => IO.unit).timeout(1.second)
    } yield ()).unsafeRunSync()
  }
  test("BG: cancellation after usage capture retains known counters and releases ticket and permit exactly once") {
    val config=Fixtures.config().copy(indexing=IndexingCapacity(1,1,1))
    (for {
      releasing <- Deferred[IO,Unit]
      release <- Deferred[IO,Unit]
      store <- ModelTelemetry.make(new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO]),Set("a"))
      admission <- ModelAdmission.make(config.indexing)
      response=Response[IO](Status.Ok).withEntity("""{"usage":{"prompt_tokens":9,"completion_tokens":4}}""")
      client=Client[IO](_ => Resource.make(IO.pure(response))(_ => releasing.complete(()).void *> release.get))
      http=new ModelHttp(client,store,admission)
      fiber <- http.post(ModelCallContext("a",ModelWorkload.McpTest),config.annotation.endpoint,config.annotation.credentialFile,1,65536,Json.obj()).start
      _ <- releasing.get
      cancelling <- fiber.cancel.start
      _ <- release.complete(())
      _ <- cancelling.joinWithNever
      snapshot <- store.snapshot("a")
      _ <- IO {
        val value=snapshot.samples.find(_.purpose==ModelWorkload.McpTest).get
        assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,1L); assertEquals(value.cancelledCalls,1L); assertEquals(value.input.knownTokens,9L); assertEquals(value.output.get.knownTokens,4L)
      }
      _ <- admission.request(ModelWorkload.McpTest).use(_ => IO.unit).timeout(1.second)
    } yield ()).unsafeRunSync()
  }
}
class LoopbackModelAccountingTest extends ModelAccountingContract {
  protected def connection(app: HttpApp[IO],config: Config): Resource[IO,(Client[IO],String)] = for {
    server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(app).build
    client <- ModelHttp.client(config)
  } yield (client,s"http://127.0.0.1:${server.address.getPort}/model")
}
