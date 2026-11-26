package chronicle

import chronicle.api.*
import io.circe.Json
import java.time.{Clock,Instant,ZoneOffset}
import java.util.UUID
import scala.concurrent.duration.*

/** An archive of production size and shape for plans of the Activity reads (deploy11 FINDING-activity-slow: one owner
  * with 7,806 heads and 24,542 jobs). */
private[chronicle] object ActivityPlanFixture {
  val now=Instant.parse("2026-11-26T05:30:00Z")
  private val old="activity-plan-previous-profile"
  /** Owner a: 8,200 sources (164 tombstoned: 8,036 heads) at revisions 1-3 under five collector namespaces; per source the
    * target profile's job at every revision (none at the head for every 20th: heads without a target job), the previous
    * profile's at revision 1 and, for every other source, 2; the head jobs mostly Complete, some Failed, Queued (claimable,
    * held, sized: awaiting the large lane) and Running (valid, ended, no lease). Owner b: 500 sources of the same shape
    * (other owners' candidates in the claim order). Collector reports of owner a: fresh, stale, a longer prefix of another,
    * one without heads. Its statistics do not depend on chance: ids are derived from the row, and every table of it holds
    * fewer rows (ch_jobs 28,565) than ANALYZE samples at the default statistics target (30,000), so any ANALYZE — this one
    * or autovacuum's — reads all of them. The small tables the reads join (users, targets, preferences, profiles) are
    * analyzed too; they hold the group database's few rows. */
  def plant(db: Database,profile: String): Unit = db.transaction { c =>
    val base=Fixtures.snapshot()
    val metadata=Wire.encode(Metadata.codecJson,base.metadata).noSpaces
    val source=Wire.encode(SourceIdentity.codecJson,base.source).noSpaces
    Sql.exec(c,"""CREATE TEMP TABLE activity_plan ON COMMIT DROP AS SELECT n,md5('activity-plan-source-'||n)::uuid AS id,CASE WHEN n<8200 THEN 'a' ELSE 'b' END AS owner,1+n%3 AS revision,n%50=49 AS tombstone,
      CASE WHEN n<8200 THEN 'host-'||(n%5)||'/root' ELSE 'b-host/root' END AS namespace FROM generate_series(0,8699) n""")
    Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision,tombstone) SELECT id,owner,'activity-plan-'||n,revision,tombstone FROM activity_plan")
    Sql.exec(c,"INSERT INTO ch_revisions(session_id,revision,snapshot) SELECT f.id,r,'{}'::jsonb FROM activity_plan f CROSS JOIN generate_series(1,f.revision) r")
    Sql.exec(c,"""INSERT INTO ch_revision_info(session_id,revision,metadata,source,completion,redacted,message_count)
      SELECT f.id,r,jsonb_set(?::jsonb,'{title}',to_jsonb('plan '||f.n||' revision '||r)),jsonb_set(?::jsonb,'{collectorNamespace}',to_jsonb(f.namespace)),'Quiescent',false,0
      FROM activity_plan f CROSS JOIN generate_series(1,f.revision) r""",metadata,source)
    val held=now.plusSeconds(3600).toString; val ended=now.minusSeconds(3600).toString
    Sql.exec(c,s"""INSERT INTO ch_jobs(id,session_id,revision,profile,state,attempts,lease_until,error,completed_windows,total_windows,waiting_since,bulk)
      SELECT md5('activity-plan-job-'||f.n||'-'||r)::uuid,f.id,r,?,s.state,CASE WHEN s.state='Running' THEN 1 ELSE 0 END,
        CASE WHEN s.state='Queued' AND f.n%100=7 THEN ?::timestamptz WHEN s.state='Running' AND f.n%3=0 THEN ?::timestamptz WHEN s.state='Running' AND f.n%3=1 THEN ?::timestamptz END,
        CASE WHEN s.state='Failed' THEN CASE WHEN r<f.revision THEN 'superseded-revision' ELSE 'model-failed' END END,
        CASE WHEN s.state='Complete' THEN 3 ELSE 0 END,CASE WHEN s.state='Complete' THEN 3 WHEN s.state='Queued' AND f.n%7=0 THEN 150 END,
        CASE WHEN s.state IN('Queued','Running') THEN ?::timestamptz-make_interval(secs=>f.n) END,CASE WHEN s.state IN('Queued','Running') THEN f.n%2=0 END
      FROM activity_plan f CROSS JOIN generate_series(1,f.revision) r
      CROSS JOIN LATERAL (SELECT CASE WHEN r<f.revision THEN CASE WHEN f.n%2=0 THEN 'Complete' ELSE 'Failed' END
        WHEN f.n%100<8 THEN 'Queued' WHEN f.n%100<10 THEN 'Running' WHEN f.n%100<15 THEN 'Failed' ELSE 'Complete' END AS state) s
      WHERE NOT (r=f.revision AND f.n%20=0)""",profile,held,held,ended,now.toString)
    Sql.exec(c,"""INSERT INTO ch_jobs(id,session_id,revision,profile,state,completed_windows,total_windows)
      SELECT md5('activity-plan-previous-'||f.n||'-'||r)::uuid,f.id,r,?,'Complete',2,2 FROM activity_plan f CROSS JOIN generate_series(1,least(f.revision,1+(f.n+1)%2)) r""",old)
    def report(owner: String,collector: String,age: Long): Unit = {
      val value=CollectorProgressUpdate(collector,1,new UUID(0,collector.hashCode.toLong),CollectorPhase.Uploading,now.minusSeconds(600).toString,CollectorCounters(10,10,0,0,0,0,9,0,0,0,0,0,10),1000,500,Some(500),None)
      Sql.exec(c,"INSERT INTO ch_collector_progress VALUES(?,?,1,?::jsonb,?::timestamptz)",owner,collector,Wire.encode(CollectorProgressUpdate.codecJson,value).noSpaces,now.minusSeconds(age).toString)
    }
    List("host-0" -> 10L,"host-1" -> (CollectorProgress.staleSeconds+600),"host-2" -> 10L,"host-2/root" -> 30L,"host-3" -> (CollectorProgress.staleSeconds+60),"idle" -> 5L).foreach((id,age) => report("a",id,age))
    report("b","b-host",10)
    Sql.exec(c,"SET LOCAL default_statistics_target=100")
    List("ch_users","ch_owner_targets","ponygirls_indexing_preferences","ch_index_profiles","ch_sources","ch_revisions","ch_revision_info","ch_generations","ch_jobs","ch_collector_progress").foreach(table => Sql.exec(c,s"ANALYZE $table"))
  }
  val user=UserInfo("a","a",List(Scope.Read))
  def collectors(expression: String,limit: Int): ActivityQuery = ActivityQuery(expression,ActivityCollectorSort.CollectorId,SortDirection.Asc,None,limit)
  val jobs=ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.LastTimestamp,SortDirection.Desc,None,100)
  /** The reads of the Activity page: the Overview's three collector snapshots (summary, stale, unreported) and a sorted
    * collector page, the job list, and the Jobs section's claim-order summary and job list. */
  def reads(activity: PostgresActivity): List[(String,() => Unit)] = List(
    "Activity summary" -> (() => activity.summary(user,collectors("",1))),
    "Activity stale" -> (() => activity.summary(user,collectors("freshness:stale",3))),
    "Activity unreported" -> (() => activity.summary(user,collectors("freshness:unknown",1))),
    "Activity by heads without target" -> (() => activity.summary(user,ActivityQuery("",ActivityCollectorSort.HeadsWithoutTargetJob,SortDirection.Desc,None,100))),
    "ActivityJobs" -> (() => activity.jobs("a",jobs)),
    "ActivityClaimOrderSummary" -> (() => activity.claimOrderSummary(user)),
    "ActivityClaimOrderJobs" -> (() => activity.claimOrderJobs("a",ActivityClaimOrderJobsQuery(jobs,Some(ActivityClaimOrderSort.WaitingSince)))))
  /** No other fixture's reset removes collector reports. */
  def clean(db: Database): Unit = { db.transaction(x => Sql.exec(x,"DELETE FROM ch_collector_progress")); () }
}

