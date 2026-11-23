package chronicle

import cats.effect.{Deferred,IO}
import cats.effect.std.Queue
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import io.circe.Json
import java.util.UUID
import scala.concurrent.duration.*
import ProblemPassages.{Decision,Part,Point}

/** Staged generations (ingest-limits spec §5.2.4, §5.2.5, migration 026): no reader reaches one before its switch, its
  * job's run resumes it, the maintenance pass deletes one no run continues, and the switch's replaced search rows are
  * retired; the down-script of 026. */
final class StagedGenerationTest extends munit.FunSuite {
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
  private def request(text: String,source: Option[SourceIdentity]=None,revision: Int=0): IngestRequest = {
    val raw=Json.obj("id"->Json.fromString("m0"),"text"->Json.fromString(text)).noSpaces+"\n"
    val base=Fixtures.snapshot()
    base.copy(source=source.getOrElse(base.source),expectedRevision=revision,messages=List(Message("m0",None,"user",text,None,0)),files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  /** One window of one fragment cut into `pieces` pieces of one passage: more than one search-row statement. */
  private val pieces=600
  private val text="p"*pieces
  private object Cut extends ScriptedAnnotator {
    def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[Decision] = IO {
      Decision((0 until pieces).map(i => Part(Point(0,i),if(i+1==pieces) window.terminal else Point(0,i+1),i>0,"staged goal",List("staged"))).toVector)
    }
  }
  /** Distinct vectors on one ring, every job's interleaved with the others' (as an append-only re-publication's lie next
    * to the published ones; a staged cluster alone nearest the query can end a strict iterative HNSW scan short, which
    * is not this unit's subject). */
  private final class Ring extends Embedder {
    private var next=0
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO(text.map { _ => next+=1; List(1.0,0.3*math.sin(next*0.37+1),0.3*math.sin(next*0.37+2)) })
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker queried embedding"))
  }
  private def worker(archive: SessionArchive,config: Config,embedder: Embedder): Worker = ModelFixtures.worker(archive,Cut,embedder,config,logstage.IzLogger())
  /** Inserting a row of `table` with an ordinal of 500 or more fails while `body` runs (the first statement of a staged
    * generation's chunks or search rows commits, the next one stops the publication before it inserts a row: rows of an
    * aborted insert stay in the HNSW graph until a vacuum and can end a strict iterative scan early). */
  private def stopped[A](db: Database,table: String)(body: => A): A = {
    val ordinal=if(table=="ch_chunks") "NEW.ordinal" else "(SELECT ordinal FROM ch_chunks ch WHERE ch.id=NEW.id)"
    db.transaction { c =>
      Sql.exec(c,s"CREATE FUNCTION ch_test_stop() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN IF $ordinal>=500 THEN RAISE EXCEPTION 'stopped'; END IF; RETURN NEW; END $$$$")
      Sql.exec(c,s"CREATE TRIGGER ch_test_stop BEFORE INSERT ON $table FOR EACH ROW EXECUTE FUNCTION ch_test_stop()")
    }
    try body finally db.transaction(c => Sql.exec(c,"DROP FUNCTION ch_test_stop() CASCADE"))
  }
  private def staged(db: Database): List[(UUID,String,Int,Int)] = db.transaction(c => Sql.rows(c,
    "SELECT st.generation,st.phase,(SELECT count(*) FROM ch_chunks ch WHERE ch.generation=st.generation),(SELECT count(*) FROM ch_search_chunks s WHERE s.generation=st.generation) FROM ch_staged_generations st ORDER BY st.generation")(r =>
    (r.getObject(1,classOf[UUID]),r.getString(2),r.getInt(3),r.getInt(4))))
  /** Runs one pass of the maintenance loop: answers its first wait and returns once it waits again. */
  private def maintenancePass(db: Database): Unit = (for {
    sleeps <- Queue.unbounded[IO,Deferred[IO,Unit]]
    _ <- EpochMaintenance.resource(db,logstage.IzLogger(),EpochMaintenance.interval,_ => Deferred[IO,Unit].flatMap(gate => sleeps.offer(gate) *> gate.get)).use { _ =>
      sleeps.take.timeout(10.seconds).flatMap(gate => gate.complete(()) *> sleeps.take.timeout(60.seconds))
    }
  } yield ()).unsafeRunSync()

  test("a publication stopped in its search rows is invisible to search and to a pin of it and resumes; after the switch and the retirement, before a vacuum, search finds the new generation, none of the replaced rows remain; migration 026's autovacuum settings") { database { (config,db,archive) =>
    val vectors=new Ring
    val other=archive.ingest("b",request("o"*pieces))
    val first=archive.ingest("a",request(text))
    assert(worker(archive,config,vectors).once.unsafeRunSync()); assert(worker(archive,config,vectors).once.unsafeRunSync())
    val previous=archive.session("a",first.sessionId).view
    val next=archive.ingest("a",request(text+"q",Some(archive.headSnapshot("a",first.sessionId).source),1))
    stopped(db,"ch_search_chunks")(assert(worker(archive,config,vectors).once.unsafeRunSync()))
    val List((generation,"Pieces",`pieces`,written))=staged(db): @unchecked
    assertEquals(written,500)
    val search=new PostgresSearch(db,archive,config)
    def hits(reader: String): List[(UUID,Option[UUID],List[UUID])] =
      search.search(reader,SearchQuery("near",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),10,0),Some(List(1.0,0.0,0.0))).hits.map(hit => (hit.session.id,hit.session.view.generationId,hit.chunks.map(_.id)))
    val stagedChunks=db.transaction(c => Sql.rows(c,"SELECT id FROM ch_chunks WHERE generation=?",generation)(_.getObject(1,classOf[UUID])).toSet)
    // The staged rows lie among the previous ones: the previous generation is found, never a staged row.
    val during=hits("a")
    assertEquals(during.map(_._1),List(first.sessionId))
    assertEquals(during.map(_._2),List(previous.generationId))
    assert(during.flatMap(_._3).nonEmpty && !during.flatMap(_._3).exists(stagedChunks),"no staged chunk")
    assertEquals(hits("b").map(_._1),List(other.sessionId))
    assertEquals(intercept[DomainError](archive.passages("a",first.sessionId,0,10,Some(ContentView(2,Some(generation))))).code,"not-found")
    assertEquals(intercept[DomainError](archive.pageChunks("a",first.sessionId,0,10,Some(ContentView(2,Some(generation))))).code,"not-found")
    assertEquals(db.transaction(c => Sql.one(c,"SELECT state FROM ch_jobs WHERE id=?",next.jobId)(_.getString(1))),Some("Queued"))
    // The same job's run resumes the staged generation: its rows are written once.
    assert(worker(archive,config,vectors).once.unsafeRunSync())
    assertEquals(archive.session("a",first.sessionId).view,ContentView(2,Some(generation)))
    assertEquals((staged(db),db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_generation_retirements")(_.getInt(1)))),(Nil,Some(0)))
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks WHERE generation=?",generation)(_.getInt(1)),Some(pieces))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks WHERE generation=?",previous.generationId.get)(_.getInt(1)),Some(0))
      assertEquals(Sql.one(c,"SELECT array_to_string(reloptions,',') FROM pg_class WHERE oid='ch_search_chunks'::regclass")(_.getString(1)),Some("autovacuum_vacuum_scale_factor=0,autovacuum_vacuum_threshold=100000"))
    }
    val after=hits("a")
    assertEquals(after.map(hit => (hit._1,hit._2)),List((first.sessionId,Some(generation))))
    assert(after.flatMap(_._3).forall(stagedChunks))
    // A pin of the replaced generation still reads it.
    assertEquals(archive.pageChunks("a",first.sessionId,0,1,Some(previous)).total,pieces)
  }}

