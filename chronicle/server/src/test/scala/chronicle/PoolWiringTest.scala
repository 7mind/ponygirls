package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import com.comcast.ip4s.{Host,Port}
import distage.*
import org.http4s.{Http as _,Message as _,*}
import org.http4s.client.Client
import org.http4s.ember.server.EmberServerBuilder
import ponygirls.runtime.{BlockingJdbcDatabase,JdbcConnectionFactory,JdbcFailure,RuntimeFailure}
import java.net.URI
import java.net.http.{HttpClient as JClient,HttpRequest,HttpResponse,WebSocket}
import java.sql.{Connection,DriverManager,SQLException}
import java.util.UUID
import java.util.concurrent.{CompletableFuture,CompletionStage,ConcurrentHashMap,ConcurrentLinkedQueue,CountDownLatch,Executors,LinkedBlockingQueue,TimeUnit}
import java.util.concurrent.atomic.{AtomicBoolean,AtomicInteger}
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import scala.util.Using

/** One pool per process, wired (restart-robustness spec §5, §7 D7-D9): Chronicle's background admission behind the
  * publication gate with the renewal permit (deviation A), the server's Worker on the background admission, and the
  * answers of REST, WS and MCP while the database is unavailable. */
final class PoolWiringTest extends munit.FunSuite {
  override val munitTimeout=120.seconds
  private val embedder=new Embedder {
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
  }
  /** Waits (no fixed time) until `condition` holds; the bound only keeps a broken run from hanging. */
  private def eventually(what: String)(condition: => Boolean): Unit = {
    val bound=System.nanoTime()+10.seconds.toNanos
    while(!condition) { assert(System.nanoTime()<bound,what); Thread.onSpinWait() }
  }
  /** `count` callbacks of `hold` entered and held until `release`. */
  private def latched(executor: java.util.concurrent.ExecutorService,release: CountDownLatch,count: Int)(hold: (Connection => Unit) => Unit): List[java.util.concurrent.Future[?]] = {
    val held=new CountDownLatch(count)
    val running=List.fill(count)(executor.submit((() => hold { _ => held.countDown(); release.await() }): Runnable))
    assert(held.await(10,TimeUnit.SECONDS),"held")
    running
  }

