package chronicle

import chronicle.api.*
import cats.effect.{Deferred,IO,Outcome}
import cats.effect.unsafe.implicits.global
import ponygirls.runtime.JdbcFailure
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.{AtomicBoolean,AtomicInteger}
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** Publication after a database restart (restart-robustness spec §4, SMALL): the publication timeout, the transient hold
  * and its count, the record's tries until the lease end, the control connection, an earlier attempt's leftover staging
  * transaction, and down-029. */
final class TransientPublicationTest extends munit.FunSuite {
  private final class Annotator extends ProblemPassageAnnotator {
    val calls=new AtomicInteger(0)
    def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] =
      IO(calls.incrementAndGet()).as(ProblemPassages.Decision(Vector(ProblemPassages.Part(ProblemPassages.Point(0,0),window.terminal,previous.nonEmpty,"synthetic goal",Nil))))
  }
  private val embedder=new Embedder {
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
  }
  private val backoff=Worker.FailureBackoff(50.millis)
  private def lane(archive: SessionArchive,config: Config,logger: logstage.IzLogger,leases: Worker.Leases,annotator: ProblemPassageAnnotator=new Annotator): Worker =
    new Worker(archive,annotator,embedder,config,IndexProfileCatalog.current(config),ModelAdmission.make(config.indexing).unsafeRunSync(),logger,backoff,ModelFixtures.snapshots,leases)
  /** Request statements bounded at one second, publication statements at `publication`. */
  private def bounded(config: Config,publication: FiniteDuration): Config =
    config.copy(databaseLimits=config.databaseLimits.copy(statementTimeout=1.second),indexing=config.indexing.copy(publicationStatementTimeout=Some(publication)))
  private def database(config: Config)(run: (Database,PostgresArchive) => Unit): Unit = {
    val db=new Database(config,IndexProfileCatalog.current(config))
    try run(db,new PostgresArchive(db,config)) finally db.close()
  }
  /** A trigger on the search rows (`level` STATEMENT or ROW) and its control table, dropped afterwards. */
  private def withTrigger(db: Database,level: String,body: String)(run: => Unit): Unit = {
    def drop(): Unit = db.transaction { c => Sql.exec(c,"DROP FUNCTION IF EXISTS ch_test_publication() CASCADE"); Sql.exec(c,"DROP TABLE IF EXISTS ch_test_control"); () }
    drop()
    db.transaction { c =>
      Sql.exec(c,"CREATE TABLE ch_test_control(kind text NOT NULL,value text NOT NULL)")
      Sql.exec(c,s"CREATE FUNCTION ch_test_publication() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN $body END $$$$")
      Sql.exec(c,s"CREATE TRIGGER ch_test_publication ${if(level=="ROW") "BEFORE" else "AFTER"} INSERT ON ch_search_chunks FOR EACH $level EXECUTE FUNCTION ch_test_publication()")
    }
    try run finally drop()
  }
  private def control(db: Database,kind: String,values: Int*): Unit = db.transaction { c =>
    Sql.exec(c,"DELETE FROM ch_test_control WHERE kind=?",kind); values.foreach(value => Sql.exec(c,"INSERT INTO ch_test_control VALUES(?,?)",kind,value.toString))
  }
  private final case class JobRow(state: String,attempts: Int,error: Option[String],stage: Option[String],transient: Int,range: Option[Int],heldSeconds: Option[Double])
  private def job(db: Database,id: UUID): JobRow = db.transaction(c => Sql.one(c,"SELECT state,attempts,error,failure_stage,transient_failures,transient_range,EXTRACT(epoch FROM lease_until-clock_timestamp()) FROM ch_jobs WHERE id=?",id) { r =>
    JobRow(r.getString(1),r.getInt(2),Option(r.getString(3)),Option(r.getString(4)),r.getInt(5),Option(r.getObject(6,classOf[java.lang.Integer])).map(_.intValue),Option(r.getBigDecimal(7)).map(_.doubleValue))
  }.get)
  private def nextAttempt(db: Database,id: UUID): java.time.Instant = db.transaction(c => Sql.one(c,"SELECT lease_until FROM ch_jobs WHERE id=?",id)(_.getTimestamp(1).toInstant).get)
  /** The hold's time has come: a claim may take the job again. */
  private def due(db: Database,id: UUID): Unit = db.transaction { c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp() WHERE id=? AND state='Queued'",id); () }
  private def messages(count: Int): IngestRequest = {
    val values=(0 until count).map(i => Message(s"m$i",None,"user",s"synthetic message $i",None,i)).toList
    val raw=values.map(m => io.circe.Json.obj("id"->io.circe.Json.fromString(m.id),"text"->io.circe.Json.fromString(m.text)).noSpaces+"\n").mkString
    Fixtures.snapshot().copy(messages=values,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  /** Polls the server until `condition` holds (a state inside PostgreSQL the test cannot latch on). */
  private def awaitServer(db: Database,condition: String,what: String): Unit = {
    val deadline=Deadline.now+10.seconds
    def holds: Boolean = db.transaction(c => Sql.one(c,s"SELECT $condition")(_.getBoolean(1)).get)
    while(!holds && deadline.hasTimeLeft()) Thread.sleep(10)
    assert(holds,what)
  }
  private val unavailable=JdbcFailure("database-unavailable",Some("57P03"))

  test("A1: a publication statement runs under the publication timeout while request transactions keep the statement timeout") {
    CurrentIndexDatabase.withDatabase { (fixture,_,archive) => database(bounded(fixture,4.seconds)) { (db,publisher) =>
      archive.ingest("a",Fixtures.snapshot())
      val claim=publisher.claim(publisher.knownProfiles,ClaimScope.Owner("a"),300).get
      val publication=CurrentIndexDatabase.publication(claim,false)
      withTrigger(db,"STATEMENT","PERFORM pg_sleep(2); INSERT INTO ch_test_control VALUES('seen',current_setting('statement_timeout')); RETURN NULL;") {
        assert(publisher.publishProblems(claim,publication))
        assertEquals(db.transaction(c => Sql.rows(c,"SELECT value FROM ch_test_control WHERE kind='seen'")(_.getString(1))),List("4s"))
        assertEquals(db.transaction(c => Sql.one(c,"SHOW statement_timeout")(_.getString(1))),Some("1s"))
      }
      assertEquals(publisher.session("a",claim.sessionId).indexedRevision,Some(1))
      // The client waits for such a statement as long as the server lets it run, plus the socket timeout.
      val limits=bounded(fixture,4.seconds).databaseLimits
      assertEquals(db.extendedTransaction(4.seconds)(_.getNetworkTimeout),(4.seconds+limits.socketTimeout).toMillis.toInt)
      assertEquals(db.transaction(_.getNetworkTimeout),limits.socketTimeout.toMillis.toInt)
    }}
    val limits=Fixtures.databaseLimits
    assertEquals((IndexingCapacity.defaults.publicationTimeout(limits),IndexingCapacity.defaults.publicationTimeout(limits.copy(statementTimeout=10.minutes))),(5.minutes,10.minutes))
  }

  test("A2: a publication statement cut by its timeout holds the job with back-off, visibly, until the consecutive limit fails it; a retry starts again") {
    CurrentIndexDatabase.withDatabase { (fixture,_,archive) => database(bounded(fixture,1.second)) { (db,publisher) =>
      val config=bounded(fixture,1.second); val log=new WorkerLog
      val worker=lane(publisher,config,log.logger,Worker.Leases.production)
      val receipt=archive.ingest("a",Fixtures.snapshot())
      withTrigger(db,"STATEMENT","PERFORM pg_sleep(2); RETURN NULL;") {
        assert(worker.once.unsafeRunSync())
        val held=job(db,receipt.jobId)
        assertEquals(held.copy(heldSeconds=None),JobRow("Queued",0,Some(Jobs.transientCode),Some("Publication"),1,Some(0),None))
        assert(held.heldSeconds.exists(seconds => seconds>55 && seconds<=60),held.toString)
        assertEquals(publisher.claim(publisher.knownProfiles,ClaimScope.Owner("a"),300),None,"a claim refuses a held job")
        val listed=new PostgresActivity(db,java.time.Clock.systemUTC()).jobs("a",ActivityJobsQuery(None,ActivityJobScope.Current,"lease:\"inactive\"",ActivityJobSort.JobId,SortDirection.Asc,None,50)).jobs
        val next=nextAttempt(db,receipt.jobId)
        assertEquals(listed.map(item => (item.job.id,item.job.state,item.leaseExpiresAt,item.leaseActive)),List((receipt.jobId,JobState.Queued,Some(next.toString),false)))
        assertEquals(log.lines.filter(_.startsWith("job held")),List(s"job held jobId=${receipt.jobId} code=database-transient sqlState=57014 class=JdbcFailure stage=Publication consecutive=1 nextAttemptAt=$next"))
        // Its time come, a claim takes it again; at the consecutive limit it fails.
        db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET transient_failures=? WHERE id=?",Jobs.transientBackoff.limit-1,receipt.jobId)); due(db,receipt.jobId)
        assert(worker.once.unsafeRunSync())
        assertEquals(job(db,receipt.jobId),JobRow("Failed",0,Some(Jobs.transientCode),Some("Publication"),Jobs.transientBackoff.limit,Some(0),None))
        assertEquals(log.lines.filter(_.startsWith("job failed")),List(s"job failed jobId=${receipt.jobId} code=database-transient sqlState=57014 class=JdbcFailure stage=Publication consecutive=10 nextAttemptAt=none"))
        publisher.retry("a",receipt.jobId)
        assertEquals(job(db,receipt.jobId),JobRow("Queued",0,Some(Jobs.transientCode),Some("Publication"),0,None,None))
      }
      assert(worker.once.unsafeRunSync())
      assertEquals(job(db,receipt.jobId).state,"Complete")
    }}
    assertEquals((1 until 10).map(Jobs.transientBackoff.delay).toList,List(1,2,4,8,15,15,15,15,15).map(_.minutes))
    assertEquals(Jobs.transientBackoff.limit,10)
  }

  test("A3: an attempt that commits the range its job last stopped in, or a staged step, restarts the count; one that stops there again adds to it") {
    CurrentIndexDatabase.withDatabase { (fixture,_,archive) => database(bounded(fixture,1.second)) { (db,publisher) =>
      val size=PostgresArchive.searchRowsPerStatement; val (a,b,c)=(0,size,2*size)
      val receipt=archive.ingest("a",messages(3*size))
      val rows=ProblemsPublication.rows(CurrentIndexDatabase.publication(publisher.claim(publisher.knownProfiles,ClaimScope.Owner("a"),300).get,false))
      db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET state='Queued',attempts=0,lease_until=NULL WHERE id=?",receipt.jobId))
      def attempt(): (Option[TransientOutcome],JobRow) = {
        val claim=publisher.claim(publisher.knownProfiles,ClaimScope.Owner("a"),300).get
        val outcome=try { assert(publisher.publishProblems(claim,rows)); None } catch {
          case failure: JdbcFailure => assertEquals(failure.sqlState,Some("57014")); Some(publisher.holdTransient(claim,Some(IndexingStage.Publication)))
        }
        val row=job(db,receipt.jobId); due(db,receipt.jobId); (outcome,row)
      }
      def counted: (Int,Option[Int]) = { val row=attempt()._2; (row.transient,row.range) }
      withTrigger(db,"ROW","IF EXISTS(SELECT 1 FROM ch_test_control WHERE kind='slow' AND value=NEW.ordinal::text) THEN PERFORM pg_sleep(2); END IF; RETURN NEW;") {
        control(db,"slow",a)
        assertEquals(counted,(1,Some(a)))
        // A is written alone first and commits, then B stops: the count starts again.
        control(db,"slow",b)
        assertEquals(counted,(1,Some(b)))
        assertEquals(counted,(2,Some(b)))
        assertEquals(counted,(3,Some(b)))
        db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET transient_failures=8 WHERE id=?",receipt.jobId))
        val (ninth,_)=attempt()
        assert(ninth.exists { case TransientOutcome.Held(9,_) => true; case _ => false },ninth.toString)
        val (tenth,failed)=attempt()
        assertEquals((tenth,failed.state,failed.attempts,failed.error),(Some(TransientOutcome.Exhausted(10)),"Failed",0,Some(Jobs.transientCode)))
        // A staged step written again (P2 from its first step) restarts the count.
        publisher.retry("a",receipt.jobId)
        db.transaction { x =>
          Sql.exec(x,"UPDATE ch_jobs SET transient_failures=3,transient_range=? WHERE id=?",b,receipt.jobId)
          Sql.exec(x,"UPDATE ch_staged_generations SET resume=jsonb_set(resume,'{step}','0') WHERE job_id=?",receipt.jobId)
        }
        assertEquals(counted,(1,Some(b)))
        // A marker off the range grid names no range of this publication: the ranges are written in order and none counts.
        db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET transient_failures=3,transient_range=? WHERE id=?",a+size/2,receipt.jobId))
        control(db,"slow",c)
        assertEquals(counted,(4,Some(c)))
        assertEquals(publisher.session("a",receipt.sessionId).indexedRevision,None)
        // The switch follows every range.
        control(db,"slow")
        val (published,complete)=attempt()
        assertEquals((published,complete.state),(None,"Complete"))
      }
      assertEquals(db.transaction(x => Sql.one(x,"SELECT count(*) FROM ch_search_chunks WHERE session_id=?",receipt.sessionId)(_.getInt(1))),Some(3*size))
    }}
  }

  test("55P03: a lock timeout on the job's staging lock while an earlier attempt's staging transaction still runs holds the job, not charged") {
    CurrentIndexDatabase.withDatabase { (fixture,_,archive) =>
      // Publication statements may run a minute; any lock wait ends after 500 ms (requests keep 30 s statements).
      val config=fixture.copy(databaseLimits=fixture.databaseLimits.copy(lockTimeout=500.millis),indexing=fixture.indexing.copy(publicationStatementTimeout=Some(1.minute)))
      database(config) { (db,publisher) =>
        val log=new WorkerLog
        val receipt=archive.ingest("a",Fixtures.snapshot())
        val earlier=publisher.claim(publisher.knownProfiles,ClaimScope.Owner("a"),300).get
        // The earlier attempt's search-row statement stays in PostgreSQL until the test releases it.
        withTrigger(db,"ROW","WHILE NOT EXISTS(SELECT 1 FROM ch_test_control WHERE kind='release') LOOP PERFORM pg_sleep(0.01); END LOOP; RETURN NEW;") {
          val leftover=IO.blocking(publisher.publishProblems(earlier,CurrentIndexDatabase.publication(earlier,false))).start.unsafeRunSync()
          try {
            awaitServer(db,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep' AND query LIKE 'INSERT INTO ch_search_chunks%')","the earlier attempt's statement runs")
            // Its failure was recorded while the statement ran (as the first failing writer's report does).
            assert(publisher.holdTransient(earlier,Some(IndexingStage.Publication)).isInstanceOf[TransientOutcome.Held])
            due(db,receipt.jobId)
            assert(lane(publisher,config,log.logger,Worker.Leases.production).once.unsafeRunSync())
            // Held, its attempt refunded; the count starts at 1: this attempt committed its model answers' checkpoints.
            val next=nextAttempt(db,receipt.jobId)
            assertEquals(job(db,receipt.jobId).copy(heldSeconds=None),JobRow("Queued",0,Some(Jobs.transientCode),Some("Publication"),1,None,None))
            assertEquals(log.lines.filter(_.startsWith("job ")),List(s"job held jobId=${receipt.jobId} code=database-transient sqlState=55P03 class=JdbcFailure stage=Publication consecutive=1 nextAttemptAt=$next"))
          } finally control(db,"release",1)
          // The earlier attempt's statement commits its rows; its claim no longer switches anything.
          assert(!leftover.joinWithNever.unsafeRunSync())
        }
        due(db,receipt.jobId)
        assert(lane(publisher,config,log.logger,Worker.Leases.production).once.unsafeRunSync())
        assertEquals(job(db,receipt.jobId).state,"Complete")
      }
    }
  }

  test("55P03: a live writer's lock on the job's staged rows and a deterministic failure are charged as today and end a run of transient failures") {
    CurrentIndexDatabase.withDatabase { (fixture,_,archive) =>
      val config=fixture.copy(databaseLimits=fixture.databaseLimits.copy(lockTimeout=500.millis))
      database(config) { (db,publisher) =>
        val worker=lane(publisher,config,logstage.IzLogger(),Worker.Leases.production)
        val receipt=archive.ingest("a",Fixtures.snapshot())
        db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET transient_failures=4,transient_range=0 WHERE id=?",receipt.jobId))
        withTrigger(db,"STATEMENT","RAISE EXCEPTION 'synthetic deterministic failure';") {
          assert(worker.once.unsafeRunSync())
          assertEquals(job(db,receipt.jobId),JobRow("Queued",1,Some("worker-fault"),Some("Publication"),0,None,None))
        }
        // A transaction that is no staging transaction of the job holds one of its staged chunks: the next attempt's
        // search-row statement (its foreign key check) waits for it until the lock timeout.
        val held=new java.util.concurrent.CountDownLatch(1); val release=new java.util.concurrent.CountDownLatch(1)
        val holder=IO.blocking(db.transaction { c =>
          Sql.one(c,"SELECT ch.id FROM ch_chunks ch JOIN ch_staged_generations st ON st.generation=ch.generation WHERE st.job_id=? ORDER BY ch.ordinal LIMIT 1 FOR UPDATE OF ch",receipt.jobId)(_ => ()).get
          held.countDown(); release.await()
        }).start.unsafeRunSync()
        try {
          held.await()
          assert(worker.once.unsafeRunSync())
          assertEquals(job(db,receipt.jobId),JobRow("Queued",2,Some("worker-fault"),Some("Publication"),0,None,None))
        } finally { release.countDown(); holder.joinWithNever.unsafeRunSync() }
        assert(worker.once.unsafeRunSync())
        assertEquals(job(db,receipt.jobId).state,"Complete")
      }
    }
  }

  test("record: refused while the database is unavailable, tried again until it is taken before the lease end: held once, attempts unchanged, no model call repeated") {
    CurrentIndexDatabase.withDatabase { (config,db,archive) =>
      val log=new WorkerLog; val annotator=new Annotator
      val tries=new AtomicInteger(0); val answerLost=new AtomicBoolean(true)
      val wrapper=new ForwardingArchive(archive) {
        // The model's answer is written while the database goes away.
        override def checkpoint(c: Claim,key: CheckpointKey,value: io.circe.Json): Unit =
          if(key.stage==IndexingStage.Annotation && answerLost.getAndSet(false)) throw JdbcFailure("database-unavailable",Some("08006")) else super.checkpoint(c,key,value)
        // Refused twice; the third try commits but its acknowledgement is lost; the fourth finds it recorded.
        override def holdTransient(c: Claim,stage: Option[IndexingStage]): TransientOutcome = tries.incrementAndGet() match {
          case 1 | 2 => throw unavailable
          case 3 => super.holdTransient(c,stage); throw JdbcFailure("database-unavailable",Some("08006"))
          case _ => super.holdTransient(c,stage)
        }
      }
      val receipt=archive.ingest("a",Fixtures.snapshot())
      assert(lane(wrapper,config,log.logger,Worker.Leases.production,annotator).once.unsafeRunSync())
      assertEquals(job(db,receipt.jobId).copy(heldSeconds=None),JobRow("Queued",0,Some(Jobs.transientCode),None,1,None,None))
      assertEquals((tries.get,annotator.calls.get),(4,1))
      assertEquals(log.lines.filter(_.startsWith("job ")),List(s"job held jobId=${receipt.jobId} code=database-transient sqlState=08006 class=JdbcFailure stage=none consecutive=1 nextAttemptAt=${nextAttempt(db,receipt.jobId)}"))
    }
  }

  test("record: a claim taken over between tries writes nothing") {
    CurrentIndexDatabase.withDatabase { (config,db,archive) =>
      val log=new WorkerLog; val tries=new AtomicInteger(0)
      val wrapper=new ForwardingArchive(archive) {
        override def windowWork(c: Claim,key: CheckpointKey): Option[WindowWork] = throw unavailable
        override def holdTransient(c: Claim,stage: Option[IndexingStage]): TransientOutcome = {
          if(tries.incrementAndGet()==1) {
            // Meanwhile the lease ended and another lane claimed the job.
            db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",c.jobId))
            // Not munit's assert: the test thread holds its lock while the lane runs.
            require(archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).nonEmpty,"the other lane's claim")
            throw unavailable
          }
          super.holdTransient(c,stage)
        }
      }
      val receipt=archive.ingest("a",Fixtures.snapshot())
      assert(lane(wrapper,config,log.logger,Worker.Leases.production).once.unsafeRunSync())
      val taken=job(db,receipt.jobId)
      assertEquals(taken.copy(heldSeconds=None),JobRow("Running",2,None,None,0,None,None))
      assert(taken.heldSeconds.exists(_>290),taken.toString)
      assertEquals(tries.get,2)
      assertEquals(log.lines.filter(_.startsWith("job ")),List(s"job not held jobId=${receipt.jobId} code=database-transient sqlState=57P03 class=JdbcFailure stage=none: the claim ended"))
    }
  }

  test("record: refused until the lease end, the job keeps its lease and is reclaimed and charged as today") {
    CurrentIndexDatabase.withDatabase { (config,db,archive) =>
      val log=new WorkerLog
      val tries=new ConcurrentLinkedQueue[Deadline]; val claimed=new ConcurrentLinkedQueue[Deadline]
      val wrapper=new ForwardingArchive(archive) {
        override def claim(profiles: Set[String],scope: ClaimScope,lease: Int,large: LargeJobs): Option[Claim] = { claimed.add(Deadline.now); super.claim(profiles,scope,lease,large) }
        override def windowWork(c: Claim,key: CheckpointKey): Option[WindowWork] = throw unavailable
        override def holdTransient(c: Claim,stage: Option[IndexingStage]): TransientOutcome = { tries.add(Deadline.now); throw unavailable }
      }
      val lease=1.second
      val receipt=archive.ingest("a",Fixtures.snapshot())
      val started=Deadline.now
      assert(lane(wrapper,config,log.logger,Worker.Leases(lease,30.seconds,Duration.Zero)).once.unsafeRunSync())
      val ended=Deadline.now
      val leaseEnd=claimed.asScala.head+lease
      assert(tries.size>=2 && tries.asScala.forall(_<leaseEnd),tries.asScala.map(leaseEnd-_).toString)
      assert(ended-started>=lease,s"gave up ${lease-(ended-started)} before the lease end")
      assert(log.lines.exists(_.startsWith(s"job failure not recorded jobId=${receipt.jobId} failureCode=database-transient")),log.lines.mkString("\n"))
      assertEquals(job(db,receipt.jobId).copy(heldSeconds=None),JobRow("Running",1,None,None,0,None,None))
      db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",receipt.jobId))
      assert(archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).nonEmpty)
      assertEquals(job(db,receipt.jobId).attempts,2)
    }
    assertEquals((Worker.Leases.production,Worker.FailureBackoff.production.delay),(Worker.Leases(300.seconds,30.seconds,5.seconds),2.seconds))
  }

  test("record: cancellation ends the tries at once, long before the lease end") {
    CurrentIndexDatabase.withDatabase { (config,db,archive) =>
      val refused=Deferred.unsafe[IO,Unit]; val tries=new AtomicInteger(0)
      val wrapper=new ForwardingArchive(archive) {
        override def windowWork(c: Claim,key: CheckpointKey): Option[WindowWork] = throw unavailable
        override def holdTransient(c: Claim,stage: Option[IndexingStage]): TransientOutcome = { tries.incrementAndGet(); refused.complete(()).unsafeRunSync(); throw unavailable }
      }
      val receipt=archive.ingest("a",Fixtures.snapshot())
      val running=lane(wrapper,config,logstage.IzLogger(),Worker.Leases.production).once.start.unsafeRunSync()
      refused.get.timeout(10.seconds).unsafeRunSync()
      // Bounded only to report a hang: the lease has five minutes left.
      running.cancel.timeout(10.seconds).unsafeRunSync()
      assert(running.join.unsafeRunSync().isCanceled)
      val after=tries.get
      assertEquals(job(db,receipt.jobId).copy(heldSeconds=None),JobRow("Running",1,None,None,0,None,None))
      assertEquals(tries.get,after)
    }
  }

  test("A6: the lease stays valid while one publication statement runs up to the publication timeout") {
    CurrentIndexDatabase.withDatabase { (fixture,_,archive) => database(bounded(fixture,4.seconds)) { (db,publisher) =>
      val leases=Worker.Leases(2.seconds,200.millis,Duration.Zero)
      val receipt=archive.ingest("a",Fixtures.snapshot())
      withTrigger(db,"STATEMENT","PERFORM pg_sleep(3.5); RETURN NULL;") {
        val sample=IO.blocking(db.transaction(c => Sql.one(c,"SELECT state,lease_until>clock_timestamp() FROM ch_jobs WHERE id=?",receipt.jobId)(r => (r.getString(1),r.getBoolean(2))).get))
        val samples=new ConcurrentLinkedQueue[(String,Boolean)]
        val sampled=(sample.flatMap(value => IO(samples.add(value))) *> IO.sleep(100.millis)).foreverM
        assert(IO.race(lane(publisher,bounded(fixture,4.seconds),logstage.IzLogger(),leases).once,sampled).unsafeRunSync().left.exists(identity))
        val running=samples.asScala.filter(_._1=="Running").toList
        assert(running.size>=30 && running.forall(_._2),running.toString)
      }
      assertEquals(job(db,receipt.jobId).state,"Complete")
    }}
    assertEquals(IndexingCapacity.publicationStatementTimeout,5.minutes)
  }

  test("control connection: renewals keep the lease while publication statements hold every other connection; one connection is one admission for everything") {
    CurrentIndexDatabase.withDatabase { (fixture,sampling,archive) =>
      // Two connections: the control one for renewals, and one other, which each of the two search-row statements
      // holds in turn for 3.5 s.
      val published=bounded(fixture,4.seconds)
      val config=published.copy(databaseLimits=published.databaseLimits.copy(maxConnections=Database.controlConnections+1,queueTimeout=10.seconds))
      val leases=Worker.Leases(2.seconds,200.millis,Duration.Zero)
      val size=PostgresArchive.searchRowsPerStatement
      database(config) { (db,publisher) =>
        assertEquals(db.ordinaryConnections,1)
        val receipt=archive.ingest("a",messages(2*size))
        withTrigger(db,"ROW","IF EXISTS(SELECT 1 FROM ch_test_control WHERE kind='slow' AND value=NEW.ordinal::text) THEN PERFORM pg_sleep(3.5); END IF; RETURN NEW;") {
          control(db,"slow",0,size)
          val sample=IO.blocking(sampling.transaction(c => Sql.one(c,"SELECT state,lease_until>clock_timestamp() FROM ch_jobs WHERE id=?",receipt.jobId)(r => (r.getString(1),r.getBoolean(2))).get))
          val samples=new ConcurrentLinkedQueue[(String,Boolean)]
          val sampled=(sample.flatMap(value => IO(samples.add(value))) *> IO.sleep(100.millis)).foreverM
          assert(IO.race(lane(publisher,config,logstage.IzLogger(),leases).once,sampled).unsafeRunSync().left.exists(identity))
          val running=samples.asScala.filter(_._1=="Running").toList
          assert(running.size>=30 && running.forall(_._2),running.toString)
        }
        assertEquals(job(db,receipt.jobId).state,"Complete")
      }
      val one=fixture.copy(databaseLimits=fixture.databaseLimits.copy(maxConnections=1))
      one.validate()
      database(one) { (db,publisher) =>
        assertEquals(db.ordinaryConnections,1)
        archive.ingest("b",Fixtures.snapshot())
        val claim=publisher.claim(publisher.knownProfiles,ClaimScope.Owner("b"),300).get
        assert(publisher.renew(claim,300))
        assert(publisher.publishProblems(claim,CurrentIndexDatabase.publication(claim,false)))
      }
    }
    assertEquals(Database.controlConnections,1)
  }

  test("down-029 clears the holds and drops the counters; a start migrates again") {
    CurrentIndexDatabase.withDatabase { (config,db,archive) =>
      val receipt=archive.ingest("a",Fixtures.snapshot())
      db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp()+interval '10 minutes',transient_failures=2,transient_range=0,error='database-transient' WHERE id=?",receipt.jobId))
      val name=config.jdbcUrl.drop(config.jdbcUrl.lastIndexOf('/')+1)
      def run(variables: (String,String)*): (Int,List[String]) = {
        val psql=java.nio.file.Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
        val address=config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
        val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),"PGUSER"->config.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->name)
        val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1")++variables.flatMap((key,value) => List("-v",s"$key=$value"))++List("-f",java.nio.file.Path.of("scripts","down-029-transient-failures.sql").toString),sys.env,connection,CheckChild.limit)
        (ran.exit,ran.out.linesIterator.toList)
      }
      try {
        val (preflightExit,preflight)=run()
        assertEquals((preflightExit,preflight.last),(0,"DOWN029.result|preflight-complete"),preflight.mkString("\n"))
        val printed=preflight.map(_.split('|')).collect { case Array(key,value) => key->value }.toMap
        assertEquals(List("jobs.held","jobs.counted").map(key => printed(s"DOWN029.$key")),List("1","1"))
        val (appliedExit,applied)=run("mode"->"apply","apply_irreversible"->"yes","confirm_database"->name,"expect_plan"->printed("DOWN029.plan"))
        assertEquals((appliedExit,applied.last),(0,"DOWN029.result|applied"),applied.mkString("\n"))
        db.transaction { c =>
          assertEquals(Sql.one(c,"SELECT count(*) FROM information_schema.columns WHERE table_name='ch_jobs' AND column_name IN('transient_failures','transient_range')")(_.getInt(1)),Some(0))
          assertEquals(Sql.one(c,"SELECT lease_until IS NULL FROM ch_jobs WHERE id=?",receipt.jobId)(_.getBoolean(1)),Some(true))
          assertEquals(Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version=29")(_.getInt(1)),Some(0))
        }
      } finally db.initialize()
      assertEquals(job(db,receipt.jobId).copy(error=None),JobRow("Queued",0,None,None,0,None,None))
    }
  }
}
