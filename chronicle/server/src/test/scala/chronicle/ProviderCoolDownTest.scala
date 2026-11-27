package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import ProviderBackoffFixtures.*

/** The lane cool-down of `indexing.providerBackoff` (design note 20261126-1845 §3.5, option c; owner's decision Q177): the
  * state machine, and the lanes on PostgreSQL against the loopback provider stub with a cool-down given through the Worker
  * constructor (the production default is asserted on its own). */
class ProviderCoolDownTest extends munit.FunSuite {
  private val annotation=IndexingStage.Annotation; private val embedding=IndexingStage.Embedding
  private def attempt(failed: Option[IndexingStage],answered: IndexingStage*): Worker.Attempt = Worker.Attempt(failed,answered.toSet)

  test("Cool-down: the production default is 1, 2, 4, 8, then 15 minutes") {
    assertEquals((1 to 7).map(Worker.CoolDown.production.delay).toList,List(1,2,4,8,15,15,15).map(_.minutes))
  }
  test("Cool-down: each provider failure of the lane without a reset raises its level; the pause follows the schedule up to its cap") {
    val pause=new Worker.LanePause(Worker.CoolDown(1.second,2,5.seconds))
    assertEquals((1 to 6).map(_ => pause.after(attempt(Some(annotation))).delay).toList,List(1,2,4,5,5,5).map(_.seconds))
  }
  test("Cool-down: only a completed 2xx of the upstream that failed last, in a later attempt, resets the level; the other upstream's 2xx, attempts without a provider failure and other failures do not") {
    val pause=new Worker.LanePause(Worker.CoolDown(1.second,2,1.hour))
    assertEquals(pause.after(attempt(Some(annotation))),Worker.PauseChange(None,Some((annotation,1,1.second))))
    assertEquals(pause.after(attempt(None,embedding)),Worker.PauseChange(None,None),"the other upstream's 2xx: no reset, no pause")
    assertEquals(pause.after(attempt(None)),Worker.PauseChange(None,None),"an attempt without an answer or a provider failure (another failure, a deferral)")
    assertEquals(pause.current,(1,Some(annotation)))
    assertEquals(pause.after(attempt(Some(annotation))).delay,2.seconds)
    assertEquals(pause.after(attempt(Some(embedding),annotation)),Worker.PauseChange(Some(annotation),Some((embedding,1,1.second))),"reset by the failed upstream's 2xx, then the attempt's own failure starts again at the first pause")
    assertEquals(pause.after(attempt(Some(embedding),annotation)).delay,2.seconds,"the annotation 2xx does not reset an embedding failure")
    assertEquals(pause.after(attempt(None,embedding)),Worker.PauseChange(Some(embedding),None))
    assertEquals(pause.current,(0,None))
    assertEquals(pause.after(attempt(Some(annotation))).delay,1.second)
  }
  test("Cool-down: an answer counts as a completed 2xx when the call returned or its answer was rejected for its content; a non-2xx status, a deadline or a transport failure does not") {
    assert(Worker.Answers.answered(Right(())))
    assert(Worker.Answers.answered(Left(ModelRejection.from(ModelRejectionReason.ModelJsonInvalid))))
    assert(Worker.Answers.answered(Left(DomainError("model-output","invalid embedding"))))
    assert(Worker.Answers.answered(Left(DomainError("model-output/truncated","x"))))
    List[Throwable](new ModelHttpStatus(429,"model returned HTTP 429"),DomainError("model-http","model returned HTTP 200"),DomainError("model-timeout","model deadline exceeded"),
      DomainError("model-transport","model transport failed"),DomainError("stale-claim","x"),new RuntimeException("x")).foreach(error => assert(!Worker.Answers.answered(Left(error)),error.toString))
  }

