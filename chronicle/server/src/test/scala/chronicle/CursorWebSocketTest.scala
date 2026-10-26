package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import com.comcast.ip4s.*
import distage.*
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.implicits.*
import java.net.URI
import java.net.http.{HttpClient,WebSocket}
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import java.util.concurrent.{CompletableFuture,CompletionStage,LinkedBlockingQueue,TimeUnit}
import scala.concurrent.duration.*

final class CursorWebSocketTest extends munit.FunSuite {
  override val munitTimeout=45.seconds
  test("BG GoodCommunication regression: long-title Archive and Activity continuations pass the unchanged real WebSocket frame guard") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh")
    }
    val config=Fixtures.config()
    EmberClientBuilder.default[IO].build.use { client =>
      val module=new ModuleDef {
        include(_root_.chronicle.plugins.ChroniclePlugin)
        make[Config].fromValue(config)
        make[org.http4s.client.Client[IO]].fromValue(client)
      }
      ChronicleInjector().produceGet[RuntimeServices](module).use { services =>
        IO.blocking {
          services.database.initialize()
          services.database.transaction { c =>
            Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations,ch_collector_progress CASCADE")
            Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
          }
          (1 to 2).foreach { n =>
            val request=Fixtures.snapshot()
            services.archive.ingest("a",request.copy(metadata=request.metadata.copy(title="x"*50000+n)))
          }
        } *> Semaphore[IO](2).flatMap { gate =>
          EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get)
            .withHttpWebSocketApp(ws => services.http.routes(ws,gate).orNotFound).build.use { server => IO.blocking {
              val (_,secret)=new Auth(services.database,config).login(LoginRequest("a","synthetic"))
              val client=HttpClient.newHttpClient()
              val inbox=new LinkedBlockingQueue[ServerEnvelope]()
              val listener=new WebSocket.Listener {
                private val text=new java.lang.StringBuilder()
                override def onOpen(socket: WebSocket): Unit=socket.request(1)
                override def onText(socket: WebSocket,part: CharSequence,last: Boolean): CompletionStage[?] = {
                  text.append(part)
                  if(last) {
                    val message=Wire.decode(ServerEnvelope.codecJson,Wire.parse(text.toString))
                    text.setLength(0)
                    message.result match {
                      case Result.Ping(nonce) => socket.sendText(Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(message.requestId,Operation.Pong(nonce))).noSpaces,true)
                      case _ => inbox.offer(message)
                    }
                  }
                  socket.request(1)
                  CompletableFuture.completedFuture(null)
                }
                override def onClose(socket: WebSocket,code: Int,reason: String): CompletionStage[?] = {
                  inbox.offer(ServerEnvelope(new UUID(0,0),Result.Error(Failure("transport-closed",code.toString))))
                  CompletableFuture.completedFuture(null)
                }
              }
              val socket=client.newWebSocketBuilder().header("Origin",config.allowedOrigin).header("Cookie",s"chronicle_session=$secret")
                .buildAsync(URI.create(s"ws://127.0.0.1:${server.address.getPort}/api/ws"),listener).get(10,TimeUnit.SECONDS)
              def request(operation: Operation): Result = {
                val id=UUID.randomUUID()
                val payload=Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(id,operation)).noSpaces
                assert(payload.getBytes(UTF_8).length<=Http.socketFrameBytes)
                socket.sendText(payload,true).get(10,TimeUnit.SECONDS)
                val reply=inbox.poll(10,TimeUnit.SECONDS)
                assert(reply!=null,"correlated WebSocket response required")
                assertEquals(reply.requestId,id)
                reply.result
              }
              try {
                assert(request(Operation.Hello(List("1.3.0"))).isInstanceOf[Result.Hello])
                List(SortDirection.Asc,SortDirection.Desc).foreach { direction =>
                  val archive=ArchiveQuery("mode:lexical",ArchiveSort.Title,direction,None,1)
                  val first=request(Operation.Archive(archive)).asInstanceOf[Result.Archive].result
                  assertEquals(first.rows.head.head.metadata.title.length,50001)
                  assert(first.nextCursor.nonEmpty)
                  val second=request(Operation.Archive(archive.copy(cursor=first.nextCursor))).asInstanceOf[Result.Archive].result
                  assertEquals(second.rows.size,1)
                  assert(first.rows.head.head.id!=second.rows.head.head.id)
                  val jobs=ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.Title,direction,None,1)
                  val firstJobs=request(Operation.ActivityJobs(jobs)).asInstanceOf[Result.ActivityJobs].result
                  assert(firstJobs.nextCursor.nonEmpty)
                  val secondJobs=request(Operation.ActivityJobs(jobs.copy(cursor=firstJobs.nextCursor))).asInstanceOf[Result.ActivityJobs].result
                  assertEquals(secondJobs.jobs.size,1)
                  assert(firstJobs.jobs.head.job.id!=secondJobs.jobs.head.job.id)
                }
              } finally { socket.abort(); client.close() }
            }}
        }
      }
    }.unsafeRunSync()
  }
}
