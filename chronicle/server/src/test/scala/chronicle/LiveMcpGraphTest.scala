package chronicle

import cats.effect.{Deferred,IO,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import chronicle.api.*
import distage.{Identity as _,*}
import io.circe.Json
import java.util.UUID
import org.http4s.{Http as _,Message as _,*}
import org.http4s.client.Client
import scala.concurrent.duration.*

final class LiveMcpGraph(val database: Database,val auth: Auth,val archive: PostgresArchive,val runs: McpTestRuns,val rpc: BrowserRpc,val wire: McpTestWire,val encoding: McpRunPageEncoding,val usage: ModelUsageView,val mcp: Mcp,val tools: McpRunTools)

final class LiveMcpGraphTest extends munit.FunSuite {
  test("Blackbox-GoodCommunication: production MCP graph shares actual tools, fresh source reads, full wire sizing and completed-call usage") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped")
    }
    val base=Fixtures.config()
    val config=base.copy(annotation=base.annotation.copy(requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning,timeoutSeconds=900))
    (for {
      requests <- Ref.of[IO,Int](0)
      provider: HttpApp[IO]=cats.data.Kleisli(request => request.as[String].flatMap { body =>
        val json=Wire.parse(body)
        IO {
          assertEquals(json.hcursor.get[Int]("max_tokens").toOption,Some(65536))
          assertEquals(json.hcursor.downField("chat_template_kwargs").get[String]("reasoning_effort").toOption,Some("max"))
          val messages=json.hcursor.get[Vector[Json]]("messages").toOption.get
          val results=messages.filter(_.hcursor.get[String]("role").toOption.contains("tool"))
          val reply=results.size match {
            case 0 => McpTestFixtures.toolReply(List(("search","search_sessions",Json.obj("query"->Json.fromString("synthetic"),"mode"->Json.fromString("lexical"),"limit"->Json.fromInt(1)))),Some("synthetic hidden reasoning"))
            case 1 =>
              val search=toolValue(results.head).asInstanceOf[Result.Search].result
              assertEquals(search.hits.size,1)
              McpTestFixtures.toolReply(List(("read","get_messages",Json.obj("sessionId"->Json.fromString(search.hits.head.session.id.toString),"limit"->Json.fromInt(1)))),None)
            case 2 =>
              val messages=toolValue(results.last).asInstanceOf[Result.Messages].result
              assertEquals(messages.messages.head.text,"synthetic PostgreSQL archive")
              McpTestFixtures.finalReply("synthetic completed response")
            case _ => throw new AssertionError("unexpected extra model round")
          }
          val usage=Json.obj("prompt_tokens"->Json.fromInt(11),"completion_tokens"->Json.fromInt(7),"completion_tokens_details"->Json.obj("reasoning_tokens"->Json.fromInt(3)))
          reply.mapObject(_.add("usage",usage))
        }.flatTap(_ => requests.update(_+1)).map(reply => Response[IO](Status.Ok).withEntity(reply.noSpaces))
      })
      production: Module=_root_.chronicle.plugins.ChroniclePlugin
      module=production.overriddenBy(new ModuleDef {
        make[Config].fromValue(config)
        make[Client[IO]].fromValue(Client.fromHttpApp(provider))
        make[LiveMcpGraph]
      })
      _ <- ChronicleInjector().produceGet[LiveMcpGraph](module).use { graph =>
        for {
          _ <- IO {
            assert(graph.wire eq graph.encoding)
            assertEquals(graph.tools.definitions,graph.mcp.definitions)
            assert(graph.tools.definitions.forall(_.readOnly))
          }
          owner <- IO.blocking {
            graph.database.initialize()
            graph.database.transaction { c =>
              Sql.exec(c,"TRUNCATE ch_sources,ch_sessions,ch_groups,ch_tokens,ch_mutations,ch_collector_progress CASCADE")
              Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
            }
            val source=Fixtures.snapshot()
            val receipt=graph.archive.ingest("a",source)
            val claim=graph.archive.claim(graph.archive.knownProfiles,ClaimScope.Owner("a"),300).get
            val chunks=Fragments.split(source.messages).map(_.copy(sessionId=receipt.sessionId))
            assert(graph.archive.publish(claim,chunks.map(chunk => IndexedChunk(chunk,List(1.0,0.0,0.0)))))
            graph.auth.browser(graph.auth.login(LoginRequest("a","synthetic"))._2)
          }
          _ <- graph.rpc.connection(UUID.randomUUID()).use { connection =>
            for {
              catalog <- graph.runs.catalog(owner)
              run <- IO(UUID.randomUUID())
              reply <- graph.rpc.execute(owner,ClientEnvelope(UUID.randomUUID(),Operation.StartMcpTest(catalog.instanceId,run,"Find the synthetic archive and read its first message.")),"1.4.0",connection)
              _ <- IO(assert(reply.isInstanceOf[BrowserReply.McpRead]))
              snapshot <- McpTestFixtures.await(observe(graph.runs,owner,catalog.instanceId,run))(value => !value.state.active).timeout(10.seconds)
              _ <- IO {
                assertEquals(snapshot.state,McpRunState.Complete)
                val names=snapshot.events.collect { case McpRunEvent(_,_,McpRunItem.ToolCall(_,name,_,_,_)) => name }
                assertEquals(names,List("search_sessions","get_messages"))
                assert(!snapshot.events.toString.contains("synthetic hidden reasoning"))
              }
              frame <- graph.rpc.materialize(BrowserReply.McpRead(McpReadHandle(UUID.randomUUID(),catalog.instanceId,run,0L,256)),IO.pure(owner),"1.4.0",new VersionedWire(new chronicle.protocol.ProtocolConversions))
              usage <- graph.usage.read(owner)
              count <- requests.get
              _ <- IO {
                assert(JsonUtf8Size(frame)<=McpRunLimits.pageBytes)
                assert(!frame.noSpaces.contains("synthetic hidden reasoning"))
                assertEquals(count,3)
                val sample=usage.samples.find(_.purpose==ModelPurpose.McpTest).get
                assertEquals(sample.finishedCalls,3L); assertEquals(sample.inFlight,0)
                assertEquals(sample.input.knownTokens,33L); assertEquals(sample.output.get.knownTokens,21L)
                assertEquals(sample.reasoningSubset.get.knownTokens,9L)
                assert(usage.samples.filterNot(_.purpose==ModelPurpose.McpTest).forall(_.finishedCalls==0L))
              }
            } yield ()
          }
        } yield ()
      }
    } yield ()).unsafeRunSync()
  }
  test("Effectual-GoodCommunication: releasing the production graph cancels an active model request before the socket lease is released") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped")
    }
    val config=Fixtures.config()
    (for {
      entered <- Deferred[IO,Unit]
      cancelled <- Deferred[IO,Unit]
      telemetry <- ModelTelemetry.make(new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO]),config.users.map(_.id).toSet)
      provider: HttpApp[IO]=cats.data.Kleisli(_ => entered.complete(()).void *> IO.never[Response[IO]].onCancel(cancelled.complete(()).void))
      production: Module=_root_.chronicle.plugins.ChroniclePlugin
      module=production.overriddenBy(new ModuleDef {
        make[Config].fromValue(config)
        make[Client[IO]].fromValue(Client.fromHttpApp(provider))
        make[ModelTelemetry].fromValue(telemetry)
        make[LiveMcpGraph]
      })
      _ <- Resource.make(Ref.of[IO,IO[Unit]](IO.unit))(_.get.flatten).use { socketCleanup =>
        ChronicleInjector().produceGet[LiveMcpGraph](module).use { graph =>
          for {
            owner <- IO.blocking { graph.database.initialize(); graph.auth.browser(graph.auth.login(LoginRequest("a","synthetic"))._2) }
            lease <- IO.uncancelable(_ => graph.rpc.connection(UUID.randomUUID()).allocated.flatTap(pair => socketCleanup.set(pair._2))).map(_._1)
            catalog <- graph.runs.catalog(owner)
            _ <- graph.runs.start(owner,lease,catalog.instanceId,UUID.randomUUID(),"Synthetic active resource release")
            _ <- entered.get.timeout(3.seconds)
            before <- telemetry.snapshot(owner.user.id)
            _ <- IO(assertEquals(before.samples.find(_.purpose==ModelWorkload.McpTest).get.inFlight,1))
          } yield ()
        } *> cancelled.get.timeout(3.seconds) *> McpTestFixtures.await(telemetry.snapshot("a"))(_.samples.find(_.purpose==ModelWorkload.McpTest).get.inFlight==0).timeout(3.seconds).flatMap { after => IO {
          val sample=after.samples.find(_.purpose==ModelWorkload.McpTest).get
          assertEquals(sample.finishedCalls,1L); assertEquals(sample.cancelledCalls,1L)
          assertEquals(sample.input.unknownCalls,1L)
        }}
      }
    } yield ()).unsafeRunSync()
  }

  private def toolValue(message: Json): Result = {
    val content=Wire.parse(message.hcursor.get[String]("content").toOption.get)
    assertEquals(content.hcursor.get[Boolean]("isError").toOption,Some(false))
    Wire.decode(Result.codecJson,Wire.parse(content.hcursor.downField("content").downN(0).get[String]("text").toOption.get))
  }
  private def observe(runs: McpTestRuns,owner: Identity,instance: UUID,run: UUID): IO[McpRunSnapshot] =
    runs.read(owner,instance,run,0L,256).handleErrorWith {
      case error: DomainError if error.code=="mcp-run-changed" => IO.sleep(2.millis) *> observe(runs,owner,instance,run)
      case error => IO.raiseError(error)
    }
}
