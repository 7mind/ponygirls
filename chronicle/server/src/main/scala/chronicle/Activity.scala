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

final class PostgresActivity(db: Database,clock: Clock) extends ActivityIndex {
  private val base = """WITH observed AS (SELECT ?::timestamptz AS at),
    reports AS (SELECT collector_id,report,received_at FROM ch_collector_progress WHERE owner=?),
    heads AS (
      SELECT s.id,s.revision,COALESCE((
        SELECT r.collector_id FROM reports r
        WHERE i.source->>'collectorNamespace'=r.collector_id
          OR starts_with(i.source->>'collectorNamespace',r.collector_id||'/')
        ORDER BY length(r.collector_id) DESC,r.collector_id COLLATE "C" LIMIT 1
      ),i.source->>'collectorNamespace') AS collector_id
      FROM ch_sources s JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=s.revision
      WHERE s.owner=? AND NOT s.tombstone
    ),
    jobs AS (
      SELECT j.*,h.collector_id,j.revision=h.revision AS revision_current,j.profile=p.target AS profile_current,
        j.revision=h.revision AND j.profile=p.target AS is_current
      FROM heads h JOIN ch_jobs j ON j.session_id=h.id CROSS JOIN ch_profile p WHERE p.singleton
    ),
    collectors AS (SELECT collector_id FROM reports UNION SELECT collector_id FROM heads)
    """
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
  private def reading[A](owner: String)(f: (Connection,Instant) => A): A = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    Check(Sql.one(c,"SELECT 1 FROM ch_users WHERE id=? AND enabled",owner)(_ => true).contains(true),"unauthorized","owner disabled")
    Check(Sql.one(c,"SELECT 1 FROM ch_profile WHERE singleton")(_ => true).contains(true),"internal","missing target profile")
    f(c,clock.instant())
  }
  private def parameters(owner: String,now: Instant): List[Sql.Param] = {
    // Leases have microsecond resolution; rounding this boundary can classify a future lease as expired.
    List[Sql.Param](now.truncatedTo(ChronoUnit.MICROS).toString,owner,owner)
  }
  private final case class Totals(archiveHeads: Long,withoutTarget: Long,current: JobCounts,historical: JobCounts,collectors: Long)
  def summary(user: UserInfo,q: ActivityQuery): ActivityResult = {
    ActivityCursor.page(q.limit)
    Check(q.expression.isEmpty && q.sort==ActivityCollectorSort.CollectorId && q.direction==SortDirection.Asc,"invalid","table query implementation pending")
    val cursor=q.cursor.map(ActivityCursor.collector(_,user.id))
    reading(user.id) { (c,now) =>
      val params=parameters(user.id,now)
      val totals=Sql.one(c,base+s""", head_counts AS (
        SELECT count(*) AS archive_heads,
          count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.session_id=heads.id AND j.is_current)) AS without_target
        FROM heads
      ), job_counts AS (SELECT is_current,$aggregate FROM jobs GROUP BY is_current)
      SELECT a.*, (SELECT count(*) FROM collectors) AS total_collectors,$selected
      FROM head_counts a LEFT JOIN job_counts c ON c.is_current LEFT JOIN job_counts h ON NOT h.is_current""",params*) { r =>
        Totals(r.getLong("archive_heads"),r.getLong("without_target"),counts(r,"current_"),counts(r,"historical_"),r.getLong("total_collectors"))
      }.get
      val after=cursor.fold("true")(_ => "collector_id COLLATE \"C\">? COLLATE \"C\"")
      val pageParams=params++cursor.map(_.last).toList++List[Sql.Param](q.limit+1)
      val rows=Sql.rows(c,base+s""", page AS (
        SELECT collector_id FROM collectors WHERE $after ORDER BY collector_id COLLATE "C" LIMIT ?
      ), head_counts AS (
        SELECT x.collector_id,count(*) AS archive_heads,
          count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.session_id=x.id AND j.is_current)) AS without_target
        FROM heads x JOIN page p ON p.collector_id=x.collector_id GROUP BY x.collector_id
      ), job_counts AS (
        SELECT j.collector_id,j.is_current,$aggregate FROM jobs j JOIN page p ON p.collector_id=j.collector_id
        GROUP BY j.collector_id,j.is_current
      )
      SELECT p.collector_id,r.report,r.received_at,COALESCE(a.archive_heads,0) AS archive_heads,
        COALESCE(a.without_target,0) AS without_target,$selected
      FROM page p LEFT JOIN reports r ON r.collector_id=p.collector_id
      LEFT JOIN head_counts a ON a.collector_id=p.collector_id
      LEFT JOIN job_counts c ON c.collector_id=p.collector_id AND c.is_current
      LEFT JOIN job_counts h ON h.collector_id=p.collector_id AND NOT h.is_current
      ORDER BY p.collector_id COLLATE "C"""",pageParams*) { r =>
        val status=Option(r.getString("report")).map { report =>
          val received=r.getTimestamp("received_at").toInstant
          CollectorStatus(Wire.decode(CollectorProgressUpdate.codecJson,Wire.parse(report)),received.toString,now.isAfter(received.plusSeconds(CollectorProgress.staleSeconds)))
        }
        ActivityCollector(r.getString("collector_id"),status,r.getLong("archive_heads"),r.getLong("without_target"),counts(r,"current_"),counts(r,"historical_"))
      }
      val page=rows.take(q.limit)
      val next=if(rows.size>q.limit) Some(ActivityCursor.encode(ActivityCursor.Collector(user.id,page.last.collectorId))) else None
      ActivityResult(now.toString,user,totals.archiveHeads,totals.withoutTarget,totals.current,totals.historical,page,totals.collectors,totals.collectors,next)
    }
  }
  def jobs(owner: String,q: ActivityJobsQuery): ActivityJobsResult = {
    ActivityCursor.page(q.limit)
    Check(q.expression.isEmpty && q.sort==ActivityJobSort.JobId && q.direction==SortDirection.Asc,"invalid","table query implementation pending")
    q.collectorId.foreach(ActivityCursor.collectorId)
    val cursor=q.cursor.map(ActivityCursor.job(_,owner,q.scope,q.collectorId))
    reading(owner) { (c,now) =>
      val scope=q.scope match {
        case ActivityJobScope.Current => "is_current"
        case ActivityJobScope.Historical => "NOT is_current"
        case ActivityJobScope.All => "true"
      }
      val filter=scope+q.collectorId.fold("")(_ => " AND collector_id=?")
      val params=parameters(owner,now)++q.collectorId.toList
      val total=Sql.one(c,base+s"SELECT count(*) FROM jobs WHERE $filter",params*)(_.getLong(1)).get
      val pageParams=params++cursor.map(_.last).toList++List[Sql.Param](q.limit+1)
      val qualifiedFilter=scope.replace("is_current","j.is_current")+q.collectorId.fold("")(_ => " AND j.collector_id=?")
      val qualifiedAfter=cursor.fold("")(_ => " AND j.id>?")
      val rows=Sql.rows(c,base+s"SELECT j.*,s.revision AS head_revision,g.revision AS indexed_revision,i.metadata,i.source,i.completion,i.redacted,i.last_timestamp FROM jobs j JOIN ch_sources s ON s.id=j.session_id JOIN ch_revision_info i ON i.session_id=j.session_id AND i.revision=j.revision LEFT JOIN ch_generations g ON g.id=s.published WHERE $qualifiedFilter$qualifiedAfter ORDER BY j.id LIMIT ?",pageParams*) { r =>
        val state=JobState.parse(r.getString("state")).get
        val classification=(r.getBoolean("revision_current"),r.getBoolean("profile_current")) match {
          case (true,true) => ActivityJobClass.Current
          case (false,true) => ActivityJobClass.SupersededRevision
          case (true,false) => ActivityJobClass.ObsoleteProfile
          case (false,false) => ActivityJobClass.SupersededRevisionAndProfile
        }
        val lease=Option(r.getTimestamp("lease_until")).map(_.toInstant)
        val job=JobInfo(r.getObject("id",classOf[UUID]),r.getObject("session_id",classOf[UUID]),r.getInt("revision"),state,r.getInt("attempts"),Option(r.getString("error")),r.getInt("completed_windows"),Option(r.getObject("total_windows",classOf[java.lang.Integer])).map(_.intValue))
        val indexed=Option(r.getObject("indexed_revision",classOf[java.lang.Integer])).map(_.intValue)
        val session=SessionInfo(ContentView(job.revision,None),job.sessionId,owner,r.getInt("head_revision"),indexed,Wire.decode(Metadata.codecJson,Sql.json(r,"metadata")),Wire.decode(SourceIdentity.codecJson,Sql.json(r,"source")),Completion.parse(r.getString("completion")).get,r.getBoolean("redacted"))
        ActivityJob(job,r.getString("profile"),classification,lease.map(_.toString),state==JobState.Running && lease.exists(_.isAfter(now)),classification==ActivityJobClass.Current && state==JobState.Failed,r.getString("collector_id"),session,Option(r.getString("last_timestamp")))
      }
      val page=rows.take(q.limit)
      val next=if(rows.size>q.limit) Some(ActivityCursor.encode(ActivityCursor.Job(owner,q.scope,q.collectorId,page.last.job.id))) else None
      ActivityJobsResult(now.toString,page,total,next)
    }
  }
}

