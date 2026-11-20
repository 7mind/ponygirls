package chronicle

import cats.effect.{Deferred,IO}
import cats.effect.std.Queue
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import distage.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.{Callable,ExecutionException,Executors,TimeUnit}
import scala.concurrent.duration.*
import scala.util.Using

/** The epoch writer of `/api/ingest` on PostgreSQL (append-only ingest spec §3), asserted on its tables. */
final class EpochIngestTest extends munit.FunSuite {
  private def database(f: (Config,Database,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    def reset(): Unit = db.transaction { c => Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_ingest_receipts CASCADE"); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile) }
    try { reset(); f(config,db,new PostgresArchive(db,config,RevisionLayoutPolicy.Epochs)) } finally { reset(); db.close() }
  }
  private val time="2026-01-01T00:00:0%dZ"
  private def source(format: SourceFormat=SourceFormat.Pi): SourceIdentity = SourceIdentity(UUID.randomUUID().toString,"native",format,"session",None)
  private def request(identity: SourceIdentity,expected: Int,lines: List[String],messages: List[Message]): IngestRequest = {
    val raw=lines.map(_+"\n").mkString
    Fixtures.snapshot().copy(source=identity,expectedRevision=expected,digest=Wire.hash(raw),messages=messages,files=List(RawFile("session.jsonl",Wire.hash(raw),raw)))
  }
  private def header(version: Int): String = s"""{"type":"session","id":"s","version":$version,"timestamp":"2026-01-01T00:00:00Z"}"""
  /** A Pi message record and its message. */
  private def pi(id: String,parent: String,role: String,text: String,record: Int): (String,Message) =
    (Json.obj("type"->Json.fromString("message"),"id"->Json.fromString(id),"parentId"->Json.fromString(parent),"timestamp"->Json.fromString(time.format(record)),
      "message"->Json.obj("role"->Json.fromString(role),"content"->Json.arr(Json.obj("type"->Json.fromString("text"),"text"->Json.fromString(text))))).noSpaces,
      Message(id,Some(parent),role,text,Some(time.format(record)),record))
  private def session(identity: SourceIdentity,expected: Int,first: String,records: List[(String,Message)]): IngestRequest =
    request(identity,expected,first::records.map(_._1),records.map(_._2))
  private def epochOf(c: Connection,id: UUID,revision: Int): Option[UUID] = Sql.one(c,"SELECT epoch FROM ch_revisions WHERE session_id=? AND revision=?",id,revision)(r => Option(r.getObject(1,classOf[UUID]))).get
  private def candidates(c: Connection,epoch: UUID): String = Sql.one(c,"SELECT candidates FROM ch_epochs WHERE id=?",epoch)(_.getString(1)).get
  /** Every row of an epoch, by table, in key order. */
  private def rows(c: Connection,epoch: UUID): Map[String,List[String]] = Map(
    "messages"->Sql.rows(c,"SELECT concat_ws(' ',position,message_id,md5(value::text)) FROM ch_epoch_messages WHERE epoch=? ORDER BY position",epoch)(_.getString(1)),
    "raw"->Sql.rows(c,"SELECT concat_ws(' ',byte_offset,octet_length(content),md5(content)) FROM ch_epoch_raw WHERE epoch=? ORDER BY byte_offset",epoch)(_.getString(1)),
    "records"->Sql.rows(c,"SELECT concat_ws(' ',record_index,encode(record_key,'hex')) FROM ch_epoch_records WHERE epoch=? ORDER BY record_index,record_key",epoch)(_.getString(1)),
    "fragments"->Sql.rows(c,"SELECT concat_ws(' ',position,part,md5(value),head_candidate) FROM ch_epoch_fragments WHERE epoch=? ORDER BY position,part",epoch)(_.getString(1)))
  private def raw(c: Connection,id: UUID,revision: Int): String =
    Sql.one(c,"SELECT coalesce(string_agg(w.content,'' ORDER BY w.byte_offset),'') FROM ch_revisions r JOIN ch_epoch_raw w ON w.epoch=r.epoch AND w.byte_offset<r.raw_bytes WHERE r.session_id=? AND r.revision=?",id,revision)(_.getString(1)).get
  private def messageIds(c: Connection,id: UUID,revision: Int): List[String] =
    Sql.rows(c,"SELECT m.message_id FROM ch_revisions r JOIN ch_epoch_messages m ON m.epoch=r.epoch AND m.position<r.message_count WHERE r.session_id=? AND r.revision=? ORDER BY m.position",id,revision)(_.getString(1))
  private def sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.getBytes(UTF_8)).map(b => f"${b & 255}%02x").mkString

  test("a Pi append writes only the delta, an equal revision writes no epoch rows, and an epoch revision of another lexical version refuses the start") { database { (_,db,archive) =>
    val identity=source()
    val u1=pi("u1","s","user","first question",1)
    val first=session(identity,0,header(3),List(u1))
    val out=archive.ingest("a",first)
    // Two lines of 700,000 bytes cannot share a 1 MiB segment; the last small line joins the second.
    val delta=List(pi("a1","u1","assistant","x"*700000,2),pi("u2","a1","user","y"*700000,3),pi("a2","u2","assistant","Unicode Σ answer",4))
    val second=session(identity,1,header(3),u1::delta)
    val (epoch,before)=db.transaction { c => val epoch=epochOf(c,out.sessionId,1).get; (epoch,rows(c,epoch)) }
    assertEquals(archive.ingest("a",second).revision,2)
    db.transaction { c =>
      assertEquals(epochOf(c,out.sessionId,2),Some(epoch))
      val after=rows(c,epoch)
      before.foreach { case (table,old) => assertEquals(after(table).take(old.size),old,table) }
      val added=after.map((table,all) => table->all.drop(before(table).size))
      val firstBytes=first.files.head.content.getBytes(UTF_8).length.toLong
      val lineBytes=delta.map(_._1.getBytes(UTF_8).length+1L)
      assertEquals(added("messages").map(_.split(' ').take(2).mkString(" ")),List("1 a1","2 u2","3 a2"))
      assertEquals(added("raw").map(_.split(' ').take(2).map(_.toLong).toList),List(List(firstBytes,lineBytes(0)),List(firstBytes+lineBytes(0),lineBytes(1)+lineBytes(2))))
      assertEquals(added("records"),List("a1","u2","a2").zipWithIndex.map((id,index) => s"${index+2} ${sha256(id)}"))
      assertEquals(added("fragments").map(_.split(' ').head.toInt).distinct,List(1,2,3))
      assertEquals(raw(c,out.sessionId,2),second.files.head.content)
      val content=second.files.head.content.getBytes(UTF_8)
      val expected=(4,5,content.length.toLong,second.messages.map(m => Wire.encode(Message.codecJson,m).noSpaces.getBytes(UTF_8).length.toLong).sum,
        second.messages.map(m => (m.text.getBytes(UTF_8).length+2044L)/2045).sum,ResumableSha256().update(content).state.toList,MessageChain.extend(MessageChain.initial,second.messages).toList,time.format(4))
      def columns(revision: Int) = Sql.one(c,"SELECT message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain,message_time FROM ch_revisions WHERE session_id=? AND revision=?",out.sessionId,revision) { r =>
        (r.getInt(1),r.getInt(2),r.getLong(3),r.getLong(4),r.getLong(5),r.getBytes(6).toList,r.getBytes(7).toList,r.getString(8))
      }.get
      assertEquals(columns(2),expected)
      assertEquals(Sql.one(c,"SELECT envelope FROM ch_revisions WHERE session_id=? AND revision=2",out.sessionId)(r => Wire.parse(r.getString(1))).get,
        Wire.encode(IngestRequest.codecJson,second).mapObject(_.remove("messages").remove("files")))
      assertEquals(Sql.one(c,"SELECT message_count,last_timestamp FROM ch_revision_info WHERE session_id=? AND revision=2",out.sessionId)(r => (r.getInt(1),r.getString(2))),Some((4,time.format(4))))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_messages WHERE session_id=?",out.sessionId)(_.getInt(1)),Some(0))
      assertEquals(archive.ingest("a",second.copy(requestId=UUID.randomUUID(),expectedRevision=2)).revision,3)
      assertEquals(rows(c,epoch),after,"an equal revision writes no epoch rows")
      assertEquals(epochOf(c,out.sessionId,3),Some(epoch)); assertEquals(columns(3),expected)
    }
    db.transaction(c => Sql.exec(c,"UPDATE ch_revision_info SET lexical_version=0 WHERE session_id=? AND revision=3",out.sessionId))
    assertEquals(intercept[DomainError](db.initialize()).code,"migration-required")
    db.transaction(c => Sql.exec(c,"UPDATE ch_revision_info SET lexical_version=? WHERE session_id=? AND revision=3",ArchiveProjection.lexicalVersion,out.sessionId))
  }}

  test("a revision that does not extend the head starts a new epoch and supersedes the head's: Codex dedup, redaction change, Pi v2 to v3 rewrite, Historian") { database { (_,db,archive) =>
    val codex=source(SourceFormat.Codex)
    val meta="""{"type":"session_meta","payload":{"id":"codex"}}"""
    val event="""{"type":"event_msg","payload":{"type":"user_message","message":"run the tests"}}"""
    val responses=List("""{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"run the tests"}]}}""",
      """{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"all tests pass"}]}}""")
    // The collector drops an event message once its response item appears: the raw grows, the messages do not extend.
    val codexRevisions=List(request(codex,0,List(meta,event),List(Message("event-1",None,"user","run the tests",None,1))),
      request(codex,1,List(meta,event)++responses,List(Message("response-2",None,"user","run the tests",None,2),Message("response-3",None,"assistant","all tests pass",None,3))))
    val redacted=source(); val u1=pi("u1","s","user","token sk-live-1234",1); val u1Redacted=pi("u1","s","user","token [redacted]",1)
    val redactionRevisions=List(session(redacted,0,header(3),List(u1)),session(redacted,1,header(3),List(u1Redacted,pi("a1","u1","assistant","noted",2))))
    val rewritten=source(); val v2=pi("u1","s","user","question",1)
    val rewriteRevisions=List(session(rewritten,0,header(2),List(v2)),session(rewritten,1,header(3),List(v2,pi("a1","u1","assistant","answer",2))))
    val historian=HistorianFixtures.snapshot()
    List(codexRevisions,redactionRevisions,rewriteRevisions,List(historian,HistorianFixtures.next(historian))).foreach { revisions =>
      val id=archive.ingest("a",revisions.head).sessionId
      val (first,before)=db.transaction { c => val epoch=epochOf(c,id,1).get; (epoch,rows(c,epoch)) }
      assertEquals(archive.ingest("a",revisions(1)).revision,2)
      db.transaction { c =>
        val second=epochOf(c,id,2).get
        assertNotEquals(second,first)
        assertEquals((candidates(c,first),candidates(c,second)),("prune","current"))
        assertEquals(rows(c,first),before)
        assertEquals(messageIds(c,id,2),revisions(1).messages.map(_.id))
        assertEquals(raw(c,id,2),revisions(1).files.head.content)
        assertEquals(Sql.one(c,"SELECT min(byte_offset) FROM ch_epoch_raw WHERE epoch=?",second)(_.getLong(1)),Some(0L))
      }
    }
  }}

  test("several files and a raw without a final newline keep the legacy layout; an unreferenced record id with an escaped NUL is stored as its key") { database { (_,db,archive) =>
    val identity=source(); val u1=pi("u1","s","user","question",1); val a1=pi("a1","u1","assistant","answer",2)
    val first=session(identity,0,header(3),List(u1))
    val id=archive.ingest("a",first).sessionId
    val unterminated={ val raw=List(header(3),u1._1,a1._1).mkString("\n"); first.copy(requestId=UUID.randomUUID(),expectedRevision=1,digest=Wire.hash(raw),messages=List(u1._2,a1._2),files=List(RawFile("session.jsonl",Wire.hash(raw),raw))) }
    archive.ingest("a",unterminated)
    val files=List(RawFile("session.jsonl",Wire.hash(header(3)+"\n"),header(3)+"\n"),RawFile("next.jsonl",Wire.hash(u1._1+"\n"),u1._1+"\n"))
    archive.ingest("a",first.copy(requestId=UUID.randomUUID(),expectedRevision=2,digest=Wire.hash(files.map(_.content).mkString),files=files))
    archive.ingest("a",session(identity,3,header(3),List(u1,a1)))
    db.transaction { c =>
      val epochs=(1 to 4).map(epochOf(c,id,_)).toList
      assertEquals(epochs.map(_.isDefined),List(true,false,false,true))
      assertNotEquals(epochs(3),epochs(0))
      assertEquals(epochs.flatten.map(candidates(c,_)),List("prune","current"))
      assertEquals(Sql.rows(c,"SELECT r.revision,count(m.position) FROM ch_revisions r LEFT JOIN ch_messages m ON m.session_id=r.session_id AND m.revision=r.revision WHERE r.session_id=? AND r.snapshot IS NOT NULL GROUP BY r.revision ORDER BY r.revision",id)(r => (r.getInt(1),r.getInt(2))),List((2,2),(3,1)))
    }
    val escaped="""{"type":"custom","id":"rec\u0000ord"}"""
    val nul=archive.ingest("a",request(source(),0,List(header(3),escaped,u1._1),List(u1._2.copy(recordIndex=2))))
    db.transaction { c =>
      val epoch=epochOf(c,nul.sessionId,1).get
      assertEquals(rows(c,epoch)("records"),List(s"0 ${sha256("s")}",s"1 ${sha256("rec\u0000ord")}",s"2 ${sha256("u1")}"))
    }
  }}

  test("an append continues the head's stored midstate and refuses a state that does not reproduce the request digest") { database { (_,db,archive) =>
    val identity=source(); val u1=pi("u1","s","user","question",1)
    val first=session(identity,0,header(3),List(u1))
    val id=archive.ingest("a",first).sessionId
    val wrong=ResumableSha256().update(first.files.head.content.reverse.getBytes(UTF_8)).state
    db.transaction { c =>
      Sql.exec(c,"ALTER TABLE ch_revisions DISABLE TRIGGER ch_immutable_revision")
      Using.resource(c.prepareStatement("UPDATE ch_revisions SET raw_state=? WHERE session_id=?")) { s => s.setBytes(1,wrong); s.setObject(2,id); s.executeUpdate() }
      Sql.exec(c,"ALTER TABLE ch_revisions ENABLE TRIGGER ch_immutable_revision")
    }
    val before=db.transaction(c => rows(c,epochOf(c,id,1).get))
    assertEquals(intercept[DomainError](archive.ingest("a",session(identity,1,header(3),List(u1,pi("a1","u1","assistant","answer",2))))).code,"internal")
    db.transaction { c =>
      assertEquals(rows(c,epochOf(c,id,1).get),before)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revisions WHERE session_id=?",id)(_.getInt(1)),Some(1))
    }
  }}

  test("receipts replay, a request ID bound to other content conflicts and the expected revision is checked") { database { (_,db,archive) =>
    val identity=source(); val u1=pi("u1","s","user","question",1)
    val first=session(identity,0,header(3),List(u1))
    val receipt=archive.ingest("a",first)
    val before=db.transaction(c => rows(c,epochOf(c,receipt.sessionId,1).get))
    assertEquals(archive.ingest("a",first),receipt)
    val second=session(identity,1,header(3),List(u1,pi("a1","u1","assistant","answer",2)))
    assertEquals(intercept[DomainError](archive.ingest("a",second.copy(requestId=first.requestId))).code,"conflict")
    assertEquals(intercept[DomainError](archive.ingest("a",second.copy(expectedRevision=0))).code,"conflict")
    db.transaction { c =>
      assertEquals(rows(c,epochOf(c,receipt.sessionId,1).get),before)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revisions WHERE session_id=?",receipt.sessionId)(_.getInt(1)),Some(1))
    }
    assertEquals(archive.ingest("a",second).revision,2)
  }}

  test("a purge racing an append completes without waiting for it, and the append then ends gone") { database { (config,db,archive) =>
    val identity=source(); val u1=pi("u1","s","user","question",1)
    val id=archive.ingest("a",session(identity,0,header(3),List(u1))).sessionId
    val auth=new Auth(db,config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val park=1729020001L
    db.transaction { c =>
      Sql.exec(c,s"CREATE FUNCTION ch_test_park_info() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN PERFORM pg_advisory_xact_lock_shared($park); RETURN NEW; END $$$$")
      Sql.exec(c,"CREATE TRIGGER ch_test_park_info BEFORE INSERT ON ch_revision_info FOR EACH ROW EXECUTE FUNCTION ch_test_park_info()")
    }
    val pool=Executors.newFixedThreadPool(2)
    try {
      val appending=db.transaction { held =>
        Sql.exec(held,"SELECT pg_advisory_xact_lock(?)",park)
        // Parked after its epoch rows and revision row, before its switch: it holds key-share locks on the epoch and the source.
        val appending=pool.submit(new Callable[IngestReceipt] { def call(): IngestReceipt = archive.ingest("a",session(identity,1,header(3),List(u1,pi("a1","u1","assistant","answer",2)))) })
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
        def parked: Boolean = db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO ch_revision_info%')")(_.getBoolean(1)).get)
        while(!parked && !appending.isDone && System.nanoTime()<deadline) Thread.onSpinWait()
        assert(parked,"the append must park at its info row")
        val purging=pool.submit(new Callable[Unit] { def call(): Unit = { auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(id))); () } })
        // Completion while the append still holds its locks is the proof that purge does not wait for it.
        purging.get(5,TimeUnit.SECONDS)
        appending
      }
      val failure=intercept[ExecutionException](appending.get(5,TimeUnit.SECONDS)).getCause
      assertEquals(failure.asInstanceOf[DomainError].code,"gone")
      db.transaction { c =>
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revisions WHERE session_id=?",id)(_.getInt(1)),Some(0))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_epochs e JOIN ch_epoch_messages m ON m.epoch=e.id WHERE e.session_id=?",id)(_.getInt(1)),Some(1),"purge leaves the epoch to the maintenance")
      }
    } finally {
      pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS))
      db.transaction(c => Sql.exec(c,"DROP FUNCTION ch_test_park_info() CASCADE"))
    }
  }}

  test("a purge that commits between the ingest's source read and its head-revision lookup ends the ingest gone, in either layout") { database { (config,db,epochs) =>
    val auth=new Auth(db,config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val pool=Executors.newFixedThreadPool(2)
    try List(new PostgresArchive(db,config,RevisionLayoutPolicy.Legacy),epochs).foreach { archive =>
      val identity=source(); val u1=pi("u1","s","user","question",1)
      val id=archive.ingest("a",session(identity,0,header(3),List(u1))).sessionId
      val ingesting=db.transaction { held =>
        // The head lookup is the ingest's first statement that reads ch_epochs: it waits there, after its source read.
        Sql.exec(held,"LOCK TABLE ch_epochs IN ACCESS EXCLUSIVE MODE")
        val ingesting=pool.submit(new Callable[IngestReceipt] { def call(): IngestReceipt = archive.ingest("a",session(identity,1,header(3),List(u1,pi("a1","u1","assistant","answer",2)))) })
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
        def parked: Boolean = db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT r.epoch,e.raw_path%')")(_.getBoolean(1)).get)
        while(!parked && !ingesting.isDone && System.nanoTime()<deadline) Thread.onSpinWait()
        assert(parked,"the ingest must wait at its head-revision lookup")
        pool.submit(new Callable[Unit] { def call(): Unit = { auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(id))); () } }).get(5,TimeUnit.SECONDS)
        ingesting
      }
      val failure=intercept[ExecutionException](ingesting.get(5,TimeUnit.SECONDS)).getCause
      assertEquals(failure match { case error: DomainError => error.code; case other => other.toString },"gone")
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)) }
  }}

  test("maintenance prunes superseded epochs and deletes purged sources' epochs one interval after the last pass, and a failed pass does not end it") { database { (config,db,archive) =>
    val identity=source(); val u1=pi("u1","s","user","question",1)
    val rewritten=archive.ingest("a",session(identity,0,header(2),List(u1))).sessionId
    archive.ingest("a",session(identity,1,header(3),List(u1)))
    val purgedSource=source()
    val purged=archive.ingest("a",session(purgedSource,0,header(3),List(u1))).sessionId
    val auth=new Auth(db,config); auth.mutate(auth.browser(auth.login(LoginRequest("a","synthetic"))._2),ClientEnvelope(UUID.randomUUID(),Operation.Purge(purged)))
    val (superseded,head,removed)=db.transaction(c => (epochOf(c,rewritten,1).get,epochOf(c,rewritten,2).get,Sql.one(c,"SELECT id FROM ch_epochs WHERE session_id=?",purged)(_.getObject(1,classOf[UUID])).get))
    def state(): (String,Int,String,Int,Int) = db.transaction { c =>
      def candidatesOf(epoch: UUID) = Sql.one(c,"SELECT count(*) FILTER (WHERE head_candidate) FROM ch_epoch_fragments WHERE epoch=?",epoch)(_.getInt(1)).get
      (candidates(c,superseded),candidatesOf(superseded),candidates(c,head),candidatesOf(head),Sql.one(c,"SELECT count(*) FROM ch_epochs WHERE id=?",removed)(_.getInt(1)).get+rows(c,removed).values.map(_.size).sum)
    }
    val initial=state()
    assertEquals(initial,("prune",1,"current",1,6))
    val interval=7.seconds
    (for {
      sleeps <- Queue.unbounded[IO,(FiniteDuration,Deferred[IO,Unit])]
      sleep=(duration: FiniteDuration) => Deferred[IO,Unit].flatMap(gate => sleeps.offer(duration -> gate) *> gate.get)
      // The loop asks for its next interval once a pass ended; only a loop that stopped leaves this wait unanswered.
      next=sleeps.take.timeout(10.seconds)
      _ <- EpochMaintenance.resource(db,logstage.IzLogger(),interval,sleep).use { _ =>
        for {
          (waited,elapsed) <- next
          _ <- IO { assertEquals(waited,interval); assertEquals(state(),initial,"nothing before the interval") }
          _ <- IO(db.transaction { c =>
            Sql.exec(c,"CREATE FUNCTION ch_test_refuse_pruned() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused by the test'; END $$")
            Sql.exec(c,"CREATE TRIGGER ch_test_refuse_pruned BEFORE UPDATE ON ch_epochs FOR EACH ROW WHEN (NEW.candidates='pruned') EXECUTE FUNCTION ch_test_refuse_pruned()")
          })
          _ <- elapsed.complete(())
          (_,failedPassOver) <- next
          _ <- IO { assertEquals(state(),("prune",0,"current",1,6),"the failed pass stopped at marking the epoch pruned") }
          _ <- IO(db.transaction(c => Sql.exec(c,"DROP FUNCTION ch_test_refuse_pruned() CASCADE")))
          _ <- failedPassOver.complete(())
          (_,_) <- next
          _ <- IO { assertEquals(state(),("pruned",0,"current",1,0)) }
        } yield ()
      }
    } yield ()).unsafeRunSync()
    db.transaction { c =>
      assertEquals(rows(c,superseded)("messages").size,1,"pruning keeps the superseded revisions' content")
      assertEquals(Sql.one(c,"SELECT tombstone FROM ch_sources WHERE id=?",purged)(_.getBoolean(1)),Some(true))
    }
  }}

  test("production wiring: new revisions are stored in epochs and epoch maintenance runs every 60 s") { database { (config,db,_) =>
    def wired[A: Tag](module: Module): A = ChronicleInjector().produceGet[A](module).use(IO.pure).unsafeRunSync()
    val production: Module=_root_.chronicle.plugins.ChroniclePlugin
    assertEquals(wired[RevisionLayoutPolicy](production),RevisionLayoutPolicy.Epochs)
    assertEquals(wired[EpochMaintenance](production.overriddenBy(new ModuleDef { make[Database].fromValue(db) })).interval,60.seconds)
    val id=new PostgresArchive(db,config).ingest("a",session(source(),0,header(3),List(pi("u1","s","user","question",1)))).sessionId
    db.transaction(c => assert(epochOf(c,id,1).isDefined))
  }}
}
