package chronicle
import chronicle.api.*
import io.circe.Json
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.sql.{Connection,ResultSet}
import java.time.{Clock,Instant}
import java.time.temporal.ChronoUnit
import java.util.{Base64,UUID}
import scala.util.Try

trait ActivityIndex {
  def summary(user: UserInfo,q: ActivityQuery): ActivityResult
  def jobs(owner: String,q: ActivityJobsQuery): ActivityJobsResult
}
private[chronicle] final case class ActivitySql(text: String,args: List[Sql.Param])
private[chronicle] enum ActivityPositionKind { case Text,RevisionText,Count,Time,Uuid,Phase,Freshness,State,Lease,Classification }
private[chronicle] final case class ActivityOrder(column: String,kind: ActivityPositionKind,nullable: Boolean)
private[chronicle] final case class ActivityPosition(value: Option[String],id: String)

private[chronicle] object ActivityMetadataCorpus {
  def base(indexingAllowed: String): String = s"""WITH observed AS (SELECT ?::timestamptz AS at,?::timestamptz AS stale_at),
    reports AS (SELECT collector_id,report,received_at FROM ch_collector_progress WHERE owner=?),
    heads AS (
      SELECT s.id,s.owner,s.revision,g.revision AS indexed_revision,policy.indexing_allowed,COALESCE((
        SELECT r.collector_id FROM reports r
        WHERE i.source->>'collectorNamespace'=r.collector_id
          OR starts_with(i.source->>'collectorNamespace',r.collector_id||'/')
        ORDER BY length(r.collector_id) DESC,r.collector_id COLLATE "C" LIMIT 1
      ),i.source->>'collectorNamespace') AS collector_id
      FROM ch_sources s JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=s.revision
      CROSS JOIN LATERAL (SELECT $indexingAllowed AS indexing_allowed OFFSET 0) policy
      LEFT JOIN ch_generations g ON g.id=s.published AND policy.indexing_allowed
      WHERE s.owner=? AND NOT s.tombstone
    ),
    jobs AS (
      SELECT j.id,j.session_id,j.revision,j.profile,j.error,j.failure_stage,effective.*,
        h.collector_id,h.owner,h.revision AS head_revision,h.indexed_revision,
        j.revision=h.revision AS revision_current,j.profile=p.profile AS profile_current,
        j.revision=h.revision AND j.profile=p.profile AS is_current
      FROM heads h JOIN ch_jobs j ON j.session_id=h.id JOIN ch_owner_targets p ON p.owner=h.owner
      CROSS JOIN ${IndexedJobRead.effective("j","h.owner","h.indexing_allowed")} effective
    ),
    collectors AS (SELECT collector_id FROM reports UNION SELECT collector_id FROM heads)
    """
  def parameters(owner: String,now: Instant): List[Sql.Param] = {
    val floor=now.truncatedTo(ChronoUnit.MICROS)
    val ceiling=if(floor==now) now else floor.plus(1,ChronoUnit.MICROS)
    List[Sql.Param](floor.toString,ceiling.toString,owner,owner)
  }
}

/** The claim order a deployment runs as Activity describes it: the mode and the number of worker lanes
  * (`indexing.annotationSessions`), which decides whether today's order has a single rank for a job. */
final case class ActivityClaimOrderView(mode: ClaimOrderMode,lanes: Int)
object ActivityClaimOrderView {
  def of(config: Config): ActivityClaimOrderView = ActivityClaimOrderView(ClaimOrderMode.of(config),config.indexing.annotationSessions)
  /** Today's order with the default lanes (fixtures that do not configure a claim order). */
  val default: ActivityClaimOrderView = ActivityClaimOrderView(ClaimOrderMode.SourceId,IndexingCapacity.defaults.annotationSessions)
}

/** Why each of the viewing owner's jobs is not running, and where the claim order in force puts it (claim-order spec §7,
  * design note §6 and B6). Everything is evaluated on the STORED rows at the read's observation instant with the
  * scheduler's own predicates (`Jobs.claimable`, `Jobs.sized`, `Jobs.invalidated`, `Jobs.leased`, the claim's
  * older-Running anti-check after its `supersedeEndedLeases` phase; its `lease-exhausted` cleanup ends only jobs that
  * `Jobs.claimable` already excludes).
  * Reason precedence (first match): not current (older revision, other profile) or finished: none; owner's indexing off:
  * `IndexingOff`; a policy-invalidated attempt: `AwaitingReclaim`; a valid lease: none (running); Running without a lease:
  * `RunningWithoutLease` (no claim compares a NULL lease, no cleanup ends it); an ended lease at the attempt limit:
  * `LeaseExhaustedPending`; an ended lease: `LeaseExpiredAwaitingReclaim`; a back-off: `Held`; an older revision Running
  * that the claim's first phase keeps (valid lease, indexing epoch not behind): `BlockedByOlderRevision`; a deferred large
  * job: `AwaitingLargeLane` / `AwaitingLargePermit` by the claim order; claimable: `Queued`.
  * Whether a claim may take a job now (`candidate`) is decided independently of the reason, by the claim's own
  * predicates. Everything reads the viewing owner's own jobs (`queue`) except [[rank]], which ranks the candidates of
  * every eligible owner (`claim_queue`) and leaves only a number. */
