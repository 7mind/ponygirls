package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import ponygirls.runtime.{JdbcFailure,RuntimeFailure}
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.{ConcurrentHashMap,ConcurrentLinkedQueue,CountDownLatch,ExecutorService,Executors,LinkedBlockingQueue,TimeUnit}
import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.Await
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import scala.util.Using
import ProblemPassages.{Carry,Decision,Part,Point,Window}

/** Annotation continuations (R-g part 2, ANNOT2) on the process's one pool (restart-robustness spec §5, production sizing:
  * 12 connections, R 5, a background admission of 4 shared permits, the renewal permit, a publication gate of 3): the
  * part-2 transactions wait in the Worker's background admission or fail its named transient, never deadlock with a
  * publication and never take the renewal permit (P1-P4); a part-2 write that meets a connection-unavailable or a statement
  * timeout is held as decision B holds the accepted answer's write (F). */
final class AnnotationContinuationPoolTest extends munit.FunSuite {
  override val munitTimeout=5.minutes
  /** The indexing configuration of every case: production's, with the continuations switch on (off only for the pool
    * tip's own path, as a control). */
  private def indexing(continuations: Boolean): IndexingCapacity = IndexingCapacity.defaults.copy(annotationContinuations=continuations)
  /** Production sizing: `maxConnections` 12, the other limits as the example configuration's. */
  private def production(fixture: Config,continuations: Boolean): Config = fixture.copy(databaseLimits=fixture.databaseLimits.copy(maxConnections=12),indexing=indexing(continuations))
  /** The service pool of `production(fixture)` (with `queue` as its admission bound) and the Worker's archive over its
    * background view, as the plugin wires it; setup and observation go through the fixture's own pool. */
  private def pooled(queue: Option[FiniteDuration]=None,continuations: Boolean=true)(run: (Config,Database,PostgresArchive,Database,PostgresArchive) => Unit): Unit =
    CurrentIndexDatabase.withDatabase { (fixture,fixtureDb,fixtureArchive) =>
      val shaped=production(fixture,continuations)
      val config=queue.fold(shaped)(value => shaped.copy(databaseLimits=shaped.databaseLimits.copy(queueTimeout=value)))
      assertEquals((config.databasePool.request,config.databasePool.background,Database.controlConnections,Database.publicationPermits(config.databasePool)),(5,5,1,3))
      Using.resource(Database.service(config,IndexProfileCatalog.current(config))) { service =>
        run(config,fixtureDb,fixtureArchive,service,new PostgresArchive(service.background,config))
      }
    }

  private final case class Asked(position: Int,fragments: Int)
  /** Answers each request with `script`, recording every request. */
  private class Provider(script: (Window,Option[Carry]) => IO[Decision]) extends ScriptedAnnotator {
    private val requests=new ConcurrentLinkedQueue[Asked]()
    def annotate(owner: String,window: Window,previous: Option[Carry]): IO[Decision] =
      IO(requests.add(Asked(window.fragments.head.messagePosition,window.fragments.size))) *> script(window,previous)
    def seen: List[Asked] = requests.asScala.toList
  }
  private val embedder=new Embedder {
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
  }
  private val backoff=Worker.FailureBackoff(50.millis)
  private def worker(archive: SessionArchive,config: Config,annotator: ProblemPassageAnnotator,log: WorkerLog=new WorkerLog,leases: Worker.Leases=Worker.Leases.production): Worker =
    new Worker(archive,annotator,embedder,config,IndexProfileCatalog.current(config),ModelAdmission.make(config.indexing).unsafeRunSync(),log.logger,backoff,ModelFixtures.snapshots,leases)
  // munit evaluates an assertion's condition holding the suite's monitor, and the worker's threads assert too: every
  // condition below is computed before it is asserted.
  private def once(archive: SessionArchive,config: Config,annotator: ProblemPassageAnnotator,log: WorkerLog=new WorkerLog): Unit = {
    val claimed=worker(archive,config,annotator,log).once.unsafeRunSync()
    assert(claimed,"a job was claimed")
  }
  private def finished(runs: scala.concurrent.Future[Boolean]*): Unit = {
    val results=runs.map(Await.result(_,60.seconds)).toList
    assertEquals(results,runs.map(_ => true).toList,"each worker claimed a job and finished")
  }

