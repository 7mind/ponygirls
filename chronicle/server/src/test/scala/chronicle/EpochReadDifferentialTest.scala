package chronicle

import chronicle.api.*
import io.circe.Json
import java.sql.DriverManager
import java.util.UUID

/** Readers of revision content give the same answers for a revision stored in an epoch as for the same revision stored in
  * the legacy layout (append-only ingest spec §1.3, §3.1, U3). */
final class EpochReadDifferentialTest extends munit.FunSuite {
  private def database(f: (Config,Database) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config().copy(maxFileBytes=16*1024*1024); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    def reset(): Unit = db.transaction { c => Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_ingest_receipts CASCADE"); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile) }
    try { reset(); f(config,db) } finally { reset(); db.close() }
  }
  private def time(second: Int): String = f"2026-01-01T00:00:$second%02dZ"
  private def header: String = """{"type":"session","id":"s","version":3,"timestamp":"2026-01-01T00:00:00Z"}"""
  /** A Pi message record and its message. */
  private def pi(id: String,parent: String,role: String,text: String,record: Int): (String,Message) =
    (Json.obj("type"->Json.fromString("message"),"id"->Json.fromString(id),"parentId"->Json.fromString(parent),"timestamp"->Json.fromString(time(record)),
      "message"->Json.obj("role"->Json.fromString(role),"content"->Json.arr(Json.obj("type"->Json.fromString("text"),"text"->Json.fromString(text))))).noSpaces,
      Message(id,Some(parent),role,text,Some(time(record)),record))
  private def request(identity: SourceIdentity,expected: Int,records: List[(String,Option[Message])],newline: Boolean=true): IngestRequest = {
    val raw=if(newline) records.map(_._1+"\n").mkString else records.map(_._1).mkString("\n")
    Fixtures.snapshot().copy(source=identity,expectedRevision=expected,digest=Wire.hash(raw),messages=records.flatMap(_._2),files=List(RawFile("session.jsonl",Wire.hash(raw),raw)))
  }
  private def message(record: (String,Message)): (String,Option[Message]) = (record._1,Some(record._2))
  private def outcome[A](read: => A): Either[String,A] = try Right(read) catch { case error: DomainError => Left(error.code) }

  test("a revision sequence (append, append, non-prefix, append, no final newline, NUL record id) reads the same from an epoch archive as from a legacy one: pages, locate, context, Find, archive search, raw and claims of every revision") { database { (config,db) =>
    val legacy=new PostgresArchive(db,config,RevisionLayoutPolicy.Legacy); val epochs=new PostgresArchive(db,config,RevisionLayoutPolicy.Epochs)
    val archives=List("a"->legacy,"b"->epochs)
    val identity=SourceIdentity("differential","native",SourceFormat.Pi,"session",None)
    // A literal across the first fragment boundary of a long text (fragments of 4,096 bytes overlap by 512 scalars).
    val u1=pi("u1","s","user","Where is the NEEDLE marker? first question",1); val a1=pi("a1","u1","assistant","Σ"+"x"*4088+"needle marker"+"y"*3000,2)
    val u2=pi("u2","a1","user","status qqqq with nul\u0000text",3); val a2=pi("a2","u2","assistant","second NEEDLE MARKER answer",4)
    val u3=pi("u3","a2","user","",5); val a3=pi("a3","u3","assistant","third answer, Σίσυφος",6)
    val redacted=pi("u1","s","user","Where is the [redacted] marker? first question",1); val u4=pi("u4","a3","user","fourth question qqqq",7)
    val a4=pi("a4","u4","assistant","fourth answer",8); val u5=pi("u5","a4","user","fifth question without a final newline",9)
    val nul=("""{"type":"custom","id":"rec\u0000ord"}""",None); val a5=pi("a5","u5","assistant","answer after the NUL record",11)
    val second=List(header->None,message(u1),message(a1),message(u2),message(a2))
    val third=second++List(message(u3),message(a3))
    val fourth=List(header->None,message(redacted),message(a1),message(u2),message(a2),message(u3),message(a3),message(u4))
    val fifth=fourth:+message(a4)
    val sixth=fifth:+message(u5)
    val revisions=List(request(identity,0,List(header->None,message(u1),message(a1))),request(identity,1,second),request(identity,2,third),request(identity,3,fourth),
      request(identity,4,fifth),request(identity,5,sixth,newline=false),request(identity,6,sixth++List(nul,message(a5))))
    val other=request(SourceIdentity("unrelated","native",SourceFormat.Pi,"session",None),0,List(header->None,("""{"type":"message","id":"o1"}""",Some(Message("o1",None,"user","unrelated qqqq session",Some("2025-12-31T00:00:00Z"),1)))))
    val others=archives.map((owner,archive) => archive.ingest(owner,other).sessionId)
    val ids=archives.map((owner,archive) => archive.ingest(owner,revisions.head).sessionId)
    val names=(ids.map(_ -> "sequence")++others.map(_ -> "unrelated")).toMap
    def named(id: UUID): UUID = UUID.nameUUIDFromBytes(names(id).getBytes)
    def session(info: SessionInfo): SessionInfo = info.copy(id=named(info.id),ownerId="")
    def searched(result: ArchiveSearchResult): ArchiveSearchResult = ArchiveSearchResult(
      result.page.copy(rows=result.page.rows.map(row => row.copy(head=session(row.head),headJob=row.headJob.map(_.copy(id=new UUID(0,0),sessionId=named(row.head.id))))),nextCursor=result.page.nextCursor.map(_ => "")),
      result.evidence.map(evidence => evidence.copy(sessionId=named(evidence.sessionId))))
    val expressions=List("mode:lexical \"needle marker\"","mode:lexical qqqq","mode:lexical \"[redacted]\"","mode:lexical synthetic NOT qqqq")
    def archiveSearch(reader: String,archive: PostgresArchive): List[ArchiveSearchResult] = {
      val index=new PostgresArchiveIndex(db,archive,config)
      expressions.map { expression =>
        val query=ArchiveQuery(expression,ArchiveSort.LastTimestamp,SortDirection.Desc,None,ArchiveSearchPolicy.maximumPageSize,false)
        searched(index.sourceSearch(reader,query,ArchiveExpression.parse(expression),Nil,ReadMaterialization.unrestricted))
      }
    }
    def same[A](what: String)(read: (String,UUID,PostgresArchive) => A): Unit = {
      val results=archives.zip(ids).map { case ((owner,archive),id) => read(owner,id,archive) }
      assertEquals(results(1),results(0),what)
    }
    revisions.zipWithIndex.foreach { (revision,index) =>
      if(index>0) archives.foreach((owner,archive) => archive.ingest(owner,revision))
      same(s"archive search at head ${index+1}")((owner,_,archive) => archiveSearch(owner,archive))
    }
    db.transaction { c =>
      val layouts=Sql.rows(c,"SELECT revision,epoch FROM ch_revisions WHERE session_id=? ORDER BY revision",ids(1))(r => (r.getInt(1),Option(r.getObject(2,classOf[UUID]))))
      assertEquals(layouts.map(_._2.isDefined),List(true,true,true,true,true,false,true),"the epoch archive stores every revision but the one without a final newline in epochs")
      assertEquals(layouts.flatMap(_._2).distinct.size,3,"a non-prefix revision and the first after a legacy head start new epochs")
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revisions WHERE session_id=? AND epoch IS NOT NULL",ids(0))(_.getInt(1)),Some(0))
    }
    val literals=List("needle marker","nul\u0000t","σ")
    revisions.zipWithIndex.foreach { (revision,index) =>
      val view=ContentView(index+1,None); val count=revision.messages.size
      // The first and the last message of the revision, and one that only a later revision has.
      val probes=List(revision.messages.head,revision.messages.last).distinct
      val later=revisions.drop(index+1).flatMap(_.messages.map(_.id)).find(id => !revision.messages.exists(_.id==id)).toList
      List((0,100),(1,2),(count-1,100),(count,100)).foreach { (offset,limit) => same(s"page $offset+$limit of $view")((owner,id,archive) => archive.messages(owner,id,offset,limit,Some(view))) }
      (probes.map(_.id)++later:+"missing").foreach(messageId => same(s"locate $messageId in $view")((owner,id,archive) => outcome(archive.locateMessage(owner,id,view,messageId))))
      // A small budget before the anchor (a cut inside the previous message), a large one after it (adjacent messages).
      probes.foreach(message => same(s"context of ${message.id} in $view")((owner,id,archive) =>
        outcome(archive.readMessageContext(owner,id,view,Span(message.id,0,0),4,2048)).map(_.copy(sessionId=named(id)))))
      literals.foreach { literal => same(s"Find $literal in $view") { (owner,id,archive) =>
        Iterator.iterate(Option(archive.searchSessionMessages(owner,id,view,literal,None,1))) { page => page.flatMap(_.nextCursor).map(cursor => archive.searchSessionMessages(owner,id,view,literal,Some(cursor),1)) }
          .takeWhile(_.nonEmpty).flatten.map(page => (page.view,page.hits,page.nextCursor.isDefined)).toList
      }}
      same(s"raw of $view")((owner,id,archive) => archive.raw(owner,id,Some(index+1)))
      same(s"claim of $view")((_,id,archive) => db.transaction(c => archive.claimedSnapshot(c,id,index+1)._1))
      assertEquals(epochs.raw("b",ids(1),Some(index+1)).files,revision.files)
      assertEquals(db.transaction(c => epochs.claimedSnapshot(c,ids(1),index+1)._1),SnapshotProjection(revision).copy(files=Nil))
    }
    same("head snapshot")((owner,id,archive) => archive.headSnapshot(owner,id))
  }}

  test("Find in a current epoch whose scan outlasts its limit answers from the epoch's candidates with the scan's hits and cursors, for the head and a pinned revision") { database { (config,db) =>
    val archive=new PostgresArchive(db,config,RevisionLayoutPolicy.Epochs)
    val identity=SourceIdentity("find","native",SourceFormat.Pi,"session",None)
    val filler="lorem ipsum dolor sit amet "*110
    // Hits only late in the session: the first page's scan reads nearly every message. One crosses a fragment boundary.
    val texts=Vector.tabulate(1000)(position => if(position==700) "Σ"+"x"*4088+"NEEDLE marker"+filler else if(position==990) filler+"a needle Marker" else filler)
    val records=texts.zipWithIndex.map((text,position) => pi(s"m$position",if(position==0) "s" else s"m${position-1}","user",text,position+1)).toList
    val appended=List(pi("m1000","m999","assistant","needle marker one",1001),pi("m1001","m1000","user","needle marker two",1002))
    val first=request(identity,0,(header,None)::records.map(message))
    val id=archive.ingest("a",first).sessionId
    archive.ingest("a",request(identity,1,(header,None)::(records++appended).map(message)))
    val probe=new SourceProbe; DriverManager.registerDriver(probe)
    val probed=config.copy(jdbcUrl=probe.url(config.jdbcUrl)); val probedDb=Fixtures.database(probed,IndexProfileCatalog.current(probed))
    try {
      val cursors=new MessageSearchCursors
      val scanning=new PostgresMessageSearch(db,archive,cursors,SessionMessageSearchPolicy.scanDeadlineMillis)
      val limited=new PostgresMessageSearch(probedDb,new PostgresArchive(probedDb,probed),cursors,1)
      def pages(search: PostgresMessageSearch,view: ContentView): List[SessionMessageSearchResult] =
        Iterator.iterate(Option(search.searchSessionMessages("a",id,view,"needle marker",None,1))) { page => page.flatMap(_.nextCursor).map(cursor => search.searchSessionMessages("a",id,view,"needle marker",Some(cursor),1)) }
          .takeWhile(_.nonEmpty).flatten.toList
      List(1->List(700,990),2->List(700,990,1000,1001)).foreach { (revision,positions) =>
        val view=ContentView(revision,None)
        val scanned=pages(scanning,view)
        assertEquals(scanned.flatMap(_.hits.map(_.position)),positions)
        assertEquals(pages(limited,view),scanned)
      }
      assert(probe.observations.exists { case SourceEvent.Statement(_,sql) => sql.contains("ch_epoch_fragments"); case _ => false },"the limited scan timed out and the candidates answered")
    } finally { probedDb.close(); DriverManager.deregisterDriver(probe) }
  }}

  test("production wiring: Find in a current epoch scans for 1 s before it reads the epoch's candidates") { database { (config,db) =>
    assertEquals(new PostgresArchive(db,config).messageSearch.scanDeadlineMillis,1000)
  }}
}
