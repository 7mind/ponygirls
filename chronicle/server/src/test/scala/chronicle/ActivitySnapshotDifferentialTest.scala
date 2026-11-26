package chronicle

import chronicle.api.*
import java.time.{Clock,Instant,ZoneOffset}
import java.util.UUID
import ponygirls.auth.{IndexingChoice,IndexingPreferenceSql,IndexingService}
import scala.concurrent.duration.*
import scala.util.Random

/** Result identity of the Activity statements whose per-row CTE scans were removed: on generated archives every statement
  * that the collector snapshot (`summary`: its totals and its rows, every sort, filter and page) and the claim-order
  * summary issue answers exactly what 15040203's text of it (`ActivityStatements.previous`) answers with the same bound
  * parameters in the same database state — the same rows in the same order, the same column labels and values as text. */
final class ActivitySnapshotDifferentialTest extends munit.FunSuite {
  import ActivityStatements.*
  override val munitTimeout=10.minutes
  private val old="old-profile"; private val other="other-profile"
  private final case class JobRow(revision: Int,profile: String,state: String,attempts: Int,lease: Option[Long],total: Option[Int],completed: Int,epoch: Long,waiting: Option[Long],bulk: Option[Boolean])
  private final case class Source(owner: String,revision: Int,tombstone: Boolean,namespace: String,jobs: List[JobRow])
  private final case class Report(owner: String,collector: String,age: Long)
  /** `retainedTarget`: owners whose target is a registered profile this deployment does not execute; `indexingOff`:
    * owners who disabled indexing (which also advances their indexing epoch: their stored jobs' epochs fall behind). */
  private final case class State(name: String,sources: List[Source],reports: List[Report],disabled: Set[String],indexingOff: Set[String],retainedTarget: Set[String],now: Instant)
  private val owners=List("a","b","c")
  private val namespaces=List("base","base/episode","base/episode/child","baseball/child","under_score/child","underXscore/child","percent%/child","percentX/child","orphan/child","host-1/root")
  private val prefixes=List("base","base/episode","baseball","under_score","percent%","host-1","report-only")
  private val instant=Instant.parse("2026-11-26T05:30:00Z")