  test("a generation a release before 028 staged (no lineage, no metadata horizon: its chunks carry final metadata) is staged again from nothing by its run and published as a root") { database { (config,db,archive) =>
    val vectors=new Ring
    val receipt=archive.ingest("a",request(text))
    stopped(db,"ch_chunks")(assert(worker(archive,config,vectors).once.unsafeRunSync()))
    val List((generation,"Pieces",500,0))=staged(db): @unchecked
    db.transaction { c =>
      Sql.exec(c,"DELETE FROM ch_lineage_segments WHERE lineage=?",generation)
      Sql.exec(c,"DELETE FROM ch_lineage_tags WHERE lineage=?",generation)
      Sql.exec(c,"DELETE FROM ch_generation_lineage WHERE generation=?",generation)
      Sql.exec(c,"UPDATE ch_generations SET lineage=NULL WHERE id=?",generation)
      Sql.exec(c,"UPDATE ch_staged_generations SET resume=resume-'lineageTags'-'horizon' WHERE generation=?",generation)
    }
    assert(worker(archive,config,vectors).once.unsafeRunSync())
    val published=archive.session("a",receipt.sessionId).view.generationId.get
    assertNotEquals(published,generation)
    assertEquals(archive.pageChunks("a",receipt.sessionId,0,1,None).total,pieces)
    assertEquals(db.transaction(c => Sql.one(c,"SELECT concat_ws('|',lineage=id,lineage_version,(SELECT count(*) FROM ch_lineage_tags WHERE lineage=g.id),(SELECT count(*) FROM ch_generations WHERE id=?)) FROM ch_generations g WHERE id=?",generation,published)(_.getString(1))),Some("t|0|1|0"))
    assertEquals(new PostgresSearch(db,archive,config).tags("a",TagSearchQuery("staged",SearchFilter(None,None,None,None,Nil),None,10)).map(_.value),List("staged"))
  }}

