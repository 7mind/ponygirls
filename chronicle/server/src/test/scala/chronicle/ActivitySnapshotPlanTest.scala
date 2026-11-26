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
    * profile's at revisions 1-2; the head jobs mostly Complete, some Failed, Queued (claimable, held, sized: awaiting the
    * large lane) and Running (valid, ended, no lease). Owner b: 1,000 sources of the same shape (other owners' candidates
    * in the claim order). Collector reports of owner a: fresh, stale, a longer prefix of another, one without heads. */
  def plant(db: Database,profile: String): Unit = db.transaction { c =>
    val base=Fixtures.snapshot()
    val metadata=Wire.encode(Metadata.codecJson,base.metadata).noSpaces
    val source=Wire.encode(SourceIdentity.codecJson,base.source).noSpaces
    Sql.exec(c,"""CREATE TEMP TABLE activity_plan ON COMMIT DROP AS SELECT n,gen_random_uuid() AS id,CASE WHEN n<8200 THEN 'a' ELSE 'b' END AS owner,1+n%3 AS revision,n%50=49 AS tombstone,
      CASE WHEN n<8200 THEN 'host-'||(n%5)||'/root' ELSE 'b-host/root' END AS namespace FROM generate_series(0,9199) n""")
    Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision,tombstone) SELECT id,owner,'activity-plan-'||n,revision,tombstone FROM activity_plan")
    Sql.exec(c,"INSERT INTO ch_revisions(session_id,revision,snapshot) SELECT f.id,r,'{}'::jsonb FROM activity_plan f CROSS JOIN generate_series(1,f.revision) r")
    Sql.exec(c,"""INSERT INTO ch_revision_info(session_id,revision,metadata,source,completion,redacted,message_count)
      SELECT f.id,r,jsonb_set(?::jsonb,'{title}',to_jsonb('plan '||f.n||' revision '||r)),jsonb_set(?::jsonb,'{collectorNamespace}',to_jsonb(f.namespace)),'Quiescent',false,0
      FROM activity_plan f CROSS JOIN generate_series(1,f.revision) r""",metadata,source)
    val held=now.plusSeconds(3600).toString; val ended=now.minusSeconds(3600).toString
    Sql.exec(c,s"""INSERT INTO ch_jobs(id,session_id,revision,profile,state,attempts,lease_until,error,completed_windows,total_windows,waiting_since,bulk)
      SELECT gen_random_uuid(),f.id,r,?,s.state,CASE WHEN s.state='Running' THEN 1 ELSE 0 END,
        CASE WHEN s.state='Queued' AND f.n%100=7 THEN ?::timestamptz WHEN s.state='Running' AND f.n%3=0 THEN ?::timestamptz WHEN s.state='Running' AND f.n%3=1 THEN ?::timestamptz END,
        CASE WHEN s.state='Failed' THEN CASE WHEN r<f.revision THEN 'superseded-revision' ELSE 'model-failed' END END,
        CASE WHEN s.state='Complete' THEN 3 ELSE 0 END,CASE WHEN s.state='Complete' THEN 3 WHEN s.state='Queued' AND f.n%7=0 THEN 150 END,
        CASE WHEN s.state IN('Queued','Running') THEN ?::timestamptz-make_interval(secs=>f.n) END,CASE WHEN s.state IN('Queued','Running') THEN f.n%2=0 END
      FROM activity_plan f CROSS JOIN generate_series(1,f.revision) r
      CROSS JOIN LATERAL (SELECT CASE WHEN r<f.revision THEN CASE WHEN f.n%2=0 THEN 'Complete' ELSE 'Failed' END
        WHEN f.n%100<8 THEN 'Queued' WHEN f.n%100<10 THEN 'Running' WHEN f.n%100<15 THEN 'Failed' ELSE 'Complete' END AS state) s
      WHERE NOT (r=f.revision AND f.n%20=0)""",profile,held,held,ended,now.toString)
    Sql.exec(c,"""INSERT INTO ch_jobs(id,session_id,revision,profile,state,completed_windows,total_windows)
      SELECT gen_random_uuid(),f.id,r,?,'Complete',2,2 FROM activity_plan f CROSS JOIN generate_series(1,least(f.revision,2)) r""",old)
    def report(owner: String,collector: String,age: Long): Unit = {
      val value=CollectorProgressUpdate(collector,1,UUID.randomUUID(),CollectorPhase.Uploading,now.minusSeconds(600).toString,CollectorCounters(10,10,0,0,0,0,9,0,0,0,0,0,10),1000,500,Some(500),None)
      Sql.exec(c,"INSERT INTO ch_collector_progress VALUES(?,?,1,?::jsonb,?::timestamptz)",owner,collector,Wire.encode(CollectorProgressUpdate.codecJson,value).noSpaces,now.minusSeconds(age).toString)
    }
    List("host-0" -> 10L,"host-1" -> (CollectorProgress.staleSeconds+600),"host-2" -> 10L,"host-2/root" -> 30L,"host-3" -> (CollectorProgress.staleSeconds+60),"idle" -> 5L).foreach((id,age) => report("a",id,age))
    report("b","b-host",10)
    Sql.exec(c,"ANALYZE ch_sources"); Sql.exec(c,"ANALYZE ch_revisions"); Sql.exec(c,"ANALYZE ch_revision_info"); Sql.exec(c,"ANALYZE ch_jobs"); Sql.exec(c,"ANALYZE ch_collector_progress")
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
  * plan as a node over that CTE with as many actual loops as there are outer rows, however fast the machine is. Every
  * statement the reads issue (with their own text and bound parameters, both claim orders) is explained with ANALYZE, its
  * custom plan and the generic plan a connection caches once the statement is prepared on it:
  * each CTE Scan of `jobs`, `queue`, `ranked` or `claim_queue` runs once, and no node above one runs more often than the
  * owner has collectors (a per-collector aggregate re-read for each collector row is the only repetition allowed). */