  /** A random archive: up to 14 sources per owner at revisions 1-3 (some tombstoned) under namespaces that collector ids
    * prefix at boundaries and not; per source up to 5 jobs over revisions and the target, a previous and another profile
    * in every state, with leases before, at and after the observation instant, sized and unsized, current and behind
    * indexing epochs, waiting ages and classes; reports fresh, at the stale boundary and stale. */
  private def generated(seed: Long,target: String,retained: String): State = {
    val random=new Random(seed)
    def pick[A](values: Seq[A]): A = values(random.nextInt(values.size))
    def maybe[A](p: Double)(value: => A): Option[A] = if(random.nextDouble()<p) Some(value) else None
    val heavy=random.nextBoolean()
    val sources=owners.flatMap { owner =>
      List.fill(random.nextInt(if(owner=="c") 4 else 15)) {
        val revision=1+random.nextInt(3)
        val profiles=List(target,target,old,other,if(heavy) target else retained)
        val jobs=(for(r <- 1 to revision; p <- profiles.distinct) yield (r,p)).filter(_ => random.nextDouble()<(if(heavy) 0.7 else 0.35)).toList.map { (r,p) =>
          val state=pick(if(heavy) List("Queued","Queued","Running","Complete","Failed") else List("Queued","Running","Complete","Complete","Failed"))
          val total=maybe(0.4)(if(random.nextBoolean()) 150 else 3)
          val completed=total.fold(0)(t => if(state=="Complete") t else random.nextInt(t+1))
          JobRow(r,p,state,random.nextInt(7),maybe(0.6)(pick(List(-3600L,-1L,0L,1L,3600L))),total,completed,if(random.nextDouble()<0.15) 7L else 0L,
            maybe(0.8)(random.nextInt(7200).toLong),maybe(0.8)(random.nextBoolean()))
        }
        Source(owner,revision,random.nextDouble()<0.1,pick(namespaces),jobs)
      }
    }
    val reports=owners.flatMap(owner => prefixes.filter(_ => random.nextDouble()<0.45).map(id => Report(owner,id,pick(List(0L,30L,CollectorProgress.staleSeconds,CollectorProgress.staleSeconds+1,3600L)))))
    def some(p: Double): Set[String] = owners.filter(_ => random.nextDouble()<p).toSet
    val nanos=if(random.nextBoolean()) 0L else 1+random.nextInt(999).toLong
    State(s"generated $seed",sources,reports,some(0.1),some(0.2),some(0.2)-"a",instant.plusNanos(nanos))
  }
  /** Named archives: none; heads without jobs; one current job each; only jobs of other revisions and profiles; every head
    * sized and queued (the large lane, other owners' candidates ranked ahead); a retained target with indexing off. */
  private def named(target: String,retained: String): List[State] = {
    def job(r: Int,p: String,state: String,total: Option[Int]=None,lease: Option[Long]=None,waiting: Option[Long]=Some(60)): JobRow = JobRow(r,p,state,0,lease,total,if(state=="Complete") total.getOrElse(0) else 0,0,waiting,Some(false))
    val empty=State("empty",Nil,Nil,Set.empty,Set.empty,Set.empty,instant)
    List(
      empty,
      empty.copy(name="heads without jobs",sources=List(Source("a",1,false,"base/episode/child",Nil),Source("a",2,false,"orphan/child",Nil),Source("b",1,false,"base",Nil)),reports=List(Report("a","base",0))),
      empty.copy(name="one current job per head",sources=namespaces.zipWithIndex.map((ns,i) => Source("a",1+i%3,false,ns,List(job(1+i%3,target,List("Queued","Running","Complete","Failed")(i%4),lease=Some(60))))),reports=prefixes.map(Report("a",_,30))),
      empty.copy(name="only other revisions and profiles",sources=namespaces.map(ns => Source("a",3,false,ns,List(job(1,target,"Complete",Some(3)),job(2,target,"Failed"),job(3,old,"Complete",Some(3)),job(3,other,"Queued")))),reports=List(Report("a","base",CollectorProgress.staleSeconds+1))),
      empty.copy(name="large lane",sources=owners.flatMap(o => (0 until 6).map(i => Source(o,1,i==5,namespaces(i),List(job(1,target,"Queued",Some(150),waiting=Some(10L*i+(if(o=="a") 5 else 0)))))))),
      empty.copy(name="retained target, indexing off",sources=owners.flatMap(o => (0 until 4).map(i => Source(o,2,false,namespaces(i),List(job(2,if(o=="c") retained else target,"Queued",Some(150)),job(2,if(o=="c") target else old,"Running",lease=Some(600)),job(1,target,"Running",lease=Some(600)))))),
        indexingOff=Set("b"),retainedTarget=Set("c"),reports=List(Report("c","base",0),Report("b","base",5000)))
    )
  }
  private def plant(db: Database,config: Config,retained: String,state: State): Unit = db.transaction { c =>
    Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE")
    Sql.exec(c,"DELETE FROM ch_collector_progress")
    Sql.exec(c,"DELETE FROM ponygirls_indexing_preferences WHERE service='chronicle'")
    Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    owners.foreach(o => Sql.exec(c,"UPDATE ch_users SET enabled=? WHERE id=?",!state.disabled(o),o))
    state.retainedTarget.foreach(o => Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner=?",retained,o))
    state.indexingOff.foreach(o => IndexingPreferenceSql.store(c,IndexingService.Chronicle,config.indexingPolicy).setChoice(o,IndexingChoice.Disable))
    val base=Fixtures.snapshot()
    val metadata=Wire.encode(Metadata.codecJson,base.metadata).noSpaces
    val identity=Wire.encode(SourceIdentity.codecJson,base.source).noSpaces
    state.sources.zipWithIndex.foreach { (s,n) =>
      val id=new UUID(1,n.toLong)
      Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision,tombstone) VALUES(?,?,?,?,?)",id,s.owner,s"differential-$n",s.revision,s.tombstone)
      (1 to s.revision).foreach { r =>
        Sql.exec(c,"INSERT INTO ch_revisions(session_id,revision,snapshot) VALUES(?,?,'{}'::jsonb)",id,r)
        // Only the head revision's namespace places a source under a collector.
        Sql.exec(c,"""INSERT INTO ch_revision_info(session_id,revision,metadata,source,completion,redacted,message_count)
          VALUES(?,?,?::jsonb,jsonb_set(?::jsonb,'{collectorNamespace}',to_jsonb(?::text)),'Quiescent',false,0)""",id,r,metadata,identity,if(r==s.revision) s.namespace else "wrong-old-namespace")
      }
      s.jobs.zipWithIndex.foreach { (j,k) =>
        val lease=j.lease.fold("NULL")(_ => "?::timestamptz"); val waiting=j.waiting.fold("NULL")(_ => "?::timestamptz")
        val total=j.total.fold("NULL")(_ => "?"); val bulk=j.bulk.fold("NULL")(_ => "?"); val error=if(j.state=="Failed") "'model-failed'" else "NULL"
        val args=List[Sql.Param](new UUID(2,n.toLong*16+k),id,j.revision,j.profile,j.state,j.attempts)++j.lease.map(s => state.now.plusSeconds(s).toString).toList++
          List[Sql.Param](j.completed)++j.total.toList++List[Sql.Param](j.epoch)++j.waiting.map(s => state.now.minusSeconds(s).toString).toList++j.bulk.toList
        Sql.exec(c,s"INSERT INTO ch_jobs(id,session_id,revision,profile,state,attempts,lease_until,error,completed_windows,total_windows,indexing_epoch,waiting_since,bulk) VALUES(?,?,?,?,?,?,$lease,$error,?,$total,?,$waiting,$bulk)",args*)
      }
    }
    state.reports.foreach { r =>
      val value=CollectorProgressUpdate(r.collector,1,UUID.randomUUID(),CollectorPhase.Uploading,state.now.minusSeconds(600).toString,CollectorCounters(10,10,0,0,0,0,9,0,0,0,0,0,10),1000,500,Some(500),Some("error of "+r.collector))
      Sql.exec(c,"INSERT INTO ch_collector_progress VALUES(?,?,1,?::jsonb,?::timestamptz)",r.owner,r.collector,Wire.encode(CollectorProgressUpdate.codecJson,value).noSpaces,state.now.minusSeconds(r.age).toString)
    }
  }

