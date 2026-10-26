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
import java.util.UUID
import scala.concurrent.duration.*

class NulIngestionTest extends munit.FunSuite {
  override val munitTimeout = 90.seconds
  test("BG-GoodCommunication regression: encoded JSONL NUL survives HTTP ingestion with escaped display projection and original replay binding") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val c=Fixtures.config()
    EmberClientBuilder.default[IO].build.use { client =>
      val module=new ModuleDef { include(_root_.chronicle.plugins.ChroniclePlugin); make[Config].fromValue(c); make[org.http4s.client.Client[IO]].fromValue(client) }
      Injector().produceGet[RuntimeServices](module).toEffect[IO].use { s =>
        IO.blocking {
          s.database.initialize()
          s.database.transaction(x => { Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE"); Sql.exec(x,"UPDATE ch_profile SET active=?,target=?,maintenance=false",c.profile,c.profile); Sql.exec(x,"UPDATE ch_owner_targets SET profile=?,epoch=0",c.profile) })
        } *> Semaphore[IO](2).flatMap { gate =>
          EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => s.http.routes(ws,gate).orNotFound).build.use { server =>
            val base=Fixtures.snapshot()
            val text="\u0000alpha\u0000beta😀\u0000"
            val raw=io.circe.Json.obj("id"->io.circe.Json.fromString("u"),"text"->io.circe.Json.fromString(text)).noSpaces+"\n"
            val request=base.copy(digest=Wire.hash(raw),messages=List(Message("u",None,"user",text,None,0)),files=List(RawFile("session.jsonl",Wire.hash(raw),raw)))
            def post(r: IngestRequest,token: String): IO[(Status,String)] = {
              val req=Request[IO](Method.POST,Uri.unsafeFromString(s"http://127.0.0.1:${server.address.getPort}/api/ingest")).withEntity(Wire.encode(IngestRequest.codecJson,r).noSpaces).putHeaders(Header.Raw(CIString("Authorization"),s"Bearer $token"),Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Connection"),"close"))
              client.run(req).use(out => out.as[String].map(out.status -> _))
            }
            for {
              token <- IO.blocking {
                val auth=new Auth(s.database,c); val (_,cookie)=auth.login(LoginRequest("a","synthetic")); val owner=auth.browser(cookie)
                auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("nul-fixture",List(Scope.Ingest)))).asInstanceOf[Result.Token].result.secret.get
              }
              first <- post(request,token)
              receipt <- IO { assertEquals(first._1,Status.Ok); Wire.decode(IngestReceipt.codecJson,Wire.parse(first._2)) }
              replay <- post(request,token)
              _ <- IO(assertEquals(replay,first))
              conflict <- post(request.copy(messages=request.messages.map(_.copy(text=text.replace("\u0000","\\u0000")))),token)
              _ <- IO(assertEquals(conflict._1,Status.Conflict))
              _ <- IO.blocking {
                val archive=new PostgresArchive(s.database,c)
                val stored=archive.headSnapshot("a",receipt.sessionId)
                assertEquals(stored.files,request.files); assertEquals(stored.digest,request.digest)
                assertEquals(stored.messages.head.text,"\\u0000alpha\\u0000beta😀\\u0000")
                assertEquals(archive.messages("a",receipt.sessionId,0,100,None).messages,stored.messages)
                val annotator=new Annotator { def annotate(owner: String,window: List[Chunk],messages: List[Message]): IO[List[Chunk]] = IO {
                  assertEquals(messages,stored.messages); assert(!window.exists(_.text.contains('\u0000')))
                  window.map(_.copy(summary="finite NUL projection",tags=List("nul")))
                } }
                val embedder=new Embedder {
                  def query(owner: String,text: String)=IO.pure(List(1.0,0.0,0.0))
                  def documents(owner: String,text: List[String])=IO { assert(!text.exists(_.contains('\u0000'))); text.map(_ => List(1.0,0.0,0.0)) }
                }
                val worked=ModelFixtures.legacyWorker(archive,annotator,embedder,c,logstage.IzLogger()).once.unsafeRunSync()
                assert(worked)
                assertEquals(archive.statuses("a",0,100).jobs.head.state,JobState.Complete)
                val chunks=archive.pageChunks("a",receipt.sessionId,0,100,None).chunks
                assertEquals(chunks.map(_.text).mkString,stored.messages.head.text)
                assertEquals(chunks.head.spans,List(Span("u",0,stored.messages.head.text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length)))
                val result=new PostgresSearch(s.database,archive,c).search("a",SearchQuery("projection",SearchMode.Lexical,SearchFilter(None,None,None,None,Nil),20,0),None)
                assertEquals(result.total,1); assert(result.hits.forall(_.score.isFinite))
                assertEquals(archive.raw("a",receipt.sessionId,None).files,request.files)
                assertEquals(archive.ingest("a",request),receipt)
              }
              invalid <- post(request.copy(requestId=UUID.randomUUID(),source=request.source.copy(discoveryRootId="bad\u0000id")),token)
              _ <- IO { assertEquals(invalid._1,Status.BadRequest); assertEquals(Wire.decode(Failure.codecJson,Wire.parse(invalid._2)).code,"invalid") }
            } yield ()
          }
        }
      }
    }.unsafeRunSync()
  }
}