/** The plans of the Activity reads on an archive of production size and shape. A statement that evaluates a materialized
  * CTE again for each row of another — the collector snapshot's NOT EXISTS over `jobs` once per head (deploy11: 7,806
  * loops, 8.8 s), the claim-order summary's join that rescans `queue` once per ranked job (636 loops) — shows it in its
  * plan as a CTE Scan with as many actual loops as there are outer rows, however fast the machine is. Every statement the
  * reads issue (their own text and bound parameters, both claim orders) is explained with ANALYZE — custom and generic
  * plan (what a connection caches once the statement is prepared on it), under the production memory budget and under the
  * smallest one — and every CTE Scan in it, of any CTE, runs at most once, except the CTEs of [[bounded]], each held to
  * the bound given there; and no node that replays stored rows (Materialize, Sort) above a CTE Scan runs more often
  * than the owner has collectors (the collector page reads its per-collector aggregates once per collector row). */
final class ActivitySnapshotPlanTest extends munit.FunSuite {
  import ActivityStatements.*
  import ActivityPlanFixture.*
  override val munitTimeout=5.minutes
  /** A CTE that may be scanned more than once: at most `loops` scans of at most `rows` rows each (rows returned and removed
    * by the scan's filter, per loop), `rows` also bounding the CTE itself. */
  private final case class Bound(loops: Option[Long],rows: Option[Long],reason: String)
  /** The production budget (deploy11: work_mem 4 MB, hash_mem_multiplier at its default), pinned; and the smallest one,
    * in which no subplan over thousands of rows fits a hash table: a statement that scans a CTE once only because the
    * planner hashed a subplan over it (15040203's rows statement at its estimated 200 collector groups) scans it per row. */
  private val budgets=List("production budget" -> List("work_mem='4MB'","hash_mem_multiplier=2"),"64 kB budget" -> List("work_mem='64kB'","hash_mem_multiplier=1"))
  private val replaying=Set("Materialize","Sort","Incremental Sort")
  private def cte(node: Json): Option[String] = if(text(node,"Node Type").contains("CTE Scan")) text(node,"CTE Name") else None
  private def describe(node: Json): String = text(node,"Node Type").get+cte(node).fold("")(" on "+_)+s" (${number(node,"Actual Loops").toLong} loops)"