  test("the collector snapshot's totals and rows and the claim-order summary answer exactly what 15040203's statements answer, on 6 named and 40 generated archives") { ClaimOrderPostgres.withDatabase(ClaimOrderPostgres.config()) { (c,plain,_) =>
    val capture=new Capture
    val capturing=Database.withFactory(c,IndexProfileCatalog.current(c),capture.factory)
    val catalog=IndexProfileCatalog.current(c)
    // The retained target: a registered profile of another annotation revision, which this deployment does not execute.
    val rotated=c.copy(annotation=c.annotation.copy(revision="activity-differential-rotation"))
    val retainedProfile=IndexProfileCatalog.current(rotated)
    try {
      capturing.transaction(x => retainedProfile.register(x))
      assert(!catalog.knownProfiles(retainedProfile.preferred.profile))
      val retained=retainedProfile.preferred.profile
      val states=named(c.profile,retained)++(1L to 40L).map(seed => generated(seed,c.profile,retained))
      var compared=0; var nontrivial=Map.empty[String,Int].withDefaultValue(0)
      def count(label: String,hit: Boolean): Unit = if(hit) nontrivial=nontrivial.updated(label,nontrivial(label)+1)
      def value(row: List[(String,String)],column: String): Option[String] = row.find(_._1==column).flatMap(v => Option(v._2))
      def compare(label: String,statements: List[Statement],expected: Int): Unit = {
        assertEquals(statements.size,expected,label)
        statements.foreach { statement =>
          val previousSql=previous(statement.sql).getOrElse(fail(s"$label: no rewritten part in ${statement.sql.take(200)}"))
          val (current,before)=plain.transaction { x =>
            x.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ)
            (rows(x,statement.sql,statement.bound),rows(x,previousSql,statement.bound))
          }
          assertEquals(current,before,label)
          compared+=1
          current.foreach { row =>
            val heads=value(row,"archive_heads").map(_.toLong); val without=value(row,"without_target").map(_.toLong)
            count("heads with and without a target job",heads.exists(h => without.exists(w => w>0 && w<h)))
            count("a collector or owner whose every head lacks a target job",heads.exists(h => h>0 && without.contains(h)))
            count("large-lane rank",value(row,"large_ahead").nonEmpty)
            count("large-lane jobs without a rank",value(row,"awaiting").exists(_!="0") && value(row,"large_ahead").isEmpty)
          }
        }
      }
      val views=List(ActivityClaimOrderView(ClaimOrderMode.SourceId,1),ActivityClaimOrderView.default,ActivityClaimOrderView(ClaimOrderMode.Waiting(1),4))
      states.foreach { state =>
        plant(capturing,c,retained,state)
        val random=new Random(state.name.hashCode.toLong)
        capture.take()
        views.foreach { view =>
          val activity=new PostgresActivity(capturing,Clock.fixed(state.now,ZoneOffset.UTC),view)
          owners.foreach { owner =>
            val user=UserInfo(owner,owner,List(Scope.Read))
            val label=s"${state.name} $view owner $owner"
            if(state.disabled(owner)) {
              assertEquals(intercept[DomainError](activity.claimOrderSummary(user)).code,"unauthorized",label); capture.take()
            } else {
              activity.claimOrderSummary(user)
              compare(s"$label claim-order summary",capture.take(),1)
            }
            // The collector snapshot is the same in every claim order: read it in the first.
            if(view==views.head) {
              val queries=List(ActivityQuery("",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,1),ActivityQuery("freshness:stale",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,3),
                ActivityQuery("freshness:unknown",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,1),ActivityQuery("base OR freshness:recent",ActivityCollectorSort.HeadsWithoutTargetJob,SortDirection.Desc,None,100))++
                List.fill(3)(ActivityQuery("",ActivityCollectorSort.all(random.nextInt(ActivityCollectorSort.all.size)),if(random.nextBoolean()) SortDirection.Asc else SortDirection.Desc,None,1+random.nextInt(3)))
              queries.foreach { query =>
                if(state.disabled(owner) || state.retainedTarget(owner)) {
                  // Both read paths fail before their statements: owner disabled, or its target not executable here.
                  assertEquals(intercept[DomainError](activity.summary(user,query)).code,if(state.disabled(owner)) "unauthorized" else "unavailable",label); capture.take()
                } else {
                  var cursor: Option[String]=None; var pages=0
                  while({
                    val page=activity.summary(user,query.copy(cursor=cursor))
                    compare(s"$label summary $query page $pages",capture.take(),2)
                    cursor=page.nextCursor; pages+=1
                    cursor.nonEmpty && pages<20
                  }) ()
                }
              }
            }
          }
        }
      }
      println(s"ActivitySnapshotDifferentialTest: ${states.size} archives, $compared statements compared, non-trivial values: ${nontrivial.toList.sorted.mkString(", ")}")
      assertEquals(nontrivial.keySet,Set("heads with and without a target job","a collector or owner whose every head lacks a target job","large-lane rank","large-lane jobs without a rank"),"the archives exercise every compared value")
    } finally try capturing.transaction { x =>
      Sql.exec(x,"DELETE FROM ch_collector_progress"); owners.foreach(o => Sql.exec(x,"UPDATE ch_users SET enabled=true WHERE id=?",o))
    } finally capturing.close()
  }}
}
