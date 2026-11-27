package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import org.http4s.client.Client
import ponygirls.auth.{IndexingChoice,IndexingPreferenceSql,IndexingService}
import ponygirls.runtime.JdbcFailure
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.*
import ProviderBackoffFixtures.*

/** The hold of `indexing.providerBackoff` (design note 20261126-1845 §3.3, §7; owner's decisions Q178 items 2, 3, 5, 6) on
  * PostgreSQL, through the production annotator, embedder and ModelHttp against the loopback provider stub. Section names
  * follow the note's test section: Hold rows, Classification, Streak, Ledger, Fenced record, Retry. */
class ProviderHoldTest extends munit.FunSuite {
  private val orders=List(ClaimOrderSetting.SourceId,ClaimOrderSetting.Waiting)
  private def modeName(order: ClaimOrderSetting,continuations: Boolean): String = s"claimOrder ${order.key}, continuations ${if(continuations) "on" else "off"}"
  private final case class Scenario(config: Config,db: Database,archive: PostgresArchive,stub: ProviderStub,client: Client[IO]) {
    val log=new WorkerLog
    def worker(archive: SessionArchive=archive,config: Config=config): Worker = ProviderBackoffFixtures.worker(archive,config,client,log.logger)
    def claim(w: Worker,config: Config=config): Boolean = once(w,config)
    def row(id: UUID): JobRow = ProviderBackoffFixtures.row(db,id)
    /** The hold's end passed: `lease_until` set one second back (the claim filters by it, ClaimOrder / Jobs.claimable). */
    def rewind(id: UUID): Unit = set(id,"lease_until=clock_timestamp()-interval '1 second'")
    def set(id: UUID,assignments: String): Unit = db.transaction { c => Sql.exec(c,s"UPDATE ch_jobs SET $assignments WHERE id=?",id); () }
    def is(id: UUID,predicate: String): Boolean = db.transaction(c => Sql.one(c,s"SELECT $predicate FROM ch_jobs WHERE id=?",id)(_.getBoolean(1)).get)
    def text(id: UUID,column: String): Option[String] = db.transaction(c => Sql.one(c,s"SELECT $column::text FROM ch_jobs WHERE id=?",id)(r => Option(r.getString(1))).flatten)
    def lines(prefix: String): List[String] = log.lines.filter(_.startsWith(prefix))
    def ingest(owner: String,request: chronicle.api.IngestRequest=Fixtures.snapshot()): UUID = archive.ingest(owner,request).jobId
  }
  private def scenario(order: ClaimOrderSetting=ClaimOrderSetting.SourceId,continuations: Boolean=false,backoff: Boolean=true,adjust: Config => Config=identity)(f: Scenario => Unit): Unit = {
    val config=configured(ClaimOrderPostgres.config(),order,continuations,backoff)
    provider.use { (stub,client) => IO {
      ClaimOrderPostgres.withDatabase(adjust(stub.configure(config))) { (c,db,a) => f(Scenario(c,db,a,stub,client)) }
    }}.unsafeRunSync()
  }
  /** Held: Queued with a next attempt time `delay(hold)` from about now, the shared count at `hold`. */
  private def assertHeld(row: JobRow,attempts: Int,error: String,stage: String,hold: Int)(using loc: munit.Location): Unit = {
    assertEquals(row.copy(leaseSeconds=None),JobRow("Queued",attempts,Some(error),Some(stage),None,hold))
    val interval=Jobs.transientBackoff.delay(hold).toSeconds.toDouble
    assert(row.leaseSeconds.exists(s => s>interval-5 && s<=interval),s"held for $interval s: $row")
  }
  private def heldLine(id: UUID,status: String,stage: String,failureClass: String,hold: Int,reservation: String): String =
    s"job held jobId=$id code=model-http httpStatus=$status stage=$stage class=$failureClass hold=$hold holdEnds=\\S+ reservation=$reservation"
  private val transientFailure=JdbcFailure("database-unavailable",Some("08006"))