private[chronicle] object ActivityQueueSql {
  private val at="(SELECT at FROM observed)"
  /** A scheduler predicate of [[Jobs]] at the read's observation instant rather than the statement's clock, so that a
    * response agrees with its own `observedAt` and its lease flags. */
  private def observed(fragment: String): String = {
    Check(fragment.contains("clock_timestamp()"),"internal","scheduler predicate without its clock")
    fragment.replace("clock_timestamp()",at)
  }
  val large: List[String] = List("AwaitingLargeLane","AwaitingLargePermit")
  def list(values: List[String]): String = values.map(v => s"'$v'").mkString(",")
  /** Older-revision Running jobs of `q`'s source and profile that the claim's first phase (`supersedeEndedLeases`) does not
    * end: a valid lease and an indexing epoch not behind the owner's. */
  private def blocker(q: String,epoch: String,select: String): String =
    s"(SELECT $select FROM ch_jobs o WHERE o.session_id=$q.session_id AND o.profile=$q.profile AND o.state='Running' AND o.revision<$q.revision AND ${observed(Jobs.leased("o"))} AND o.indexing_epoch>=($epoch) OFFSET 0)"
  /** The claim's candidate predicate on job `q` of an eligible owner whose indexing epoch is `epoch`: claimable and not
    * held by an older Running revision. */
  private def candidate(q: String,epoch: String): String = s"(${observed(Jobs.claimable(q,epoch))} AND NOT EXISTS${blocker(q,epoch,"1")})"
  private def reason(mode: ClaimOrderMode,epoch: String): String = {
    val large=mode match { case ClaimOrderMode.SourceId => "AwaitingLargePermit"; case ClaimOrderMode.Waiting(_) => "AwaitingLargeLane" }
    s"""CASE WHEN NOT j.is_current OR q.state NOT IN('Queued','Running') THEN NULL
      WHEN NOT h.indexing_allowed THEN 'IndexingOff'
      WHEN ${Jobs.invalidated("q",epoch)} THEN 'AwaitingReclaim'
      WHEN ${observed(Jobs.leased("q"))} THEN NULL
      WHEN q.state='Running' AND q.lease_until IS NULL THEN 'RunningWithoutLease'
      WHEN q.state='Running' AND q.attempts>=${Jobs.attemptLimit} THEN 'LeaseExhaustedPending'
      WHEN q.state='Running' THEN 'LeaseExpiredAwaitingReclaim'
      WHEN q.lease_until>$at THEN 'Held'
      WHEN older.revision IS NOT NULL THEN 'BlockedByOlderRevision'
      WHEN ${Jobs.sized("q")} THEN '$large'
      WHEN ${observed(Jobs.claimable("q",epoch))} THEN 'Queued' END"""
  }
  private val order="q.id,q.session_id,q.waiting_since,q.bulk"
  private def sizes(q: String): String = s"${Jobs.sized(q)} AS sized,COALESCE($q.total_windows>${LargeJobs.windows},false) OR ${Jobs.sized(q)} AS permit_only"
  /** `queue`: every job of the viewing owner (the `jobs` CTE of [[ActivityMetadataCorpus]]) with its order columns,
    * reason and whether a claim may take it now. `eligible` and `claim_queue`: the owners a claim visits (enabled,
    * indexing allowed, target profile among the claimed ones) with their indexing epochs, and their candidates (head job
    * of a live source) — the set the claim chooses from; `ranked`: their positions ([[rank]]), computed once per
    * statement. Parameters: the claimed profiles, after those of the corpus. */
  def cte(view: ActivityClaimOrderView,profiles: Int,allowedSql: String): String = {
    val epoch="e.epoch"
    s""", queue AS MATERIALIZED (
      SELECT $order,h.owner,${sizes("q")},CASE WHEN q.state='Queued' THEN q.lease_until END AS held_until,older.revision AS older_revision,
        ${reason(view.mode,epoch)} AS waiting,COALESCE(j.is_current AND h.indexing_allowed AND ${candidate("q",epoch)},false) AS candidate
      FROM jobs j JOIN heads h ON h.id=j.session_id JOIN ch_jobs q ON q.id=j.id
      CROSS JOIN LATERAL (SELECT ${ChronicleIndexing.epochOwnerSql("h.owner")} AS epoch OFFSET 0) e
      CROSS JOIN LATERAL ${blocker("q",epoch,"max(o.revision) AS revision")} older),
    eligible AS MATERIALIZED (
      SELECT t.owner,t.profile,${ChronicleIndexing.epochOwnerSql("t.owner")} AS epoch FROM ch_owner_targets t JOIN ch_users u ON u.id=t.owner AND u.enabled
      WHERE t.profile IN(${List.fill(profiles)("?").mkString(",")}) AND $allowedSql),
    claim_queue AS MATERIALIZED (
      SELECT $order,e.owner,${sizes("q")}
      FROM eligible e JOIN ch_sources s ON s.owner=e.owner AND NOT s.tombstone
      JOIN ch_jobs q ON q.session_id=s.id AND q.revision=s.revision AND q.profile=e.profile
      WHERE q.state IN('Queued','Running') AND ${candidate("q",epoch)}),
    ranked AS MATERIALIZED (SELECT id,${rank(view)} AS rank FROM claim_queue)"""
  }
  /** THE place where a job's position is counted (owner decision on the approved mockup, 25 Nov): how many claim
    * candidates of ALL eligible owners the order in force takes before the job — a number only: no id, title, owner or
    * other attribute of another owner's job leaves this expression. Narrowing it to the owner's own jobs (PARTITION BY
    * owner) or dropping it changes only this function. NULL (not shown) where the order in force gives no single rank:
    * - `Waiting`: a sized job — its rank among sized candidates, lane 0's preferred order; a fresh or bulk job — among
    *   the unsized candidates of its class, the order every lane takes that class in; by (waiting_since, session_id) as
    *   the claim orders them (NULLS LAST). An unclassified job (taken only by lane 0's second step, mixed with every
    *   class): none.
    * - `SourceId` (owner, then source id): with one lane (it holds the large-job permit at every claim) every candidate
    *   ranks over all; with more, only a job the permit is needed for (sized, or more than LargeJobs.windows) has a
    *   rank — over all, the order of the lane holding the permit. Another job is taken by lanes with and without the
    *   permit, whose orders differ: none. */
  def rank(view: ActivityClaimOrderView): String = view.mode match {
    case ClaimOrderMode.Waiting(_) =>
      "CASE WHEN sized OR bulk IS NOT NULL THEN row_number() OVER (PARTITION BY CASE WHEN sized THEN 'sized' WHEN bulk THEN 'bulk' ELSE 'fresh' END ORDER BY waiting_since,session_id)-1 END"
    case ClaimOrderMode.SourceId if view.lanes<=1 => "row_number() OVER (ORDER BY owner,session_id)-1"
    case ClaimOrderMode.SourceId => "CASE WHEN permit_only THEN row_number() OVER (ORDER BY owner,session_id)-1 END"
  }
  /** Of the owner's own jobs: those awaiting the large-job lane (permit), and the rank of the first of them. */
  def largeLane(view: ActivityClaimOrderView): String =
    s"""SELECT (SELECT count(*) FROM queue WHERE waiting IN(${list(large)})) AS awaiting,
      (SELECT min(r.rank) FROM queue q JOIN ranked r ON r.id=q.id WHERE q.candidate AND q.waiting IN(${list(large)})) AS large_ahead"""
  /** Per class of the owner's own current unfinished jobs: waiting for any reason, claimable now, held, awaiting reclaim,
    * the oldest wait. */
  val classes: String = s"""SELECT CASE WHEN bulk THEN 'bulk' WHEN NOT bulk THEN 'fresh' ELSE 'unclassified' END AS class,
    count(*) FILTER (WHERE waiting IS NOT NULL) AS queued,count(*) FILTER (WHERE candidate) AS claimable,
    count(*) FILTER (WHERE waiting='Held') AS held,count(*) FILTER (WHERE waiting IN('AwaitingReclaim','LeaseExpiredAwaitingReclaim')) AS awaiting_reclaim,
    min(waiting_since) FILTER (WHERE waiting IS NOT NULL) AS oldest FROM queue GROUP BY 1"""
  /** The server order of the "Why not running" column: the reasons in their precedence, then a job without one. */
  val reasonOrder: List[String] = List("IndexingOff","AwaitingReclaim","RunningWithoutLease","LeaseExhaustedPending","LeaseExpiredAwaitingReclaim","Held","BlockedByOlderRevision","AwaitingLargeLane","AwaitingLargePermit","Queued")
  def reasonOrdinal(column: String): String = s"CASE $column ${reasonOrder.zipWithIndex.map((name,i) => s"WHEN '$name' THEN ${i+1}").mkString(" ")} END"
  def waiting(value: Option[String],heldUntil: Option[Instant],older: Option[Int]): Option[ActivityJobWaiting] = value.map {
    case "Queued" => ActivityJobWaiting.Queued()
    case "IndexingOff" => ActivityJobWaiting.IndexingOff()
    case "AwaitingReclaim" => ActivityJobWaiting.AwaitingReclaim()
    case "RunningWithoutLease" => ActivityJobWaiting.RunningWithoutLease()
    case "LeaseExpiredAwaitingReclaim" => ActivityJobWaiting.LeaseExpiredAwaitingReclaim()
    case "LeaseExhaustedPending" => ActivityJobWaiting.LeaseExhaustedPending()
    case "Held" => ActivityJobWaiting.Held(heldUntil.getOrElse(throw DomainError("internal","held job without its next attempt")).toString)
    case "BlockedByOlderRevision" => ActivityJobWaiting.BlockedByOlderRevision(older.getOrElse(throw DomainError("internal","blocked job without its older revision")))
    case "AwaitingLargeLane" => ActivityJobWaiting.AwaitingLargeLane()
    case "AwaitingLargePermit" => ActivityJobWaiting.AwaitingLargePermit()
    case other => throw DomainError("internal",s"unknown waiting reason $other")
  }
  def claimOrder(mode: ClaimOrderMode): ActivityClaimOrder = mode match {
    case ClaimOrderMode.SourceId => ActivityClaimOrder.SourceId
    case ClaimOrderMode.Waiting(_) => ActivityClaimOrder.Waiting
  }
}

