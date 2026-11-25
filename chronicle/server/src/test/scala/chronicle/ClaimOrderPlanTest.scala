package chronicle

import io.circe.Json
import java.lang.reflect.{InvocationHandler,InvocationTargetException,Method,Proxy}
import java.sql.{Connection,DriverManager,PreparedStatement}
import java.util.UUID
import scala.collection.mutable.ListBuffer
import scala.util.Using

/** T8 (claim-order DESIGN §7, §9; spec §5.4; U2 gate r1): the plan of every candidate statement of the waiting order as the
  * production claim runs it. A connection of the claim's pool runs EXPLAIN ANALYZE of the candidate statement, with its
  * bound parameters, in the claim's transaction and session (its settings) right before the statement itself, custom and
  * generic plan. On an ANALYZEd queue of the spec §5.4 shape (3 owners, 2 profiles, 10,000 queued heads, 100 held, 100
  * sized, 4 Running, one source with 2,000 revisions), each branch — lane 0 A/B, bulk A/B, fresh A/B and a probe with a
  * passed source — reads its named partial index in index order, with no Sort or Incremental Sort anywhere under
  * Limit/LockRows; it reads exactly the index entries up to its candidate; the older-Running check is a per-candidate probe
  * of ch_jobs_running; the passed sources are a `<> ALL` filter of the source scan. */
final class ClaimOrderPlanTest extends munit.FunSuite {
  import ClaimOrderFixtures.*
  private final case class Captured(predicate: String,setting: String,custom: Json,generic: Json)
  /** The claim pool's connections: the candidate statements (ClaimOrder.candidateSql of any step) are explained first. */
  private final class Capture {
    val plans=ListBuffer.empty[Captured]
    private val predicates=List(ClaimLane.Kind.Large,ClaimLane.Kind.Bulk,ClaimLane.Kind.Fresh).flatMap(kind => ClaimOrder.steps(ClaimLane(0,kind))).map(_.predicate).distinct
    private def step(sql: String): Option[String] = predicates.find(predicate => ClaimOrder.candidateSql(ClaimOrder.Step(predicate,ClaimStep.Preferred))==sql)
    private def forward(target: AnyRef,method: Method,args: Array[AnyRef]): AnyRef =
      try method.invoke(target,(if(args==null) Array.empty[AnyRef] else args)*) catch { case e: InvocationTargetException => throw e.getCause }
    val factory: ponygirls.runtime.JdbcConnectionFactory = new ponygirls.runtime.JdbcConnectionFactory {
      def open(url: String,properties: java.util.Properties): Connection = {
        val connection=DriverManager.getConnection(url,properties)
        Proxy.newProxyInstance(getClass.getClassLoader,Array(classOf[Connection]),new InvocationHandler {
          def invoke(proxy: AnyRef,method: Method,args: Array[AnyRef]): AnyRef =
            if(method.getName=="prepareStatement" && args!=null && args.length==1) step(args(0).asInstanceOf[String]) match {
              case Some(predicate) => statement(connection,args(0).asInstanceOf[String],predicate)
              case None => forward(connection,method,args)
            } else forward(connection,method,args)
        }).asInstanceOf[Connection]
      }
    }
    private def statement(connection: Connection,sql: String,predicate: String): PreparedStatement = {
      val inner=connection.prepareStatement(sql)
      val bound=scala.collection.mutable.SortedMap.empty[Int,(Method,Array[AnyRef])]
      Proxy.newProxyInstance(getClass.getClassLoader,Array(classOf[PreparedStatement]),new InvocationHandler {
        def invoke(proxy: AnyRef,method: Method,args: Array[AnyRef]): AnyRef = {
          if(method.getName.startsWith("set") && args!=null && args.length==2 && args(0).isInstanceOf[Integer]) bound(args(0).asInstanceOf[Integer].intValue)=(method,args)
          if(method.getName=="executeQuery" && (args==null || args.isEmpty)) explain(connection,sql,predicate,bound.values.toList)
          forward(inner,method,args)
        }
      }).asInstanceOf[PreparedStatement]
    }
    private def run(connection: Connection,sql: String,bound: List[(Method,Array[AnyRef])]): Json = Using.resource(connection.prepareStatement(sql)) { explain =>
      bound.foreach((method,args) => forward(explain,method,args))
      Using.resource(explain.executeQuery())(r => { r.next(); Wire.parse(r.getString(1)) })
    }
    private def explain(connection: Connection,sql: String,predicate: String,bound: List[(Method,Array[AnyRef])]): Unit = {
      val setting=Using.resource(connection.createStatement())(s => Using.resource(s.executeQuery("SELECT current_setting('enable_sort')"))(r => { r.next(); r.getString(1) }))
      val custom=run(connection,"EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, FORMAT JSON) "+sql,bound)
      var index=0
      val numbered="\\?".r.replaceAllIn(sql,_ => { index+=1; "\\$"+index })
      Using.resource(connection.createStatement()) { s =>
        s.execute(s"PREPARE claim_order_plan AS $numbered")
        s.execute("SET LOCAL plan_cache_mode=force_generic_plan")
      }
      // EXECUTE takes no bind parameters: the bound values as literals of the prepared statement's parameter types.
      val literals=bound.map((_,args) => "'"+String.valueOf(args(1)).replace("'","''")+"'")
      val generic=run(connection,s"EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, FORMAT JSON) EXECUTE claim_order_plan(${literals.mkString(",")})",Nil)
      Using.resource(connection.createStatement()) { s => s.execute("DEALLOCATE claim_order_plan"); s.execute("SET LOCAL plan_cache_mode TO DEFAULT") }
      plans+=Captured(predicate,setting,custom,generic)
    }
  }

