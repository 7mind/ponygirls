package chronicle
import chronicle.api.*
import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import distage.*
import io.circe.Json
import org.http4s.{Http as _,Message as _,*}
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import java.time.{Duration,Instant}
import java.util.UUID
import java.util.concurrent.{CyclicBarrier,TimeUnit}

/** Job operations for tokens (R-f) through the production routes and PostgreSQL. */
class JobOperationsHttpTest extends munit.FunSuite {
  private final case class Reply(status: Status,body: String,headers: Headers) {
    def json: Json=Wire.parse(body)
  }
  private val scopesHeader="X-Account-Scopes"
  private val allScopes=scopesHeader->"all"
  /** The refusal of a bearer without OperateJobs or outside the allow-list: today's refusal of a bearer mutation. */
  private val pinned="""{"code":"forbidden","message":"browser session required"}"""
  private val limits=JobLimits(Duration.ofMinutes(10),2,2,2,2,2)
  private val windowSeconds=limits.window.getSeconds.toString
  private val start=Instant.parse("2026-11-23T00:00:00Z")
  private val guardSeconds=30L
  /** A controlled clock; while `barrier` is set, every reading waits for the barrier's other parties (guarded). */
  private final class TestClock extends java.time.Clock {
    @volatile var now: Instant=start
    @volatile var barrier: Option[CyclicBarrier]=None
    def getZone: java.time.ZoneId = java.time.ZoneOffset.UTC
    override def withZone(zone: java.time.ZoneId): java.time.Clock = this
    override def instant(): Instant = { barrier.foreach(_.await(guardSeconds,TimeUnit.SECONDS)); now }
  }
  private final class Fixture(val config: Config,val services: RuntimeServices,app: HttpApp[IO],val clock: TestClock,val budget: JobBudget) {
    val auth=new Auth(services.database,config,budget)
    def reply(request: Request[IO]): IO[Reply] = app.run(request).flatMap(r => r.as[String].map(Reply(r.status,_,r.headers)))
    def send(request: Request[IO]): Reply = reply(request).unsafeRunSync()
    def login(owner: String): String = auth.login(LoginRequest(owner,"synthetic"))._2
    def account(method: Method,path: String,owner: String,cookie: String,body: String,extra: List[(String,String)]): Reply = {
      val headers=List("Host"->java.net.URI.create(config.allowedOrigin).getRawAuthority,"Origin"->config.allowedOrigin,"Content-Type"->"application/json","Cookie"->s"chronicle_session=$cookie","X-Account-Actor"->ponygirls.auth.AccountJson.actor(owner))++extra
      send(Request[IO](method,Uri.unsafeFromString(Http.accountPrefix+path)).withEntity(body).putHeaders(headers.map((k,v) => Header.Raw(CIString(k),v))*))
    }
    def settings(owner: String,cookie: String,extra: List[(String,String)]): Reply = account(Method.GET,"",owner,cookie,"",extra)
    def issue(owner: String,cookie: String,scopes: String,extra: List[(String,String)]): Reply = account(Method.POST,"/tokens",owner,cookie,s"""{"name":"agent","scopes":$scopes}""",extra)
    /** A token issued in Settings with Read and OperateJobs: its secret and id. */
    def operator(owner: String): (String,UUID) = {
      val issued=issue(owner,login(owner),"""["Read","OperateJobs"]""",List(allScopes))
      assertEquals(issued.status,Status.Ok,issued.body)
      (issued.json.hcursor.get[String]("secret").toOption.get,UUID.fromString(issued.json.hcursor.downField("token").get[String]("id").toOption.get))
    }
    def operateJobs(id: UUID): Boolean = services.database.transaction(c => Sql.one(c,"SELECT operate_jobs FROM ch_tokens WHERE id=?",id)(_.getBoolean(1)).get)
    def token(owner: String,scopes: String): String = {
      val issued=issue(owner,login(owner),scopes,List(allScopes)); assertEquals(issued.status,Status.Ok,issued.body)
      issued.json.hcursor.get[String]("secret").toOption.get
    }
    def revoke(owner: String,id: UUID): Unit = assertEquals(account(Method.POST,s"/tokens/$id/revoke",owner,login(owner),"{}",Nil).status,Status.Ok)
    def jobRequest(secret: String,body: String): Request[IO] = Request[IO](Method.POST,Uri.unsafeFromString("/api/jobs/v1")).withEntity(body)
      .putHeaders(Header.Raw(CIString("Authorization"),s"Bearer $secret"),Header.Raw(CIString("Content-Type"),"application/json"))
    def post(secret: String,envelope: ClientEnvelope): Reply = send(jobRequest(secret,Wire.encode(ClientEnvelope.codecJson,envelope).noSpaces))
    def operate(secret: String,operation: Operation): Reply = post(secret,ClientEnvelope(UUID.randomUUID(),operation))
    def result(reply: Reply): Result = { assertEquals(reply.status,Status.Ok,reply.body); Wire.decode(ServerEnvelope.codecJson,reply.json).result }
    /** A Failed job of the owner's new source (fence 7). */
    def failed(owner: String,name: String): UUID = {
      val source=Fixtures.snapshot()
      val receipt=services.archive.ingest(owner,source.copy(source=source.source.copy(producerSessionId=name)))
      services.database.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET state='Failed',attempts=5,fence=7,lease_until=NULL,error='model-http' WHERE id=?",receipt.jobId))
      receipt.jobId
    }
    def running(id: UUID): Unit = { services.database.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET state='Running',lease_until=now()+interval '60 seconds' WHERE id=?",id)); () }
    def job(id: UUID): (String,Long) = services.database.transaction(c => Sql.one(c,"SELECT state,fence FROM ch_jobs WHERE id=?",id)(r => (r.getString(1),r.getLong(2))).get)
    def receipts: Int = services.database.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_mutations")(_.getInt(1)).get)
    def actor(request: UUID): Option[UUID] = services.database.transaction(c => Sql.one(c,"SELECT token FROM ch_mutations WHERE request_id=?",request)(r => Option(r.getObject(1,classOf[UUID]))).get)
  }
  private def refused(reply: Reply): Unit = assertEquals((reply.status,reply.body),(Status.Forbidden,pinned))
  private def limited(reply: Reply,seconds: String): Unit = {
    assertEquals((reply.status,reply.headers.get(CIString("Retry-After")).map(_.head.value)),(Status.TooManyRequests,Some(seconds)),reply.body)
    assertEquals(reply.body,"""{"code":"rate-limited","message":"job operation limit reached"}""")
  }
  private val list=Operation.ActivityJobs(ActivityJobsQuery(None,ActivityJobScope.Current,"",ActivityJobSort.LastTimestamp,SortDirection.Desc,None,100))
  private def operations(job: UUID): List[Operation] = List(list,Operation.RetryJob(job),Operation.PreviewRetryFailed(),Operation.ApplyRetryFailed("profile","0"*64,true))
  /** One value of a generated type, built from its constructor (S3 enumerates the Operation variants from the type). */
  private def sample(t: Class[?]): AnyRef =
    if(t==classOf[String]) "x"
    else if(t==classOf[UUID]) UUID.randomUUID()
    else if(t==java.lang.Integer.TYPE) Int.box(1)
    else if(t==java.lang.Long.TYPE) Long.box(1L)
    else if(t==java.lang.Boolean.TYPE) Boolean.box(true)
    else if(t==java.lang.Double.TYPE) Double.box(0.0)
    else if(t==classOf[Option[?]]) None
    else if(t==classOf[List[?]]) Nil
    else if(t.isInterface) {
      val companion=Class.forName(t.getName+"$")
      scala.util.Try(companion.getMethod("all")).toOption match {
        case Some(all) => all.invoke(companion.getField("MODULE$").get(null)).asInstanceOf[List[AnyRef]].head
        case None => sample(t.getDeclaredClasses.find(c => t.isAssignableFrom(c) && !c.isInterface).get)
      }
    } else {
      val constructor=t.getConstructors.head
      constructor.newInstance(constructor.getParameterTypes.map(sample)*).asInstanceOf[AnyRef]
    }
  private def scopes(json: Json): Vector[String] = json.hcursor.get[Vector[String]]("scopes").toOption.get
  private def tokenScopes(json: Json,id: UUID): Vector[String] =
    json.hcursor.get[Vector[Json]]("tokens").toOption.get.find(_.hcursor.get[String]("id").toOption.contains(id.toString)).flatMap(_.hcursor.get[Vector[String]]("scopes").toOption).get