  test("a root a release before 028 continued (rollback without down-028): published by that release it reads as its own rows, and its lineage tag rows are retired; continued by that release and resumed by this one it is staged again") { database { (config,db,archive) =>
    val vectors=new Ring
    val search=new PostgresSearch(db,archive,config)
    /** A root of `owner` staged by this release and stopped in its chunks (500 of them counted in its lineage tags). */
    def interrupted(owner: String): (UUID,UUID) = {
      val receipt=archive.ingest(owner,request(text))
      stopped(db,"ch_chunks")(assert(worker(archive,config,vectors).once.unsafeRunSync()))
      val generation=db.transaction(c => Sql.one(c,"SELECT st.generation FROM ch_staged_generations st JOIN ch_jobs j ON j.id=st.job_id WHERE j.session_id=?",receipt.sessionId)(_.getObject(1,classOf[UUID]))).get
      (receipt.sessionId,generation)
    }
    def reads(owner: String,session: UUID,generation: UUID): Unit = {
      val view=archive.session(owner,session).view
      assertEquals(view.generationId,Some(generation))
      assertEquals(archive.pageChunks(owner,session,0,100,None).chunks.size,100)
      assertEquals(archive.pageChunks(owner,session,pieces-1,100,None).chunks.size,1)
      assertEquals(archive.passages(owner,session,0,10,None).passages.map(_.pieceCount),List(pieces.toLong))
      assertEquals(search.tags(owner,TagSearchQuery("staged",SearchFilter(None,None,None,None,Nil),None,10)).map(_.value),List("staged"))
      assertEquals(search.search(owner,SearchQuery("staged",SearchMode.Lexical,SearchFilter(None,None,None,None,List("staged")),10,0),None).hits.map(_.session.view),List(view))
    }
    def lineage(generation: UUID): String = db.transaction(c => Sql.one(c,"""SELECT concat_ws('|',coalesce(lineage::text,'-'),coalesce(lineage_version::text,'-'),
      (SELECT count(*) FROM ch_lineage_segments WHERE origin=g.id),(SELECT count(*) FROM ch_generation_lineage WHERE generation=g.id),(SELECT count(*) FROM ch_lineage_tags WHERE lineage=g.id)) FROM ch_generations g WHERE id=?""",generation)(_.getString(1))).get
    // Published by the previous release: it wrote the remaining chunks without counting their tags and switched without
    // activating the root (its version stays unset, its segments invisible), as this release's switch minus switchRoot.
    val (first,root)=interrupted("a")
    assert(worker(archive,config,vectors).once.unsafeRunSync())
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_generations SET lineage_version=NULL WHERE id=?",root)
      Sql.exec(c,"UPDATE ch_lineage_segments SET since=NULL WHERE lineage=?",root)
      Sql.exec(c,"UPDATE ch_lineage_tags SET pieces=500 WHERE lineage=?",root)
    }
    reads("a",first,root)
    // Its replacement by this release retires its lineage's tag rows with its search rows.
    archive.ingest("a",request(text+"q",Some(archive.headSnapshot("a",first).source),1))
    assert(worker(archive,config,vectors).once.unsafeRunSync())
    assertEquals(lineage(root),s"$root|-|4|1|0")
    // Continued by the previous release (its batches: chunks without tag counts, final metadata, a resume point without
    // this release's marks), then resumed by this one: staged again from nothing, a root with its lineage.
    val (second,continued)=interrupted("b")
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_staged_generations SET resume=resume-'lineageTags'-'horizon' WHERE generation=?",continued)
      Sql.exec(c,"DELETE FROM ch_lineage_tags WHERE lineage=?",continued)
    }
    assert(worker(archive,config,vectors).once.unsafeRunSync())
    val restarted=archive.session("b",second).view.generationId.get
    assertEquals((db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_generations WHERE id=?",continued)(_.getInt(1))),lineage(restarted)),(Some(0),s"$restarted|0|4|1|1"))
    reads("b",second,restarted)
  }}

