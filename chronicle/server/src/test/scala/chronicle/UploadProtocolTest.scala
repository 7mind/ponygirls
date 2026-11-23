package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.sql.Connection
import java.util.UUID

/** Synthetic sessions for part uploads: raw lines with the messages derived from them, declarations and parts. */
private[chronicle] object UploadFixtures {
  /** A revision's raw lines and messages. */
  final case class Content(lines: List[String],messages: List[Message]) {
    def raw: String = lines.map(_+"\n").mkString
    def ++(more: Content): Content = Content(lines++more.lines,messages++more.messages)
    def base: UploadBase = UploadBase(Wire.hash(raw),raw.getBytes(UTF_8).length.toLong,messages.size,EpochWriter.hex(MessageChain.extend(MessageChain.initial,messages)))
  }
  private val time="2026-01-01T00:00:%02dZ"
  def source(format: SourceFormat=SourceFormat.Pi): SourceIdentity = SourceIdentity(UUID.randomUUID().toString,"native",format,"session",None)
  def header(version: Int): Content = Content(List(s"""{"type":"session","id":"s","version":$version,"timestamp":"2026-01-01T00:00:00Z"}"""),Nil)
  /** A Pi message record and its message. */
  def pi(id: String,parent: String,role: String,text: String,record: Int): Content =
    Content(List(Json.obj("type"->Json.fromString("message"),"id"->Json.fromString(id),"parentId"->Json.fromString(parent),"timestamp"->Json.fromString(time.format(record)),
      "message"->Json.obj("role"->Json.fromString(role),"content"->Json.arr(Json.obj("type"->Json.fromString("text"),"text"->Json.fromString(text))))).noSpaces),
      List(Message(id,Some(parent),role,text,Some(time.format(record)),record)))
  def declaration(identity: SourceIdentity,expected: Int,content: Content,base: Option[Content],requestId: UUID=UUID.randomUUID()): UploadOpen = {
    val whole=content.base
    UploadOpen(requestId,identity,expected,"session.jsonl",base.map(_.base),whole.digest,whole.rawBytes,whole.messageCount,whole.messageChain,Completion.Quiescent,false,Fixtures.snapshot().metadata)
  }
  def part(ordinal: Int,content: Content): UploadPart = UploadPart(ordinal,UploadValidation.partDigest(content.raw.getBytes(UTF_8),content.messages),content.raw,content.messages)
  /** A part as the HTTP route hands it over: with the size of its encoded body. */
  def send(uploads: Uploads,owner: String,id: UUID,part: UploadPart): UploadState =
    uploads.part(owner,id,part,Wire.encode(UploadPart.codecJson,part).noSpaces.getBytes(UTF_8).length.toLong)
  def request(identity: SourceIdentity,expected: Int,content: Content): IngestRequest =
    Fixtures.snapshot().copy(source=identity,expectedRevision=expected,digest=Wire.hash(content.raw),messages=content.messages,files=List(RawFile("session.jsonl",Wire.hash(content.raw),content.raw)))
  def code(f: => Any): String = try { f; "accepted" } catch { case error: DomainError => error.code }
  def epochOf(c: Connection,id: UUID,revision: Int): Option[UUID] = Sql.one(c,"SELECT epoch FROM ch_revisions WHERE session_id=? AND revision=?",id,revision)(r => Option(r.getObject(1,classOf[UUID]))).get
  /** The database of a suite, emptied of sources, epochs and uploads around each case. */
  def database(f: (Config,Database,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); munit.Assertions.assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    def reset(): Unit = db.transaction { c => Sql.exec(c,"TRUNCATE ch_uploads,ch_epochs,ch_sources,ch_ingest_receipts CASCADE"); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile) }
    try { reset(); f(config,db,new PostgresArchive(db,config)) } finally { reset(); db.close() }
  }
}

