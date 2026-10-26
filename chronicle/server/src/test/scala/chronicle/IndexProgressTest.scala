package chronicle
import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.util.UUID

class IndexProgressTest extends munit.FunSuite {
  def database(f: (Config,Database,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val c=Fixtures.config(); val db=new Database(c); db.initialize()
    db.transaction(x => { Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE"); Sql.exec(x,"UPDATE ch_profile SET active=?,target=?,maintenance=false",c.profile,c.profile) })
    f(c,db,new PostgresArchive(db,c))
  }
  def counters(a: PostgresArchive,id: UUID): (Int,Option[Int]) = {
    val job=a.statuses("a",0,100).jobs.find(_.id==id).get
    (job.completedWindows,job.totalWindows)
  }
  test("index progress is fenced monotonic and reset by automatic/manual retries and claims") { database { (c,db,a) =>
    val out=a.ingest("a",Fixtures.snapshot(),c.profile)
    assertEquals(counters(a,out.jobId),(0,None))
    val first=a.claim(c.profile,300).get
    assert(a.progress(first,0,3)); assert(a.progress(first,2,3))
    assertEquals(counters(a,out.jobId),(2,Some(3)))
    assert(!a.progress(first,1,3)); assert(!a.progress(first,2,4))
    db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET lease_until=now()-interval '1 second' WHERE id=?",out.jobId))
    assert(!a.progress(first,3,3))
    val second=a.claim(c.profile,300).get
    assertEquals(counters(a,out.jobId),(0,None))
    assert(!a.progress(first,3,3)); assert(a.progress(second,1,2))
    a.fail(first,"late-failure")
    assertEquals(counters(a,out.jobId),(1,Some(2)))
    a.fail(second,"model-http")
    assertEquals(counters(a,out.jobId),(0,None))
    val third=a.claim(c.profile,300).get
    assert(a.progress(third,1,2)); a.retry("a",out.jobId)
    assertEquals(counters(a,out.jobId),(0,None))
    assert(!a.progress(third,2,2))
    val fresh=a.claim(c.profile,300).get
    assert(a.progress(fresh,2,2)); assert(a.publish(fresh,Nil))
    assert(!a.progress(fresh,2,2))
    assertEquals(counters(a,out.jobId),(2,Some(2)))
    assertEquals(a.statuses("c",0,100).jobs,Nil)
  }}
  test("superseded source revisions and target profiles reject progress") { database { (c,db,a) =>
    val request=Fixtures.snapshot(); val out=a.ingest("a",request,c.profile)
    val first=a.claim(c.profile,300).get; assert(a.progress(first,1,2))
    a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1),c.profile)
    assert(!a.progress(first,2,2)); assertEquals(counters(a,out.jobId),(1,Some(2)))
    val current=a.claim(c.profile,300).get; assert(a.progress(current,1,2))
    val next=c.copy(embedding=c.embedding.copy(revision="progress-target"))
    new PostgresArchive(db,next).beginMaintenance()
    assert(!a.progress(current,2,2)); a.fail(current,"stale-claim")
    assertEquals(counters(a,current.jobId),(1,Some(2)))
  }}
  test("worker counts completed source windows after annotation AND embedding, not output chunks") { database { (c,db,a) =>
    val original=Fixtures.snapshot()
    val text="a" * (Fragments.maxBytes*9)
    val raw=io.circe.Json.obj("id"->io.circe.Json.fromString("u"),"text"->io.circe.Json.fromString(text)).noSpaces+"\n"
    val request=original.copy(messages=List(Message("u",None,"user",text,None,0)),files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
    val out=a.ingest("a",request,c.profile)
    var annotationCalls=0; var embeddingCalls=0
    val annotator=new Annotator {
      def annotate(window: List[Chunk],messages: List[Message]): IO[List[Chunk]] = IO {
        assertEquals(counters(a,out.jobId),(annotationCalls,Some(3)))
        annotationCalls+=1
        List(window.head.copy(text=window.map(_.text).mkString,spans=window.flatMap(_.spans)))
      }
    }
    val embedder=new Embedder {
      def query(text: String): IO[List[Double]] = IO.pure(List(1.0,0.0,0.0))
      def documents(text: List[String]): IO[List[List[Double]]] = IO {
        assertEquals(counters(a,out.jobId),(embeddingCalls,Some(3)))
        embeddingCalls+=1
        text.map(_ => List(1.0,0.0,0.0))
      }
    }
    assert(new Worker(a,annotator,embedder,db,c,logstage.IzLogger()).once.unsafeRunSync())
    assertEquals(annotationCalls,3); assertEquals(embeddingCalls,3)
    assertEquals(counters(a,out.jobId),(3,Some(3)))
    assertEquals(a.statuses("a",0,100).jobs.head.state,JobState.Complete)
    assertEquals(a.pageChunks("a",out.sessionId,0,100,None).total,3)
  }}
  test("worker records a known zero total for an empty source") { database { (c,db,a) =>
    val request=Fixtures.snapshot().copy(messages=Nil)
    val out=a.ingest("a",request,c.profile)
    val annotator=new Annotator { def annotate(window: List[Chunk],messages: List[Message]): IO[List[Chunk]] = IO.raiseError(new Exception("unexpected annotation")) }
    val embedder=new Embedder {
      def query(text: String): IO[List[Double]] = IO.pure(Nil)
      def documents(text: List[String]): IO[List[List[Double]]] = IO.raiseError(new Exception("unexpected embedding"))
    }
    assert(new Worker(a,annotator,embedder,db,c,logstage.IzLogger()).once.unsafeRunSync())
    assertEquals(counters(a,out.jobId),(0,Some(0)))
    assertEquals(a.statuses("a",0,100).jobs.head.state,JobState.Complete)
  }}
}