  private def withFixture(body: Fixture => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val config=Fixtures.config()
    val clock=new TestClock; val budget=new JobBudget(limits,clock)
    val resources=for {
      client <- EmberClientBuilder.default[IO].build
      services <- ChronicleInjector().produceGet[RuntimeServices]((_root_.chronicle.plugins.ChroniclePlugin: Module).overriddenBy(new ModuleDef {
        make[Config].fromValue(config); make[Client[IO]].fromValue(client); make[JobBudget].fromValue(budget)
      })).toCats[IO]
      ws <- Resource.eval(WebSocketBuilder2[IO])
      gate <- Resource.eval(Semaphore[IO](2))
    } yield (services,services.http.routes(ws,gate).orNotFound)
    val ((services,app),release)=resources.allocated.unsafeRunSync()
    try {
      services.database.initialize()
      services.database.transaction { c =>
        Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations,ch_collector_progress CASCADE")
        Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
        Sql.exec(c,"UPDATE ch_users SET enabled=true")
      }
      body(new Fixture(config,services,app,clock,budget))
    } finally release.unsafeRunSync()
  }

  test("R-f S9: the account API names OperateJobs only on opt-in, and no typed value carries it") { withFixture { f =>
    val cookie=f.login("a")
    val legacy=f.settings("a",cookie,Nil)
    assertEquals(legacy.status,Status.Ok); assertEquals(scopes(legacy.json),Vector("Ingest","Read","Raw"))
    assertEquals(f.issue("a",cookie,"""["Read","OperateJobs"]""",Nil).status,Status.BadRequest)
    val issued=f.issue("a",cookie,"""["Read","OperateJobs"]""",List(allScopes))
    assertEquals(issued.status,Status.Ok,issued.body)
    assertEquals(issued.json.hcursor.downField("token").get[Vector[String]]("scopes").toOption,Some(Vector("Read","OperateJobs")))
    val secret=issued.json.hcursor.get[String]("secret").toOption.get
    val id=UUID.fromString(issued.json.hcursor.downField("token").get[String]("id").toOption.get)
    assert(f.operateJobs(id))
    val opted=f.settings("a",cookie,List(allScopes))
    assertEquals(scopes(opted.json),Vector("Ingest","Read","Raw","OperateJobs")); assertEquals(tokenScopes(opted.json,id),Vector("Read","OperateJobs"))
    val unchanged=f.settings("a",cookie,Nil)
    assertEquals(scopes(unchanged.json),Vector("Ingest","Read","Raw")); assertEquals(tokenScopes(unchanged.json,id),Vector("Read"))
    assertEquals(f.auth.bearer(secret).user.scopes,List(Scope.Read))
    assertEquals(f.auth.tokens(f.auth.browser(cookie)).tokens.map(_.info.scopes),List(List(Scope.Read)))
    List("""["OperateJobs"]""","""["Raw","OperateJobs"]""","""["Read","OperateJobs","OperateJobs"]""","""["Read","Read","OperateJobs"]""").foreach { requested =>
      assertEquals(f.issue("a",cookie,requested,List(allScopes)).status,Status.BadRequest,requested)
    }
    List(List(allScopes,allScopes),List(scopesHeader->"typed")).foreach { header =>
      assertEquals(f.settings("a",cookie,header).status,Status.BadRequest)
      assertEquals(f.issue("a",cookie,"""["Read"]""",header).status,Status.BadRequest)
    }
    assertEquals(f.services.database.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_tokens")(_.getInt(1)).get),1)
  }}

  test("R-f S1: a token with OperateJobs lists its owner's jobs, retries one and retries failed, under the request-id receipts") { withFixture { f =>
    val a1=f.failed("a","a1"); val a2=f.failed("a","a2"); val b1=f.failed("b","b1")
    val (secret,token)=f.operator("a")
    val listed=f.result(f.operate(secret,list)) match { case Result.ActivityJobs(result) => result; case other => fail(other.toString) }
    assertEquals(listed.jobs.map(j => (j.job.id,j.job.state,j.classification,j.job.error,j.retryable)).toSet,
      Set(a1,a2).map(id => (id,JobState.Failed: JobState,ActivityJobClass.Current: ActivityJobClass,Option("model-http"),true)))
    val retry=ClientEnvelope(UUID.randomUUID(),Operation.RetryJob(a1))
    assertEquals(f.result(f.post(secret,retry)),Result.Mutation(MutationReceipt(retry.requestId,"RetryJob",Some(a1))))
    assertEquals(f.job(a1),("Queued",8L)); assertEquals(f.actor(retry.requestId),Some(token))
    val foreign=f.operate(secret,Operation.RetryJob(b1))
    assertEquals((foreign.status,foreign.body),(Status.NotFound,"""{"code":"not-found","message":"job not found"}""")); assertEquals(f.job(b1),("Failed",7L))
    val previewed=f.operate(secret,Operation.PreviewRetryFailed())
    val plan=f.result(previewed) match { case Result.RetryFailedPreview(result) => result; case other => fail(other.toString) }
    assertEquals((plan.counts.eligibleCurrentFailed,previewed.headers.get(CIString("X-Chronicle-Windows-To-Annotate")).map(_.head.value)),(1L,Some("unknown")))
    val apply=ClientEnvelope(UUID.randomUUID(),Operation.ApplyRetryFailed(plan.targetProfile,plan.selectionHash,true))
    val applied=f.result(f.post(secret,apply))
    assertEquals(applied,Result.RetryFailed(RetryFailedResult(apply.requestId,plan.targetProfile,1L,plan.counts))); assertEquals(f.job(a2),("Queued",8L))
    val stored=f.receipts
    assertEquals(f.result(f.post(secret,apply)),applied); assertEquals(f.receipts,stored)
    assertEquals(f.post(secret,apply.copy(operation=Operation.RetryJob(a1))).status,Status.Conflict)
    val stale=ClientEnvelope(UUID.randomUUID(),Operation.ApplyRetryFailed(plan.targetProfile,plan.selectionHash,true))
    assertEquals(f.result(f.post(secret,stale)),Result.Error(Failure("conflict","retry selection changed; preview again")))
    assertEquals(f.result(f.post(secret,stale)),Result.Error(Failure("conflict","retry selection changed; preview again")))
    assertEquals(List(a1,a2,b1).map(f.job),List(("Queued",8L),("Queued",8L),("Failed",7L)))
  }}

  test("R-f S2: a token without OperateJobs is refused every job operation with today's bearer refusal, before its body is read") { withFixture { f =>
    val job=f.failed("a","a1")
    List("""["Read"]""","""["Ingest","Read","Raw"]""").map(f.token("a",_)).foreach { secret =>
      operations(job).foreach(operation => refused(f.operate(secret,operation)))
      refused(f.send(f.jobRequest(secret,"").withBodyStream(fs2.Stream.raiseError[IO](new Exception("body must not be read")))))
    }
    assertEquals(f.job(job),("Failed",7L)); assertEquals(f.receipts,0)
  }}

  test("R-f S3: with every scope and OperateJobs exactly the four job operations are admitted; every other Operation variant is refused before dispatch") { withFixture { f =>
    val secret=f.token("a","""["Ingest","Read","Raw","OperateJobs"]""")
    def tables: List[String] = List("ch_mutations","ch_groups","ch_invites","ch_tokens","ch_sources").map { table =>
      f.services.database.transaction(c => Sql.one(c,s"SELECT coalesce(md5(string_agg(x::text,',' ORDER BY x::text)),'') FROM $table x")(_.getString(1)).get)
    }
    val before=tables
    val variants=classOf[Operation].getDeclaredClasses.toList.filter(c => classOf[Operation].isAssignableFrom(c) && !c.isInterface)
    val answers=variants.map(variant => variant.getSimpleName -> f.operate(secret,sample(variant).asInstanceOf[Operation]))
    val (refusals,admitted)=answers.partition((_,reply) => reply.status==Status.Forbidden && reply.body==pinned)
    assertEquals(admitted.map(_._1).toSet,Set("ActivityJobs","RetryJob","PreviewRetryFailed","ApplyRetryFailed"))
    assert(refusals.size+admitted.size==variants.size && refusals.nonEmpty)
    assertEquals(tables,before)
  }}

  test("R-f S4: OperateJobs opens no other route or operation to the token") { withFixture { f =>
    val (secret,_)=f.operator("a"); val read=f.token("a","""["Read"]""")
    def bearer(token: String): Header.Raw = Header.Raw(CIString("Authorization"),s"Bearer $token")
    val origin=Header.Raw(CIString("Origin"),f.config.allowedOrigin)
    val host=Header.Raw(CIString("Host"),java.net.URI.create(f.config.allowedOrigin).getRawAuthority)
    val json=Header.Raw(CIString("Content-Type"),"application/json")
    def answer(method: Method,path: String,body: String,token: String): Reply = f.send(Request[IO](method,Uri.unsafeFromString(path)).withEntity(body).putHeaders(bearer(token),origin,host,json))
    val ws=answer(Method.GET,"/api/ws","",secret)
    assertEquals((ws.status,ws.body),(Status.Forbidden,"""{"code":"forbidden","message":"browser cookie transport only"}"""))
    val accountRefusal="""{"error":{"code":"forbidden","message":"forbidden"}}"""
    List(answer(Method.GET,Http.accountPrefix,"",secret),answer(Method.POST,Http.accountPrefix+"/tokens","""{"name":"x","scopes":["Read"]}""",secret),
      answer(Method.GET,"/api/maintenance/v1/profile-switch","",secret)).foreach(reply => assertEquals((reply.status,reply.body),(Status.Forbidden,accountRefusal)))
    val raw=answer(Method.GET,s"/api/raw/${UUID.randomUUID()}","",secret)
    assertEquals((raw.status,raw.body),(Status.Forbidden,pinned))
    val progress=answer(Method.POST,"/api/collector/progress","{}",secret)
    assertEquals((progress.status,progress.body),(Status.Forbidden,"""{"code":"forbidden","message":"scope required"}"""))
    def tools(token: String): Reply = f.send(Request[IO](Method.POST,Uri.unsafeFromString("/mcp")).withEntity("""{"jsonrpc":"2.0","id":1,"method":"tools/list"}""")
      .putHeaders(bearer(token),json,Header.Raw(CIString("Accept"),"application/json, text/event-stream")))
    val (scopedTools,readTools)=(tools(secret),tools(read))
    assertEquals((scopedTools.status,scopedTools.body),(Status.Ok,readTools.body))
    val scoped=f.auth.bearer(secret)
    assertEquals(intercept[DomainError](f.auth.mutate(scoped,ClientEnvelope(UUID.randomUUID(),Operation.Purge(f.failed("a","a1"))))),DomainError("forbidden","browser session required"))
    assertEquals(intercept[DomainError](f.auth.previewOwnerReindex(scoped)),DomainError("forbidden","browser session required"))
  }}

  test("R-f S5: a revoked token and a disabled owner are refused, also by a mutation authenticated before the revocation") { withFixture { f =>
    val job=f.failed("a","a1")
    val (secret,id)=f.operator("a")
    val authenticated=f.auth.bearer(secret)
    f.revoke("a",id)
    assertEquals(intercept[DomainError](f.auth.mutate(authenticated,ClientEnvelope(UUID.randomUUID(),Operation.RetryJob(job)))),DomainError("unauthorized","invalid agent credential"))
    operations(job).foreach(operation => assertEquals(f.operate(secret,operation).status,Status.Unauthorized))
    val (other,_)=f.operator("a")
    f.services.database.transaction(c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='a'"))
    operations(job).foreach(operation => assertEquals(f.operate(other,operation).status,Status.Unauthorized))
    assertEquals(f.job(job),("Failed",7L)); assertEquals(f.receipts,0)
  }}

  test("R-f S6: each operation's budget per owner and window is charged before any effect, replays are free, browser sessions are not counted") { withFixture { f =>
    val job=f.failed("a","a1")
    val browser=f.auth.browser(f.login("a"))
    (1 to 3).foreach(_ => f.auth.mutate(browser,ClientEnvelope(UUID.randomUUID(),Operation.RetryJob(job))))
    val (secret,_)=f.operator("a")
    val first=ClientEnvelope(UUID.randomUUID(),Operation.RetryJob(job))
    f.running(job); val stored=f.result(f.post(secret,first))
    f.running(job); f.result(f.operate(secret,Operation.RetryJob(job)))
    f.running(job); val fenced=f.job(job); val receipts=f.receipts
    limited(f.operate(secret,Operation.RetryJob(job)),windowSeconds)
    assertEquals(f.job(job),fenced); assertEquals(f.receipts,receipts)
    assertEquals(f.result(f.post(secret,first)),stored)
    f.clock.now=start.plus(limits.window).minusMillis(1)
    limited(f.operate(secret,Operation.RetryJob(job)),"1")
    f.clock.now=start.plus(limits.window)
    f.result(f.operate(secret,Operation.RetryJob(job)))
    val stale=Operation.ApplyRetryFailed(f.config.profile,"0"*64,true)
    (1 to 2).foreach(_ => assertEquals(f.result(f.operate(secret,stale)),Result.Error(Failure("conflict","retry selection changed; preview again"))))
    limited(f.operate(secret,stale),windowSeconds)
    List(Operation.PreviewRetryFailed(),list).foreach { read =>
      (1 to 2).foreach(_ => f.result(f.operate(secret,read)))
      limited(f.operate(secret,read),windowSeconds)
    }
    assert(f.budget.admit() && f.budget.admit())
    val busy=try f.operate(secret,Operation.PreviewRetryFailed()) finally { f.budget.release(); f.budget.release() }
    assertEquals((busy.status,busy.headers.get(CIString("Retry-After")).map(_.head.value),busy.body),(Status.ServiceUnavailable,Some("5"),"""{"code":"unavailable","message":"job operations busy"}"""))
  }}

  test("R-f S6: the service is wired with 30-minute windows of 120 lists, 20 retries, 6 previews and 2 applies per owner, and 2 concurrent requests") {
    val wired=ChronicleInjector().produceGet[JobBudget](_root_.chronicle.plugins.ChroniclePlugin: Module).use(budget => IO.pure(budget.limits)).unsafeRunSync()
    assertEquals(wired,JobLimits(Duration.ofMinutes(30),120,20,6,2,2)); assertEquals(JobLimits.production,wired)
    assertEquals(JobLimits.busyRetryAfterSeconds,5L)
  }

  test("R-f S7: two tokens of one owner racing for its last slot get exactly one") { withFixture { f =>
    val (first,_)=f.operator("a"); val (second,_)=f.operator("a")
    f.result(f.operate(first,Operation.PreviewRetryFailed()))
    def preview(secret: String): IO[Reply] = f.reply(f.jobRequest(secret,Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),Operation.PreviewRetryFailed())).noSpaces))
    f.clock.barrier=Some(new CyclicBarrier(2))
    val (one,other)=try (preview(first),preview(second)).parTupled.unsafeRunSync() finally f.clock.barrier=None
    assertEquals(List(one.status,other.status).map(_.code).sorted,List(200,429))
  }}

  test("R-f S8: a replay by another token of the owner returns the stored result, keeps the first executor as actor and is not charged") { withFixture { f =>
    val job=f.failed("a","a1"); val next=f.failed("a","a2")
    val (first,firstId)=f.operator("a"); val (second,_)=f.operator("a")
    val request=ClientEnvelope(UUID.randomUUID(),Operation.RetryJob(job))
    val stored=f.result(f.post(first,request)); val fenced=f.job(job)
    f.result(f.operate(first,Operation.RetryJob(next)))
    f.revoke("a",firstId)
    assertEquals(f.post(first,request).status,Status.Unauthorized)
    assertEquals(f.result(f.post(second,request)),stored)
    assertEquals(f.actor(request.requestId),Some(firstId)); assertEquals(f.job(job),fenced)
    limited(f.operate(second,Operation.RetryJob(next)),windowSeconds)
  }}
}
