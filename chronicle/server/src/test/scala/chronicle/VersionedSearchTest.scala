package chronicle
import chronicle.api.*
import chronicle.api.{v1_0_0 as old,v1_4_0 as v14,v1_5_0 as v15,v1_6_0 as v16,v1_7_0 as v17}
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
  List("1.0.0","1.1.0","1.2.0","1.3.0","1.4.0","1.5.0","1.6.0","1.7.0","1.8.0").foreach { selectedVersion =>
  test(s"Blackbox-GoodCommunication: API$selectedVersion retains complete workflows; exact legacy pagination and current ANN scope stay distinct") {
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
    val conversions=new chronicle.protocol.ProtocolConversions
    val protocol=new VersionedWire(conversions)
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
        try {
          // Specified BG/GoodCommunication: real browser auth and socket workflows,
          // with each retained version's own client/server codecs on the wire.
          List(selectedVersion).foreach { version =>
            val (socket,inbox)=connection()
            def up17(envelope: v17.ServerEnvelope): ServerEnvelope = conversions.up1_7_0.convert[v17.ServerEnvelope,ServerEnvelope](envelope)
            def up16(envelope: v16.ServerEnvelope): ServerEnvelope = up17(conversions.up1_6_0.convert[v16.ServerEnvelope,v17.ServerEnvelope](envelope))
            def decode17(response: io.circe.Json): ServerEnvelope = {
              val decoded=Wire.decode(v17.ServerEnvelope.codecJson,response)
              assertEquals(Wire.encode(v17.ServerEnvelope.codecJson,decoded),response); up17(decoded)
            }
            def up15(envelope: v15.ServerEnvelope): ServerEnvelope = up16(conversions.up1_5_0.convert[v15.ServerEnvelope,v16.ServerEnvelope](envelope))
            def decode16(response: io.circe.Json): ServerEnvelope = {
              val decoded=Wire.decode(v16.ServerEnvelope.codecJson,response)
              assertEquals(Wire.encode(v16.ServerEnvelope.codecJson,decoded),response); up16(decoded)
            }
            def up14(envelope: v14.ServerEnvelope): ServerEnvelope = up15(conversions.up1_4_0.convert[v14.ServerEnvelope,v15.ServerEnvelope](envelope))
            def encode14(envelope: v14.ClientEnvelope): io.circe.Json = {
              val v15Request=conversions.up1_4_0.convert[v14.ClientEnvelope,v15.ClientEnvelope](envelope)
              if(version=="1.5.0") Wire.encode(v15.ClientEnvelope.codecJson,v15Request)
              else {
                val v16Request=conversions.up1_5_0.convert[v15.ClientEnvelope,v16.ClientEnvelope](v15Request)
                if(version=="1.6.0") Wire.encode(v16.ClientEnvelope.codecJson,v16Request)
                else {
                  val v17Request=conversions.up1_6_0.convert[v16.ClientEnvelope,v17.ClientEnvelope](v16Request)
                  if(version=="1.7.0") Wire.encode(v17.ClientEnvelope.codecJson,v17Request)
                  else Wire.encode(ClientEnvelope.codecJson,conversions.up1_7_0.convert[v17.ClientEnvelope,ClientEnvelope](v17Request))
                }
              }
            }
            def decode15(response: io.circe.Json): ServerEnvelope = {
              val decoded=Wire.decode(v15.ServerEnvelope.codecJson,response)
              assertEquals(Wire.encode(v15.ServerEnvelope.codecJson,decoded),response)
              up15(decoded)
            }
            def up13(envelope: chronicle.api.v1_3_0.ServerEnvelope): ServerEnvelope = up14(conversions.up1_3_0.convert[chronicle.api.v1_3_0.ServerEnvelope,v14.ServerEnvelope](envelope))
            def up12(envelope: chronicle.api.v1_2_0.ServerEnvelope): ServerEnvelope = up13(conversions.up1_2_0.convert[chronicle.api.v1_2_0.ServerEnvelope,chronicle.api.v1_3_0.ServerEnvelope](envelope))
            def call(operation: old.Operation,requestId: UUID): Result = {
              val v10=old.ClientEnvelope(requestId,operation)
              val middle=conversions.up1_0_0.convert[old.ClientEnvelope,chronicle.api.v1_1_0.ClientEnvelope](v10)
              val v12Request=conversions.up1_1_0.convert[chronicle.api.v1_1_0.ClientEnvelope,chronicle.api.v1_2_0.ClientEnvelope](middle)
              val v13Request=conversions.up1_2_0.convert[chronicle.api.v1_2_0.ClientEnvelope,chronicle.api.v1_3_0.ClientEnvelope](v12Request)
              val v14Request=conversions.up1_3_0.convert[chronicle.api.v1_3_0.ClientEnvelope,v14.ClientEnvelope](v13Request)
              val request=version match {
                case "1.0.0" => Wire.encode(old.ClientEnvelope.codecJson,v10)
                case "1.1.0" => Wire.encode(chronicle.api.v1_1_0.ClientEnvelope.codecJson,middle)
                case "1.2.0" => Wire.encode(chronicle.api.v1_2_0.ClientEnvelope.codecJson,v12Request)
                case "1.3.0" => Wire.encode(chronicle.api.v1_3_0.ClientEnvelope.codecJson,v13Request)
                case "1.4.0" => Wire.encode(v14.ClientEnvelope.codecJson,v14Request)
                case "1.5.0" | "1.6.0" | "1.7.0" | "1.8.0" => encode14(v14Request)
              }
              val response=raw(socket,inbox,request)
              val current=version match {
                case "1.0.0" =>
                  val decoded=Wire.decode(old.ServerEnvelope.codecJson,response)
                  assertEquals(Wire.encode(old.ServerEnvelope.codecJson,decoded),response)
                  up12(conversions.up1_1_0.convert[chronicle.api.v1_1_0.ServerEnvelope,chronicle.api.v1_2_0.ServerEnvelope](conversions.up1_0_0.convert[old.ServerEnvelope,chronicle.api.v1_1_0.ServerEnvelope](decoded)))
                case "1.1.0" =>
                  val decoded=Wire.decode(chronicle.api.v1_1_0.ServerEnvelope.codecJson,response)
                  assertEquals(Wire.encode(chronicle.api.v1_1_0.ServerEnvelope.codecJson,decoded),response)
                  up12(conversions.up1_1_0.convert[chronicle.api.v1_1_0.ServerEnvelope,chronicle.api.v1_2_0.ServerEnvelope](decoded))
                case "1.2.0" =>
                  val decoded=Wire.decode(chronicle.api.v1_2_0.ServerEnvelope.codecJson,response)
                  assertEquals(Wire.encode(chronicle.api.v1_2_0.ServerEnvelope.codecJson,decoded),response)
                  up12(decoded)
                case "1.3.0" =>
                  val decoded=Wire.decode(chronicle.api.v1_3_0.ServerEnvelope.codecJson,response)
                  assertEquals(Wire.encode(chronicle.api.v1_3_0.ServerEnvelope.codecJson,decoded),response)
                  up13(decoded)
                case "1.4.0" =>
                  val decoded=Wire.decode(v14.ServerEnvelope.codecJson,response)
                  assertEquals(Wire.encode(v14.ServerEnvelope.codecJson,decoded),response)
                  up14(decoded)
                case "1.5.0" => decode15(response)
                case "1.6.0" => decode16(response)
                case "1.7.0" => decode17(response)
                case "1.8.0" =>
                  val decoded=Wire.decode(ServerEnvelope.codecJson,response)
                  assertEquals(Wire.encode(ServerEnvelope.codecJson,decoded),response)
                  decoded
              }
              assertEquals(current.requestId,requestId)
              current.result
            }
            def invoke(operation: old.Operation): Result=call(operation,UUID.randomUUID())
            try {
              assertEquals(invoke(old.Operation.Hello(List(version))).asInstanceOf[Result.Hello].versions,Wire.versions)
              assertEquals(invoke(old.Operation.Ping("legacy-nonce")),Result.Pong("legacy-nonce"))
              val mutationId=UUID.randomUUID()
              val minted=call(old.Operation.MintToken("legacy-"+version,List(old.Scope.Ingest)),mutationId).asInstanceOf[Result.Token].result
              assert(minted.secret.nonEmpty)
              assertEquals(invoke(old.Operation.Receipt(mutationId)).asInstanceOf[Result.Token].result,minted.copy(secret=None))
              val listed=invoke(old.Operation.ListTokens()).asInstanceOf[Result.Tokens].result.tokens
              assert(listed.exists(t => t.info.id==minted.token.id && t.source==TokenSource.Issued))
              assert(invoke(old.Operation.RevokeToken(minted.token.id)).isInstanceOf[Result.Mutation])
              assert(invoke(old.Operation.ListTokens()).asInstanceOf[Result.Tokens].result.tokens.exists(t => t.info.id==minted.token.id && t.info.revoked))
              val status=invoke(old.Operation.IngestStatus(0,10)).asInstanceOf[Result.Status].result
              assertEquals(status.jobs.size,1)
              assert(status.jobs.forall(j => j.completedWindows==0 && j.totalWindows.isEmpty))
              val searchResult=invoke(old.Operation.Search(old.SearchQuery("archive",old.SearchMode.Lexical,old.SearchFilter(None,None,None,None,Nil),10,0)))
              assert(searchResult.isInstanceOf[Result.Search],searchResult.toString)
              val searched=searchResult.asInstanceOf[Result.Search].result
              assertEquals(searched.total,corpusSize); assertEquals(searched.hits.size,10)
              val selected=searched.hits.head.session
              val view=old.ContentView(selected.view.revision,selected.view.generationId)
              val session=invoke(old.Operation.GetSession(selected.id,Some(view))).asInstanceOf[Result.Session].result
              assertEquals(session.session.view,selected.view)
              val chunks=invoke(old.Operation.GetChunks(selected.id,0,1,Some(view))).asInstanceOf[Result.Chunks].result
              assertEquals(chunks.total,1); assertEquals(chunks.view,selected.view)
              val messages=invoke(old.Operation.GetMessages(selected.id,0,1,Some(view))).asInstanceOf[Result.Messages].result
              assertEquals(messages.total,1); assertEquals(messages.view,selected.view)
              val rawContent=invoke(old.Operation.GetRaw(selected.id,Some(view.revision))).asInstanceOf[Result.Raw].result
              assertEquals(rawContent.revision,view.revision); assert(rawContent.files.nonEmpty)

              if(version!="1.0.0") {
                val bounded=invoke(old.Operation.Search(old.SearchQuery("archive",old.SearchMode.Semantic,old.SearchFilter(None,None,None,None,Nil),10,0))).asInstanceOf[Result.Search].result
                assertEquals(bounded.countScope,SearchCountScope.CandidateWindow)
                assertEquals(bounded.rankingLimit,Some(SearchPolicy.candidatesPerLeg))
              }
              assertEquals(invoke(old.Operation.Whoami()).asInstanceOf[Result.Whoami].user.id,"a")
              if(version>="1.3.0") {
                def extra(operation: chronicle.api.v1_3_0.Operation,requestId: UUID): Result = {
                  val envelope=chronicle.api.v1_3_0.ClientEnvelope(requestId,operation)
                  val retained=conversions.up1_3_0.convert[chronicle.api.v1_3_0.ClientEnvelope,v14.ClientEnvelope](envelope)
                  val encoded=version match {
                    case "1.3.0" => Wire.encode(chronicle.api.v1_3_0.ClientEnvelope.codecJson,envelope)
                    case "1.4.0" => Wire.encode(v14.ClientEnvelope.codecJson,retained)
                    case "1.5.0" | "1.6.0" | "1.7.0" | "1.8.0" => encode14(retained)
                  }
                  val response=raw(socket,inbox,encoded)
                  val current=version match {
                    case "1.3.0" =>
                      val decoded=Wire.decode(chronicle.api.v1_3_0.ServerEnvelope.codecJson,response)
                      assertEquals(Wire.encode(chronicle.api.v1_3_0.ServerEnvelope.codecJson,decoded),response)
                      up13(decoded)
                    case "1.4.0" =>
                      val decoded=Wire.decode(v14.ServerEnvelope.codecJson,response)
                      assertEquals(Wire.encode(v14.ServerEnvelope.codecJson,decoded),response)
                      up14(decoded)
                    case "1.5.0" => decode15(response)
                    case "1.6.0" => decode16(response)
                    case "1.7.0" => decode17(response)
                    case "1.8.0" => Wire.decode(ServerEnvelope.codecJson,response)
                  }
                  assertEquals(current.requestId,requestId)
                  current.result
                }
                def invoke13(operation: chronicle.api.v1_3_0.Operation): Result=extra(operation,UUID.randomUUID())
                val archived=invoke13(chronicle.api.v1_3_0.Operation.Archive(chronicle.api.v1_3_0.ArchiveQuery("mode:lexical",chronicle.api.v1_3_0.ArchiveSort.Title,chronicle.api.v1_3_0.SortDirection.Asc,None,10))).asInstanceOf[Result.Archive].result
                assertEquals(archived.total,corpusSize.toLong); assertEquals(archived.rows.size,10)
                assertEquals(archived.relevanceOrdered,false)
                val activity=invoke13(chronicle.api.v1_3_0.Operation.Activity(chronicle.api.v1_3_0.ActivityQuery("",chronicle.api.v1_3_0.ActivityCollectorSort.CollectorId,chronicle.api.v1_3_0.SortDirection.Asc,None,10))).asInstanceOf[Result.Activity].result
                assertEquals(activity.archiveHeads,corpusSize.toLong)
                val jobs=invoke13(chronicle.api.v1_3_0.Operation.ActivityJobs(chronicle.api.v1_3_0.ActivityJobsQuery(None,chronicle.api.v1_3_0.ActivityJobScope.All,"",chronicle.api.v1_3_0.ActivityJobSort.JobId,chronicle.api.v1_3_0.SortDirection.Asc,None,10))).asInstanceOf[Result.ActivityJobs].result
                assertEquals(jobs.total,1L)
                val located=invoke13(chronicle.api.v1_3_0.Operation.LocateMessage(selected.id,chronicle.api.v1_3_0.ContentView(view.revision,view.generationId),"u")).asInstanceOf[Result.LocatedMessage].result
                assertEquals(located.position,0); assertEquals(located.view,selected.view)
                val plan=invoke13(chronicle.api.v1_3_0.Operation.PreviewRetryFailed()).asInstanceOf[Result.RetryFailedPreview].result
                assertEquals(plan.counts.eligibleCurrentFailed,0L)
                val retryId=UUID.randomUUID()
                val retried=extra(chronicle.api.v1_3_0.Operation.ApplyRetryFailed(plan.targetProfile,plan.selectionHash,true),retryId).asInstanceOf[Result.RetryFailed].result
                assertEquals(retried.retried,0L); assertEquals(retried.requestId,retryId)
                assertEquals(invoke13(chronicle.api.v1_3_0.Operation.Receipt(retryId)),Result.RetryFailed(retried))
              }
              if(Set("1.4.0","1.5.0","1.6.0","1.7.0","1.8.0").contains(version)) {
                def invoke14(operation: v14.Operation): Result = {
                  val retained=v14.ClientEnvelope(UUID.randomUUID(),operation)
                  val encoded=if(version=="1.4.0") Wire.encode(v14.ClientEnvelope.codecJson,retained) else encode14(retained)
                  val response=raw(socket,inbox,encoded)
                  val current=if(version=="1.4.0") {
                    val decoded=Wire.decode(v14.ServerEnvelope.codecJson,response)
                    assertEquals(Wire.encode(v14.ServerEnvelope.codecJson,decoded),response)
                    up14(decoded)
                  } else if(version=="1.5.0") decode15(response) else if(version=="1.6.0") decode16(response) else if(version=="1.7.0") decode17(response) else Wire.decode(ServerEnvelope.codecJson,response)
                  assertEquals(current.requestId,retained.requestId)
                  current.result
                }
                val catalog=invoke14(v14.Operation.McpTestTools()).asInstanceOf[Result.McpTestTools].result
                assertEquals(catalog.maximumOutputTokens,65536); assertEquals(catalog.reasoningPolicy,"max")
                assert(invoke14(v14.Operation.ModelUsage()).isInstanceOf[Result.ModelUsage])
                assert(invoke14(v14.Operation.ExpressionHints(v14.ExpressionHintQuery(v14.ExpressionHintTarget.Archive(),"project:",8,10))).isInstanceOf[Result.ExpressionHints])
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
                val retainedView=v14.ContentView(selected.view.revision,selected.view.generationId)
                val passages=invoke14(v14.Operation.GetPassages(selected.id,retainedView,0,10))
                val spans=invoke14(v14.Operation.GetPassageSpans(selected.id,retainedView,passage.id,0,10))
                if(version=="1.7.0" || version=="1.8.0") {
                  assertEquals(passages,Result.Passages(PassagesResult(selected.view,PassageFormat.ContextAwareProblems,List(passage),1L,0)))
                  assertEquals(spans,Result.PassageSpans(PassageSpansResult(selected.view,passage.id,List(PassageSourceSpan(message.id,0,0,end)),1L,0)))
                } else {
                  assertEquals(passages.asInstanceOf[Result.Error].failure.code,"unavailable")
                  assertEquals(spans.asInstanceOf[Result.Error].failure.code,"unavailable")
                }
                assertEquals(invoke14(v14.Operation.Ping("after-passage-read")),Result.Pong("after-passage-read"))
              }
            } finally socket.abort()
          }
          if(selectedVersion=="1.0.0") {
          val (legacy,legacyInbox)=connection()
          def oldCall(operation: old.Operation): old.Result = {
            val envelope=old.ClientEnvelope(UUID.randomUUID(),operation)
            val response=raw(legacy,legacyInbox,Wire.encode(old.ClientEnvelope.codecJson,envelope))
            val decoded=Wire.decode(old.ServerEnvelope.codecJson,response)
            assertEquals(Wire.encode(old.ServerEnvelope.codecJson,decoded),response,"legacy wire must be produced by its codec, not latest JSON with extra fields")
            decoded.result
          }
          try {
            val hello=oldCall(old.Operation.Hello(List("1.0.0"))).asInstanceOf[old.Result.Hello]
            assertEquals(hello.versions.current,"1.8.0"); assertEquals(hello.versions.minimum,"1.0.0")
            val oldFilter=old.SearchFilter(None,None,None,None,Nil)
            val pages=(0 until corpusSize by pageSize).map { offset =>
              val result=oldCall(old.Operation.Search(old.SearchQuery("archive",old.SearchMode.Semantic,oldFilter,pageSize,offset))).asInstanceOf[old.Result.Search].result
              assertEquals(result.total,corpusSize); result.hits.map(_.session.id)
            }
            assertEquals(pages.flatten.size,corpusSize); assertEquals(pages.flatten.distinct.size,corpusSize)
            assertEquals(oldCall(old.Operation.Whoami()).asInstanceOf[old.Result.Whoami].user.id,"a")
          } finally legacy.abort()
          val (latest,latestInbox)=connection()
          def currentCall(operation: Operation): Result = Wire.decode(ServerEnvelope.codecJson,raw(latest,latestInbox,Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),operation)))).result
          try {
            assert(currentCall(Operation.Hello(List("1.8.0"))).isInstanceOf[Result.Hello])
            val q=SearchQuery("archive",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),pageSize,0)
            val bounded=currentCall(Operation.Search(q)).asInstanceOf[Result.Search].result
            assertEquals(bounded.countScope,SearchCountScope.CandidateWindow); assertEquals(bounded.rankingLimit,Some(SearchPolicy.candidatesPerLeg)); assert(bounded.total>=bounded.hits.size && bounded.total<=SearchPolicy.candidatesPerLeg); assertEquals(bounded.hits.size,pageSize)
            assertEquals(currentCall(Operation.Search(q.copy(offset=SearchPolicy.candidatesPerLeg))).asInstanceOf[Result.Error].failure.code,"invalid")
            val lexical=currentCall(Operation.Search(q.copy(mode=SearchMode.Lexical))).asInstanceOf[Result.Search].result
            assertEquals(lexical.total,corpusSize); assertEquals(lexical.countScope,SearchCountScope.ExactMatches); assertEquals(lexical.rankingLimit,None)
          } finally latest.abort()
          }
        } finally client.close()
      }}
    }}.unsafeRunSync()
  }
  }
}