  private def nodes(plan: Json): List[Json] = plan :: plan.hcursor.downField("Plans").focus.flatMap(_.asArray).toList.flatten.flatMap(nodes)
  private def root(explained: Json): Json = explained.asArray.get.head.hcursor.downField("Plan").focus.get
  private def text(node: Json,field: String): Option[String] = node.hcursor.downField(field).focus.flatMap(_.asString)
  private def number(node: Json,field: String): Double = node.hcursor.downField(field).focus.flatMap(_.asNumber).fold(0.0)(_.toDouble)
  /** The outer-most leaf below LockRows: the scan that drives the order. */
  private def driving(node: Json): Json = node.hcursor.downField("Plans").focus.flatMap(_.asArray).toList.flatten
      .filterNot(child => text(child,"Parent Relationship").exists(Set("SubPlan","InitPlan"))) match {
    case Nil => node
    case children => driving(children.find(child => text(child,"Parent Relationship").contains("Outer")).getOrElse(children.head))
  }
  /** Index entries the driving scan read; loops of the older-Running probe and the index tuples it read in all of them (its
    * output and the rows its filter removed; EXPLAIN reports both per loop). */
  private final case class Shape(index: String,examined: Long,probeLoops: Long,probeVisited: Long,probeCond: Option[String])
  /** Asserts the shape of one explained candidate statement and returns what it read. */
  private def shape(explained: Json,label: String,index: String,bulk: Option[Boolean],running: Long): Shape = {
    val top=root(explained)
    assertEquals(text(top,"Node Type"),Some("Limit"),label)
    val locking=top.hcursor.downField("Plans").focus.flatMap(_.asArray).get.head
    assertEquals(text(locking,"Node Type"),Some("LockRows"),label)
    val sorts=nodes(top).flatMap(text(_,"Node Type")).filter(kind => kind=="Sort" || kind=="Incremental Sort")
    assertEquals(sorts,Nil,s"$label: no sort under Limit/LockRows")
    val scan=driving(locking)
    assertEquals((text(scan,"Node Type"),text(scan,"Relation Name"),text(scan,"Alias"),text(scan,"Index Name"),text(scan,"Scan Direction")),
      (Some("Index Scan"),Some("ch_jobs"),Some("j"),Some(index),Some("Forward")),s"$label: the ordered partial index drives the statement")
    bulk.foreach(value => assert(text(scan,"Index Cond").exists(_.contains(s"bulk = $value")),s"$label: ${text(scan,"Index Cond")}"))
    val probes=nodes(top).filter(node => text(node,"Alias").contains("o"))
    assertEquals(probes.map(node => (text(node,"Node Type"),text(node,"Index Name"),text(node,"Parent Relationship"))),List((Some("Index Scan"),Some("ch_jobs_running"),Some("SubPlan"))),s"$label: the older-Running check")
    val probe=probes.head
    val loops=number(scan,"Actual Loops").toLong
    assertEquals(loops,1L,label)
    val probeLoops=number(probe,"Actual Loops")
    Shape(index,math.round(number(scan,"Actual Rows")*loops+number(scan,"Rows Removed by Filter")*loops),probeLoops.toLong,math.round((number(probe,"Actual Rows")+number(probe,"Rows Removed by Filter"))*probeLoops),text(probe,"Index Cond"))
  }

