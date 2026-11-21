package chronicle

import chronicle.api.*
import io.circe.Json
import java.sql.DriverManager
import java.util.UUID
import scala.concurrent.duration.*

/** The claim and the message cursor of streamed indexing (ingest-limits spec §5.2.1, §5.2.2, §5.2.8): a claim carries
  * the revision's envelope and a reader, each window reads its messages by position in a transaction of its own, sizes
  * first, and the windows are those of the decoded messages. */
final class StreamedSourceTest extends munit.FunSuite {
  override val munitTimeout=3.minutes
  private def database(config: Config)(f: Database => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    def reset(): Unit = db.transaction { c => Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_ingest_receipts CASCADE"); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile) }
    try { reset(); f(db) } finally { reset(); db.close() }
  }
  private val identity=SourceIdentity("streamed","native",SourceFormat.Pi,"session",None)
  /** One raw line per message; `raw` is whether the line carries the text. */
  private def request(texts: Seq[String],expected: Int=0,raw: Boolean=true): IngestRequest = {
    val messages=texts.zipWithIndex.map((text,index) => Message(s"m$index",None,if(index%3==0) "user" else "assistant",text,None,index)).toList
    val lines=messages.map(m => Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(if(raw) m.text else "")).noSpaces+"\n").mkString
    Fixtures.snapshot().copy(source=identity,expectedRevision=expected,messages=messages,files=List(RawFile("session.jsonl",Wire.hash(lines),lines)),digest=Wire.hash(lines))
  }
  private def claimed(archive: PostgresArchive): Claim = archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
  private def windows(source: ProblemPassages.Source): Vector[ProblemPassages.Window] =
    Iterator.unfold(ProblemPassages.SourceCursor.start)(cursor => source.next(cursor).map(window => (window,window.next))).toVector
  private def unbounded: MessageFetch = MessageFetch(Long.MaxValue,LargeDecodes.unadmitted)

  test("windows read from a revision's rows are the windows of its decoded messages, in an epoch and in the legacy layout: messages longer than three windows, runs of empty messages, across size batches and fetch runs") {
    val config=Fixtures.config()
    database(config) { db =>
      val long="αβγ line 🙂 of a long tool result\n"*16000
      val texts=List("first question 🙂")++List.fill(150)("")++List(long)++List.fill(70)("")++List("Σίσυφος and 中文 tool output\n"*20000,"x"*5000)++(0 until 10).map(i => s"short answer $i")++List.fill(3)("")
      val stored=request(texts,raw=false)
      val expected=windows(ProblemPassages.Source(SnapshotProjection(stored).messages))
      assert(expected.size>12 && expected.map(_.fragments.map(_.messageId).toSet).exists(_.size==1),"a message spans several windows")
      List(RevisionLayoutPolicy.Epochs,RevisionLayoutPolicy.Legacy).foreach { layout =>
        val archive=new PostgresArchive(db,config,layout)
        archive.ingest("a",stored.copy(source=identity.copy(producerSessionId=layout.toString)))
        val claim=claimed(archive)
        assertEquals((claim.snapshot.messages,claim.messages.count),(Nil,texts.size),layout.toString)
        val read=windows(ProblemPassages.Source(claim.messages.reader(unbounded)))
        assertEquals(read.map(w => (w.start,w.next,w.sourceJson)),expected.map(w => (w.start,w.next,w.sourceJson)),layout.toString)
      }
    }
  }

