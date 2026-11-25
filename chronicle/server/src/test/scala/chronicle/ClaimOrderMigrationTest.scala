package chronicle

import cats.effect.unsafe.implicits.global
import chronicle.api.*
import io.circe.Json
import java.io.{ByteArrayOutputStream,PrintStream}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path}
import java.sql.Connection
import java.time.{Instant,OffsetDateTime}
import java.util.UUID
import scala.collection.mutable.ListBuffer
import scala.util.Using

/** T9 (claim-order design §4): migration 033, the start fill, the reseed and down-033 on the suite's owned database. */
final class ClaimOrderMigrationTest extends munit.FunSuite {
  private type Order = (Option[Instant],Option[Boolean])
  private def fixture(f: (Config,Database,PostgresArchive,IndexProfileCatalog) => Unit): Unit =
    OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
      db.transaction(c => Sql.exec(c,"TRUNCATE ch_uploads,ch_epochs,ch_reindex_requests,ch_reindex_members CASCADE"))
      // A case that dropped 033 leaves the schema whole for the next one.
      try f(config,db,archive,catalog) finally db.initialize()
    }
  private def now(c: Connection): Instant = Sql.one(c,"SELECT now()")(_.getObject(1,classOf[OffsetDateTime]).toInstant).get
  private def marker(db: Database): Instant = db.transaction(now)
  private def order(c: Connection,job: UUID): Order =
    Sql.one(c,"SELECT waiting_since,bulk FROM ch_jobs WHERE id=?",job)(r => (Option(r.getObject(1,classOf[OffsetDateTime])).map(_.toInstant),Option(r.getObject(2,classOf[java.lang.Boolean])).map(_.booleanValue))).get
  private def order(db: Database,job: UUID): Order = db.transaction(order(_,job))
  private def plant(db: Database,job: UUID,at: String,bulk: Boolean): Order = {
    db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET waiting_since=?::timestamptz,bulk=? WHERE id=?",at,bulk,job)); order(db,job)
  }
  private def unset(db: Database): Unit = { db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET waiting_since=NULL,bulk=NULL")); () }
  /** `initialize` with its progress lines. */
  private def started(db: Database): List[String] = { val lines=ListBuffer.empty[String]; db.initialize(report=line => { lines += line; () }); lines.toList }
  private def source(archive: PostgresArchive,owner: String): IngestReceipt = archive.ingest(owner,Fixtures.snapshot())
  private def setState(db: Database,job: UUID,assignment: String): Unit = { db.transaction(c => Sql.exec(c,s"UPDATE ch_jobs SET $assignment WHERE id=?",job)); () }
  private def rebuild(db: Database,owner: String,catalog: IndexProfileCatalog): Unit = {
    val plan=db.transaction { c => c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ); OwnerReindex.preview(c,owner,catalog,true) }
    db.transaction(c => OwnerReindex(c,owner,UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true,catalog,true)); ()
  }
  private def headJob(db: Database,session: UUID): UUID =
    db.transaction(c => Sql.one(c,"SELECT j.id FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id AND j.revision=s.revision WHERE s.id=?",session)(_.getObject(1,classOf[UUID])).get)
  private def down(config: Config,variables: (String,String)*): (Int,List[String]) = {
    val name=config.jdbcUrl.drop(config.jdbcUrl.lastIndexOf('/')+1).takeWhile(_!='?')
    val psql=Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
    val address=config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
    val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),"PGUSER"->config.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->name)
    val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1")++variables.flatMap((key,value) => List("-v",s"$key=$value"))++List("-f",Path.of("scripts","down-033-claim-order.sql").toString),sys.env,connection,CheckChild.limit)
    (ran.exit,ran.out.linesIterator.toList)
  }
  private def printed(lines: List[String]): Map[String,String] = lines.map(_.split('|')).collect { case Array(key,value) => key->value }.toMap
  private def downApplied(config: Config): Unit = {
    val (preflightExit,preflight)=down(config)
    assertEquals((preflightExit,preflight.last),(0,"DOWN033.result|preflight-complete"),preflight.mkString("\n"))
    val name=config.jdbcUrl.drop(config.jdbcUrl.lastIndexOf('/')+1).takeWhile(_!='?')
    val (appliedExit,applied)=down(config,"mode"->"apply","apply_irreversible"->"yes","confirm_database"->name,"expect_plan"->printed(preflight)("DOWN033.plan"))
    assertEquals((appliedExit,applied.last),(0,"DOWN033.result|applied"),applied.mkString("\n"))
  }
  private def schema(db: Database): (List[(String,String,Option[String])],List[String],Int) = db.transaction { c =>
    (Sql.rows(c,"SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_name='ch_jobs' AND column_name IN('waiting_since','bulk') ORDER BY column_name")(r => (r.getString(1),r.getString(2),Option(r.getString(3)))),
      Sql.rows(c,"SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='ch_jobs'::regclass AND i.indisvalid AND c.relname IN('ch_jobs_class','ch_jobs_age','ch_jobs_sized','ch_jobs_running') ORDER BY 1")(_.getString(1)),
      Sql.one(c,"SELECT count(*)::int FROM ch_schema_migrations WHERE version=33")(_.getInt(1)).get)
  }
  private val migrated=(List(("bulk","YES",None),("waiting_since","YES",None)),List("ch_jobs_age","ch_jobs_class","ch_jobs_running","ch_jobs_sized"),1)
  private def filenode(db: Database): Long = db.transaction(c => Sql.one(c,"SELECT pg_relation_filenode('ch_jobs')")(_.getLong(1)).get)

  test("T9: 033 adds the columns without rewriting ch_jobs under an ACCESS EXCLUSIVE lock held to commit; a second start changes nothing") { fixture { (config,db,archive,_) =>
    val queued=List.fill(2)(source(archive,"a").jobId); val complete=source(archive,"a").jobId
    setState(db,complete,"state='Complete'")
    downApplied(config)
    assertEquals(schema(db),(Nil,Nil,0))
    val node=filenode(db)
    // The lock 033 takes, observed in its own transaction (rolled back), still held after its last statement.
    val migration=Using.resource(getClass.getResourceAsStream("/033_claim_order.sql"))(stream => Using.resource(scala.io.Source.fromInputStream(stream,"UTF-8"))(_.mkString))
    val modes=db.transaction { c =>
      Using.resource(c.createStatement())(_.execute(migration))
      ClaimOrderSeed.startFill(c)
      val held=Sql.rows(c,"SELECT mode FROM pg_locks WHERE pid=pg_backend_pid() AND relation='ch_jobs'::regclass AND granted ORDER BY mode")(_.getString(1))
      c.rollback()
      held
    }
    assert(modes.contains("AccessExclusiveLock"),modes.toString)
    assertEquals(schema(db),(Nil,Nil,0),"the observing transaction rolled back")
    val before=marker(db); val first=started(db); val after=marker(db)
    assertEquals(filenode(db),node,"033 is a catalog change: ch_jobs keeps its relfilenode")
    assertEquals(first,List("claim order start fill rows=2"))
    assertEquals(schema(db),migrated)
    val filled=queued.map(order(db,_))
    assertEquals(filled.map(_._1).distinct.size,1,"one start time")
    assert(filled.head._1.exists(t => !t.isBefore(before) && !t.isAfter(after)),filled.toString)
    assertEquals(filled.map(_._2),List(Some(false),Some(false)))
    assertEquals(order(db,complete),(None,None),"a finished job is not filled")
    assertEquals(started(db),List("claim order start fill rows=0"))
    assertEquals((schema(db),queued.map(order(db,_)),filenode(db)),(migrated,filled,node))
    // The fill in a transaction of the test: exactly its now(), NULLs only.
    plant(db,queued.head,"2001-01-01T00:00:00Z",true)
    db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET waiting_since=NULL WHERE id=?",queued(1)))
    val (rows,filledAt)=db.transaction(c => (ClaimOrderSeed.startFill(c),now(c)))
    assertEquals((rows,order(db,queued(1)),order(db,queued.head)),(1,(Some(filledAt),Some(false)),(Some(Instant.parse("2001-01-01T00:00:00Z")),Some(true))))
  }}

  test("T9 D-i: the fill files a current cohort member and a retried job bulk, a member of a moved target epoch and a plain job fresh") { fixture { (_,db,archive,catalog) =>
    val member=source(archive,"a").sessionId
    rebuild(db,"a",catalog)
    val moved=source(archive,"b").sessionId
    rebuild(db,"b",catalog)
    db.transaction(c => Sql.exec(c,"UPDATE ch_owner_targets SET epoch=epoch+1 WHERE owner='b'"))
    val retried=source(archive,"c").jobId
    setState(db,retried,"state='Failed',attempts=5,error='model-http'")
    archive.retry("c",retried)
    val plain=source(archive,"c").jobId
    val jobs=List(headJob(db,member),headJob(db,moved),retried,plain)
    unset(db)
    assertEquals(started(db),List("claim order start fill rows=4"))
    assertEquals(jobs.map(order(db,_)._2),List(Some(true),Some(false),Some(true),Some(false)))
    val (seeded,seededAt)=db.transaction(c => (ClaimOrderSeed.reseed(c),now(c)))
    assertEquals(seeded,ClaimOrderSeed.Reseeded(4,2))
    assertEquals(jobs.map(order(db,_)),List(true,false,true,false).map(bulk => (Some(seededAt),Some(bulk))))
  }}

  /** A run of the deployed entry point in process: exit code, stdout. */
  private def command(config: Config,name: String): (Int,String) = {
    val sample=Wire.parse(Files.readString(Path.of("config.example.json")))
    def model(key: String,changes: (String,Json)*): Json = sample.hcursor.downField(key).focus.get.mapObject(o => changes.foldLeft(o)((o,change) => o.add(change._1,change._2)))
    val json=sample.mapObject(_.add("jdbcUrl",Json.fromString(config.jdbcUrl)).add("databaseUser",Json.fromString(config.databaseUser)).add("databasePasswordFile",Json.fromString(config.databasePasswordFile))
      .add("users",Json.fromValues(config.users.map(u => Json.obj("id"->Json.fromString(u.id),"login"->Json.fromString(u.login),"passwordHashFile"->Json.fromString(u.passwordHashFile),"enabled"->Json.fromBoolean(u.enabled)))))
      .add("annotation",model("annotation","endpoint"->Json.fromString("http://127.0.0.1:1/forbidden-model"),"credentialFile"->Json.fromString(config.annotation.credentialFile)))
      .add("embedding",model("embedding","endpoint"->Json.fromString("http://127.0.0.1:1/forbidden-model"),"credentialFile"->Json.fromString(config.embedding.credentialFile),"dimensions"->Json.fromInt(3))))
    val dir=Files.createTempDirectory("chronicle-reseed-"); val path=dir.resolve("config.json")
    Files.writeString(path,json.noSpaces)
    val (out,originalOut)=(new ByteArrayOutputStream(),System.out)
    try {
      System.setOut(new PrintStream(out,true,UTF_8))
      val exit=Main.run(List(name,path.toString)).unsafeRunSync()
      (exit.code,out.toString(UTF_8))
    } finally { System.setOut(originalOut); List(path,dir).foreach(Files.deleteIfExists) }
  }

  test("T9: fe4f69f7's job writes on the new schema leave NULLs (filled at the next start) and stale values (only the reseed renews them)") { fixture { (config,db,archive,catalog) =>
    val switching=source(archive,"a")
    val retried=source(archive,"a").jobId
    val rebuilt=source(archive,"b").jobId
    val stale=List(retried,rebuilt).map(plant(db,_,"2001-01-01T00:00:00Z",false))
    setState(db,retried,"state='Failed',attempts=5,error='model-http'")
    // fe4f69f7's statements, verbatim: its revision switch, RetryJob and owner rebuild's INSERT.
    val inserted=UUID.randomUUID()
    db.transaction { c =>
      Sql.one(c,"SELECT 1 FROM ch_sources WHERE id=? FOR NO KEY UPDATE",switching.sessionId)(_ => ())
      Sql.exec(c,"UPDATE ch_sources SET revision=2 WHERE id=?",switching.sessionId)
      Jobs.supersede(c,s"UPDATE ch_jobs j SET ${Jobs.superseding} WHERE j.session_id=? AND j.revision<? AND j.state IN('Queued','Running') AND (${Jobs.leased("j")}) IS NOT TRUE RETURNING j.id",switching.sessionId,2)
      Sql.exec(c,"INSERT INTO ch_jobs(id,session_id,revision,profile) VALUES(?,?,?,?)",inserted,switching.sessionId,2,config.profile)
      Sql.exec(c,"UPDATE ch_jobs SET state='Queued',attempts=0,lease_until=NULL,transient_failures=0,transient_range=NULL,fence=fence+1,annotation_retry_epoch=annotation_retry_epoch+1,run_id=CASE WHEN state='Complete' THEN gen_random_uuid() ELSE run_id END,error=CASE WHEN state='Complete' THEN NULL ELSE error END,failure_stage=CASE WHEN state='Complete' THEN NULL ELSE failure_stage END,completed_windows=0,total_windows=NULL WHERE id=?",retried)
      Sql.exec(c,"CREATE TEMP TABLE ch_rebuild_heads ON COMMIT DROP AS SELECT id,revision,published FROM ch_sources WHERE owner=? AND NOT tombstone","b")
      Sql.exec(c,"INSERT INTO ch_jobs(id,session_id,revision,profile) SELECT gen_random_uuid(),id,revision,? FROM pg_temp.ch_rebuild_heads ON CONFLICT(session_id,revision,profile) DO UPDATE SET state='Queued',attempts=0,fence=ch_jobs.fence+1,run_id=gen_random_uuid(),lease_until=NULL,transient_failures=0,transient_range=NULL,error=NULL,failure_stage=NULL,completed_windows=0,total_windows=NULL",config.profile)
      Sql.exec(c,"DROP TABLE pg_temp.ch_rebuild_heads")
    }
    assertEquals(order(db,inserted),(None,None))
    assertEquals(List(retried,rebuilt).map(order(db,_)),stale)
    val before=marker(db); assertEquals(started(db),List("claim order start fill rows=1")); val after=marker(db)
    assert(order(db,inserted)._1.exists(t => !t.isBefore(before) && !t.isAfter(after)))
    assertEquals(List(retried,rebuilt).map(order(db,_)),stale,"the start fill cannot see stale values")
    // The reseed (server stopped) renews every unfinished job; the retried one is filed bulk (D-i).
    val reseedBefore=marker(db)
    val (exit,out)=command(config,"reseed-claim-order")
    val reseedAfter=marker(db)
    assertEquals((exit,out),(0,"claim order reseed rows=3 bulk=1 fresh=2\n"))
    val renewed=List(inserted,retried,rebuilt).map(order(db,_))
    assertEquals(renewed.map(_._1).distinct.size,1)
    assert(renewed.head._1.exists(t => !t.isBefore(reseedBefore) && !t.isAfter(reseedAfter)),renewed.toString)
    assertEquals(renewed.map(_._2),List(Some(false),Some(true),Some(false)))
    // Without 033 the reseed refuses.
    downApplied(config)
    assertEquals(intercept[DomainError](db.transaction(ClaimOrderSeed.reseed)).code,"migration-required")
  }}

  test("T9: down-033 drops the columns, their indexes and ledger row 33, keeps every other job value; a start migrates again") { fixture { (config,db,archive,_) =>
    val jobs=List.fill(2)(source(archive,"a").jobId)
    plant(db,jobs.head,"2001-01-01T00:00:00Z",true)
    def rest(): List[String] = db.transaction(c => Sql.rows(c,"SELECT (to_jsonb(j)-'waiting_since'-'bulk')::text FROM ch_jobs j ORDER BY id")(_.getString(1)))
    val kept=rest()
    val (preflightExit,preflight)=down(config)
    assertEquals((preflightExit,printed(preflight).view.filterKeys(_.startsWith("DOWN033.jobs")).toMap,printed(preflight)("DOWN033.indexes")),
      (0,Map("DOWN033.jobs.waiting_since"->"2","DOWN033.jobs.bulk"->"1","DOWN033.jobs.unfilled"->"0"),"4"))
    val name=config.jdbcUrl.drop(config.jdbcUrl.lastIndexOf('/')+1).takeWhile(_!='?')
    val (refusedExit,refused)=down(config,"mode"->"apply","apply_irreversible"->"yes","confirm_database"->name,"expect_plan"->"0")
    assertEquals((refusedExit,refused.contains("DOWN033.result|refused-unconfirmed")),(3,true),refused.mkString("\n"))
    val (dryExit,dry)=down(config,"mode"->"dry-run")
    assertEquals((dryExit,dry.last,schema(db)),(0,"DOWN033.result|dry-run-complete",migrated))
    downApplied(config)
    assertEquals(schema(db),(Nil,Nil,0))
    assertEquals(rest(),kept)
    assertEquals(down(config)._2.last,"DOWN033.result|absent")
    assertEquals(started(db),List("claim order start fill rows=2"))
    assertEquals(schema(db),migrated)
  }}
}
