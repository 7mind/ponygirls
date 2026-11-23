package chronicle

import chronicle.api.*
import cats.effect.{Deferred,IO}
import cats.effect.unsafe.implicits.global
import io.circe.Json
import org.http4s.{HttpApp,Response,Status}
import org.http4s.client.Client
import ponygirls.runtime.JdbcFailure
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import ProblemPassages.{Carry,Decision,Part,Point,Window}

/** Resumable annotation continuations (R-g part 2, ANNOT2; REL-B section r5 §3.6): G2-T1 … G2-T18 except T6
  * (ProblemPassageHttpTest) and T10 (the real previous binary, run outside this suite), with `indexing.annotationContinuations`
  * on; the SWITCH cases run with it off (the default) and across a change of it. A "kill" is a cancelled worker fiber,
  * asserted to leave the database exactly as it was when the call was in flight. */
final class AnnotationContinuationTest extends munit.FunSuite {
  override val munitTimeout=5.minutes
  /** A request as the provider saw it: its first fragment (message position, byte offset), its fragment count, `previous`. */
  private final case class Asked(position: Int,byteStart: Int,fragments: Int,previous: Option[Json])
  /** Answers its n-th request (from 0) with `script`, recording every request. */
  private class Provider(script: (Int,Window,Option[Carry]) => IO[Decision]) extends ScriptedAnnotator {
    private val requests=new ConcurrentLinkedQueue[Asked]()
    def annotate(owner: String,window: Window,previous: Option[Carry]): IO[Decision] = IO.defer {
      val n=requests.size
      requests.add(Asked(window.fragments.head.messagePosition,window.fragments.head.byteStart,window.fragments.size,previous.map(ProblemPassages.carryJson)))
      script(n,window,previous)
    }
    def seen: List[Asked] = requests.asScala.toList
  }
  private val embedder=new Embedder {
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
  }
  private val backoff=Worker.FailureBackoff(50.millis)
  private def worker(archive: SessionArchive,config: Config,annotator: ProblemPassageAnnotator,log: WorkerLog=new WorkerLog,embedding: Embedder=embedder): Worker =
    new Worker(archive,annotator,embedding,config,IndexProfileCatalog.current(config),ModelAdmission.make(config.indexing).unsafeRunSync(),log.logger,backoff,ModelFixtures.snapshots)
  private def once(archive: SessionArchive,config: Config,annotator: ProblemPassageAnnotator,log: WorkerLog=new WorkerLog): Unit =
    assert(worker(archive,config,annotator,log).once.unsafeRunSync(),"a job was claimed")
  /** A transient database failure while the call is in flight: SMALL holds the job and refunds the claim. */
  private val interrupted: IO[Decision] = IO.raiseError(JdbcFailure("database-unavailable",Some("08006")))

