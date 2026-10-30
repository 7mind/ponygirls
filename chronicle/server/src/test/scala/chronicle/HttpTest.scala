package chronicle
import chronicle.api.*
import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import org.http4s.{Message as _,*}
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.ember.client.EmberClientBuilder
import org.typelevel.ci.CIString
import com.comcast.ip4s.*
import distage.*
import java.net.URI
import java.net.http.{HttpClient as JClient,WebSocket}
import java.util.UUID
import java.util.concurrent.{LinkedBlockingQueue,TimeUnit,CompletionStage,CompletableFuture}
import scala.concurrent.duration.*
class HttpTest extends munit.FunSuite {
  override val munitTimeout = 90.seconds
  test("BG-GoodCommunication regression: valid slow semantic query does not prevent correlated server Pong processing") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val model: HttpApp[IO]=cats.data.Kleisli(_ => IO.sleep(17.seconds).as(Response[IO](Status.Ok).withEntity("""{"data":[{"index":0,"embedding":[1,0,0]}]}""")))
    EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(model).build.use { endpoint =>
      val original=Fixtures.config(); val c=original.copy(embedding=original.embedding.copy(endpoint=s"http://127.0.0.1:${endpoint.address.getPort}/embedding",timeoutSeconds=25))
      EmberClientBuilder.default[IO].build.use { client =>
        val module=new ModuleDef { include(_root_.chronicle.plugins.ChroniclePlugin); make[Config].fromValue(c); make[org.http4s.client.Client[IO]].fromValue(client) }
        ChronicleInjector().produceGet[RuntimeServices](module).use { s =>
          IO.blocking { s.database.initialize(); s.database.transaction { x => Sql.exec(x,"TRUNCATE ch_sources CASCADE"); Sql.exec(x,"UPDATE ch_profile SET active=?,target=?,maintenance=false",c.profile,c.profile); Sql.exec(x,"UPDATE ch_owner_targets SET profile=?,epoch=0",c.profile) } } *> Semaphore[IO](2).flatMap { gate =>
            EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => s.http.routes(ws,gate).orNotFound).build.use { server => IO.blocking {
              val (_,secret)=new Auth(s.database,c).login(LoginRequest("a","synthetic"))
              val jclient=JClient.newHttpClient(); val inbox=new LinkedBlockingQueue[ServerEnvelope]()
              val closed=new CompletableFuture[Int](); val pings=new java.util.concurrent.atomic.AtomicInteger()
              val listener=new WebSocket.Listener {
                private val text=new java.lang.StringBuilder()
                override def onOpen(ws: WebSocket): Unit=ws.request(1)
                override def onText(ws: WebSocket,part: CharSequence,last: Boolean): CompletionStage[?] = {
                  text.append(part)
                  if(last) {
                    val envelope=Wire.decode(ServerEnvelope.codecJson,Wire.parse(text.toString)); text.setLength(0)
                    envelope.result match {
                      case Result.Ping(nonce) => pings.incrementAndGet(); ws.sendText(Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(envelope.requestId,Operation.Pong(nonce))).noSpaces,true)
                      case _ => inbox.offer(envelope)
                    }
                  }
                  ws.request(1); CompletableFuture.completedFuture(null)
                }
                override def onClose(ws: WebSocket,code: Int,reason: String): CompletionStage[?] = {
                  closed.complete(code); inbox.offer(ServerEnvelope(new UUID(0,0),Result.Error(Failure("transport-closed",code.toString)))); CompletableFuture.completedFuture(null)
                }
              }
              val ws=jclient.newWebSocketBuilder().header("Origin",c.allowedOrigin).header("Cookie",s"chronicle_session=$secret").buildAsync(URI.create(s"ws://127.0.0.1:${server.address.getPort}/api/ws"),listener).get(10,TimeUnit.SECONDS)
              val opened=System.nanoTime()
              def send(op: Operation): Unit= { ws.sendText(Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),op)).noSpaces,true).get(10,TimeUnit.SECONDS); () }
              def receive(): Result= { val envelope=inbox.poll(25,TimeUnit.SECONDS); assert(envelope!=null,s"response missing; close=${closed.getNow(0)}"); envelope.result }
              try {
                send(Operation.Hello(List("1.9.0"))); assert(receive().isInstanceOf[Result.Hello])
                val delay=19.seconds.toNanos-(System.nanoTime()-opened)
                if(delay>0) TimeUnit.NANOSECONDS.sleep(delay)
                send(Operation.Search(SearchQuery("slow model",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),20,0)))
                send(Operation.Ping("during-query")); assertEquals(receive(),Result.Pong("during-query"))
                val result=receive()
                assert(result.isInstanceOf[Result.Search],s"valid slow query lost despite immediate correlated Pongs: result=$result close=${closed.getNow(0)}")
                assert(pings.get()>0,"query must cross an actual server heartbeat deadline")
                send(Operation.Ping("after-query")); assertEquals(receive(),Result.Pong("after-query"))
                assert(!closed.isDone,"socket remains live after query completion")
              } finally { ws.abort(); jclient.close() }
            }}
          }
        }
      }
    }.unsafeRunSync()
  }
  test("BG-GoodCommunication regression: actual liveness deadlines are retriable but malformed frames and versions remain terminal") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val c=Fixtures.config().copy(maxBodyBytes=256*1024*1024)
    EmberClientBuilder.default[IO].build.use { client =>
      val module=new ModuleDef { include(_root_.chronicle.plugins.ChroniclePlugin); make[Config].fromValue(c); make[org.http4s.client.Client[IO]].fromValue(client) }
      ChronicleInjector().produceGet[RuntimeServices](module).use { s =>
        IO.blocking(s.database.initialize()) *> Semaphore[IO](2).flatMap { gate =>
          EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => s.http.routes(ws,gate).orNotFound).build.use { server => IO.blocking {
            val (_,secret)=new Auth(s.database,c).login(LoginRequest("a","synthetic"))
            val jclient=JClient.newHttpClient(); val pings=new java.util.concurrent.atomic.AtomicInteger()
            val sockets=List("hello-timeout","pong-timeout","malformed","version","oversized").map { mode =>
              val closed=new CompletableFuture[Int]()
              val listener=new WebSocket.Listener {
                private val text=new java.lang.StringBuilder()
                override def onOpen(ws: WebSocket): Unit=ws.request(1)
                override def onText(ws: WebSocket,part: CharSequence,last: Boolean): CompletionStage[?] = {
                  text.append(part)
                  if(last) {
                    val result=Wire.decode(ServerEnvelope.codecJson,Wire.parse(text.toString)).result; text.setLength(0)
                    if(mode=="pong-timeout" && result.isInstanceOf[Result.Ping]) pings.incrementAndGet()
                  }
                  ws.request(1); CompletableFuture.completedFuture(null)
                }
                override def onClose(ws: WebSocket,code: Int,reason: String): CompletionStage[?] = { closed.complete(code); CompletableFuture.completedFuture(null) }
              }
              val ws=jclient.newWebSocketBuilder().header("Origin",c.allowedOrigin).header("Cookie",s"chronicle_session=$secret").buildAsync(URI.create(s"ws://127.0.0.1:${server.address.getPort}/api/ws"),listener).get(10,TimeUnit.SECONDS)
              if(mode!="hello-timeout") {
                val payload=if(mode=="malformed") "{}" else if(mode=="oversized") " "*65537+Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),Operation.Hello(List("1.9.0")))).noSpaces else Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),Operation.Hello(List(if(mode=="version") "unsupported" else "1.9.0")))).noSpaces
                ws.sendText(payload,true).get(10,TimeUnit.SECONDS)
              }
              (mode,ws,closed)
            }
            try {
              val codes=sockets.map { case (mode,_,closed) => mode -> closed.get(40,TimeUnit.SECONDS) }.toMap
              assertEquals(codes,Map("hello-timeout"->1013,"pong-timeout"->1013,"malformed"->4400,"version"->4406,"oversized"->4400))
              assert(pings.get()>0,"the negotiated client must withhold an actual server Ping until expiry")
            } finally { sockets.foreach(_._2.abort()); jclient.close() }
          }}
        }
      }
    }.unsafeRunSync()
  }
  test("BG-GoodCommunication: actual HTTP MCP Origin cookie/bearer separation and typed WS reauthentication") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val started=System.nanoTime()
    // Private-network Origin with an explicitly opted-in HTTP deployment; socket stays controllable loopback.
    val c=Fixtures.config().copy(allowedOrigin="http://192.168.50.10:47330",allowInsecureHttp=true)
    c.validate()
    EmberClientBuilder.default[IO].build.use { client =>
      val module=new ModuleDef { include(_root_.chronicle.plugins.ChroniclePlugin); make[Config].fromValue(c); make[org.http4s.client.Client[IO]].fromValue(client) }
      ChronicleInjector().produceGet[RuntimeServices](module).use { s =>
        IO.blocking(s.database.initialize()) *> Semaphore[IO](2).flatMap { gate =>
          EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => s.http.routes(ws,gate).orNotFound).build.use { server =>
            val base=s"http://127.0.0.1:${server.address.getPort}"
            def post(path: String,payload: String,headers: List[(String,String)]): IO[(Status,String,Headers)] = {
              val request=Request[IO](Method.POST,Uri.unsafeFromString(base+path)).withEntity(payload).putHeaders((List("Content-Type"->"application/json","Connection"->"close")++headers).map { case (k,v) => Header.Raw(CIString(k),v) }*)
              client.run(request).use(r => r.as[String].map(body => (r.status,body,r.headers))).timeout(10.seconds)
            }
            for {
              denied <- post("/api/login",Wire.encode(LoginRequest.codecJson,LoginRequest("a","synthetic")).noSpaces,List("Origin"->"https://evil.invalid"))
              _ <- IO(assertEquals(denied._1,Status.Forbidden))
              logged <- post("/api/login",Wire.encode(LoginRequest.codecJson,LoginRequest("a","synthetic")).noSpaces,List("Origin"->c.allowedOrigin))
              _ <- IO(assertEquals(logged._1,Status.Ok))
              cookie <- IO(logged._3.get(CIString("Set-Cookie")).get.head.value.takeWhile(_!=';'))
              _ <- IO(assert(logged._3.get(CIString("Set-Cookie")).get.head.value.contains("HttpOnly")))
              _ <- IO {
                val value=logged._3.get(CIString("Set-Cookie")).get.head.value
                assert(cookie.startsWith("chronicle_session=")) // No HTTPS-only __Host-/__Secure- prefix.
                assert(!value.split(";").exists(_.trim.equalsIgnoreCase("Secure")))
                assert(value.contains("SameSite=Strict"))
              }
              _ <- IO.blocking {
                val jclient=JClient.newHttpClient()
                val inbox=new LinkedBlockingQueue[String]()
                val closed=new CompletableFuture[Int]()
                val listener=new WebSocket.Listener {
                  override def onOpen(ws: WebSocket): Unit = ws.request(1)
                  override def onText(ws: WebSocket,text: CharSequence,last: Boolean): CompletionStage[?] = { inbox.offer(text.toString); ws.request(1); CompletableFuture.completedFuture(null) }
                  override def onClose(ws: WebSocket,code: Int,reason: String): CompletionStage[?] = { closed.complete(code); CompletableFuture.completedFuture(null) }
                }
                val ws=jclient.newWebSocketBuilder().header("Origin",c.allowedOrigin).header("Cookie",cookie).buildAsync(URI.create(base.replace("http:","ws:")+"/api/ws"),listener).get(10,TimeUnit.SECONDS)
                def receive(): ServerEnvelope = { val text=inbox.poll(10,TimeUnit.SECONDS); assert(text!=null); Wire.decode(ServerEnvelope.codecJson,Wire.parse(text)) }
                val hello=ClientEnvelope(UUID.randomUUID(),Operation.Hello(List("1.9.0")))
                ws.sendText(Wire.encode(ClientEnvelope.codecJson,hello).noSpaces,true).get(10,TimeUnit.SECONDS)
                assert(receive().result.isInstanceOf[Result.Hello])
                val mint=ClientEnvelope(UUID.randomUUID(),Operation.MintToken("http-test",List(Scope.Read,Scope.Ingest)))
                ws.sendText(Wire.encode(ClientEnvelope.codecJson,mint).noSpaces,true).get(10,TimeUnit.SECONDS)
                val minted=receive().result.asInstanceOf[Result.Token].result
                inbox.offer("TOKEN:"+minted.secret.get)
                // Revocation is observed on the next operation of the SAME open socket.
                s.database.transaction(x => Sql.exec(x,"DELETE FROM ch_sessions WHERE owner='a'"))
                ws.sendText(Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),Operation.Whoami())).noSpaces,true).get(10,TimeUnit.SECONDS)
                val secret=inbox.poll(10,TimeUnit.SECONDS).stripPrefix("TOKEN:")
                val response=receive().result.asInstanceOf[Result.Error]
                assertEquals(response.failure.code,"unauthorized"); assertEquals(closed.get(10,TimeUnit.SECONDS),4401)
                ws.abort(); jclient.close()
                secret
              }.flatMap { token =>
                val rpc="""{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"synthetic","version":"1"}}}"""
                val h=List("Authorization"->s"Bearer $token","Accept"->"application/json, text/event-stream")
                for {
                  initialized <- post("/mcp",rpc,h)
                  _ <- IO { assertEquals(initialized._1,Status.Ok); assertEquals(Wire.parse(initialized._2).hcursor.downField("result").get[String]("protocolVersion").toOption,Some("2025-06-18")) }
                  notification <- post("/mcp","""{"jsonrpc":"2.0","method":"notifications/initialized"}""",h)
                  _ <- IO(assertEquals(notification._1,Status.Accepted))
                  tools <- post("/mcp","""{"jsonrpc":"2.0","id":2,"method":"tools/list"}""",h)
                  _ <- IO(assertEquals(Wire.parse(tools._2).hcursor.downField("result").get[List[io.circe.Json]]("tools").toOption.get.size,10))
                  ping <- post("/mcp","""{"jsonrpc":"2.0","id":3,"method":"ping"}""",h)
                  _ <- IO(assertEquals(ping._1,Status.Ok))
                  mixed <- post("/mcp",rpc,h++List("Cookie"->cookie))
                  _ <- IO(assertEquals(mixed._1,Status.Forbidden))
                } yield ()
              }
            } yield ()
          }
        }
      }
    }.unsafeRunSync()
    assert((System.nanoTime()-started).nanos < 15.seconds,"websocket resource shutdown exceeded bounded close deadline")
  }
}