  test("Activity reads on a production-size archive (8,036 heads, 26,431 jobs): every CTE Scan runs once, except the bounded lookups, under the production and the smallest memory budget") { ClaimOrderPostgres.withDatabase(ClaimOrderPostgres.config()) { (c,_,_) =>
    val capture=new Capture
    val capturing=Database.withFactory(c,IndexProfileCatalog.current(c),capture.factory)
    try {
      clean(capturing)
      plant(capturing,c.profile)
      // The archive the plans are read on: its size, heads without a target job, and the owner's large-lane candidates.
      val sized=new PostgresActivity(capturing,Clock.fixed(now,ZoneOffset.UTC))
      val summary=sized.summary(user,collectors("",1))
      assertEquals((summary.archiveHeads,summary.current.total+summary.historical.total,summary.headsWithoutTargetJob,summary.totalCollectors),(8036L,26431L,410L,7L))
      val queue=sized.claimOrderSummary(user).queue
      assert(queue.awaitingLarge>0 && queue.largeAhead.nonEmpty,queue)
      capture.take()
      val (reports,targets)=capturing.transaction(x => Sql.one(x,"SELECT (SELECT count(*) FROM ch_collector_progress WHERE owner=?),(SELECT count(*) FROM ch_owner_targets)",user.id)(r => (r.getLong(1),r.getLong(2))).get)
      val bounded=Map(
        "reports" -> Bound(None,Some(reports),"base: a head's collector is the longest of the owner's collector report ids that prefixes its namespace, looked up per head in the owner's reports (one row per collector report)"),
        "heads" -> Bound(Some(targets),None,"base: `jobs` joins `heads` to ch_owner_targets, which the planner may drive, scanning `heads` once per owner-target row"),
        "claimed" -> Bound(None,Some(capturing.profiles.knownProfiles.size.toLong),"the profiles this deployment runs, tested per owner target (`eligible`) and per job (`queue`) where not hashed"))
      for(view <- List(ActivityClaimOrderView.default,ActivityClaimOrderView(ClaimOrderMode.Waiting(1),4))) {
        val activity=new PostgresActivity(capturing,Clock.fixed(now,ZoneOffset.UTC),view)
        reads(activity).foreach { (label,read) =>
          read()
          val statements=capture.take()
          assert(statements.nonEmpty,s"$view $label: its statements")
          for((statement,n) <- statements.zipWithIndex; (budget,settings) <- budgets; (plan,explained) <- List("custom" -> explain,"generic" -> explainGeneric)) {
            val top=root(capturing.transaction { x =>
              settings.foreach(setting => Sql.exec(x,s"SET LOCAL $setting"))
              explained(x,"ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF",statement)
            })
            val at=s"$view $label statement $n, $plan plan, $budget"
            val all=nodes(top)
            // The job list references `jobs` once: PostgreSQL inlines it, there is no CTE Scan of it to count.
            if(label!="ActivityJobs") assert(all.exists(node => cte(node).exists(Set("jobs","queue"))),s"$at: reads the jobs it counts")
            assertEquals(all.filter(node => cte(node).exists(name => !bounded.contains(name)) && number(node,"Actual Loops")>1).map(describe),Nil,s"$at: each CTE Scan once")
            for(node <- all; name <- cte(node); bound <- bounded.get(name)) {
              val loops=number(node,"Actual Loops"); val examined=number(node,"Actual Rows")+number(node,"Rows Removed by Filter")
              bound.loops.foreach(limit => assert(loops<=limit,s"$at: ${describe(node)} beyond $limit loops (${bound.reason})"))
              // Per-loop averages as EXPLAIN prints them: rows removed by the filter rounded to a whole row.
              bound.rows.foreach(limit => assert(examined<=limit+0.5,s"$at: ${describe(node)} reads $examined rows per loop, beyond $limit (${bound.reason})"))
            }
            for(node <- all; name <- text(node,"Subplan Name").map(_.stripPrefix("CTE ")); bound <- bounded.get(name); limit <- bound.rows)
              assert(number(node,"Actual Rows")<=limit,s"$at: CTE $name has ${number(node,"Actual Rows")} rows, beyond $limit (${bound.reason})")
            // A node that replays the rows it stored when rescanned reads a CTE's rows again without scanning it again (an
            // InitPlan below it is evaluated once and leaves a value, not rows).
            def unbounded(node: Json): Boolean = cte(node).exists(name => !bounded.contains(name)) ||
              children(node).exists(child => !text(child,"Parent Relationship").contains("InitPlan") && unbounded(child))
            assertEquals(all.filter(node => text(node,"Node Type").exists(replaying) && unbounded(node) && number(node,"Actual Loops")>summary.totalCollectors).map(describe),Nil,s"$at: no stored CTE rows replayed per head or job")
          }
        }
      }
    } finally try clean(capturing) finally capturing.close()
  }}
}
