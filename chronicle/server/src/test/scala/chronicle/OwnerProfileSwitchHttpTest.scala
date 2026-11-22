package chronicle

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import distage.*
import io.circe.Json
import java.util.UUID
import org.http4s.{Http as _,Message as _,*}
import org.http4s.client.Client
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.auth.AccountJson

final class OwnerProfileSwitchGraph(val http: Http,val auth: Auth,val archive: PostgresArchive,val db: Database,val application: Application)

/** Production HTTP routes and the durable browser receipt path, on the suite's owned PostgreSQL fixture. */
final class OwnerProfileSwitchHttpTest extends munit.FunSuite {
  private val path = "/api/maintenance/v1/profile-switch"
  private case class Answer(status: Status,body: Json,response: Response[IO]) {
    def string(key: String): String = body.hcursor.get[String](key).toOption.get
    def code: String = body.hcursor.downField("error").get[String]("code").toOption.get
  }
  private final class Browser(routes: HttpApp[IO],val config: Config,val a: String,val b: String) {
    val origin = config.allowedOrigin
    val host = java.net.URI.create(origin).getRawAuthority
    def request(method: Method,cookie: String,headers: Seq[(String,String)],body: Option[String]=None,url: String=path,authority: String=host): Answer = {
      val sent=Seq("Host"->authority) ++ Option.when(cookie.nonEmpty)("Cookie"->s"chronicle_session=$cookie") ++ headers
      val r=Request[IO](method,Uri.unsafeFromString(url))
      routes(body.fold(r)(r.withEntity(_)).putHeaders(sent.map((k,v) => Header.Raw(CIString(k),v))*))
        .flatMap(res => res.as[String].map(s => Answer(res.status,Wire.parse(s),res))).unsafeRunSync()
    }
    def preview(cookie: String): Answer = request(Method.GET,cookie,List("Sec-Fetch-Site"->"same-origin"))
    def apply(cookie: String,actor: String,body: Json): Answer =
      request(Method.POST,cookie,List("Origin"->origin,"Content-Type"->"application/json","X-Account-Actor"->actor),Some(body.noSpaces))
  }
  private def fixture(incompatible: Boolean=false)(run: (Browser,OwnerProfileSwitchGraph,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped")
    }
    val original=Fixtures.config()
    val mimo=original.copy(annotation=original.annotation.copy(model="synthetic-mimo"))
    val qwen=original.copy(annotation=original.annotation.copy(model="synthetic-qwen"),
      embedding=if(incompatible) original.embedding.copy(revision="different-embedding-space") else original.embedding)
    val old=Fixtures.database(mimo,IndexProfileCatalog.current(mimo)); old.initialize()
    try {
      old.transaction { c =>
        Sql.exec(c,"TRUNCATE ch_sources,ch_sessions,ch_groups,ch_tokens,ch_mutations,ch_reindex_requests CASCADE")
        Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",mimo.profile)
      }
      val production: Module=_root_.chronicle.plugins.ChroniclePlugin
      val module=production.overriddenBy(new ModuleDef {
        make[Config].fromValue(qwen); make[Client[IO]].fromValue(Client.fromHttpApp[IO](HttpApp.notFound[IO])); make[OwnerProfileSwitchGraph]
      })
      ChronicleInjector().produceGet[OwnerProfileSwitchGraph](module).use { graph => for {
        ws <- WebSocketBuilder2[IO]
        gate <- Semaphore[IO](2)
        _ <- IO.blocking {
          graph.db.initialize()
          val a=graph.auth.login(LoginRequest("a","synthetic"))._2
          val b=graph.auth.login(LoginRequest("b","synthetic"))._2
          run(new Browser(graph.http.routes(ws,gate).orNotFound,qwen,a,b),graph,new PostgresArchive(old,mimo))
        }
      } yield () }.unsafeRunSync()
    } finally old.close()
  }
  private def payload(plan: Answer,id: UUID): Json = Json.obj("requestId"->Json.fromString(id.toString),
    "targetProfile"->Json.fromString(plan.string("targetProfile")),"selectionHash"->Json.fromString(plan.string("selectionHash")),"confirm"->Json.True)
  private def withField(j: Json,field: String,value: Json): Json = Json.fromJsonObject(j.asObject.get.add(field,value))
  private def target(db: Database,owner: String): OwnerTarget = db.transaction(c => OwnerTargets.read(c,owner,false))
  private def rows(db: Database,table: String): List[String] =
    db.transaction(c => Sql.rows(c,s"SELECT to_jsonb(t)::text FROM $table t ORDER BY to_jsonb(t)::text")(_.getString(1)))
  private val retained = List("ch_sources","ch_revisions","ch_generations","ch_chunks","ch_search_chunks","ch_ingest_receipts",
    "ch_problem_passages","ch_generation_tags","ch_reindex_requests","ch_reindex_members")
  private def snapshot(db: Database,tables: List[String]): List[List[String]] = tables.map(rows(db,_))
  private def job(db: Database,id: UUID): (String,String,Option[String],Long,Boolean) = db.transaction { c =>
    Sql.one(c,"SELECT profile,state,error,fence,lease_until IS NULL FROM ch_jobs WHERE id=?",id)(r =>
      (r.getString(1),r.getString(2),Option(r.getString(3)),r.getLong(4),r.getBoolean(5))).get
  }

