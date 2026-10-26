package chronicle
import chronicle.api.*
import java.time.{Clock,Instant,ZoneOffset}
import java.util.UUID

abstract class CollectorProgressContract extends munit.FunSuite {
  def store(): CollectorProgressStore
  val now=Instant.parse("2026-10-26T00:00:00Z")
  def report(id: String,seq: Long): CollectorProgressUpdate = CollectorProgressUpdate(id,seq,UUID.randomUUID(),CollectorPhase.Uploading,now.toString,CollectorCounters(1,1,0,0,0,0,2,0,0,0,0,0,9007199254740993L),10000000000L,9000000000L,Some(1000000000L),None)
  test("specified: owner scoped durable Long sequences, duplicates never refresh freshness, capacity is per owner") {
    val s=store(); val r=report("collector",9007199254740993L)
    assertEquals(s.update("a",r,now),CollectorProgressAck(r.sequence,true))
    assertEquals(s.update("a",r.copy(sequence=r.sequence-1),now.plusSeconds(100)),CollectorProgressAck(r.sequence,false))
    assertEquals(s.update("a",r,now.plusSeconds(100)),CollectorProgressAck(r.sequence,false))
    assertEquals(s.status("a").head,(r,now))
    assertEquals(s.status("b"),Nil)
    (1 to 99).foreach(n => s.update("a",report(s"collector-$n",1),now))
    assertEquals(intercept[DomainError](s.update("a",report("overflow",1),now)).code,"invalid")
    assertEquals(s.update("a",r.copy(sequence=r.sequence+1),now.plusSeconds(121)),CollectorProgressAck(r.sequence+1,true))
    assertEquals(s.update("b",report("overflow",1),now),CollectorProgressAck(1,true))
  }
  test("specified: validation denies malformed counters/identifiers/timestamps but allows prior pending uploads") {
    val storage=store(); val s=new CollectorProgress(storage,Clock.fixed(now,ZoneOffset.UTC))
    val ingest=Identity(UserInfo("a","a",List(Scope.Ingest)),false,"")
    val read=Identity(UserInfo("a","a",List(Scope.Read)),false,"")
    val r=report("collector",1)
    assertEquals(s.update(ingest,r),CollectorProgressAck(1,true))
    List(r.copy(sequence=0),r.copy(collectorId="/raw/path"),r.copy(error=Some("raw error text")),r.copy(startedAt="bad"),r.copy(uploadedBytes=r.totalUploadBytes+1),r.copy(counters=r.counters.copy(scannedBytes= -1))).foreach { bad =>
      assertEquals(intercept[DomainError](s.update(ingest,bad)).code,"invalid")
    }
    assertEquals(intercept[DomainError](s.update(read,r)).code,"forbidden")
    assertEquals(intercept[DomainError](s.update(ingest.copy(browser=true),r)).code,"forbidden")
    assertEquals(intercept[DomainError](s.status(ingest)).code,"forbidden")
    val later=new CollectorProgress(storage,Clock.fixed(now.plusSeconds(121),ZoneOffset.UTC))
    assert(later.status(read).collectors.head.stale)
    assert(!new CollectorProgress(storage,Clock.fixed(now.plusSeconds(120),ZoneOffset.UTC)).status(read).collectors.head.stale)
  }
}
class CollectorProgressDummyTest extends CollectorProgressContract { def store(): CollectorProgressStore = new DummyCollectorProgressStore }
class CollectorProgressPostgresTest extends CollectorProgressContract {
  test("GoodCommunication specified: identity capacity is atomic under concurrent submissions and reports survive adapter restart") {
    val s=store()
    (1 to 98).foreach(n => s.update("a",report(s"existing-$n",1),now))
    val executor=java.util.concurrent.Executors.newFixedThreadPool(math.min(4,Runtime.getRuntime.availableProcessors()))
    try {
      val attempts=(1 to 12).map { n => executor.submit(new java.util.concurrent.Callable[Boolean] {
        def call(): Boolean = try { s.update("a",report(s"new-$n",1),now); true } catch { case e: DomainError if e.code=="invalid" => false }
      }) }
      assertEquals(attempts.count(_.get(10,java.util.concurrent.TimeUnit.SECONDS)),2)
      assertEquals(s.status("a").size,100)
      val db=new Database(Fixtures.config()); db.initialize()
      assertEquals(new PostgresCollectorProgressStore(db).status("a"),s.status("a"))
    } finally executor.shutdownNow()
  }

  def store(): CollectorProgressStore = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val db=new Database(Fixtures.config()); db.initialize()
    db.transaction(c => { Sql.exec(c,"TRUNCATE ch_collector_progress"); () })
    new PostgresCollectorProgressStore(db)
  }
}
final class DummyCollectorProgressStore extends CollectorProgressStore {
  private var values=Map.empty[(String,String),(CollectorProgressUpdate,Instant)]
  def update(owner: String,r: CollectorProgressUpdate,now: Instant): CollectorProgressAck = synchronized {
    val old=values.get(owner->r.collectorId)
    Check(old.nonEmpty || values.keys.count(_._1==owner)<100,"invalid","collector identity limit")
    val accepted=old.forall(_._1.sequence<r.sequence)
    if(accepted) values=values.updated(owner->r.collectorId,(r,now))
    CollectorProgressAck(values(owner->r.collectorId)._1.sequence,accepted)
  }
  def status(owner: String): List[(CollectorProgressUpdate,Instant)] = synchronized { values.toList.filter(_._1._1==owner).sortBy(_._1._2).map(_._2) }
}
