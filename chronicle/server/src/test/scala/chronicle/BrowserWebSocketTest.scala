package chronicle

import cats.effect.{IO,Resource,Deferred,Ref}
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import chronicle.api.*
import com.comcast.ip4s.*
import io.circe.Json
import java.net.URI
import java.net.http.{HttpClient as JClient,WebSocket}
import java.util.UUID
import java.util.concurrent.{CompletableFuture,CompletionStage,LinkedBlockingQueue,TimeUnit}
import org.http4s.{Message as _,Http as _,*}
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.implicits.*
import scala.concurrent.duration.*
import scala.util.Using

class BrowserWebSocketTest extends munit.FunSuite {
  override val munitTimeout=90.seconds

  private final class Socket(val ws: WebSocket,val inbox: LinkedBlockingQueue[String],val closed: CompletableFuture[Int],val maximumFrameBytes: java.util.concurrent.atomic.AtomicLong) {
    def send(operation: Operation,id: UUID): IO[Unit] = IO.blocking {
      ws.sendText(Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(id,operation)).noSpaces,true).get(5,TimeUnit.SECONDS); ()
    }
    def receive: IO[ServerEnvelope] = IO.blocking {
      val text=inbox.poll(5,TimeUnit.SECONDS)
      assert(text!=null,"missing WebSocket response")
      Wire.decode(ServerEnvelope.codecJson,Wire.parse(text))
    }
    def request(operation: Operation): IO[Result] = IO(UUID.randomUUID()).flatMap(id => send(operation,id) *> receive.map { result => assertEquals(result.requestId,id); result.result })
  }
  private def socket(url: String,config: Config,secret: String): Resource[IO,Socket] = for {
    client <- Resource.make(IO(JClient.newHttpClient()))(c => IO.blocking(c.close()))
    connection <- Resource.make(IO.blocking {
      val inbox=new LinkedBlockingQueue[String]()
      val closed=new CompletableFuture[Int]()
      val maximumFrameBytes=new java.util.concurrent.atomic.AtomicLong(0L)
      val listener=new WebSocket.Listener {
        private val text=new java.lang.StringBuilder()
        override def onOpen(ws: WebSocket): Unit=ws.request(1)
        override def onText(ws: WebSocket,part: CharSequence,last: Boolean): CompletionStage[?] = {
          text.append(part)
          if(last) {
            val raw=text.toString; text.setLength(0)
            maximumFrameBytes.accumulateAndGet(raw.getBytes(java.nio.charset.StandardCharsets.UTF_8).length.toLong,(a,b) => a.max(b))
            val envelope=Wire.decode(ServerEnvelope.codecJson,Wire.parse(raw))
            envelope.result match {
              case Result.Ping(nonce) => ws.sendText(Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(envelope.requestId,Operation.Pong(nonce))).noSpaces,true)
              case _ => inbox.offer(raw)
            }
          }
          ws.request(1); CompletableFuture.completedFuture(null)
        }
        override def onClose(ws: WebSocket,code: Int,reason: String): CompletionStage[?] = { closed.complete(code); CompletableFuture.completedFuture(null) }
      }
      val ws=client.newWebSocketBuilder().header("Origin",config.allowedOrigin).header("Cookie",s"chronicle_session=$secret")
        .buildAsync(URI.create(url),listener).get(5,TimeUnit.SECONDS)
      new Socket(ws,inbox,closed,maximumFrameBytes)
    })(s => IO(s.ws.abort()))
  } yield connection

  private final case class Fixture(config: Config,db: Database,auth: Auth,app: Application,archive: PostgresArchive,protocol: VersionedWire,wire: McpTestWire,runs: McpTestRuns)
  private def fixture(embedder: Embedder,model: McpTestModel,tools: McpRunTools,wrap: RunAuthorization => RunAuthorization): Resource[IO,Fixture] = for {
    config <- Resource.eval(IO(Fixtures.config()))
    db <- Resource.eval(IO.blocking {
      Check(sys.env.contains("CHRONICLE_TEST_JDBC"),"test","PostgreSQL required; use the isolated fixture runner")
      val db=new Database(config,IndexProfileCatalog.legacyOnly(config))
      db.initialize()
      db.transaction { c =>
        val stream=getClass.getResourceAsStream("/009_transient_security_epoch.sql")
        Check(stream!=null,"test","security migration missing")
        Using.resource(c.createStatement())(_.execute(Using.resource(scala.io.Source.fromInputStream(stream))(_.mkString)))
        Sql.exec(c,"TRUNCATE ch_sources,ch_sessions,ch_groups,ch_tokens,ch_mutations,ch_collector_progress CASCADE")
        Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
        Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
      }
      db
    })
    auth=new Auth(db,config)
    archive=new PostgresArchive(db,config)
    app=new Application(archive,new PostgresSearch(db,archive,config),embedder,auth,db,new CollectorProgress(new PostgresCollectorProgressStore(db),java.time.Clock.systemUTC()),new PostgresArchiveIndex(db,archive,config),new PostgresActivity(db,java.time.Clock.systemUTC()),new PostgresExpressionHintIndex(db,archive,java.time.Clock.systemUTC()),ModelFixtures.usage(config))
    protocol=new VersionedWire(new chronicle.protocol.ProtocolConversions)
    wire=new McpTestWire(protocol)
    runs <- McpTestRuns.resource(tools,model,wrap(new PostgresRunAuthorization(db,auth)),new SystemMcpRunClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO]),config.users.map(_.id).toSet,wire,IO(UUID.randomUUID()))
  } yield Fixture(config,db,auth,app,archive,protocol,wire,runs)

  private def server(fixture: Fixture): Resource[IO,String] = for {
    gate <- Resource.eval(Semaphore[IO](2))
    controls <- BrowserControlAdmission.resource
    rpc=new BrowserRpc(fixture.app,fixture.runs,fixture.wire)
    http=new Http(fixture.config,fixture.auth,fixture.app,fixture.archive,new Mcp(fixture.app),logstage.IzLogger(),Http.WebRoot(None),fixture.protocol,rpc,controls)
    server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => http.routes(ws,gate).orNotFound).build
  } yield s"ws://127.0.0.1:${server.address.getPort}/api/ws"

  private val immediateEmbedder: Embedder = new Embedder {
    def query(owner: String,text: String): IO[List[Double]] = IO.pure(List(1.0,0.0,0.0))
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
  }

  test("BG GoodCommunication regression: Logout bypasses a blocked serialized semantic search") {
    (for {
      entered <- Deferred[IO,Unit]
      release <- Deferred[IO,Unit]
      embedder=new Embedder {
        def query(owner: String,text: String): IO[List[Double]] = entered.complete(()).void *> release.get.as(List(1.0,0.0,0.0))
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = immediateEmbedder.documents(owner,text)
      }
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("not used")))
      _ <- fixture(embedder,model,tools,identity).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret => socket(url,f.config,secret).use { socket =>
          (for {
            hello <- socket.request(Operation.Hello(List("1.4.0")))
            _ <- IO(assert(hello.isInstanceOf[Result.Hello]))
            _ <- socket.send(Operation.Search(SearchQuery("blocked",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),1,0)),UUID.randomUUID())
            _ <- entered.get.timeout(2.seconds)
            id <- IO(UUID.randomUUID())
            _ <- socket.send(Operation.Logout(),id)
            reply <- socket.receive.handleErrorWith(_ => IO.raiseError(new AssertionError("Logout response missing while semantic query is confirmed blocked"))).timeout(1.second)
            _ <- IO { assertEquals(reply.requestId,id); assert(reply.result.isInstanceOf[Result.Mutation]) }
          } yield ()).guarantee(release.complete(()).void)
        }}
      }}
    } yield ()).unsafeRunSync()
  }

  private def runSnapshot(socket: Socket,instance: UUID,run: UUID): IO[McpTestSnapshot] =
    socket.request(Operation.ReadMcpTest(instance,run,0L,256)).flatMap {
      case Result.McpTestRun(snapshot) => IO.pure(snapshot)
      case Result.Error(failure) if failure.code=="mcp-run-changed" => IO.sleep(2.millis) *> runSnapshot(socket,instance,run)
      case _ => IO.raiseError(new AssertionError("expected MCP snapshot"))
    }
  private def complete(socket: Socket,instance: UUID,run: UUID): IO[McpTestSnapshot] =
    McpTestFixtures.await(runSnapshot(socket,instance,run))(snapshot => snapshot.state!=McpTestState.Queued && snapshot.state!=McpTestState.Running)

  test("BG GoodCommunication: actual API1.4 MCP search, found-ID followup, complete scalar parts, fresh next run and unknown uncertainty") {
    val text="\"\\\n🙂"*7000
    (for {
      tools <- McpTestFixtures.tools { (access,name,args,admission) => access.fresh *> IO {
        admission.consume(32L)
        if(name=="search") Json.obj("sessionId"->Json.fromString("found-id"))
        else { Check(args.hcursor.get[String]("sessionId").toOption.contains("found-id"),"invalid","found ID required"); Json.obj("text"->Json.fromString(text)) }
      }}
      model <- McpTestFixtures.model { request => IO.pure {
        val messages=request.hcursor.get[Vector[Json]]("messages").toOption.get
        val results=messages.filter(_.hcursor.get[String]("role").toOption.contains("tool"))
        if(results.isEmpty) McpTestFixtures.toolReply(List(("search","search",Json.obj())),Some("hidden-provider-reasoning"))
        else if(results.size==1) {
          val id=Wire.parse(results.head.hcursor.get[String]("content").toOption.get).hcursor.get[String]("sessionId").toOption.get
          McpTestFixtures.toolReply(List(("read","read",Json.obj("sessionId"->Json.fromString(id)))),Some("hidden-followup"))
        } else McpTestFixtures.finalReply(text)
      }}
      _ <- fixture(immediateEmbedder,model,tools,identity).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret => socket(url,f.config,secret).use { socket =>
          for {
            _ <- socket.request(Operation.Hello(List("1.4.0")))
            catalogResult <- socket.request(Operation.McpTestTools())
            catalog= catalogResult.asInstanceOf[Result.McpTestTools].result
            _ <- IO {
              assertEquals(catalog.tools.map(_.name),tools.definitions.map(_.name))
              assertEquals(catalog.tools.map(_.inputSchemaJson),tools.definitions.map(_.inputSchemaJson.noSpaces))
              assertEquals(catalog.maximumOutputTokens,65536)
              assertEquals(catalog.reasoningPolicy,"max")
            }
            id <- IO(UUID.randomUUID())
            _ <- socket.request(Operation.StartMcpTest(catalog.instanceId,id,"synthetic user request"))
            finished <- complete(socket,catalog.instanceId,id)
            _ <- IO(assertEquals(finished.state,McpTestState.Complete))
            events <- {
              def pages(after: Long,all: List[McpTestEvent]): IO[List[McpTestEvent]] = socket.request(Operation.ReadMcpTest(catalog.instanceId,id,after,2)).flatMap {
                case Result.McpTestRun(page) =>
                  if(page.hasMore) { assert(page.events.nonEmpty); pages(page.events.last.sequence,all++page.events) }
                  else IO.pure(all++page.events)
                case _ => IO.raiseError(new AssertionError("page expected"))
              }
              pages(0L,Nil)
            }
            _ <- IO {
              val parts=events.collect { case McpTestEvent(_,_,McpTestItem.Response(index,count,part)) => (index,count,part) }
              assertEquals(parts.map(_._1),parts.indices.toList)
              assert(parts.forall(_._2==parts.size))
              assertEquals(parts.map(_._3).mkString,text)
              val returned=events.collect { case McpTestEvent(_,_,McpTestItem.ToolResult("read",_,_,part)) => part }.mkString
              assertEquals(Wire.parse(returned),Json.obj("text"->Json.fromString(text)))
              assertEquals(events.map(_.sequence),events.indices.map(_.toLong+1).toList)
              assert(!Wire.encode(McpTestSnapshot.codecJson,finished).noSpaces.contains("hidden-provider-reasoning"))
              assert(socket.maximumFrameBytes.get()<=McpRunLimits.pageBytes)
            }
            second <- IO(UUID.randomUUID())
            _ <- socket.request(Operation.StartMcpTest(catalog.instanceId,second,"fresh request"))
            _ <- complete(socket,catalog.instanceId,second)
            requests <- model.requests.get
            _ <- IO { assertEquals(requests.size,6); assertEquals(requests(3).hcursor.get[Vector[Json]]("messages").toOption.get.size,2); assert(!requests(3).noSpaces.contains("synthetic user request")) }
            unknown <- socket.request(Operation.ReadMcpTest(catalog.instanceId,UUID.randomUUID(),0L,1))
            _ <- IO(assertEquals(unknown.asInstanceOf[Result.Error].failure.code,"mcp-run-uncertain"))
            duplicate <- socket.request(Operation.StartMcpTest(catalog.instanceId,id,"synthetic user request"))
            conflict <- socket.request(Operation.StartMcpTest(catalog.instanceId,id,"changed payload"))
            uncertain <- socket.request(Operation.StartMcpTest(UUID.randomUUID(),UUID.randomUUID(),"unknown instance"))
            count <- model.requests.get
            _ <- IO {
              assertEquals(duplicate.asInstanceOf[Result.McpTestRun].result.state,McpTestState.Complete)
              assertEquals(conflict.asInstanceOf[Result.Error].failure.code,"conflict")
              assertEquals(uncertain.asInstanceOf[Result.Error].failure.code,"mcp-run-uncertain")
              assertEquals(count.size,6)
            }
          } yield ()
        }}
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG GoodCommunication: Start Read and Cancel bypass a blocked serialized search") {
    (for {
      entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.never)
      embedder=new Embedder {
        def query(owner: String,text: String): IO[List[Double]] = entered.complete(()).void *> release.get.as(List(1.0,0.0,0.0))
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = immediateEmbedder.documents(owner,text)
      }
      _ <- fixture(embedder,model,tools,identity).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret => socket(url,f.config,secret).use { socket =>
          (for {
            _ <- socket.request(Operation.Hello(List("1.4.0")))
            catalog <- socket.request(Operation.McpTestTools()).map(_.asInstanceOf[Result.McpTestTools].result)
            _ <- socket.send(Operation.Search(SearchQuery("blocked",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),1,0)),UUID.randomUUID())
            _ <- entered.get
            id <- IO(UUID.randomUUID())
            started <- IO.monotonic
            first <- socket.request(Operation.StartMcpTest(catalog.instanceId,id,"one-shot"))
            second <- socket.request(Operation.ReadMcpTest(catalog.instanceId,id,0L,1))
            third <- socket.request(Operation.CancelMcpTest(catalog.instanceId,id))
            ended <- IO.monotonic
            _ <- IO {
              assert(first.isInstanceOf[Result.McpTestRun]); assert(second.isInstanceOf[Result.McpTestRun])
              assertEquals(third.asInstanceOf[Result.McpTestRun].result.state,McpTestState.Cancelled)
              assert(ended-started<2.seconds,"short controls waited for blocked search")
            }
          } yield ()).guarantee(release.complete(()).void)
        }}
      }}
    } yield ()).unsafeRunSync()
  }

  private final case class VerificationGate(entered: Deferred[IO,Unit],release: Deferred[IO,Unit])
  private def gatedAuthorization(next: Ref[IO,Option[VerificationGate]])(delegate: RunAuthorization): RunAuthorization = new RunAuthorization {
    def capture(identity: Identity): IO[RunAuthority] = delegate.capture(identity)
    def verify(authority: RunAuthority): IO[Identity] = next.getAndSet(None).flatMap(_.traverse_(gate => gate.entered.complete(()).void *> gate.release.get)) *> delegate.verify(authority)
  }

  test("BG GoodCommunication: queued handles reauthorize after sharing epoch change instead of delivering captured traces") {
    (for {
      gate <- Ref.of[IO,Option[VerificationGate]](None)
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("private synthetic trace marker")))
      _ <- fixture(immediateEmbedder,model,tools,gatedAuthorization(gate)).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret => socket(url,f.config,secret).use { socket =>
          for {
            _ <- socket.request(Operation.Hello(List("1.4.0")))
            catalog <- socket.request(Operation.McpTestTools()).map(_.asInstanceOf[Result.McpTestTools].result)
            id <- IO(UUID.randomUUID())
            _ <- socket.request(Operation.StartMcpTest(catalog.instanceId,id,"private synthetic prompt"))
            _ <- complete(socket,catalog.instanceId,id)
            entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
            _ <- gate.set(Some(VerificationGate(entered,release)))
            first <- IO(UUID.randomUUID()); second <- IO(UUID.randomUUID())
            _ <- socket.send(Operation.ReadMcpTest(catalog.instanceId,id,0L,256),first)
            _ <- entered.get
            _ <- socket.send(Operation.ReadMcpTest(catalog.instanceId,id,0L,256),second)
            _ <- IO.blocking(f.db.transaction { c =>
              val group=UUID.randomUUID()
              Sql.exec(c,"INSERT INTO ch_groups VALUES(?,?,?)",group,"a","synthetic epoch change")
              Sql.exec(c,"INSERT INTO ch_members VALUES(?,?)",group,"a")
              Sql.exec(c,"DELETE FROM ch_members WHERE group_id=?",group)
            })
            _ <- release.complete(())
            one <- socket.receive; two <- socket.receive
            _ <- IO {
              assertEquals(Set(one.requestId,two.requestId),Set(first,second))
              List(one,two).foreach { reply =>
                assertEquals(reply.result.asInstanceOf[Result.Error].failure.code,"authorization-changed")
                assert(!Wire.encode(ServerEnvelope.codecJson,reply).noSpaces.contains("private synthetic trace marker"))
              }
            }
          } yield ()
        }}
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG GoodCommunication: queued cancellation erases pending reads at outgoing pull") {
    (for {
      gate <- Ref.of[IO,Option[VerificationGate]](None)
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("must not reach queued reads")))
      _ <- fixture(immediateEmbedder,model,tools,gatedAuthorization(gate)).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret => socket(url,f.config,secret).use { socket =>
          for {
            _ <- socket.request(Operation.Hello(List("1.4.0")))
            catalog <- socket.request(Operation.McpTestTools()).map(_.asInstanceOf[Result.McpTestTools].result)
            id <- IO(UUID.randomUUID())
            _ <- socket.request(Operation.StartMcpTest(catalog.instanceId,id,"cancel queued"))
            _ <- complete(socket,catalog.instanceId,id)
            entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
            _ <- gate.set(Some(VerificationGate(entered,release)))
            reads <- IO(List.fill(2)(UUID.randomUUID()))
            cancelled <- IO(UUID.randomUUID())
            _ <- socket.send(Operation.ReadMcpTest(catalog.instanceId,id,0L,256),reads.head)
            _ <- entered.get
            _ <- socket.send(Operation.ReadMcpTest(catalog.instanceId,id,0L,256),reads(1))
            _ <- socket.send(Operation.CancelMcpTest(catalog.instanceId,id),cancelled)
            identity <- IO.blocking(f.auth.browser(secret))
            _ <- McpTestFixtures.await(f.runs.read(identity,catalog.instanceId,id,0L,1).attempt.flatMap {
              case Left(error: DomainError) if error.code=="mcp-run-changed" => IO.pure(Left(error))
              case Left(error) => IO.raiseError(error)
              case Right(snapshot) => IO.pure(Right(snapshot))
            })(_.exists(_.state==McpRunState.Cancelled))
            _ <- release.complete(())
            replies <- List.fill(3)(socket.receive).sequence
            _ <- IO {
              assertEquals(replies.map(_.requestId).toSet,reads.toSet+cancelled)
              assert(replies.forall(reply => !Wire.encode(ServerEnvelope.codecJson,reply).noSpaces.contains("must not reach queued reads")))
              assert(replies.exists { reply => reply.result match { case Result.McpTestRun(run) => run.state==McpTestState.Cancelled && run.events.isEmpty; case _ => false } })
            }
          } yield ()
        }}
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG GoodCommunication: pre-Hello and old-version new controls fail without any model execution") {
    (for {
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("must not run")))
      _ <- fixture(immediateEmbedder,model,tools,identity).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret =>
          List(None,Some("1.0.0"),Some("1.1.0"),Some("1.2.0"),Some("1.3.0")).traverse_ { version => socket(url,f.config,secret).use { socket =>
            for {
              _ <- version.traverse_(value => socket.request(Operation.Hello(List(value))))
              _ <- socket.send(Operation.McpTestTools(),UUID.randomUUID())
              failure <- socket.receive
              _ <- IO(assertEquals(failure.result.asInstanceOf[Result.Error].failure.code,"protocol-error"))
              closed <- IO.blocking(socket.closed.get(5,TimeUnit.SECONDS))
              _ <- IO(assertEquals(closed,4400))
            } yield ()
          }}
        }
      }}
      requests <- model.requests.get
      _ <- IO(assertEquals(requests.size,0))
    } yield ()).unsafeRunSync()
  }


  test("BG GoodCommunication: queued handles never disclose a terminal trace after cookie revoke expiry or principal reassignment") {
    List("revoke","expire","reassign").foreach { mode =>
      (for {
        gate <- Ref.of[IO,Option[VerificationGate]](None)
        tools <- McpTestFixtures.ordinaryTools
        model <- McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("revoked queued trace marker")))
        _ <- fixture(immediateEmbedder,model,tools,gatedAuthorization(gate)).use { f => server(f).use { url =>
          IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret => socket(url,f.config,secret).use { socket =>
            for {
              _ <- socket.request(Operation.Hello(List("1.4.0")))
              catalog <- socket.request(Operation.McpTestTools()).map(_.asInstanceOf[Result.McpTestTools].result)
              id <- IO(UUID.randomUUID())
              _ <- socket.request(Operation.StartMcpTest(catalog.instanceId,id,"private queued"))
              _ <- complete(socket,catalog.instanceId,id)
              entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
              _ <- gate.set(Some(VerificationGate(entered,release)))
              _ <- socket.send(Operation.ReadMcpTest(catalog.instanceId,id,0L,256),UUID.randomUUID())
              _ <- entered.get
              _ <- socket.send(Operation.ReadMcpTest(catalog.instanceId,id,0L,256),UUID.randomUUID())
              _ <- IO.blocking(f.db.transaction { c => mode match {
                case "revoke" => Sql.exec(c,"DELETE FROM ch_sessions WHERE hash=?",Wire.hash(secret))
                case "expire" => Sql.exec(c,"UPDATE ch_sessions SET expires=clock_timestamp()-interval '1 second' WHERE hash=?",Wire.hash(secret))
                case "reassign" => Sql.exec(c,"UPDATE ch_sessions SET owner='b' WHERE hash=?",Wire.hash(secret))
              }})
              _ <- release.complete(())
              reply <- socket.receive
              _ <- IO {
                assert(!Wire.encode(ServerEnvelope.codecJson,reply).noSpaces.contains("revoked queued trace marker"))
                assertEquals(reply.result.asInstanceOf[Result.Error].failure.code,"unauthorized")
              }
              closed <- IO.blocking(socket.closed.get(5,TimeUnit.SECONDS))
              _ <- IO(assertEquals(closed,4401))
            } yield ()
          }}
        }}
      } yield ()).unsafeRunSync()
    }
  }

  private final case class CaptureCounts(active: Int,byCredential: Map[String,Int],maximum: Int,maximumForCredential: Int)

  test("BG GoodCommunication: control flooding is bounded by two workers per socket and four permits process-wide") {
    (for {
      release <- Deferred[IO,Unit]
      block <- Ref.of[IO,Boolean](false)
      counts <- Ref.of[IO,CaptureCounts](CaptureCounts(0,Map.empty,0,0))
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.never)
      wrap=(delegate: RunAuthorization) => new RunAuthorization {
        def verify(authority: RunAuthority): IO[Identity] = delegate.verify(authority)
        def capture(identity: Identity): IO[RunAuthority] = block.get.flatMap { blocked =>
          if(!blocked) delegate.capture(identity)
          else Resource.make(counts.update { c =>
            val per=c.byCredential.getOrElse(identity.credentialHash,0)+1
            c.copy(active=c.active+1,byCredential=c.byCredential.updated(identity.credentialHash,per),maximum=c.maximum.max(c.active+1),maximumForCredential=c.maximumForCredential.max(per))
          })(_ => counts.update(c => c.copy(active=c.active-1,byCredential=c.byCredential.updated(identity.credentialHash,c.byCredential(identity.credentialHash)-1))))
            .use(_ => release.get *> delegate.capture(identity))
        }
      }
      _ <- fixture(immediateEmbedder,model,tools,wrap).use { f => server(f).use { url =>
        List.fill(3)(Resource.eval(IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2)).flatMap(secret => socket(url,f.config,secret))).sequence.use { sockets =>
          (for {
            catalogs <- sockets.traverse(socket => socket.request(Operation.Hello(List("1.4.0"))) *> socket.request(Operation.McpTestTools()).map(_.asInstanceOf[Result.McpTestTools].result))
            _ <- block.set(true)
            _ <- sockets.zip(catalogs).traverse_ { case (socket,catalog) =>
              List.fill(16)(UUID.randomUUID()).traverse_(run => socket.send(Operation.StartMcpTest(catalog.instanceId,run,"bounded flooded start"),UUID.randomUUID()))
            }
            saturated <- McpTestFixtures.await(counts.get)(_.active==BrowserControlAdmission.maximumConcurrent)
            _ <- IO { assertEquals(saturated.maximum,4); assertEquals(saturated.maximumForCredential,2) }
            rejection <- sockets.head.receive
            _ <- IO(assertEquals(rejection.result.asInstanceOf[Result.Error].failure.code,"unavailable"))
            before <- model.requests.get
            _ <- IO(assertEquals(before.size,0))
            _ <- release.complete(())
            _ <- McpTestFixtures.await(model.requests.get)(_.size==1)
            after <- counts.get
            _ <- IO { assertEquals(after.maximum,4); assertEquals(after.maximumForCredential,2) }
          } yield ()).guarantee(release.complete(()).void)
        }
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG GoodCommunication: disconnect during delayed Start cannot register on a dead socket lease") {
    (for {
      hold <- Ref.of[IO,Boolean](false)
      entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]; cancelled <- Deferred[IO,Unit]
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("must not execute")))
      wrap=(delegate: RunAuthorization) => new RunAuthorization {
        def verify(authority: RunAuthority): IO[Identity] = delegate.verify(authority)
        def capture(identity: Identity): IO[RunAuthority] = hold.get.flatMap { value =>
          if(value) (entered.complete(()).void *> release.get *> delegate.capture(identity)).onCancel(cancelled.complete(()).void)
          else delegate.capture(identity)
        }
      }
      _ <- fixture(immediateEmbedder,model,tools,wrap).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret =>
          for {
            origin <- socket(url,f.config,secret).allocated
            _ <- origin._1.request(Operation.Hello(List("1.4.0")))
            catalog <- origin._1.request(Operation.McpTestTools()).map(_.asInstanceOf[Result.McpTestTools].result)
            id <- IO(UUID.randomUUID())
            _ <- hold.set(true)
            _ <- origin._1.send(Operation.StartMcpTest(catalog.instanceId,id,"disconnected start"),UUID.randomUUID())
            _ <- entered.get
            _ <- origin._2
            _ <- cancelled.get.timeout(2.seconds)
            _ <- hold.set(false); _ <- release.complete(())
            _ <- IO.sleep(100.millis)
            _ <- socket(url,f.config,secret).use { reconnected =>
              reconnected.request(Operation.Hello(List("1.4.0"))) *> reconnected.request(Operation.ReadMcpTest(catalog.instanceId,id,0L,1)).flatMap { reply =>
                IO(assertEquals(reply.asInstanceOf[Result.Error].failure.code,"mcp-run-uncertain"))
              }
            }
            requests <- model.requests.get
            _ <- IO(assertEquals(requests.size,0))
          } yield ()
        }
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG GoodCommunication: refused and malformed upgrades do not allocate transient connection leases") {
    (for {
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("unused")))
      _ <- fixture(immediateEmbedder,model,tools,identity).use { f => server(f).use { url =>
        EmberClientBuilder.default[IO].build.use { client =>
          for {
            secret <- IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2)
            _ <- (1 to 20).toList.traverse_ { index =>
              val base=Request[IO](Method.GET,Uri.unsafeFromString(url.replace("ws://","http://"))).putHeaders(Header.Raw(org.typelevel.ci.CIString("Origin"),f.config.allowedOrigin),Header.Raw(org.typelevel.ci.CIString("Cookie"),s"chronicle_session=$secret"))
              val request=if(index%2==0) base.putHeaders(Header.Raw(org.typelevel.ci.CIString("Upgrade"),"websocket"),Header.Raw(org.typelevel.ci.CIString("Connection"),"Upgrade")) else base
              client.run(request).use(response => IO(assertNotEquals(response.status,Status.SwitchingProtocols)))
            }
            _ <- List.fill(McpRunLimits.maximumConnections)(UUID.randomUUID()).traverse(f.runs.connection).use(_ => IO.unit)
            requests <- model.requests.get
            _ <- IO(assertEquals(requests.size,0))
          } yield ()
        }
      }}
    } yield ()).unsafeRunSync()
  }


  test("BG GoodCommunication: disconnect erases only originating runs and another same-cookie tab can inspect metadata") {
    (for {
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.never)
      _ <- fixture(immediateEmbedder,model,tools,identity).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret => socket(url,f.config,secret).use { other =>
          for {
            _ <- other.request(Operation.Hello(List("1.4.0")))
            catalog <- other.request(Operation.McpTestTools()).map(_.asInstanceOf[Result.McpTestTools].result)
            origin <- socket(url,f.config,secret).allocated
            _ <- origin._1.request(Operation.Hello(List("1.4.0")))
            id <- IO(UUID.randomUUID())
            _ <- origin._1.request(Operation.StartMcpTest(catalog.instanceId,id,"origin run"))
            _ <- origin._2
            cancelled <- McpTestFixtures.await(runSnapshot(other,catalog.instanceId,id))(_.state==McpTestState.Cancelled)
            _ <- IO(assertEquals(cancelled.events,Nil))
            next <- IO(UUID.randomUUID())
            _ <- other.request(Operation.StartMcpTest(catalog.instanceId,next,"other tab run"))
            _ <- socket(url,f.config,secret).use(unrelated => unrelated.request(Operation.Hello(List("1.4.0"))).void)
            stillActive <- runSnapshot(other,catalog.instanceId,next)
            _ <- IO(assert(stillActive.state==McpTestState.Running || stillActive.state==McpTestState.Queued))
            _ <- other.request(Operation.CancelMcpTest(catalog.instanceId,next))
          } yield ()
        }}
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG GoodCommunication: oversized live catalog fails explicitly without dropping tools or raising the48KiB cap") {
    (for {
      calls <- Ref.of[IO,Int](0)
      tools=new McpRunTools {
        def definitions: List[McpRunToolDefinition] = List(McpRunToolDefinition("provided_large_tool","\u0085"*10000,McpTestFixtures.schema,true))
        def invoke(access: McpRunAccess,name: String,args: Json,admission: ReadAdmission): IO[Json] = calls.update(_+1).as(Json.obj())
      }
      model <- McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("must not run")))
      _ <- fixture(immediateEmbedder,model,tools,identity).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret => socket(url,f.config,secret).use { socket =>
          for {
            _ <- socket.request(Operation.Hello(List("1.4.0")))
            result <- socket.request(Operation.McpTestTools())
            _ <- IO(assertEquals(result.asInstanceOf[Result.Error].failure.code,"mcp-catalog-limit"))
            pong <- socket.request(Operation.Ping("catalog-still-bounded"))
            _ <- IO(assertEquals(pong,Result.Pong("catalog-still-bounded")))
            identity <- IO.blocking(f.auth.browser(secret))
            domain <- f.runs.catalog(identity)
            _ <- IO { assertEquals(domain.tools,tools.definitions); assert(socket.maximumFrameBytes.get()<=McpRunLimits.pageBytes) }
          } yield ()
        }}
      }}
      requests <- model.requests.get; invocations <- calls.get
      _ <- IO { assertEquals(requests.size,0); assertEquals(invocations,0) }
    } yield ()).unsafeRunSync()
  }

  test("BG GoodCommunication: original mutation receipts survive control-priority Logout") {
    (for {
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.pure(McpTestFixtures.finalReply("unused")))
      _ <- fixture(immediateEmbedder,model,tools,identity).use { f => server(f).use { url =>
        for {
          secret <- IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2)
          mutation <- IO(UUID.randomUUID())
          original <- socket(url,f.config,secret).use { socket =>
            socket.request(Operation.Hello(List("1.4.0"))) *> socket.send(Operation.Logout(),mutation) *> socket.receive
          }
          replacement <- IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2)
          _ <- socket(url,f.config,replacement).use { socket =>
            for {
              _ <- socket.request(Operation.Hello(List("1.4.0")))
              receipt <- socket.request(Operation.Receipt(mutation))
              _ <- IO { assertEquals(original.requestId,mutation); assertEquals(receipt,original.result) }
            } yield ()
          }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }


  test("BG GoodCommunication regression: disconnect erases run before a blocked JDBC ordinary operation can unwind") {
    (for {
      tools <- McpTestFixtures.ordinaryTools
      model <- McpTestFixtures.model(_ => IO.never)
      _ <- fixture(immediateEmbedder,model,tools,identity).use { f => server(f).use { url =>
        IO.blocking(f.auth.login(LoginRequest("a","synthetic"))._2).flatMap { secret => socket(url,f.config,secret).use { observer =>
          for {
            _ <- observer.request(Operation.Hello(List("1.4.0")))
            source <- IO.blocking(f.archive.ingest("a",Fixtures.snapshot()))
            catalog <- observer.request(Operation.McpTestTools()).map(_.asInstanceOf[Result.McpTestTools].result)
            origin <- socket(url,f.config,secret).allocated
            _ <- origin._1.request(Operation.Hello(List("1.4.0")))
            id <- IO(UUID.randomUUID())
            _ <- origin._1.request(Operation.StartMcpTest(catalog.instanceId,id,"run during blocked SQL"))
            _ <- McpTestFixtures.await(model.requests.get)(_.nonEmpty)
            _ <- Resource.make(IO.blocking(java.sql.DriverManager.getConnection(f.config.jdbcUrl,f.config.databaseUser,Config.credential(f.config.databasePasswordFile))))
              (c => IO.blocking { try c.rollback() finally c.close() }).evalTap { c => IO.blocking {
                c.setAutoCommit(false)
                Using.resource(c.createStatement())(_.execute("SET LOCAL lock_timeout='5s'"))
                Using.resource(c.createStatement())(_.execute("LOCK TABLE ch_sources IN ACCESS EXCLUSIVE MODE"))
              }}.use { _ =>
              for {
                _ <- origin._1.send(Operation.GetSession(source.sessionId,None),UUID.randomUUID())
                _ <- McpTestFixtures.await(IO.blocking(f.db.transaction(c => Sql.one(c,"SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%ch_sources%' AND application_name<>'autovacuum' ")(_.getLong(1)).get)))(_>0L)
                _ <- IO(origin._1.ws.abort())
                erased <- McpTestFixtures.await(runSnapshot(observer,catalog.instanceId,id))(_.state==McpTestState.Cancelled)
                  .timeoutTo(2.seconds,IO.raiseError(new AssertionError("run did not become Cancelled after disconnect while ordinary JDBC remained locked")))
                _ <- IO { assertEquals(erased.events,Nil); assertEquals(erased.state,McpTestState.Cancelled) }
              } yield ()
            }.guarantee(origin._2)
          } yield ()
        }}
      }}
    } yield ()).unsafeRunSync()
  }

}