/** The part-upload protocol (append-only ingest spec §4.6) on PostgreSQL: intents and attempts, parts, commit. */
final class UploadProtocolTest extends munit.FunSuite {
  import UploadFixtures.*
  private def messages(archive: PostgresArchive,id: UUID,revision: Int): List[Message] = archive.messages("a",id,0,100,Some(ContentView(revision,None))).messages
  private def raw(archive: PostgresArchive,id: UUID,revision: Int): String = archive.raw("a",id,Some(revision)).files.map(_.content).mkString
  private def stored(content: Content): List[Message] = content.messages.map(m => m.copy(text=SnapshotProjection.text(m.text)))
  private val mebibyte=1024*1024
  private def verdict(f: => Any): String = try { f; "accepted" } catch {
    case error: DomainError => error.code; case error: java.sql.SQLException => s"SQLSTATE ${error.getSQLState}"; case error: ArithmeticException => error.toString
  }

  test("a new source, an append on the head's epoch, an /api/ingest append after it and a replacement commit through parts and read back whole") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val identity=source()
    // Records with a NUL escape and four-byte characters; the digest of this part as the collector computes it.
    val first=Content(List("""{"type":"session","id":"s"}""","""{"id":"u1","text":"first question λ🐎"}""","""{"id":"a1","text":"nul \u0000 answer"}"""),
      List(Message("u1",Some("s"),"user","first question λ🐎",Some("2026-01-01T00:00:01Z"),1),Message("a1",Some("u1"),"assistant","nul \u0000 answer",None,2)))
    assertEquals(part(0,first).sha256,"476046f27b3ecf606aa70f484e0952afca119a25dbbef8ea75be89a9e470da17")
    val opened=uploads.open("a",declaration(identity,0,first,None))
    assertEquals((opened.phase,opened.append,opened.receivedParts,opened.limits),(UploadPhase.Open,false,0,UploadPolicy.limits(config)))
    assert(opened.expiresInSeconds>3590 && opened.expiresInSeconds<=3600,opened.toString)
    assertEquals(send(uploads,"a",opened.uploadId,part(0,first)).receivedRawBytes,first.raw.getBytes(UTF_8).length.toLong)
    val id=uploads.commit("a",opened.uploadId).sessionId
    assertEquals((messages(archive,id,1),raw(archive,id,1)),(stored(first),first.raw))