  // ---- Hold rows ----
  for(status <- ProviderBackoff.refundedStatuses.toList.sorted++ProviderBackoff.chargedStatuses.toList.sorted) {
    val refunded=ProviderBackoff.refundedStatuses(status); val failureClass=if(refunded) "refunded" else "charged"
    test(s"Hold rows: HTTP $status at annotation holds the job for the first interval, its attempt $failureClass, with one hold line; the held job is not claimed") { scenario() { s =>
      s.stub.chat=_ => status
      val id=s.ingest("a"); val w=s.worker()
      assert(s.claim(w))
      assertHeld(s.row(id),if(refunded) 0 else 1,"model-http","Annotation",1)
      val held=s.lines("job held"); assertEquals(held.size,1)
      assert(held.head.matches(heldLine(id,status.toString,"Annotation",failureClass,1,"1")),held.head)
      assert(!s.claim(w)); assertEquals(s.stub.chatCalls.get,1)
    }}
  }
  for(order <- orders; continuations <- List(false,true)) {
    test(s"Hold rows: HTTP 504, a deadline and HTTP 503 at embedding hold the job (charged, charged, refunded) for 1, 2 and 4 minutes; the annotation checkpoint survives the holds and is reused, and the job completes (${modeName(order,continuations)})") {
      // The annotation deadline (and with it the client's transport deadline) above the embedding one: the stalled embedding
      // call ends model-timeout at its own deadline.
      scenario(order,continuations,adjust=c => c.copy(annotation=c.annotation.copy(timeoutSeconds=3))) { s =>
        s.stub.embedding=n => n match { case 1 => 504; case 3 => 503; case _ => 200 }
        s.stub.stall=(path,n) => path=="/embedding" && n==2
        val id=s.ingest("a"); val w=s.worker()
        assert(s.claim(w)); assertHeld(s.row(id),1,"model-http","Embedding",1)
        s.rewind(id); assert(s.claim(w)); assertHeld(s.row(id),2,"model-timeout","Embedding",2)
        s.rewind(id); assert(s.claim(w)); assertHeld(s.row(id),2,"model-http","Embedding",3)
        s.rewind(id); assert(s.claim(w))
        assertEquals(s.row(id).state,"Complete")
        assertEquals((s.stub.chatCalls.get,s.stub.embeddingCalls.get),(1,4),"one annotation call: its checkpoint is reused by every later attempt")
        val held=s.lines("job held")
        assertEquals(held.map(_.replaceAll("holdEnds=\\S+","")),List(
          s"job held jobId=$id code=model-http httpStatus=504 stage=Embedding class=charged hold=1  reservation=none",
          s"job held jobId=$id code=model-timeout httpStatus=unavailable stage=Embedding class=charged hold=2  reservation=none",
          s"job held jobId=$id code=model-http httpStatus=503 stage=Embedding class=refunded hold=3  reservation=none"))
      }
    }
  }
  test("Hold rows: a transport failure at embedding (connection refused) holds the job with its attempt charged") {
    scenario(adjust=c => c.copy(embedding=c.embedding.copy(endpoint="http://127.0.0.1:1/embedding"))) { s =>
      val id=s.ingest("a"); assert(s.claim(s.worker()))
      assertHeld(s.row(id),1,"model-transport","Embedding",1)
    }
  }
  test("Hold rows: a held job keeps waiting_since and bulk; a hold clears its window counts (a sized job is sized again), and lane 0 of the waiting order takes a sized job and holds it like any other") {
    scenario(ClaimOrderSetting.Waiting) { s =>
      s.stub.chat=_ => 429
      val id=s.ingest("a")
      s.set(id,"waiting_since='2026-11-25T10:01:00Z',bulk=true,total_windows=150")
      assert(s.worker().onceInLane(ClaimLane.of(0,1)).unsafeRunSync(),"lane 0 takes the sized job")
      assertHeld(s.row(id),0,"model-http","Annotation",1)
      assert(s.is(id,"waiting_since='2026-11-25T10:01:00Z' AND bulk AND total_windows IS NULL AND completed_windows=0"))
    }
  }
  test("Hold rows: a large job held at annotation is sized and deferred again without a model call before lane 0 takes it again (waiting order)") {
    scenario(ClaimOrderSetting.Waiting) { s =>
      s.stub.chat=n => if(n==1) 429 else 200
      val id=s.ingest("a",ProviderSources.source((LargeJobs.windows+1)*ProblemPassages.maximumWindowFragments))
      val w=s.worker(); val fresh=ClaimLane.of(2,1); val lane0=ClaimLane.of(0,1)
      assert(w.onceInLane(fresh).unsafeRunSync()); assertEquals((s.row(id).state,s.row(id).attempts),("Queued",0),"deferred, refunded")
      assert(s.is(id,s"total_windows>${LargeJobs.windows}"),"sized")
      assert(w.onceInLane(lane0).unsafeRunSync()); assertHeld(s.row(id),0,"model-http","Annotation",1)
      assertEquals(s.text(id,"total_windows"),None)
      s.rewind(id)
      assert(w.onceInLane(fresh).unsafeRunSync()); assertEquals(s.row(id).state,"Queued"); assert(s.is(id,s"total_windows>${LargeJobs.windows}"),"sized and deferred again")
      assertEquals(s.stub.chatCalls.get,1,"the deferral calls no model")
    }
  }
  for(order <- orders) {
    test(s"Hold rows: the claim passes a held job by and it returns at its old place once its hold ends (claimOrder ${order.key})") { scenario(order) { s =>
      s.stub.chat=n => if(n==1) 429 else 200
      val jobs=List("a","b","c").zipWithIndex.map { (owner,i) => val id=s.ingest(owner); s.set(id,f"waiting_since='2026-11-25T10:0${i+1}:00Z',bulk=false"); id }
      val (first,second,third)=(jobs(0),jobs(1),jobs(2)); val w=s.worker()
      assert(s.claim(w)); assertHeld(s.row(first),0,"model-http","Annotation",1)
      assert(s.claim(w)); assertEquals(jobs.map(s.row(_).state),List("Queued","Complete","Queued"),"the held job is passed by")
      s.rewind(first)
      assert(s.claim(w)); assertEquals(jobs.map(s.row(_).state),List("Complete","Complete","Queued"),"at its old place: before the younger job")
      assert(s.is(first,"waiting_since='2026-11-25T10:01:00Z' AND NOT bulk"))
      assert(s.claim(w)); assertEquals(s.row(third).state,"Complete")
    }}
  }
  test("Hold rows: a kept partial answer (annotation continuations) survives a hold and the next attempt resumes it") {
    scenario(continuations=true) { s =>
      s.stub.chat=n => if(n==2) 429 else 200
      s.stub.partial=_==1
      val id=s.ingest("a",ProviderSources.source(4)); val w=s.worker()
      assert(s.claim(w)); assertHeld(s.row(id),0,"model-http","Annotation",1)
      assertEquals(s.db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_annotation_partials WHERE job_id=?",id)(_.getInt(1)).get),1,"the kept answer is stored")
      s.rewind(id); assert(s.claim(w)); assertEquals(s.row(id).state,"Complete")
      assertEquals(s.lines("annotation partial resumed").size,1)
      assertEquals(s.stub.chatCalls.get,3)
    }
  }

  // ---- Classification (statuses beside the classified ones) ----
  for(status <- List(401,403,404)) {
    test(s"Classification: HTTP $status at annotation is recorded as before (charged, not held, count reset) with one configuration alert line; off, without it") {
      for(backoff <- List(true,false)) scenario(backoff=backoff) { s =>
        s.stub.chat=_ => status
        val id=s.ingest("a"); s.set(id,"transient_failures=3"); assert(s.claim(s.worker()))
        assertEquals(s.row(id),JobRow("Queued",1,Some("model-http"),Some("Annotation"),None,0))
        val alerts=s.lines("model provider configuration alert")
        if(backoff) assertEquals(alerts,List(s"model provider configuration alert jobId=$id stage=Annotation code=model-http httpStatus=$status: recorded as before, not held"))
        else assertEquals(alerts,Nil)
        assertEquals(s.lines("job held"),Nil)
        assertEquals(s.lines("job failed").size,1)
      }
    }
  }
  for(status <- List(400,409,501,505)) {
    test(s"Classification: HTTP $status at annotation is recorded as before, without a hold or an alert") { scenario() { s =>
      s.stub.chat=_ => status
      val id=s.ingest("a"); assert(s.claim(s.worker()))
      assertEquals(s.row(id),JobRow("Queued",1,Some("model-http"),Some("Annotation"),None,0))
      assertEquals((s.lines("job held"),s.lines("model provider configuration alert")),(Nil,Nil))
    }}
  }
  test("Classification: off, ModelHttp raises a non-2xx answer as before (class DomainError, the detail names the status); on, as ModelHttpStatus with the response's status") {
    for(backoff <- List(false,true)) scenario(backoff=backoff) { s =>
      s.stub.chat=_ => 503
      val http=ProviderBackoffFixtures.http(s.client,s.config)
      val error=http.post(ModelCallContext("a",ModelWorkload.IndexAnnotation),s.config.annotation.endpoint,s.config.annotation.credentialFile,1,65536,io.circe.Json.obj()).attempt.unsafeRunSync().left.toOption.get
      val (code,detail)=error match { case DomainError(code,detail) => (code,detail); case other => fail(s"not a DomainError: $other") }
      assertEquals((code,detail),("model-http","model returned HTTP 503"))
      if(backoff) assertEquals(ProviderBackoff.status(error),Some(503)) else assertEquals(error.getClass,classOf[DomainError])
    }
  }

  // ---- Streak (the shared count, decision 5) ----
  test("Streak: a charged failure at the attempt limit is terminal (Failed with its code), a refused one at the limit is held with the attempt refunded") { scenario() { s =>
    s.stub.chat=n => if(n==1) 504 else 429
    val charged=s.ingest("a"); s.set(charged,s"attempts=${Jobs.attemptLimit-1}")
    assert(s.claim(s.worker()))
    assertEquals(s.row(charged),JobRow("Failed",Jobs.attemptLimit,Some("model-http"),Some("Annotation"),None,1))
    assertEquals(s.lines("job failed").map(_.replaceAll(" reservation=\\S+","")),List(s"job failed jobId=$charged code=model-http httpStatus=504 stage=Annotation class=charged consecutive=1 limit=attempt-limit"))
    val refused=s.ingest("b"); s.set(refused,s"attempts=${Jobs.attemptLimit-1}")
    assert(s.claim(s.worker()))
    assertHeld(s.row(refused),Jobs.attemptLimit-1,"model-http","Annotation",1)
  }}
  for(last <- List("provider","database")) {
    test(s"Streak: ten failures in a row of either kind without saved progress end the job Failed with the code of the tenth ($last); each earlier one holds it by the shared count") { scenario() { s =>
      // Alternating kinds; the database failures are transient JDBC failures of the first archive read of the attempt.
      val kinds=(1 to 9).map(i => if(i%2==1) "provider" else "database").toList:+last
      val step=new AtomicInteger(0)
      val archive=new ProviderForwardingArchive(s.archive) {
        override def windowWork(c: Claim,key: CheckpointKey): Option[WindowWork] =
          if(kinds(step.get)=="database") throw transientFailure else super.windowWork(c,key)
      }
      s.stub.chat=_ => 429
      val id=s.ingest("a"); val w=s.worker(archive)
      kinds.zipWithIndex.foreach { (kind,i) =>
        step.set(i); assert(s.claim(w))
        val row=s.row(id)
        if(i<9) {
          assertEquals((row.state,row.attempts,row.transientFailures,row.error),("Queued",0,i+1,Some(if(kind=="provider") "model-http" else Jobs.transientCode)),s"failure ${i+1} ($kind)")
          s.rewind(id)
        } else assertEquals((row.state,row.attempts,row.transientFailures,row.error),("Failed",0,10,Some(if(kind=="provider") "model-http" else Jobs.transientCode)),"the tenth")
      }
      assertEquals(s.stub.chatCalls.get,kinds.count(_=="provider"))
      if(last=="provider") assertEquals(s.lines("job failed").map(_.replaceAll(" reservation=\\S+","")),List(s"job failed jobId=$id code=model-http httpStatus=429 stage=Annotation class=refunded consecutive=10 limit=consecutive-limit"))
    }}
  }
  test("Streak: a checkpoint committed by the attempt restarts the count at 1; reusing it in the next attempt does not") { scenario() { s =>
    s.stub.chat=n => if(n==1) 200 else 429
    val id=s.ingest("a",ProviderSources.source(2*ProblemPassages.maximumWindowFragments)); s.set(id,"transient_failures=5")
    val w=s.worker()
    assert(s.claim(w)); assertHeld(s.row(id),0,"model-http","Annotation",1)
    s.rewind(id); assert(s.claim(w)); assertHeld(s.row(id),0,"model-http","Annotation",2)
    assertEquals(s.stub.chatCalls.get,3,"window 0 answered once, then reused")
  }}

  // ---- Ledger (decision 3) ----
  for(continuations <- List(false,true); status <- List(429,504)) {
    val refunded=status==429
    test(s"Ledger: a provider failure (HTTP $status) on its window's tenth reservation fails the job at once with the provider code; on the ninth it is held (continuations ${if(continuations) "on" else "off"})") {
      scenario(continuations=continuations) { s =>
        s.stub.chat=_ => status
        val id=s.ingest("a"); val w=s.worker()
        assert(s.claim(w))
        // Seven earlier unanswered reservations of the window (rows 2-8) beside this attempt's first.
        s.db.transaction { c => Sql.exec(c,"""INSERT INTO ch_annotation_attempts(job_id,run_id,retry_epoch,window_ordinal,attempt,input_hash,fence)
          SELECT job_id,run_id,retry_epoch,window_ordinal,g,input_hash,fence FROM ch_annotation_attempts CROSS JOIN generate_series(2,8) g WHERE job_id=?""",id); () }
        s.rewind(id); assert(s.claim(w))
        assertHeld(s.row(id),if(refunded) 0 else 2,"model-http","Annotation",2)
        s.rewind(id); assert(s.claim(w))
        assertEquals(s.row(id),JobRow("Failed",if(refunded) 0 else 3,Some("model-http"),Some("Annotation"),None,3))
        assertEquals(ledger(s.db,id),AnnotationAttempts.reservationLimit)
        assertEquals(s.lines("job failed").map(_.replaceAll("^job failed jobId=\\S+ ","")),List(s"code=model-http httpStatus=$status stage=Annotation class=${if(refunded) "refunded" else "charged"} consecutive=3 limit=reservation-limit reservation=10"))
        assertEquals(s.lines("job held").map(_.replaceAll("^.* reservation=","")),List("1","9"))
      }
    }
  }

  // ---- Fenced record (review finding 6) ----
  test("Fenced record: a refused record (transient database failure, nothing written) is tried again and holds the job once") { scenario() { s =>
    s.stub.chat=_ => 429
    val tries=new AtomicInteger(0)
    val archive=new ProviderForwardingArchive(s.archive) {
      override def holdProvider(c: Claim,failure: ProviderFailure,deadline: Deadline): ProviderOutcome =
        if(tries.incrementAndGet()==1) throw transientFailure else super.holdProvider(c,failure,deadline)
    }
    val id=s.ingest("a"); assert(s.claim(s.worker(archive)))
    assertEquals(tries.get,2); assertHeld(s.row(id),0,"model-http","Annotation",1); assertEquals(s.lines("job held").size,1)
  }}
  test("Fenced record: a record that committed although its acknowledgement was lost is read again, not written twice: exactly one refund") { scenario() { s =>
    s.stub.chat=_ => 429
    val tries=new AtomicInteger(0)
    val archive=new ProviderForwardingArchive(s.archive) {
      override def holdProvider(c: Claim,failure: ProviderFailure,deadline: Deadline): ProviderOutcome = {
        val outcome=super.holdProvider(c,failure,deadline)
        if(tries.incrementAndGet()==1) throw transientFailure else outcome
      }
    }
    val id=s.ingest("a"); assert(s.claim(s.worker(archive)))
    assertEquals(tries.get,2); assertHeld(s.row(id),0,"model-http","Annotation",1)
    assertEquals(s.lines("job held").size,1)
  }}
  test("Fenced record: a write the fence denies (another claim's fence) records nothing and leaves the charge") { scenario() { s =>
    s.stub.chat=_ => 429
    val archive=new ProviderForwardingArchive(s.archive) {
      override def holdProvider(c: Claim,failure: ProviderFailure,deadline: Deadline): ProviderOutcome = { s.set(c.jobId,"fence=fence+1"); super.holdProvider(c,failure,deadline) }
    }
    val id=s.ingest("a"); assert(s.claim(s.worker(archive)))
    assertEquals((s.row(id).state,s.row(id).attempts,s.row(id).error),("Running",1,None))
    assertEquals(s.lines("job not held").map(_.replaceAll("^job not held jobId=\\S+ ","")),List("code=model-http httpStatus=429 stage=Annotation: the claim ended"))
  }}
  test("Fenced record: the lease ends before the record: nothing is held, the job is reclaimed after its lease (charged again), and at the attempt limit it ends lease-exhausted") { scenario() { s =>
    s.stub.chat=_ => 429
    val expire=new ProviderForwardingArchive(s.archive) {
      override def holdProvider(c: Claim,failure: ProviderFailure,deadline: Deadline): ProviderOutcome = { s.set(c.jobId,"lease_until=clock_timestamp()-interval '1 second'"); super.holdProvider(c,failure,deadline) }
    }
    val id=s.ingest("a"); assert(s.claim(s.worker(expire)))
    assertEquals((s.row(id).state,s.row(id).attempts),("Running",1))
    s.stub.chat=_ => 200
    assert(s.claim(s.worker())); assertEquals((s.row(id).state,s.row(id).attempts),("Complete",2),"reclaimed and charged once more")
    val last=s.ingest("b"); s.set(last,s"attempts=${Jobs.attemptLimit-1}"); s.stub.chat=_ => 429
    assert(s.claim(s.worker(expire))); assertEquals((s.row(last).state,s.row(last).attempts),("Running",Jobs.attemptLimit))
    assert(!s.claim(s.worker()))
    assertEquals((s.row(last).state,s.row(last).error),("Failed",Some("lease-exhausted")))
  }}
  for(backoff <- List(true,false)) {
    test(s"Fenced record: the owner's indexing turned off while the call runs: the job is parked as `fail` parks it (Queued, attempt refunded), not left Running (back-off ${if(backoff) "on" else "off"})") {
      scenario(backoff=backoff) { s =>
        s.stub.chat=_ => 429
        s.stub.beforeChat=_ => s.db.transaction { c => IndexingPreferenceSql.store(c,IndexingService.Chronicle,s.config.indexingPolicy).setOverride("a",IndexingChoice.Disable); () }
        val id=s.ingest("a"); val fence=s.text(id,"fence").get.toLong
        assert(s.claim(s.worker()))
        assertEquals(s.row(id),JobRow("Queued",0,None,None,None,0))
        assertEquals(s.text(id,"fence").map(_.toLong),Some(fence+2),"claimed (+1) and parked (+1)")
        if(backoff) assertEquals(s.lines("job not held").map(_.replaceAll("^job not held jobId=\\S+ ","")),List("code=model-http httpStatus=429 stage=Annotation: the owner's indexing no longer admits the claim, parked"))
      }
    }
  }
  test("Fenced record: a worker lane stays idle for the failure back-off after a hold is recorded, and not shorter") { scenario() { s =>
    s.stub.chat=_ => 429
    val backoff=Worker.FailureBackoff(300.millis)
    @volatile var recordedAt=0L
    val recording=new ProviderForwardingArchive(s.archive) {
      override def holdProvider(c: Claim,failure: ProviderFailure,deadline: Deadline): ProviderOutcome = { val outcome=super.holdProvider(c,failure,deadline); recordedAt=System.nanoTime(); outcome }
    }
    val id=s.ingest("a")
    val w=new Worker(recording,new OpenAIProblemPassageAnnotator(ProviderBackoffFixtures.http(s.client,s.config),s.config),new OpenAIEmbedder(ProviderBackoffFixtures.http(s.client,s.config),s.config),
      s.config,IndexProfileCatalog.current(s.config),ModelAdmission.make(s.config.indexing).unsafeRunSync(),s.log.logger,backoff,ModelFixtures.snapshots)
    assert(s.claim(w))
    val idle=(System.nanoTime()-recordedAt).nanos
    assertHeld(s.row(id),0,"model-http","Annotation",1)
    assert(idle>=backoff.delay,s"worker lane resumed $idle after the hold was recorded")
  }}
  test("Fenced record: a hold that cannot be recorded is logged, the job keeps its lease, and the lane goes on") { scenario() { s =>
    s.stub.chat=n => if(n==1) 429 else 200
    val failing=new ProviderForwardingArchive(s.archive) {
      override def holdProvider(c: Claim,failure: ProviderFailure,deadline: Deadline): ProviderOutcome = throw new IllegalStateException("synthetic record failure")
    }
    val id=s.ingest("a"); val w=s.worker(failing)
    assert(s.claim(w))
    assertEquals((s.row(id).state,s.row(id).attempts,s.row(id).error),("Running",1,None),"nothing recorded: the job keeps its lease")
    val unrecorded=s.lines("job failure not recorded"); assertEquals(unrecorded.size,1)
    assert(unrecorded.head.matches(s"job failure not recorded jobId=$id failureCode=model-http code=worker-fault exceptionClass=java\\.lang\\.IllegalStateException sqlState=unavailable origin=\\S+"),unrecorded.head)
    val other=s.ingest("b"); assert(s.claim(w)); assertEquals(s.row(other).state,"Complete")
  }}
  test("Fenced record: a held job stays held while its owner's indexing is off and after it is on again, until its hold ends") { scenario() { s =>
    s.stub.chat=n => if(n==1) 429 else 200
    val id=s.ingest("a"); val w=s.worker()
    assert(s.claim(w)); val held=s.text(id,"lease_until")
    def owner(choice: IndexingChoice): Unit = s.db.transaction { c => IndexingPreferenceSql.store(c,IndexingService.Chronicle,s.config.indexingPolicy).setOverride("a",choice); () }
    owner(IndexingChoice.Disable); assert(!s.claim(w)); owner(IndexingChoice.Enable); assert(!s.claim(w))
    assertEquals((s.row(id).state,s.text(id,"lease_until")),("Queued",held))
    s.rewind(id); assert(s.claim(w)); assertEquals(s.row(id).state,"Complete")
  }}
  test("Fenced record: an upload while the call runs supersedes the job instead of holding it; its successor is not held") { scenario() { s =>
    s.stub.chat=n => if(n==1) 429 else 200
    val first=ProviderSources.source(1); val id=s.ingest("a",first)
    @volatile var successor=Option.empty[UUID]
    s.stub.beforeChat=n => if(n==1) successor=Some(s.archive.ingest("a",ProviderSources.append(first,2,1)).jobId)
    assert(s.claim(s.worker()))
    assertEquals((s.row(id).state,s.row(id).error),("Failed",Some(Jobs.supersededRevision)))
    assertEquals(s.row(successor.get),JobRow("Queued",0,None,None,None,0))
    assertEquals(s.lines("job not held").map(_.replaceAll("^job not held jobId=\\S+ ","")),List("code=model-http httpStatus=429 stage=Annotation: the claim ended"))
  }}
  test("Fenced record: an upload over a held job supersedes it; the successor keeps its age and class and is not held") { scenario() { s =>
    s.stub.chat=_ => 429
    val first=ProviderSources.source(1); val id=s.ingest("a",first); s.set(id,"waiting_since='2026-11-25T10:01:00Z',bulk=true")
    assert(s.claim(s.worker())); assertHeld(s.row(id),0,"model-http","Annotation",1)
    val successor=s.archive.ingest("a",ProviderSources.append(first,2,1)).jobId
    assertEquals((s.row(id).state,s.row(id).error),("Failed",Some(Jobs.supersededRevision)))
    assertEquals(s.row(successor),JobRow("Queued",0,None,None,None,0))
    assert(s.is(successor,"waiting_since='2026-11-25T10:01:00Z' AND bulk AND lease_until IS NULL"))
  }}
  test("Fenced record: a restart while a job is held keeps the hold (row unchanged) and the job is claimed once it ends") { scenario() { s =>
    s.stub.chat=n => if(n==1) 429 else 200
    val id=s.ingest("a"); assert(s.claim(s.worker()))
    val before=(s.text(id,"state"),s.text(id,"attempts"),s.text(id,"lease_until"),s.text(id,"transient_failures"),s.text(id,"error"),s.text(id,"waiting_since"))
    scala.util.Using.resource(new Database(s.config,IndexProfileCatalog.current(s.config))) { restarted =>
      restarted.initialize()
      val archive=new PostgresArchive(restarted,s.config)
      assertEquals((s.text(id,"state"),s.text(id,"attempts"),s.text(id,"lease_until"),s.text(id,"transient_failures"),s.text(id,"error"),s.text(id,"waiting_since")),before)
      val w=s.worker(archive)
      assert(!s.claim(w)); s.rewind(id); assert(s.claim(w)); assertEquals(s.row(id).state,"Complete")
    }
  }}

  // ---- Off after on (decision 5, rollback) ----
  test("Off after on: with held rows and spent reservations, a restart with the flag off leaves them held until their hold ends; then a provider failure is recorded as before (charged, Queued at once, count reset), as in an all-off run except the refunded attempt and the spent reservation") {
    scenario() { s =>
      s.stub.chat=_ => 429
      val held=s.ingest("b"); assert(s.claim(s.worker())); assertHeld(s.row(held),0,"model-http","Annotation",1)
      val off=s.config.copy(indexing=s.config.indexing.copy(providerBackoff=false))
      scala.util.Using.resource(new Database(off,IndexProfileCatalog.current(off))) { restarted =>
        restarted.initialize()
        val w=s.worker(new PostgresArchive(restarted,off),off)
        assert(!s.claim(w,off),"held until its hold ends"); assertHeld(s.row(held),0,"model-http","Annotation",1)
        s.rewind(held); assert(s.claim(w,off))
        assertEquals(s.row(held),JobRow("Queued",1,Some("model-http"),Some("Annotation"),None,0),"recorded as before")
        assertEquals(ledger(s.db,held),2,"the reservation spent while on stays spent")
        val baseline=s.ingest("a"); assert(s.claim(w,off))
        assertEquals(s.row(baseline),s.row(held),"the all-off row")
        assertEquals(ledger(s.db,baseline),1)
        assertEquals(s.lines("job held").size,1,"no hold after the switch")
      }
    }
  }
  test("Off after on: the shared count carries over: a database hold with the flag off after two provider holds is the third in a row") {
    scenario() { s =>
      s.stub.chat=_ => 429
      val id=s.ingest("a"); val w=s.worker()
      assert(s.claim(w)); s.rewind(id); assert(s.claim(w)); assertHeld(s.row(id),0,"model-http","Annotation",2)
      s.rewind(id)
      val off=s.config.copy(indexing=s.config.indexing.copy(providerBackoff=false))
      val failing=new ProviderForwardingArchive(s.archive) {
        override def windowWork(c: Claim,key: CheckpointKey): Option[WindowWork] = throw transientFailure
      }
      assert(s.claim(s.worker(failing,off),off))
      val row=s.row(id)
      assertEquals(row.copy(leaseSeconds=None),JobRow("Queued",0,Some(Jobs.transientCode),None,None,3))
      assert(row.leaseSeconds.exists(seconds => seconds>235 && seconds<=240),row.toString)
    }
  }

  // ---- Retry (decision 6) ----
  test("Retry: RetryJob on a held job clears the hold and the count and moves it to the back of the fresh class; it is claimed at once") { scenario() { s =>
    s.stub.chat=n => if(n==1) 429 else 200
    val id=s.ingest("a"); s.set(id,"waiting_since='2026-11-25T10:01:00Z',bulk=true"); assert(s.claim(s.worker()))
    s.archive.retry("a",id)
    assertEquals(s.row(id),JobRow("Queued",0,Some("model-http"),Some("Annotation"),None,0))
    assert(s.is(id,"NOT bulk AND waiting_since>'2026-11-25T10:01:00Z'"))
    assert(s.claim(s.worker())); assertEquals(s.row(id).state,"Complete")
  }}
  test("Retry: \"retry failed\" retries a job Failed with a provider code and leaves a held job held") { scenario() { s =>
    s.stub.chat=_ => 429
    val held=s.ingest("a"); assert(s.claim(s.worker())); val lease=s.text(held,"lease_until")
    val failed=s.ingest("a"); s.set(failed,s"state='Failed',attempts=${Jobs.attemptLimit},error='model-http',failure_stage='Annotation'")
    val plan=s.db.transaction { c => c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ); RetryFailedJobs.preview(c,"a") }
    s.db.transaction(c => RetryFailedJobs(c,"a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true))
    assertEquals((s.row(failed).state,s.row(failed).attempts),("Queued",0))
    assertEquals((s.row(held).state,s.row(held).attempts,s.text(held,"lease_until"),s.row(held).transientFailures),("Queued",0,lease,1))
  }}
}

/** The provider back-off classification (owner's decision Q178 item 2) as a table of status (or code) by stage. */
class ProviderBackoffClassificationTest extends munit.FunSuite {
  private val stages: List[Option[IndexingStage]] = List(Some(IndexingStage.Annotation),Some(IndexingStage.Embedding),Some(IndexingStage.Publication),None)
  private def http(status: Int): Throwable = new ModelHttpStatus(status,s"model returned HTTP $status")
  test("Classification: status x stage: 429/503/529 refunded and 500/502/504/408 charged at annotation and embedding; every other status recorded as before; nothing outside the model stages") {
    val statuses=(List(100,200,301)++(400 to 431)++List(451)++(500 to 511)++(520 to 530)).distinct
    for(stage <- stages; status <- statuses) {
      val expected=
        if(!stage.exists(s => s==IndexingStage.Annotation || s==IndexingStage.Embedding)) None
        else if(Set(429,503,529)(status)) Some(ProviderFailureClass.Refunded)
        else if(Set(500,502,504,408)(status)) Some(ProviderFailureClass.Charged)
        else None
      assertEquals(ProviderBackoff.classify(stage,http(status)),expected,s"$status at $stage")
      assertEquals(ProviderBackoff.alert(stage,http(status)),Option.when(expected.isEmpty && stage.exists(_!=IndexingStage.Publication) && Set(401,403,404)(status))(status),s"alert $status at $stage")
    }
  }
  test("Classification: model-timeout and model-transport are charged at annotation and embedding; model-output, a status known only from text, a worker fault and terminal codes are recorded as before") {
    for(stage <- stages) {
      val model=stage.exists(s => s==IndexingStage.Annotation || s==IndexingStage.Embedding)
      assertEquals(ProviderBackoff.classify(stage,DomainError("model-timeout","model deadline exceeded")),Option.when(model)(ProviderFailureClass.Charged))
      assertEquals(ProviderBackoff.classify(stage,DomainError("model-transport","model transport failed")),Option.when(model)(ProviderFailureClass.Charged))
      List[Throwable](DomainError("model-http","model returned HTTP 429"),DomainError("model-output","invalid embedding"),ModelRejection.from(ModelRejectionReason.ModelJsonInvalid),
        DomainError(AnnotationAttempts.reservationExhaustedCode,"x"),DomainError("stale-claim","x"),new RuntimeException("x")).foreach { error =>
        assertEquals(ProviderBackoff.classify(stage,error),None,s"$error at $stage")
      }
    }
  }
}
