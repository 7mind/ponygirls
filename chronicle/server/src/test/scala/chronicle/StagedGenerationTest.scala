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
  private object Cut extends ProblemPassageAnnotator {
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
    assertEquals((staged(db),db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_search_retirements")(_.getInt(1)))),(Nil,Some(0)))
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
        assertEquals(Sql.one(c,"SELECT to_regclass('ch_staged_generations') IS NULL AND to_regclass('ch_search_retirements') IS NULL")(_.getBoolean(1)),Some(true))
        assertEquals(Sql.one(c,"SELECT reloptions IS NULL FROM pg_class WHERE oid='ch_search_chunks'::regclass")(_.getBoolean(1)),Some(true))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_generations WHERE session_id=?",kept.sessionId)(_.getInt(1)),Some(1))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks WHERE generation=?",replaced)(_.getInt(1)),Some(0))
        // The previous release reads these (this one's reads need the staged table).
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_sources s JOIN ch_chunks ch ON ch.generation=s.published JOIN ch_search_chunks sc ON sc.id=ch.id WHERE s.id=?",kept.sessionId)(_.getInt(1)),Some(pieces))
      }
    } finally db.initialize()
  }}
}