  test("T8: every branch of the waiting order reads its ordered partial index up to its candidate on the ANALYZEd spec §5.4 queue: no sort, the older-Running probe on ch_jobs_running, passed sources filtered as <> ALL") { database { (c,db,a) =>
    val profile=c.profile; val old="0-claim-order-plan-previous-profile"
    // The old profile sorts before the target in ch_jobs_running(session_id,profile): a probe not bounded by the profile reads its rows first.
    assert(old<profile)
    def ingested(second: Int,bulk: Boolean,total: Option[Int] = None): UUID = job(db,a,owners(second%3),second,bulk,total)
    // The candidates the claims take: real sources (a claim reads its revision), older than the synthetic queue.
    val sizedWinner=ingested(1000,false,Some(150))
    val bulkWinners=List(1001,1005,1007).map(ingested(_,true)); val freshWinners=List(1002,1003,1004,1006,1008).map(ingested(_,false))
    db.transaction { x =>
      def synthetic(name: String,count: Int)(jobs: String,args: Sql.Param*): Unit =
        Sql.exec(x,s"""WITH s AS (INSERT INTO ch_sources(id,owner,source_key,revision) SELECT gen_random_uuid(),(ARRAY['a','b','c'])[1+g%3],'plan-$name-'||g,1 FROM generate_series(0,${count-1}) g RETURNING id,source_key),
          n AS (SELECT id,substring(source_key from 'plan-$name-(.*)')::int AS n FROM s) $jobs""",args*)
      val age=s"'${at(0)}'::timestamptz+make_interval(secs=>"
      // 100 held, the oldest (20 of them sized); 4 Running with valid leases; 10,000 queued heads (80 sized), and the old
      // profile's finished jobs on 2,000 of them.
      synthetic("held",100)(s"INSERT INTO ch_jobs(id,session_id,revision,profile,state,lease_until,error,transient_failures,waiting_since,bulk,total_windows) SELECT gen_random_uuid(),id,1,?,'Queued',clock_timestamp()+interval '1 hour','database-transient',1,${age}n),n%2=0,CASE WHEN n%5=0 THEN 150 END FROM n",profile)
      synthetic("running",4)(s"INSERT INTO ch_jobs(id,session_id,revision,profile,state,attempts,fence,lease_until,waiting_since,bulk) SELECT gen_random_uuid(),id,1,?,'Running',1,1,clock_timestamp()+interval '1 hour',${age}100+n),n%2=0 FROM n",profile)
      synthetic("queued",10000)(s"INSERT INTO ch_jobs(id,session_id,revision,profile,waiting_since,bulk,total_windows) SELECT gen_random_uuid(),id,1,?,${age}2000+n),n%2=0,CASE WHEN n%125=0 THEN 160 END FROM n",profile)
      Sql.exec(x,s"INSERT INTO ch_jobs(id,session_id,revision,profile,state,waiting_since,bulk) SELECT gen_random_uuid(),s.id,1,?,'Complete',${age}0),false FROM ch_sources s WHERE s.source_key LIKE 'plan-queued-%' AND substring(s.source_key from 'plan-queued-(.*)')::int%5=0",old)
      // One source at revision 2,000: its older revisions finished, revision 1,999 Running (valid lease), the head queued
      // and the oldest of all — blocked by that run.
      Sql.exec(x,"INSERT INTO ch_sources(id,owner,source_key,revision) VALUES(gen_random_uuid(),'a','plan-long-0',2000)")
      Sql.exec(x,s"""INSERT INTO ch_jobs(id,session_id,revision,profile,state,attempts,fence,lease_until,error,waiting_since,bulk)
        SELECT gen_random_uuid(),s.id,r,?,CASE WHEN r=2000 THEN 'Queued' WHEN r=1999 THEN 'Running' ELSE 'Failed' END,CASE WHEN r=1999 THEN 1 ELSE 0 END,0,
          CASE WHEN r=1999 THEN clock_timestamp()+interval '1 hour' END,CASE WHEN r<1999 THEN 'superseded-revision' END,${age}-1),false
        FROM ch_sources s CROSS JOIN generate_series(1,2000) r WHERE s.source_key='plan-long-0'""",profile)
      // The old profile's runs of revisions 1,990-1,998 of that source, Running (leases valid), queued after every candidate:
      // index entries of ch_jobs_running under the same source that the older-Running probe of its head must not read.
      Sql.exec(x,s"""INSERT INTO ch_jobs(id,session_id,revision,profile,state,attempts,fence,lease_until,waiting_since,bulk)
        SELECT gen_random_uuid(),s.id,r,?,'Running',1,1,clock_timestamp()+interval '1 hour',${age}100000),false
        FROM ch_sources s CROSS JOIN generate_series(1990,1998) r WHERE s.source_key='plan-long-0'""",old)
      Sql.exec(x,"ANALYZE ch_jobs"); Sql.exec(x,"ANALYZE ch_sources")
    }
    val shape54=db.transaction(x => Sql.one(x,"""SELECT count(*) FILTER (WHERE state='Queued' AND profile=? AND lease_until>clock_timestamp()),count(*) FILTER (WHERE state='Queued' AND total_windows IS NOT NULL),
      count(*) FILTER (WHERE state='Running'),count(DISTINCT profile),(SELECT count(DISTINCT owner) FROM ch_sources),(SELECT max(revision) FROM ch_sources),count(*) FILTER (WHERE state='Queued') FROM ch_jobs""",profile)(r => (1 to 7).map(r.getLong).toList).get)
    assertEquals(shape54,List(100L,101L,14L,2L,3L,2000L,10110L),"held, sized, Running (5 of the target profile), profiles, owners, longest source, queued")
    val running=14L
    val longHead=db.transaction(x => Sql.one(x,"SELECT j.id FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id AND j.revision=s.revision WHERE s.source_key='plan-long-0' AND j.profile=?",profile)(_.getObject(1,classOf[UUID])).get)
    val capture=new Capture
    val capturing=Database.withFactory(c,IndexProfileCatalog.current(c),capture.factory)
    val archive=new PostgresArchive(capturing,c)
    /** Index entries in the scanned order up to and including the claimed job's: their count, the ch_jobs_running entries of
      * their (session_id, profile) — all the older-Running probes of these candidates may read — and whether the long source's
      * head (whose probe finds its older run) is among them. */
    def upTo(index: String,bulk: Option[Boolean],claimedJob: Option[UUID]): (Long,Long,Boolean) = db.transaction { x =>
      val partial=index match {
        case "ch_jobs_sized" => "state='Queued' AND total_windows IS NOT NULL"
        case _ => "state IN('Queued','Running')"
      }
      val cls=bulk.fold("")(value => s" AND bulk=$value")
      val claimed=claimedJob match {
        case Some(id) => s"(SELECT waiting_since,session_id FROM ch_jobs WHERE id='$id')"
        case None => "(SELECT 'infinity'::timestamptz AS waiting_since,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid AS session_id)"
      }
      val selected=s"SELECT j.* FROM ch_jobs j,$claimed k WHERE $partial$cls AND (j.waiting_since,j.session_id)<=(k.waiting_since,k.session_id)"
      Sql.one(x,s"""SELECT count(*),coalesce(sum((SELECT count(*) FROM ch_jobs o WHERE o.state='Running' AND o.session_id=e.session_id AND o.profile=e.profile)),0),coalesce(bool_or(e.id=?),false)
        FROM ($selected) e""",longHead)(r => (r.getLong(1),r.getLong(2),r.getBoolean(3))).get
    }
    val report=ListBuffer.empty[String]
    // Asserted after every branch's tuple bound: the probe keyed by both columns of ch_jobs_running.
    val probeConditions=ListBuffer.empty[(String,Option[String])]
    /** One claim of `lane`: its statements' plans in order, checked against `expected` (index, class) per step; the
      * last statement found the claimed job, the earlier ones none (or a passed one). */
    def claimWith(label: String,lane: ClaimLane,steps: List[(String,String,Option[Boolean])],passed: Option[UUID] = None): UUID = {
      capture.plans.clear()
      val wanted=expected(lane,snapshot(db),passed.map(source(db,_)).toSet)
      // Read before the claim changes its job's row: the entries each statement must read.
      val entries=steps.zipWithIndex.map { case ((index,_,bulk),n) => upTo(index,bulk,if(n==steps.size-1) wanted else passed) }
      val taken=claimed(archive.claimInLane(archive.knownProfiles,ClaimScope.AllOwners,300,lane))
      assertEquals(Some(taken.jobId),wanted,label)
      assert((bulkWinners++freshWinners:+sizedWinner).contains(taken.jobId),s"$label: a real source")
      assertEquals(capture.plans.map(_.predicate).toList,steps.map(_._2),label)
      capture.plans.toList.zip(steps).zipWithIndex.foreach { case ((plan,(index,_,bulk)),n) =>
        for((explained,kind) <- List(plan.custom -> "custom",plan.generic -> "generic")) {
          val read=shape(explained,s"$label step ${n+1} $kind",index,bulk,running)
          val (scanned,probeBound,longHeadScanned)=entries(n)
          assertEquals(read.examined,scanned,s"$label step ${n+1} $kind: index entries read")
          assert(read.examined<=300,s"$label: bounded, ${read.examined}")
          assert(read.probeLoops<=read.examined && read.probeVisited<=probeBound,s"$label step ${n+1} $kind: the older-Running probes read ${read.probeVisited} index tuples in ${read.probeLoops} loops, at most the $probeBound ch_jobs_running entries of the scanned candidates' sources and profiles")
          if(longHeadScanned) assert(read.probeVisited>=1,s"$label step ${n+1} $kind: the long source's head finds its older run")
          probeConditions+=s"$label step ${n+1} $kind" -> read.probeCond
          report+=s"$label step ${n+1} $kind: $index entries=${read.examined} probeLoops=${read.probeLoops} probeTuples=${read.probeVisited}/$probeBound enable_sort=${plan.setting}"
        }
        if(passed.nonEmpty && n>0) assert(nodes(root(plan.custom)).exists(node => text(node,"Relation Name").contains("ch_sources") && text(node,"Filter").exists(_.contains("<> ALL"))),s"$label: passed sources as <> ALL")
      }
      taken.jobId
    }
    val sized=ClaimOrder.steps(lane0).map(_.predicate); val bulkSteps=ClaimOrder.steps(bulkLane).map(_.predicate); val freshSteps=ClaimOrder.steps(freshLane).map(_.predicate)
    try {
      assertEquals(claimWith("lane 0 A",lane0,List(("ch_jobs_sized",sized(0),None))),sizedWinner)
      assertEquals(claimWith("bulk A",bulkLane,List(("ch_jobs_class",bulkSteps(0),Some(true)))),bulkWinners(0))
      assertEquals(claimWith("fresh A",freshLane,List(("ch_jobs_class",freshSteps(0),Some(false)))),freshWinners(0))
      // A passed source: the next fresh candidate's job lock is held; the second probe excludes its source.
      val holder=other(c)
      try holder.transaction { h =>
        Sql.one(h,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",freshWinners(1))(_ => ()).get
        assertEquals(claimWith("fresh A passed",freshLane,List(("ch_jobs_class",freshSteps(0),Some(false)),("ch_jobs_class",freshSteps(0),Some(false))),Some(freshWinners(1))),freshWinners(2))
      } finally holder.close()
      // Step B runs only when step A has no candidate: the same queue with the preferred class's queued jobs reclassified,
      // so that only its held and Running rows remain in it, which step A reads and passes.
      def reshape(assignment: String): Unit = db.transaction { x => Sql.exec(x,s"UPDATE ch_jobs SET $assignment WHERE state='Queued' AND lease_until IS NULL"); Sql.exec(x,"ANALYZE ch_jobs"); () }
      reshape("total_windows=NULL")
      claimWith("lane 0 B",lane0,List(("ch_jobs_sized",sized(0),None),("ch_jobs_age",sized(1),None)))
      reshape("bulk=false")
      claimWith("bulk B",bulkLane,List(("ch_jobs_class",bulkSteps(0),Some(true)),("ch_jobs_class",bulkSteps(1),Some(false))))
      reshape("bulk=true")
      claimWith("fresh B",freshLane,List(("ch_jobs_class",freshSteps(0),Some(false)),("ch_jobs_class",freshSteps(1),Some(true))))
    } finally {
      capturing.close()
      // The next suite of the group's database plans with the statistics of empty tables again.
      db.transaction { x => Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs CASCADE"); Sql.exec(x,"ANALYZE ch_jobs"); Sql.exec(x,"ANALYZE ch_sources"); () }
    }
    println(report.mkString("ClaimOrderPlanTest plans:\n  ","\n  ",""))
    probeConditions.foreach((step,cond) => assert(cond.exists(value => value.contains("session_id") && value.contains("profile")),s"$step: the probe's index condition $cond"))
  }}
}