  private def texts(count: Int,from: Int=0): Vector[String] = (from until from+count).map(i => s"synthetic message $i").toVector
  private def source(values: Seq[String]): IngestRequest = {
    val messages=values.zipWithIndex.map((text,i) => Message(s"m$i",None,"user",text,None,i)).toList
    val raw=messages.map(m => Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(m.text)).noSpaces+"\n").mkString
    Fixtures.snapshot().copy(messages=messages,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  /** The next revision of `first`'s source with `values`. */
  private def append(first: IngestRequest,values: Seq[String],revision: Int): IngestRequest = source(values).copy(source=first.source,expectedRevision=revision)
  private def windows(request: IngestRequest): Vector[Window] = {
    val messages=ProblemPassages.Source(request.messages)
    Iterator.unfold(ProblemPassages.SourceCursor.start)(cursor => messages.next(cursor).map(window => (window,window.next))).toVector
  }
  private val start=ProblemPassages.State.start(new UUID(0,1),new UUID(0,2))
  private def problem(from: Point,to: Point,continued: Boolean,summary: String="synthetic goal",tags: List[String]=Nil): Part = Part(from,to,continued,summary,tags)
  /** One problem part of the request up to its fragment `k` (its terminal when k is its fragment count). */
  private def upTo(k: Int,continued: Boolean): Decision = Decision(Vector(problem(Point(0,0),Point(k,0),continued)))
  private def whole(window: Window,previous: Option[Carry]): Decision = upTo(window.fragments.size,previous.nonEmpty)
  private def carried(state: ProblemPassages.State,window: Window,kept: Vector[Part]): Option[Json] = ProblemPassages.carryAfter(state,window,kept).map(ProblemPassages.carryJson)

  /** The fixture database with annotation continuations on. */
  private def database(run: (Config,Database,PostgresArchive) => Unit): Unit =
    CurrentIndexDatabase.withDatabase((config,db,archive) => run(ModelFixtures.continuations(config),db,archive))
  private def expire(db: Database,job: UUID): Unit = db.transaction { c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",job); () }
  /** A held job's next attempt has come. */
  private def due(db: Database,job: UUID): Unit = db.transaction { c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp() WHERE id=? AND state='Queued'",job); () }
  private final case class Job(state: String,error: Option[String],attempts: Int,transient: Int)
  private def job(db: Database,id: UUID): Job = db.transaction(c => Sql.one(c,"SELECT state,error,attempts,transient_failures FROM ch_jobs WHERE id=?",id)(r => Job(r.getString(1),Option(r.getString(2)),r.getInt(3),r.getInt(4))).get)
  /** The window's authorization rows in order: a reason (`continued` for a kept answer, `continued-unkept` for one recorded
    * as the fifth non-final answer), `accepted(n)`, or `none`. */
  private def ledger(db: Database,id: UUID,window: Int=0): List[String] = db.transaction(c => Sql.rows(c,"""SELECT rejection_reason,accepted_continuations,continued_kept_hash IS NOT NULL
      FROM ch_annotation_attempts WHERE job_id=? AND window_ordinal=? ORDER BY retry_epoch,attempt""",id,window) { r =>
    Option(r.getString(1)).map(reason => if(reason!=AnnotationAttempts.continuedReason) reason else if(r.getBoolean(3)) "continued" else "continued-unkept")
      .orElse(Option(r.getObject(2)).map(_ => s"accepted(${r.getInt(2)})")).getOrElse("none")
  })
  private def chains(db: Database,id: UUID): List[UUID] = db.transaction(c => Sql.rows(c,"SELECT DISTINCT chain_id FROM ch_annotation_attempts WHERE job_id=? AND chain_id IS NOT NULL",id)(_.getObject(1,classOf[UUID])))
  private final case class Partial(window: Int,covered: Int,continuations: Int,stops: List[Int],chain: UUID,attempt: Int)
  private def partials(db: Database,id: UUID): List[Partial] = db.transaction(c => Sql.rows(c,"""SELECT window_ordinal,covered_fragments,continuations,array_to_string(stops,','),chain_id,attempt
      FROM ch_annotation_partials WHERE job_id=? ORDER BY run_id,retry_epoch,window_ordinal""",id) { r =>
    Partial(r.getInt(1),r.getInt(2),r.getInt(3),r.getString(4).split(',').toList.map(_.toInt),r.getObject(5,classOf[UUID]),r.getInt(6))
  })
  /** The windows' chain markers (None: cleared). */
  private def markers(db: Database,id: UUID): List[Option[UUID]] = db.transaction(c => Sql.rows(c,"SELECT active_chain FROM ch_annotation_active_chains WHERE job_id=? ORDER BY window_ordinal",id)(r => Option(r.getObject(1,classOf[UUID]))))
  /** Everything an attempt writes: the job row, the ledger, partials and markers. */
  private def written(db: Database,id: UUID): List[String] = db.transaction { c =>
    Sql.rows(c,"SELECT concat_ws('|',state,attempts,fence,error,failure_stage,transient_failures,transient_range,lease_until,completed_windows,total_windows) FROM ch_jobs WHERE id=?",id)(_.getString(1))++
      Sql.rows(c,"SELECT concat_ws('|',retry_epoch,window_ordinal,attempt,fence,rejection_reason,accepted_continuations,continued_kept_hash,chain_id) FROM ch_annotation_attempts WHERE job_id=? ORDER BY 1",id)(_.getString(1))++
      Sql.rows(c,"SELECT row_to_json(p)::text FROM ch_annotation_partials p WHERE job_id=? ORDER BY 1",id)(_.getString(1))++
      Sql.rows(c,"SELECT row_to_json(m)::text FROM ch_annotation_active_chains m WHERE job_id=? ORDER BY 1",id)(_.getString(1))++
      Sql.rows(c,"SELECT concat_ws('|',stage,window_ordinal,part,output_hash) FROM ch_index_checkpoints WHERE job_id=? ORDER BY 1",id)(_.getString(1))
  }
  /** The published rows of a session without ids: passages, chunks and search rows; with `checkpoints`, the job's accepted
    * annotations. */
  private def published(db: Database,session: UUID,job: Option[UUID]=None): List[String] = db.transaction { c =>
    val generation=Sql.one(c,"SELECT published FROM ch_sources WHERE id=?",session)(r => Option(r.getObject(1,classOf[UUID]))).flatten.getOrElse(fail("not published"))
    job.toList.flatMap(id => Sql.rows(c,"SELECT 'checkpoint|'||window_ordinal||'|'||value FROM ch_index_checkpoints WHERE job_id=? AND stage='Annotation' ORDER BY window_ordinal",id)(_.getString(1)))++
      Sql.rows(c,"SELECT concat_ws('|','passage',ordinal,initial_summary,(value-'id')::text,span_count) FROM ch_problem_passages WHERE generation=? ORDER BY ordinal",generation)(_.getString(1))++
      Sql.rows(c,"SELECT concat_ws('|','chunk',ordinal,(value-'id'-'sessionId')::text,document::text,embedding::text) FROM ch_chunks WHERE generation=? ORDER BY ordinal",generation)(_.getString(1))++
      Sql.rows(c,"SELECT concat_ws('|','search',ordinal,revision,profile,document::text,embedding::text) FROM ch_search_chunks WHERE generation=? ORDER BY ordinal",generation)(_.getString(1))
  }
  /** Search rows are the chunks, each once (distinct ordinals and ids). */
  private def searchRowsAreChunks(db: Database,session: UUID): Unit = db.transaction { c =>
    val counts=Sql.one(c,"""SELECT (SELECT count(*) FROM ch_chunks WHERE generation=s.published),(SELECT count(DISTINCT ordinal) FROM ch_search_chunks WHERE generation=s.published),
      (SELECT count(DISTINCT id) FROM ch_search_chunks WHERE generation=s.published),(SELECT count(*) FROM ch_search_chunks WHERE generation=s.published) FROM ch_sources s WHERE s.id=?""",session)(r => List(r.getLong(1),r.getLong(2),r.getLong(3),r.getLong(4))).get
    assert(counts.head>0 && counts.distinct.size==1,counts.toString)
  }
  private def logged(log: WorkerLog,prefix: String): List[String] = log.lines.filter(_.startsWith(prefix))
  private def resumedLine(id: UUID,window: Int,total: Int,covered: Int,fragments: Int,continuations: Int): String =
    s"annotation partial resumed jobId=$id fence=\\d+ windowOrdinal=$window totalWindows=$total coveredFragments=$covered windowFragments=$fragments continuations=$continuations"
  private def discardedLine(id: UUID,reason: String,window: Int=0,total: Int=1): String =
    s"annotation partial discarded jobId=$id fence=\\d+ windowOrdinal=$window totalWindows=$total reason=$reason"
  private def matching(log: WorkerLog,pattern: String): Int = log.lines.count(_.matches(pattern))
  /** While `run` runs, the first statement `event` on `table` fails inside its transaction with SQLSTATE 57014 (transient). */
  private def failOnce(db: Database,table: String,event: String)(run: => Unit): Unit = {
    def drop(): Unit = db.transaction { c => Sql.exec(c,"DROP FUNCTION IF EXISTS ch_test_fail() CASCADE"); Sql.exec(c,"DROP SEQUENCE IF EXISTS ch_test_failures"); () }
    drop()
    db.transaction { c =>
      Sql.exec(c,"CREATE SEQUENCE ch_test_failures")
      Sql.exec(c,"CREATE FUNCTION ch_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('ch_test_failures')=1 THEN RAISE EXCEPTION 'synthetic transient failure' USING ERRCODE='57014'; END IF; RETURN NULL; END $$")
      Sql.exec(c,s"CREATE TRIGGER ch_test_fail AFTER $event ON $table FOR EACH STATEMENT EXECUTE FUNCTION ch_test_fail()")
    }
    try run finally drop()
  }
  /** Runs a worker whose provider blocks in its `blocked`-th request (from 0) and cancels it there: what a killed process
    * leaves, asserted equal to the database state while the call was in flight. */
  private def killedIn(db: Database,archive: SessionArchive,config: Config,id: UUID,blocked: Int)(script: (Int,Window,Option[Carry]) => IO[Decision]): Provider = {
    val inFlight=Deferred.unsafe[IO,List[String]]
    val provider=new Provider((n,window,previous) => if(n==blocked) IO.blocking(written(db,id)).flatMap(inFlight.complete) *> IO.never else script(n,window,previous))
    val fiber=worker(archive,config,provider).once.start.unsafeRunSync()
    val before=inFlight.get.timeout(30.seconds).unsafeRunSync()
    fiber.cancel.timeout(30.seconds).unsafeRunSync()
    assertEquals(written(db,id),before,"the cancelled attempt wrote nothing after its call started")
    expire(db,id)
    provider
  }

  test("G2-T1: an answer kept at a fragment boundary is completed by a request for the rest of the window; the window equals one answer of the same parts") { database { (config,db,archive) =>
    // Window 0 (64 fragments) stops at (40,0); a non-ASCII message split across fragments 38 and 39 stops between them;
    // a Context-only prefix of window 1 asks the rest with the window's incoming carry.
    final case class Variant(request: IngestRequest,window: Int,stop: Int,kept: Vector[Part],rest: (Window,Option[Carry]) => Decision)
    val split=source(texts(38)++Vector("é"*1500)++texts(40,39))
    val goal=problem(Point(0,0),Point(40,0),false,"goal A")
    val variants=List(
      Variant(source(texts(130)),0,40,Vector(goal),(window,_) => Decision(Vector(problem(Point(0,0),window.terminal,true,"goal A")))),
      Variant(split,0,39,Vector(goal.copy(end=Point(39,0))),(window,_) => Decision(Vector(problem(Point(0,0),window.terminal,true,"goal A")))),
      Variant(source(texts(130)),1,10,Vector(Part.context(Point(0,0),Point(10,0))),(window,previous) => whole(window,previous)))
    variants.foreach { variant =>
      val all=windows(variant.request); val target=all(variant.window)
      val before=all.take(variant.window).foldLeft(start)((state,window) => ProblemPassages.accept(state,window,whole(window,state.carry)).state)
      val merged=Decision(variant.kept++ProblemPassages.merge(variant.stop,Vector.empty,variant.rest(ProblemPassages.tail(target,variant.stop),ProblemPassages.carryAfter(before,target,variant.kept))).parts)
      def answer(continued: Boolean)(n: Int,window: Window,previous: Option[Carry]): IO[Decision] = IO {
        val ordinal=all.indexWhere(_.fragments.head.messagePosition==window.fragments.head.messagePosition)
        if(ordinal!=variant.window && ordinal>=0) whole(window,previous)
        else if(!continued) merged
        else if(window.fragments.size==target.fragments.size) Decision(variant.kept)
        else variant.rest(window,previous)
      }
      val receipt=archive.ingest("a",variant.request); val provider=new Provider(answer(true))
      once(archive,config,provider)
      assertEquals(job(db,receipt.jobId).state,"Complete")
      val asked=provider.seen.drop(variant.window)
      val first=target.fragments(variant.stop)
      assertEquals(asked(1),Asked(first.messagePosition,first.byteStart,target.fragments.size-variant.stop,carried(before,target,variant.kept)))
      val after=ProblemPassages.accept(before,target,merged).state
      assertEquals(asked(2).previous,after.carry.map(ProblemPassages.carryJson))
      assertEquals(ledger(db,receipt.jobId,variant.window),List("continued","accepted(1)"))
      assertEquals(partials(db,receipt.jobId),Nil)
      val reference=archive.ingest("b",variant.request.copy(requestId=UUID.randomUUID()))
      once(archive,config,new Provider(answer(false)))
      assertEquals(published(db,receipt.sessionId,Some(receipt.jobId)),published(db,reference.sessionId,Some(reference.jobId)))
    }
  }}

  test("G2-T2(a,c): kept, rejected and kept answers share the five non-final answers; a rejected rest is asked again unchanged") { database { (config,db,archive) =>
    // (a) kept at 10, noncanonical, kept at 20, range, then a fifth boundary stop: exhausted after exactly five answers.
    val exhausted=archive.ingest("a",source(texts(64)))
    val five=new Provider((n,window,_) => IO(n match {
      case 0 | 2 | 4 => upTo(10,n>0)
      case 1 => Decision(Vector(problem(Point(0,0),Point(0,999),true)))
      case _ => Decision(Vector(problem(Point(1,0),window.terminal,true)))
    }))
    once(archive,config,five)
    assertEquals(five.seen.map(a => (a.position,a.fragments)),List((0,64),(10,54),(10,54),(20,44),(20,44)))
    assertEquals(job(db,exhausted.jobId),Job("Failed",Some(AnnotationAttempts.exhaustedCode),1,0))
    assertEquals(ledger(db,exhausted.jobId),List("continued","annotation-coordinate-noncanonical","continued","annotation-partition-range","continued-unkept"))
    assertEquals(partials(db,exhausted.jobId).map(p => (p.covered,p.continuations,p.stops)),List((20,2,List(10,20))))
    // (c) a stop inside a fragment of the rest: rejected, and the identical rest is asked again.
    val receipt=archive.ingest("a",source(texts(64)))
    val provider=new Provider((n,window,previous) => IO(n match {
      case 0 => upTo(10,false)
      case 1 => Decision(Vector(problem(Point(0,0),Point(5,1),true)))
      case _ => whole(window,previous)
    }))
    once(archive,config,provider)
    assertEquals(provider.seen.size,3); assertEquals(provider.seen(2),provider.seen(1))
    assertEquals(ledger(db,receipt.jobId),List("continued","annotation-partition-incomplete","accepted(1)"))
    assertEquals(job(db,receipt.jobId).state,"Complete"); searchRowsAreChunks(db,receipt.sessionId)
  }}

  test("G2-T2(b): interrupted authorizations, kept and rejected answers across fresh workers: every claim resumes the rest, ten authorizations end the window") { database { (config,db,archive) =>
    val receipt=archive.ingest("a",source(texts(64))); val id=receipt.jobId
    // Per claim: its answers, then an interrupted call (SMALL holds the job and refunds the claim; the fourth claim's
    // worker is killed instead and the lease moved past its end).
    val claims=List(List(upTo(10,false)),List(Decision(Vector(problem(Point(0,0),Point(0,1),true)))),List(upTo(10,true)),Nil,List(Decision(Vector(problem(Point(2,0),Point(9,0),true)))),Nil)
    val firsts=claims.zipWithIndex.map { (answers,claim) =>
      val script: (Int,Window,Option[Carry]) => IO[Decision] = (n,_,_) => if(n<answers.size) IO.pure(answers(n)) else interrupted
      val provider=if(claim==3) killedIn(db,archive,config,id,answers.size)(script) else { val value=new Provider(script); once(archive,config,value); due(db,id); value }
      (provider.seen.head.position,provider.seen.size)
    }
    assertEquals(firsts,List((0,2),(10,2),(10,2),(20,1),(20,2),(20,1)))
    val last=new Provider((_,_,_) => IO.raiseError(new AssertionError("an eleventh authorization")))
    once(archive,config,last)
    assertEquals(last.seen,Nil)
    assertEquals(job(db,id).copy(transient=0),Job("Failed",Some(AnnotationAttempts.reservationExhaustedCode),2,0))
    assertEquals(ledger(db,id),List("continued","none","annotation-partition-incomplete","none","continued","none","none","annotation-partition-range","none","none"))
  }}

  test("G2-T2(d) + G2-T17: the fifth boundary stop is the fifth non-final answer, recorded without a partial; a crash before the failure record ends exhausted on the next claim") { database { (config,db,archive) =>
    val receipt=archive.ingest("a",source(texts(64))); val id=receipt.jobId
    val stops=new Provider((n,_,_) => IO.pure(upTo(10,n>0)))
    // The process dies after the fifth reason commits and before the failure is recorded: the job keeps its lease.
    val crashing=new ForwardingArchive(archive) { override def fail(c: Claim,code: String,stage: IndexingStage): Unit = throw new java.io.IOException("synthetic crash before failAt") }
    once(crashing,config,stops)
    assertEquals(stops.seen.map(_.position),List(0,10,20,30,40))
    assertEquals(ledger(db,id),List("continued","continued","continued","continued","continued-unkept"))
    assertEquals(partials(db,id).map(p => (p.covered,p.continuations,p.stops)),List((40,4,List(10,20,30,40))))
    assertEquals(job(db,id).state,"Running")
    val partial=partials(db,id); expire(db,id)
    val log=new WorkerLog; val none=new Provider((_,_,_) => IO.raiseError(new AssertionError("a sixth call")))
    once(archive,config,none,log)
    assertEquals((none.seen,logged(log,"annotation partial")),(Nil,Nil))
    assertEquals(job(db,id).copy(attempts=0),Job("Failed",Some(AnnotationAttempts.exhaustedCode),0,0))
    assertEquals(partials(db,id),partial)
    // Nine interrupted reservations, then a boundary stop: the tenth authorization is the last.
    val filled=archive.ingest("a",source(texts(64)))
    val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    val key=IndexCheckpoints.annotation(claim,0,Json.arr(windows(source(texts(64)))(0).sourceJson,Json.Null))
    (1 to 9).foreach(attempt => assertEquals(archive.reserveAnnotation(claim,key),AnnotationReservation.Reserved(attempt)))
    expire(db,filled.jobId)
    val tenth=new Provider((n,_,_) => if(n==0) IO.pure(upTo(10,false)) else IO.raiseError(new AssertionError("an eleventh authorization")))
    once(archive,config,tenth)
    assertEquals(tenth.seen.size,1)
    assertEquals(job(db,filled.jobId).error,Some(AnnotationAttempts.reservationExhaustedCode))
    assertEquals(ledger(db,filled.jobId),List.fill(9)("none"):+"continued")
  }}

  test("G2-T3: boundary stops that break another rule are rejected for it and the window asked again; a rest starting elsewhere is a range; stored short partitions stay refused") { database { (config,db,archive) =>
    val request=source(texts(128)); val receipt=archive.ingest("a",request)
    val bad=Vector(
      Decision(Vector(problem(Point(0,0),Point(5,0),false),problem(Point(6,0),Point(10,0),false))),
      Decision(Vector(problem(Point(0,0),Point(6,0),false),problem(Point(5,0),Point(10,0),false))),
      Decision(Vector(Part.context(Point(0,0),Point(10,0)).copy(continuePrevious=true))),
      Decision(Vector(problem(Point(0,0),Point(10,0),true))))
    val provider=new Provider((n,window,previous) => IO {
      if(window.fragments.head.messagePosition<64) { if(n<bad.size) bad(n) else whole(window,previous) }
      else n-bad.size-1 match {
        case 0 => Decision(Vector.fill(window.scalarCount+1)(problem(Point(0,0),Point(1,0),true)))
        case 1 => upTo(10,true)
        case 2 => Decision(Vector(problem(Point(1,0),window.terminal,true)))
        case _ => whole(window,previous)
      }
    })
    once(archive,config,provider)
    assertEquals(provider.seen.map(a => (a.position,a.fragments)),List.fill(5)((0,64))++List((64,64),(64,64),(74,54),(74,54)))
    assertEquals(ledger(db,receipt.jobId,0),List("annotation-partition-range","annotation-partition-range","annotation-context-metadata","annotation-continuation-without-problem","accepted(0)"))
    assertEquals(ledger(db,receipt.jobId,1),List("annotation-part-count","continued","annotation-partition-range","accepted(1)"))
    // A stored decision covering only (0,0)-(10,0): phase W refuses it (internal), so does the publication's replay.
    val short=CheckpointJson.decision(upTo(10,false))
    val stored=archive.ingest("c",source(texts(64)))
    val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("c"),300).get
    archive.checkpoint(claim,IndexCheckpoints.annotation(claim,0,Json.arr(windows(source(texts(64)))(0).sourceJson,Json.Null)),short)
    expire(db,stored.jobId)
    val none=new Provider((_,_,_) => IO.raiseError(new AssertionError("no call for an accepted window")))
    assertEquals(intercept[DomainError](worker(archive,config,none).once.unsafeRunSync()).code,"internal")
    val replayed=archive.ingest("b",source(texts(64)))
    val corrupting=new ForwardingArchive(archive) {
      override def publishProblems(c: Claim,rows: ProblemRows): Boolean = {
        db.transaction(x => Sql.exec(x,"UPDATE ch_index_checkpoints SET value=?,output_hash=? WHERE job_id=? AND stage='Annotation'",short.noSpaces,IndexCheckpoints.hash(short),c.jobId))
        super.publishProblems(c,rows)
      }
    }
    once(corrupting,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))))
    assertEquals(job(db,replayed.jobId).copy(attempts=0),Job("Queued",Some("model-output"),0,0))
    assertEquals(archive.session("b",replayed.sessionId).indexedRevision,None)
  }}

  test("G2-T4: a worker lost while the rest is asked leaves what a kill leaves; a fresh worker resumes the same rest") { database { (config,db,archive) =>
    val request=source(texts(64)); val window=windows(request)(0); val kept=Vector(problem(Point(0,0),Point(40,0),false))
    val receipt=archive.ingest("a",request)
    killedIn(db,archive,config,receipt.jobId,1)((_,_,_) => IO.pure(Decision(kept)))
    assertEquals(ledger(db,receipt.jobId),List("continued","none"))
    val log=new WorkerLog; val provider=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
    once(archive,config,provider,log)
    assertEquals(matching(log,resumedLine(receipt.jobId,0,1,40,64,1)),1)
    assertEquals(provider.seen,List(Asked(40,0,24,carried(start,window,kept))))
    assertEquals(ledger(db,receipt.jobId),List("continued","none","accepted(1)"))
    assertEquals((partials(db,receipt.jobId),markers(db,receipt.jobId)),(Nil,Nil))
    val reference=archive.ingest("b",request.copy(requestId=UUID.randomUUID()))
    once(archive,config,new Provider((_,window,_) => IO.pure(Decision(kept:+problem(Point(40,0),window.terminal,true)))))
    assertEquals(published(db,receipt.sessionId,Some(receipt.jobId)),published(db,reference.sessionId,Some(reference.jobId)))
    // The kept answer's write fails before it commits: nothing is kept and the next claim asks the whole window.
    val lost=archive.ingest("a",source(texts(64)))
    val failing=new ForwardingArchive(archive) {
      override def continueAnnotation(c: Claim,key: CheckpointKey,attempt: Int,partial: AnnotationPartial): Int = throw JdbcFailure("database-unavailable",Some("08006"))
    }
    once(failing,config,new Provider((_,_,_) => IO.pure(Decision(kept))))
    assertEquals((ledger(db,lost.jobId),partials(db,lost.jobId)),(List("none"),Nil))
    due(db,lost.jobId)
    val full=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
    once(archive,config,full)
    assertEquals(full.seen.map(a => (a.position,a.fragments)),List((0,64)))
    assertEquals(ledger(db,lost.jobId),List("none","accepted(0)"))
  }}

  test("G2-T5: a continued window is reused by a forced root republication and by an append's incremental publication; RetryJob drops a Failed job's partial") { database { (config,db,archive) =>
    val first=source(texts(64)); val receipt=archive.ingest("a",first)
    def answer(n: Int,window: Window,previous: Option[Carry]): IO[Decision] = IO(if(window.fragments.size==64 && window.fragments.head.messagePosition%64==0 && n%2==0) upTo(30,previous.nonEmpty) else whole(window,previous))
    once(archive,config,new Provider(answer))
    val firstRun=db.transaction(c => Sql.one(c,"SELECT run_id FROM ch_jobs WHERE id=?",receipt.jobId)(_.getObject(1,classOf[UUID])).get)
    val rows=published(db,receipt.sessionId)
    archive.retry("a",receipt.jobId)
    val root=config.copy(indexing=config.indexing.copy(incrementalPublication=false))
    val none=new Provider((_,_,_) => IO.raiseError(new AssertionError("a reused window called the model")))
    once(new PostgresArchive(db,root),root,none)
    assertEquals(none.seen,Nil)
    assertEquals(db.transaction(c => Sql.rows(c,"SELECT r.window_ordinal,r.source_run FROM ch_index_checkpoint_refs r JOIN ch_jobs j ON j.id=r.job_id AND j.run_id=r.run_id WHERE r.job_id=? AND r.stage='Annotation'",receipt.jobId)(r => (r.getInt(1),r.getObject(2,classOf[UUID])))),List((0,firstRun)))
    assertEquals(published(db,receipt.sessionId),rows)
    // An append: window 0 is reused, window 1 is kept at (30,0) and completed; it reads as a root publication of the same content.
    val grown=texts(150)
    archive.ingest("a",append(first,grown,1))
    once(archive,config,new Provider(answer))
    val reference=archive.ingest("b",source(grown))
    once(new PostgresArchive(db,root),root,new Provider(answer))
    def members(session: UUID): List[String] = db.transaction { c =>
      val generation=Sql.one(c,"SELECT published FROM ch_sources WHERE id=?",session)(_.getObject(1,classOf[UUID])).get
      def held(kind: GenerationRows.Kind): String = GenerationRows.members(kind,s"'$generation'::uuid")
      Sql.rows(c,s"SELECT concat_ws('|','chunk',ch.ordinal,(ch.value-'id'-'sessionId')::text,ch.document::text) FROM (${held(GenerationRows.Kind.Piece)}) m JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=m.lo AND ch.ordinal<m.hi ORDER BY ch.ordinal")(_.getString(1))++
        Sql.rows(c,s"SELECT concat_ws('|','passage',p.ordinal,p.initial_summary,(p.value-'id')::text,p.span_count) FROM (${held(GenerationRows.Kind.Passage)}) m JOIN ch_problem_passages p ON p.generation=m.origin AND p.ordinal>=m.lo AND p.ordinal<m.hi ORDER BY p.ordinal")(_.getString(1))++
        Sql.rows(c,s"SELECT concat_ws('|','search',sc.ordinal,sc.document::text) FROM ch_generations g JOIN ch_search_chunks sc ON sc.session_id=g.session_id AND ${GenerationRows.piece("g.id","g.lineage","g.lineage_version","sc")} WHERE g.id=? ORDER BY sc.ordinal",generation)(_.getString(1))
    }
    val appended=db.transaction(c => Sql.one(c,"SELECT g.lineage_version FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.id=?",receipt.sessionId)(r => Option(r.getObject(1)))).flatten
    assert(appended.nonEmpty,"the append published incrementally")
    assertEquals(members(receipt.sessionId),members(reference.sessionId))
    // A Failed job holding a partial: RetryJob deletes it and the new epoch asks the whole window.
    val failed=archive.ingest("c",source(texts(64)))
    once(archive,config,new Provider((n,_,_) => IO.pure(if(n==0) upTo(10,false) else Decision(Vector(problem(Point(0,0),Point(0,1),true))))))
    assertEquals((job(db,failed.jobId).state,partials(db,failed.jobId).size),("Failed",1))
    archive.retry("c",failed.jobId)
    assertEquals(partials(db,failed.jobId),Nil)
    val full=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
    once(archive,config,full)
    assertEquals((full.seen.map(a => (a.position,a.fragments)),job(db,failed.jobId).state),(List((0,64)),"Complete"))
  }}

  /** The counts script's lines for the jobs `ids`, without the `ANNOTATION.` prefix and the result line. */
  private def counts(config: Config,ids: List[UUID]): List[String] = {
    val name=config.jdbcUrl.drop(config.jdbcUrl.lastIndexOf('/')+1)
    val psql=java.nio.file.Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
    val address=config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
    val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),"PGUSER"->config.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->name)
    val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1","-v",s"jobs=${ids.mkString(",")}","-f",java.nio.file.Path.of("scripts","annotation-counts.sql").toString),sys.env,connection,CheckChild.limit)
    assertEquals(ran.exit,0,ran.err)
    val lines=ran.out.linesIterator.toList
    assertEquals(lines.lastOption,Some("ANNOTATION.result|complete"))
    lines.dropRight(1).map(_.stripPrefix("ANNOTATION."))
  }
  test("G2-T7: the counts script reports one-answer, continued, abandoned, rejected, no-outcome, open, invalid-or-inactive, stale, reused and unmarked windows exactly; a failed continuation write leaves nothing") { database { (config,db,archive) =>
    def run(owner: String,request: IngestRequest,script: (Int,Window,Option[Carry]) => IO[Decision],settings: Config=config): IngestReceipt = { val receipt=archive.ingest(owner,request); once(archive,settings,new Provider(script)); receipt }
    val oneAnswer=run("a",source(texts(64)),(_,window,previous) => IO.pure(whole(window,previous)))
    val continued=run("a",source(texts(64)),(n,window,previous) => IO.pure(n match { case 0 => upTo(10,false); case 1 => Decision(Vector(problem(Point(0,0),Point(0,1),true))); case _ => whole(window,previous) }))
    val open=run("a",source(texts(64)),(n,_,_) => if(n==0) IO.pure(upTo(10,false)) else interrupted)
    val abandoned=run("a",source(texts(64)),(n,_,_) => if(n==0) IO.pure(upTo(10,false)) else interrupted)
    db.transaction(c => Sql.exec(c,"UPDATE ch_annotation_partials SET kept_hash=repeat('0',64) WHERE job_id=?",abandoned.jobId)); due(db,abandoned.jobId)
    once(archive,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))))
    // Loaded by the next claim and discarded by it: a chain the ledger does not hold (two continuations, one kept row), and
    // an inactive chain. Neither is open; their kept answers count as abandoned.
    val invalid=run("a",source(texts(64)),(n,_,_) => if(n==0) IO.pure(upTo(10,false)) else interrupted)
    db.transaction(c => Sql.exec(c,"UPDATE ch_annotation_partials SET continuations=2,stops='{5,10}' WHERE job_id=?",invalid.jobId))
    val inactive=run("a",source(texts(64)),(n,_,_) => if(n==0) IO.pure(upTo(10,false)) else interrupted)
    db.transaction(c => Sql.exec(c,"UPDATE ch_annotation_active_chains SET active_chain=NULL WHERE job_id=?",inactive.jobId))
    // Continuations off: a boundary stop is rejected and the whole window accepted unmarked (its accepting row is an answer).
    val unmarked=run("a",source(texts(64)),(n,window,previous) => IO.pure(if(n==0) upTo(10,false) else whole(window,previous)),ModelFixtures.continuations(config,false))
    val grown=source(texts(64)); val reused=run("b",grown,(_,window,previous) => IO.pure(whole(window,previous)))
    val next=archive.ingest("b",append(grown,texts(70),1)); once(archive,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))))
    // A continuation whose write fails inside its transaction leaves neither its reason nor a partial row.
    val unwritten=archive.ingest("c",source(texts(64)))
    failOnce(db,"ch_annotation_partials","INSERT") { once(archive,config,new Provider((_,_,_) => IO.pure(upTo(10,false)))) }
    assertEquals((ledger(db,unwritten.jobId),partials(db,unwritten.jobId),markers(db,unwritten.jobId)),(List("none"),Nil,Nil))
    val ids=List(oneAnswer,continued,open,abandoned,invalid,inactive,unmarked,next,unwritten).map(_.jobId)
    assertEquals(job(db,next.jobId).state,"Complete"); assert(reused.jobId!=next.jobId)
    assertEquals((ledger(db,unmarked.jobId),job(db,unmarked.jobId).state),(List("annotation-partition-incomplete","none"),"Complete"))
    assertEquals(counts(config,ids),List(
      "jobs|9","windows.one_answer|3","windows.after_continuation|1","windows.accepted_unmarked|1","answers.continued|5","answers.abandoned|3",
      "answers.rejected|2","answers.rejected.annotation-partition-incomplete|2","authorizations.no_outcome|5",
      "chains.open|1","chains.invalid_or_inactive|2","chains.stale|0","windows.reused|1","answers|12","r|0.1667"))
  }}

  test("G2-T8: paid writes on SMALL's path: a transient or ambiguous acceptance, an ambiguous continuation and a write after a re-claim; no rest before its kept answer commits") { database { (config,db,archive) =>
    // Every request for the rest of a window finds its kept answer committed.
    def provider(id: => UUID)(script: (Int,Window,Option[Carry]) => IO[Decision]): Provider = new Provider((n,window,previous) =>
      IO.blocking(partials(db,id)).flatMap { stored =>
        IO(if(window.fragments.size<64) assertEquals(stored.map(_.covered),List(window.fragments.head.messagePosition))) *> script(n,window,previous)
      })
    def tail(n: Int,window: Window,previous: Option[Carry]): IO[Decision] = IO.pure(if(window.fragments.size==64) upTo(10,false) else whole(window,previous))
    // (a) The acceptance fails transiently inside its transaction: no checkpoint and no marker; the job is held and the
    // next claim asks the same rest once more.
    val a=archive.ingest("a",source(texts(64))); val aCalls=provider(a.jobId)(tail)
    failOnce(db,"ch_annotation_partials","DELETE") { once(archive,config,aCalls) }
    assertEquals((job(db,a.jobId).state,ledger(db,a.jobId),partials(db,a.jobId).map(_.covered)),("Queued",List("continued","none"),List(10)))
    assertEquals(db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_index_checkpoints WHERE job_id=?",a.jobId)(_.getInt(1))),Some(0))
    due(db,a.jobId); val aAgain=provider(a.jobId)(tail); once(archive,config,aAgain)
    assertEquals((aCalls.seen.size+aAgain.seen.size,aAgain.seen.map(_.position),ledger(db,a.jobId)),(3,List(10),List("continued","none","accepted(1)")))
    // (b) The acceptance commits and its acknowledgement is lost: the next claim finds the window accepted, no call.
    val b=archive.ingest("a",source(texts(64)))
    val ambiguous=new ForwardingArchive(archive) {
      override def acceptAnnotation(c: Claim,key: CheckpointKey,attempt: Int,continuations: Int,value: Json): Unit = { super.acceptAnnotation(c,key,attempt,continuations,value); throw JdbcFailure("database-unavailable",Some("08006")) }
    }
    once(ambiguous,config,provider(b.jobId)(tail))
    assertEquals((job(db,b.jobId).state,ledger(db,b.jobId),partials(db,b.jobId),markers(db,b.jobId)),("Queued",List("continued","accepted(1)"),Nil,Nil))
    due(db,b.jobId); val bAgain=provider(b.jobId)(tail); once(archive,config,bAgain)
    assertEquals((bAgain.seen,job(db,b.jobId).state),(Nil,"Complete"))
    // (c) The kept answer commits and its acknowledgement is lost: the next claim resumes; the kept call is not repeated.
    val c=archive.ingest("a",source(texts(64)))
    val continuedAmbiguously=new ForwardingArchive(archive) {
      override def continueAnnotation(x: Claim,key: CheckpointKey,attempt: Int,partial: AnnotationPartial): Int = { super.continueAnnotation(x,key,attempt,partial); throw JdbcFailure("database-unavailable",Some("08006")) }
    }
    val cFirst=provider(c.jobId)(tail); once(continuedAmbiguously,config,cFirst)
    due(db,c.jobId); val cAgain=provider(c.jobId)(tail); once(archive,config,cAgain)
    assertEquals((cFirst.seen.map(_.position),cAgain.seen.map(_.position),ledger(db,c.jobId)),(List(0),List(10),List("continued","accepted(1)")))
    // (d) The lease ends and another claim takes the job before the second kept answer is written: stale-claim, nothing
    // written; the next claim resumes from the first.
    val d=archive.ingest("a",source(texts(64)))
    val overtaken=new ForwardingArchive(archive) {
      override def continueAnnotation(x: Claim,key: CheckpointKey,attempt: Int,partial: AnnotationPartial): Int = {
        if(partial.continuations==2) {
          expire(db,x.jobId)
          require(archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).nonEmpty,"the other claim")
        }
        super.continueAnnotation(x,key,attempt,partial)
      }
    }
    once(overtaken,config,provider(d.jobId)((n,_,_) => IO.pure(upTo(10,n>0))))
    assertEquals((ledger(db,d.jobId),partials(db,d.jobId).map(_.covered),job(db,d.jobId).state),(List("continued","none"),List(10),"Running"))
    expire(db,d.jobId); val dAgain=provider(d.jobId)(tail); once(archive,config,dAgain)
    assertEquals((dAgain.seen.map(_.position),ledger(db,d.jobId)),(List(10),List("continued","none","accepted(1)")))
  }}

  /** A product-written partial: answers `kept` (each a request's answer), then the next call is interrupted (held). */
  private def kept(db: Database,archive: PostgresArchive,config: Config,owner: String,answers: List[Decision]): IngestReceipt = {
    val receipt=archive.ingest(owner,source(texts(64)))
    once(archive,config,new Provider((n,_,_) => if(n<answers.size) IO.pure(answers(n)) else interrupted))
    assertEquals(partials(db,receipt.jobId).map(_.continuations),List(answers.size))
    due(db,receipt.jobId)
    receipt
  }
  private def keptJson(db: Database,id: UUID,value: Json): Unit = db.transaction { c =>
    Sql.exec(c,"UPDATE ch_annotation_partials SET kept=?::jsonb,kept_hash=? WHERE job_id=?",value.noSpaces,IndexCheckpoints.hash(value),id); ()
  }

  test("G2-T9: a stored partial failing any check V1-V10 is discarded and the whole window asked; the job completes and nothing is fatal") { database { (config,db,archive) =>
    val window=windows(source(texts(64)))(0)
    def otherContent(carry: Option[Carry]): String = IndexCheckpoints.hash(Json.arr(Json.fromString(IndexCheckpoints.windowReuse),Json.fromString(config.profile),Json.arr(window.sourceJson,carry.map(ProblemPassages.carryJson).getOrElse(Json.Null))))
    val otherCarry=ProblemPassages.accept(start,window,whole(window,None)).state.carry
    def sql(statement: String)(id: UUID): Unit = db.transaction { c => Sql.exec(c,statement,id); () }
    def decision(parts: Part*)(id: UUID): Unit = keptJson(db,id,CheckpointJson.decision(Decision(parts.toVector)))
    val one=List(upTo(10,false))
    val two=List(upTo(1,false),Decision(Vector(problem(Point(0,0),Point(1,0),true),problem(Point(1,0),Point(2,0),true))))
    val cases: List[(String,List[Decision],UUID => Unit)]=List(
      ("format",one,sql("UPDATE ch_annotation_partials SET format='annotation-partial-v0' WHERE job_id=?")),
      ("profile",one,sql("UPDATE ch_annotation_partials SET profile='another-profile' WHERE job_id=?")),
      ("content-hash",one,sql(s"UPDATE ch_annotation_partials SET content_hash='${otherContent(otherCarry)}' WHERE job_id=?")),
      ("content-hash",one,sql(s"UPDATE ch_annotation_partials SET content_hash='${"ab"*32}' WHERE job_id=?")),
      ("kept-hash",one,sql("UPDATE ch_annotation_partials SET kept_hash=repeat('f',64) WHERE job_id=?")),
      ("window-shape",one,sql("UPDATE ch_annotation_partials SET window_fragments=63 WHERE job_id=?")),
      ("range",one,sql("UPDATE ch_annotation_partials SET covered_fragments=64,stops='{64}' WHERE job_id=?")),
      ("range",one,sql("UPDATE ch_annotation_partials SET continuations=5,stops='{1,2,3,4,10}' WHERE job_id=?")),
      ("kept-decode",one,id => keptJson(db,id,Json.obj("parts"->Json.fromString("synthetic")))),
      ("boundary",one,decision(problem(Point(0,0),Point(10,5),false))),
      ("boundary",one,id => { decision(problem(Point(0,0),Point(10,0),false))(id); sql("UPDATE ch_annotation_partials SET covered_fragments=11,stops='{11}' WHERE job_id=?")(id) }),
      ("boundary",one,decision(problem(Point(0,0),Point(5,0),false),problem(Point(6,0),Point(10,0),false))),
      // The stored format has no metadata fields for Context: its decoding refuses them before the boundary check.
      ("kept-decode",one,id => keptJson(db,id,Json.obj("parts"->Json.arr(CheckpointJson.decision(Decision(Vector(Part.context(Point(0,0),Point(10,0))))).hcursor.downField("parts").downArray.focus.get
        .deepMerge(Json.obj("summary"->Json.fromString("synthetic summary"))))))),
      ("boundary",one,decision(problem(Point(0,0),Point(10,0),true))),
      ("boundary",one,decision(problem(Point(0,0),Point(10,0),false,tags=List("t"*65)))),
      ("provenance",one,decision(problem(Point(0,0),Point(10,0),false,"another window's goal"))),
      ("provenance",one,decision(Part.context(Point(0,0),Point(10,0)))),
      ("provenance",one,id => { decision(problem(Point(0,0),Point(1,0),false))(id); sql("UPDATE ch_annotation_partials SET covered_fragments=1,continuations=4,stops='{1,1,1,1}' WHERE job_id=?")(id) }),
      ("provenance",one,sql("UPDATE ch_annotation_partials SET continuations=2,stops='{5,10}' WHERE job_id=?")),
      ("provenance",one,sql("UPDATE ch_annotation_attempts SET chain_id=gen_random_uuid() WHERE job_id=? AND chain_id IS NOT NULL")),
      ("provenance",two,sql("UPDATE ch_annotation_partials SET attempt=1 WHERE job_id=?")),
      ("provenance",two,sql("UPDATE ch_annotation_partials SET stops='{2,3}' WHERE job_id=?")),
      // Shapes the product cannot write (the checks refuse them, below): decoded inside the discard path.
      ("provenance",one,sql("UPDATE ch_annotation_partials SET continuations=2,stops='{{1,3}}' WHERE job_id=?")),
      ("provenance",one,sql("UPDATE ch_annotation_partials SET continuations=2,stops='[0:1]={5,10}' WHERE job_id=?")),
      ("provenance",one,sql("UPDATE ch_annotation_partials SET continuations=2,stops='{5,NULL}' WHERE job_id=?")),
      ("provenance",one,id => { db.transaction(c => Sql.exec(c,"ALTER TABLE ch_annotation_partials ALTER COLUMN attempt DROP NOT NULL")); sql("UPDATE ch_annotation_partials SET attempt=NULL WHERE job_id=?")(id) }),
      ("kept-hash",one,id => { db.transaction(c => Sql.exec(c,"ALTER TABLE ch_annotation_partials ALTER COLUMN kept DROP NOT NULL")); sql("UPDATE ch_annotation_partials SET kept=NULL WHERE job_id=?")(id) }))
    // With every constraint of the table, stops of another shape cannot be stored; a stored row still resumes.
    val shaped=kept(db,archive,config,"c",one)
    List("{{1,3}}","[0:1]={1,3}","{1,NULL}").foreach { stops =>
      val refused=intercept[JdbcFailure](db.transaction(c => Sql.exec(c,"UPDATE ch_annotation_partials SET continuations=2,stops=?::integer[] WHERE job_id=?",stops,shaped.jobId)))
      assertEquals(refused.sqlState,Some("23514"),stops)
    }
    val resumedShaped=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
    once(archive,config,resumedShaped)
    assertEquals((resumedShaped.seen.map(_.position),job(db,shaped.jobId).state),(List(10),"Complete"))
    val checks=db.transaction(c => Sql.rows(c,"SELECT conname FROM pg_constraint WHERE conrelid='ch_annotation_partials'::regclass AND contype='c'")(_.getString(1)))
    try {
      // Out-of-range values and other shapes need the table's checks (and NOT NULLs) dropped: the database refuses them otherwise.
      db.transaction(c => checks.foreach(name => Sql.exec(c,s"ALTER TABLE ch_annotation_partials DROP CONSTRAINT $name")))
      cases.foreach { (reason,answers,alter) =>
        val receipt=kept(db,archive,config,"a",answers); alter(receipt.jobId)
        val log=new WorkerLog; val full=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
        once(archive,config,full,log)
        assertEquals((matching(log,discardedLine(receipt.jobId,reason)),full.seen.map(a => (a.position,a.fragments)),job(db,receipt.jobId).state),(1,List((0,64)),"Complete"),s"$reason ${log.lines}")
        assertEquals(partials(db,receipt.jobId),Nil)
      }
    } finally { db.transaction(c => Sql.exec(c,"DROP TABLE ch_annotation_partials")); db.initialize() }
    // Control: valid rows resume.
    List(1->List(upTo(10,false)),2->List(upTo(1,false),Decision(Vector(problem(Point(0,0),Point(1,0),true),problem(Point(1,0),Point(2,0),true))))).foreach { (continuations,answers) =>
      val receipt=kept(db,archive,config,"b",answers)
      val log=new WorkerLog; val rest=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
      once(archive,config,rest,log)
      assertEquals((logged(log,"annotation partial discarded"),rest.seen.map(_.position)),(Nil,List(if(continuations==1) 10 else 3)))
    }
  }}

  test("G2-T11: a window's kept parts are never published or visible; a new revision supersedes the job and asks the window in full") { database { (config,db,archive) =>
    val first=source(texts(64)); val receipt=archive.ingest("a",first)
    once(archive,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))))
    val previous=archive.session("a",receipt.sessionId).view
    def visible: (ContentView,Int,List[String],Long) = {
      val session=archive.session("a",receipt.sessionId)
      (session.view,archive.pageChunks("a",receipt.sessionId,0,100,None).total,db.transaction(c => Sql.rows(c,"SELECT id::text FROM ch_generations WHERE session_id=? ORDER BY id",receipt.sessionId)(_.getString(1))),
        db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_search_chunks WHERE session_id=?",receipt.sessionId)(_.getLong(1)).get))
    }
    val shown=visible
    val second=archive.ingest("a",append(first,texts(128),1))
    // Window 0 is reused; window 1 is kept at (40,0), then the worker is lost while the rest is asked.
    killedIn(db,archive,config,second.jobId,1)((_,_,_) => IO.pure(upTo(40,true)))
    assertEquals(partials(db,second.jobId).map(p => (p.window,p.covered)),List((1,40)))
    assertEquals(visible,shown); assertEquals(shown._1,previous)
    once(archive,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))))
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(2)); searchRowsAreChunks(db,receipt.sessionId)
    // A partial of revision 3's job, superseded by revision 4 before its next claim: the new job asks window 1 in full.
    val third=archive.ingest("a",append(first,texts(192),2))
    once(archive,config,new Provider((n,window,previous) => if(window.fragments.head.messagePosition==128 && n==0) IO.pure(upTo(40,true)) else if(n==1) interrupted else IO.pure(whole(window,previous))))
    assertEquals(partials(db,third.jobId).map(_.window),List(2))
    val fourth=archive.ingest("a",append(first,texts(193),3))
    val log=new WorkerLog; val full=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
    once(archive,config,full,log)
    assertEquals((job(db,third.jobId).error,job(db,fourth.jobId).state),(Some(Jobs.supersededRevision),"Complete"))
    assertEquals((full.seen.map(a => (a.position,a.fragments)),logged(log,"annotation partial")),(List((128,64),(192,1)),Nil))
  }}

  test("G2-T12: a window whose input changed under its ledger fails annotation-input-changed, keeps every row and calls nothing; RetryJob starts it afresh") { database { (config,db,archive) =>
    val request=source(texts(128)); val receipt=archive.ingest("a",request)
    once(archive,config,new Provider((n,window,previous) => if(window.fragments.head.messagePosition==0) IO.pure(whole(window,previous)) else if(n==1) IO.pure(upTo(10,true)) else interrupted))
    val held=(ledger(db,receipt.jobId,1),partials(db,receipt.jobId),markers(db,receipt.jobId))
    // Window 0's accepted decision is rewritten: window 1's carry, and so its input, change.
    val other=CheckpointJson.decision(Decision(Vector(problem(Point(0,0),Point(64,0),false,"another goal"))))
    db.transaction(c => Sql.exec(c,"UPDATE ch_index_checkpoints SET value=?,output_hash=? WHERE job_id=? AND stage='Annotation' AND window_ordinal=0",other.noSpaces,IndexCheckpoints.hash(other),receipt.jobId))
    due(db,receipt.jobId)
    val none=new Provider((_,_,_) => IO.raiseError(new AssertionError("no call under a changed input")))
    once(archive,config,none)
    assertEquals((none.seen,job(db,receipt.jobId).copy(attempts=0)),(Nil,Job("Failed",Some(AnnotationAttempts.inputChangedCode),0,0)))
    assertEquals((ledger(db,receipt.jobId,1),partials(db,receipt.jobId),markers(db,receipt.jobId)),held)
    archive.retry("a",receipt.jobId)
    val full=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
    once(archive,config,full)
    assertEquals((full.seen.map(_.position),job(db,receipt.jobId).state),(List(64),"Complete"))
  }}

  test("G2-T13: a kept answer whose rest would exceed the request bounds is rejected unrequestable (fresh and extended); a stored one that no longer fits is discarded") { database { (fixture,_,_) =>
    // Quote-heavy source and maximal valid metadata: the carry after such an answer is near its bound.
    val noisy=(0 until 64).map(i => "\""*60+s" $i").toVector
    val loud=problem(Point(0,0),Point(10,0),false,"\u0001"*1000,(0 until 16).map(i => "\u0001"*62+f"$i%02d").toList)
    val request=source(noisy); val window=windows(request)(0)
    def size(config: Config,window: Window,previous: Option[Carry]): Int = ProblemPassageHttp.request(config.annotation,window,previous).noSpaces.getBytes("UTF-8").length-window.encodedSourceContentBytes
    val quiet=problem(Point(0,0),Point(10,0),false,"q")
    val small=size(fixture,ProblemPassages.tail(window,10),ProblemPassages.carryAfter(start,window,Vector(quiet)))
    val large=size(fixture,ProblemPassages.tail(window,20),ProblemPassages.carryAfter(start,window,Vector(quiet,loud.copy(start=Point(10,0),end=Point(20,0),continuePrevious=true))))
    // A model name that leaves room for the small carry only; the profile is this configuration's throughout.
    val config=fixture.copy(annotation=fixture.annotation.copy(model="m"*(ProblemPassages.requestReserveBytes-small-(large-small)/2)))
    val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    try {
      db.transaction(c => Sql.exec(c,"UPDATE ch_owner_targets SET profile=?",config.profile))
      val archive=new PostgresArchive(db,config)
      def http(script: Int => Decision): ProblemPassageAnnotator = {
        val calls=new java.util.concurrent.atomic.AtomicInteger(0)
        val app: HttpApp[IO]=cats.data.Kleisli(_ => IO(Response[IO](Status.Ok).withEntity(ProblemPassageFixtures.envelope(ProblemPassageFixtures.json(script(calls.getAndIncrement())).noSpaces,"stop").noSpaces)))
        new OpenAIProblemPassageAnnotator(ModelFixtures.http(Client.fromHttpApp(app),config),config)
      }
      // (a) A fresh stop with maximal metadata: rejected, no partial, the whole window asked again.
      val fresh=archive.ingest("a",request)
      once(archive,config,http(n => if(n==0) Decision(Vector(loud)) else Decision(Vector(problem(Point(0,0),Point(64,0),false)))))
      assertEquals((ledger(db,fresh.jobId),partials(db,fresh.jobId),job(db,fresh.jobId).state),(List(AnnotationAttempts.unrequestableReason,"accepted(0)"),Nil,"Complete"))
      // (c) A prefix at 10 that fits, then an extension to 20 that does not: rejected, the prefix stays, its rest asked again.
      val extended=archive.ingest("a",source(noisy))
      val asked=new ConcurrentLinkedQueue[Int]()
      val recording=new ForwardingArchive(archive) {
        override def reserveAnnotation(c: Claim,key: CheckpointKey,prefix: Boolean): AnnotationReservation = { asked.add(partials(db,c.jobId).headOption.fold(0)(_.covered)); super.reserveAnnotation(c,key,prefix) }
      }
      once(recording,config,http {
        case 0 => Decision(Vector(quiet))
        case 1 => Decision(Vector(loud.copy(end=Point(10,0),continuePrevious=true)))
        case _ => Decision(Vector(problem(Point(0,0),Point(54,0),true)))
      })
      assertEquals((ledger(db,extended.jobId),asked.asScala.toList,job(db,extended.jobId).state),(List("continued",AnnotationAttempts.unrequestableReason,"accepted(1)"),List(0,10,10),"Complete"))
      // (b) A stored partial whose rest no longer fits (the request bound forced): discarded, the whole window asked.
      val stored=archive.ingest("b",source(noisy))
      once(archive,config,new Provider((n,_,_) => if(n==0) IO.pure(Decision(Vector(quiet))) else interrupted)); due(db,stored.jobId)
      val log=new WorkerLog
      val unfit=new Provider((_,window,previous) => IO.pure(whole(window,previous))) {
        override def tailRequestFits(window: Window,covered: Int,previous: Option[Carry]): Boolean = false
      }
      once(archive,config,unfit,log)
      assertEquals((matching(log,discardedLine(stored.jobId,"carry")),unfit.seen.map(_.fragments),job(db,stored.jobId).state),(1,List(64),"Complete"))
    } finally db.close()
  }}

  test("G2-T14: a newer revision ends a leased older job's chain: its kept writes, discard and reservations are stale; a job without a prefix finishes as today") { database { (config,db,archive) =>
    def ingest(owner: String,count: Int): (IngestRequest,IngestReceipt) = { val request=source(texts(count)); (request,archive.ingest(owner,request)) }
    // J1: window 1 kept at (10,0); while its rest is asked, an append arrives; the extension is stale and J1 superseded.
    val (j1Request,j1)=ingest("a",128)
    val claims=new ConcurrentLinkedQueue[Claim]()
    val claiming=new ForwardingArchive(archive) { override def claim(p: Set[String],s: ClaimScope,l: Int,large: LargeJobs): Option[Claim] = { val c=super.claim(p,s,l,large); c.foreach(claims.add); c } }
    once(claiming,config,new Provider((n,window,previous) => window.fragments.head.messagePosition match {
      case 0 => IO.pure(whole(window,previous))
      case 64 => IO.pure(upTo(10,true))
      case _ => IO.blocking(archive.ingest("a",append(j1Request,texts(129),1))).as(upTo(10,true))
    }))
    // Ended superseded: its partial and chain marker are deleted with it (SWITCH), its ledger rows stay.
    assertEquals((job(db,j1.jobId).error,ledger(db,j1.jobId,1),partials(db,j1.jobId),markers(db,j1.jobId)),(Some(Jobs.supersededRevision),List("continued","none"),Nil,Nil))
    val staleKey=IndexCheckpoints.annotation(claims.peek,1,Json.Null)
    // J2 (the new head) keeps its window 1 partial against a stale J1 discard; then it completes. J1's row is never loaded.
    val log=new WorkerLog; val staleDiscard=new java.util.concurrent.atomic.AtomicBoolean(false)
    once(archive,config,new Provider((n,window,previous) => window.fragments.head.messagePosition match {
      case 64 => IO.pure(upTo(10,true))
      case 74 => IO.blocking {
        staleDiscard.set(true)
        val j2=db.transaction(c => Sql.one(c,"SELECT id FROM ch_jobs WHERE session_id=? AND revision=2",j1.sessionId)(_.getObject(1,classOf[UUID])).get)
        val before=written(db,j2)
        assertEquals(intercept[DomainError](archive.discardPartial(claims.peek,staleKey)).code,"stale-claim")
        assertEquals(written(db,j2),before)
      }.as(whole(window,previous))
      case _ => IO.pure(whole(window,previous))
    }),log)
    assertEquals((staleDiscard.get,logged(log,"annotation partial")),(true,Nil))
    // J3: the append commits between its partial's load and the rest's reservation: refused, no call.
    val (j3Request,j3)=ingest("b",64)
    once(archive,config,new Provider((n,_,_) => if(n==0) IO.pure(upTo(10,false)) else interrupted)); due(db,j3.jobId)
    val appending=new ForwardingArchive(archive) {
      override def loadPartial(c: Claim,key: CheckpointKey): PartialLoad = { val load=super.loadPartial(c,key); archive.ingest("b",append(j3Request,texts(65),1)); load }
    }
    val none=new Provider((_,_,_) => IO.raiseError(new AssertionError("a call for a stale chain")))
    once(appending,config,none)
    assertEquals((none.seen,job(db,j3.jobId).error,ledger(db,j3.jobId)),(Nil,Some(Jobs.supersededRevision),List("continued","none")))
    once(archive,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))))
    // J4 (control): no prefix; an append arrives while its whole-window answer is asked: it completes and publishes.
    val (j4Request,j4)=ingest("c",64)
    once(archive,config,new Provider((_,window,previous) => IO.blocking(archive.ingest("c",append(j4Request,texts(65),1))).as(whole(window,previous))))
    assertEquals((job(db,j4.jobId).state,archive.session("c",j4.sessionId).indexedRevision),("Complete",Some(1)))
    once(archive,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))))
    // J5 on its fifth claim: an older leased claim's boundary stop writes no partial; Failed stale-claim, never claimed again.
    val (j5Request,j5)=ingest("c",64)
    db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET attempts=4 WHERE id=?",j5.jobId))
    once(archive,config,new Provider((_,_,_) => IO.blocking(archive.ingest("c",append(j5Request,texts(65),1))).as(upTo(10,false))))
    assertEquals((job(db,j5.jobId),ledger(db,j5.jobId),partials(db,j5.jobId),markers(db,j5.jobId)),(Job("Failed",Some("stale-claim"),5,0),List("none"),Nil,Nil))
  }}

  /** A window kept at (10,0) whose rest is answered by `rest` after the session's next revision arrived during the call. */
  private def staleRest(archive: PostgresArchive,config: Config,rest: (Window,Option[Carry]) => Decision): IngestReceipt = {
    val request=source(texts(64)); val receipt=archive.ingest("a",request)
    once(archive,config,new Provider((n,window,previous) =>
      if(n==0) IO.pure(upTo(10,false)) else IO.blocking(archive.ingest("a",append(request,texts(65),1))).as(rest(window,previous))))
    receipt
  }
  test("G2-T14 (accept): a complete rest answered after a newer revision arrived is not accepted; the job ends superseded") { database { (config,db,archive) =>
    val receipt=staleRest(archive,config,whole)
    assertEquals((job(db,receipt.jobId).error,ledger(db,receipt.jobId),partials(db,receipt.jobId)),(Some(Jobs.supersededRevision),List("continued","none"),Nil))
    assertEquals(db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_index_checkpoints WHERE job_id=? AND stage='Annotation'",receipt.jobId)(_.getInt(1))),Some(0))
  }}
  test("G2-T14 (reject): a rejected rest answered after a newer revision arrived records no rejection; the job ends superseded") { database { (config,db,archive) =>
    val receipt=staleRest(archive,config,(_,_) => Decision(Vector(problem(Point(0,0),Point(0,1),true))))
    assertEquals((job(db,receipt.jobId).error,ledger(db,receipt.jobId),partials(db,receipt.jobId)),(Some(Jobs.supersededRevision),List("continued","none"),Nil))
  }}
  test("G2-T14 (load miss): a newer revision arriving before an older leased job loads a window without a partial leaves today's authority: the window is annotated and the job publishes") { database { (config,db,archive) =>
    val request=source(texts(128)); val receipt=archive.ingest("a",request)
    val appending=new ForwardingArchive(archive) {
      override def loadPartial(c: Claim,key: CheckpointKey): PartialLoad = {
        if(key.window==1) archive.ingest("a",append(request,texts(129),1))
        super.loadPartial(c,key)
      }
    }
    once(appending,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))))
    assertEquals((job(db,receipt.jobId).state,ledger(db,receipt.jobId,1),archive.session("a",receipt.sessionId).indexedRevision),("Complete",List("accepted(0)"),Some(1)))
  }}

  test("G2-T15: an acceptance after a resumed rest is progress: a transient failure that follows is the first of a new streak") { database { (config,db,archive) =>
    val receipt=kept(db,archive,config,"a",List(upTo(10,false)))
    db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET transient_failures=? WHERE id=?",Jobs.transientBackoff.limit-1,receipt.jobId))
    val failing=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(JdbcFailure("database-unavailable",Some("08006")))
    }
    assert(worker(archive,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))),embedding=failing).once.unsafeRunSync())
    assertEquals((job(db,receipt.jobId).copy(attempts=0),ledger(db,receipt.jobId)),(Job("Queued",Some(Jobs.transientCode),0,1),List("continued","none","accepted(1)")))
  }}

  test("G2-T18 + G2-T16: only the active chain resumes: a discarded chain's restored row is discarded, a fallback chain resumes, a restored row after a clear is discarded") { database { (config,db,archive) =>
    def row(id: UUID): String = db.transaction(c => Sql.one(c,"SELECT row_to_json(p)::text FROM ch_annotation_partials p WHERE job_id=?",id)(_.getString(1)).get)
    def restore(id: UUID,value: String): Unit = db.transaction { c =>
      Sql.exec(c,"DELETE FROM ch_annotation_partials WHERE job_id=?",id)
      Sql.exec(c,"INSERT INTO ch_annotation_partials SELECT * FROM json_populate_record(NULL::ch_annotation_partials,?::json)",value); ()
    }
    /** Chain A kept at 10, discarded (corrupt); the full fallback kept at 20 (chain B), then the worker is killed. */
    def fallback(owner: String): (IngestReceipt,String,String) = {
      val receipt=kept(db,archive,config,owner,List(upTo(10,false))); val a=row(receipt.jobId)
      db.transaction(c => Sql.exec(c,"UPDATE ch_annotation_partials SET kept_hash=repeat('0',64) WHERE job_id=?",receipt.jobId))
      killedIn(db,archive,config,receipt.jobId,1)((_,_,_) => IO.pure(upTo(20,false)))
      assertEquals(chains(db,receipt.jobId).size,2)
      assertEquals((partials(db,receipt.jobId).map(p => (p.covered,p.continuations)),markers(db,receipt.jobId)),(List((20,1)),List(Some(partials(db,receipt.jobId).head.chain))))
      (receipt,a,row(receipt.jobId))
    }
    // Control (T16): chain B resumes with its rest; A's rows stay in the ledger.
    val (control,_,_)=fallback("a")
    val log=new WorkerLog; val rest=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
    once(archive,config,rest,log)
    assertEquals((rest.seen.map(_.position),matching(log,resumedLine(control.jobId,0,1,20,64,1))),(List(20),1))
    assertEquals(ledger(db,control.jobId),List("continued","none","continued","none","accepted(1)"))
    // A restored over B: discarded as inactive, no resume of A, the whole window asked (and interrupted).
    val (receipt,a,b)=fallback("b"); val id=receipt.jobId
    restore(id,a)
    val restoredA=new WorkerLog; val full=new Provider((_,_,_) => interrupted)
    once(archive,config,full,restoredA); due(db,id)
    assertEquals((matching(restoredA,discardedLine(id,"provenance")),full.seen.map(_.position),markers(db,id)),(1,List(0),List(None)))
    // B restored after the clear: discarded too; the whole window completes.
    restore(id,b)
    val restoredB=new WorkerLog; val again=new Provider((_,window,previous) => IO.pure(whole(window,previous)))
    once(archive,config,again,restoredB)
    assertEquals((matching(restoredB,discardedLine(id,"provenance")),again.seen.map(_.position),job(db,id).state),(1,List(0),"Complete"))
  }}

  test("down-031 drops the partials, the chain markers and the three attempt columns; a start migrates again") { database { (config,db,archive) =>
    kept(db,archive,config,"a",List(upTo(10,false)))
    val name=config.jdbcUrl.drop(config.jdbcUrl.lastIndexOf('/')+1)
    def run(variables: (String,String)*): (Int,List[String]) = {
      val psql=java.nio.file.Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
      val address=config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
      val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),"PGUSER"->config.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->name)
      val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1")++variables.flatMap((key,value) => List("-v",s"$key=$value"))++List("-f",java.nio.file.Path.of("scripts","down-031-annotation-partials.sql").toString),sys.env,connection,CheckChild.limit)
      (ran.exit,ran.out.linesIterator.toList)
    }
    try {
      val (preflightExit,preflight)=run()
      assertEquals((preflightExit,preflight.last),(0,"DOWN031.result|preflight-complete"),preflight.mkString("\n"))
      val printed=preflight.map(_.split('|')).collect { case Array(key,value) => key->value }.toMap
      assertEquals(List("partials","active_chains","attempts.continued").map(key => printed(s"DOWN031.$key")),List("1","1","1"))
      val (appliedExit,applied)=run("mode"->"apply","apply_irreversible"->"yes","confirm_database"->name,"expect_plan"->printed("DOWN031.plan"))
      assertEquals((appliedExit,applied.last),(0,"DOWN031.result|applied"),applied.mkString("\n"))
      db.transaction { c =>
        assertEquals(Sql.one(c,"SELECT count(*) FROM information_schema.columns WHERE table_name='ch_annotation_attempts' AND column_name IN('accepted_continuations','continued_kept_hash','chain_id')")(_.getInt(1)),Some(0))
        assertEquals(Sql.one(c,"SELECT to_regclass('ch_annotation_partials') IS NULL AND to_regclass('ch_annotation_active_chains') IS NULL")(_.getBoolean(1)),Some(true))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_annotation_attempts WHERE rejection_reason=?",AnnotationAttempts.continuedReason)(_.getInt(1)),Some(1))
      }
    } finally db.initialize()
    db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM pg_constraint WHERE conrelid='ch_annotation_attempts'::regclass AND contype='c'")(_.getInt(1)),Some(7)))
  }}

  /** The archive operations of the continuation path (ANNOT2): each call is recorded and refused. */
  private final class WholeWindowOnly(archive: SessionArchive) extends ForwardingArchive(archive) {
    val called=new ConcurrentLinkedQueue[String]()
    private def refused(name: String): Nothing = { called.add(name); throw new AssertionError(s"$name with annotation continuations off") }
    override def reserveAnnotation(c: Claim,key: CheckpointKey,prefix: Boolean): AnnotationReservation = refused("reserveAnnotation(prefix)")
    override def rejectAnnotation(c: Claim,key: CheckpointKey,attempt: Int,reason: String,prefix: Boolean): Int = refused("rejectAnnotation(prefix)")
    override def loadPartial(c: Claim,key: CheckpointKey): PartialLoad = refused("loadPartial")
    override def discardPartial(c: Claim,key: CheckpointKey): Unit = refused("discardPartial")
    override def continueAnnotation(c: Claim,key: CheckpointKey,attempt: Int,partial: AnnotationPartial): Int = refused("continueAnnotation")
    override def acceptAnnotation(c: Claim,key: CheckpointKey,attempt: Int,continuations: Int,value: Json): Unit = refused("acceptAnnotation")
  }
  test("SWITCH off: a boundary stop is rejected annotation-partition-incomplete as before ANNOT2 and the whole window asked again; no operation of the continuation path, no 031 row or column, the windows accepted line without its continuation fields") { database { (config,db,archive) =>
    val off=ModelFixtures.continuations(config,false); val request=source(texts(64)); val window=windows(request)(0)
    val receipt=archive.ingest("a",request); val guarded=new WholeWindowOnly(archive); val log=new WorkerLog
    val provider=new Provider((n,window,previous) => IO.pure(n match {
      case 0 => upTo(10,false)
      case 1 => Decision(Vector(problem(Point(0,0),Point(5,1),false)))
      case _ => whole(window,previous)
    }))
    once(guarded,off,provider,log)
    assertEquals((guarded.called.asScala.toList,provider.seen.map(a => (a.position,a.fragments,a.previous))),(Nil,List.fill(3)((0,64,None))))
    def rejected(attempt: Int,stop: Point): String =
      s"annotation attempt failed jobId=${receipt.jobId} fence=\\d+ windowOrdinal=0 totalWindows=1 attempt=$attempt rejected=$attempt rejectionLimit=5 reservationLimit=10 code=model-output reason=annotation-partition-incomplete " +
        java.util.regex.Pattern.quote(s"""structure={"location":"coverage","structure":[{"fragmentIndex":${stop.fragmentIndex},"scalarOffset":${stop.scalarOffset}},{"expectedFragmentIndex":64,"expectedScalarOffset":0},{"fragmentCount":64,"scalarCount":${window.scalarCount}}]}""")
    assertEquals((matching(log,rejected(1,Point(10,0))),matching(log,rejected(2,Point(5,1)))),(1,1))
    assertEquals(matching(log,s"windows accepted jobId=${receipt.jobId} fence=\\d+ totalWindows=1 reusedDecisions=0 reusedEmbeddingParts=0"),1)
    assertEquals(log.lines.filter(line => line.startsWith("annotation partial") || line.startsWith("annotation answer")),Nil)
    assertEquals((ledger(db,receipt.jobId),chains(db,receipt.jobId),partials(db,receipt.jobId),markers(db,receipt.jobId)),(List("annotation-partition-incomplete","annotation-partition-incomplete","none"),Nil,Nil,Nil))
    assertEquals(job(db,receipt.jobId).state,"Complete"); searchRowsAreChunks(db,receipt.sessionId)
  }}
  test("SWITCH off: a window whose input changed under its ledger is the internal fault it was before ANNOT2: no call, every row kept") { database { (config,db,archive) =>
    val off=ModelFixtures.continuations(config,false); val receipt=archive.ingest("a",source(texts(128)))
    once(archive,off,new Provider((n,window,previous) => if(window.fragments.head.messagePosition==0) IO.pure(whole(window,previous)) else if(n==1) IO.pure(upTo(10,true)) else interrupted))
    val rows=(ledger(db,receipt.jobId,0),ledger(db,receipt.jobId,1))
    assertEquals(rows,(List("none"),List("annotation-partition-incomplete","none")))
    val other=CheckpointJson.decision(Decision(Vector(problem(Point(0,0),Point(64,0),false,"another goal"))))
    db.transaction(c => Sql.exec(c,"UPDATE ch_index_checkpoints SET value=?,output_hash=? WHERE job_id=? AND stage='Annotation' AND window_ordinal=0",other.noSpaces,IndexCheckpoints.hash(other),receipt.jobId))
    due(db,receipt.jobId)
    val none=new Provider((_,_,_) => IO.raiseError(new AssertionError("no call under a changed input")))
    assertEquals(intercept[DomainError](worker(archive,off,none).once.unsafeRunSync()).code,"internal")
    assertEquals((none.seen,(ledger(db,receipt.jobId,0),ledger(db,receipt.jobId,1))),(Nil,rows))
  }}
  test("SWITCH (i) on then off: kept parts written with continuations on are never loaded with them off; the whole window is asked, its kept answer counts among the five; the acceptance deletes the partial and the marker and leaves its row unmarked") { database { (config,db,archive) =>
    val receipt=kept(db,archive,config,"a",List(upTo(10,false)))
    val log=new WorkerLog; val guarded=new WholeWindowOnly(archive)
    val provider=new Provider((n,window,previous) => IO.pure(if(n==0) upTo(10,false) else whole(window,previous)))
    once(guarded,ModelFixtures.continuations(config,false),provider,log)
    assertEquals((guarded.called.asScala.toList,provider.seen.map(a => (a.position,a.fragments,a.previous))),(Nil,List.fill(2)((0,64,None))))
    assertEquals(log.lines.filter(line => line.startsWith("annotation partial") || line.startsWith("annotation answer")),Nil)
    assertEquals(matching(log,s"annotation attempt failed jobId=${receipt.jobId} fence=\\d+ windowOrdinal=0 totalWindows=1 attempt=3 rejected=2 .* reason=annotation-partition-incomplete .*"),1)
    assertEquals((ledger(db,receipt.jobId),partials(db,receipt.jobId),markers(db,receipt.jobId),job(db,receipt.jobId).state),(List("continued","none","annotation-partition-incomplete","none"),Nil,Nil,"Complete"))
  }}
  test("SWITCH (ii): a job that ends superseded loses its partials and chain markers: on, held when a newer revision arrives; off, kept while its claim is leased, deleted when its transient failure ends it superseded") { database { (config,db,archive) =>
    def keptAt10(request: IngestRequest): IngestReceipt = {
      val receipt=archive.ingest("a",request)
      once(archive,config,new Provider((n,_,_) => if(n==0) IO.pure(upTo(10,false)) else interrupted))
      assertEquals((partials(db,receipt.jobId).map(_.covered),markers(db,receipt.jobId).map(_.nonEmpty)),(List(10),List(true)))
      receipt
    }
    val heldRequest=source(texts(64)); val held=keptAt10(heldRequest)
    archive.ingest("a",append(heldRequest,texts(65),1))
    assertEquals((job(db,held.jobId).error,partials(db,held.jobId),markers(db,held.jobId),ledger(db,held.jobId)),(Some(Jobs.supersededRevision),Nil,Nil,List("continued","none")))
    once(archive,config,new Provider((_,window,previous) => IO.pure(whole(window,previous))))
    val leasedRequest=source(texts(64)); val leased=keptAt10(leasedRequest); due(db,leased.jobId)
    @volatile var whileLeased=(0,0)
    val appending=new Provider((_,_,_) => IO.blocking {
      archive.ingest("a",append(leasedRequest,texts(65),1))
      whileLeased=(partials(db,leased.jobId).size,markers(db,leased.jobId).size)
    } *> interrupted)
    once(archive,ModelFixtures.continuations(config,false),appending)
    assertEquals((whileLeased,job(db,leased.jobId).error,partials(db,leased.jobId),markers(db,leased.jobId)),((1,1),Some(Jobs.supersededRevision),Nil,Nil))
  }}
  test("SWITCH (iii) off then on: nothing to migrate; a window accepted with continuations off is reused with no call and counted unmarked, a new acceptance carries its marker") { database { (config,db,archive) =>
    val earlier=archive.ingest("a",source(texts(64)))
    once(archive,ModelFixtures.continuations(config,false),new Provider((n,window,previous) => IO.pure(if(n==0) upTo(10,false) else whole(window,previous))))
    assertEquals(counts(config,List(earlier.jobId)),List("jobs|1","windows.one_answer|0","windows.after_continuation|0","windows.accepted_unmarked|1","answers.continued|0","answers.abandoned|0",
      "answers.rejected|1","answers.rejected.annotation-partition-incomplete|1","authorizations.no_outcome|0","chains.open|0","chains.invalid_or_inactive|0","chains.stale|0","windows.reused|0","answers|2","r|0.5000"))
    archive.retry("a",earlier.jobId)
    val root=config.copy(indexing=config.indexing.copy(incrementalPublication=false))
    val none=new Provider((_,_,_) => IO.raiseError(new AssertionError("a call for a window accepted with continuations off")))
    once(new PostgresArchive(db,root),root,none)
    val later=archive.ingest("a",source(texts(64)))
    once(archive,config,new Provider((n,window,previous) => IO.pure(if(n==0) upTo(10,false) else whole(window,previous))))
    assertEquals((none.seen,job(db,earlier.jobId).state,ledger(db,later.jobId),job(db,later.jobId).state),(Nil,"Complete",List("continued","accepted(1)"),"Complete"))
    assertEquals(counts(config,List(earlier.jobId,later.jobId)),List("jobs|2","windows.one_answer|0","windows.after_continuation|1","windows.accepted_unmarked|0","answers.continued|1","answers.abandoned|0",
      "answers.rejected|0","authorizations.no_outcome|0","chains.open|0","chains.invalid_or_inactive|0","chains.stale|0","windows.reused|1","answers|2","r|0.0000"))
  }}
}
