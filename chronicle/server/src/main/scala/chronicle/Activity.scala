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

/** Why each of the viewing owner's jobs is not running, and where the claim order in force puts it (claim-order spec §7,
  * design note §6 and B6). The reason is the scheduler's own predicates (`Jobs.claimable`, `Jobs.sized`,
  * `Jobs.invalidated`, `Jobs.leased`) on the STORED row, evaluated at the read's observation instant, in this precedence:
  * a job that is not current (older revision, other profile) or finished has none; an owner whose indexing is off:
  * `IndexingOff`; then a policy-invalidated attempt (`AwaitingReclaim`), a valid lease (running: none), an ended lease
  * (`LeaseExhaustedPending` at the attempt limit, else `LeaseExpiredAwaitingReclaim`: never shown as running), a back-off
  * (`Held`), an older revision still Running (`BlockedByOlderRevision`), a deferred large job (`AwaitingLargeLane` /
  * `AwaitingLargePermit` by the claim order), claimable (`Queued`). Everything here reads the viewing owner's own jobs
  * (`queue`) except [[ahead]], which COUNTS the candidates of every eligible owner (`claim_queue`) and returns nothing
  * else of them. */
private[chronicle] object ActivityQueueSql {
  private val at="(SELECT at FROM observed)"
  /** A scheduler predicate of [[Jobs]] at the read's observation instant rather than the statement's clock, so that a
    * response agrees with its own `observedAt` and its lease flags. */
  private def observed(fragment: String): String = {
    Check(fragment.contains("clock_timestamp()"),"internal","scheduler predicate without its clock")
    fragment.replace("clock_timestamp()",at)
  }
  /** The reasons under which a claim of the job's order may take it now. */
  val candidates: List[String] = List("Queued","AwaitingLargeLane","AwaitingLargePermit","LeaseExpiredAwaitingReclaim","AwaitingReclaim")
  val large: List[String] = List("AwaitingLargeLane","AwaitingLargePermit")
  def list(values: List[String]): String = values.map(v => s"'$v'").mkString(",")
  /** The reason of stored job `q` with `older` (the newest older revision of its source and profile still Running), for a
    * job whose currency and owner eligibility are the SQL expressions `current` and `allowed`. */
  private def reason(mode: ClaimOrderMode,current: String,allowed: String,owner: String): String = {
    val epoch=ChronicleIndexing.epochOwnerSql(owner)
    val large=mode match { case ClaimOrderMode.SourceId => "AwaitingLargePermit"; case ClaimOrderMode.Waiting(_) => "AwaitingLargeLane" }
    s"""CASE WHEN NOT ($current) OR q.state NOT IN('Queued','Running') THEN NULL
      WHEN NOT ($allowed) THEN 'IndexingOff'
      WHEN ${Jobs.invalidated("q",epoch)} THEN 'AwaitingReclaim'
      WHEN ${observed(Jobs.leased("q"))} THEN NULL
      WHEN q.state='Running' AND q.attempts>=${Jobs.attemptLimit} THEN 'LeaseExhaustedPending'
      WHEN q.state='Running' THEN 'LeaseExpiredAwaitingReclaim'
      WHEN q.lease_until>$at THEN 'Held'
      WHEN older.revision IS NOT NULL THEN 'BlockedByOlderRevision'
      WHEN ${Jobs.sized("q")} THEN '$large'
      WHEN ${observed(Jobs.claimable("q",epoch))} THEN 'Queued' END"""
  }
  private def columns(mode: ClaimOrderMode,current: String,allowed: String,owner: String): String =
    s"""q.id,q.session_id,$owner AS owner,q.waiting_since,q.bulk,${Jobs.sized("q")} AS sized,
      COALESCE(q.total_windows>${LargeJobs.windows},false) OR ${Jobs.sized("q")} AS permit_only,
      CASE WHEN q.state='Queued' THEN q.lease_until END AS held_until,older.revision AS older_revision,${reason(mode,current,allowed,owner)} AS waiting"""
  private val older="CROSS JOIN LATERAL (SELECT max(o.revision) AS revision FROM ch_jobs o WHERE o.session_id=q.session_id AND o.profile=q.profile AND o.state='Running' AND o.revision<q.revision) older"
  /** `queue`: every job of the viewing owner (the `jobs` CTE of [[ActivityMetadataCorpus]]) with its order columns and
    * reason. `claim_queue`: the claim candidates of every eligible owner (enabled, indexing allowed, target profile among
    * the claimed ones, head job of a live source), the set the claim of [[Database]] chooses from; read only by [[ahead]].
    * Its parameters are the claimed profiles, after those of the corpus. */
  def cte(mode: ClaimOrderMode,profiles: Int,allowedSql: String): String = s""", queue AS MATERIALIZED (
      SELECT reasoned.*,reasoned.waiting IN(${list(candidates)}) IS TRUE AS candidate FROM (
        SELECT ${columns(mode,"j.is_current","h.indexing_allowed","h.owner")}
        FROM jobs j JOIN heads h ON h.id=j.session_id JOIN ch_jobs q ON q.id=j.id $older) reasoned),
    claim_queue AS MATERIALIZED (
      SELECT reasoned.* FROM (
        SELECT ${columns(mode,"true","true","s.owner")}
        FROM ch_sources s JOIN ch_users u ON u.id=s.owner AND u.enabled JOIN ch_owner_targets t ON t.owner=s.owner
        JOIN ch_jobs q ON q.session_id=s.id AND q.revision=s.revision AND q.profile=t.profile $older
        WHERE NOT s.tombstone AND q.state IN('Queued','Running') AND t.profile IN(${List.fill(profiles)("?").mkString(",")}) AND $allowedSql) reasoned
      WHERE reasoned.waiting IN(${list(candidates)}))"""
  /** THE place where a job's position is counted (owner decision on the approved mockup, 25 Nov): the number of claim
    * candidates of ALL eligible owners that the order in force takes before `row` — a count only: no id, title, owner or
    * other attribute of another owner's job leaves this function. Narrowing it to the owner's own jobs (`queue` instead
    * of `claim_queue`) or dropping it changes only this function. NULL (not shown) for a job that is not a candidate,
    * and where the order is not one in use: an unclassified job (NULL `bulk`, an older image's row before the reseed)
    * under `Waiting`.
    * - `Waiting`: a sized job — sized candidates before it in lane 0's order; a fresh or bulk job — unsized candidates
    *   of its class before it in its class lane's order; both by (waiting_since NULLS LAST, session_id).
    * - `SourceId` (today's order: owner id, then source id): a job only the large-job permit may take (sized, or more
    *   than LargeJobs.windows) — every candidate before it, the order of the lane holding the permit; any other job —
    *   the candidates before it that a lane without the permit takes (it passes the permit-only ones). */
  def ahead(mode: ClaimOrderMode,row: String): String = {
    val o="ahead_of"
    val (shown,before)=mode match {
      case ClaimOrderMode.SourceId =>
        (s"$row.candidate",s"($row.permit_only OR NOT $o.permit_only) AND ($o.owner<$row.owner OR ($o.owner=$row.owner AND $o.session_id<$row.session_id))")
      case ClaimOrderMode.Waiting(_) =>
        val order=s"CASE WHEN $row.sized THEN $o.sized ELSE NOT $o.sized AND $o.bulk=$row.bulk END"
        val earlier=s"""CASE WHEN $o.waiting_since IS NULL THEN $row.waiting_since IS NULL AND $o.session_id<$row.session_id
          WHEN $row.waiting_since IS NULL THEN true ELSE ($o.waiting_since,$o.session_id)<($row.waiting_since,$row.session_id) END"""
        (s"$row.candidate AND ($row.sized OR $row.bulk IS NOT NULL)",s"($order) AND ($earlier)")
    }
    s"CASE WHEN $shown THEN (SELECT count(*) FROM claim_queue $o WHERE $before) END"
  }
  /** The first of the owner's jobs waiting for the large-job lane, in that lane's order. */
  def firstLarge(mode: ClaimOrderMode): String = {
    val order=mode match { case ClaimOrderMode.SourceId => "owner,session_id"; case ClaimOrderMode.Waiting(_) => "waiting_since NULLS LAST,session_id" }
    s"SELECT * FROM queue WHERE waiting IN(${list(large)}) ORDER BY $order LIMIT 1"
  }
  /** Per class of the owner's own current unfinished jobs: waiting for any reason, claimable now, held, awaiting reclaim,
    * the oldest wait. */
  val classes: String = s"""SELECT CASE WHEN bulk THEN 'bulk' WHEN NOT bulk THEN 'fresh' ELSE 'unclassified' END AS class,
    count(*) FILTER (WHERE waiting IS NOT NULL) AS queued,count(*) FILTER (WHERE candidate) AS claimable,
    count(*) FILTER (WHERE waiting='Held') AS held,count(*) FILTER (WHERE waiting IN('AwaitingReclaim','LeaseExpiredAwaitingReclaim')) AS awaiting_reclaim,
    min(waiting_since) FILTER (WHERE waiting IS NOT NULL) AS oldest FROM queue GROUP BY 1"""
  def waiting(value: Option[String],heldUntil: Option[Instant],older: Option[Int]): Option[ActivityJobWaiting] = value.map {
    case "Queued" => ActivityJobWaiting.Queued()
    case "IndexingOff" => ActivityJobWaiting.IndexingOff()
    case "AwaitingReclaim" => ActivityJobWaiting.AwaitingReclaim()
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

/** `mode` is the deployment's claim order (`ClaimOrderMode.of(config)`, bound in ChroniclePlugin); it decides the large-job
  * reason and the order `ahead` counts in, nothing else. */
final class PostgresActivity(db: Database,clock: Clock,mode: ClaimOrderMode=ClaimOrderMode.SourceId) extends ActivityIndex {
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
  private val queueCte=ActivityQueueSql.cte(mode,claimed.size,ChronicleIndexing.allowsOwnerSql(db.indexingDefaultEnabled,"s.owner"))
  private def queueParameters(owner: String,now: Instant): List[Sql.Param] = parameters(owner,now)++claimed
  private def queue(c: Connection,owner: String,now: Instant): ActivityQueue = {
    val empty=ActivityClassQueue(0,0,0,0,None)
    val classes=Sql.rows(c,base+queueCte+" "+ActivityQueueSql.classes,queueParameters(owner,now)*) { r =>
      r.getString("class") -> ActivityClassQueue(r.getLong("queued"),r.getLong("claimable"),r.getLong("held"),r.getLong("awaiting_reclaim"),Option(r.getTimestamp("oldest")).map(_.toInstant.toString))
    }.toMap
    val (awaiting,ahead)=Sql.one(c,base+queueCte+s""" SELECT (SELECT count(*) FROM queue WHERE waiting IN(${ActivityQueueSql.list(ActivityQueueSql.large)})) AS awaiting,
      (SELECT ${ActivityQueueSql.ahead(mode,"first")} FROM (${ActivityQueueSql.firstLarge(mode)}) first) AS ahead""",queueParameters(owner,now)*) { r =>
      (r.getLong("awaiting"),Option(r.getObject("ahead",classOf[java.lang.Long])).map(_.longValue))
    }.get
    ActivityQueue(ActivityQueueSql.claimOrder(mode),classes.getOrElse("fresh",empty),classes.getOrElse("bulk",empty),classes.getOrElse("unclassified",empty),awaiting,ahead)
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
          q.waiting_since,q.bulk,q.sized,q.permit_only,q.held_until,q.older_revision,q.waiting,q.candidate
        FROM jobs j JOIN ch_revision_info i ON i.session_id=j.session_id AND i.revision=j.revision JOIN queue q ON q.id=j.id),
        filtered AS MATERIALIZED(SELECT j.*,${order.column} AS sort_key FROM job_rows j WHERE (${filter.text}))
        SELECT counted.total,page.*,page.sort_key::text AS sort_value,${ActivityQueueSql.ahead(mode,"page")} AS ahead FROM (SELECT count(*) AS total FROM filtered) counted
        LEFT JOIN LATERAL(SELECT r.* FROM filtered r WHERE (${cursor.text}) ORDER BY r.sort_key $directionSql NULLS LAST,r.id LIMIT ?) page ON true
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
      ActivityJobsResult(now.toString,page.map(_._1),rows.head._1,next)
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
