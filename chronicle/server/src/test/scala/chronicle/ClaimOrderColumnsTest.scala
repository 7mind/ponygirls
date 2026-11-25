package chronicle

import chronicle.api.*
import ponygirls.auth.{IndexingChoice,IndexingPreferenceSql,IndexingService}
import java.sql.Connection
import java.time.{Instant,OffsetDateTime}
import java.util.UUID
import java.util.concurrent.{Callable,Executors,TimeUnit}
import scala.concurrent.duration.*
import scala.util.Using

/** T3 (claim-order design §3): every write path sets or keeps `ch_jobs.waiting_since` and `bulk` as its row of the table
  * says, under the default configuration. A fresh value is the writing transaction's `now()`: read in that transaction where
  * the test runs the production function in its own transaction, otherwise bounded by `now()` of a transaction committed
  * before and one begun after (no sleeps). Inherited and kept values are compared exactly with planted ones. The claims of
  * the cases are those of `claimOrder` (ClaimOrderColumnsWaitingTest: the same cases under the waiting order). */
class ClaimOrderColumnsTest extends munit.FunSuite {
  protected def claimOrder: ClaimOrderSetting = ClaimOrderSetting.SourceId
  private def claimOwner(archive: PostgresArchive,catalog: IndexProfileCatalog,owner: String): Option[Claim] =
    ClaimOrderFixtures.claimIn(claimOrder,archive,catalog.knownProfiles,ClaimScope.Owner(owner),300)
  import UploadFixtures.{Content,declaration,header,part,pi,send}
  private type Order = (Option[Instant],Option[Boolean])
  private def cleanPreferences(db: Database): Unit = db.transaction { c =>
    Sql.exec(c,"DELETE FROM ponygirls_indexing_preferences WHERE service='chronicle' AND owner_key IN(?,?,?)",
      IndexingPreferenceSql.ownerKey("a"),IndexingPreferenceSql.ownerKey("b"),IndexingPreferenceSql.ownerKey("c"))
    ()
  }
  private def fixture(f: (Config,Database,PostgresArchive,IndexProfileCatalog) => Unit): Unit =
    OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
      db.transaction(c => Sql.exec(c,"TRUNCATE ch_uploads,ch_epochs,ch_reindex_requests,ch_reindex_members CASCADE"))
      cleanPreferences(db)
      try f(ClaimOrderFixtures.ordered(config,claimOrder),db,archive,catalog) finally cleanPreferences(db)
    }
  private def instant(c: Connection,sql: String,args: Sql.Param*): Instant = Sql.one(c,sql,args*)(_.getObject(1,classOf[OffsetDateTime]).toInstant).get
  private def now(c: Connection): Instant = instant(c,"SELECT now()")
  /** `now()` of a transaction of its own: a bound for a write transaction committed after (`before`) or before it (`after`). */
  private def marker(db: Database): Instant = db.transaction(now)
  private def order(c: Connection,job: UUID): Order =
    Sql.one(c,"SELECT waiting_since,bulk FROM ch_jobs WHERE id=?",job)(r => (Option(r.getObject(1,classOf[OffsetDateTime])).map(_.toInstant),Option(r.getObject(2,classOf[java.lang.Boolean])).map(_.booleanValue))).get
  private def order(db: Database,job: UUID): Order = db.transaction(order(_,job))
  private def state(db: Database,job: UUID): (String,Option[String]) = db.transaction(c => Sql.one(c,"SELECT state,error FROM ch_jobs WHERE id=?",job)(r => (r.getString(1),Option(r.getString(2)))).get)
  private def job(db: Database,source: UUID,revision: Int): UUID = db.transaction(c => Sql.one(c,"SELECT id FROM ch_jobs WHERE session_id=? AND revision=?",source,revision)(_.getObject(1,classOf[UUID])).get)
  private var planted=0
  /** Distinct planted values per call (a year per call): an inherited value is recognized exactly. */
  private def plant(db: Database,job: UUID,bulk: Boolean): Order = {
    planted+=1
    db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET waiting_since=?::timestamptz,bulk=? WHERE id=?",f"${1990+planted}%04d-02-03T04:05:06.123456Z",bulk,job))
    val value=order(db,job); assertEquals(value._2,Some(bulk)); value
  }
  private def fresh(db: Database,job: UUID,before: Instant,after: Instant): Unit = {
    val (since,bulk)=order(db,job)
    assertEquals(bulk,Some(false),s"job $job is fresh work")
    assert(since.exists(value => !value.isBefore(before) && !value.isAfter(after)),s"job $job waits from its transaction's now(): $since not in [$before,$after]")
  }
  private def set(db: Database,config: Config,owner: String,choice: IndexingChoice,admin: Boolean=false): Unit = db.transaction { c =>
    val store=IndexingPreferenceSql.store(c,IndexingService.Chronicle,config.indexingPolicy)
    if(admin) store.setOverride(owner,choice) else store.setChoice(owner,choice); ()
  }
  private def epoch(db: Database,owner: String): Long = db.transaction(c => ChronicleIndexing.read(c,true,owner).epoch)
  /** The owner's indexing epoch moves while indexing stays allowed (a quick off-on). */
  private def offOn(db: Database,config: Config,owner: String): Unit = {
    val before=epoch(db,owner)
    set(db,config,owner,IndexingChoice.Disable); set(db,config,owner,IndexingChoice.Enable)
    assertNotEquals(epoch(db,owner),before)
  }
  private final class Source(val archive: PostgresArchive,val owner: String) {
    val identity: SourceIdentity = UploadFixtures.source()
    var content: Content = header(3)++pi("u1","s","user","synthetic claim-order question",1)
    var revision = 0
    def ingest(): IngestReceipt = {
      if(revision>0) content=content++pi(s"a$revision",if(revision==1) "u1" else s"a${revision-1}","assistant",s"synthetic answer $revision",revision+1)
      val receipt=archive.ingest(owner,UploadFixtures.request(identity,revision,content)); revision=receipt.revision; receipt
    }
  }
  /** A committed upload of `owner`'s source: an append on `base` (its parts are the delta), or a full replacement. */
  private def upload(uploads: Uploads,owner: String,identity: SourceIdentity,expected: Int,content: Content,base: Option[Content]): IngestReceipt = {
    val opened=uploads.open(owner,declaration(identity,expected,content,base))
    send(uploads,owner,opened.uploadId,part(0,base.fold(content)(b => Content(content.lines.drop(b.lines.size),content.messages.drop(b.messages.size)))))
    uploads.commit(owner,opened.uploadId)
  }
  private def setState(db: Database,job: UUID,assignment: String): Unit = { db.transaction(c => Sql.exec(c,s"UPDATE ch_jobs SET $assignment WHERE id=?",job)); () }
  private val queued="state='Queued'"
  private val held="state='Queued',error='database-transient',transient_failures=1,lease_until=now()+interval '1 hour'"
  private val deferred="state='Queued',total_windows=150"
  private val leaseEnded="state='Running',attempts=1,fence=fence+1,lease_until=now()-interval '1 second'"
  private val leased="state='Running',attempts=1,fence=fence+1,lease_until=now()+interval '1 hour'"

  test("T3 r1: a source's first job, direct ingest and upload, and an opted-out owner's, waits from its transaction's now() as fresh work") { fixture { (config,db,archive,_) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    val before=marker(db)
    val ingested=archive.ingest("a",Fixtures.snapshot())
    val uploaded=upload(uploads,"a",UploadFixtures.source(),0,header(3)++pi("u1","s","user","synthetic upload",1),None)
    set(db,config,"b",IndexingChoice.Disable)
    val optedOut=archive.ingest("b",Fixtures.snapshot())
    val after=marker(db)
    List(ingested,uploaded,optedOut).foreach(receipt => fresh(db,receipt.jobId,before,after))
    assertEquals(state(db,optedOut.jobId),("Queued",None))
    // The switch itself, run in this transaction: exactly its now().
    val source=ingested.sessionId
    val (switchedJob,switchedAt)=db.transaction { c =>
      Sql.exec(c,"UPDATE ch_jobs SET state='Complete' WHERE id=?",ingested.jobId)
      Sql.one(c,"SELECT 1 FROM ch_sources WHERE id=? FOR NO KEY UPDATE",source)(_ => ())
      Sql.exec(c,"UPDATE ch_sources SET revision=2 WHERE id=?",source)
      (Jobs.switched(c,source,2,config.profile),now(c))
    }
    assertEquals(order(db,switchedJob),(Some(switchedAt),Some(false)))
  }}

  test("T3 r2/QA-i: append and full replacement over a Queued, held, deferred or lease-ended Running predecessor inherit its waiting_since and bulk") { fixture { (config,db,archive,_) =>
    val uploads=new Uploads(db,config,UploadPolicy.production)
    for(predecessor <- List(queued,held,deferred,leaseEnded); append <- List(true,false)) {
      val identity=UploadFixtures.source()
      val first=header(3)++pi("u1","s","user",s"synthetic $predecessor $append",1)
      val one=upload(uploads,"a",identity,0,first,None)
      setState(db,one.jobId,predecessor)
      val inherited=plant(db,one.jobId,bulk=append)
      val next=if(append) first++pi("a1","u1","assistant","synthetic answer",2) else header(3)++pi("u1","s","user","synthetic rewrite",1)
      val two=upload(uploads,"a",identity,1,next,Option.when(append)(first))
      db.transaction(c => assertEquals(UploadFixtures.epochOf(c,two.sessionId,2)==UploadFixtures.epochOf(c,two.sessionId,1),append,"append keeps the epoch, a replacement starts one"))
      assertEquals(order(db,two.jobId),inherited,s"$predecessor append=$append")
      assertEquals(state(db,one.jobId),("Failed",Some(Jobs.supersededRevision)))
    }
    // The direct ingest path switches through the same rule.
    val source=new Source(archive,"a"); val first=source.ingest()
    val inherited=plant(db,first.jobId,bulk=true)
    assertEquals(order(db,source.ingest().jobId),inherited)
  }}

  test("T3 QA-ii vs D3a: a validly leased predecessor whose indexing epoch moved is inherited; one of the current epoch is not") { fixture { (config,db,archive,catalog) =>
    def leasedSource(owner: String): (Source,UUID,Order) = {
      val source=new Source(archive,owner); val first=source.ingest()
      val claim=claimOwner(archive,catalog,owner).get
      assertEquals(claim.jobId,first.jobId)
      (source,first.jobId,plant(db,first.jobId,bulk=true))
    }
    val (current,currentJob,_)=leasedSource("a")
    val before=marker(db); val successor=current.ingest(); val after=marker(db)
    assertEquals(state(db,currentJob),("Running",None),"a valid lease keeps its claim")
    fresh(db,successor.jobId,before,after)
    val (moved,movedJob,inherited)=leasedSource("b")
    offOn(db,config,"b")
    val replaced=moved.ingest()
    assertEquals(state(db,movedJob),("Running",None),"a valid lease keeps its claim whatever its epoch")
    assertEquals(order(db,replaced.jobId),inherited)
  }}

  test("T3 B1: a switch over a validly leased predecessor that another transaction holds FOR SHARE (staging) completes without waiting for it") { fixture { (_,db,archive,catalog) =>
    val source=new Source(archive,"a"); val first=source.ingest()
    assertEquals(claimOwner(archive,catalog,"a").map(_.jobId),Some(first.jobId))
    val pool=Executors.newSingleThreadExecutor()
    try {
      val (blocked,successor)=db.transaction { held =>
        Sql.one(held,"SELECT id FROM ch_jobs WHERE id=? FOR SHARE",first.jobId)(_ => ())
        val switching=pool.submit(new Callable[IngestReceipt] { def call(): IngestReceipt = source.ingest() })
        // Until the switch ends, any lock wait in this database is the switch's: the share lock is the only one held.
        def waiting: Boolean = db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock')")(_.getBoolean(1)).get)
        val guard=Deadline.now+2.minutes
        var blocked=false
        while(!switching.isDone && !blocked && guard.hasTimeLeft()) blocked=waiting
        assert(switching.isDone || blocked,"the switch neither ended nor waited")
        (blocked,Option.when(switching.isDone)(switching.get()))
      }
      assert(!blocked,"the switch waited for a lock held by a FOR SHARE reader of its leased predecessor")
      assertEquals(state(db,first.jobId),("Running",None))
      assertEquals(successor.map(r => order(db,r.jobId)._2),Some(Some(false)))
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(30,TimeUnit.SECONDS)) }
  }}

  test("T3 QA-iii: with a lease-ended older Running job and a queued head, the switch inherits the queued head's values") { fixture { (_,db,archive,catalog) =>
    val source=new Source(archive,"a"); val first=source.ingest()
    assertEquals(claimOwner(archive,catalog,"a").map(_.jobId),Some(first.jobId))
    val second=source.ingest()
    plant(db,first.jobId,bulk=false)
    val head=plant(db,second.jobId,bulk=true)
    setState(db,first.jobId,"lease_until=now()-interval '1 second'")
    val third=source.ingest()
    assertEquals(List(first,second).map(r => state(db,r.jobId)),List.fill(2)(("Failed",Some(Jobs.supersededRevision))))
    assertEquals(order(db,third.jobId),head)
  }}

  test("T3 r4: RetryJob from every state queues the job from its transaction's now() as fresh work, browser and bearer") { fixture { (config,db,archive,_) =>
    val states=List(queued,held,deferred,leased,leaseEnded,"state='Failed',attempts=5,error='model-http'","state='Complete'")
    for(prior <- states) {
      val receipt=new Source(archive,"a").ingest()
      setState(db,receipt.jobId,prior); plant(db,receipt.jobId,bulk=true)
      val retriedAt=db.transaction { c => Jobs.retry(c,"a",receipt.jobId); now(c) }
      assertEquals(order(db,receipt.jobId),(Some(retriedAt),Some(false)),prior)
      assertEquals(state(db,receipt.jobId)._1,"Queued")
    }
    val auth=new Auth(db,config)
    val (_,cookie)=auth.login(LoginRequest("a","synthetic")); val browser=auth.browser(cookie)
    val secret=Wire.secret()
    db.transaction(c => Sql.exec(c,"INSERT INTO ch_tokens(id,owner,hash,info,operate_jobs) VALUES(?,'a',?,?::jsonb,true)",UUID.randomUUID(),Wire.hash(secret),
      Wire.encode(TokenInfo.codecJson,TokenInfo(UUID.randomUUID(),"operator",List(Scope.Read),Instant.now().toString,false)).noSpaces))
    val bearer=auth.bearer(secret)
    for(identity <- List(browser,bearer)) {
      val receipt=new Source(archive,"a").ingest()
      setState(db,receipt.jobId,"state='Failed',attempts=5,error='model-http'"); plant(db,receipt.jobId,bulk=true)
      val before=marker(db)
      assertEquals(auth.mutate(identity,ClientEnvelope(UUID.randomUUID(),Operation.RetryJob(receipt.jobId))).asInstanceOf[Result.Mutation].receipt.entityId,Some(receipt.jobId))
      fresh(db,receipt.jobId,before,marker(db))
    }
  }}

  test("T3 r5: one bulk retry-failed apply queues all its jobs at its transaction's now() as bulk work; others keep theirs") { fixture { (_,db,archive,_) =>
    val failed=List.fill(3)(new Source(archive,"a").ingest().jobId)
    failed.zipWithIndex.foreach { (id,n) => setState(db,id,"state='Failed',attempts=5,error='model-http'"); plant(db,id,bulk=n==0) }
    val other=new Source(archive,"a").ingest().jobId; val kept=plant(db,other,bulk=false)
    val plan=db.transaction { c => c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ); RetryFailedJobs.preview(c,"a") }
    val appliedAt=db.transaction { c => assertEquals(RetryFailedJobs(c,"a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true).retried,3L); now(c) }
    assertEquals(failed.map(order(db,_)),List.fill(3)((Some(appliedAt),Some(true))))
    assertEquals(order(db,other),kept)
  }}

  test("T3 r5: one owner rebuild queues its INSERT and ON CONFLICT jobs at its transaction's now() as bulk work") { fixture { (config,db,archive,catalog) =>
    def rebuild(on: Database,profiles: IndexProfileCatalog): Instant = {
      val plan=on.transaction { c => c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ); OwnerReindex.preview(c,"a",profiles,true) }
      on.transaction { c => OwnerReindex(c,"a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true,profiles,true); now(c) }
    }
    val x=new Source(archive,"a"); val xFirst=x.ingest()
    val rotated=config.copy(annotation=config.annotation.copy(revision="synthetic-claim-order-next"))
    val next=IndexProfileCatalog.current(rotated)
    Using.resource(new Database(rotated,next)) { other =>
      other.initialize()
      val insertedAt=rebuild(other,next)
      val xNext=db.transaction(c => Sql.one(c,"SELECT id FROM ch_jobs WHERE session_id=? AND revision=1 AND profile=?",xFirst.sessionId,next.preferred.profile)(_.getObject(1,classOf[UUID]))).get
      assertEquals(order(db,xNext),(Some(insertedAt),Some(true)))
      val y=new Source(new PostgresArchive(other,rotated),"a"); val yFirst=y.ingest()
      assertEquals(order(db,yFirst.jobId)._2,Some(false))
    }
    // Back to the first profile: x's head already has that profile's (superseded) job, the ON CONFLICT branch; the other
    // source's head has none, the INSERT branch. One value for both.
    val rebuiltAt=rebuild(db,catalog)
    val heads=db.transaction(c => Sql.rows(c,"SELECT j.id,j.state FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id AND j.revision=s.revision WHERE s.owner='a' AND j.profile=? ORDER BY j.id",catalog.preferred.profile)(r => (r.getObject(1,classOf[UUID]),r.getString(2))))
    assertEquals(heads.map(_._2),List("Queued","Queued"))
    assert(heads.exists(_._1==xFirst.jobId),"x's original job is re-queued by the ON CONFLICT branch")
    assertEquals(heads.map(h => order(db,h._1)),List.fill(2)((Some(rebuiltAt),Some(true))))
  }}

  test("T3 r6/B9: preference changes, admin override, claim, deferral, hold, failure-to-Queued, lease-ended and invalidated reclaim and parking keep the values") { fixture { (config,db,archive,catalog) =>
    val receipt=new Source(archive,"a").ingest(); val id=receipt.jobId
    val values=plant(db,id,bulk=true)
    def unchanged(step: String): Unit = assertEquals(order(db,id),values,step)
    def claim(): Claim = claimOwner(archive,catalog,"a").filter(_.jobId==id).getOrElse(fail("job not claimed"))
    set(db,config,"a",IndexingChoice.Disable); set(db,config,"a",IndexingChoice.Enable); unchanged("preference off/on")
    set(db,config,"a",IndexingChoice.Disable,admin=true); set(db,config,"a",IndexingChoice.Inherit,admin=true); unchanged("admin override")
    val first=claim(); unchanged("claim")
    assert(archive.defer(first,150)); assertEquals(state(db,id),("Queued",None)); unchanged("deferral")
    val sized=claim(); unchanged("claim of a sized job")
    assert(archive.holdTransient(sized,None,Deadline.now+30.seconds).isInstanceOf[TransientOutcome.Held]); unchanged("hold")
    setState(db,id,"lease_until=now()-interval '1 second'")
    val returned=claim(); unchanged("claim after the hold")
    archive.fail(returned,"model-http"); assertEquals(state(db,id),("Queued",Some("model-http"))); unchanged("failure-to-Queued")
    claim(); setState(db,id,"lease_until=now()-interval '1 second'")
    val reclaimed=claim(); unchanged("lease-ended reclaim")
    offOn(db,config,"a")
    archive.fail(reclaimed,"model-http"); assertEquals(state(db,id)._1,"Queued"); unchanged("parking")
    claim(); offOn(db,config,"a")
    claim(); unchanged("invalidated reclaim")
  }}
}
/** T3 rerun under the waiting order (claim-order DESIGN §12 NEW-4): the same cases with `indexing.claimOrder` "waiting", the
  * claims of lane 0: identical column values. */
final class ClaimOrderColumnsWaitingTest extends ClaimOrderColumnsTest {
  override protected def claimOrder: ClaimOrderSetting = ClaimOrderSetting.Waiting
}