  test("a claim decodes no message, and the source's revision switch does not wait while the claimed messages are read") {
    val config=Fixtures.config()
    database(config) { db =>
      // The switch's lock wait is bounded only so that a switch waiting for a reader fails instead of waiting forever.
      val switching=config.copy(databaseLimits=Fixtures.databaseLimits.copy(lockTimeout=2.seconds))
      val switchingDb=new Database(switching,IndexProfileCatalog.current(switching))
      val probe=new SourceProbe; DriverManager.registerDriver(probe)
      val probed=config.copy(jdbcUrl=probe.url(config.jdbcUrl)); val probedDb=Fixtures.database(probed,IndexProfileCatalog.current(probed))
      try {
        val texts=(0 until 40).map(i => s"message $i "+"y"*3000)
        new PostgresArchive(db,config).ingest("a",request(texts))
        def messageValues: Int = probe.observations.count { case SourceEvent.Payload(sql,_) => sql.contains("ch_epoch_messages"); case _ => false }
        @volatile var switched=Option.empty[Either[String,Int]]
        probe.afterPayload { case SourceEvent.Payload(sql,_) if switched.isEmpty && sql.contains("ch_epoch_messages") =>
          switched=Some(try Right(new PostgresArchive(switchingDb,switching).ingest("a",request(texts:+"appended",expected=1)).revision) catch { case error: Throwable => Left(error.toString) })
        case _ => () }
        val claim=claimed(new PostgresArchive(probedDb,probed))
        assertEquals((messageValues,claim.snapshot.messages,claim.messages.count),(0,Nil,texts.size),"the claim decoded no message")
        val read=windows(ProblemPassages.Source(claim.messages.reader(unbounded)))
        assertEquals(switched,Some(Right(2)),"the next revision switched while the claimed messages were read")
        assertEquals(read.flatMap(_.fragments.map(_.text)).mkString,texts.mkString,"the claimed revision is read whole")
      } finally { probedDb.close(); switchingDb.close(); DriverManager.deregisterDriver(probe) }
    }
  }

  test("consecutive 20 MiB messages are fetched one value at a time, each under the large-decode admission, in the count pass and in the windows; a message whose decode exceeds the budget is refused before a value is fetched") {
    val large=20*1024*1024
    val config=Fixtures.config()
    database(config) { db =>
      val texts=List("first")++List("a","b","c").map(_*large)++List("last")
      new PostgresArchive(db,config).ingest("a",request(texts,raw=false))
      val probe=new SourceProbe; DriverManager.registerDriver(probe)
      val probed=config.copy(jdbcUrl=probe.url(config.jdbcUrl)); val probedDb=Fixtures.database(probed,IndexProfileCatalog.current(probed))
      try {
        val claim=claimed(new PostgresArchive(probedDb,probed))
        @volatile var inside=0; var admitted=0
        val admission=new LargeDecodes { def apply[A](decode: => A): A = { inside+=1; admitted+=1; try decode finally inside-=1 } }
        val decoded=List.newBuilder[Int]
        probe.afterPayload { case SourceEvent.Payload(sql,_) if sql.startsWith("SELECT position,value") => decoded+=inside; case _ => () }
        def pass(): Int = windows(ProblemPassages.Source(claim.messages.reader(MessageFetch(config.maxIndexingBudgetBytes,admission)))).size
        val total=pass()
        assertEquals(pass(),total,"the count pass and the windows")
        val values=probe.observations.collect { case SourceEvent.Query(sql,_) if sql.startsWith("SELECT position,value") => sql }
        val payloads=probe.observations.foldLeft(List.empty[Int]) {
          case (counts,SourceEvent.Query(sql,_)) if sql.startsWith("SELECT position,value") => 0::counts
          case (count::counts,SourceEvent.Payload(sql,_)) if sql.startsWith("SELECT position,value") => (count+1)::counts
          case (counts,_) => counts
        }
        assertEquals((values.size,payloads.distinct),(2*texts.size,List(1)),"one value per fetch")
        assertEquals((admitted,decoded.result()),(6,List.fill(2)(List(0,1,1,1,0)).flatten),"the 20 MiB values inside the admission, one at a time")
        val stored=db.transaction(c => Sql.one(c,"SELECT octet_length(value::text) FROM ch_epoch_messages WHERE message_id='m1'")(_.getLong(1)).get)
        val before=probe.observations.size
        val tight=claim.messages.reader(MessageFetch(stored*IndexingBudget.messageDecodeFactor-1,admission))
        assertEquals(intercept[DomainError](tight.read(0)).code,IndexingBudget.exceededCode)
        assert(!probe.observations.drop(before).exists { case SourceEvent.Query(sql,_) => sql.startsWith("SELECT position,value"); case _ => false },"no value fetched")
      } finally { probedDb.close(); DriverManager.deregisterDriver(probe) }
    }
  }
}