  test("a superseded job's staged generation is deleted by the maintenance pass; a run that a retry makes live again deletes its abandoned staged generation before it stages a new one") { database { (config,db,archive) =>
    val vectors=new Ring
    val superseded=archive.ingest("a",request(text))
    stopped(db,"ch_chunks")(assert(worker(archive,config,vectors).once.unsafeRunSync()))
    val List((abandoned,"Pieces",500,0))=staged(db): @unchecked
    archive.ingest("a",request(text+"q",Some(archive.headSnapshot("a",superseded.sessionId).source),1))
    assertEquals(db.transaction(c => Sql.one(c,"SELECT error FROM ch_jobs WHERE id=?",superseded.jobId)(_.getString(1))),Some(Jobs.supersededRevision))
    maintenancePass(db)
    assertEquals(staged(db),Nil)
    db.transaction { c =>
      List("ch_generations WHERE id=?","ch_chunks WHERE generation=?","ch_problem_passages WHERE generation=?","ch_problem_spans WHERE generation=?","ch_generation_tags WHERE generation=?").foreach { rows =>
        assertEquals(Sql.one(c,s"SELECT count(*) FROM $rows",abandoned)(_.getInt(1)),Some(0),rows)
      }
    }
    assert(worker(archive,config,vectors).once.unsafeRunSync(),"the head job of a")
    // A job that failed after staging keeps its run when retried; the sweep abandoned its generation meanwhile.
    val failed=archive.ingest("b",request(text))
    stopped(db,"ch_chunks")(assert(worker(archive,config,vectors).once.unsafeRunSync()))
    val List((first,_,500,0))=staged(db).filterNot(_._1==abandoned): @unchecked
    db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET state='Failed',error='model-timeout',fence=fence+1,lease_until=NULL WHERE id=?",failed.jobId))
    assert(db.transaction(PassageStorage.abandonIfStale(_,first)))
    archive.retry("b",failed.jobId)
    assert(worker(archive,config,vectors).once.unsafeRunSync())
    val published=archive.session("b",failed.sessionId).view.generationId.get
    assertNotEquals(published,first)
    assertEquals((staged(db),db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_generations WHERE id=?",first)(_.getInt(1)))),(Nil,Some(0)))
    assertEquals(archive.pageChunks("b",failed.sessionId,0,1,None).total,pieces)
  }}

  test("a lease that ends inside the switch rolls the whole switch back: the previous publication, the staged generation, no retirement; the job's run resumes and publishes") { database { (config,db,archive) =>
    val vectors=new Ring
    val first=archive.ingest("a",request(text)); assert(worker(archive,config,vectors).once.unsafeRunSync())
    val previous=archive.session("a",first.sessionId).view
    archive.ingest("a",request(text+"q",Some(archive.headSnapshot("a",first.sessionId).source),1))
    // The switch's own update of the published pointer ends the job's lease: its completion then updates no row.
    db.transaction { c =>
      Sql.exec(c,"CREATE FUNCTION ch_test_expire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id=NEW.id AND state='Running'; RETURN NULL; END $$")
      Sql.exec(c,"CREATE TRIGGER ch_test_expire AFTER UPDATE OF published ON ch_sources FOR EACH ROW EXECUTE FUNCTION ch_test_expire()")
    }
    try assert(worker(archive,config,vectors).once.unsafeRunSync()) finally db.transaction(c => Sql.exec(c,"DROP FUNCTION ch_test_expire() CASCADE"))
    assertEquals(archive.session("a",first.sessionId).view,previous)
    val List((generation,"Pieces",`pieces`,`pieces`))=staged(db): @unchecked
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks WHERE generation=?",previous.generationId.get)(_.getInt(1)),Some(pieces),"the previous generation's search rows")
      assertNotEquals(Sql.one(c,"SELECT state FROM ch_jobs WHERE session_id=? AND revision=2",first.sessionId)(_.getString(1)),Some("Complete"))
    }
    db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id=? AND revision=2",first.sessionId))
    assert(worker(archive,config,vectors).once.unsafeRunSync())
    assertEquals((archive.session("a",first.sessionId).view,staged(db)),(ContentView(2,Some(generation)),Nil))
  }}

  test("a staged generation resumed under another embedding batch size publishes the vectors its windows accepted again, not the earlier ones") { database { (config,db,archive) =>
    // Every call returns new vectors: a window embedded again under another grouping gets other vectors.
    val receipt=archive.ingest("a",request(text))
    stopped(db,"ch_search_chunks")(assert(worker(archive,config,new Ring).once.unsafeRunSync()))
    val List((generation,"Pieces",`pieces`,500))=staged(db): @unchecked
    val regrouped=config.copy(indexing=config.indexing.copy(embeddingBatchSize=8))
    var shifted=0
    val other=new Embedder {
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO(text.map { _ => shifted+=1; List(1.0,0.2*math.cos(shifted*0.41),0.2*math.sin(shifted*0.41)) })
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker queried embedding"))
    }
    assert(worker(archive,regrouped,other).once.unsafeRunSync())
    assertEquals(archive.session("a",receipt.sessionId).view.generationId,Some(generation))
    assertEquals(shifted,pieces,"the window was embedded again under the new grouping")
    // The oracle: the job's accepted embedding parts under the current grouping, in piece order.
    db.transaction { c =>
      val parts=Sql.rows(c,"SELECT part,value FROM ch_index_checkpoints WHERE job_id=? AND stage='Embedding' ORDER BY window_ordinal,part",receipt.jobId)(r => (r.getInt(1),CheckpointJson.vectors(Sql.json(r,"value"))))
      assertEquals(parts.map(_._1),(0 until pieces/8).toList)
      val accepted=parts.flatMap(_._2).map(_.mkString("[",",","]"))
      def stored(table: String): List[String] = Sql.rows(c,s"SELECT t.embedding::text FROM $table t JOIN ch_chunks ch ON ch.id=t.id WHERE ch.generation=? ORDER BY ch.ordinal",generation)(_.getString(1))
      assertEquals(stored("ch_chunks").size,pieces); assertEquals(stored("ch_search_chunks").size,pieces)
      val expected=accepted.map(v => Sql.one(c,"SELECT ?::vector::text",v)(_.getString(1)).get)
      assertEquals(stored("ch_chunks"),expected,"chunk vectors"); assertEquals(stored("ch_search_chunks"),expected,"search row vectors")
    }
  }}

  test("an explicit rebuild's switch retires the older generations' payload by a durable bounded cleanup, not inside the switch") { database { (config,db,archive) =>
    val vectors=new Ring
    val first=archive.ingest("a",request(text)); assert(worker(archive,config,vectors).once.unsafeRunSync())
    val old=archive.session("a",first.sessionId).view
    Fixtures.rebuild(db,"a")
    val claim=archive.claim(IndexProfileCatalog.current(config).knownProfiles,ClaimScope.Owner("a"),300).get
    // The archive's switch alone (the worker retires afterwards).
    assert(archive.publishProblems(claim,ProblemsPublication.rows(ProblemPublicationFixtures.oneProblem(claim))))
    def rows(): List[Int] = db.transaction(c => List("ch_chunks","ch_problem_passages","ch_problem_spans","ch_generation_tags").map(table =>
      Sql.one(c,s"SELECT count(*) FROM $table WHERE generation=?",old.generationId.get)(_.getInt(1)).get))
    assertEquals(rows(),List(pieces,1,1,1),"the switch deleted none of the older generation's rows")
    assertEquals(intercept[DomainError](archive.pageChunks("a",first.sessionId,0,1,Some(old))).code,"indexed-view-retired")
    assertEquals(db.transaction(c => Sql.rows(c,"SELECT generation,payload FROM ch_generation_retirements")(r => (r.getObject(1,classOf[UUID]),r.getBoolean(2)))),List((old.generationId.get,true)))
    archive.retire(claim)
    assertEquals(rows(),List(0,0,0,0))
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT retired FROM ch_generations WHERE id=?",old.generationId.get)(_.getBoolean(1)),Some(true))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks WHERE generation=?",old.generationId.get)(_.getInt(1)),Some(0))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_generation_retirements")(_.getInt(1)),Some(0))
    }
  }}

  test("a search-row retirement that an explicit rebuild turns into a payload retirement midway deletes every derived row") { database { (config,db,archive) =>
    val first=archive.ingest("a",request(text)); assert(worker(archive,config,new Ring).once.unsafeRunSync())
    val old=archive.session("a",first.sessionId).view.generationId.get
    def published(): Claim = {
      val claim=archive.claim(IndexProfileCatalog.current(config).knownProfiles,ClaimScope.Owner("a"),300).get
      assert(archive.publishProblems(claim,ProblemsPublication.rows(ProblemPublicationFixtures.oneProblem(claim)))); claim
    }
    archive.ingest("a",request(text+"q",Some(archive.headSnapshot("a",first.sessionId).source),1)); published()
    // One step of the search-only retirement the switch recorded, then a rebuild's switch asks for the payload.
    var cursor=db.transaction(PassageStorage.retireStep(_,old,PassageStorage.Retirement.start))
    assert(cursor.nonEmpty)
    Fixtures.rebuild(db,"a"); published()
    while(cursor.nonEmpty) cursor=db.transaction(PassageStorage.retireStep(_,old,cursor.get))
    db.transaction { c =>
      List("ch_chunks","ch_problem_pieces","ch_problem_passages","ch_problem_spans","ch_generation_tags","ch_search_chunks","ch_generation_retirements").foreach(table =>
        assertEquals(Sql.one(c,s"SELECT count(*) FROM $table WHERE generation=?",old)(_.getInt(1)),Some(0),table))
    }
  }}

  test("a stale publication batch that waited for the staged row while its job was claimed again and its chunks invalidated writes nothing") { database { (config,db,archive) =>
    val receipt=archive.ingest("a",request(text))
    val claim=archive.claim(IndexProfileCatalog.current(config).knownProfiles,ClaimScope.Owner("a"),300).get
    val rows=ProblemsPublication.rows(ProblemPublicationFixtures.oneProblem(claim))
    val inPieces=new java.util.concurrent.CountDownLatch(1); val proceed=new java.util.concurrent.CountDownLatch(1)
    val paused=new ProblemRows {
      def parent: Option[PublicationParent] = rows.parent
      def passages(from: Int)(write: (Int,ProblemRows.Passages) => Unit): ProblemRows.Replayed = rows.passages(from)(write)
      def pieces(from: Int,stored: ProblemRows.Stored)(write: (Int,Vector[ProblemRows.Piece]) => Unit): Unit = { inPieces.countDown(); proceed.await(); rows.pieces(from,stored)(write) }
    }
    val pool=java.util.concurrent.Executors.newSingleThreadExecutor()
    try {
      val publishing=pool.submit(new java.util.concurrent.Callable[Boolean] { def call(): Boolean = archive.publishProblems(claim,paused) })
      assert(inPieces.await(10,java.util.concurrent.TimeUnit.SECONDS))
      val List((generation,"Pieces",0,0))=staged(db): @unchecked
      db.transaction { held =>
        // The batch's transaction waits for the staged row; meanwhile the job is claimed again and its next run's phase
        // W discards embedding parts (the staged chunks are to be written again).
        Sql.exec(held,"SELECT 1 FROM ch_staged_generations WHERE generation=? FOR UPDATE",generation)
        proceed.countDown()
        val deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(10)
        def blocked: Boolean = db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT 1 FROM ch_staged_generations%')")(_.getBoolean(1)).get)
        while(!blocked && System.nanoTime()<deadline) Thread.onSpinWait()
        assert(blocked,"the batch waits for the staged row")
        Sql.exec(held,"UPDATE ch_jobs SET fence=fence+1 WHERE id=?",claim.jobId)
        PassageStorage.invalidatePieces(held,claim)
      }
      assertEquals(publishing.get(10,java.util.concurrent.TimeUnit.SECONDS),false)
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(10,java.util.concurrent.TimeUnit.SECONDS)) }
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT concat_ws('|',resume->>'step',resume->>'invalid',(SELECT count(*) FROM ch_chunks ch WHERE ch.generation=st.generation)) FROM ch_staged_generations st")(_.getString(1)),Some("0|true|0"))
    }
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,None)
  }}

  test("down-026 deletes staged generations and the search rows still being retired, resets the autovacuum settings and drops its tables; published generations stay") { database { (config,db,archive) =>
    val vectors=new Ring
    // A retirement a crash left: a source's replaced generation still has its search rows (published without the
    // worker's retirement).
    val other=archive.ingest("b",request(text)); assert(worker(archive,config,vectors).once.unsafeRunSync())
    val replaced=archive.session("b",other.sessionId).view.generationId.get
    archive.ingest("b",request(text+"q",Some(archive.headSnapshot("b",other.sessionId).source),1))
    val claim=archive.claim(IndexProfileCatalog.current(config).knownProfiles,ClaimScope.Owner("b"),300).get
    assert(archive.publishProblems(claim,ProblemsPublication.rows(ProblemPublicationFixtures.oneProblem(claim))))
    // A publication stopped in its chunks, after a published one.
    val kept=archive.ingest("a",request(text))
    assert(worker(archive,config,vectors).once.unsafeRunSync())
    archive.ingest("a",request(text+"q",Some(archive.headSnapshot("a",kept.sessionId).source),1))
    stopped(db,"ch_chunks")(assert(worker(archive,config,vectors).once.unsafeRunSync()))
    val name=config.jdbcUrl.drop(config.jdbcUrl.lastIndexOf('/')+1)
    def run(variables: (String,String)*): (Int,List[String]) = {
      val psql=java.nio.file.Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
      val address=config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
      val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),"PGUSER"->config.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->name)
      val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1")++variables.flatMap((key,value) => List("-v",s"$key=$value"))++List("-f",java.nio.file.Path.of("scripts","down-026-staged-generations.sql").toString),sys.env,connection,CheckChild.limit)
      (ran.exit,ran.out.linesIterator.toList)
    }
    try {
      val (preflightExit,preflight)=run()
      assertEquals((preflightExit,preflight.last),(0,"DOWN026.result|preflight-complete"))
      val printed=preflight.map(_.split('|')).collect { case Array(key,value) => key->value }.toMap
      assertEquals(List("staged.generations","staged.chunks","staged.search_rows","retiring.generations","retiring.search_rows").map(key => printed(s"DOWN026.$key")),List("1","500","0","1",pieces.toString))
      val (refusedExit,refused)=run("mode"->"apply","apply_irreversible"->"yes","confirm_database"->name,"expect_plan"->"stale")
      assertEquals((refusedExit,refused.last),(3,"DOWN026.result|refused-unconfirmed"))
      val (appliedExit,applied)=run("mode"->"apply","apply_irreversible"->"yes","confirm_database"->name,"expect_plan"->printed("DOWN026.plan"))
      assertEquals((appliedExit,applied.last),(0,"DOWN026.result|applied"),applied.mkString("\n"))
      db.transaction { c =>
        assertEquals(Sql.one(c,"SELECT to_regclass('ch_staged_generations') IS NULL AND to_regclass('ch_generation_retirements') IS NULL")(_.getBoolean(1)),Some(true))
        assertEquals(Sql.one(c,"SELECT reloptions IS NULL FROM pg_class WHERE oid='ch_search_chunks'::regclass")(_.getBoolean(1)),Some(true))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_generations WHERE session_id=?",kept.sessionId)(_.getInt(1)),Some(1))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks WHERE generation=?",replaced)(_.getInt(1)),Some(0))
        // The previous release reads these (this one's reads need the staged table).
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_sources s JOIN ch_chunks ch ON ch.generation=s.published JOIN ch_search_chunks sc ON sc.id=ch.id WHERE s.id=?",kept.sessionId)(_.getInt(1)),Some(pieces))
      }
    } finally db.initialize()
  }}
}
