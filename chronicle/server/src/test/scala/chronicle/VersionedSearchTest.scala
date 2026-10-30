package chronicle
import chronicle.api.*
import cats.effect.{IO,Resource}
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
  test("Blackbox-GoodCommunication: sole API retains complete workflows and current ANN scope") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.legacyOnly(config)); db.initialize()
    val snapshot=Wire.encode(IngestRequest.codecJson,Fixtures.snapshot()).noSpaces
    val chunk=Wire.encode(Chunk.codecJson,Fragments.split(Fixtures.snapshot().messages).head).noSpaces
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
      Sql.exec(c,s"CREATE TEMP TABLE fixture AS SELECT i,md5('vsource'||i)::uuid AS sid,md5('vgeneration'||i)::uuid AS gid,md5('vchunk'||i)::uuid AS cid FROM generate_series(1,$corpusSize)i")
      Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision,published) SELECT sid,'a',i::text,1,gid FROM fixture")
      Sql.exec(c,"INSERT INTO ch_revisions SELECT sid,1,?::jsonb FROM fixture",snapshot)
      Sql.exec(c,"INSERT INTO ch_generations SELECT gid,sid,1,? FROM fixture",config.profile)
      Sql.exec(c,"INSERT INTO ch_chunks SELECT cid,gid,?::jsonb || jsonb_build_object('id',cid,'sessionId',sid),to_tsvector('english','archive'),'[1,0,0]'::vector,0 FROM fixture",chunk)
      Sql.exec(c,"INSERT INTO ch_search_chunks SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation")
      Sql.exec(c,"INSERT INTO ch_jobs(id,session_id,revision,profile,state) SELECT md5('vjob'||i)::uuid,sid,1,?,'Running' FROM fixture WHERE i=1",config.profile)
      Sql.exec(c,"ANALYZE")
    }
    ArchiveProjection.backfill(db)
    val archive=new PostgresArchive(db,config); val auth=new Auth(db,config)
    val embedder=new Embedder { def query(owner: String,text: String)=IO.pure(List(1.0,0.0,0.0)); def documents(owner: String,text: List[String])=IO.pure(text.map(_ => List(1.0,0.0,0.0))) }
    val app=new Application(archive,new PostgresSearch(db,archive,config),embedder,auth,db,new CollectorProgress(new PostgresCollectorProgressStore(db),java.time.Clock.systemUTC()),new PostgresArchiveIndex(db,archive,config),new PostgresActivity(db,java.time.Clock.systemUTC()),new PostgresExpressionHintIndex(db,archive,java.time.Clock.systemUTC()),ModelFixtures.usage(config))
    val protocol=new VersionedWire
    val wire=new McpTestWire(protocol)
    (for {
      tools <- Resource.eval(McpTestFixtures.ordinaryTools)
      model <- Resource.eval(McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("unused by protocol compatibility checks"))))
      runs <- McpTestRuns.resource(tools,model,new PostgresRunAuthorization(db,auth),new SystemMcpRunClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO]),config.users.map(_.id).toSet,wire,IO(UUID.randomUUID()))
      controls <- BrowserControlAdmission.resource
    } yield new Http(config,auth,app,archive,new Mcp(app),logstage.IzLogger(),Http.WebRoot(None),protocol,new BrowserRpc(app,runs,wire),controls)).use { http =>
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
        def raw(socket: WebSocket,inbox: LinkedBlockingQueue[String],json: io.circe.Json): io.circe.Json = {
          socket.sendText(json.noSpaces,true).get(timeoutSeconds,TimeUnit.SECONDS)
          val response=inbox.poll(timeoutSeconds,TimeUnit.SECONDS); assert(response!=null,"missing socket response"); Wire.parse(response)
        }
        val (socket,inbox)=connection()
        def call(operation: Operation,requestId: UUID): Result = {
          val response=raw(socket,inbox,Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(requestId,operation)))
          val envelope=Wire.decode(ServerEnvelope.codecJson,response)
          assertEquals(Wire.encode(ServerEnvelope.codecJson,envelope),response)
          assertEquals(envelope.requestId,requestId)
          envelope.result
        }
        def invoke(operation: Operation): Result=call(operation,UUID.randomUUID())
        try {
            assertEquals(invoke(Operation.Hello(List(Wire.versions.current))).asInstanceOf[Result.Hello].versions,Wire.versions)
            assertEquals(invoke(Operation.Ping("nonce")),Result.Pong("nonce"))
            val mutationId=UUID.randomUUID()
            val minted=call(Operation.MintToken("current",List(Scope.Ingest)),mutationId).asInstanceOf[Result.Token].result
            assert(minted.secret.nonEmpty)
            assertEquals(invoke(Operation.Receipt(mutationId)).asInstanceOf[Result.Token].result,minted.copy(secret=None))
            val listed=invoke(Operation.ListTokens()).asInstanceOf[Result.Tokens].result.tokens
            assert(listed.exists(t => t.info.id==minted.token.id && t.source==TokenSource.Issued))
            assert(invoke(Operation.RevokeToken(minted.token.id)).isInstanceOf[Result.Mutation])
            assert(invoke(Operation.ListTokens()).asInstanceOf[Result.Tokens].result.tokens.exists(t => t.info.id==minted.token.id && t.info.revoked))
            val status=invoke(Operation.IngestStatus(0,10)).asInstanceOf[Result.Status].result
            assertEquals(status.jobs.size,1)
            assert(status.jobs.forall(j => j.completedWindows==0 && j.totalWindows.isEmpty))
            val searchResult=invoke(Operation.Search(SearchQuery("archive",SearchMode.Lexical,SearchFilter(None,None,None,None,Nil),10,0)))
            assert(searchResult.isInstanceOf[Result.Search],searchResult.toString)
            val searched=searchResult.asInstanceOf[Result.Search].result
            assertEquals(searched.total,corpusSize); assertEquals(searched.hits.size,10)
            val selected=searched.hits.head.session
            val view=ContentView(selected.view.revision,selected.view.generationId)
            val session=invoke(Operation.GetSession(selected.id,Some(view))).asInstanceOf[Result.Session].result
            assertEquals(session.session.view,selected.view)
            val chunks=invoke(Operation.GetChunks(selected.id,0,1,Some(view))).asInstanceOf[Result.Chunks].result
            assertEquals(chunks.total,1); assertEquals(chunks.view,selected.view)
            val messages=invoke(Operation.GetMessages(selected.id,0,1,Some(view))).asInstanceOf[Result.Messages].result
            assertEquals(messages.total,1); assertEquals(messages.view,selected.view)
            val rawContent=invoke(Operation.GetRaw(selected.id,Some(view.revision))).asInstanceOf[Result.Raw].result
            assertEquals(rawContent.revision,view.revision); assert(rawContent.files.nonEmpty)

            val bounded=invoke(Operation.Search(SearchQuery("archive",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),10,0))).asInstanceOf[Result.Search].result
            assertEquals(bounded.countScope,SearchCountScope.CandidateWindow)
            assertEquals(bounded.rankingLimit,Some(SearchPolicy.candidatesPerLeg))
            assertEquals(invoke(Operation.Whoami()).asInstanceOf[Result.Whoami].user.id,"a")
            assert(bounded.total>=bounded.hits.size && bounded.total<=SearchPolicy.candidatesPerLeg)
            val archived=invoke(Operation.Archive(ArchiveQuery("mode:lexical",ArchiveSort.Title,SortDirection.Asc,None,10,false))).asInstanceOf[Result.Archive].result
            assertEquals(archived.total,corpusSize.toLong); assertEquals(archived.rows.size,10)
            assertEquals(archived.relevanceOrdered,false)
            val activity=invoke(Operation.Activity(ActivityQuery("",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,10))).asInstanceOf[Result.Activity].result
            assertEquals(activity.archiveHeads,corpusSize.toLong)
            val jobs=invoke(Operation.ActivityJobs(ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.JobId,SortDirection.Asc,None,10))).asInstanceOf[Result.ActivityJobs].result
            assertEquals(jobs.total,1L)
            val located=invoke(Operation.LocateMessage(selected.id,ContentView(view.revision,view.generationId),"u")).asInstanceOf[Result.LocatedMessage].result
            assertEquals(located.position,0); assertEquals(located.view,selected.view)
            val plan=invoke(Operation.PreviewRetryFailed()).asInstanceOf[Result.RetryFailedPreview].result
            assertEquals(plan.counts.eligibleCurrentFailed,0L)
            val retryId=UUID.randomUUID()
            val retried=call(Operation.ApplyRetryFailed(plan.targetProfile,plan.selectionHash,true),retryId).asInstanceOf[Result.RetryFailed].result
            assertEquals(retried.retried,0L); assertEquals(retried.requestId,retryId)
            assertEquals(invoke(Operation.Receipt(retryId)),Result.RetryFailed(retried))
            val catalog=invoke(Operation.McpTestTools()).asInstanceOf[Result.McpTestTools].result
            assertEquals(catalog.maximumOutputTokens,65536); assertEquals(catalog.reasoningPolicy,"max")
            assert(invoke(Operation.ModelUsage()).isInstanceOf[Result.ModelUsage])
            assert(invoke(Operation.ExpressionHints(ExpressionHintQuery(ExpressionHintTarget.Archive(),"project:",8,10))).isInstanceOf[Result.ExpressionHints])
            val message=Fixtures.snapshot().messages.head
            val end=message.text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length
            val passage=PassageInfo(UUID.randomUUID(),0,"synthetic context-aware problem",List("work"),PassagePoint(message.id,0,0),PassagePoint(message.id,0,end),end.toLong,1L,1L)
            val generation=selected.view.generationId.get
            db.transaction { c =>
              Sql.exec(c,"UPDATE ch_generations SET passage_format='ContextAwareProblems',passage_count=1 WHERE id=?",generation)
              Sql.exec(c,"INSERT INTO ch_problem_passages(generation,id,ordinal,initial_summary,value,span_count) VALUES(?,?,0,?,?::jsonb,1)",generation,passage.id,passage.summary,Wire.encode(PassageInfo.codecJson,passage).noSpaces)
              Sql.exec(c,"INSERT INTO ch_problem_spans(generation,passage_id,ordinal,message_id,message_position,start_byte,end_byte) VALUES(?,?,0,?,0,0,?)",generation,passage.id,message.id,end)
              Sql.exec(c,"INSERT INTO ch_problem_pieces(generation,chunk_id,passage_ordinal,piece_ordinal) SELECT generation,id,0,0 FROM ch_chunks WHERE generation=? ORDER BY ordinal LIMIT 1",generation)
            }
            val passageView=ContentView(selected.view.revision,selected.view.generationId)
            val passages=invoke(Operation.GetPassages(selected.id,passageView,0,10))
            val spans=invoke(Operation.GetPassageSpans(selected.id,passageView,passage.id,0,10))
            assertEquals(passages,Result.Passages(PassagesResult(selected.view,PassageFormat.ContextAwareProblems,List(passage),1L,0)))
            assertEquals(spans,Result.PassageSpans(PassageSpansResult(selected.view,passage.id,List(PassageSourceSpan(message.id,0,0,end)),1L,0)))
            assertEquals(invoke(Operation.Ping("after-passage-read")),Result.Pong("after-passage-read"))
            val q=SearchQuery("archive",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),pageSize,0)
            assertEquals(invoke(Operation.Search(q.copy(offset=SearchPolicy.candidatesPerLeg))).asInstanceOf[Result.Error].failure.code,"invalid")
            val pages=(0 until corpusSize by pageSize).map { offset =>
            val result=invoke(Operation.Search(q.copy(mode=SearchMode.Lexical,offset=offset))).asInstanceOf[Result.Search].result
            assertEquals(result.total,corpusSize); assertEquals(result.countScope,SearchCountScope.ExactMatches); assertEquals(result.rankingLimit,None)
            result.hits.map(_.session.id)
            }
            assertEquals(pages.flatten.size,corpusSize); assertEquals(pages.flatten.distinct.size,corpusSize)
        } finally { socket.abort(); client.close() }
      }}
    }}.unsafeRunSync()
  }
}
