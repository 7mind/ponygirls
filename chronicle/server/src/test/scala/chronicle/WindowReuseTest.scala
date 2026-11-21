package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import io.circe.Json
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.*
import ProblemPassages.{Decision,Part,Point}

/** Window reuse for append-only growth, I2 (ingest-limits spec §5.4, migration 027): a run's window whose input (source
  * and carry) an earlier run of the source accepted takes that output by a reference to the exact checkpoint, the
  * publication and a resumed run replay the reference, purge removes everything; the down-script of 027. */
final class WindowReuseTest extends munit.FunSuite {
  override val munitTimeout=2.minutes
  private def database(f: (Config,Database,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    try f(config,db,new PostgresArchive(db,config)) finally db.close()
  }
  private def message(id: String,position: Int,text: String): Message = Message(id,None,"user",text,None,position)
  /** Short distinct messages from position `from`: one fragment each, 64 to a window. */
  private def messages(from: Int,until: Int): List[Message] = (from until until).map(i => message(s"s$i",i,s"message $i about topic ${i%7}")).toList
  private def request(values: List[Message],source: Option[SourceIdentity]=None,revision: Int=0): IngestRequest = {
    val raw=values.map(m => Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(m.text)).noSpaces+"\n").mkString
    val base=Fixtures.snapshot()
    base.copy(source=source.getOrElse(base.source),expectedRevision=revision,messages=values,files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private def next(archive: PostgresArchive,id: UUID,values: List[Message],revision: Int): IngestReceipt =
    archive.ingest("a",request(values,Some(archive.headSnapshot("a",id).source),revision))
  /** A filler message ('x's, id `fill…`) placed after `before` that ends a window exactly: `following` no longer fits. */
  private def filler(id: String,before: List[Message],following: Message): Message =
    (62*ProblemPassages.maximumFragmentBytes to 58*ProblemPassages.maximumFragmentBytes by -16).iterator.map(n => message(id,before.size,"x"*n)).find { candidate =>
      val source=ProblemPassages.Source(before:+candidate:+following)
      Iterator.iterate(source.next(ProblemPassages.SourceCursor.start))(_.flatMap(window => source.next(window.next))).takeWhile(_.nonEmpty).flatten
        .exists(window => window.next.messagePosition==before.size+1 && window.next.utf16Offset==0)
    }.getOrElse(fail("no filler length ends a window"))
  /** A window that starts with a filler message is Context; any other is a new problem named by the label and its first
    * message. Counts its calls. */
  private final class Annotator(@volatile var label: String) extends ProblemPassageAnnotator {
    val calls=new AtomicInteger(0)
    def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[Decision] = IO {
      calls.incrementAndGet()
      val first=window.fragments.head.messageId
      Decision(Vector(if(first.startsWith("fill")) Part.context(Point(0,0),window.terminal) else Part(Point(0,0),window.terminal,false,s"$label $first",List(label))))
    }
  }
  /** The same vector for the same text; counts its calls; `failing` fails the next call. */
  private final class Vectors extends Embedder {
    val calls=new AtomicInteger(0)
    @volatile var failing=false
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO {
      if(failing) { failing=false; throw DomainError("model-timeout","synthetic embedding deadline") }
      calls.incrementAndGet()
      text.map { value => val h=Wire.hash(value); List(1.0,Integer.parseInt(h.take(4),16)/65536.0,Integer.parseInt(h.slice(4,8),16)/65536.0) }
    }
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker queried embedding"))
  }
  private def worker(archive: SessionArchive,config: Config,annotator: Annotator,vectors: Vectors): Worker = ModelFixtures.worker(archive,annotator,vectors,config,logstage.IzLogger())
  /** Model calls made by `body`: (annotation, embedding). */
  private def calls(annotator: Annotator,vectors: Vectors)(body: => Unit): (Int,Int) = {
    annotator.calls.set(0); vectors.calls.set(0); body; (annotator.calls.get,vectors.calls.get)
  }
  /** A generation's rows without the ids its run names (chunks, passages) and its session. */
  private def content(db: Database,generation: UUID): Map[String,List[String]] = db.transaction { c => Map(
    "chunks"->"SELECT concat_ws('|',(value-'id'-'sessionId')::text,document::text,embedding::text,ordinal) FROM ch_chunks WHERE generation=? ORDER BY ordinal",
    "passages"->"SELECT concat_ws('|',ordinal,initial_summary,(value-'id')::text,span_count) FROM ch_problem_passages WHERE generation=? ORDER BY ordinal",
    "spans"->"SELECT concat_ws('|',p.ordinal,s.ordinal,s.message_id,s.message_position,s.start_byte,s.end_byte) FROM ch_problem_spans s JOIN ch_problem_passages p ON p.generation=s.generation AND p.id=s.passage_id WHERE s.generation=? ORDER BY p.ordinal,s.ordinal",
    "context"->"SELECT concat_ws('|',ordinal,message_id,message_position,start_byte,end_byte) FROM ch_context_spans WHERE generation=? ORDER BY ordinal",
    "tags"->"SELECT tag FROM ch_generation_tags WHERE generation=? ORDER BY tag"
  ).map((table,sql) => table->Sql.rows(c,sql,generation)(_.getString(1))) }
  private def published(archive: PostgresArchive,id: UUID): UUID = archive.session("a",id).view.generationId.getOrElse(fail("not published"))
  private def job(db: Database,id: UUID,revision: Int): (UUID,UUID,String) =
    db.transaction(c => Sql.one(c,"SELECT id,run_id,state FROM ch_jobs WHERE session_id=? AND revision=?",id,revision)(r => (r.getObject(1,classOf[UUID]),r.getObject(2,classOf[UUID]),r.getString(3)))).get
  /** A run's references: (stage, window, part) -> (source job, source run, source window, source part). */
  private def references(db: Database,jobId: UUID,runId: UUID): Map[(String,Int,Int),(UUID,UUID,Int,Int)] = db.transaction(c => Sql.rows(c,
    "SELECT stage,window_ordinal,part,source_job,source_run,source_window,source_part FROM ch_index_checkpoint_refs WHERE job_id=? AND run_id=?",jobId,runId)(r =>
    (r.getString(1),r.getInt(2),r.getInt(3))->(r.getObject(4,classOf[UUID]),r.getObject(5,classOf[UUID]),r.getInt(6),r.getInt(7)))).toMap
  private def summaries(db: Database,generation: UUID): List[String] =
    db.transaction(c => Sql.rows(c,"SELECT value->>'summary' FROM ch_problem_passages WHERE generation=? ORDER BY ordinal",generation)(_.getString(1)))

  test("an append re-annotates only the windows from the previous revision's last one on and publishes what a fresh run does; RetryJob of the Complete job republishes with every window reused, no model call; purge removes every job, checkpoint and reference") { database { (config,db,archive) =>
    val (annotator,vectors)=(new Annotator("goal"),new Vectors)
    val lane=worker(archive,config,annotator,vectors)
    // Revision 1: windows of 64, 64, 64 and 10 messages (13 embedding parts of at most 16 pieces).
    val first=archive.ingest("a",request(messages(0,202)))
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(4,13))
    // Revision 2 appends 70: windows 0-2 are revision 1's; window 3 (now 64 messages) and window 4 (16) are new.
    next(archive,first.sessionId,messages(0,272),1)
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(2,5))
    val appended=job(db,first.sessionId,2)
    val firstJob=job(db,first.sessionId,1)
    assertEquals(references(db,appended._1,appended._2).collect { case ((stage,window,part),(source,_,sourceWindow,sourcePart)) if source==firstJob._1 => (stage,window,part,sourceWindow,sourcePart) }.toList.sorted,
      ((0 until 3).map(w => ("Annotation",w,0,w,0))++(0 until 3).flatMap(w => (0 until 4).map(p => ("Embedding",w,p,w,p)))).toList.sorted)
    val reused=published(archive,first.sessionId)
    val fresh=archive.ingest("a",request(messages(0,272)))
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(5,17))
    assertEquals(content(db,reused),content(db,published(archive,fresh.sessionId)))
    // A new run of the same revision: every decision and part by reference to the previous run, a new generation.
    archive.retry("a",appended._1)
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(0,0))
    val retried=job(db,first.sessionId,2)
    assertEquals((retried._3,references(db,retried._1,retried._2).size),("Complete",5+17))
    assert(published(archive,first.sessionId)!=reused)
    assertEquals(content(db,published(archive,first.sessionId)),content(db,reused))
    val jobs=List(firstJob._1,appended._1)
    def remaining: List[Int] = db.transaction(c => List("ch_jobs WHERE id","ch_index_checkpoints WHERE job_id","ch_index_checkpoint_refs WHERE job_id","ch_index_checkpoint_refs WHERE source_job").map(where =>
      Sql.one(c,s"SELECT count(*) FROM $where IN(?,?)",jobs.head,jobs(1))(_.getInt(1)).get))
    assert(remaining.forall(_>0),remaining)
    val auth=new Auth(db,config)
    auth.mutate(auth.browser(auth.login(LoginRequest("a","synthetic"))._2),ClientEnvelope(UUID.randomUUID(),Operation.Purge(first.sessionId)))
    assertEquals(remaining,List(0,0,0,0))
  }}

  test("a confirmed rebuild into the same profile calls the models for every window, also across its own resume; a retry of its Complete job calls none") { database { (config,db,archive) =>
    val (annotator,vectors)=(new Annotator("goal"),new Vectors)
    val lane=worker(archive,config,annotator,vectors)
    val receipt=archive.ingest("a",request(messages(0,202)))
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(4,13))
    val auth=new Auth(db,config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val plan=auth.previewOwnerReindex(owner)
    assertEquals(plan.targetProfile,config.profile)
    auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.ApplyOwnerReindex(plan.targetProfile,plan.selectionHash,true)))
    // The rebuild's run stops at its first embedding part and resumes from its own window 0.
    vectors.failing=true
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(1,0))
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(3,13))
    val (rebuilt,run,state)=job(db,receipt.sessionId,1)
    assertEquals((state,references(db,rebuilt,run)),("Complete",Map.empty))
    archive.retry("a",rebuilt)
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(0,0))
    assertEquals(job(db,receipt.sessionId,1)._3,"Complete")
  }}

  test("a replacement into a new epoch reuses each decision whose source and positions are unchanged, from its full source key at another window ordinal of the older run, and none where positions moved") { database { (config,db,archive) =>
    val (annotator,vectors)=(new Annotator("goal"),new Vectors)
    val lane=worker(archive,config,annotator,vectors)
    val tail=messages(2,101)
    // Revision 1: two filler windows (Context), then windows from position 2 and 66.
    val fill1=filler("fill1",List(filler("fill0",Nil,message("fill1",1,"x"))),tail.head)
    val fill0=filler("fill0",Nil,fill1)
    val first=archive.ingest("a",request(fill0::fill1::tail))
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync()))._1,4)
    // Revision 2 replaces the fillers by one filler window of two messages: the windows from position 2 are revision 1's
    // windows 2 and 3, now windows 1 and 2, with the same carry.
    val short=message("fill-short",0,"short")
    next(archive,first.sessionId,short::filler("fill-long",List(short),tail.head)::tail,1)
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(1,0))
    val (firstJob,firstRun,_)=job(db,first.sessionId,1); val (replaced,run,_)=job(db,first.sessionId,2)
    assertEquals(references(db,replaced,run).filter(_._1._1=="Annotation"),Map(("Annotation",1,0)->(firstJob,firstRun,2,0),("Annotation",2,0)->(firstJob,firstRun,3,0)))
    assert(references(db,replaced,run).filter(_._1._1=="Embedding").forall((key,source) => source._3==key._2+1))
    val generation=published(archive,first.sessionId)
    assertEquals(summaries(db,generation),List("goal s2","goal s66"))
    assertEquals(db.transaction(c => Sql.rows(c,"SELECT message_position FROM ch_problem_spans WHERE generation=? AND ordinal=0 ORDER BY message_position",generation)(_.getInt(1))),List(2,66))
    // Revision 3 inserts a message in front: every position moved, every window is annotated.
    val moved=(message("fill-new",0,"new")::short::filler("fill-long",List(short),tail.head)::tail).zipWithIndex.map((m,i) => m.copy(recordIndex=i))
    val (annotated,_)=calls(annotator,vectors) { next(archive,first.sessionId,moved,2); assert(lane.once.unsafeRunSync()) }
    val (third,thirdRun,state)=job(db,first.sessionId,3)
    assertEquals((state,annotated,references(db,third,thirdRun).count(_._1._1=="Annotation")),("Complete",db.transaction(c => Sql.one(c,"SELECT total_windows FROM ch_jobs WHERE id=?",third)(_.getInt(1)).get),0))
  }}

  test("two earlier runs hold different outputs for one window input: the published generation's run is taken first; run 3 reuses one, crashes, resumes and publishes exactly the referenced output") { database { (config,db,archive) =>
    val (annotator,vectors)=(new Annotator("first"),new Vectors)
    val lane=worker(archive,config,annotator,vectors)
    val receipt=archive.ingest("a",request(messages(0,138)))
    assert(lane.once.unsafeRunSync())
    val (jobId,run1,_)=job(db,receipt.sessionId,1); val generation1=published(archive,receipt.sessionId)
    // Run 2 of the same revision annotates again (run 1's work hidden from it, as an earlier release's), with another output.
    db.transaction(c => Sql.exec(c,"UPDATE ch_index_checkpoints SET content_hash='hidden:'||content_hash WHERE run_id=?",run1))
    archive.retry("a",jobId); annotator.label="second"
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync()))._1,3)
    db.transaction(c => Sql.exec(c,"UPDATE ch_index_checkpoints SET content_hash=substr(content_hash,8) WHERE run_id=?",run1))
    val run2=job(db,receipt.sessionId,1)._2; val generation2=published(archive,receipt.sessionId)
    // Window 0's input (no carry) has both outputs; the lookup takes the published generation's run.
    val content=db.transaction(c => Sql.one(c,"SELECT content_hash FROM ch_index_checkpoints WHERE run_id=? AND stage='Annotation' AND window_ordinal=0",run1)(_.getString(1)).get)
    def taken(generation: UUID): UUID = db.transaction { c =>
      Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",generation,receipt.sessionId)
      IndexCheckpoints.reusable(c,receipt.sessionId,config.profile,(UUID.randomUUID(),UUID.randomUUID()),IndexingStage.Annotation,content).get.run
    }
    assertEquals((taken(generation1),taken(generation2)),(run1,run2))
    // Revision 2: windows 0 and 1 reused from run 2; run 3 stops at window 2's embedding; then run 1's generation is
    // published, so a lookup now would take run 1's output.
    next(archive,receipt.sessionId,messages(0,208),1)
    annotator.label="third"; vectors.failing=true
    assert(lane.once.unsafeRunSync())
    val (job3,run3,state)=job(db,receipt.sessionId,2)
    assertEquals((state,references(db,job3,run3).filter(_._1._1=="Annotation").values.map(_._2).toList),("Queued",List(run2,run2)))
    db.transaction(c => Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",generation1,receipt.sessionId))
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync()))._1,1)
    assertEquals(summaries(db,published(archive,receipt.sessionId)),List("second s0","second s64","third s128","third s192"))
  }}

  test("the published run's references count as its accepted work: an earlier output it references is reused before a competing output of a newer revision's run, also across a resume") { database { (config,db,archive) =>
    val (annotator,vectors)=(new Annotator("first"),new Vectors)
    val lane=worker(archive,config,annotator,vectors)
    // Run 1 accepts output A; the append's run 2 references it for windows 0 and 1 and is published.
    val receipt=archive.ingest("a",request(messages(0,138)))
    assert(lane.once.unsafeRunSync())
    val run1=job(db,receipt.sessionId,1)._2
    next(archive,receipt.sessionId,messages(0,208),1)
    assert(lane.once.unsafeRunSync())
    val (job2,run2,_)=job(db,receipt.sessionId,2)
    assertEquals(references(db,job2,run2).filter(_._1._1=="Annotation").map((key,source) => key._2->source._2),Map(0->run1,1->run1))
    // Run 3 of the same revision (run 1's work hidden from it, as an earlier release's) accepts output B for window 0
    // and stops; its job ranks before run 1's by revision. Run 2 stays published.
    db.transaction(c => Sql.exec(c,"UPDATE ch_index_checkpoints SET content_hash='hidden:'||content_hash WHERE run_id=?",run1))
    archive.retry("a",job2); annotator.label="second"; vectors.failing=true
    assert(lane.once.unsafeRunSync())
    db.transaction(c => Sql.exec(c,"UPDATE ch_index_checkpoints SET content_hash=substr(content_hash,8) WHERE run_id=?",run1))
    assertEquals(summaries(db,published(archive,receipt.sessionId)),List("first s0","first s64","first s128","first s192"))
    // Revision 3: run 4 takes the published prefix (A, through run 2's references), stops, resumes and publishes it.
    next(archive,receipt.sessionId,messages(0,272),2)
    annotator.label="third"; vectors.failing=true
    assert(lane.once.unsafeRunSync())
    val (job4,run4,state)=job(db,receipt.sessionId,3)
    assertEquals((state,references(db,job4,run4).filter(_._1._1=="Annotation").map((key,source) => key._2->source._2)),("Queued",Map(0->run1,1->run1,2->run2)))
    assert(lane.once.unsafeRunSync())
    assertEquals(summaries(db,published(archive,receipt.sessionId)),List("first s0","first s64","first s128","third s192","third s256"))
  }}

  test("down-027 copies the references of unfinished jobs into their own checkpoints and drops the references and content hashes; such a run resumes from them") { database { (config,db,archive) =>
    val (annotator,vectors)=(new Annotator("goal"),new Vectors)
    val lane=worker(archive,config,annotator,vectors)
    // A Complete job with references, and a job that stopped after reusing windows 0-2.
    val complete=archive.ingest("a",request(messages(0,202)))
    assert(lane.once.unsafeRunSync()); next(archive,complete.sessionId,messages(0,272),1); assert(lane.once.unsafeRunSync())
    val stopped=archive.ingest("a",request(messages(0,202)))
    assert(lane.once.unsafeRunSync()); next(archive,stopped.sessionId,messages(0,272),1)
    vectors.failing=true; assert(lane.once.unsafeRunSync())
    val (jobId,runId,state)=job(db,stopped.sessionId,2)
    assertEquals((state,references(db,jobId,runId).size),("Queued",3+12))
    val accepted=db.transaction(c => Sql.rows(c,"""SELECT concat_ws('|',r.stage,r.window_ordinal,r.part,r.input_hash,k.output_hash,k.value) FROM ch_index_checkpoint_refs r
      JOIN ch_index_checkpoints k ON (k.job_id,k.run_id,k.stage,k.window_ordinal,k.part)=(r.source_job,r.source_run,r.source_stage,r.source_window,r.source_part) WHERE r.job_id=? ORDER BY 1""",jobId)(_.getString(1)))
    val name=config.jdbcUrl.drop(config.jdbcUrl.lastIndexOf('/')+1)
    def run(variables: (String,String)*): (Int,List[String]) = {
      val psql=java.nio.file.Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
      val address=config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
      val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),"PGUSER"->config.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->name)
      val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1")++variables.flatMap((key,value) => List("-v",s"$key=$value"))++List("-f",java.nio.file.Path.of("scripts","down-027-window-reuse.sql").toString),sys.env,connection,CheckChild.limit)
      (ran.exit,ran.out.linesIterator.toList)
    }
    try {
      val (preflightExit,preflight)=run()
      assertEquals((preflightExit,preflight.last),(0,"DOWN027.result|preflight-complete"),preflight.mkString("\n"))
      val printed=preflight.map(_.split('|')).collect { case Array(key,value) => key->value }.toMap
      assertEquals(List("references","references.copied").map(key => printed(s"DOWN027.$key")),List((2*(3+12)).toString,(3+12).toString))
      val (refusedExit,refused)=run("mode"->"apply","apply_irreversible"->"yes","confirm_database"->name,"expect_plan"->"stale")
      assertEquals((refusedExit,refused.last),(3,"DOWN027.result|refused-unconfirmed"))
      val (appliedExit,applied)=run("mode"->"apply","apply_irreversible"->"yes","confirm_database"->name,"expect_plan"->printed("DOWN027.plan"))
      assertEquals((appliedExit,applied.last),(0,"DOWN027.result|applied"),applied.mkString("\n"))
      db.transaction { c =>
        assertEquals(Sql.one(c,"SELECT to_regclass('ch_index_checkpoint_refs') IS NULL AND to_regclass('ch_index_checkpoints_content') IS NULL AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='ch_index_checkpoints' AND column_name='content_hash')")(_.getBoolean(1)),Some(true))
        // The previous release reads a run's own checkpoints only: the stopped run's now hold what it referenced.
        assertEquals(Sql.rows(c,"SELECT concat_ws('|',stage,window_ordinal,part,input_hash,output_hash,value) FROM ch_index_checkpoints WHERE job_id=? AND run_id=? AND (stage='Annotation' AND window_ordinal<3 OR stage='Embedding' AND window_ordinal<3) ORDER BY 1",jobId,runId)(_.getString(1)),accepted)
      }
    } finally db.initialize()
    assertEquals(calls(annotator,vectors)(assert(lane.once.unsafeRunSync())),(1,5))
    assertEquals(job(db,stopped.sessionId,2)._3,"Complete")
    assertEquals(content(db,published(archive,stopped.sessionId)),content(db,published(archive,complete.sessionId)))
  }}
}