private object ActivityCursor {
  private val maximumPageSize=100
  private val maximumCollectorIdLength=256
  private val maximumCursorLength=8192
  final case class Collector(owner: String,last: String)
  final case class Job(owner: String,scope: ActivityJobScope,collectorId: Option[String],last: UUID)
  def page(limit: Int): Unit = Check(limit>=1 && limit<=maximumPageSize,"invalid","invalid page bounds")
  def collectorId(id: String): Unit = Check(id.nonEmpty && id.length<=maximumCollectorIdLength && !id.contains('\u0000') && UTF_8.newEncoder().canEncode(id),"invalid","invalid collector ID")
  private def invalid[A]: A = throw DomainError("invalid","invalid activity cursor")
  private def decode(value: String): Vector[Json] = {
    Check(value.nonEmpty && value.length<=maximumCursorLength,"invalid","invalid activity cursor")
    val text=Try(UTF_8.newDecoder().decode(ByteBuffer.wrap(Base64.getUrlDecoder.decode(value))).toString).getOrElse(invalid)
    Wire.parse(text).asArray.getOrElse(invalid)
  }
  private def encode(value: Json): String = Base64.getUrlEncoder.withoutPadding.encodeToString(value.noSpaces.getBytes(UTF_8))
  def encode(c: Collector): String = encode(Json.arr(Json.fromString("activity-collectors-v1"),Json.fromString(c.owner),Json.fromString(c.last)))
  def encode(c: Job): String = encode(Json.arr(Json.fromString("activity-jobs-v1"),Json.fromString(c.owner),Json.fromString(c.scope.toString),c.collectorId.fold(Json.Null)(Json.fromString),Json.fromString(c.last.toString)))
  def collector(value: String,owner: String): Collector = decode(value).toList match {
    case List(kind,user,last) if kind.asString.contains("activity-collectors-v1") && user.asString.contains(owner) =>
      val id=last.asString.getOrElse(invalid); collectorId(id); Collector(owner,id)
    case _ => invalid
  }
  def job(value: String,owner: String,scope: ActivityJobScope,collector: Option[String]): Job = decode(value).toList match {
    case List(kind,user,selected,filter,last) if kind.asString.contains("activity-jobs-v1") && user.asString.contains(owner) =>
      val parsedScope=selected.asString.flatMap(ActivityJobScope.parse).getOrElse(invalid)
      val parsedCollector=if(filter.isNull) None else Some(filter.asString.getOrElse(invalid))
      parsedCollector.foreach(collectorId)
      val id=last.asString.flatMap(s => Try(UUID.fromString(s)).toOption.filter(_.toString==s)).getOrElse(invalid)
      Check(parsedScope==scope && parsedCollector==collector,"invalid","activity cursor does not match query")
      Job(owner,parsedScope,parsedCollector,id)
    case _ => invalid
  }
}