  private final case class Lanes(config: Config,db: Database,archive: PostgresArchive,stub: ProviderStub,client: org.http4s.client.Client[IO],log: WorkerLog) {
    def row(id: UUID): JobRow = ProviderBackoffFixtures.row(db,id)
    def rewind(id: UUID): Unit = db.transaction { c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",id); () }
  }
  private def lanes(order: ClaimOrderSetting,backoff: Boolean=true)(f: Lanes => Unit): Unit = {
    val config=configured(ClaimOrderPostgres.config(),order,continuations=false,backoff=backoff)
    provider.use { (stub,client) => IO {
      ClaimOrderPostgres.withDatabase(stub.configure(config)) { (c,db,a) => f(Lanes(c,db,a,stub,client,new WorkerLog)) }
    }}.unsafeRunSync()
  }
  private val coolDown=Worker.CoolDown(1.second,2,8.seconds)
  for(order <- List(ClaimOrderSetting.SourceId,ClaimOrderSetting.Waiting)) {
    val index=if(order==ClaimOrderSetting.Waiting) 2 else 0
    test(s"Cool-down: a lane pauses 1, 2, 4 by its level after its provider failures; the failed upstream's 2xx resets it, the other's does not; another failure keeps the level; a restart starts again at the first pause (claimOrder ${order.key})") {
      lanes(order) { l =>
        val id=l.archive.ingest("a",Fixtures.snapshot()).jobId
        // Chat: 429 three times, 400 once, 429, then answers; embedding: 503 twice, then answers.
        l.stub.chat=n => if(n<=3 || n==5) 429 else if(n==4) 400 else 200
        l.stub.embedding=n => if(n<=2) 503 else 200
        val w=workerWith(l.archive,l.config,l.client,l.log.logger,ModelAdmission.make(l.config.indexing).unsafeRunSync(),coolDown)
        val lane=new w.Lane(index)
        def next(): FiniteDuration = { val pause=w.step(lane).unsafeRunSync(); if(l.row(id).state=="Queued") l.rewind(id); pause }
        assertEquals(List.fill(3)(next()),List(1,2,4).map(_.seconds),"429, 429, 429 at annotation")
        assertEquals(next(),Duration.Zero,"HTTP 400: recorded as before, no pause")
        assertEquals(next(),8.seconds,"429 again: the level was kept")
        assertEquals(next(),1.second,"annotation answered (reset), then 503 at embedding: the first pause")
        assertEquals(next(),2.seconds,"503 at embedding again: the annotation checkpoint is reused, no embedding 2xx")
        assertEquals(next(),Duration.Zero,"embedding answered: the job completes and the level is reset")
        assertEquals(l.row(id).state,"Complete")
        assertEquals(lane.pause.current,(0,None))
        assertEquals(l.log.lines.filter(_.startsWith("indexing lane")),List(
          s"indexing lane paused lane=$index upstream=Annotation level=1 pauseSeconds=1",s"indexing lane paused lane=$index upstream=Annotation level=2 pauseSeconds=2",
          s"indexing lane paused lane=$index upstream=Annotation level=3 pauseSeconds=4",s"indexing lane paused lane=$index upstream=Annotation level=4 pauseSeconds=8",
          s"indexing lane cool-down reset lane=$index upstream=Annotation",s"indexing lane paused lane=$index upstream=Embedding level=1 pauseSeconds=1",
          s"indexing lane paused lane=$index upstream=Embedding level=2 pauseSeconds=2",s"indexing lane cool-down reset lane=$index upstream=Embedding"))
        val again=l.archive.ingest("a",Fixtures.snapshot()).jobId; l.stub.chat=_ => 429
        assertEquals(w.step(lane).unsafeRunSync(),1.second)
        l.rewind(again)
        assertEquals(w.step(lane).unsafeRunSync(),2.seconds)
        l.rewind(again)
        val restarted=workerWith(l.archive,l.config,l.client,l.log.logger,ModelAdmission.make(l.config.indexing).unsafeRunSync(),coolDown)
        assertEquals(restarted.step(new restarted.Lane(index)).unsafeRunSync(),1.second,"a restart clears the cool-down")
      }
    }
  }
  test("Cool-down: off, a lane never pauses after a provider failure") { lanes(ClaimOrderSetting.SourceId,backoff=false) { l =>
    l.archive.ingest("a",Fixtures.snapshot()); l.stub.chat=_ => 429
    val w=workerWith(l.archive,l.config,l.client,l.log.logger,ModelAdmission.make(l.config.indexing).unsafeRunSync(),coolDown)
    val lane=new w.Lane(0)
    assertEquals(List.fill(3)(w.step(lane).unsafeRunSync()),List.fill(3)(Duration.Zero))
    assertEquals(l.log.lines.filter(_.startsWith("indexing lane")),Nil)
  }}
  test("Cool-down: a paused lane makes no claim before its pause ends and claims again after it, while the other lanes keep claiming (waiting order, 3 lanes)") {
    lanes(ClaimOrderSetting.Waiting) { l =>
      val pause=4.seconds
      val claims=new ConcurrentLinkedQueue[(Int,Long,Option[UUID])]()
      @volatile var held=Option.empty[Long]
      val traced=new ProviderForwardingArchive(l.archive) {
        override def claimInLane(profiles: Set[String],scope: ClaimScope,lease: Int,lane: ClaimLane): ClaimOutcome = {
          val outcome=super.claimInLane(profiles,scope,lease,lane)
          claims.add((lane.index,System.nanoTime(),outcome match { case ClaimOutcome.Claimed(c) => Some(c.jobId); case _ => None })); outcome
        }
        override def holdProvider(c: Claim,failure: ProviderFailure,deadline: Deadline): ProviderOutcome = { val outcome=super.holdProvider(c,failure,deadline); held=Some(System.nanoTime()); outcome }
      }
      val id=l.archive.ingest("a",Fixtures.snapshot()).jobId; l.stub.chat=_ => 429
      val w=workerWith(traced,l.config,l.client,l.log.logger,ModelAdmission.make(l.config.indexing).unsafeRunSync(),Worker.CoolDown(pause,2,pause))
      val fiber=w.run.start.unsafeRunSync()
      try {
        val deadline=10.seconds.fromNow
        while(held.isEmpty && deadline.hasTimeLeft()) Thread.sleep(20)
        assert(held.nonEmpty,"the job was held")
        val lane=claims.asScala.collectFirst { case (lane,_,Some(job)) if job==id => lane }.get; val end=held.get+pause.toNanos
        // Until the paused lane's next claim after its pause (bounded): the events are ordered by the pause, not by a sleep.
        val bound=(pause+30.seconds).fromNow
        while(!claims.asScala.exists((index,at,_) => index==lane && at>=end) && bound.hasTimeLeft()) Thread.sleep(20)
      } finally fiber.cancel.unsafeRunSync()
      val trace=claims.asScala.toList; val start=held.get; val end=start+pause.toNanos
      val lane=trace.collectFirst { case (lane,_,Some(job)) if job==id => lane }.get
      val during=trace.filter((_,at,_) => at>start && at<end)
      assertEquals(during.filter(_._1==lane),Nil,s"lane $lane claimed during its pause")
      assert(trace.exists((index,at,_) => index==lane && at>=end),s"lane $lane claims again after its pause: $trace")
      (0 until 3).filter(_!=lane).foreach(other => assert(during.exists(_._1==other),s"lane $other kept claiming during lane $lane's pause: $trace"))
      assertEquals(l.log.lines.count(_.startsWith(s"indexing lane paused lane=$lane upstream=Annotation level=1 pauseSeconds=4")),1)
    }
  }
  for(order <- List(ClaimOrderSetting.Waiting,ClaimOrderSetting.SourceId)) {
    val holds=order==ClaimOrderSetting.Waiting
    test(s"Cool-down: while lane 0 is paused the large-job permit is ${if(holds) "kept by it (waiting order)" else "free (claimOrder source-id)"}") {
      lanes(order) { l =>
        val id=l.archive.ingest("a",Fixtures.snapshot()).jobId; l.stub.chat=_ => 429
        l.db.transaction { c => Sql.exec(c,"UPDATE ch_jobs SET total_windows=150 WHERE id=?",id); () }
        val admission=ModelAdmission.make(l.config.indexing).unsafeRunSync()
        // A pause far longer than the check: the lane is cancelled once the permit is observed.
        val w=workerWith(l.archive,l.config,l.client,l.log.logger,admission,Worker.CoolDown(60.seconds,2,60.seconds))
        val fiber=w.lane(0).start.unsafeRunSync()
        try {
          val deadline=10.seconds.fromNow
          while(!l.log.lines.exists(_.startsWith("indexing lane paused lane=0")) && deadline.hasTimeLeft()) Thread.sleep(20)
          assert(l.log.lines.exists(_.startsWith("indexing lane paused lane=0")),"lane 0 paused")
          assertEquals(admission.largeJob.use(IO.pure).unsafeRunSync(),!holds)
          assertEquals(l.row(id).state,"Queued")
        } finally fiber.cancel.unsafeRunSync()
        assert(admission.largeJob.use(IO.pure).unsafeRunSync(),"free once the lane stops")
      }
    }
  }
}
