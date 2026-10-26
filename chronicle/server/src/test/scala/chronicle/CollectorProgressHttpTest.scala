package chronicle
import chronicle.api.*
import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import distage.*
import org.http4s.{Http as _,Message as _,*}
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import java.util.UUID

class CollectorProgressHttpTest extends munit.FunSuite {
  test("BG GoodCommunication: production routes enforce ingest bearer, separate 64KiB cap and owner-filtered Read status") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val c=Fixtures.config().copy(maxBodyBytes=256*1024*1024)
    EmberClientBuilder.default[IO].build.use { client =>
      val module=new ModuleDef { include(_root_.chronicle.plugins.ChroniclePlugin); make[Config].fromValue(c); make[org.http4s.client.Client[IO]].fromValue(client) }
      Injector().produceGet[RuntimeServices](module).toEffect[IO].use { s => for {
        _ <- IO.blocking { s.database.initialize(); s.database.transaction(x => { Sql.exec(x,"TRUNCATE ch_collector_progress,ch_tokens,ch_mutations CASCADE"); () }) }
        ws <- WebSocketBuilder2[IO]
        gate <- Semaphore[IO](2)
        _ <- IO.defer {
          val auth=new Auth(s.database,c)
          val (_,cookie)=auth.login(LoginRequest("a","synthetic")); val owner=auth.browser(cookie)
          def token(scopes: List[Scope]): String=auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("test",scopes))).asInstanceOf[Result.Token].result.secret.get
          val ingest=token(List(Scope.Ingest)); val read=token(List(Scope.Read))
          val report=CollectorProgressUpdate("test-collector",1,UUID.randomUUID(),CollectorPhase.Idle,"2026-10-26T00:00:00Z",CollectorCounters(1,1,0,0,0,0,1,0,0,0,0,0,123L),123L,123L,None,None)
          val payload=Wire.encode(CollectorProgressUpdate.codecJson,report).noSpaces
          val app=s.http.routes(ws,gate).orNotFound
          def request(secret: String,body: String): Request[IO]=Request[IO](Method.POST,Uri.unsafeFromString("/api/collector/progress")).withEntity(body).putHeaders(Header.Raw(CIString("Authorization"),s"Bearer $secret"))
          def expect(req: Request[IO],status: Status): IO[Unit]=app(req).flatMap(r => r.as[String].map(_ => assertEquals(r.status,status)))
          for {
            ok <- app(request(ingest,payload))
            ack <- ok.as[String]
            _ <- IO { assertEquals(ok.status,Status.Ok); assertEquals(Wire.decode(CollectorProgressAck.codecJson,Wire.parse(ack)),CollectorProgressAck(1,true)) }
            login=Wire.encode(LoginRequest.codecJson,LoginRequest("a","synthetic")).noSpaces
            loginRequest=Request[IO](Method.POST,Uri.unsafeFromString("/api/login")).withEntity(" "*(16385-login.length)+login).putHeaders(Header.Raw(CIString("Origin"),c.allowedOrigin))
            _ <- expect(loginRequest,Status.PayloadTooLarge)
            _ <- expect(loginRequest.withBodyStream(fs2.Stream.emits(Array.fill[Byte](16385)(32)).covary[IO]),Status.PayloadTooLarge)
            loginNoRead=loginRequest.withBodyStream(fs2.Stream.raiseError[IO](new Exception("body must not be read"))).putHeaders(Header.Raw(CIString("Content-Length"),"16385"))
            _ <- expect(loginNoRead,Status.PayloadTooLarge)
            rpc="""{"jsonrpc":"2.0","id":1,"method":"ping"}"""
            mcpRequest=Request[IO](Method.POST,Uri.unsafeFromString("/mcp")).withEntity(" "*(65537-rpc.length)+rpc).putHeaders(Header.Raw(CIString("Authorization"),s"Bearer $read"),Header.Raw(CIString("Accept"),"application/json, text/event-stream"),Header.Raw(CIString("Content-Type"),"application/json"))
            _ <- expect(mcpRequest,Status.PayloadTooLarge)
            _ <- expect(mcpRequest.withBodyStream(fs2.Stream.emits(Array.fill[Byte](65537)(32)).covary[IO]),Status.PayloadTooLarge)
            snapshot=Wire.encode(IngestRequest.codecJson,Fixtures.snapshot()).noSpaces
            ingestRequest=request(ingest," "*(9*1024*1024-snapshot.length)+snapshot).withUri(Uri.unsafeFromString("/api/ingest"))
            _ <- expect(ingestRequest,Status.Ok)
            _ <- expect(request(read,payload),Status.Forbidden)
            _ <- expect(request(ingest,payload).putHeaders(Header.Raw(CIString("Cookie"),s"chronicle_session=$cookie")),Status.Forbidden)
            _ <- expect(request(ingest,payload).withUri(Uri.unsafeFromString("/api/collector/progress?token=forbidden")),Status.BadRequest)
            _ <- expect(request(ingest,payload).putHeaders(Header.Raw(CIString("Origin"),"https://wrong.invalid")),Status.Forbidden)
            _ <- expect(request(ingest," "*(65536-payload.length)+payload),Status.Ok)
            _ <- expect(request(ingest," "*(65537-payload.length)+payload),Status.PayloadTooLarge)
            streamed=request(ingest,"").withBodyStream(fs2.Stream.emits(Array.fill[Byte](65537)(32)).covary[IO])
            _ <- expect(streamed,Status.PayloadTooLarge)
            _ <- IO {
              val service=new CollectorProgress(new PostgresCollectorProgressStore(s.database),java.time.Clock.systemUTC())
              assertEquals(service.status(auth.bearer(read)).collectors.head.report,report)
              assertEquals(service.status(owner.copy(user=owner.user.copy(id="b"))).collectors,Nil)
            }
          } yield ()
        }
      } yield () }
    }.unsafeRunSync()
  }
}
