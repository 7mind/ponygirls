package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import io.circe.Json
import java.util.UUID
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.*

/** The S1 oversize guards (append-only ingest spec §3.1): GetRaw's raw bound, the indexing budget before a claim decodes
  * the revision and while its pieces are embedded (the small-job budget on the lanes without the large-job permit), the
  * message page byte bound, and their configuration keys. */
final class OversizeGuardTest extends munit.FunSuite {
  override val munitTimeout=2.minutes
  private def database(config: Config)(f: (Database,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    try f(db,new PostgresArchive(db,config)) finally db.close()
  }
  /** One raw line per message. */
  private def request(texts: Seq[String]): IngestRequest = {
    val messages=texts.zipWithIndex.map((text,index) => Message(s"m$index",None,"user",text,None,index)).toList
    val raw=messages.map(m => Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(m.text)).noSpaces+"\n").mkString
    Fixtures.snapshot().copy(messages=messages,files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private final case class JobRow(state: String,error: Option[String],stage: Option[String],attempts: Int,fence: Long)
  private def job(db: Database,id: UUID): JobRow = db.transaction(c => Sql.one(c,"SELECT state,error,failure_stage,attempts,fence FROM ch_jobs WHERE id=?",id)(r =>
    JobRow(r.getString(1),Option(r.getString(2)),Option(r.getString(3)),r.getInt(4),r.getLong(5))).get)

  test("GetRaw above maxRawReadBytes answers too-large before any raw is built: an epoch revision for a reader without the raw segments, a legacy one from its snapshot's sizes") {
    database(Fixtures.config().copy(maxRawReadBytes=1024)) { (db,archive) =>
      val stored=request(List("x"*1500))
      val size=stored.files.head.content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length.toLong
      val epoch=archive.ingest("a",stored).sessionId
      val legacy=new PostgresArchive(db,Fixtures.config().copy(maxRawReadBytes=1024),RevisionLayoutPolicy.Legacy).ingest("b",stored).sessionId
      val role="raw_bound_reader_"+UUID.randomUUID().toString.replace("-","")
      db.transaction { c =>
        Sql.exec(c,s"CREATE ROLE $role LOGIN PASSWORD '${Fixtures.databasePassword}'")
        Sql.exec(c,s"GRANT USAGE ON SCHEMA public TO $role")
        Sql.exec(c,s"GRANT SELECT ON ch_sources,ch_users,ch_members TO $role")
        Sql.exec(c,s"GRANT SELECT(session_id,revision,epoch,message_count,raw_bytes) ON ch_revisions TO $role")
      }
      try {
        val config=Fixtures.config().copy(maxRawReadBytes=1024,databaseUser=role)
        val reader=new PostgresArchive(new Database(config,IndexProfileCatalog.current(config)),config)
        assertEquals(intercept[DomainError](reader.raw("a",epoch,None)).code,"too-large")
      } finally db.transaction { c => Sql.exec(c,s"DROP OWNED BY $role"); Sql.exec(c,s"DROP ROLE $role") }
      assertEquals(intercept[DomainError](archive.raw("b",legacy,Some(1))).code,"too-large")
      val exact=new PostgresArchive(db,Fixtures.config().copy(maxRawReadBytes=size))
      assertEquals(exact.raw("a",epoch,None),RawResult(stored.files,1))
      assertEquals(exact.raw("b",legacy,Some(1)),RawResult(stored.files,1))
    }
  }

  test("20,000 one-word messages at 4,000 dimensions end Failed index-budget-exceeded before the claim decodes them, without an attempt, also after RetryJob; the session still pages, locates and finds") {
    val original=Fixtures.config()
    // 2·M + 256·n is about 8 MB here: the vectors (one per fragment, 8·4,000 bytes each) and chunks exceed the budget.
    val config=original.copy(maxMessages=20000,maxIndexingBudgetBytes=256L*1024*1024,embedding=original.embedding.copy(dimensions=4000))
    database(config) { (db,archive) =>
      val stored=request((0 until 20000).map(i => s"word$i"))
      val epoch=archive.ingest("a",stored)
      val legacy=new PostgresArchive(db,config,RevisionLayoutPolicy.Legacy).ingest("b",stored)
      val catalog=IndexProfileCatalog.current(config)
      assertEquals(archive.claim(catalog.knownProfiles,ClaimScope.AllOwners,300),None)
      List(epoch,legacy).foreach(receipt => assertEquals(job(db,receipt.jobId),JobRow("Failed",Some(IndexingBudget.exceededCode),None,0,1)))
      assertEquals(archive.statuses("a",0,100).jobs.map(j => (j.state,j.error,j.attempts)),List((JobState.Failed,Some(IndexingBudget.exceededCode),0)))
      archive.retry("a",epoch.jobId)
      assertEquals(archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300),None)
      assertEquals(job(db,epoch.jobId),JobRow("Failed",Some(IndexingBudget.exceededCode),None,0,3))
      val view=ContentView(1,None)
      List("a"->epoch.sessionId,"b"->legacy.sessionId).foreach { (owner,id) =>
        assertEquals(archive.messages(owner,id,19990,100,Some(view)).messages.map(_.id),(19990 until 20000).map(i => s"m$i").toList)
        assertEquals(archive.locateMessage(owner,id,view,"m12345").position,12345)
        assertEquals(archive.searchSessionMessages(owner,id,view,"word12345",None,10).hits,List(MessageSearchHit("m12345",12345)))
      }
    }
  }

  private final class Embedded(dimensions: Int) extends Embedder {
    val batches=ListBuffer.empty[List[String]]
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO { batches+=text; text.map(_ => List.tabulate(dimensions)(i => if(i==0) 1.0 else 0.0)) }
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker queried embedding"))
  }
  private def worker(archive: SessionArchive,config: Config,annotator: ProblemPassageAnnotator,embedder: Embedder): Worker =
    worker(archive,config,annotator,embedder,ModelAdmission.make(config.indexing).unsafeRunSync())
  private def worker(archive: SessionArchive,config: Config,annotator: ProblemPassageAnnotator,embedder: Embedder,admission: ModelAdmission): Worker =
    new Worker(archive,annotator,embedder,config,IndexProfileCatalog.current(config),admission,logstage.IzLogger(),ModelFixtures.failureBackoff,ModelFixtures.snapshots)
  /** Runs a worker iteration while another lane holds the large-job permit (munit assertions stay on the test thread). */
  private def permitTaken[A](admission: ModelAdmission)(run: IO[A]): A =
    admission.largeJob.use(taken => IO.raiseUnless(taken)(new AssertionError("the large-job permit is taken")) *> run).unsafeRunSync()

  test("the vector arena counts in whole blocks: a one-fragment job whose budget is below one block ends Failed at the claim, before it is decoded") {
    val config=Fixtures.config().copy(maxIndexingBudgetBytes=1024L*1024)
    database(config) { (db,archive) =>
      val receipt=archive.ingest("a",request(List("one fragment")))
      val catalog=IndexProfileCatalog.current(config)
      assertEquals(archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300),None)
      assertEquals(job(db,receipt.jobId),JobRow("Failed",Some(IndexingBudget.exceededCode),None,0,1))
      archive.retry("a",receipt.jobId)
      // The same job within a budget of two blocks (a block of 3-dimensional vectors holds 2 MiB).
      assert(new PostgresArchive(db,config.copy(maxIndexingBudgetBytes=4L*1024*1024)).claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).nonEmpty)
    }
  }

  test("an annotator cutting one fragment into more pieces than the estimate ends the job Failed index-budget-exceeded before they are embedded, with the arena in whole blocks") {
    // 4,000 dimensions: a block holds 65 vectors (2.08 MB). The estimate (one fragment, one block: about 2.1 MB) fits
    // 4 MB; 80 one-scalar pieces need 1.07 MB of chunks and two blocks.
    val original=Fixtures.config()
    val config=original.copy(maxIndexingBudgetBytes=4000000L,embedding=original.embedding.copy(dimensions=4000))
    database(config) { (db,archive) =>
      val receipt=archive.ingest("a",request(List("AB"*40)))
      val embedder=new Embedded(4000)
      assert(worker(archive,config,new ProblemPassageFixtures.Dummy,embedder).once.unsafeRunSync())
      assertEquals(job(db,receipt.jobId),JobRow("Failed",Some(IndexingBudget.exceededCode),Some("Embedding"),1,1))
      assertEquals(embedder.batches.toList,Nil)
    }
  }

  test("an annotator subdividing its fragments into one-scalar Context parts ends the job Failed index-budget-exceeded before the coverage is retained") {
    // 12,000 scalars in six fragments: the estimate (about 2.2 MB with one arena block) fits 2.4 MB; 12,000 retained
    // Context coverage spans do not.
    val config=Fixtures.config().copy(maxIndexingBudgetBytes=2400000L)
    database(config) { (db,archive) =>
      val receipt=archive.ingest("a",request(List("x"*12000)))
      val scalars=new ProblemPassageAnnotator {
        def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO {
          val starts=window.fragments.zipWithIndex.flatMap((fragment,index) => (0 until fragment.scalarCount).map(ProblemPassages.Point(index,_)))
          ProblemPassages.Decision(starts.zip(starts.drop(1):+window.terminal).map((start,end) => ProblemPassages.Part.context(start,end)))
        }
      }
      val embedder=new Embedded(3)
      assert(worker(archive,config,scalars,embedder).once.unsafeRunSync())
      assertEquals(job(db,receipt.jobId),JobRow("Failed",Some(IndexingBudget.exceededCode),Some("Embedding"),1,1))
      assertEquals((embedder.batches.toList,archive.session("a",receipt.sessionId).indexedRevision),(Nil,None))
    }
  }

  test("a job whose estimate exceeds maxSmallJobBudgetBytes is not claimed while another lane holds the large-job permit, without an attempt or a failure, and the lane with the permit takes it") {
    // 3 dimensions: one arena block (2.1 MB) holds every vector here. "small" is estimated at about 2.11 MB, the 20
    // fragments of 40,000 scalars at 2.44 MB.
    val config=Fixtures.config().copy(maxSmallJobBudgetBytes=2200000L)
    database(config) { (db,archive) =>
      val large=archive.ingest("a",request(List("x"*40000))); val small=archive.ingest("a",request(List("small")))
      val admission=ModelAdmission.make(config.indexing).unsafeRunSync()
      val lane=worker(archive,config,new ProblemPassageFixtures.Dummy,new Embedded(3),admission)
      assert(permitTaken(admission)(lane.once))
      assert(!permitTaken(admission)(lane.once),"the job above the small-job budget waits")
      assertEquals(archive.session("a",small.sessionId).indexedRevision,Some(1))
      assertEquals(job(db,large.jobId),JobRow("Queued",None,None,0,0))
      assert(lane.once.unsafeRunSync())
      assertEquals((job(db,large.jobId).state,job(db,large.jobId).attempts,archive.session("a",large.sessionId).indexedRevision),("Complete",1,Some(1)))
    }
  }

  test("a job that outgrows maxSmallJobBudgetBytes while it runs without the large-job permit returns to the queue for the lane with the permit, without an attempt or a failure, and completes there; above maxIndexingBudgetBytes that lane ends it index-budget-exceeded") {
    // "AB"*40: one fragment estimated at about 2.11 MB, cut by the annotator into 80 one-scalar pieces that retain 3.16 MB.
    val config=Fixtures.config().copy(maxIndexingBudgetBytes=4000000L,maxSmallJobBudgetBytes=3000000L)
    database(config) { (db,archive) =>
      val outgrown=archive.ingest("a",request(List("AB"*40)))
      val admission=ModelAdmission.make(config.indexing).unsafeRunSync()
      val embedder=new Embedded(3)
      val lane=worker(archive,config,new ProblemPassageFixtures.Dummy,embedder,admission)
      assert(permitTaken(admission)(lane.once))
      assertEquals(job(db,outgrown.jobId),JobRow("Queued",None,None,0,2))
      assertEquals(archive.statuses("a",0,100).jobs.map(j => (j.state,j.attempts,j.error,j.completedWindows,j.totalWindows)),List((JobState.Queued,0,None,0,Some(1))))
      assertEquals(embedder.batches.toList,Nil)
      assert(!permitTaken(admission)(lane.once),"the deferred job waits for the lane with the permit")
      assert(lane.once.unsafeRunSync())
      assertEquals((job(db,outgrown.jobId).state,job(db,outgrown.jobId).attempts,archive.session("a",outgrown.sessionId).indexedRevision),("Complete",1,Some(1)))
      assertEquals(embedder.batches.flatten.size,80)
      val exceeded=archive.ingest("b",request(List("AB"*40)))
      val tight=config.copy(maxIndexingBudgetBytes=3100000L)
      assert(worker(new PostgresArchive(db,tight),tight,new ProblemPassageFixtures.Dummy,embedder).once.unsafeRunSync())
      assertEquals(job(db,exceeded.jobId),JobRow("Failed",Some(IndexingBudget.exceededCode),Some("Embedding"),1,1))
    }
  }

  test("a message page holds the longest prefix of its messages within the page byte bound, at least one; the production bound is 64 MiB") {
    database(Fixtures.config()) { (db,archive) =>
      val receipt=archive.ingest("a",request(List.fill(5)("x"*3000):+("y"*20000)))
      val view=Some(ContentView(1,None))
      def bounded(offset: Int): MessagesResult = archive.messages("a",receipt.sessionId,offset,100,view,ReadMaterialization.unrestricted,10000)
      assertEquals((bounded(0).messages.map(_.id),bounded(0).total,bounded(0).offset),(List("m0","m1","m2"),6,0))
      assertEquals(bounded(5).messages.map(_.id),List("m5"))
      assertEquals(PostgresArchive.messagePageBytes,64L*1024*1024)
      assertEquals(archive.messages("a",receipt.sessionId,0,100,view).messages.size,6)
    }
  }

  test("an epoch revision larger than the planner's statistics: its first page reads one page of rows and the claim streams it in key order without a sort") {
    database(Fixtures.config()) { (db,archive) =>
      // Statistics of more epochs than their 100 most common values (as in production), then an epoch they do not know:
      // the planner expects about ten of its rows.
      db.transaction { c =>
        Sql.exec(c,"INSERT INTO ch_epochs(id,session_id,raw_path) SELECT md5('e'||i)::uuid,md5('s'||i)::uuid,'small.jsonl' FROM generate_series(1,200) i")
        Sql.exec(c,"INSERT INTO ch_epoch_messages(epoch,position,message_id,value) SELECT md5('e'||i)::uuid,p,'m'||p,jsonb_build_object('text',repeat('s',1000)) FROM generate_series(1,200) i,generate_series(0,9) p")
        Sql.exec(c,"ANALYZE ch_epoch_messages")
      }
      val large=archive.ingest("a",request((0 until 2000).map(i => s"large $i "+"z"*1000))).sessionId
      def plan(c: java.sql.Connection,query: ReadSources.Query): String = Sql.rows(c,"EXPLAIN (ANALYZE,BUFFERS) "+query.sql,query.args*)(_.getString(1)).mkString("\n")
      val page=db.transaction { c => val stored=RevisionContent.resolve(c,large,1).get; plan(c,archive.messagePage(c,stored,0,100)) }
      val stream=db.transaction { c =>
        val stored=RevisionContent.resolve(c,large,1).get
        archive.claimedSnapshot(c,large,1)
        plan(c,ReadSources.Query(s"SELECT value FROM ${stored.messages.sql} m ORDER BY position",stored.messages.args))
      }
      println(s"FIRST PAGE PLAN\n$page\nCLAIM STREAM PLAN\n$stream")
      // The key's range: no other index, no rows read and filtered away, no sort.
      List(page,stream).foreach(plan => assert(plan.contains("Index Scan using ch_epoch_messages_pkey") && !plan.contains("Rows Removed") && !plan.contains("Sort"),plan))
      assertEquals("""Index Scan.*actual time=[0-9.]+\.\.[0-9.]+ rows=([0-9]+)""".r.findFirstMatchIn(page).map(_.group(1).toInt),Some(100))
    }
  }

  test("configuration: maxFileBytes, maxRawReadBytes, maxIndexingBudgetBytes and maxSmallJobBudgetBytes take values above 2^31; omitted, the raw bound is maxBodyBytes, the budget 2,147,483,647 and the small-job budget the estimate of 100 windows of 64 full fragments") {
    val example=Wire.parse(java.nio.file.Files.readString(java.nio.file.Path.of("config.example.json"))).asObject.get
    def parsed(fields: (String,Json)*): Config = Json.fromJsonObject(fields.foldLeft(example)((o,f) => o.add(f._1,f._2))).as[Config].fold(error => fail(error.toString),identity)
    val omitted=parsed()
    omitted.validate()
    assertEquals((omitted.maxRawReadBytes,omitted.maxIndexingBudgetBytes,omitted.maxSmallJobBudgetBytes),(omitted.maxBodyBytes.toLong,Config.defaultIndexingBudgetBytes,Config.defaultSmallJobBudgetBytes(omitted.embedding.dimensions)))
    assertEquals(Config.defaultIndexingBudgetBytes,2147483647L)
    assertEquals((Config.defaultSmallJobBudgetBytes(768),Config.defaultSmallJobBudgetBytes(4000)),(152856880L,318971184L))
    val large=parsed("maxFileBytes"->Json.fromLong(8589934592L),"maxRawReadBytes"->Json.fromLong(536870912L),"maxIndexingBudgetBytes"->Json.fromLong(Long.MaxValue),"maxSmallJobBudgetBytes"->Json.fromLong(4294967296L))
    large.validate()
    assertEquals((large.maxFileBytes,large.maxRawReadBytes,large.maxIndexingBudgetBytes,large.maxSmallJobBudgetBytes),(8589934592L,536870912L,Long.MaxValue,4294967296L))
    List(omitted.copy(maxRawReadBytes=536870913L),omitted.copy(maxRawReadBytes=0),omitted.copy(maxIndexingBudgetBytes=0),omitted.copy(maxSmallJobBudgetBytes=0)).foreach { invalid =>
      assertEquals(intercept[DomainError](invalid.validate()).code,"config")
    }
    assert(Json.fromJsonObject(example.add("maxRawReadBytes",Json.Null)).as[Config].isLeft)
  }
}