/** `view` is the deployment's claim order (`ActivityClaimOrderView.of(config)`, bound in ChroniclePlugin); it decides the
  * large-job reason and the rank `ahead` reports, nothing else. */
final class PostgresActivity(db: Database,clock: Clock,view: ActivityClaimOrderView=ActivityClaimOrderView.default) extends ActivityIndex {
  private val mode=view.mode
  import ActivityMetadataCorpus.parameters
  private val base=ActivityMetadataCorpus.base(ChronicleIndexing.allowsOwnerSql(db.indexingDefaultEnabled,"s.owner"))
  private val unicode="COLLATE pg_unicode_fast"
  private val aggregate = """count(*) AS total,
    count(*) FILTER (WHERE state='Queued') AS queued,
    count(*) FILTER (WHERE state='Running') AS running,
    count(*) FILTER (WHERE state='Failed') AS failed,
    count(*) FILTER (WHERE state='Complete') AS complete,
    count(*) FILTER (WHERE state='Running' AND lease_until>(SELECT at FROM observed)) AS active_running,
    count(*) FILTER (WHERE state='Running' AND lease_until<=(SELECT at FROM observed)) AS expired_running,
    count(*) FILTER (WHERE state='Running' AND lease_until IS NULL) AS unleased_running"""
  private val countColumns=List("total","queued","running","failed","complete","active_running","expired_running","unleased_running")
  private def selectedCounts(alias: String,prefix: String): String = countColumns.map(n => s"COALESCE($alias.$n,0) AS $prefix$n").mkString(",")
  private val selected=selectedCounts("c","current_")+","+selectedCounts("h","historical_")
  private def counts(r: ResultSet,prefix: String): JobCounts = JobCounts(
    r.getLong(prefix+"total"),r.getLong(prefix+"queued"),r.getLong(prefix+"running"),r.getLong(prefix+"failed"),
    r.getLong(prefix+"complete"),r.getLong(prefix+"active_running"),r.getLong(prefix+"expired_running"),r.getLong(prefix+"unleased_running")
  )
  private def reading[A](owner: String)(f: (Connection,Instant) => A): A = IndexedRead.transaction(db) { c =>
    Check(Sql.one(c,"SELECT 1 FROM ch_users WHERE id=? AND enabled",owner)(_ => true).contains(true),"unauthorized","owner disabled")
    val target=OwnerTargets.read(c,owner,false)
    db.profiles.resolve(target.profile)
    f(c,clock.instant())
  }
  private def literal(value: String): String = "%"+value.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"
  private def insensitive(column: String,value: String): ActivitySql = ActivitySql(s"COALESCE(lower(($column) $unicode)=lower(? $unicode),false)",List(value))
  private def time(column: String,value: Instant,comparison: String): ActivitySql = ActivitySql(s"COALESCE($column$comparison?::numeric,false)",List(ArchiveProjection.timestampOrder(value)))
  private def text(values: List[String],tags: Option[String],value: String): ActivitySql = {
    val p=literal(value)
    val scalars=values.map(v => s"($v)").mkString(",")
    val first=s"EXISTS(SELECT 1 FROM (VALUES $scalars) searched(value) WHERE lower(searched.value $unicode) LIKE lower(? $unicode) ESCAPE '\\')"
    tags match {
      case None => ActivitySql(first,List(p))
      case Some(column) => ActivitySql(s"($first OR EXISTS(SELECT 1 FROM jsonb_array_elements_text($column) tagged(value) WHERE lower(tagged.value $unicode) LIKE lower(? $unicode) ESCAPE '\\'))",List(p,p))
    }
  }
  private def expression[P](value: BooleanExpression[P],field: P => ActivitySql,bare: String => ActivitySql): ActivitySql = value match {
    case BooleanExpression.True => ActivitySql("true",Nil)
    case BooleanExpression.Text(value) => bare(value)
    case BooleanExpression.Field(value) => field(value)
    case BooleanExpression.And(left,right) => combine(expression(left,field,bare),expression(right,field,bare),"AND")
    case BooleanExpression.Or(left,right) => combine(expression(left,field,bare),expression(right,field,bare),"OR")
    case BooleanExpression.Not(value) => val nested=expression(value,field,bare); ActivitySql(s"NOT (${nested.text})",nested.args)
  }
  private def combine(left: ActivitySql,right: ActivitySql,operator: String): ActivitySql = ActivitySql(s"(${left.text} $operator ${right.text})",left.args++right.args)
  private val classification="CASE WHEN j.is_current THEN 'Current' WHEN j.revision_current THEN 'ObsoleteProfile' WHEN j.profile_current THEN 'SupersededRevision' ELSE 'SupersededRevisionAndProfile' END"
  private val lease="CASE WHEN j.lease_until IS NULL THEN 'unleased' WHEN j.state<>'Running' THEN 'inactive' WHEN j.lease_until>(SELECT at FROM observed) THEN 'active' ELSE 'expired' END"
  private def jobPredicate(value: ActivityJobPredicate): ActivitySql = value match {
    case ActivityJobPredicate.Source(value) => value match {
      case ArchivePredicate.User(value) => ActivitySql("j.owner=?",List(value))
      case ArchivePredicate.Tag(value) => ActivitySql(s"EXISTS(SELECT 1 FROM jsonb_array_elements_text(j.metadata->'tags') item(tag) WHERE lower(item.tag $unicode)=lower(? $unicode))",List(value))
      case ArchivePredicate.Project(value) => insensitive("j.metadata->>'project'",value)
      case ArchivePredicate.Branch(value) => insensitive("j.metadata->>'gitBranch'",value)
      case ArchivePredicate.Producer(value) => insensitive("j.metadata->>'producer'",value)
      case ArchivePredicate.Model(value) => insensitive("j.metadata->>'model'",value)
      case ArchivePredicate.YoloProfile(value) => ActivitySql(s"COALESCE((${RecordedYoloProfile.sql("j.source")}) COLLATE \"C\"=? COLLATE \"C\",false)",List(value))
      case ArchivePredicate.Format(value) => insensitive("j.source->>'format'",value.toString)
      case ArchivePredicate.Agent(value) => ActivitySql(AgentKind.sql("j.source",value),Nil)
      case ArchivePredicate.Status(ArchiveStatus.Unscheduled) => throw DomainError("internal","unscheduled predicate reached job query")
      case ArchivePredicate.Status(value) => ActivitySql("j.state=?",List(value.toString))
      case ArchivePredicate.After(value) => time("j.last_timestamp_order",value,">=")
      case ArchivePredicate.Before(value) => time("j.last_timestamp_order",value,"<")
    }
    case ActivityJobPredicate.Collector(value) => ActivitySql("j.collector_id=?",List(value))
    case ActivityJobPredicate.Profile(value) => ActivitySql("j.profile=?",List(value))
    case ActivityJobPredicate.Classification(value) => ActivitySql(s"($classification)=?",List(value.toString))
    case ActivityJobPredicate.Reason(value) => insensitive("j.error",value)
    case ActivityJobPredicate.Lease(value) => ActivitySql(s"($lease)=?",List(value.toString.toLowerCase(java.util.Locale.ROOT)))
  }
  private def collectorPredicate(value: ActivityCollectorPredicate): ActivitySql = value match {
    case ActivityCollectorPredicate.Collector(value) => ActivitySql("c.collector_id=?",List(value))
    case ActivityCollectorPredicate.Phase(value) => ActivitySql("COALESCE(c.phase=?,false)",List(value.toString))
    case ActivityCollectorPredicate.Freshness(value) => ActivitySql("c.freshness=?",List(value.toString.toLowerCase(java.util.Locale.ROOT)))
    case ActivityCollectorPredicate.After(value) => time("EXTRACT(epoch FROM c.received_at)",value,">=")
    case ActivityCollectorPredicate.Before(value) => time("EXTRACT(epoch FROM c.received_at)",value,"<")
  }
  private def collectorOrder(sort: ActivityCollectorSort): ActivityOrder = {
    def number(column: String): ActivityOrder = ActivityOrder("c."+column,ActivityPositionKind.Count,false)
    sort match {
      case ActivityCollectorSort.CollectorId => ActivityOrder("c.collector_id COLLATE \"C\"",ActivityPositionKind.Text,false)
      case ActivityCollectorSort.Phase => ActivityOrder(s"lower(c.phase $unicode)",ActivityPositionKind.Phase,true)
      case ActivityCollectorSort.Freshness => ActivityOrder("c.freshness",ActivityPositionKind.Freshness,false)
      case ActivityCollectorSort.ReceivedAt => ActivityOrder("EXTRACT(epoch FROM c.received_at)",ActivityPositionKind.Time,true)
      case ActivityCollectorSort.ArchiveHeads => number("archive_heads")
      case ActivityCollectorSort.HeadsWithoutTargetJob => number("without_target")
      case ActivityCollectorSort.CurrentTotal => number("current_total")
      case ActivityCollectorSort.CurrentQueued => number("current_queued")
      case ActivityCollectorSort.CurrentRunning => number("current_running")
      case ActivityCollectorSort.CurrentFailed => number("current_failed")
      case ActivityCollectorSort.CurrentComplete => number("current_complete")
      case ActivityCollectorSort.CurrentActiveRunning => number("current_active_running")
      case ActivityCollectorSort.CurrentExpiredRunning => number("current_expired_running")
      case ActivityCollectorSort.CurrentUnleasedRunning => number("current_unleased_running")
      case ActivityCollectorSort.HistoricalTotal => number("historical_total")
      case ActivityCollectorSort.HistoricalQueued => number("historical_queued")
      case ActivityCollectorSort.HistoricalRunning => number("historical_running")
      case ActivityCollectorSort.HistoricalFailed => number("historical_failed")
      case ActivityCollectorSort.HistoricalComplete => number("historical_complete")
      case ActivityCollectorSort.HistoricalActiveRunning => number("historical_active_running")
      case ActivityCollectorSort.HistoricalExpiredRunning => number("historical_expired_running")
      case ActivityCollectorSort.HistoricalUnleasedRunning => number("historical_unleased_running")
    }
  }
  private def jobOrder(sort: ActivityJobSort): ActivityOrder = sort match {
    case ActivityJobSort.LastTimestamp => ActivityOrder("j.last_timestamp_order",ActivityPositionKind.Time,true)
    case ActivityJobSort.Title => ActivityOrder(s"lower((j.metadata->>'title') $unicode)",ActivityPositionKind.RevisionText,false)
    case ActivityJobSort.Collector => ActivityOrder("j.collector_id COLLATE \"C\"",ActivityPositionKind.Text,false)
    case ActivityJobSort.State => ActivityOrder(s"lower(j.state $unicode)",ActivityPositionKind.State,false)
    case ActivityJobSort.Revision => ActivityOrder("j.revision",ActivityPositionKind.Count,false)
    case ActivityJobSort.Profile => ActivityOrder("j.profile COLLATE \"C\"",ActivityPositionKind.Text,false)
    case ActivityJobSort.Attempts => ActivityOrder("j.attempts",ActivityPositionKind.Count,false)
    case ActivityJobSort.CompletedWindows => ActivityOrder("j.completed_windows",ActivityPositionKind.Count,false)
    case ActivityJobSort.TotalWindows => ActivityOrder("j.total_windows",ActivityPositionKind.Count,true)
    case ActivityJobSort.LeaseExpiresAt => ActivityOrder("EXTRACT(epoch FROM j.lease_until)",ActivityPositionKind.Time,true)
    case ActivityJobSort.LeaseState => ActivityOrder(lease,ActivityPositionKind.Lease,false)
    case ActivityJobSort.Reason => ActivityOrder(s"lower(j.error $unicode)",ActivityPositionKind.Text,true)
    case ActivityJobSort.Classification => ActivityOrder(s"lower(($classification) $unicode)",ActivityPositionKind.Classification,false)
    case ActivityJobSort.JobId => ActivityOrder("j.id::text COLLATE \"C\"",ActivityPositionKind.Uuid,false)
    case ActivityJobSort.SessionId => ActivityOrder("j.session_id::text COLLATE \"C\"",ActivityPositionKind.Uuid,false)
    case ActivityJobSort.WaitingSince => ActivityOrder("EXTRACT(epoch FROM j.waiting_since)",ActivityPositionKind.Time,true)
    case ActivityJobSort.JobClass => ActivityOrder("CASE WHEN j.bulk THEN 'bulk' WHEN NOT j.bulk THEN 'fresh' END",ActivityPositionKind.Text,true)
    case ActivityJobSort.WaitingReason => ActivityOrder(ActivityQueueSql.reasonOrdinal("j.waiting"),ActivityPositionKind.Count,true)
  }
  private def seek(position: Option[ActivityPosition],order: ActivityOrder,direction: SortDirection,id: String,uuid: Boolean): ActivitySql = position match {
    case None => ActivitySql("true",Nil)
    case Some(value) =>
      val identifier: Sql.Param=if(uuid) UUID.fromString(value.id) else value.id
      value.value match {
        case None => ActivitySql(s"r.sort_key IS NULL AND $id>?",List(identifier))
        case Some(key) =>
          val cast=if(order.kind==ActivityPositionKind.Count || order.kind==ActivityPositionKind.Time) "::numeric" else ""
          val comparison=if(direction==SortDirection.Asc) ">" else "<"
          ActivitySql(s"(r.sort_key $comparison ?$cast OR (r.sort_key=?$cast AND $id>?) OR r.sort_key IS NULL)",List(key,key,identifier))
      }
  }
  private def pageSql(ctes: String,predicate: ActivitySql,order: ActivityOrder,seek: ActivitySql,direction: SortDirection,id: String): String = {
    val directionSql=if(direction==SortDirection.Asc) "ASC" else "DESC"
    s"$ctes, filtered AS MATERIALIZED(SELECT c.*,${order.column} AS sort_key FROM collector_rows c WHERE (${predicate.text})) SELECT counted.total,page.*,page.sort_key::text AS sort_value FROM (SELECT count(*) AS total FROM filtered) counted LEFT JOIN LATERAL(SELECT r.* FROM filtered r WHERE (${seek.text}) ORDER BY r.sort_key $directionSql NULLS LAST,$id LIMIT ?) page ON true ORDER BY page.sort_key $directionSql NULLS LAST,page.collector_id COLLATE \"C\""
  }
  /** The claimed profiles, as the worker's claim passes them. */
  private val claimed=db.profiles.knownProfiles.toList.sorted
  private val queueCte=ActivityQueueSql.cte(view,claimed.size,ChronicleIndexing.allowsOwnerSql(db.indexingDefaultEnabled,"t.owner"))
  private def queueParameters(owner: String,now: Instant): List[Sql.Param] = parameters(owner,now)++claimed
  /** One statement: a row per class of the owner's jobs (or one row of NULLs without any), each also carrying the owner's
    * jobs awaiting the large-job lane and the position of the first. */
  private def queue(c: Connection,owner: String,now: Instant): ActivityQueue = {
    val empty=ActivityClassQueue(0,0,0,0,None)
    val rows=Sql.rows(c,base+queueCte+s""", classes AS (${ActivityQueueSql.classes})
      , lane AS (${ActivityQueueSql.largeLane(view)})
      SELECT classes.*,lane.awaiting,lane.large_ahead FROM lane LEFT JOIN classes ON true""",queueParameters(owner,now)*) { r =>
      val counts=Option(r.getString("class")).map(_ -> ActivityClassQueue(r.getLong("queued"),r.getLong("claimable"),r.getLong("held"),r.getLong("awaiting_reclaim"),Option(r.getTimestamp("oldest")).map(_.toInstant.toString)))
      (counts,r.getLong("awaiting"),Option(r.getObject("large_ahead",classOf[java.lang.Long])).map(_.longValue))
    }
    val classes=rows.flatMap(_._1).toMap
    ActivityQueue(ActivityQueueSql.claimOrder(mode),classes.getOrElse("fresh",empty),classes.getOrElse("bulk",empty),classes.getOrElse("unclassified",empty),rows.head._2,rows.head._3)
  }
  private final case class Totals(archiveHeads: Long,withoutTarget: Long,current: JobCounts,historical: JobCounts,collectors: Long)
  def summary(user: UserInfo,q: ActivityQuery): ActivityResult = {
    ActivityCursor.page(q.limit)
    val parsed=ActivityExpression.collectors(q.expression)
    val order=collectorOrder(q.sort)
    val position=ActivityCursor.collector(q,user.id,order)
    reading(user.id) { (c,now) =>
      val params=parameters(user.id,now)
      val totals=Sql.one(c,base+s""", head_counts AS (
        SELECT count(*) AS archive_heads,
          count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.session_id=heads.id AND j.is_current)) AS without_target FROM heads
      ), job_counts AS (SELECT is_current,$aggregate FROM jobs GROUP BY is_current)
      SELECT a.*,(SELECT count(*) FROM collectors) AS total_collectors,$selected
      FROM head_counts a LEFT JOIN job_counts c ON c.is_current LEFT JOIN job_counts h ON NOT h.is_current""",params*) { r =>
        Totals(r.getLong("archive_heads"),r.getLong("without_target"),counts(r,"current_"),counts(r,"historical_"),r.getLong("total_collectors"))
      }.get
      val rowsBase=base+s""", head_counts AS (
        SELECT collector_id,count(*) AS archive_heads,
          count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.session_id=heads.id AND j.is_current)) AS without_target FROM heads GROUP BY collector_id
      ), job_counts AS (SELECT collector_id,is_current,$aggregate FROM jobs GROUP BY collector_id,is_current),
      collector_rows AS (SELECT p.collector_id,r.report,r.received_at,r.report->>'phase' AS phase,r.report->>'error' AS report_error,
        CASE WHEN r.report IS NULL THEN 'unknown' WHEN r.received_at<(SELECT stale_at FROM observed)-make_interval(secs=>${CollectorProgress.staleSeconds}) THEN 'stale' ELSE 'recent' END AS freshness,
        COALESCE(a.archive_heads,0) AS archive_heads,COALESCE(a.without_target,0) AS without_target,$selected
        FROM collectors p LEFT JOIN reports r ON r.collector_id=p.collector_id LEFT JOIN head_counts a ON a.collector_id=p.collector_id
        LEFT JOIN job_counts c ON c.collector_id=p.collector_id AND c.is_current LEFT JOIN job_counts h ON h.collector_id=p.collector_id AND NOT h.is_current)"""
      val predicate=expression(parsed,collectorPredicate,value => text(List("c.collector_id","c.phase","c.freshness","c.report_error"),None,value))
      val cursor=seek(position,order,q.direction,"r.collector_id COLLATE \"C\"",false)
      val sql=pageSql(rowsBase,predicate,order,cursor,q.direction,"r.collector_id COLLATE \"C\"")
      val rows=Sql.rows(c,sql,(params++predicate.args++cursor.args++List(q.limit+1))*) { r =>
        val row=Option(r.getString("collector_id")).map { id =>
          val status=Option(r.getString("report")).map { report =>
            val received=r.getTimestamp("received_at").toInstant
            CollectorStatus(Wire.decode(CollectorProgressUpdate.codecJson,Wire.parse(report)),received.toString,now.isAfter(received.plusSeconds(CollectorProgress.staleSeconds)))
          }
          (ActivityCollector(id,status,r.getLong("archive_heads"),r.getLong("without_target"),counts(r,"current_"),counts(r,"historical_")),Option(r.getString("sort_value")))
        }
        (r.getLong("total"),row)
      }
      val values=rows.flatMap(_._2); val page=values.take(q.limit)
      val next=if(values.size>q.limit) Some(ActivityCursor.encodeCollector(q,user.id,order,ActivityPosition(page.last._2,page.last._1.collectorId))) else None
      ActivityResult(now.toString,user,totals.archiveHeads,totals.withoutTarget,totals.current,totals.historical,page.map(_._1),rows.head._1,totals.collectors,next,Some(queue(c,user.id,now)))
    }
  }
  def jobs(owner: String,q: ActivityJobsQuery): ActivityJobsResult = {
    ActivityCursor.page(q.limit); q.collectorId.foreach(ActivityCursor.collectorId)
    val parsed=ActivityExpression.jobs(q.expression)
    val order=jobOrder(q.sort)
    reading(owner) { (c,now) =>
      val position=ActivityCursor.job(q,owner,order,(id,anchor) =>
        Sql.one(c,s"""SELECT lower((i.metadata->>'title') $unicode) FROM ch_jobs j
          JOIN ch_sources s ON s.id=j.session_id
          JOIN ch_revision_info i ON i.session_id=j.session_id AND i.revision=j.revision
          WHERE j.id=? AND j.revision=? AND s.owner=? AND NOT s.tombstone""",id,anchor.revision,owner)(r => Option(r.getString(1)))
          .getOrElse(throw DomainError("conflict","sort cursor anchor unavailable; restart query")))
      val scope=q.scope match {
        case ActivityJobScope.Current => ActivitySql("j.is_current",Nil)
        case ActivityJobScope.Historical => ActivitySql("NOT j.is_current",Nil)
        case ActivityJobScope.All => ActivitySql("true",Nil)
      }
      val predicate=expression(parsed,jobPredicate,value => text(List("j.id::text","j.session_id::text","j.collector_id","j.state","j.revision::text","j.profile","j.attempts::text","j.completed_windows::text","j.total_windows::text","j.error",classification,lease,"j.last_timestamp","j.metadata->>'title'","j.metadata->>'project'","j.metadata->>'gitBranch'","j.metadata->>'producer'","j.metadata->>'model'","j.source->>'format'"),Some("j.metadata->'tags'"),value))
      val collector=q.collectorId.fold(ActivitySql("true",Nil))(value => ActivitySql("j.collector_id=?",List(value)))
      val filter=combine(combine(scope,collector,"AND"),predicate,"AND")
      val cursor=seek(position,order,q.direction,"r.id",true)
      val directionSql=if(q.direction==SortDirection.Asc) "ASC" else "DESC"
      val sql=base+queueCte+s""", job_rows AS (SELECT j.*,i.metadata,i.source,i.completion,i.redacted,i.last_timestamp,i.last_timestamp_order,
          q.waiting_since,q.bulk,q.held_until,q.older_revision,q.waiting,q.candidate
        FROM jobs j JOIN ch_revision_info i ON i.session_id=j.session_id AND i.revision=j.revision JOIN queue q ON q.id=j.id),
        filtered AS MATERIALIZED(SELECT j.*,${order.column} AS sort_key FROM job_rows j WHERE (${filter.text}))
        SELECT counted.total,page.*,page.sort_key::text AS sort_value,CASE WHEN page.candidate THEN ranked.rank END AS ahead FROM (SELECT count(*) AS total FROM filtered) counted
        LEFT JOIN LATERAL(SELECT r.* FROM filtered r WHERE (${cursor.text}) ORDER BY r.sort_key $directionSql NULLS LAST,r.id LIMIT ?) page ON true
        LEFT JOIN ranked ON ranked.id=page.id
        ORDER BY page.sort_key $directionSql NULLS LAST,page.id"""
      val rows=Sql.rows(c,sql,(queueParameters(owner,now)++filter.args++cursor.args++List(q.limit+1))*) { r =>
        val row=Option(r.getObject("id",classOf[UUID])).map { id =>
          val state=JobState.parse(r.getString("state")).get
          val classification=(r.getBoolean("revision_current"),r.getBoolean("profile_current")) match {
            case (true,true) => ActivityJobClass.Current
            case (false,true) => ActivityJobClass.SupersededRevision
            case (true,false) => ActivityJobClass.ObsoleteProfile
            case (false,false) => ActivityJobClass.SupersededRevisionAndProfile
          }
          val lease=Option(r.getTimestamp("lease_until")).map(_.toInstant)
          val job=JobInfo(id,r.getObject("session_id",classOf[UUID]),r.getInt("revision"),state,r.getInt("attempts"),Option(r.getString("error")),r.getInt("completed_windows"),Option(r.getObject("total_windows",classOf[java.lang.Integer])).map(_.intValue),Option(r.getString("failure_stage")).map(IndexingFailureStage.parse(_).getOrElse(throw DomainError("internal","invalid persisted failure stage"))))
          val indexed=Option(r.getObject("indexed_revision",classOf[java.lang.Integer])).map(_.intValue)
          val session=SessionInfo(ContentView(job.revision,None),job.sessionId,owner,r.getInt("head_revision"),indexed,Wire.decode(Metadata.codecJson,Sql.json(r,"metadata")),Wire.decode(SourceIdentity.codecJson,Sql.json(r,"source")),Completion.parse(r.getString("completion")).get,r.getBoolean("redacted"))
          (ActivityJob(job,r.getString("profile"),classification,lease.map(_.toString),state==JobState.Running && lease.exists(_.isAfter(now)),classification==ActivityJobClass.Current && state==JobState.Failed,r.getString("collector_id"),session,Option(r.getString("last_timestamp")),
            Option(r.getTimestamp("waiting_since")).map(_.toInstant.toString),Option(r.getObject("bulk",classOf[java.lang.Boolean])).map(_.booleanValue),
            ActivityQueueSql.waiting(Option(r.getString("waiting")),Option(r.getTimestamp("held_until")).map(_.toInstant),Option(r.getObject("older_revision",classOf[java.lang.Integer])).map(_.intValue)),Option(r.getObject("ahead",classOf[java.lang.Long])).map(_.longValue)),Option(r.getString("sort_value")))
        }
        (r.getLong("total"),row)
      }
      val values=rows.flatMap(_._2); val page=values.take(q.limit)
      val next=if(values.size>q.limit) Some(ActivityCursor.encodeJob(q,owner,order,ActivityPosition(page.last._2,page.last._1.job.id.toString),page.last._1.job.revision)) else None
      ActivityJobsResult(now.toString,page.map(_._1),rows.head._1,next,Some(ActivityQueueSql.claimOrder(mode)))
    }
  }
}

