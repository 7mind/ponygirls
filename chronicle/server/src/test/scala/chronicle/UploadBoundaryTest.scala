package chronicle

import cats.effect.{Deferred,IO}
import cats.effect.std.{Queue,Semaphore}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import chronicle.api.*
import distage.*
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import java.util.concurrent.{Callable,Executors,TimeUnit}
import org.http4s.{Http as _,Message as _,*}
import org.http4s.client.Client
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import scala.concurrent.duration.*

/** Part uploads at their boundaries: the HTTP routes with their body bounds and the large-part permit, the staging owner
  * against the sweep, purge racing writers, and the lease. */
final class UploadBoundaryTest extends munit.FunSuite {
  import UploadFixtures.*
  private val mebibyte=1024*1024
  /** Runs one pass of the maintenance loop with `interval`: answers its first wait and returns once it waits again. */
  private def maintenancePass(db: Database,interval: FiniteDuration): FiniteDuration = (for {
    sleeps <- Queue.unbounded[IO,(FiniteDuration,Deferred[IO,Unit])]
    waited <- EpochMaintenance.resource(db,logstage.IzLogger(),interval,duration => Deferred[IO,Unit].flatMap(gate => sleeps.offer(duration -> gate) *> gate.get)).use { _ =>
      sleeps.take.timeout(10.seconds).flatMap { case (duration,gate) => gate.complete(()) *> sleeps.take.timeout(60.seconds).as(duration) }
    }
  } yield waited).unsafeRunSync()
  private def awaitBlocked(db: Database,prefix: String): Unit = {
    val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10)
    def blocked: Boolean = db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ?)",prefix+"%")(_.getBoolean(1)).get)
    while(!blocked && System.nanoTime()<deadline) Thread.onSpinWait()
    assert(blocked,s"expected a lock wait at $prefix")
  }

  test("the sweep of an aborted attempt leaves the staging of the attempt that took its tail over: abort A, open B, stage B, sweep A, commit B") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val identity=source()
    val head=header(3)++pi("u1","s","user","question",1)
    val id=archive.ingest("a",request(identity,0,head)).sessionId
    val a=uploads.open("a",declaration(identity,1,head++pi("a1","u1","assistant","abandoned answer",2),Some(head))).uploadId
    send(uploads,"a",a,part(0,pi("a1","u1","assistant","abandoned answer",2)))
    uploads.abort("a",a)
    val delta=pi("a1","u1","assistant","answer",2)++pi("u2","a1","user","next question",3)
    val b=uploads.open("a",declaration(identity,1,head++delta,Some(head))).uploadId
    send(uploads,"a",b,part(0,delta))
    maintenancePass(db,EpochMaintenance.interval)
    assertEquals(uploads.commit("a",b).revision,2)
    assertEquals(archive.messages("a",id,0,100,None).messages.map(_.text),List("question","answer","next question"))
    assertEquals(archive.raw("a",id,Some(2)).files.head.content,(head++delta).raw)
    db.transaction(c => assertEquals(Sql.rows(c,"SELECT phase,cleaned FROM ch_uploads ORDER BY attempt,phase")(r => (r.getString(1),r.getBoolean(2))).toSet,Set(("Aborted",true),("Committed",true))))
  }}

  test("a purge racing a part and a commit in flight waits for each in the writers' lock order, nothing deadlocks, and the source is gone") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val auth=new Auth(db,config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val pool=Executors.newFixedThreadPool(2)
    def purge(id: UUID) = pool.submit(new Callable[Result] { def call(): Result = auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(id))) })
    /** Holds `table` while `writer` starts, then purge, and returns both outcomes once the table is released. */
    def race[A](table: String,writer: Callable[A],id: UUID): A = {
      val (pending,purging)=db.transaction { held =>
        Sql.exec(held,s"LOCK TABLE $table IN SHARE MODE")
        val pending=pool.submit(writer)
        awaitBlocked(db,s"INSERT INTO $table")
        val purging=purge(id)
        awaitBlocked(db,"UPDATE ch_uploads SET phase='Aborted'")
        (pending,purging)
      }
      val written=pending.get(10,TimeUnit.SECONDS)
      assertEquals(purging.get(10,TimeUnit.SECONDS).getClass,classOf[Result.Mutation])
      written
    }
    try {
      val head=header(3)++pi("u1","s","user","question",1)
      val delta=pi("a1","u1","assistant","answer",2)
      def opened(): (UUID,UUID) = {
        val identity=source()
        val id=archive.ingest("a",request(identity,0,head)).sessionId
        (id,uploads.open("a",declaration(identity,1,head++delta,Some(head))).uploadId)
      }
      val (parted,partUpload)=opened()
      val state=race("ch_epoch_fragments",new Callable[UploadState] { def call(): UploadState = send(uploads,"a",partUpload,part(0,delta)) },parted)
      assertEquals((state.phase,state.receivedParts),(UploadPhase.Open,1),"the part ended before the purge aborted its attempt")
      assertEquals(code(uploads.commit("a",partUpload)),"gone")
      assertEquals((uploads.status("a",partUpload).phase,uploads.status("a",partUpload).failure),(UploadPhase.Aborted,Some(Uploads.purged)))
      val (committed,commitUpload)=opened()
      send(uploads,"a",commitUpload,part(0,delta))
      assertEquals(race("ch_archive_fragments",new Callable[IngestReceipt] { def call(): IngestReceipt = uploads.commit("a",commitUpload) },committed).revision,2,"the commit ended before the purge")
      List(parted,committed).foreach { id =>
        assertEquals(code(archive.session("a",id)),"not-found")
        db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revisions WHERE session_id=?",id)(_.getInt(1)),Some(0)))
      }
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(10,TimeUnit.SECONDS)) }
  }}

  test("an attempt expires after its injected lease and not before; the sweep, after its injected interval, ends it and deletes its staging, then the attempt after the retention; production defaults") { database { (config,db,archive) =>
    val lease=10.minutes
    val uploads=new Uploads(db,config,UploadPolicy(lease,2))
    val head=header(3)++pi("u1","s","user","question",1)
    val delta=pi("a1","u1","assistant","answer",2)
    // A replacement of a new source stages in an epoch of its own; an append stages in the head's epoch.
    val replacing=uploads.open("a",declaration(source(),0,head,None)).uploadId
    val replaced=send(uploads,"a",replacing,part(0,head))
    assert(replaced.expiresInSeconds>lease.toSeconds-10 && replaced.expiresInSeconds<=lease.toSeconds,replaced.toString)
    val identity=source()
    val id=archive.ingest("a",request(identity,0,head)).sessionId
    val appending=uploads.open("a",declaration(identity,1,head++delta,Some(head))).uploadId
    send(uploads,"a",appending,part(0,delta))
    assertEquals(code(uploads.open("a",declaration(source(),0,head,None))),"upload-busy","the owner's live attempts are bounded")
    def age(attempt: UUID,column: String,by: FiniteDuration): Unit = db.transaction(c => Sql.exec(c,s"UPDATE ch_uploads SET $column=$column-?::bigint*interval '1 millisecond' WHERE id=?",by.toMillis,attempt))
    age(replacing,"expires_at",lease-2.seconds)
    assertEquals(uploads.status("a",replacing).phase,UploadPhase.Open,"not before the lease passed")
    age(replacing,"expires_at",3.seconds)
    uploads.abort("a",appending)
    val (epoch,staged)=db.transaction(c => (Sql.one(c,"SELECT epoch FROM ch_uploads WHERE id=?",replacing)(_.getObject(1,classOf[UUID])).get,Sql.one(c,"SELECT count(*) FROM ch_epoch_messages")(_.getInt(1)).get))
    assertEquals(staged,3,"one committed message, two staged ones")
    val interval=11.seconds
    assertEquals(maintenancePass(db,interval),interval)
    db.transaction { c =>
      assertEquals(Sql.rows(c,"SELECT id,phase,cleaned FROM ch_uploads ORDER BY phase")(r => (r.getObject(1,classOf[UUID]),r.getString(2),r.getBoolean(3))),List((appending,"Aborted",true),(replacing,"Expired",true)))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_epochs WHERE id=?",epoch)(_.getInt(1)),Some(0),"an epoch that no revision references goes with its staging")
      assertEquals(Sql.rows(c,"SELECT message_id FROM ch_epoch_messages")(_.getString(1)),List("u1"))
      assertEquals(Sql.rows(c,"SELECT tail_upload FROM ch_epochs WHERE tail_upload IS NOT NULL")(_.getString(1)),Nil)
    }
    assertEquals(archive.messages("a",id,0,100,None).messages.map(_.id),List("u1"))
    age(replacing,"terminal_at",Uploads.retention+1.second)
    age(appending,"terminal_at",Uploads.retention-1.minute)
    maintenancePass(db,interval)
    db.transaction(c => assertEquals(Sql.rows(c,"SELECT id FROM ch_uploads")(_.getObject(1,classOf[UUID])),List(appending),"deleted after the retention, not before"))
    assertEquals((UploadPolicy.production,Uploads.retention),(UploadPolicy(3600.seconds,8),7.days))
    val production: Module=_root_.chronicle.plugins.ChroniclePlugin
    assertEquals(ChronicleInjector().produceGet[UploadPolicy](production).use(IO.pure).unsafeRunSync(),UploadPolicy.production)
  }}

  test("concurrent opens of one owner's sources at the last free slot: one takes it, the other is upload-busy") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy(UploadPolicy.production.ttl,2))
    val head=header(3)++pi("u1","s","user","question",1)
    uploads.open("a",declaration(source(),0,head,None))
    val pool=Executors.newFixedThreadPool(2)
    try {
      val opens=db.transaction { held =>
        // Holds the insert of an attempt: each open has passed its source's checks when it waits here or for another open.
        Sql.exec(held,"LOCK TABLE ch_uploads IN SHARE MODE")
        val opens=List.fill(2)(pool.submit(new Callable[String] { def call(): String = code(uploads.open("a",declaration(source(),0,head,None))) }))
        def waiting: Int = db.transaction(c => Sql.one(c,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE 'INSERT INTO ch_uploads%' OR query LIKE 'SELECT pg_advisory_xact_lock%')")(_.getInt(1)).get)
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10)
        while(waiting<2 && System.nanoTime()<deadline) Thread.onSpinWait()
        assertEquals(waiting,2,"both opens wait")
        opens
      }
      assertEquals(opens.map(_.get(10,TimeUnit.SECONDS)).sorted,List("accepted","upload-busy"))
      db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_uploads WHERE owner='a' AND phase='Open'")(_.getInt(1)),Some(2)))
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(10,TimeUnit.SECONDS)) }
  }}

  test("a part in flight when its lease passes cannot renew it once an open may have taken the attempt's slot: the part is upload-expired") { database { (config,db,archive) =>
    // The bound is 2 throughout; one attempt keeps its slot for an hour, A's lease is 2 s (injected) and passes while its
    // part is held after the lease check, at its fragment insert.
    val lasting=new Uploads(db,config,UploadPolicy(UploadPolicy.production.ttl,2))
    val brief=new Uploads(db,config,UploadPolicy(2.seconds,2))
    val head=header(3)++pi("u1","s","user","question",1)
    lasting.open("a",declaration(source(),0,head,None))
    val a=brief.open("a",declaration(source(),0,head,None)).uploadId
    val pool=Executors.newSingleThreadExecutor()
    try {
      val (sending,opened)=db.transaction { held =>
        Sql.exec(held,"LOCK TABLE ch_epoch_fragments IN SHARE MODE")
        val sending=pool.submit(new Callable[String] { def call(): String = code(send(brief,"a",a,part(0,head))) })
        awaitBlocked(db,"INSERT INTO ch_epoch_fragments")
        def passed: Boolean = db.transaction(c => Sql.one(c,"SELECT expires_at<=clock_timestamp() FROM ch_uploads WHERE id=?",a)(_.getBoolean(1)).get)
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10)
        while(!passed && System.nanoTime()<deadline) Thread.onSpinWait()
        assert(passed,"A's lease passed while its part is held")
        (sending,code(lasting.open("a",declaration(source(),0,head,None))))
      }
      assertEquals((opened,sending.get(10,TimeUnit.SECONDS)),("accepted","upload-expired"),"the open took A's slot; A's part does not renew A")
      assertEquals(brief.status("a",a).phase,UploadPhase.Expired)
      db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_uploads WHERE owner='a' AND phase='Open' AND expires_at>clock_timestamp()")(_.getInt(1)),Some(2)))
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(10,TimeUnit.SECONDS)) }
  }}

  test("written messages are read back through the key's range of an epoch the statistics do not know, not through the whole epoch") { database { (_,db,_) =>
    // Statistics of 200 epochs whose rows sit where the next rows of a large epoch they do not know will be written.
    val large=UUID.randomUUID()
    try {
      db.transaction { c =>
        Sql.exec(c,"INSERT INTO ch_epochs(id,session_id,raw_path) SELECT md5('e'||i)::uuid,md5('s'||i)::uuid,'small.jsonl' FROM generate_series(1,200) i")
        Sql.exec(c,"INSERT INTO ch_epoch_messages(epoch,position,message_id,value) SELECT md5('e'||i)::uuid,30000+p,'m'||p,jsonb_build_object('text',repeat('s',1000)) FROM generate_series(1,200) i,generate_series(0,9) p")
        Sql.exec(c,"ANALYZE ch_epoch_messages")
        Sql.exec(c,"INSERT INTO ch_epochs(id,session_id,raw_path) VALUES(?,?,'large.jsonl')",large,UUID.randomUUID())
        Sql.exec(c,"INSERT INTO ch_epoch_messages(epoch,position,message_id,value) SELECT ?,p,'large '||p,jsonb_build_object('text',repeat('z',1000)) FROM generate_series(0,29999) p",large)
      }
      // The writer of every S1 append and every part; in its transaction, what each index of the messages returned.
      val read=db.transaction { c =>
        EpochWriter.append(c,large,30000,List.tabulate(100)(i => Message(s"next $i",None,"user",s"next text $i",None,0)),"",0,0L,0,ResumableSha256())
        Sql.rows(c,"SELECT i,pg_stat_get_xact_tuples_returned(i::regclass) FROM unnest(ARRAY['ch_epoch_messages_pkey','ch_epoch_messages_epoch_message_id_key']) i ORDER BY i")(r => r.getString(1) -> r.getLong(2))
      }
      assertEquals(read,List("ch_epoch_messages_epoch_message_id_key"->0L,"ch_epoch_messages_pkey"->100L))
    } finally db.transaction { c => Sql.exec(c,"TRUNCATE ch_epochs CASCADE"); Sql.exec(c,"ANALYZE ch_epoch_messages") }
  }}

  test("the writer's transaction merges the fragment index's pending list in fragmentIndexMergeBytes batches; the connection's settings are unchanged after it") { database { (_,db,_) =>
    def merge(c: java.sql.Connection): (Long,Long) =
      Sql.one(c,"SELECT pg_size_bytes(current_setting('gin_pending_list_limit')),pg_size_bytes(current_setting('work_mem'))")(r => (r.getLong(1),r.getLong(2))).get
    db.transaction { c =>
      val defaults=merge(c)
      val epoch=UUID.randomUUID()
      Sql.exec(c,"INSERT INTO ch_epochs(id,session_id,raw_path) VALUES(?,?,'session.jsonl')",epoch,UUID.randomUUID())
      EpochWriter.append(c,epoch,0,List(Message("m",None,"user","text",None,0)),"",0,0L,0,ResumableSha256())
      assertEquals(merge(c),(EpochWriter.fragmentIndexMergeBytes,EpochWriter.fragmentIndexMergeBytes))
      c.commit()
      assertEquals(merge(c),defaults)
    }
  }}

  test("a maintenance pass empties the fragment index's pending list") { database { (_,db,archive) =>
    archive.ingest("a",request(source(),0,header(3)++pi("u1","s","user","question",1)))
    maintenancePass(db,EpochMaintenance.interval)
    db.transaction(c => assertEquals(Sql.one(c,"SELECT gin_clean_pending_list('ch_epoch_fragments_lower_trgm')")(_.getLong(1)),Some(0L),"pending pages left after the pass"))
  }}

  test("retention drains part receipts and pending parents in statements of at most rowsPerStatement rows before it deletes the attempt; committed attempts keep theirs") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val head=header(3)++pi("u1","s","user","question",1)
    val committed=uploads.open("a",declaration(source(),0,head,None)).uploadId
    send(uploads,"a",committed,part(0,head)); uploads.commit("a",committed)
    val aborted=uploads.open("a",declaration(source(),0,head,None)).uploadId
    uploads.abort("a",aborted)
    val fanOut=EpochMaintenance.rowsPerStatement+1
    db.transaction { c =>
      Sql.exec(c,"INSERT INTO ch_upload_parts(upload,ordinal,sha256,messages_end,raw_end,records_end) SELECT ?,g,'synthetic',0,0,0 FROM generate_series(1,?) g",aborted,fanOut)
      Sql.exec(c,"INSERT INTO ch_upload_parents(upload,parent_key) SELECT ?,sha256(g::text::bytea) FROM generate_series(1,?) g",aborted,fanOut)
      Sql.exec(c,"UPDATE ch_uploads SET terminal_at=terminal_at-?::bigint*interval '1 second'",Uploads.retention.toSeconds+1)
      Sql.exec(c,"CREATE TABLE ch_test_deleted(relation text,count bigint)")
      Sql.exec(c,"CREATE FUNCTION ch_test_count_deleted() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO ch_test_deleted SELECT TG_TABLE_NAME,count(*) FROM gone; RETURN NULL; END $$")
      List("ch_upload_parts","ch_upload_parents").foreach(table => Sql.exec(c,s"CREATE TRIGGER ch_test_count_deleted AFTER DELETE ON $table REFERENCING OLD TABLE AS gone FOR EACH STATEMENT EXECUTE FUNCTION ch_test_count_deleted()"))
    }
    try {
      maintenancePass(db,EpochMaintenance.interval)
      db.transaction { c =>
        assertEquals(Sql.rows(c,"SELECT id FROM ch_uploads")(_.getObject(1,classOf[UUID])),List(committed))
        assertEquals(Sql.rows(c,"SELECT upload,count(*) FROM ch_upload_parts GROUP BY upload")(r => (r.getObject(1,classOf[UUID]),r.getInt(2))),List((committed,1)))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_upload_parents")(_.getInt(1)),Some(0))
        val deleted=Sql.rows(c,"SELECT relation,max(count),sum(count) FROM ch_test_deleted GROUP BY relation ORDER BY relation")(r => (r.getString(1),r.getLong(2),r.getLong(3)))
        assertEquals(deleted,List(("ch_upload_parents",EpochMaintenance.rowsPerStatement.toLong,fanOut.toLong),("ch_upload_parts",EpochMaintenance.rowsPerStatement.toLong,fanOut.toLong)))
      }
    } finally db.transaction { c => Sql.exec(c,"DROP TABLE ch_test_deleted"); Sql.exec(c,"DROP FUNCTION ch_test_count_deleted() CASCADE") }
  }}

  test("a request waiting for its source's lock while retention deletes its attempt is answered not-found") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val identity=source()
    val id=uploads.open("a",declaration(identity,0,header(3),None)).uploadId
    uploads.abort("a",id)
    maintenancePass(db,EpochMaintenance.interval)
    db.transaction(c => Sql.exec(c,"UPDATE ch_uploads SET terminal_at=terminal_at-?::bigint*interval '1 second' WHERE id=? AND cleaned",Uploads.retention.toSeconds+1,id))
    val pool=Executors.newSingleThreadExecutor()
    try {
      val status=db.transaction { held =>
        Sql.lock(held,s"ingest:a:${Uploads.sourceKey(identity)}")
        val status=pool.submit(new Callable[String] { def call(): String = code(uploads.status("a",id)) })
        awaitBlocked(db,"SELECT pg_advisory_xact_lock")
        maintenancePass(db,EpochMaintenance.interval)
        db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_uploads WHERE id=?",id)(_.getInt(1)),Some(0),"retention deleted the attempt"))
        status
      }
      assertEquals(status.get(10,TimeUnit.SECONDS),"not-found")
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(10,TimeUnit.SECONDS)) }
  }}

  test("the down-script refuses without its confirmation and changes nothing; applied, it deletes all staging and the upload tables and keeps the revisions uploads committed") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val identity=source()
    val head=header(3)++pi("u1","s","user","question",1); val delta=pi("a1","u1","assistant","answer",2); val next=pi("u2","a1","user","next",3)
    val id=archive.ingest("a",request(identity,0,head)).sessionId
    val committed=uploads.open("a",declaration(identity,1,head++delta,Some(head))).uploadId
    send(uploads,"a",committed,part(0,delta)); uploads.commit("a",committed)
    // A live append staged in the head's epoch, and a live replacement of a new source in an epoch of its own.
    val live=uploads.open("a",declaration(identity,2,head++delta++next,Some(head++delta))).uploadId
    send(uploads,"a",live,part(0,next))
    val fresh=uploads.open("a",declaration(source(),0,head,None)).uploadId
    send(uploads,"a",fresh,part(0,head))
    val script=java.nio.file.Path.of("scripts","down-025-uploads.sql")
    val name=config.jdbcUrl.drop(config.jdbcUrl.lastIndexOf('/')+1)
    def run(variables: (String,String)*): (Int,List[String]) = {
      val psql=java.nio.file.Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
      val address=config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
      val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),"PGUSER"->config.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->name)
      val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1")++variables.flatMap((key,value) => List("-v",s"$key=$value"))++List("-f",script.toString),sys.env,connection,CheckChild.limit)
      (ran.exit,ran.out.linesIterator.toList)
    }
    def uploadRows(): Option[Int] = db.transaction { c =>
      Option.when(Sql.one(c,"SELECT to_regclass('ch_uploads') IS NOT NULL")(_.getBoolean(1)).get)(Sql.one(c,"SELECT count(*) FROM ch_uploads")(_.getInt(1)).get)
    }
    try {
      val (preflightExit,preflight)=run()
      assertEquals((preflightExit,preflight.last),(0,"DOWN025.result|preflight-complete"))
      val printed=preflight.map(_.split('|')).collect { case Array(key,value) => key->value }.toMap
      assertEquals(List("live","ended_with_staging","committed_kept_as_revisions").map(key => printed(s"DOWN025.uploads.$key")),List("2","0","1"))
      assertEquals(List("epochs_without_revision","messages","records").map(key => printed(s"DOWN025.staged.$key")),List("1","2","3"))
      val (dryExit,dry)=run("mode"->"dry-run")
      assertEquals((dryExit,dry.last,uploadRows()),(0,"DOWN025.result|dry-run-complete",Some(3)))
      val confirmed=List("mode"->"apply","apply_irreversible"->"yes","confirm_database"->name)
      val (refusedExit,refused)=run((confirmed:+("expect_plan"->"stale"))*)
      assertEquals((refusedExit,refused.last),(3,"DOWN025.result|refused-unconfirmed"))
      assertEquals(uploadRows(),Some(3),"nothing changed")
      val (appliedExit,applied)=run((confirmed:+("expect_plan"->printed("DOWN025.plan")))*)
      assertEquals((appliedExit,applied.last),(0,"DOWN025.result|applied"),applied.mkString("\n"))
      assertEquals(uploadRows(),None)
      db.transaction { c =>
        assertEquals(Sql.rows(c,"SELECT message_id FROM ch_epoch_messages ORDER BY position")(_.getString(1)),List("u1","a1"))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_epochs")(_.getInt(1)),Some(1))
        assertEquals(Sql.one(c,"SELECT count(*) FROM information_schema.columns WHERE table_name='ch_epochs' AND column_name='tail_upload'")(_.getInt(1)),Some(0))
      }
      assertEquals(archive.messages("a",id,0,100,None).messages.map(_.id),List("u1","a1"))
    } finally db.initialize()
    assertEquals(archive.ingest("a",request(identity,2,head++delta++next)).revision,3,"an append where the staging was")
  }}

  /** The production routes on the suite's database, with an Ingest bearer token of owner a. */
  private def routes(config: Config)(f: (HttpApp[IO],SnapshotAdmissionGraph,String) => IO[Unit]): Unit = database { (_,_,_) =>
    val production: Module=_root_.chronicle.plugins.ChroniclePlugin
    val module=production.overriddenBy(new ModuleDef { make[Config].fromValue(config); make[Client[IO]].fromValue(Client.fromHttpApp[IO](HttpApp.notFound[IO])); make[SnapshotAdmissionGraph] })
    ChronicleInjector().produceGet[SnapshotAdmissionGraph](module).use { graph => for {
      token <- IO.blocking {
        graph.services.database.transaction(x => { Sql.exec(x,"TRUNCATE ch_tokens,ch_mutations CASCADE"); () })
        val auth=new Auth(graph.services.database,config); val (_,cookie)=auth.login(LoginRequest("a","synthetic"))
        auth.mutate(auth.browser(cookie),ClientEnvelope(UUID.randomUUID(),Operation.MintToken("uploads",List(Scope.Ingest)))).asInstanceOf[Result.Token].result.secret.get
      }
      ws <- WebSocketBuilder2[IO]
      gate <- Semaphore[IO](2)
      _ <- f(graph.services.http.routes(ws,gate).orNotFound,graph,token)
    } yield () }.unsafeRunSync()
  }
  private def httpRequest(method: Method,path: String,token: String,body: String): Request[IO] =
    Request[IO](method,Uri.unsafeFromString(path)).withEntity(body).putHeaders(Header.Raw(CIString("Authorization"),s"Bearer $token"))
  private def call(app: HttpApp[IO],request: Request[IO]): IO[(Status,String)] = app(request).flatMap(response => response.as[String].map(response.status -> _))
  private def failure(answer: (Status,String)): (Status,String) = answer._1 -> Wire.decode(Failure.codecJson,Wire.parse(answer._2)).code

  test("the probe answers the limits; every body above its bound is refused before it is read; unknown attempts and paths answer a Failure; /api/ingest is busy while an upload is live") {
    val config=Fixtures.config()
    routes(config) { (app,_,token) =>
      val identity=source(); val content=header(3)++pi("u1","s","user","question",1)
      val open=Wire.encode(UploadOpen.codecJson,declaration(identity,0,content,None)).noSpaces
      for {
        probe <- call(app,httpRequest(Method.GET,"/api/ingest/uploads",token,""))
        opened <- call(app,httpRequest(Method.POST,"/api/ingest/uploads",token,open))
        id=Wire.decode(UploadState.codecJson,Wire.parse(opened._2)).uploadId
        unread=(method: Method,path: String,bound: Long) => call(app,httpRequest(method,path,token,"").withBodyStream(fs2.Stream.raiseError[IO](new Exception("body must not be read")))
          .putHeaders(Header.Raw(CIString("Content-Length"),(bound+1).toString)))
        refused <- List((Method.GET,"/api/ingest/uploads",0L),(Method.POST,"/api/ingest/uploads",UploadPolicy.maxOpenBytes.toLong),(Method.GET,s"/api/ingest/uploads/$id",0L),
          (Method.POST,s"/api/ingest/uploads/$id/parts",UploadPolicy.maxLargePartBytes(config)),(Method.POST,s"/api/ingest/uploads/$id/commit",0L),(Method.POST,s"/api/ingest/uploads/$id/abort",0L))
          .traverse { case (method,path,bound) => unread(method,path,bound).map(answer => s"$method $path" -> failure(answer)) }
        unknown <- List(s"/api/ingest/uploads/${UUID.randomUUID()}","/api/ingest/uploads/not-an-id",s"/api/ingest/uploads/$id/other").traverse(path => call(app,httpRequest(Method.GET,path,token,"")).map(failure))
        busy <- call(app,httpRequest(Method.POST,"/api/ingest",token,Wire.encode(IngestRequest.codecJson,request(identity,0,content)).noSpaces))
      } yield {
        assertEquals(probe._1,Status.Ok)
        assertEquals(Wire.decode(UploadLimits.codecJson,Wire.parse(probe._2)),UploadPolicy.limits(config))
        assertEquals(opened._1,Status.Ok)
        refused.foreach { case (label,answer) => assertEquals(answer,(Status.PayloadTooLarge,"too-large"),label) }
        assertEquals(unknown,List.fill(3)((Status.NotFound,"not-found")))
        assertEquals(failure(busy),(Status.Conflict,"upload-busy"))
      }
    }
  }

  test("a 9 MiB record goes alone in a large part through the admission permit; a record over maxRecordBytes is refused as record-too-large, a large part of two records as too-large") {
    val config=Fixtures.config().copy(maxRecordBytes=10L*mebibyte,maxFileBytes=64*mebibyte)
    routes(config) { (app,graph,token) =>
      def record(id: String,bytes: Int): Content = { val text="x"*bytes; Content(List(s"""{"type":"message","id":"$id","text":"$text"}"""),List(Message(id,None,"user",text,None,1))) }
      def opened(content: Content): IO[UUID] =
        call(app,httpRequest(Method.POST,"/api/ingest/uploads",token,Wire.encode(UploadOpen.codecJson,declaration(source(),0,content,None)).noSpaces)).map { answer => assertEquals(answer._1,Status.Ok,answer._2); Wire.decode(UploadState.codecJson,Wire.parse(answer._2)).uploadId }
      def parts(id: UUID,part: UploadPart,read: IO[Unit]): Request[IO] = {
        val body=Wire.encode(UploadPart.codecJson,part).noSpaces.getBytes(UTF_8)
        httpRequest(Method.POST,s"/api/ingest/uploads/$id/parts",token,"").withBodyStream(fs2.Stream.eval(read).drain++fs2.Stream.emits(body).covary[IO])
          .putHeaders(Header.Raw(CIString("Content-Length"),body.length.toString))
      }
      val large=record("large",9*mebibyte)
      val oversized=header(3)++record("oversized",10*mebibyte+1)
      val twoRecords=header(3)++record("one",5*mebibyte)++Content(record("two",5*mebibyte).lines,Nil)
      for {
        id <- opened(header(3)++large)
        first <- call(app,parts(id,part(0,header(3)),IO.unit))
        read <- Deferred[IO,Unit]
        inside <- Deferred[IO,Unit]
        release <- Deferred[IO,Unit]
        holder <- graph.admission.claim(inside.complete(()) *> release.get).start
        _ <- inside.get.timeout(10.seconds)
        sending <- call(app,parts(id,part(1,large),read.complete(()).void)).start
        _ <- (IO.cede *> graph.admission.waiting).iterateUntil(_==1L).timeout(10.seconds)
        early <- read.tryGet
        _ <- release.complete(()) *> holder.joinWithNever.timeout(10.seconds)
        accepted <- sending.joinWithNever.timeout(60.seconds)
        committed <- call(app,httpRequest(Method.POST,s"/api/ingest/uploads/$id/commit",token,""))
        tooLargeRecord <- opened(oversized).flatMap(other => call(app,parts(other,part(0,oversized),IO.unit)))
        twoInOne <- opened(twoRecords).flatMap(other => call(app,parts(other,part(0,twoRecords),IO.unit)))
      } yield {
        assertEquals(first._1,Status.Ok,first._2)
        assertEquals(early,None,"the body of a waiting large part is not read")
        assertEquals(accepted._1,Status.Ok,accepted._2.take(200))
        assertEquals(Wire.decode(UploadState.codecJson,Wire.parse(accepted._2)).receivedParts,2)
        val receipt=Wire.decode(IngestReceipt.codecJson,Wire.parse(committed._2))
        assertEquals(graph.services.archive.messages("a",receipt.sessionId,0,1,None).messages.map(_.text.length),List(9*mebibyte))
        assertEquals(failure(tooLargeRecord),(Status.PayloadTooLarge,"record-too-large"))
        val message=Wire.decode(Failure.codecJson,Wire.parse(tooLargeRecord._2)).message
        assert(message.contains(s"${oversized.lines(1).length}") && message.contains(s"${10*mebibyte}"),message)
        assertEquals(failure(twoInOne),(Status.PayloadTooLarge,"too-large"))
      }
    }
  }
}