  private val fragments=64
  private def source: IngestRequest = {
    val messages=(0 until fragments).map(i => Message(s"m$i",None,"user",s"synthetic message $i",None,i)).toList
    val raw=messages.map(m => Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(m.text)).noSpaces+"\n").mkString
    Fixtures.snapshot().copy(messages=messages,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private def problem(to: Point,continued: Boolean): Decision = Decision(Vector(Part(Point(0,0),to,continued,"synthetic goal",Nil)))
  private val kept=10
  /** The window's first answer stops at the boundary (10,0); the rest is answered whole. */
  private def keptThenWhole(window: Window,previous: Option[Carry]): IO[Decision] =
    IO.pure(if(window.fragments.size==fragments) problem(Point(kept,0),false) else problem(window.terminal,true))
  private def whole(window: Window,previous: Option[Carry]): IO[Decision] = IO.pure(problem(window.terminal,previous.nonEmpty))
  /** A transient database failure while the call is in flight: the job is held with its committed kept parts. */
  private val interrupted: IO[Decision] = IO.raiseError(JdbcFailure("database-unavailable",Some("08006")))
  private val full=Asked(0,fragments); private val rest=Asked(kept,fragments-kept)

  private final case class Job(state: String,attempts: Int,error: Option[String],stage: Option[String],transient: Int,range: Option[Int],held: Boolean)
  private def job(db: Database,id: UUID): Job = db.transaction(c => Sql.one(c,"SELECT state,attempts,error,failure_stage,transient_failures,transient_range,lease_until>clock_timestamp() FROM ch_jobs WHERE id=?",id) { r =>
    Job(r.getString(1),r.getInt(2),Option(r.getString(3)),Option(r.getString(4)),r.getInt(5),Option(r.getObject(6,classOf[java.lang.Integer])).map(_.intValue),r.getBoolean(7))
  }.get)
  private def held(stage: Option[String],transient: Int): Job = Job("Queued",0,Some(Jobs.transientCode),stage,transient,None,true)
  /** The window's authorization rows in order: `continued`, another reason, `accepted(n)` or `none`. */
  private def ledger(db: Database,id: UUID): List[String] = db.transaction(c => Sql.rows(c,"SELECT rejection_reason,accepted_continuations FROM ch_annotation_attempts WHERE job_id=? ORDER BY retry_epoch,attempt",id) { r =>
    Option(r.getString(1)).map(reason => if(reason==AnnotationAttempts.continuedReason) "continued" else reason).orElse(Option(r.getObject(2)).map(_ => s"accepted(${r.getInt(2)})")).getOrElse("none")
  })
  private def covered(db: Database,id: UUID): List[Int] = db.transaction(c => Sql.rows(c,"SELECT covered_fragments FROM ch_annotation_partials WHERE job_id=?",id)(_.getInt(1)))
  private def checkpoints(db: Database,id: UUID): Int = db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_index_checkpoints WHERE job_id=? AND stage='Annotation'",id)(_.getInt(1)).get)
  /** A held job's next attempt has come. */
  private def due(db: Database,id: UUID): Unit = db.transaction { c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp() WHERE id=? AND state='Queued'",id); () }

  /** Waits (no fixed time) until `condition` holds; the bound only keeps a broken run from hanging. */
  private def eventually(what: String)(condition: => Boolean): Unit = {
    val bound=System.nanoTime()+10.seconds.toNanos
    while(!condition) { val late=System.nanoTime()>bound; assert(!late,what); Thread.onSpinWait() }
  }
  /** `thread` parked in a timed wait inside `owner` (the admission's or the gate's semaphore). */
  private def waitingIn(thread: Thread,owner: String): Boolean =
    thread.getState==Thread.State.TIMED_WAITING && thread.getStackTrace.exists(_.getClassName==owner)
  private val admission="ponygirls.runtime.BlockingAdmission"
  private val gate="chronicle.Database$PublicationGate"
  /** Backends of the database waiting for an advisory lock in a statement starting with `statement`. */
  private def waiting(db: Database,statement: String): Int =
    db.transaction(c => Sql.one(c,"SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory' AND starts_with(query,?)",statement)(_.getInt(1)).get)
  /** A transaction of `view` entered and held (a permit of its admission and a connection) until `free`. */
  private final class Held(executor: ExecutorService,view: (Connection => Unit) => Unit) {
    private val entered=new CountDownLatch(1); private val release=new CountDownLatch(1)
    private val done=executor.submit((() => view { _ => entered.countDown(); release.await() }): Runnable)
    if(!entered.await(10,TimeUnit.SECONDS)) throw new AssertionError("the transaction holds its permit")
    def free(): Unit = { release.countDown(); done.get(10,TimeUnit.SECONDS); () }
  }
  /** While `run` runs, every statement `event` on `table` waits (in its transaction) until `run` frees the lock it gets. */
  private def stalling(executor: ExecutorService,db: Database,table: String,event: String)(run: Held => Unit): Unit = {
    val key=73201L
    def drop(): Unit = db.transaction { c => Sql.exec(c,"DROP FUNCTION IF EXISTS ch_test_stall() CASCADE"); () }
    drop()
    db.transaction { c =>
      Sql.exec(c,s"CREATE FUNCTION ch_test_stall() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN PERFORM pg_advisory_xact_lock_shared($key); RETURN NULL; END $$$$")
      Sql.exec(c,s"CREATE TRIGGER ch_test_stall AFTER $event ON $table FOR EACH STATEMENT EXECUTE FUNCTION ch_test_stall()")
    }
    val lock=new Held(executor,f => db.transaction { c => Sql.exec(c,"SELECT pg_advisory_xact_lock(?)",key); f(c) })
    try run(lock) finally { lock.free(); drop() }
  }
  /** Records each observed write's thread when it starts and its outcome when it ends. */
  private final class Observed(base: SessionArchive) extends ForwardingArchive(base) {
    private val entered=new LinkedBlockingQueue[(String,Thread)]; private val left=new LinkedBlockingQueue[(String,Option[Throwable])]
    private val running=ConcurrentHashMap.newKeySet[String]()
    private def observed[A](name: String)(write: => A): A = {
      running.add(name); entered.put(name -> Thread.currentThread())
      try { val value=write; running.remove(name); left.put(name -> None); value } catch { case error: Throwable => running.remove(name); left.put(name -> Some(error)); throw error }
    }
    override def continueAnnotation(c: Claim,key: CheckpointKey,attempt: Int,partial: AnnotationPartial): Int = observed("continueAnnotation")(super.continueAnnotation(c,key,attempt,partial))
    override def acceptAnnotation(c: Claim,key: CheckpointKey,attempt: Int,continuations: Int,value: Json): Unit = observed(s"acceptAnnotation($continuations)")(super.acceptAnnotation(c,key,attempt,continuations,value))
    private def next[A](queue: LinkedBlockingQueue[(String,A)],name: String): A =
      Iterator.continually(Option(queue.poll(30,TimeUnit.SECONDS)).getOrElse(throw new AssertionError(s"$name not observed"))).find(_._1==name).get._2
    def started(name: String): Thread = next(entered,name)
    def ended(name: String): Option[Throwable] = next(left,name)
    /** `name` runs on `thread`, parked in the background admission. */
    def admitting(name: String,thread: Thread): Boolean = running.contains(name) && waitingIn(thread,admission)
  }

  test("P1 the background admission's four shared permits held: a kept answer's continueAnnotation and the acceptance after it (continuations 1) wait in that admission and complete once one permit frees") { pooled() { (config,fixtureDb,fixtureArchive,service,archive) =>
    val executor=Executors.newCachedThreadPool(); val holders=new ConcurrentLinkedQueue[Held]
    try {
      def saturate(): Unit = while(holders.size<4) holders.add(new Held(executor,f => service.background.transaction(f)))
      def freeOne(): Unit = holders.poll().free()
      val receipt=fixtureArchive.ingest("a",source)
      // The model call holds no permit; before each answer returns, the shared permits are all taken.
      val provider=new Provider((window,previous) => IO.blocking(saturate()) *> keptThenWhole(window,previous))
      val observed=new Observed(archive)
      val run=worker(observed,config,provider).once.unsafeToFuture()
      val continuing=observed.started("continueAnnotation")
      eventually("continueAnnotation waits in the background admission")(observed.admitting("continueAnnotation",continuing))
      assertEquals(covered(fixtureDb,receipt.jobId),Nil)
      freeOne()
      assertEquals(observed.ended("continueAnnotation"),None)
      assertEquals(covered(fixtureDb,receipt.jobId),List(kept))
      val accepting=observed.started("acceptAnnotation(1)")
      eventually("acceptAnnotation(1) waits in the background admission")(observed.admitting("acceptAnnotation(1)",accepting))
      assertEquals(checkpoints(fixtureDb,receipt.jobId),0)
      freeOne()
      assertEquals(observed.ended("acceptAnnotation(1)"),None)
      while(!holders.isEmpty) freeOne()
      finished(run)
      assertEquals((job(fixtureDb,receipt.jobId).state,ledger(fixtureDb,receipt.jobId),provider.seen),("Complete",List("continued","accepted(1)"),List(full,rest)))
    } finally { holders.asScala.foreach(_.free()); executor.shutdown() }
  }}

  test("P2 past the admission bound with the shared permits held: continueAnnotation and acceptAnnotation(1) fail admission-timeout and the job is held, not charged; the next claim asks the window again, or its rest") { pooled(Some(1.second)) { (config,fixtureDb,fixtureArchive,service,archive) =>
    val executor=Executors.newCachedThreadPool(); val holders=new ConcurrentLinkedQueue[Held]
    try {
      def saturate(): Unit = while(holders.size<4) holders.add(new Held(executor,f => service.background.transaction(f)))
      def freeAll(): Unit = while(!holders.isEmpty) holders.poll().free()
      // `saturated(window)`: the shared permits are taken before the answer to that request returns.
      def meets(write: String,saturated: Window => Boolean): (UUID,WorkerLog) = {
        val receipt=fixtureArchive.ingest("a",source); val log=new WorkerLog
        val provider=new Provider((window,previous) => IO.blocking(if(saturated(window)) saturate()) *> keptThenWhole(window,previous))
        val observed=new Observed(archive)
        val run=worker(observed,config,provider,log).once.unsafeToFuture()
        assertEquals(observed.ended(write),Some(RuntimeFailure("admission-timeout")))
        // The hold's record tries meet the same admission until the permits free.
        freeAll()
        finished(run)
        (receipt.jobId,log)
      }
      val (continuing,continuingLog)=meets("continueAnnotation",_.fragments.size==fragments)
      assertEquals((job(fixtureDb,continuing),ledger(fixtureDb,continuing),covered(fixtureDb,continuing)),(held(None,1),List("none"),Nil))
      assertEquals(continuingLog.lines.filter(_.startsWith("job ")).map(_.replaceAll(" nextAttemptAt=.*","")),List(s"job held jobId=$continuing code=database-transient sqlState=none class=RuntimeFailure stage=none consecutive=1"))
      due(fixtureDb,continuing); val again=new Provider(whole); once(archive,config,again)
      assertEquals((again.seen,ledger(fixtureDb,continuing),job(fixtureDb,continuing).state),(List(full),List("none","accepted(0)"),"Complete"))
      val accepting=meets("acceptAnnotation(1)",_.fragments.size<fragments)._1
      assertEquals((job(fixtureDb,accepting),ledger(fixtureDb,accepting),covered(fixtureDb,accepting)),(held(None,1),List("continued","none"),List(kept)))
      due(fixtureDb,accepting); val rested=new Provider(whole); once(archive,config,rested)
      assertEquals((rested.seen,ledger(fixtureDb,accepting),job(fixtureDb,accepting).state),(List(rest),List("continued","none","accepted(1)"),"Complete"))
    } finally { holders.asScala.foreach(_.free()); executor.shutdown() }
  }}

  test("P3 no deadlock with a publication: one job's publication stalled in a staging transaction with the publication gate full, another job's chain continues and is accepted on the fourth shared permit, its publication waits at the gate; both complete") { pooled() { (config,fixtureDb,fixtureArchive,service,archive) =>
    val executor=Executors.newCachedThreadPool()
    val publishing=new ConcurrentHashMap[UUID,Thread]
    val observed=new ForwardingArchive(archive) {
      override def publishProblems(c: Claim,rows: ProblemRows): Boolean = { publishing.put(c.jobId,Thread.currentThread()); super.publishProblems(c,rows) }
    }
    var gateHolders=List.empty[Held]
    try stalling(executor,fixtureDb,"ch_search_chunks","INSERT") { lock =>
      val x=fixtureArchive.ingest("a",source)
      val xRun=worker(observed,config,new Provider(whole)).once.unsafeToFuture()
      // X's search-row writer holds a gate permit and a shared permit; two maintenance transactions take the rest of the
      // gate: the gate is full and three of the four shared permits are held.
      eventually("X's search-row writer waits inside its staging transaction")(waiting(fixtureDb,"INSERT INTO ch_search_chunks")==1)
      gateHolders=List.fill(2)(new Held(executor,f => service.maintenance.transaction(f)))
      val y=fixtureArchive.ingest("b",source); val yProvider=new Provider(keptThenWhole)
      val yRun=worker(observed,config,yProvider).once.unsafeToFuture()
      eventually("Y's publication waits at the gate")(Option(publishing.get(y.jobId)).exists(waitingIn(_,gate)))
      assertEquals((ledger(fixtureDb,y.jobId),yProvider.seen,job(fixtureDb,x.jobId).state),(List("continued","accepted(1)"),List(full,rest),"Running"))
      lock.free(); gateHolders.foreach(_.free()); gateHolders=Nil
      finished(xRun,yRun)
      assertEquals((job(fixtureDb,x.jobId).state,job(fixtureDb,y.jobId).state),("Complete","Complete"))
    } finally { gateHolders.foreach(_.free()); executor.shutdown() }
  }}

  test("P4 lease renewal on the renewal permit while four lanes' continueAnnotation transactions hold the four shared permits: a short background transaction times out, the renewal completes; then the four chains finish") { pooled() { (config,fixtureDb,fixtureArchive,service,archive) =>
    val executor=Executors.newCachedThreadPool()
    val other=fixtureArchive.ingest("c",source)
    val claimed=archive.claim(archive.knownProfiles,ClaimScope.Owner("c"),300,LargeJobs.Admitted).getOrElse(fail("a claim"))
    // The lanes' periodic renewals come after the case (a renewal waits for its own job's in-flight transaction's row locks).
    val leases=Worker.Leases.production.copy(renewal=1.hour)
    try stalling(executor,fixtureDb,"ch_annotation_partials","INSERT") { lock =>
      val receipts=List.fill(4)(fixtureArchive.ingest("a",source))
      val provider=new Provider(keptThenWhole)
      val runs=List.fill(4)(worker(archive,config,provider,leases=leases).once.unsafeToFuture())
      eventually("four continueAnnotation transactions wait inside, each on a shared permit")(waiting(fixtureDb,"INSERT INTO ch_annotation_partials")==4)
      assertEquals(intercept[RuntimeFailure](service.background.transactionWithin(Deadline.now+200.millis)(_ => ())).code,"admission-timeout")
      val renewed=archive.renew(claimed,300)
      assert(renewed,"renewed while continuation work holds every shared permit")
      lock.free()
      finished(runs*)
      assertEquals(receipts.map(receipt => (job(fixtureDb,receipt.jobId).state,ledger(fixtureDb,receipt.jobId))),List.fill(4)(("Complete",List("continued","accepted(1)"))))
      assertEquals(job(fixtureDb,other.jobId).state,"Running")
    } finally executor.shutdown()
  }}

  /** Known limit (the pool tip's guarantee, kept for this landing set; a later fix unit RENEW-LOCK): renewal ADMISSION is
    * protected (its own permit), but a renewal can wait on its own job's row locks, and while it does, other jobs' renewals
    * can miss their admission bound. Job A's write `table` stalls inside its transaction, holding A's source and job rows;
    * A's periodic renewal takes the renewal permit and waits on A's source row; B's renewal then misses its bound:
    * B's attempt ends with its model call cancelled (an in-flight paid answer lost) and B is held transient, not charged. */
  private def renewalWaitsOnItsJob(continuations: Boolean,table: String): Unit = pooled(continuations=continuations) { (config,fixtureDb,fixtureArchive,service,archive) =>
    val executor=Executors.newCachedThreadPool()
    try stalling(executor,fixtureDb,table,"INSERT") { lock =>
      val a=fixtureArchive.ingest("a",source)
      // On, A's first answer stops at a boundary (its continueAnnotation stalls); off, it is complete (its checkpoint write).
      val aRun=worker(archive,config,new Provider(if(continuations) keptThenWhole else whole),leases=Worker.Leases.production.copy(renewal=100.millis)).once.unsafeToFuture()
      eventually("A's write waits inside its transaction")(waiting(fixtureDb,s"INSERT INTO $table")==1)
      eventually("A's renewal waits on A's source row, holding the renewal permit")(fixtureDb.transaction(c => Sql.one(c,
        "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event<>'advisory' AND starts_with(query,'SELECT revision FROM ch_sources')")(_.getInt(1)).get)==1)
      val b=fixtureArchive.ingest("b",source); val bLog=new WorkerLog
      val started=new java.util.concurrent.atomic.AtomicLong(0); val cancelled=new AtomicBoolean(false)
      val inFlight=new ScriptedAnnotator {
        def annotate(owner: String,window: Window,previous: Option[Carry]): IO[Decision] = IO(started.set(System.nanoTime())) *> IO.never[Decision].onCancel(IO(cancelled.set(true)))
      }
      val bRun=worker(archive,config,inFlight,bLog,Worker.Leases.production.copy(renewal=500.millis)).once.unsafeToFuture()
      finished(bRun)
      val waited=(System.nanoTime()-started.get).nanos
      assertEquals((cancelled.get,job(fixtureDb,b.jobId),ledger(fixtureDb,b.jobId)),(true,held(None,1),List("none")))
      assertEquals(bLog.lines.filter(_.startsWith("job ")).map(_.replaceAll(" nextAttemptAt=.*","")),List(s"job held jobId=${b.jobId} code=database-transient sqlState=none class=RuntimeFailure stage=none consecutive=1"))
      val bound=config.databaseLimits.queueTimeout
      assert(waited>=bound,s"B's renewal missed its admission bound ($bound) after $waited")
      lock.free()
      finished(aRun)
      assertEquals(job(fixtureDb,a.jobId).state,"Complete")
    } finally executor.shutdown()
  }
  test("P5 known limit: a stalled continueAnnotation holds its job's rows; that job's renewal waits on them holding the renewal permit, and another job's renewal misses its admission bound: that job's model call is cancelled and it is held transient, not charged")(
    renewalWaitsOnItsJob(true,"ch_annotation_partials"))
  test("P5 control, the pool tip's path (switch off): the same with the accepted answer's checkpoint write stalled")(
    renewalWaitsOnItsJob(false,"ch_index_checkpoints"))

  /** Runs `write` (an archive call of the claim's job) where the injected failure meets it. */
  private trait Injection { def apply[A](job: UUID)(write: SessionArchive => A): A }
  /** The first call of `target` fails through `injection`; every other call goes to `base`. */
  private final class Injected(base: SessionArchive,target: String,injection: Injection) extends ForwardingArchive(base) {
    private val armed=new AtomicBoolean(true)
    val failures=new ConcurrentLinkedQueue[Throwable]
    private def at[A](name: String,c: Claim)(write: SessionArchive => A): A =
      if(name!=target || !armed.compareAndSet(true,false)) write(base)
      else try injection(c.jobId)(write) catch { case error: Throwable => failures.add(error); throw error }
    override def loadPartial(c: Claim,key: CheckpointKey): PartialLoad = at("loadPartial",c)(_.loadPartial(c,key))
    override def discardPartial(c: Claim,key: CheckpointKey): Unit = at("discardPartial",c)(_.discardPartial(c,key))
    override def reserveAnnotation(c: Claim,key: CheckpointKey,prefix: Boolean): AnnotationReservation =
      at(if(prefix) "reserveAnnotation(prefix)" else "reserveAnnotation",c)(_.reserveAnnotation(c,key,prefix))
    override def rejectAnnotation(c: Claim,key: CheckpointKey,attempt: Int,reason: String,prefix: Boolean): Int =
      at(if(prefix) "rejectAnnotation(prefix)" else "rejectAnnotation",c)(_.rejectAnnotation(c,key,attempt,reason,prefix))
    override def continueAnnotation(c: Claim,key: CheckpointKey,attempt: Int,partial: AnnotationPartial): Int = at("continueAnnotation",c)(_.continueAnnotation(c,key,attempt,partial))
    override def acceptAnnotation(c: Claim,key: CheckpointKey,attempt: Int,continuations: Int,value: Json): Unit =
      at(s"acceptAnnotation($continuations)",c)(_.acceptAnnotation(c,key,attempt,continuations,value))
  }
  /** A write whose failure is injected: `prepared` leaves the job before the claim that meets it (a stored partial, or
    * one altered so that the loader discards it), `script` answers that claim. */
  private final case class Case(write: String,prepared: Prepared,script: (Window,Option[Carry]) => IO[Decision])
  private enum Prepared { case Fresh,Partial,DiscardedPartial }
  /** A rest that stops inside its first fragment: rejected (annotation-partition-incomplete). */
  private def keptThenMidFragment(window: Window,previous: Option[Carry]): IO[Decision] =
    IO.pure(if(window.fragments.size==fragments) problem(Point(kept,0),false) else problem(Point(0,1),true))
  private def midFragment(window: Window,previous: Option[Carry]): IO[Decision] = IO.pure(problem(Point(0,1),false))
  private val cases=List(
    Case("acceptAnnotation(0)",Prepared.Fresh,whole),
    Case("reserveAnnotation",Prepared.Fresh,whole),
    Case("rejectAnnotation",Prepared.Fresh,midFragment),
    Case("continueAnnotation",Prepared.Fresh,keptThenWhole),
    Case("reserveAnnotation(prefix)",Prepared.Fresh,keptThenWhole),
    Case("rejectAnnotation(prefix)",Prepared.Fresh,keptThenMidFragment),
    Case("acceptAnnotation(1)",Prepared.Fresh,keptThenWhole),
    Case("loadPartial",Prepared.Partial,whole),
    Case("discardPartial",Prepared.DiscardedPartial,whole))
  /** What a held job shows: its row, the `window failed` lines (stage, authorization, code, class, reason), the `job` lines
    * without ids and times, and the requests of its next claim. */
  private final case class Outcome(job: Job,windowFailed: List[String],jobLines: List[String],next: List[Asked])
  private val transientBefore=3
  /** Each case on a fresh job whose count of consecutive transient failures is 3: the claim that meets the injected
    * failure, then the next claim. */
  private def outcomes(config: Config,fixtureDb: Database,fixtureArchive: PostgresArchive,archive: PostgresArchive,injection: Injection,failure: Throwable): Map[String,Outcome] =
    cases.map { value =>
      val receipt=fixtureArchive.ingest("a",source); val id=receipt.jobId
      if(value.prepared!=Prepared.Fresh) {
        once(archive,config,new Provider((window,_) => if(window.fragments.size==fragments) IO.pure(problem(Point(kept,0),false)) else interrupted))
        assertEquals(covered(fixtureDb,id),List(kept))
        if(value.prepared==Prepared.DiscardedPartial) fixtureDb.transaction(c => Sql.exec(c,"UPDATE ch_annotation_partials SET kept_hash=repeat('0',64) WHERE job_id=?",id))
        due(fixtureDb,id)
      }
      fixtureDb.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET transient_failures=? WHERE id=?",transientBefore,id))
      val log=new WorkerLog; val injected=new Injected(archive,value.write,injection)
      once(injected,config,new Provider(value.script),log)
      assertEquals(injected.failures.asScala.toList,List(failure),value.write)
      val windowFailed=log.lines.filter(_.startsWith("window failed")).map(_.split(' ').filter(field => List("stage=","annotationAttempt=","code=","exceptionClass=","reason=").exists(field.startsWith)).mkString(" "))
      val jobLines=log.lines.filter(_.startsWith("job ")).map(_.split(' ').filterNot(field => field.startsWith("jobId=") || field.startsWith("nextAttemptAt=")).mkString(" "))
      val outcome=job(fixtureDb,id)
      due(fixtureDb,id); val next=new Provider(whole); once(archive,config,next)
      assertEquals(job(fixtureDb,id).state,"Complete",value.write)
      value.write -> Outcome(outcome,windowFailed,jobLines,next.seen)
    }.toMap
  /** Decision B for every write: held Queued, not charged, the count one more than before or 1 after committed progress,
    * one `job held` line. Stage: a paid answer's write — the acceptance (any continuations) and the kept answer's
    * `continueAnnotation` — propagates unstaged, as the checkpoint write the acceptance replaces; every other part-2 write
    * fails its window (stage Annotation, a `window failed` line), as `reserveAnnotation` and `rejectAnnotation` without a
    * prefix do. */
  private def expected(sqlState: String): Map[String,Outcome] = {
    def outcome(staged: Option[String],progressed: Boolean,next: Asked): Outcome = {
      val transient=if(progressed) 1 else transientBefore+1; val stage=staged.fold("none")(_ => "Annotation")
      Outcome(held(staged.map(_ => "Annotation"),transient),staged.toList.map(attempt => s"stage=annotation annotationAttempt=$attempt code=worker-fault exceptionClass=ponygirls.runtime.JdbcFailure reason=unknown"),
        List(s"job held code=database-transient sqlState=$sqlState class=JdbcFailure stage=$stage consecutive=$transient"),List(next))
    }
    Map(
      "acceptAnnotation(0)" -> outcome(None,false,full),
      "reserveAnnotation" -> outcome(Some("checkpoint"),false,full),
      "rejectAnnotation" -> outcome(Some("checkpoint"),false,full),
      "continueAnnotation" -> outcome(None,false,full),
      "reserveAnnotation(prefix)" -> outcome(Some("checkpoint"),true,rest),
      "rejectAnnotation(prefix)" -> outcome(Some("checkpoint"),true,rest),
      "acceptAnnotation(1)" -> outcome(None,true,rest),
      "loadPartial" -> outcome(Some("checkpoint"),false,rest),
      "discardPartial" -> outcome(Some("checkpoint"),false,full))
  }
  private def assertOutcomes(actual: Map[String,Outcome],sqlState: String): Unit = {
    val wanted=expected(sqlState)
    cases.foreach(value => assertEquals(actual(value.write),wanted(value.write),value.write))
    // Decision B's class (state, attempts, error, held, range, the hold line's class) is the reference's for every write.
    val reference=actual("acceptAnnotation(0)")
    actual.values.foreach(outcome => assertEquals((outcome.job.copy(stage=None,transient=0),outcome.jobLines.size),(reference.job.copy(stage=None,transient=0),1)))
  }

  test("F connection-unavailable without a SQLSTATE (a pool that gets no connection by its acquisition budget) at each part-2 write: held as the accepted answer's write is, not charged") { pooled() { (config,fixtureDb,fixtureArchive,_,archive) =>
    // The injected write runs on a pool whose logins outlast its 1 s budget: each borrow ends with no connection.
    val logins=new CountDownLatch(1)
    val slow=config.copy(databaseLimits=config.databaseLimits.copy(connectTimeout=1.second))
    val factory=new ponygirls.runtime.JdbcConnectionFactory {
      def open(url: String,properties: java.util.Properties): java.sql.Connection = { logins.await(5,TimeUnit.MINUTES); java.sql.DriverManager.getConnection(url,properties) }
    }
    val stalled=Database.withFactory(slow,fixtureDb.profiles,factory)
    try {
      val stalledArchive=new PostgresArchive(stalled.background,slow)
      val injection=new Injection { def apply[A](job: UUID)(write: SessionArchive => A): A = write(stalledArchive) }
      assertOutcomes(outcomes(config,fixtureDb,fixtureArchive,archive,injection,JdbcFailure("connection-unavailable",None)),"none")
    } finally { logins.countDown(); stalled.close() }
  }}

  test("F a statement cut by its timeout (57014) at each part-2 write: held as the accepted answer's write is, not charged; RetryJob's partial delete fails with its transaction as its job update does") { pooled() { (config,fixtureDb,fixtureArchive,_,archive) =>
    // The injected write runs on a pool whose statements end after 1 s, while a session holds the job's row: the write's
    // first lock of that row is cut by its statement timeout.
    val bounded=new Database(config.copy(databaseLimits=config.databaseLimits.copy(statementTimeout=1.second)),fixtureDb.profiles)
    val executor=Executors.newCachedThreadPool()
    try {
      val boundedArchive=new PostgresArchive(bounded.background,config)
      val injection=new Injection {
        def apply[A](job: UUID)(write: SessionArchive => A): A = {
          val row=new Held(executor,f => fixtureDb.transaction { c => Sql.exec(c,"SELECT 1 FROM ch_jobs WHERE id=? FOR UPDATE",job); f(c) })
          try write(boundedArchive) finally row.free()
        }
      }
      val cut=JdbcFailure("database-unavailable",Some("57014"))
      assertOutcomes(outcomes(config,fixtureDb,fixtureArchive,archive,injection,cut),"57014")
      // RetryJob (requests' admission) is one transaction: cut at its partial delete (after its job update) or at its job
      // row (before it), it leaves the Failed job, its epoch and its partial as they were.
      val failed=fixtureArchive.ingest("a",source)
      once(archive,config,new Provider((window,_) => if(window.fragments.size==fragments) IO.pure(problem(Point(kept,0),false)) else interrupted))
      fixtureDb.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET state='Failed',error='annotation-attempts-exhausted',lease_until=NULL WHERE id=?",failed.jobId))
      def epoch: Long = fixtureDb.transaction(c => Sql.one(c,"SELECT annotation_retry_epoch FROM ch_jobs WHERE id=?",failed.jobId)(_.getLong(1)).get)
      val before=(job(fixtureDb,failed.jobId),epoch,covered(fixtureDb,failed.jobId))
      val requests=new PostgresArchive(bounded,config)
      List("ch_annotation_partials","ch_jobs").foreach { table =>
        val row=new Held(executor,f => fixtureDb.transaction { c => Sql.exec(c,s"SELECT 1 FROM $table WHERE "+(if(table=="ch_jobs") "id" else "job_id")+"=? FOR UPDATE",failed.jobId); f(c) })
        try assertEquals(intercept[JdbcFailure](requests.retry("a",failed.jobId)),cut,table) finally row.free()
        assertEquals((job(fixtureDb,failed.jobId),epoch,covered(fixtureDb,failed.jobId)),before,table)
      }
    } finally { executor.shutdown(); bounded.close() }
  }}
}
