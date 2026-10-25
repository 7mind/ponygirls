package chronicle
import chronicle.api.*
import java.util.UUID
import java.time.Instant
import scala.collection.mutable
import distage.*

final class DummyArchive(config: Config) extends SessionArchive {
  private final case class Head(id: UUID,owner: String,var request: IngestRequest,var revision: Int,var indexed: Option[Int])
  private val sources = mutable.Map.empty[(String,String),Head]
  private val receipts = mutable.Map.empty[(String,String,UUID),(String,IngestReceipt)]
  private val jobs = mutable.Queue.empty[Claim]
  private val claims = mutable.Map.empty[UUID,Claim]
  private val published = mutable.Map.empty[UUID,(ContentView,IngestRequest)]
  private def key(r: IngestRequest) = Wire.hash(Wire.canonical(Wire.encode(SourceIdentity.codecJson,r.source)))
  def ingest(owner: String,r: IngestRequest,profile: String): IngestReceipt = synchronized {
    SnapshotValidation.validate(r,config)
    val k=key(r); val digest=Wire.hash(Wire.canonical(Wire.encode(IngestRequest.codecJson,r)))
    receipts.get((owner,k,r.requestId)) match {
      case Some((d,out)) => Check(d==digest,"conflict","request changed"); out
      case None =>
        val h=sources.getOrElseUpdate((owner,k),Head(UUID.randomUUID(),owner,r,0,None))
        Check(h.revision==r.expectedRevision,"conflict","revision mismatch")
        h.request=r; h.revision+=1
        val claim=Claim(UUID.randomUUID(),h.id,h.revision,1L,profile,r); jobs.enqueue(claim)
        val out=IngestReceipt(r.requestId,h.id,h.revision,claim.jobId); receipts((owner,k,r.requestId))=(digest,out); out
    }
  }
  private def head(reader: String,id: UUID): Head = sources.values.find(h => h.owner==reader && h.id==id).getOrElse(throw DomainError("not-found","not found"))
  def session(reader: String,id: UUID): SessionInfo = synchronized { val h=head(reader,id); val (view,r)=published.getOrElse(id,(ContentView(h.revision,None),h.request)); SessionInfo(view,id,h.owner,h.revision,h.indexed,r.metadata,r.source,r.completion,r.redacted) }
  def headSnapshot(reader: String,id: UUID): IngestRequest = synchronized(head(reader,id).request)
  def claim(profile: String,leaseSeconds: Int): Option[Claim] = synchronized {
    jobs.dequeueFirst(c => c.profile==profile && sources.values.exists(h => h.id==c.sessionId && h.revision==c.revision)).map { c => claims(c.jobId)=c; c }
  }
  def publish(c: Claim,chunks: List[IndexedChunk]): Boolean = synchronized {
    sources.values.find(h => h.id==c.sessionId && h.revision==c.revision && claims.get(c.jobId).contains(c)) match {
      case Some(h) => h.indexed=Some(c.revision); published(h.id)=(ContentView(c.revision,Some(UUID.randomUUID())),c.snapshot); claims.remove(c.jobId); true
      case None => false
    }
  }
  def fail(c: Claim,code: String): Unit = synchronized { claims.remove(c.jobId); jobs.enqueue(c.copy(fence=c.fence+1)) }
}
abstract class ArchiveContract extends munit.FunSuite {
  def withArchive(f: (SessionArchive,Config) => Unit): Unit
  test("B-Atomic/GoodCommunication: durable replay binding CAS and raw retention") { withArchive { (a,c) =>
    val r=Fixtures.snapshot(); val out=a.ingest("a",r,c.profile)
    assertEquals(a.ingest("a",r,c.profile),out)
    assertEquals(a.headSnapshot("a",out.sessionId),r)
    assertEquals(intercept[DomainError](a.ingest("a",r.copy(metadata=r.metadata.copy(title="different")),c.profile)).code,"conflict")
    assertEquals(intercept[DomainError](a.ingest("a",r.copy(requestId=UUID.randomUUID()),c.profile)).code,"conflict")
    assertEquals(a.ingest("a",r.copy(requestId=UUID.randomUUID(),expectedRevision=1),c.profile).revision,2)
    assertEquals(intercept[DomainError](a.headSnapshot("b",out.sessionId)).code,"not-found")
  }}
  test("B-Atomic/GoodCommunication: discovery binds published source while head remains explicitly readable") { withArchive { (a,c) =>
    val r=Fixtures.snapshot(); val out=a.ingest("a",r,c.profile)
    assert(a.publish(a.claim(c.profile,300).get,Nil))
    a.ingest("a",r.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=r.metadata.copy(title="new-head")),c.profile)
    val selected=a.session("a",out.sessionId)
    assertEquals(selected.view.revision,1); assert(selected.view.generationId.isDefined)
    assertEquals(selected.revision,2); assertEquals(selected.metadata.title,r.metadata.title)
    assertEquals(a.headSnapshot("a",out.sessionId).metadata.title,"new-head")
  }}
  test("B-Atomic/GoodCommunication: stale worker cannot publish over newer archive head") { withArchive { (a,c) =>
    val r=Fixtures.snapshot(); val out=a.ingest("a",r,c.profile); val claim=a.claim(c.profile,300).get
    a.ingest("a",r.copy(requestId=UUID.randomUUID(),expectedRevision=1),c.profile)
    assert(!a.publish(claim,Nil)); assertEquals(a.session("a",out.sessionId).indexedRevision,None)
    val fresh=a.claim(c.profile,300).get; assert(a.publish(fresh,Nil)); assertEquals(a.session("a",out.sessionId).indexedRevision,Some(2))
    assert(!a.publish(fresh,Nil))
  }}
}
final class ArchiveDummyTest extends ArchiveContract {
  def withArchive(f: (SessionArchive,Config) => Unit): Unit = {
    val c=Fixtures.config()
    Injector().produceGet[SessionArchive](new ModuleDef { tag(StandardAxis.Repo.Dummy); make[Config].fromValue(c); make[SessionArchive].from[DummyArchive] }).use(a => f(a,c))
  }
}
final class ArchivePostgresTest extends ArchiveContract {
  def withArchive(f: (SessionArchive,Config) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped; run scripts/test-postgres.sh for full verification") }
    val c=Fixtures.config()
    val db=new Database(c); db.initialize()
    db.transaction(x => { Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE"); Sql.exec(x,"UPDATE ch_profile SET active=?,target=?,maintenance=false",c.profile,c.profile) })
    Injector().produceGet[SessionArchive](new ModuleDef { tag(StandardAxis.Repo.Prod); make[Config].fromValue(c); make[Database].fromValue(db); make[SessionArchive].from[PostgresArchive] }).use(a => f(a,c))
  }
}