final class ActivitySnapshotPlanTest extends munit.FunSuite {
  import ActivityStatements.*
  import ActivityPlanFixture.*
  override val munitTimeout=5.minutes
  private val watched=Set("jobs","queue","ranked","claim_queue")
  private def scans(node: Json): Boolean = text(node,"Node Type").contains("CTE Scan") && text(node,"CTE Name").exists(watched)
  private def over(node: Json): Boolean = scans(node) || children(node).exists(over)
  private def describe(node: Json): String = text(node,"Node Type").get+text(node,"CTE Name").fold("")(" on "+_)+s" (${number(node,"Actual Loops").toLong} loops)"

  test("Activity reads on a production-size archive (8,036 heads, 29,055 jobs): every CTE Scan of jobs, queue, ranked and claim_queue runs once, no node over them once per head or job") { ClaimOrderPostgres.withDatabase(ClaimOrderPostgres.config()) { (c,_,_) =>
    val capture=new Capture
    val capturing=Database.withFactory(c,IndexProfileCatalog.current(c),capture.factory)
    try {
      clean(capturing)
      plant(capturing,c.profile)
      // The archive the plans are read on: its size, heads without a target job, and the owner's large-lane candidates.
      val sized=new PostgresActivity(capturing,Clock.fixed(now,ZoneOffset.UTC))
      val summary=sized.summary(user,collectors("",1))
      assertEquals((summary.archiveHeads,summary.current.total+summary.historical.total,summary.headsWithoutTargetJob,summary.totalCollectors),(8036L,29055L,410L,7L))
      val queue=sized.claimOrderSummary(user).queue
      assert(queue.awaitingLarge>0 && queue.largeAhead.nonEmpty,queue)
      capture.take()
      for(view <- List(ActivityClaimOrderView.default,ActivityClaimOrderView(ClaimOrderMode.Waiting(1),4))) {
        val activity=new PostgresActivity(capturing,Clock.fixed(now,ZoneOffset.UTC),view)
        reads(activity).foreach { (label,read) =>
          read()
          val statements=capture.take()
          assert(statements.nonEmpty,s"$view $label: its statements")
          for((statement,n) <- statements.zipWithIndex; (plan,explained) <- List("custom" -> explain,"generic" -> explainGeneric)) {
            val top=root(capturing.transaction(x => explained(x,"ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF",statement)))
            val read=nodes(top).filter(scans)
            val at=s"$view $label statement $n, $plan plan"
            // The job list references `jobs` once: PostgreSQL inlines it, there is no CTE Scan of it to count.
            if(label!="ActivityJobs") assert(read.nonEmpty,s"$at: reads the jobs it counts")
            assertEquals(read.filter(number(_,"Actual Loops")>1).map(describe),Nil,s"$at: each CTE Scan once")
            assertEquals(nodes(top).filter(node => over(node) && number(node,"Actual Loops")>summary.totalCollectors).map(describe),Nil,s"$at: no node over them per head or job")
          }
        }
      }
    } finally try clean(capturing) finally capturing.close()
  }}
}