  test("preview changes nothing; switch fences only unfinished obsolete owner jobs and keeps all publications, pins and receipts") { fixture() { (browser,g,old) =>
    val db=g.db; val archive=g.archive; val model=old.db.profiles.preferred.profile
    assert(!db.profiles.knownProfiles.contains(model),"the deployed Qwen executor need not execute the retained MiMo profile")
    val original=Fixtures.snapshot(); val first=old.ingest("a",original)
    def publishOld(): ContentView = {
      val claim=old.claim(Set(model),ClaimScope.Owner("a"),300).get
      assert(old.publishProblems(claim,CurrentIndexDatabase.publication(claim,false)))
      old.session("a",first.sessionId).view
    }
    val oldest=publishOld(); old.retry("a",first.jobId); val latest=publishOld()
    val pinned=List(oldest,latest).map(p => (p,archive.pageChunks("a",first.sessionId,0,100,Some(p))))
    assertNotEquals(oldest,latest); assert(pinned.forall(_._2.chunks.nonEmpty))
    val running=old.ingest("a",Fixtures.snapshot()); val claim=old.claim(Set(model),ClaimScope.Owner("a"),300).get
    assertEquals(claim.jobId,running.jobId)
    val foreign=old.ingest("b",Fixtures.snapshot())
    val jobsBefore=List(running.jobId,first.jobId,foreign.jobId).map(job(db,_))
    val all=retained++List("ch_jobs","ch_mutations","ch_owner_targets")
    val pristine=snapshot(db,all); val plan=browser.preview(browser.a)
    assertEquals(plan.status,Status.Ok)
    assertEquals(plan.body.asObject.get.keys.toSet,Set("ownerId","actor","currentProfile","targetProfile","selectionHash","backfillJobs"))
    assertEquals(plan.string("ownerId"),"a"); assertEquals(plan.string("actor"),AccountJson.actor("a"))
    assertEquals(plan.string("currentProfile"),model); assertEquals(plan.string("targetProfile"),browser.config.profile)
    assertEquals(plan.body.hcursor.get[Int]("backfillJobs").toOption,Some(0))
    assertEquals(plan.response.headers.get(CIString("Cache-Control")).map(_.head.value),Some("no-store"))
    assertEquals(snapshot(db,all),pristine)

    // Preview selects only the owner's target epoch, not an archive/job cohort. A newly queued old-target job is also obsolete.
    val queued=old.ingest("a",Fixtures.snapshot()); val queuedBefore=job(db,queued.jobId)
    assertEquals(browser.preview(browser.a).body,plan.body)
    val preserved=snapshot(db,retained); val id=UUID.randomUUID(); val request=payload(plan,id)
    val applied=browser.apply(browser.a,plan.string("actor"),request)
    assertEquals(applied.status,Status.Ok)
    assertEquals(applied.body,Json.obj("requestId"->Json.fromString(id.toString),"targetProfile"->Json.fromString(browser.config.profile),"backfillJobs"->Json.fromInt(0)))
    assertEquals(target(db,"a"),OwnerTarget(browser.config.profile,1L)); assertEquals(target(db,"b"),OwnerTarget(model,0L))
    assertEquals(snapshot(db,retained),preserved)
    assertEquals(rows(db,"ch_jobs").size,4,"the switch must not enqueue a single job")
    assertEquals(job(db,first.jobId),jobsBefore(1)); assertEquals(job(db,foreign.jobId),jobsBefore(2))
    List(running.jobId->jobsBefore.head,queued.jobId->queuedBefore).foreach { (jobId,before) =>
      assertEquals(job(db,jobId),(model,"Failed",Some(OwnerProfileSwitch.superseded): Option[String],before._4+1,true))
    }
    assert(!old.renew(claim,300)); assert(!old.publishProblems(claim,CurrentIndexDatabase.publication(claim,false)))
    assertEquals(archive.claim(db.profiles.knownProfiles,ClaimScope.Owner("a"),300),None)
    assertEquals(archive.session("a",first.sessionId).view,latest)

    val identity=g.auth.browser(browser.a); val receiptRequest=ClientEnvelope(UUID.randomUUID(),Operation.Receipt(id))
    val receipt=g.application.operation(identity,receiptRequest).unsafeRunSync()
    assertEquals(receipt,Result.Mutation(MutationReceipt(id,"owner-profile-switch",None)))
    assertEquals(Wire.decode(Result.codecJson,Wire.encode(Result.codecJson,receipt)),receipt)
    assertEquals(intercept[DomainError](g.application.operation(g.auth.browser(browser.b),receiptRequest).unsafeRunSync()).code,"not-found")
    assertEquals(intercept[DomainError](g.auth.mutate(identity,ClientEnvelope(id,Operation.CreateGroup("same UUID, different operation")))).code,"conflict")
    val committed=snapshot(db,all)
    assertEquals(browser.apply(browser.a,plan.string("actor"),request).body,applied.body)
    assertEquals(snapshot(db,all),committed)
    val current=browser.preview(browser.a)
    assertEquals(current.string("currentProfile"),current.string("targetProfile"))
    assertEquals(browser.apply(browser.a,current.string("actor"),payload(current,UUID.randomUUID())).status,Status.Conflict)
    assertEquals(snapshot(db,all),committed)

    assertEquals(archive.ingest("a",original),first)
    val next=archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    assertEquals(job(db,next.jobId)._1,browser.config.profile)
    val newClaim=archive.claim(db.profiles.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals(newClaim.jobId,next.jobId); assertEquals(newClaim.targetEpoch,1L)
    assert(archive.publishProblems(newClaim,CurrentIndexDatabase.publication(newClaim,true)))
    assertNotEquals(archive.session("a",first.sessionId).view,latest)
    pinned.foreach { (pin,expected) => assertEquals(archive.pageChunks("a",first.sessionId,0,100,Some(pin)),expected) }
    assertEquals(rows(db,"ch_reindex_members"),Nil)
  }}

  test("stale epoch, foreign preview and altered replay cannot change the target; exact replay is a historical receipt") { fixture() { (browser,g,old) =>
    val db=g.db; val first=browser.preview(browser.a); val b=browser.preview(browser.b)
    assertNotEquals(first.string("selectionHash"),b.string("selectionHash"),"the selection cannot be reused by another owner at the same target and epoch")
    assertEquals(browser.apply(browser.b,b.string("actor"),payload(first,UUID.randomUUID())).code,"conflict")
    db.transaction(c => Sql.exec(c,"UPDATE ch_owner_targets SET epoch=epoch+1 WHERE owner='a'"))
    assertEquals(browser.apply(browser.a,first.string("actor"),payload(first,UUID.randomUUID())).code,"conflict")
    assertEquals(rows(db,"ch_mutations"),Nil)
    val fresh=browser.preview(browser.a); val id=UUID.randomUUID(); val request=payload(fresh,id)
    assertEquals(browser.apply(browser.a,fresh.string("actor"),withField(request,"targetProfile",Json.fromString("0"*64))).code,"conflict")
    val accepted=browser.apply(browser.a,fresh.string("actor"),request)
    assertEquals(accepted.status,Status.Ok)
    assertEquals(browser.apply(browser.a,fresh.string("actor"),withField(request,"selectionHash",Json.fromString("1"*64))).code,"conflict")

    // A different deployment is preferred now and the owner really switches back. Replaying a committed receipt
    // cannot repeat the first switch even when the old target profile has returned.
    val oldAuth=new Auth(old.db,Fixtures.config())
    val identity=oldAuth.browser(browser.a); val reverse=oldAuth.previewOwnerProfileSwitch(identity)
    oldAuth.applyOwnerProfileSwitch(identity,OwnerProfileSwitch.Apply(UUID.randomUUID(),reverse.targetProfile,reverse.selectionHash),Vector(AccountJson.actor("a")))
    val committed=snapshot(db,List("ch_owner_targets","ch_jobs","ch_mutations"))
    assertEquals(target(db,"a"),OwnerTarget(first.string("currentProfile"),3L))
    assertEquals(browser.apply(browser.a,fresh.string("actor"),request).body,accepted.body)
    assertEquals(snapshot(db,List("ch_owner_targets","ch_jobs","ch_mutations")),committed)
  }}

  test("the HTTP account boundary, locked actor, live browser, bounded JSON and explicit confirmation are mandatory") { fixture() { (browser,g,_) =>
    val good=browser.preview(browser.a); val body=payload(good,UUID.randomUUID()); val actor=good.string("actor")
    val host=browser.host; val origin="Origin"->browser.origin; val contentType="Content-Type"->"application/json"
    val actorHeader="X-Account-Actor"->actor
    def denied(answer: Answer,status: Status,code: String): Unit = {
      assertEquals(answer.status,status); assertEquals(answer.code,code)
      assertEquals(answer.body,AccountJson.failure(code))
    }
    denied(browser.preview(""),Status.Unauthorized,"unauthorized")
    List(List.empty[(String,String)],List("Sec-Fetch-Site"->"same-site"),List("Origin"->"https://unrelated.invalid"),
      List(origin,"Authorization"->"Bearer synthetic"),List(origin,"Cookie"->s"chronicle_session=${browser.b}")).foreach { headers =>
      denied(browser.request(Method.GET,browser.a,headers),Status.Forbidden,"forbidden")
    }
    denied(browser.request(Method.GET,browser.a,List(origin),authority="unrelated.invalid"),Status.Forbidden,"forbidden")
    denied(browser.request(Method.GET,browser.a,List(origin),url=path+"?owner=b"),Status.BadRequest,"invalid")
    assertEquals(browser.request(Method.GET,browser.a,List(origin),authority=host).status,Status.Ok)
    denied(browser.apply(browser.b,actor,body),Status.Conflict,"conflict")
    denied(browser.apply("",actor,body),Status.Unauthorized,"unauthorized")
    List(List(contentType,actorHeader),List(origin,contentType,actorHeader,"Sec-Fetch-Site"->"cross-site"),
      List(origin,contentType,actorHeader,"Authorization"->"Bearer synthetic")).foreach { headers =>
      denied(browser.request(Method.POST,browser.a,headers,Some(body.noSpaces)),Status.Forbidden,"forbidden")
    }
    List(List(origin,contentType),List(origin,actorHeader),List(origin,contentType,actorHeader,"X-Account-Actor"->actor)).foreach { headers =>
      denied(browser.request(Method.POST,browser.a,headers,Some(body.noSpaces)),Status.BadRequest,"invalid")
    }
    List(withField(body,"confirm",Json.False).noSpaces,withField(body,"ownerId",Json.fromString("b")).noSpaces,
      withField(body,"requestId",Json.fromString("1-2-3-4-5")).noSpaces,
      body.noSpaces.dropRight(1)+",\"confirm\":true}").foreach { raw =>
      denied(browser.request(Method.POST,browser.a,List(origin,contentType,actorHeader),Some(raw)),Status.BadRequest,"invalid")
    }
    denied(browser.request(Method.POST,browser.a,List(origin,contentType,actorHeader),Some(" "*1025)),Status.PayloadTooLarge,"too-large")
    val identity=g.auth.browser(browser.a)
    val noRead=identity.copy(user=identity.user.copy(scopes=Nil))
    assertEquals(intercept[DomainError](g.auth.previewOwnerProfileSwitch(noRead)).code,"forbidden")
    assertEquals(intercept[DomainError](g.auth.applyOwnerProfileSwitch(noRead,OwnerProfileSwitch.decode(body),Vector(actor))).code,"forbidden")
    g.auth.logout(identity)
    denied(browser.preview(browser.a),Status.Unauthorized,"unauthorized")
    denied(browser.apply(browser.a,actor,body),Status.Unauthorized,"unauthorized")
    assertEquals(intercept[DomainError](g.auth.applyOwnerProfileSwitch(identity,OwnerProfileSwitch.decode(body),Vector(actor))).code,"unauthorized")
    assertEquals(rows(g.db,"ch_mutations"),Nil)
  }}

  test("incompatible embedding spaces fail closed; a failed invalidation rolls back target and receipt together") {
    fixture(incompatible=true) { (browser,g,old) =>
      val prior=target(g.db,"a")
      val before=snapshot(g.db,List("ch_owner_targets","ch_jobs","ch_mutations"))
      val answer=browser.preview(browser.a)
      assertEquals((answer.status,answer.code),(Status.ServiceUnavailable,"unavailable"))
      assertEquals(prior.profile,old.db.profiles.preferred.profile)
      assertEquals(snapshot(g.db,List("ch_owner_targets","ch_jobs","ch_mutations")),before)
    }
    fixture() { (browser,g,old) =>
      val queued=old.ingest("a",Fixtures.snapshot())
      g.db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET fence=? WHERE id=?",Long.MaxValue,queued.jobId))
      val plan=browser.preview(browser.a)
      val before=snapshot(g.db,List("ch_owner_targets","ch_jobs","ch_mutations"))
      val answer=browser.apply(browser.a,plan.string("actor"),payload(plan,UUID.randomUUID()))
      assertEquals((answer.status,answer.code),(Status.ServiceUnavailable,"unavailable"))
      assertEquals(snapshot(g.db,List("ch_owner_targets","ch_jobs","ch_mutations")),before)
    }
  }
}
