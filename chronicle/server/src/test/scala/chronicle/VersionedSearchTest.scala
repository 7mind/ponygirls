package chronicle
import chronicle.api.*
import chronicle.api.{v1_0_0 as old}
import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import org.http4s.ember.server.EmberServerBuilder
import com.comcast.ip4s.*
import java.net.URI
import java.net.http.{HttpClient,WebSocket}
import java.util.UUID
import java.util.concurrent.{LinkedBlockingQueue,TimeUnit,CompletionStage,CompletableFuture}

class VersionedSearchTest extends munit.FunSuite {
  private val corpusSize=1205
  private val pageSize=100
  private val timeoutSeconds=10
  test("Blackbox-GoodCommunication: negotiated old codecs retain exact complete pagination; latest codecs expose bounded ANN count scope") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config); db.initialize()
    val snapshot=Wire.encode(IngestRequest.codecJson,Fixtures.snapshot()).noSpaces
    val chunk=Wire.encode(Chunk.codecJson,Fragments.split(Fixtures.snapshot().messages).head).noSpaces
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
      Sql.exec(c,s"CREATE TEMP TABLE fixture AS SELECT i,md5('vsource'||i)::uuid AS sid,md5('vgeneration'||i)::uuid AS gid,md5('vchunk'||i)::uuid AS cid FROM generate_series(1,$corpusSize)i")
      Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision,published) SELECT sid,'a',i::text,1,gid FROM fixture")
      Sql.exec(c,"INSERT INTO ch_revisions SELECT sid,1,?::jsonb FROM fixture",snapshot)
      Sql.exec(c,"INSERT INTO ch_generations SELECT gid,sid,1,? FROM fixture",config.profile)
      Sql.exec(c,"INSERT INTO ch_chunks SELECT cid,gid,?::jsonb || jsonb_build_object('id',cid,'sessionId',sid),to_tsvector('english','archive'),'[1,0,0]'::vector,0 FROM fixture",chunk)
      Sql.exec(c,"INSERT INTO ch_search_chunks SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation")
      Sql.exec(c,"ANALYZE")
    }
    val archive=new PostgresArchive(db,config); val auth=new Auth(db,config)
    val embedder=new Embedder { def query(text: String)=IO.pure(List(1.0,0.0,0.0)); def documents(text: List[String])=IO.pure(text.map(_ => List(1.0,0.0,0.0))) }
    val app=new Application(archive,new PostgresSearch(db,archive,config),embedder,auth,db)
    val http=new Http(config,auth,app,archive,new Mcp(app),logstage.IzLogger())
    Semaphore[IO](2).flatMap { gate =>
      EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => http.routes(ws,gate).orNotFound).build.use { server => IO.blocking {
        val (_,secret)=auth.login(LoginRequest("a","synthetic"))
        val client=HttpClient.newHttpClient()
        def connection(): (WebSocket,LinkedBlockingQueue[String]) = {
          val inbox=new LinkedBlockingQueue[String]()
          val listener=new WebSocket.Listener {
            private val text=new java.lang.StringBuilder()
            override def onOpen(ws: WebSocket): Unit=ws.request(1)
            override def onText(ws: WebSocket,part: CharSequence,last: Boolean): CompletionStage[?] = {
              text.append(part); if(last) { inbox.offer(text.toString); text.setLength(0) }; ws.request(1); CompletableFuture.completedFuture(null)
            }
          }
          val socket=client.newWebSocketBuilder().header("Origin",config.allowedOrigin).header("Cookie",s"chronicle_session=$secret").buildAsync(URI.create(s"ws://127.0.0.1:${server.address.getPort}/api/ws"),listener).get(timeoutSeconds,TimeUnit.SECONDS)
          (socket,inbox)
        }
        val (legacy,legacyInbox)=connection(); val (latest,latestInbox)=connection()
        def raw(socket: WebSocket,inbox: LinkedBlockingQueue[String],json: io.circe.Json): io.circe.Json = {
          socket.sendText(json.noSpaces,true).get(timeoutSeconds,TimeUnit.SECONDS)
          val response=inbox.poll(timeoutSeconds,TimeUnit.SECONDS); assert(response!=null,"missing socket response"); Wire.parse(response)
        }
        def oldCall(operation: old.Operation): old.Result = {
          val envelope=old.ClientEnvelope(UUID.randomUUID(),operation)
          val response=raw(legacy,legacyInbox,Wire.encode(old.ClientEnvelope.codecJson,envelope))
          val decoded=Wire.decode(old.ServerEnvelope.codecJson,response)
          assertEquals(Wire.encode(old.ServerEnvelope.codecJson,decoded),response,"legacy wire must be produced by its codec, not latest JSON with extra fields")
          decoded.result
        }
        def currentCall(operation: Operation): Result = Wire.decode(ServerEnvelope.codecJson,raw(latest,latestInbox,Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),operation)))).result
        try {
          val hello=oldCall(old.Operation.Hello(List("1.0.0"))).asInstanceOf[old.Result.Hello]
          assertEquals(hello.versions.current,"1.1.0"); assertEquals(hello.versions.minimum,"1.0.0")
          val oldFilter=old.SearchFilter(None,None,None,None,Nil)
          val pages=(0 until corpusSize by pageSize).map { offset =>
            val result=oldCall(old.Operation.Search(old.SearchQuery("archive",old.SearchMode.Semantic,oldFilter,pageSize,offset))).asInstanceOf[old.Result.Search].result
            assertEquals(result.total,corpusSize); result.hits.map(_.session.id)
          }
          assertEquals(pages.flatten.size,corpusSize); assertEquals(pages.flatten.distinct.size,corpusSize)
          assertEquals(oldCall(old.Operation.Whoami()).asInstanceOf[old.Result.Whoami].user.id,"a")
          assert(currentCall(Operation.Hello(List("1.1.0","1.0.0"))).isInstanceOf[Result.Hello])
          val q=SearchQuery("archive",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),pageSize,0)
          val bounded=currentCall(Operation.Search(q)).asInstanceOf[Result.Search].result
          assertEquals(bounded.countScope,SearchCountScope.CandidateWindow); assertEquals(bounded.rankingLimit,Some(SearchPolicy.candidatesPerLeg)); assert(bounded.total>=bounded.hits.size && bounded.total<=SearchPolicy.candidatesPerLeg); assertEquals(bounded.hits.size,pageSize)
          assertEquals(currentCall(Operation.Search(q.copy(offset=SearchPolicy.candidatesPerLeg))).asInstanceOf[Result.Error].failure.code,"invalid")
          val lexical=currentCall(Operation.Search(q.copy(mode=SearchMode.Lexical))).asInstanceOf[Result.Search].result
          assertEquals(lexical.total,corpusSize); assertEquals(lexical.countScope,SearchCountScope.ExactMatches); assertEquals(lexical.rankingLimit,None)
        } finally { legacy.abort(); latest.abort(); client.close() }
      }}
    }.unsafeRunSync()
  }
}