private[chronicle] object ActivityCursor {
  private val maximumPageSize=100
  private val maximumCollectorIdLength=256
  def page(limit: Int): Unit = Check(limit>=1 && limit<=maximumPageSize,"invalid","invalid page bounds")
  def collectorId(id: String): Unit = Check(id.nonEmpty && id.length<=maximumCollectorIdLength && scalar(id),"invalid","invalid collector ID")
  private def scalar(value: String): Boolean = !value.contains('\u0000') && UTF_8.newEncoder().canEncode(value)
  private def invalid[A]: A = throw DomainError("invalid","invalid activity cursor")
  private def decode(value: String): Vector[Json] = {
    Check(value.nonEmpty,"invalid","invalid activity cursor")
    val text=Try(UTF_8.newDecoder().decode(ByteBuffer.wrap(Base64.getUrlDecoder.decode(value))).toString).getOrElse(invalid)
    Wire.parse(text).asArray.getOrElse(invalid)
  }
  private def binding(kind: String,owner: String,expression: String,sort: String,direction: SortDirection,order: ActivityOrder,extra: List[Json]): Vector[Json] =
    Vector(kind,Wire.hash(owner),Wire.hash(expression),sort,direction.toString,order.kind.toString).map(Json.fromString)++extra
  private def collectorBinding(q: ActivityQuery,owner: String,order: ActivityOrder): Vector[Json] = binding("activity-collectors-v3",owner,q.expression,q.sort.toString,q.direction,order,Nil)
  private def jobBinding(q: ActivityJobsQuery,owner: String,order: ActivityOrder): Vector[Json] = binding("activity-jobs-v3",owner,q.expression,q.sort.toString,q.direction,order,List(Json.fromString(q.scope.toString),q.collectorId.fold(Json.Null)(Json.fromString)))
  private def key(value: Option[String],order: ActivityOrder): Unit = {
    Check(order.nullable || value.nonEmpty,"invalid","invalid null activity position")
    value.foreach { value =>
      Check(scalar(value),"invalid","invalid activity position text")
      val valid=order.kind match {
        case ActivityPositionKind.Text | ActivityPositionKind.RevisionText => true
        case ActivityPositionKind.Count => value.matches("[0-9]{1,19}") && Try(value.toLong).toOption.exists(_>=0)
        case ActivityPositionKind.Time => value.matches("-?[0-9]{1,19}(\\.[0-9]{1,9})?")
        case ActivityPositionKind.Uuid => Try(UUID.fromString(value)).toOption.exists(_.toString==value)
        case ActivityPositionKind.Phase => CollectorPhase.all.map(_.toString.toLowerCase(java.util.Locale.ROOT)).contains(value)
        case ActivityPositionKind.Freshness => Set("recent","stale","unknown").contains(value)
        case ActivityPositionKind.State => JobState.all.map(_.toString.toLowerCase(java.util.Locale.ROOT)).contains(value)
        case ActivityPositionKind.Lease => Set("active","expired","unleased","inactive").contains(value)
        case ActivityPositionKind.Classification => ActivityJobClass.all.map(_.toString.toLowerCase(java.util.Locale.ROOT)).contains(value)
      }
      Check(valid,"invalid","invalid activity position value")
    }
  }
  private def position(value: String,expected: Vector[Json],order: ActivityOrder,uuid: Boolean,resolve: (String,RevisionSortAnchor) => Option[String]): ActivityPosition = {
    val fields=decode(value)
    Check(fields.size==expected.size+2 && fields.take(expected.size)==expected,"invalid","activity cursor does not match query")
    val id=fields.last.asString.getOrElse(invalid)
    if(uuid) Check(Try(UUID.fromString(id)).toOption.exists(_.toString==id),"invalid","invalid job cursor ID") else collectorId(id)
    val selected=fields(expected.size)
    val last=if(order.kind==ActivityPositionKind.RevisionText) {
      val anchor=RevisionSortAnchor.decode(selected)
      RevisionSortAnchor.resolve(anchor,resolve(id,anchor))
    } else if(selected.isNull) None else Some(selected.asString.getOrElse(invalid))
    key(last,order)
    ActivityPosition(last,id)
  }
  private def encode(expected: Vector[Json],order: ActivityOrder,position: ActivityPosition,anchor: Option[RevisionSortAnchor]): String = {
    key(position.value,order)
    val selected=anchor.fold(position.value.fold(Json.Null)(Json.fromString))(RevisionSortAnchor.encode)
    val json=Json.fromValues(expected++Vector(selected,Json.fromString(position.id)))
    Base64.getUrlEncoder.withoutPadding.encodeToString(json.noSpaces.getBytes(UTF_8))
  }
  def collector(q: ActivityQuery,owner: String,order: ActivityOrder): Option[ActivityPosition] = q.cursor.map(position(_,collectorBinding(q,owner,order),order,false,(_,_) => invalid))
  def job(q: ActivityJobsQuery,owner: String,order: ActivityOrder,resolve: (UUID,RevisionSortAnchor) => Option[String]): Option[ActivityPosition] =
    q.cursor.map(position(_,jobBinding(q,owner,order),order,true,(id,anchor) => resolve(UUID.fromString(id),anchor)))
  def encodeCollector(q: ActivityQuery,owner: String,order: ActivityOrder,position: ActivityPosition): String = encode(collectorBinding(q,owner,order),order,position,None)
  def encodeJob(q: ActivityJobsQuery,owner: String,order: ActivityOrder,position: ActivityPosition,revision: Int): String = {
    val anchor=if(order.kind==ActivityPositionKind.RevisionText) Some(RevisionSortAnchor.capture(revision,position.value)) else None
    encode(jobBinding(q,owner,order),order,position,anchor)
  }
}
