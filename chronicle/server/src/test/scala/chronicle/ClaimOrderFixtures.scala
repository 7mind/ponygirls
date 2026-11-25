package chronicle

import chronicle.api.*
import java.time.{Instant,OffsetDateTime}
import java.util.UUID
import java.util.concurrent.{Callable,ExecutorService,Executors,Future,TimeUnit}
import scala.concurrent.duration.*

/** Fixtures of the claim-order suites (claim-order DESIGN §9, U4): the waiting order's lanes, jobs with stored
  * `waiting_since`/`bulk` values, an independent model of each lane's order and of lock waits. Orders come from the stored
  * values the fixtures write (timing rule); leases and holds are set far from the database clock (hours). */
private[chronicle] object ClaimOrderFixtures extends munit.Assertions {
  val lane0: ClaimLane = ClaimLane.of(0,1)
  val bulkLane: ClaimLane = ClaimLane.of(1,1)
  val freshLane: ClaimLane = ClaimLane.of(2,1)
  val freshLane2: ClaimLane = ClaimLane.of(3,1)
  val owners: List[String] = List("a","b","c")
  /** `config` with the waiting order on `lanes` lanes, one of them bulk-preferring (the default bulkLanes). */
  def waiting(config: Config,lanes: Int = 4): Config =
    config.copy(indexing=config.indexing.copy(annotationSessions=lanes,claimOrder=ClaimOrderSetting.Waiting,bulkLanes=1))
  /** `config` with the further enabled users `ids` (same synthetic credential). */
  def withUsers(config: Config,ids: String*): Config =
    config.copy(users=config.users++ids.map(id => config.users.head.copy(id=id,login=id)))
  /** A required owned database (ClaimOrderPostgres) on `config`, also emptied of rebuild cohorts, uploads and epochs; users
    * beyond a, b and c are disabled afterwards, as the next suite's start would. */
  def database(config: Config)(f: (Config,Database,PostgresArchive) => Unit): Unit = ClaimOrderPostgres.withDatabase(config) { (c,db,a) =>
    def clean(): Unit = db.transaction { x =>
      Sql.exec(x,"TRUNCATE ch_reindex_members,ch_reindex_requests,ch_uploads,ch_epochs CASCADE")
      Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id NOT IN('a','b','c')"); ()
    }
    db.transaction(x => Sql.exec(x,"TRUNCATE ch_reindex_members,ch_reindex_requests,ch_uploads,ch_epochs CASCADE"))
    try f(c,db,a) finally clean()
  }
  def database(f: (Config,Database,PostgresArchive) => Unit): Unit = database(waiting(ClaimOrderPostgres.config()))(f)

  val base: Instant = Instant.parse("2026-01-01T00:00:00Z")
  /** The stored age `second` seconds after a fixed instant. */
  def at(second: Int): String = base.plusSeconds(second.toLong).toString
  /** Sets the job's stored age and class (and a deferral's window count). */
  def order(db: Database,id: UUID,second: Int,bulk: Boolean,total: Option[Int] = None): Unit = db.transaction { c =>
    Sql.exec(c,"UPDATE ch_jobs SET waiting_since=?::timestamptz,bulk=? WHERE id=?",at(second),bulk,id)
    total.foreach(value => Sql.exec(c,"UPDATE ch_jobs SET total_windows=? WHERE id=?",value,id)); ()
  }
  /** A queued job of a new source of `owner` waiting since `second`, of class `bulk`, sized when `total` is given. */
  def job(db: Database,a: PostgresArchive,owner: String,second: Int,bulk: Boolean,total: Option[Int] = None): UUID = {
    val id=a.ingest(owner,Fixtures.snapshot()).jobId
    order(db,id,second,bulk,total); id
  }
  /** A bulk retry-failed apply of `owner` (preview, then the confirmed apply): its jobs Queued as bulk work at one now(). */
  def bulkApply(db: Database,owner: String): Long = {
    val plan=db.transaction { c => c.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ); RetryFailedJobs.preview(c,owner) }
    db.transaction(c => RetryFailedJobs(c,owner,UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true).retried)
  }
  def source(db: Database,job: UUID): UUID = db.transaction(c => Sql.one(c,"SELECT session_id FROM ch_jobs WHERE id=?",job)(_.getObject(1,classOf[UUID])).get)
  def set(db: Database,job: UUID,assignment: String): Unit = { db.transaction(c => Sql.exec(c,s"UPDATE ch_jobs SET $assignment WHERE id=?",job)); () }
  val held = "state='Queued',lease_until=clock_timestamp()+interval '1 hour',error='database-transient',transient_failures=1"
  val leased = "state='Running',attempts=attempts+1,fence=fence+1,lease_until=clock_timestamp()+interval '1 hour'"
  val leaseEnded = "state='Running',attempts=attempts+1,fence=fence+1,lease_until=clock_timestamp()-interval '1 hour'"

  def claim(a: PostgresArchive,lane: ClaimLane,scope: ClaimScope = ClaimScope.AllOwners,lease: Int = 300): ClaimOutcome = a.claimInLane(a.knownProfiles,scope,lease,lane)
  def claimed(outcome: ClaimOutcome): Claim = outcome match {
    case ClaimOutcome.Claimed(value) => value
    case other => fail(s"no claim: $other")
  }
  def taken(a: PostgresArchive,lane: ClaimLane): UUID = claimed(claim(a,lane)).jobId
  /** The claim the configured order makes (as Worker.run dispatches): today's claim under `source-id`; under `waiting` lane 0
    * where the claim may take a large job, else the first fresh lane. A test claim is never contended: no other claim runs. */
  def claimAs(config: Config,a: SessionArchive,profiles: Set[String],scope: ClaimScope,lease: Int,large: LargeJobs = LargeJobs.Admitted): Option[Claim] =
    claimIn(config.indexing.claimOrder,a,profiles,scope,lease,large)
  def claimIn(order: ClaimOrderSetting,a: SessionArchive,profiles: Set[String],scope: ClaimScope,lease: Int,large: LargeJobs = LargeJobs.Admitted): Option[Claim] = order match {
    case ClaimOrderSetting.SourceId => a.claim(profiles,scope,lease,large)
    case ClaimOrderSetting.Waiting =>
      a.claimInLane(profiles,scope,lease,if(large==LargeJobs.Admitted) lane0 else freshLane) match {
        case ClaimOutcome.Claimed(value) => Some(value)
        case ClaimOutcome.Idle => None
        case ClaimOutcome.Contended => fail("a claim without a concurrent claim was contended")
      }
  }
  /** One worker iteration of the order: today's (the permit tried per iteration), or lane 0's of the waiting order. */
  def onceIn(order: ClaimOrderSetting,worker: Worker): cats.effect.IO[Boolean] = order match {
    case ClaimOrderSetting.SourceId => worker.once
    case ClaimOrderSetting.Waiting => worker.onceInLane(lane0)
  }
  /** `config` under `order` (the waiting order on four lanes). */
  def ordered(config: Config,order: ClaimOrderSetting): Config = order match {
    case ClaimOrderSetting.SourceId => config
    case ClaimOrderSetting.Waiting => waiting(config)
  }
  final case class JobRow(state: String,attempts: Int,fence: Long,waitingSince: Option[Instant],bulk: Option[Boolean],total: Option[Int],indexingEpoch: Long)
  def row(db: Database,id: UUID): JobRow = db.transaction(c => Sql.one(c,"SELECT state,attempts,fence,waiting_since,bulk,total_windows,indexing_epoch FROM ch_jobs WHERE id=?",id) { r =>
    JobRow(r.getString(1),r.getInt(2),r.getLong(3),Option(r.getObject(4,classOf[OffsetDateTime])).map(_.toInstant),Option(r.getObject(5,classOf[java.lang.Boolean])).map(_.booleanValue),
      Option(r.getObject(6,classOf[java.lang.Integer])).map(_.intValue),r.getLong(7))
  }.get)

  /** The synthetic model provider of the worker suites: one Problem part per window, unit vectors. */
  val annotator: ScriptedAnnotator = new ScriptedAnnotator {
    def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): cats.effect.IO[ProblemPassages.Decision] =
      cats.effect.IO.pure(ProblemPassages.Decision(Vector(ProblemPassages.Part(ProblemPassages.Point(0,0),window.terminal,previous.nonEmpty,"synthetic goal",Nil))))
  }
  val embedder: Embedder = new Embedder {
    def documents(owner: String,text: List[String]): cats.effect.IO[List[List[Double]]] = cats.effect.IO.pure(text.map(_ => List(1.0,0.0,0.0)))
    def query(owner: String,text: String): cats.effect.IO[List[Double]] = cats.effect.IO.raiseError(new AssertionError("worker queried embedding"))
  }
  def worker(archive: SessionArchive,config: Config,admission: ModelAdmission,log: WorkerLog,model: ProblemPassageAnnotator = annotator,leases: Worker.Leases = Worker.Leases.production): Worker =
    new Worker(archive,model,embedder,config,IndexProfileCatalog.current(config),admission,log.logger,ModelFixtures.failureBackoff,ModelFixtures.snapshots,leases)
  /** A source of `windows` windows of the problem-passage source (ProblemPassages.maximumWindowFragments short messages each). */
  def windows(count: Int,tag: String = "synthetic"): IngestRequest = messages(count*ProblemPassages.maximumWindowFragments,tag)
  def messages(count: Int,tag: String = "synthetic"): IngestRequest = {
    val values=(0 until count).map(i => chronicle.api.Message(s"m$i",None,"user",s"$tag message $i",None,i)).toList
    val raw=values.map(m => io.circe.Json.obj("id"->io.circe.Json.fromString(m.id),"text"->io.circe.Json.fromString(m.text)).noSpaces+"\n").mkString
    Fixtures.snapshot().copy(messages=values,files=List(chronicle.api.RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  /** A further pool on the suite's database: another lane, writer or lock holder. */
  def other(c: Config): Database = new Database(c,IndexProfileCatalog.current(c))
  /** Runs `body` on a thread of its own. */
  def async[A](pool: ExecutorService)(body: => A): Future[A] = pool.submit(new Callable[A] { def call(): A = body })
  def withPool[A](threads: Int)(body: ExecutorService => A): A = {
    val pool=Executors.newFixedThreadPool(threads)
    try body(pool) finally { pool.shutdownNow(); val ended=pool.awaitTermination(60,TimeUnit.SECONDS); assert(ended,"test threads ended") }
  }
  /** Waits for `latch` (a guard against a hung run, not a timing assertion). Never inside munit's assert from a test thread:
    * its assertions synchronize on the suite. */
  def awaited(latch: java.util.concurrent.CountDownLatch,what: String): Unit = if(!latch.await(2,TimeUnit.MINUTES)) throw new AssertionError(what)
  /** Backends of this database waiting for a heavyweight or row lock, other than the asking one. */
  def lockWaits(db: Database): Int = db.transaction(c => Sql.one(c,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()")(_.getInt(1)).get)
  /** Whether `work` ends without any backend of the database waiting for a lock meanwhile: true when it ended, false at the
    * first lock wait observed while it ran (a claim that waits on another claim's lock never ends on its own). The guard only
    * bounds a hung run; the outcome is decided by the first of the two observations. */
  def endsWithoutLockWait(db: Database,work: Future[?]): Boolean = {
    val guard=Deadline.now+2.minutes
    var waited=false
    while(!work.isDone && !waited && guard.hasTimeLeft()) waited=lockWaits(db)>0
    assert(work.isDone || waited,"the work neither ended nor waited")
    !waited
  }
  /** Waits until `count` backends of the database wait for a lock at once (`work` among them); false if `work` ended first. */
  def waitersReach(db: Database,count: Int,work: Future[?]): Boolean = {
    val guard=Deadline.now+2.minutes
    var reached=false
    while(!work.isDone && !reached && guard.hasTimeLeft()) reached=lockWaits(db)>=count
    assert(work.isDone || reached,"the work neither ended nor waited")
    reached
  }
  /** Waits until some backend of the database waits for a lock (the work under test reached its lock); false if `work`
    * ended first. */
  def reachesLockWait(db: Database,work: Future[?]): Boolean = {
    val guard=Deadline.now+2.minutes
    var waiting=false
    while(!work.isDone && !waiting && guard.hasTimeLeft()) waiting=lockWaits(db)>0
    assert(work.isDone || waiting,"the work neither ended nor waited")
    waiting
  }

  /** An independent model of the waiting order (claim-order DESIGN §2), over the rows as stored: which job a lane's claim
    * takes among the jobs whose sources are not in `locked`. */
  final case class Row(job: UUID,source: UUID,owner: String,revision: Int,head: Int,tombstone: Boolean,profile: String,state: String,attempts: Int,
    leaseNull: Boolean,leasePast: Boolean,leaseAtOrPast: Boolean,indexingEpoch: Long,waitingSince: Option[Instant],bulk: Option[Boolean],total: Option[Int])
  final case class Owner(id: String,enabled: Boolean,profile: String,targetEpoch: Long,allowed: Boolean,indexingEpoch: Long)
  final case class Snapshot(rows: List[Row],owners: Map[String,Owner])
  def snapshot(db: Database,defaultEnabled: Boolean = true): Snapshot = db.transaction { c =>
    val rows=Sql.rows(c,"""SELECT j.id,s.id,s.owner,j.revision,s.revision,s.tombstone,j.profile,j.state,j.attempts,j.lease_until IS NULL,j.lease_until<clock_timestamp(),j.lease_until<=clock_timestamp(),
      j.indexing_epoch,j.waiting_since,j.bulk,j.total_windows FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id""") { r =>
      Row(r.getObject(1,classOf[UUID]),r.getObject(2,classOf[UUID]),r.getString(3),r.getInt(4),r.getInt(5),r.getBoolean(6),r.getString(7),r.getString(8),r.getInt(9),r.getBoolean(10),
        r.getBoolean(11),r.getBoolean(12),r.getLong(13),Option(r.getObject(14,classOf[OffsetDateTime])).map(_.toInstant),Option(r.getObject(15,classOf[java.lang.Boolean])).map(_.booleanValue),
        Option(r.getObject(16,classOf[java.lang.Integer])).map(_.intValue))
    }
    val owners=Sql.rows(c,"SELECT u.id,u.enabled,t.profile,t.epoch FROM ch_users u JOIN ch_owner_targets t ON t.owner=u.id")(r => (r.getString(1),r.getBoolean(2),r.getString(3),r.getLong(4))).map { (id,enabled,profile,epoch) =>
      val eligibility=ChronicleIndexing.read(c,defaultEnabled,id)
      id -> Owner(id,enabled,profile,epoch,eligibility.enabled,eligibility.epoch)
    }.toMap
    Snapshot(rows,owners)
  }
  /** `(waiting_since, session_id)` ascending as PostgreSQL orders them: NULL ages last, uuids by their bytes (canonical text). */
  given ageOrder: Ordering[Row] = Ordering.by((r: Row) => (r.waitingSince.isEmpty,r.waitingSince.getOrElse(Instant.EPOCH),r.source.toString))
  def claimable(r: Row,ownerEpoch: Long): Boolean =
    (r.state=="Running" && r.indexingEpoch!=ownerEpoch) || (r.attempts<5 && ((r.state=="Queued" && (r.leaseNull || r.leaseAtOrPast)) || (r.state=="Running" && r.leasePast)))
  def sized(r: Row): Boolean = r.state=="Queued" && r.total.nonEmpty
  /** The candidates of every lane: head job of the owner's target profile, claimable, no older revision Running (an older
    * Running one whose lease ended counts as ended: the claim's first transaction supersedes it), owner enabled and allowed. */
  def eligible(s: Snapshot,locked: Set[UUID] = Set.empty): List[Row] = {
    val running=s.rows.filter(_.state=="Running").groupBy(_.source)
    s.rows.filter { r =>
      s.owners.get(r.owner).exists(o => o.enabled && o.allowed && o.profile==r.profile && claimable(r,o.indexingEpoch)) && r.revision==r.head && !r.tombstone &&
        !locked.contains(r.source) && Set("Queued","Running").contains(r.state) &&
        !running.getOrElse(r.source,Nil).exists(o => o.profile==r.profile && o.revision<r.revision && !(o.leaseNull || o.leaseAtOrPast) &&
          s.owners.get(r.owner).forall(owner => o.indexingEpoch>=owner.indexingEpoch))
    }
  }
  /** The job `lane` takes (claim-order DESIGN §2 steps): lane 0 the oldest sized job, else the oldest of any; a class lane the
    * oldest unsized job of its class, else of the other class. */
  def expected(lane: ClaimLane,s: Snapshot,locked: Set[UUID] = Set.empty): Option[UUID] = {
    val rows=eligible(s,locked)
    val steps: List[Row => Boolean]=lane.kind match {
      case ClaimLane.Kind.Large => List(sized,_ => true)
      case ClaimLane.Kind.Bulk => List(r => r.bulk.contains(true) && !sized(r),r => r.bulk.contains(false) && !sized(r))
      case ClaimLane.Kind.Fresh => List(r => r.bulk.contains(false) && !sized(r),r => r.bulk.contains(true) && !sized(r))
    }
    steps.iterator.map(step => rows.filter(step).minOption.map(_.job)).collectFirst { case Some(id) => id }
  }
}