    val delta=pi("a2","u2","assistant","second answer",4)++pi("u3","a2","user","third question",5)
    val second=first++pi("u2","a1","user","second question",3)++delta
    val appending=uploads.open("a",declaration(identity,1,second,Some(first)))
    assert(appending.append)
    send(uploads,"a",appending.uploadId,part(0,pi("u2","a1","user","second question",3)))
    val sent=send(uploads,"a",appending.uploadId,part(1,delta))
    assertEquals((sent.receivedParts,sent.receivedMessages,sent.lastPartSha256),(2,3,Some(part(1,delta).sha256)))
    val appended=uploads.commit("a",appending.uploadId)
    assertEquals((appended.sessionId,appended.revision),(id,2))
    val third=second++pi("a3","u3","assistant","third answer",6)
    assertEquals(archive.ingest("a",request(identity,2,third)).revision,3)
    val rewritten=header(3)++pi("u1","s","user","first question, rewritten",1)
    val replacing=uploads.open("a",declaration(identity,3,rewritten,None))
    send(uploads,"a",replacing.uploadId,part(0,rewritten))
    val replaced=uploads.commit("a",replacing.uploadId)
    assertEquals(replaced.revision,4)
    List(first,second,third,rewritten).zipWithIndex.foreach { case (content,index) =>
      assertEquals((messages(archive,id,index+1),raw(archive,id,index+1)),(stored(content),content.raw),s"revision ${index+1}")
    }
    // The same content written by /api/ingest into a new epoch has the columns the upload committed.
    val reference=archive.ingest("b",request(identity,0,second)).sessionId
    db.transaction { c =>
      val epochs=(1 to 4).map(epochOf(c,id,_).get)
      assertEquals(epochs.distinct.size,2,"revisions 1-3 share an epoch, the replacement starts another")
      assertEquals((epochs(2),epochs(3)==epochs(0)),(epochs(0),false))
      assertEquals(Sql.rows(c,"SELECT candidates FROM ch_epochs WHERE id IN(?,?) ORDER BY candidates",epochs(0),epochs(3))(_.getString(1)),List("current","prune"))
      def columns(session: UUID,revision: Int): List[Any] = Sql.one(c,"SELECT message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain,message_time,envelope-'requestId'-'expectedRevision' FROM ch_revisions WHERE session_id=? AND revision=?",session,revision) { r =>
        List(r.getInt(1),r.getInt(2),r.getLong(3),r.getLong(4),r.getLong(5),r.getBytes(6).toList,r.getBytes(7).toList,r.getString(8),Wire.parse(r.getString(9)))
      }.get
      assertEquals(columns(id,2),columns(reference,1))
      assertEquals(Sql.one(c,"SELECT message_count,last_timestamp FROM ch_revision_info WHERE session_id=? AND revision=2",id)(r => (r.getInt(1),r.getString(2))),Some((5,"2026-01-01T00:00:05Z")))
      assertEquals(Sql.one(c,"SELECT revision,state FROM ch_jobs WHERE id=?",replaced.jobId)(r => (r.getInt(1),r.getString(2))),Some((4,"Queued")))
      assertEquals(Sql.rows(c,"SELECT tail_upload FROM ch_epochs WHERE tail_upload IS NOT NULL")(_.getString(1)),Nil,"committed attempts own no staging")
    }
  }}

  test("replayed and out-of-order parts, commit and open replays, abort after the commit, a new attempt after expiry and the revision CAS") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val identity=source()
    val parts=List(header(3)++pi("u1","s","user","question",1),pi("a1","u1","assistant","answer",2),pi("u2","a1","user","next",3))
    val content=parts.reduce(_++_)
    val open=declaration(identity,0,content,None)
    val id=uploads.open("a",open).uploadId
    assertEquals(uploads.open("a",open).uploadId,id,"the live attempt of the intent")
    assertEquals(code(uploads.open("a",open.copy(metadata=open.metadata.copy(title="another declaration")))),"conflict")
    val afterFirst=send(uploads,"a",id,part(0,parts(0)))
    assertEquals(send(uploads,"a",id,part(0,parts(0))),afterFirst,"the last part replayed")
    send(uploads,"a",id,part(1,parts(1)))
    val afterSecond=uploads.status("a",id)
    assertEquals(send(uploads,"a",id,part(0,parts(0))),afterSecond,"an older part replayed")
    assertEquals(code(send(uploads,"a",id,part(0,parts(1)))),"conflict","an accepted ordinal with another sha256")
    assertEquals(code(send(uploads,"a",id,part(3,parts(2)))),"conflict","an ordinal ahead of the next")
    assertEquals(code(send(uploads,"a",id,part(2,pi("u1","s","user","an id taken by part 0",3)))),"invalid","a message id of an earlier part")
    assertEquals(uploads.status("a",id),afterSecond)
    send(uploads,"a",id,part(2,parts(2)))
    val receipt=uploads.commit("a",id)
    assertEquals(uploads.commit("a",id),receipt)
    val committed=uploads.open("a",open)
    assertEquals((committed.uploadId,committed.phase,committed.receipt),(id,UploadPhase.Committed,Some(receipt)))
    assertEquals(uploads.abort("a",id),committed,"an abort after the commit answers the committed state")
    assertEquals(code(send(uploads,"a",id,part(3,pi("a2","u2","assistant","late",4)))),"conflict")
    assertEquals(code(uploads.open("a",declaration(identity,0,content,None))),"conflict","the revision CAS")
    assertEquals(code(uploads.status("b",id)),"not-found","another owner's attempt")

    val next=content++pi("a2","u2","assistant","late answer",4)
    val appendOpen=declaration(identity,1,next,Some(content))
    val expiring=uploads.open("a",appendOpen).uploadId
    db.transaction(c => Sql.exec(c,"UPDATE ch_uploads SET expires_at=clock_timestamp() WHERE id=?",expiring))
    assertEquals(code(send(uploads,"a",expiring,part(0,pi("a2","u2","assistant","late answer",4)))),"upload-expired")
    assertEquals(uploads.status("a",expiring).phase,UploadPhase.Expired)
    val renewed=uploads.open("a",appendOpen)
    assertNotEquals(renewed.uploadId,expiring)
    assertEquals((renewed.phase,renewed.receivedParts),(UploadPhase.Open,0))
    send(uploads,"a",renewed.uploadId,part(0,pi("a2","u2","assistant","late answer",4)))
    assertEquals(uploads.commit("a",renewed.uploadId).revision,2)
    assertEquals(archive.messages("a",receipt.sessionId,0,100,None).messages.map(_.id),List("u1","a1","u2","a2"))
    db.transaction(c => assertEquals(Sql.rows(c,"SELECT attempt,phase FROM ch_uploads WHERE request_id=? ORDER BY attempt",appendOpen.requestId)(r => (r.getInt(1),r.getString(2))),List((1,"Expired"),(2,"Committed"))))
  }}

  test("a base that is not the head is refused at the open; a Codex revision sent as if its head were a prefix ends content-mismatch at the commit") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val codex=source(SourceFormat.Codex)
    val meta="""{"type":"session_meta","payload":{"id":"codex"}}"""
    val event="""{"type":"event_msg","payload":{"type":"user_message","message":"run the tests"}}"""
    val responses=List("""{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"run the tests"}]}}""",
      """{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"all tests pass"}]}}""")
    // The collector drops the event message once its response item appears: the raw grows, the messages do not extend.
    val head=Content(List(meta,event),List(Message("event-1",None,"user","run the tests",None,1)))
    val delta=Content(responses,List(Message("response-2",None,"user","run the tests",None,2),Message("response-3",None,"assistant","all tests pass",None,3)))
    val whole=Content(head.lines++responses,delta.messages)
    val id=archive.ingest("a",request(codex,0,head)).sessionId
    val wrongBase=declaration(codex,1,whole,Some(head))
    assertEquals(code(uploads.open("a",wrongBase.copy(base=wrongBase.base.map(_.copy(messageCount=0))))),"base-mismatch")
    db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_uploads")(_.getInt(1)),Some(0),"no attempt"))
    val asPrefix=uploads.open("a",declaration(codex,1,whole,Some(head)))
    send(uploads,"a",asPrefix.uploadId,part(0,delta))
    assertEquals(code(uploads.commit("a",asPrefix.uploadId)),"content-mismatch")
    assertEquals(uploads.status("a",asPrefix.uploadId).failure,Some("content-mismatch"))
    assertEquals(uploads.status("a",asPrefix.uploadId).phase,UploadPhase.Failed)
    assertEquals(archive.session("a",id).revision,1,"nothing became visible")
    // The collector re-plans it as a replacement under a new request ID.
    val replacing=uploads.open("a",declaration(codex,1,whole,None))
    send(uploads,"a",replacing.uploadId,part(0,whole))
    assertEquals(uploads.commit("a",replacing.uploadId).revision,2)
    assertEquals(archive.messages("a",id,0,100,None).messages.map(_.id),List("response-2","response-3"))
  }}

  test("a parentId introduced by a later part resolves; one that no part introduces ends content-mismatch at the commit") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val identity=source()
    // a1 answers a record that arrives one part later (its id is a raw record id, not a message id).
    val early=header(3)++Content(List("""{"type":"message","id":"a1","parentId":"later"}"""),List(Message("a1",Some("later"),"assistant","answer",None,1)))
    val later=Content(List("""{"type":"compaction","id":"later"}"""),Nil)
    val content=early++later
    val resolving=uploads.open("a",declaration(identity,0,content,None))
    send(uploads,"a",resolving.uploadId,part(0,early))
    db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_upload_parents WHERE upload=?",resolving.uploadId)(_.getInt(1)),Some(1),"pending until a later part"))
    send(uploads,"a",resolving.uploadId,part(1,later))
    assertEquals(uploads.commit("a",resolving.uploadId).revision,1)
    val unresolved=early++Content(List("""{"type":"compaction","id":"other"}"""),Nil)
    val failing=uploads.open("a",declaration(identity,1,unresolved,None))
    send(uploads,"a",failing.uploadId,part(0,early))
    send(uploads,"a",failing.uploadId,part(1,Content(List("""{"type":"compaction","id":"other"}"""),Nil)))
    assertEquals(code(uploads.commit("a",failing.uploadId)),"content-mismatch")
  }}

  test("a raw record id that is not scalar Unicode resolves no parentId, as in SnapshotValidation, wherever it arrives; unreferenced it is accepted") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    // A JSON escape gives the record id a lone surrogate; Java's UTF-8 encoder writes that as "?".
    val lone=Content(List("""{"type":"compaction","id":"\ud800"}"""),Nil)
    def child(record: Int): Content = Content(List(s"""{"type":"message","id":"c$record","parentId":"?"}"""),List(Message(s"c$record",Some("?"),"user","answer",None,record)))
    val scenarios=List(
      ("in the same part",None,List(header(3)++lone++child(2))),
      ("in an earlier part",None,List(header(3)++lone,child(2))),
      ("in a later part",None,List(header(3)++child(1),lone)),
      ("in the base",Some(header(3)++lone),List(child(2))),
      ("unreferenced",None,List(header(3)++lone++pi("u1","s","user","question",2))))
    val verdicts=scenarios.map { case (name,base,parts) =>
      val identity=source()
      val whole=(base.toList++parts).reduce(_++_)
      val expected=base.size
      base.foreach(content => archive.ingest("a",request(identity,0,content)))
      val opened=uploads.open("a",declaration(identity,expected,whole,base))
      parts.zipWithIndex.foreach { case (content,ordinal) => send(uploads,"a",opened.uploadId,part(ordinal,content)) }
      name -> (code(SnapshotValidation.validate(request(identity,expected,whole),config)),code(uploads.commit("a",opened.uploadId)))
    }
    assertEquals(verdicts,scenarios.map(_._1).map(name => name -> (if(name=="unreferenced") ("accepted","accepted") else ("invalid","content-mismatch"))))
  }}

  test("a part that would take the revision's records (its base included), its raw bytes or the attempt's parts past their maximum is too-large before anything of it is written; a revision of exactly the maximum commits") { database { (config,db,archive) =>
    // 4 GiB, the smallest maxFileBytes that holds 2^31 two-byte records.
    val uploads=new Uploads(db,config.copy(maxFileBytes=4L*1024*1024*1024),UploadPolicy.production)
    val maximum=Int.MaxValue
    // The counts 2^31 records or parts would reach (at least 4 GiB of two-byte records), injected into the attempt.
    def inject(id: UUID,column: String,value: Sql.Param): Unit = { db.transaction(c => Sql.exec(c,s"UPDATE ch_uploads SET $column=? WHERE id=?",value,id)); () }
    /** What a refused part leaves as it was: the attempt's state, its part receipts, its epoch's rows and their least record index. */
    def staged(uploads: Uploads,id: UUID): (UploadState,List[Long]) = (uploads.status("a",id).copy(expiresInSeconds=0),db.transaction { c =>
      val epoch=Sql.one(c,"SELECT epoch FROM ch_uploads WHERE id=?",id)(_.getObject(1,classOf[UUID])).get
      Sql.one(c,"SELECT count(*) FROM ch_upload_parts WHERE upload=?",id)(_.getLong(1)).toList++List("ch_epoch_messages","ch_epoch_raw","ch_epoch_records").flatMap(table =>
        Sql.one(c,s"SELECT count(*) FROM $table WHERE epoch=?",epoch)(_.getLong(1)))++Sql.one(c,"SELECT coalesce(min(record_index),0) FROM ch_epoch_records WHERE epoch=?",epoch)(_.getLong(1))
    })
    def refused(uploads: Uploads,id: UUID,part: UploadPart): (String,Boolean) = { val before=staged(uploads,id); (verdict(send(uploads,"a",id,part)),staged(uploads,id)==before) }

    val identity=source()
    val head=header(3)++pi("u1","s","user","question",1)
    val answer=pi("a1","u1","assistant","answer",2)
    val more=pi("u2","a1","user","next",3)++pi("a2","u2","assistant","next answer",4)
    val id=archive.ingest("a",request(identity,0,head)).sessionId
    val filling=uploads.open("a",declaration(identity,1,head++answer,Some(head))).uploadId
    inject(filling,"base_records",maximum-1)
    send(uploads,"a",filling,part(0,answer))
    val atMaximum=verdict(uploads.commit("a",filling))
    val committed=db.transaction(c => Sql.one(c,"SELECT record_count FROM ch_revisions WHERE session_id=? AND revision=2",id)(_.getInt(1)))
    val appending=uploads.open("a",declaration(identity,2,head++answer++more,Some(head++answer))).uploadId
    val fresh=uploads.open("a",declaration(source(),0,head++answer,None)).uploadId
    send(uploads,"a",fresh,part(0,header(3)))
    inject(fresh,"records",maximum-1)
    val vast=new Uploads(db,config.copy(maxFileBytes=1L<<62),UploadPolicy.production)
    val parts=vast.open("a",declaration(source(),0,header(3),None)).uploadId
    inject(parts,"parts",maximum)
    // A raw end just below a maxFileBytes near Long.MaxValue: with a part of 1 MiB it passes Long.MaxValue.
    val wide=new Uploads(db,config.copy(maxFileBytes=Long.MaxValue-mebibyte+1),UploadPolicy.production)
    val blob=Content(List(s"""{"type":"blob","text":"${"x"*mebibyte}"}"""),Nil)
    val wideSource=source()
    archive.ingest("a",request(wideSource,0,head))
    val wideAppend=wide.open("a",declaration(wideSource,1,head++blob,Some(head))).uploadId
    inject(wideAppend,"base_raw_bytes",Long.MaxValue-mebibyte)
    assertEquals(List[(String,Any)]("a revision of exactly the maximum" -> (atMaximum,committed),
      "an append past it through its base" -> refused(uploads,appending,part(0,more)),
      "an upload past it through its accepted records" -> refused(uploads,fresh,part(1,pi("u1","s","user","question",1)++answer)),
      "a part past the largest ordinal" -> refused(vast,parts,part(maximum,header(3))),
      "an append past the raw-byte maximum through its base" -> refused(wide,wideAppend,part(0,blob)),
      "the part bound of the largest maxFileBytes" -> UploadPolicy.maxParts(config.copy(maxFileBytes=Long.MaxValue))),
      List[(String,Any)]("a revision of exactly the maximum" -> ("accepted",Some(maximum)),"an append past it through its base" -> ("too-large",true),
        "an upload past it through its accepted records" -> ("too-large",true),"a part past the largest ordinal" -> ("too-large",true),
        "an append past the raw-byte maximum through its base" -> ("too-large",true),"the part bound of the largest maxFileBytes" -> maximum.toLong))
  }}

  test("a source at the largest revision takes no further one through /api/ingest, an open or the commit of an attempt opened at it before, and an attempt an earlier server staged past the record maximum does not commit: each is refused before anything is written, a commit ends its attempt Failed") { database { (config,db,archive) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val maximum=Int.MaxValue
    val head=header(3)++pi("u1","s","user","question",1)
    val answer=pi("a1","u1","assistant","answer",2)
    /** Makes revision `maximum` the head of source `id`: its revision 1 stored again under that number, as 2^31-2 appends would leave it. */
    def atMaximum(id: UUID): Unit = db.transaction { c =>
      Sql.exec(c,"""INSERT INTO ch_revisions(session_id,revision,epoch,envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain,message_time)
        SELECT session_id,?,epoch,envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain,message_time FROM ch_revisions WHERE session_id=? AND revision=1""",maximum,id)
      Sql.exec(c,"UPDATE ch_sources SET revision=? WHERE id=?",maximum,id)
    }
    /** The source's head, its revision rows and its upload attempts. */
    def stored(id: UUID): List[Long] = db.transaction(c => Sql.one(c,"SELECT (SELECT revision FROM ch_sources WHERE id=?),(SELECT count(*) FROM ch_revisions WHERE session_id=?),(SELECT count(*) FROM ch_uploads WHERE session_id=?)",id,id,id)(r =>
      List(r.getLong(1),r.getLong(2),r.getLong(3))).get)
    def ingested(identity: SourceIdentity): UUID = archive.ingest("a",request(identity,0,head)).sessionId
    def staged(identity: SourceIdentity): UUID = { val attempt=uploads.open("a",declaration(identity,1,head++answer,Some(head))).uploadId; send(uploads,"a",attempt,part(0,answer)); attempt }
    val whole=source(); val wholeId=ingested(whole); atMaximum(wholeId)
    val opening=source(); val openingId=ingested(opening); atMaximum(openingId)
    // Attempts as an earlier server left them: opened at the largest revision; its record end past the maximum.
    val opened=source(); val openedId=ingested(opened); val openedAttempt=staged(opened); atMaximum(openedId)
    db.transaction(c => Sql.exec(c,"UPDATE ch_uploads SET declaration=jsonb_set(declaration,'{expectedRevision}',to_jsonb(?::integer)) WHERE id=?",maximum,openedAttempt))
    val over=source(); val overId=ingested(over); val overAttempt=staged(over)
    db.transaction(c => Sql.exec(c,"UPDATE ch_uploads SET base_records=? WHERE id=?",maximum,overAttempt))
    assertEquals(List[(String,Any)]("/api/ingest" -> (verdict(archive.ingest("a",request(whole,maximum,head++answer))),stored(wholeId)),
      "an open" -> (verdict(uploads.open("a",declaration(opening,maximum,head++answer,Some(head)))),stored(openingId)),
      "the commit of an attempt opened at it" -> (verdict(uploads.commit("a",openedAttempt)),uploads.status("a",openedAttempt).phase,stored(openedId)),
      "the commit of an attempt staged past the record maximum" -> (verdict(uploads.commit("a",overAttempt)),uploads.status("a",overAttempt).phase,stored(overId))),
      List[(String,Any)]("/api/ingest" -> ("too-large",List(maximum.toLong,2L,0L)),"an open" -> ("too-large",List(maximum.toLong,2L,0L)),
        "the commit of an attempt opened at it" -> ("too-large",UploadPhase.Failed,List(maximum.toLong,2L,1L)),
        "the commit of an attempt staged past the record maximum" -> ("content-mismatch",UploadPhase.Failed,List(1L,1L,1L))))
  }}

  test("records are the lines linesIterator splits, also at a bare CR: a CRLF record of exactly maxRecordBytes is accepted, two records on one LF line do not make a large part") { database { (_,db,archive) =>
    val cap=5*mebibyte
    val config=Fixtures.config().copy(maxRecordBytes=cap.toLong,maxFileBytes=64*mebibyte)
    val uploads=new Uploads(db,config,UploadPolicy.production)
    /** A record of exactly `bytes` UTF-8 bytes. */
    def record(id: String,bytes: Int): String = { val prefix=s"""{"type":"blob","id":"$id","text":""""; prefix+"x"*(bytes-prefix.length-2)+"\"}" }
    val crlf=Content(List(record("crlf",cap)+"\r"),Nil)
    val identity=source()
    val opened=uploads.open("a",declaration(identity,0,header(3)++crlf,None)).uploadId
    send(uploads,"a",opened,part(0,header(3)))
    assertEquals(code(send(uploads,"a",opened,part(1,crlf))),"accepted")
    assertEquals(code(uploads.commit("a",opened)),"accepted")
    assertEquals(code(SnapshotValidation.validate(request(identity,0,header(3)++crlf),config)),"accepted")
    val pair=Content(List(record("one",cap-mebibyte/2)+"\r"+record("two",cap-mebibyte/2)),Nil)
    val other=uploads.open("a",declaration(source(),0,header(3)++pair,None)).uploadId
    send(uploads,"a",other,part(0,header(3)))
    val large=part(1,pair)
    assert(Wire.encode(UploadPart.codecJson,large).noSpaces.length>UploadPolicy.maxPartBytes)
    assertEquals(code(send(uploads,"a",other,large)),"too-large")
  }}
}