  test("D7 production sizing: the publication gate full and a staging transaction queued outside admission, four lanes' claims, renewals and transient failure records complete; renewals also with every shared permit held") {
    CurrentIndexDatabase.withDatabase { (fixture,fixtureDb,archive) =>
      // maxConnections 12, keys omitted: R 5, B 5 = a background admission of 4 + the renewal permit, the gate L 3.
      val config=fixture.copy(databaseLimits=fixture.databaseLimits.copy(maxConnections=12))
      assertEquals((config.databasePool.request,config.databasePool.background,Database.controlConnections,Database.publicationPermits(config.databasePool)),(5,5,1,3))
      val refused=intercept[DomainError](config.copy(databaseRequestConnections=Some(5),databaseBackgroundConnections=Some(2)).databasePool)
      assert(refused.code=="config" && refused.detail.contains("backgroundConnections"),refused.toString)
      assertEquals(Worker.Leases.production.renewal,30.seconds)
      val jobs=List.fill(4)(archive.ingest("a",Fixtures.snapshot()).jobId)
      Using.resource(Database.service(config,IndexProfileCatalog.current(config))) { db =>
        val executor=Executors.newCachedThreadPool(); val release=new CountDownLatch(1)
        val entered=new AtomicBoolean(false)
        val queued=new Thread(() => db.publication(_ => entered.set(true)))
        try {
          // Two staging transactions and a maintenance transaction hold the gate's 3 permits and 3 of the 4 shared ones.
          val holders=latched(executor,release,2)(f => db.publication(f))++latched(executor,release,1)(f => db.maintenance.transaction(f))
          // A third staging transaction waits at the gate, before the admission: the fourth shared permit stays free.
          queued.start()
          eventually("the third staging transaction waits at the gate")(queued.getState==Thread.State.TIMED_WAITING)
          // Four lanes on the background view, each renewing every 100 ms; their annotation loops claims (short
          // transactions on the shared permit) until every job was renewed 20 times, then fails transiently: recorded.
          val renewals=new ConcurrentHashMap[UUID,AtomicInteger]; val failures=new ConcurrentLinkedQueue[Throwable]
          def observed[A](work: => A): A = try work catch { case error: Throwable => failures.add(error); throw error }
          val background=new PostgresArchive(db.background,config)
          val lanes=new ForwardingArchive(background) {
            override def renew(c: Claim,lease: Int): Boolean = observed {
              val renewed=super.renew(c,lease)
              if(renewed) renewals.computeIfAbsent(c.jobId,_ => new AtomicInteger).incrementAndGet()
              renewed
            }
            override def claim(profiles: Set[String],scope: ClaimScope,lease: Int,large: LargeJobs): Option[Claim] = observed(super.claim(profiles,scope,lease,large))
            override def publicationParent(c: Claim): Option[PublicationParent] = observed(super.publicationParent(c))
            override def defer(c: Claim,total: Int): Boolean = observed(super.defer(c,total))
            override def progress(c: Claim,done: Int,total: Int): Boolean = observed(super.progress(c,done,total))
            override def windowWork(c: Claim,key: CheckpointKey): Option[WindowWork] = observed(super.windowWork(c,key))
            override def reserveAnnotation(c: Claim,key: CheckpointKey): AnnotationReservation = observed(super.reserveAnnotation(c,key))
            override def holdTransient(c: Claim,stage: Option[IndexingStage],bound: FiniteDuration): TransientOutcome = observed(super.holdTransient(c,stage,bound))
          }
          def renewed: Boolean = jobs.forall(id => Option(renewals.get(id)).exists(_.get>=20))
          val annotating=new AtomicInteger(0)
          val annotator=new ProblemPassageAnnotator {
            def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] =
              IO(annotating.incrementAndGet()) *> (IO.blocking(lanes.claim(background.knownProfiles,ClaimScope.Owner("c"),300,LargeJobs.Skipped)) *> IO(renewed)).iterateUntil(identity) *>
                IO.raiseError(JdbcFailure("database-unavailable",Some("57P01")))
          }
          val worker=new Worker(lanes,annotator,embedder,config,IndexProfileCatalog.current(config),ModelAdmission.make(config.indexing).unsafeRunSync(),
            logstage.IzLogger(),ModelFixtures.failureBackoff,ModelFixtures.snapshots,Worker.Leases(2.seconds,100.millis,Duration.Zero,5.seconds))
          assertEquals(List.fill(4)(worker.once).parSequence.timeout(60.seconds).unsafeRunSync(),List.fill(4)(true))
          assertEquals((failures.asScala.toList,annotating.get),(Nil,4))
          jobs.foreach { id =>
            val row=fixtureDb.transaction(c => Sql.one(c,"SELECT state,attempts,error,failure_stage,transient_failures FROM ch_jobs WHERE id=?",id)(r => (r.getString(1),r.getInt(2),r.getString(3),r.getString(4),r.getInt(5))))
            assertEquals(row,Some(("Queued",0,Jobs.transientCode,"Annotation",1)))
          }
          assert(!entered.get && holders.forall(!_.isDone),"the gate stayed full; the queued staging transaction never ran")
          // Every shared permit held (the fourth by a slow claim): short work times out, a renewal is served.
          val slow=new CountDownLatch(1)
          val claimHolder=latched(executor,slow,1)(f => db.background.transaction(f))
          try {
            assertEquals(intercept[RuntimeFailure](db.background.boundedTransaction(200.millis)(_ => ())).code,"admission-timeout")
            assertEquals(db.control(c => Sql.one(c,"SELECT 1")(_.getInt(1))),Some(1))
          } finally slow.countDown()
          claimHolder.foreach(_.get(10,TimeUnit.SECONDS))
        } finally { release.countDown(); executor.shutdown() }
        queued.join(10000)
        assert(entered.get,"the queued staging transaction runs once the gate has a permit")
      }
    }
  }

  test("D8 the server's Worker claims on the background admission: saturated, its claim fails (once is false, the job stays Queued, attempts 0) while requests are served") {
    CurrentIndexDatabase.withDatabase { (fixture,_,archive) =>
      // maxConnections 8: B 3 = a background admission of 2 + the renewal permit.
      val config=fixture.copy(databaseLimits=fixture.databaseLimits.copy(queueTimeout=1.second))
      val receipt=archive.ingest("a",Fixtures.snapshot())
      val module=(_root_.chronicle.plugins.ChroniclePlugin: Module).overriddenBy(new ModuleDef {
        make[Config].fromValue(config)
        make[Client[IO]].fromValue(Client.fromHttpApp[IO](HttpApp.notFound[IO]))
      })
      ChronicleInjector().produceGet[RuntimeServices](module).use(services => IO.blocking {
        val executor=Executors.newCachedThreadPool(); val release=new CountDownLatch(1)
        try {
          latched(executor,release,2)(f => services.database.background.transaction(f))
          assert(!services.worker.once.unsafeRunSync())
          assertEquals(services.database.transaction(c => Sql.one(c,"SELECT state,attempts FROM ch_jobs WHERE id=?",receipt.jobId)(r => (r.getString(1),r.getInt(2)))),Some(("Queued",0)))
        } finally { release.countDown(); executor.shutdown() }
      }).unsafeRunSync()
    }
  }

  test("D9 database unavailable (a lost connection, a fenced role, a saturated admission): REST 503 unavailable with Retry-After 5, WS error unavailable, MCP 503 in the bearer phase or tool error unavailable in 200; recovered, 200") {
    CurrentIndexDatabase.withDatabase { (fixture,_,_) =>
      val port=Using.resource(new java.net.ServerSocket(0))(_.getLocalPort)
      // Two connections, one admission (a probe runtime); queue 1 s; connect 2 s: a fenced borrow waits its whole 2 s
      // budget, and the pool's login back-off sleep then in progress is at most 1.28 s (PoolSuite D4).
      val config=fixture.copy(listenPort=port,allowedOrigin=s"http://127.0.0.1:$port",
        databaseLimits=fixture.databaseLimits.copy(maxConnections=2,queueTimeout=1.second,connectTimeout=2.seconds))
      val bound=config.databaseLimits.queueTimeout+config.databaseLimits.connectTimeout+1.second
      val fenced=new AtomicBoolean(false); val lost=new AtomicBoolean(false)
      // A lost connection fails the collector report's and the job status's statements (08006); a fenced role refuses
      // every login (28000) and its sessions are gone (57P01 at their next statement).
      val factory=new JdbcConnectionFactory {
        def open(url: String,properties: java.util.Properties): Connection = {
          if(fenced.get) throw new SQLException("synthetic fenced role","28000")
          val connection=DriverManager.getConnection(url,properties)
          java.lang.reflect.Proxy.newProxyInstance(classOf[Connection].getClassLoader,Array(classOf[Connection]),(_,method,args) => {
            val arguments=if(args==null) Array.empty[Object] else args
            if(Set("prepareStatement","createStatement","prepareCall").contains(method.getName) && fenced.get) throw new SQLException("synthetic terminated session","57P01")
            if(method.getName=="prepareStatement" && lost.get && List("ch_collector_progress","FROM ch_jobs j JOIN ch_sources s").exists(String.valueOf(arguments(0)).contains))
              throw new SQLException("synthetic lost connection","08006")
            try method.invoke(connection,arguments*) catch { case e: java.lang.reflect.InvocationTargetException => throw e.getCause }
          }).asInstanceOf[Connection]
        }
      }
      val db=Database.withRuntime(config,IndexProfileCatalog.current(config),BlockingJdbcDatabase.withConnectionFactory(config.jdbcConfig,factory))
      try {
        db.transaction(c => Sql.exec(c,"TRUNCATE ch_collector_progress,ch_tokens,ch_mutations CASCADE"))
        val auth=new Auth(db,config)
        val (_,cookie)=auth.login(LoginRequest("a","synthetic")); val owner=auth.browser(cookie)
        def token(scope: Scope): String = auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken(s"pool-$scope",List(scope)))).asInstanceOf[Result.Token].result.secret.get
        val (ingest,read)=(token(Scope.Ingest),token(Scope.Read))
        val module=(_root_.chronicle.plugins.ChroniclePlugin: Module).overriddenBy(new ModuleDef {
          make[Config].fromValue(config)
          make[Database].fromValue(db)
          make[Client[IO]].fromValue(Client.fromHttpApp[IO](HttpApp.notFound[IO]))
          // No session recheck during the test: a WS operation's own answer is observed.
          make[Http.SocketLiveness].fromValue(Http.SocketLiveness(10.seconds,60.seconds,10.seconds,60.seconds))
        })
        ChronicleInjector().produceGet[RuntimeServices](module).use(services => (for {
          gate <- cats.effect.Resource.eval(Semaphore[IO](2))
          _ <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(port).get).withHttpWebSocketApp(ws => services.http.routes(ws,gate).orNotFound).build
          client <- cats.effect.Resource.make(IO(JClient.newHttpClient()))(c => IO.blocking(c.close()))
        } yield client).use(client => IO.blocking {
          val base=s"http://127.0.0.1:$port"
          val sequence=new AtomicInteger(0)
          def post(path: String,secret: String,body: String,headers: (String,String)*): (HttpResponse[String],FiniteDuration) = {
            val request=headers.foldLeft(HttpRequest.newBuilder(URI.create(base+path)).header("Authorization",s"Bearer $secret").header("Content-Type","application/json"))((b,h) => b.header(h._1,h._2))
              .POST(HttpRequest.BodyPublishers.ofString(body)).build()
            // A connection of its own: the server closes one whose body it refused unread.
            Using.resource(JClient.newHttpClient()) { own =>
              val started=System.nanoTime()
              val response=own.send(request,HttpResponse.BodyHandlers.ofString())
              (response,(System.nanoTime()-started).nanos)
            }
          }
          def rest(): (HttpResponse[String],FiniteDuration) = {
            val report=CollectorProgressUpdate("pool-collector",sequence.incrementAndGet(),UUID.randomUUID(),CollectorPhase.Idle,"2026-10-26T00:00:00Z",CollectorCounters(1,1,0,0,0,0,1,0,0,0,0,0,123L),123L,123L,None,None)
            post("/api/collector/progress",ingest,Wire.encode(CollectorProgressUpdate.codecJson,report).noSpaces)
          }
          def mcp(): (HttpResponse[String],FiniteDuration) =
            post("/mcp",read,"""{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"ingest_status","arguments":{"offset":0,"limit":5}}}""","Accept"->"application/json, text/event-stream")
          def code(body: String): Option[String] = Wire.parse(body).hcursor.get[String]("code").toOption
          def unavailable(response: (HttpResponse[String],FiniteDuration),what: String): Unit = {
            val (answer,took)=response
            assertEquals((answer.statusCode,answer.headers.firstValue("Retry-After").orElse(null),code(answer.body)),(503,"5",Some("unavailable")),s"$what: ${answer.body}")
            assert(took<=bound,s"$what answered after $took")
          }
          def toolUnavailable(response: (HttpResponse[String],FiniteDuration)): Unit = {
            val result=Wire.parse(response._1.body).hcursor.downField("result")
            assertEquals((response._1.statusCode,result.get[Boolean]("isError").toOption),(200,Some(true)),response._1.body)
            assert(response._1.body.contains("unavailable"),response._1.body)
          }
          // After a fence the pool's next login can wait for its back-off (doubling up to 5 s, Hikari's own schedule):
          // requests until one is served, within the restart acceptance's 15 s.
          def recovered(): Unit = {
            val deadline=System.nanoTime()+15.seconds.toNanos
            while(rest()._1.statusCode!=200) assert(System.nanoTime()<deadline,"REST did not recover within 15 s")
          }
          def ok(): Unit = {
            assertEquals(rest()._1.statusCode,200)
            val (answer,_)=mcp()
            assertEquals((answer.statusCode,Wire.parse(answer.body).hcursor.downField("result").get[Boolean]("isError").toOption),(200,Some(false)),answer.body)
          }
          Using.resource(new BrowserSocket(client,s"ws://127.0.0.1:$port/api/ws",config,cookie)) { socket =>
            assert(socket.request(Operation.Hello(List(Wire.versions.current))).isInstanceOf[Result.Hello])
            def wsOk(): Unit = assert(socket.request(Operation.IngestStatus(0,5)).isInstanceOf[Result.Status])
            def wsUnavailable(what: String): Unit = socket.request(Operation.IngestStatus(0,5)) match {
              case Result.Error(failure) => assertEquals(failure.code,"unavailable",what)
              case other => fail(s"$what: $other")
            }
            ok(); wsOk()
            // A lost connection in the request's own statement (08006).
            lost.set(true)
            unavailable(rest(),"REST, lost connection"); wsUnavailable("WS, lost connection"); toolUnavailable(mcp())
            lost.set(false); ok(); wsOk()
            // The fence: logins refused (28000), the sessions gone.
            fenced.set(true)
            unavailable(rest(),"REST, fenced"); wsUnavailable("WS, fenced"); unavailable(mcp(),"MCP bearer phase, fenced")
            fenced.set(false); recovered(); ok(); wsOk()
            // The admission saturated: both connections held.
            val executor=Executors.newCachedThreadPool(); val release=new CountDownLatch(1)
            try {
              latched(executor,release,2)(f => db.transaction(f))
              unavailable(rest(),"REST, admission saturated"); wsUnavailable("WS, admission saturated"); unavailable(mcp(),"MCP bearer phase, admission saturated")
            } finally { release.countDown(); executor.shutdown() }
            ok(); wsOk()
          }
        })).unsafeRunSync()
      } finally db.close()
    }
  }

  /** A browser WebSocket of the Chronicle protocol (JDK client), its replies in order. */
  private final class BrowserSocket(client: JClient,url: String,config: Config,cookie: String) extends AutoCloseable {
    private val inbox=new LinkedBlockingQueue[String]()
    private val ws=client.newWebSocketBuilder().header("Origin",config.allowedOrigin).header("Cookie",s"chronicle_session=$cookie").buildAsync(URI.create(url),new WebSocket.Listener {
      private val text=new java.lang.StringBuilder()
      override def onOpen(ws: WebSocket): Unit = ws.request(1)
      override def onText(ws: WebSocket,part: CharSequence,last: Boolean): CompletionStage[?] = {
        text.append(part)
        if(last) { inbox.offer(text.toString); text.setLength(0) }
        ws.request(1); CompletableFuture.completedFuture(null)
      }
    }).get(5,TimeUnit.SECONDS)
    def request(operation: Operation): Result = {
      val id=UUID.randomUUID()
      ws.sendText(Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(id,operation)).noSpaces,true).get(5,TimeUnit.SECONDS)
      val reply=Wire.decode(ServerEnvelope.codecJson,Wire.parse(Option(inbox.poll(10,TimeUnit.SECONDS)).getOrElse(fail("missing WebSocket reply"))))
      assertEquals(reply.requestId,id)
      reply.result
    }
    def close(): Unit = ws.abort()
  }
}
