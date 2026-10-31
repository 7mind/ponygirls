package chronicle
import chronicle.api.*
import io.circe.Json
import java.sql.Connection
import java.lang.reflect.{InvocationHandler,InvocationTargetException,Method,Proxy}
import java.util.UUID
import java.util.concurrent.{Callable,CountDownLatch,ExecutionException,Executors,Future,TimeUnit}
import scala.util.Using

final class RetryFailedJobsTest extends munit.FunSuite {
  private val target=Fixtures.config().profile
  private val nextCatalog={ val config=Fixtures.config(); IndexProfileCatalog.current(config.copy(annotation=config.annotation.copy(revision="synthetic-next"))) }
  private val nextTarget=nextCatalog.preferred.profile
  private val old="old-profile"
  private val empty=RetryFailedCounts(0,0,0,0,0,0,0)
  private val expected=RetryFailedCounts(1,1,1,1,1,1,1)
  private def id(n: Int): UUID = new UUID(0,n.toLong)
  private def hash(owner: String,profile: String,jobs: List[(UUID,Long)]): String = Wire.hash(Wire.canonical(Json.arr(
    Json.fromString("retry-current-failed-v1"),Json.fromString(owner),Json.fromString(profile),
    Json.fromValues(jobs.sortBy(_._1.toString).map { case (job,fence) => Json.arr(Json.fromString(job.toString),Json.fromLong(fence)) })
  )))
  private def withDatabase(f: Database => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped: set CHRONICLE_TEST_JDBC for bulk retry verification")
    }
    val config=Fixtures.config(); val admin=new Database(config,IndexProfileCatalog.legacyOnly(config))
    val schema="retry_failed_test_"+UUID.randomUUID().toString.replace("-","")
    admin.transaction(c => Sql.exec(c,s"CREATE SCHEMA $schema"))
    try {
      val separator=if(config.jdbcUrl.contains("?")) "&" else "?"
      val db=new Database(config.copy(jdbcUrl=config.jdbcUrl+separator+"currentSchema="+schema),IndexProfileCatalog.legacyOnly(config.copy(jdbcUrl=config.jdbcUrl+separator+"currentSchema="+schema)))
      db.transaction { c =>
        val ddl="""CREATE TABLE ch_users(id text PRIMARY KEY,login text UNIQUE NOT NULL,enabled boolean NOT NULL,credential text NOT NULL);
          CREATE TABLE ch_sources(id uuid PRIMARY KEY,owner text REFERENCES ch_users(id),source_key text NOT NULL,revision integer NOT NULL,published uuid,tombstone boolean NOT NULL,UNIQUE(owner,source_key));
          CREATE TABLE ch_jobs(id uuid PRIMARY KEY,session_id uuid REFERENCES ch_sources(id),revision integer NOT NULL,profile text NOT NULL,state text NOT NULL,attempts integer NOT NULL,fence bigint NOT NULL,lease_until timestamptz,error text,completed_windows integer NOT NULL,total_windows integer,run_id uuid NOT NULL DEFAULT gen_random_uuid(),failure_stage text,annotation_retry_epoch bigint NOT NULL DEFAULT 0,UNIQUE(session_id,revision,profile),CHECK(completed_windows>=0 AND (total_windows IS NULL AND completed_windows=0 OR total_windows>=completed_windows)));
          CREATE TABLE ch_profile(singleton boolean PRIMARY KEY CHECK(singleton),active text NOT NULL,target text NOT NULL,maintenance boolean NOT NULL);
          CREATE TABLE ch_groups(id uuid PRIMARY KEY,owner text REFERENCES ch_users(id),name text NOT NULL);
          CREATE TABLE ch_members(group_id uuid REFERENCES ch_groups(id),user_id text REFERENCES ch_users(id),PRIMARY KEY(group_id,user_id));
          CREATE TABLE ch_revisions(session_id uuid REFERENCES ch_sources(id),revision integer,snapshot jsonb NOT NULL,PRIMARY KEY(session_id,revision));
          CREATE TABLE ch_revision_info(session_id uuid,revision integer,metadata jsonb NOT NULL,PRIMARY KEY(session_id,revision));
          CREATE TABLE ch_messages(session_id uuid,revision integer,position integer,value jsonb NOT NULL);
          CREATE TABLE ch_generations(id uuid PRIMARY KEY,session_id uuid REFERENCES ch_sources(id),revision integer NOT NULL,profile text NOT NULL);
          CREATE TABLE ch_chunks(id uuid PRIMARY KEY,generation uuid REFERENCES ch_generations(id),value jsonb NOT NULL);
          CREATE TABLE ch_ingest_receipts(owner text REFERENCES ch_users(id),source_key text,request_id uuid,digest text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(owner,source_key,request_id));
          CREATE TABLE ch_mutations(owner text REFERENCES ch_users(id),request_id uuid,digest text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(owner,request_id));"""
        Using.resource(c.createStatement())(_.execute(ddl))
        Using.resource(getClass.getResourceAsStream("/007_owner_profiles.sql")) { stream =>
          val sql=Using.resource(scala.io.Source.fromInputStream(stream))(_.mkString)
          Using.resource(c.createStatement())(_.execute(sql))
        }
        db.profiles.register(c); nextCatalog.register(c)
        List("a","b","c").foreach(owner => Sql.exec(c,"INSERT INTO ch_users VALUES(?,?,true,'synthetic')",owner,owner))
        Sql.exec(c,"INSERT INTO ch_users VALUES('disabled','disabled',false,'synthetic')")
        Sql.exec(c,"INSERT INTO ch_profile VALUES(true,?,?,false)",old,target)
        Sql.exec(c,"INSERT INTO ch_owner_targets(owner,profile) SELECT id,? FROM ch_users",target)
        Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','shared')",id(5000))
        List("a","b").foreach(owner => Sql.exec(c,"INSERT INTO ch_members VALUES(?,?)",id(5000),owner))
        (1 to 7).foreach { n =>
          val owner=if(n==5) "b" else "a"
          Sql.exec(c,"INSERT INTO ch_sources VALUES(?,?,?,?,NULL,?)",id(n),owner,s"source-$n",if(n==1) 2 else 1,n==6)
        }
        addJob(c,id(101),id(1),2,target,"Failed",9)
        addJob(c,id(102),id(1),1,target,"Failed",10)
        addJob(c,id(103),id(1),2,old,"Failed",11)
        addJob(c,id(104),id(1),1,old,"Failed",12)
        addJob(c,id(105),id(2),1,target,"Queued",13)
        addJob(c,id(106),id(3),1,target,"Running",14)
        addJob(c,id(107),id(4),1,target,"Complete",15)
        addJob(c,id(108),id(5),1,target,"Failed",16)
        addJob(c,id(109),id(6),1,target,"Failed",17)
        addJob(c,id(110),id(1),1,"historical-queued","Queued",18)
        addJob(c,id(111),id(1),1,"historical-running","Running",19)
        addJob(c,id(112),id(1),1,"historical-complete","Complete",20)
        Sql.exec(c,"INSERT INTO ch_revisions SELECT id,revision,'{\"poison\":\"not an IngestRequest\",\"files\":[\"must not read\"]}'::jsonb FROM ch_sources")
        Sql.exec(c,"INSERT INTO ch_revision_info SELECT id,revision,'{\"poison\":\"not Metadata\"}'::jsonb FROM ch_sources")
        Sql.exec(c,"INSERT INTO ch_messages SELECT id,revision,0,'{\"poison\":\"not Message\"}'::jsonb FROM ch_sources")
        Sql.exec(c,"INSERT INTO ch_generations VALUES(?,?,1,?)",id(6000),id(4),old)
        Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",id(6000),id(4))
        Sql.exec(c,"INSERT INTO ch_chunks VALUES(?,?,'{\"poison\":\"immutable chunk\"}')",id(6001),id(6000))
        Sql.exec(c,"INSERT INTO ch_ingest_receipts VALUES('a','source-1',?,'digest','{\"retained\":true}')",id(6002))
        Sql.exec(c,"INSERT INTO ch_mutations VALUES('a',?,'digest','{\"retained\":true}')",id(6003))
      }
      f(db)
    } finally admin.transaction(c => Sql.exec(c,s"DROP SCHEMA $schema CASCADE"))
  }
  private def addJob(c: Connection,job: UUID,source: UUID,revision: Int,profile: String,state: String,fence: Long): Unit = {
    Sql.exec(c,"INSERT INTO ch_jobs(id,session_id,revision,profile,state,attempts,fence,lease_until,error,completed_windows,total_windows) VALUES(?,?,?,?,?,5,?,'2026-10-26T10:00:00Z','actual-error',2,4)",job,source,revision,profile,state,fence)
    ()
  }
  private def preview(db: Database,owner: String): RetryFailedPlan = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    RetryFailedJobs.preview(c,owner)
  }
  private def applyPlan(db: Database,owner: String,plan: RetryFailedPlan,request: UUID): RetryFailedResult =
    db.transaction(c => RetryFailedJobs(c,owner,request,plan.targetProfile,plan.selectionHash,true))
  private def rows(c: Connection,table: String): List[String] =
    Sql.rows(c,s"SELECT to_jsonb(t)::text FROM $table t ORDER BY to_jsonb(t)::text")(_.getString(1))
  private def jobs(db: Database): List[String] = db.transaction(c => rows(c,"ch_jobs"))
  private def retained(db: Database): List[(String,List[String])] = db.transaction { c =>
    List("ch_users","ch_profile","ch_owner_targets","ch_index_profiles","ch_embedding_spaces","ch_sources","ch_revisions","ch_revision_info","ch_messages","ch_generations","ch_chunks","ch_ingest_receipts","ch_mutations","ch_groups","ch_members").map(table => table->rows(c,table))
  }
  private def invalid(f: => Any): Unit = assertEquals(intercept[DomainError](f).code,"invalid")
  private def conflict(f: => Any): Unit = assertEquals(intercept[DomainError](f).code,"conflict")
  test("Behavioral-Blackbox-GoodCommunication specified: preview partitions all owned current and historical failures without shared sources") {
    withDatabase { db =>
      val plan=preview(db,"a")
      assertEquals(plan.targetProfile,target)
      assertEquals(plan.counts,expected)
      assertEquals(plan.selectionHash,hash("a",target,List(id(101)->9L)))
      assertEquals(preview(db,"b").counts,empty.copy(eligibleCurrentFailed=1))
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: apply queues only confirmed current failures and preserves history and owner boundaries") {
    withDatabase { db =>
      val plan=preview(db,"a")
      val before=retained(db)
      val untouched=db.transaction(c => Sql.rows(c,"SELECT to_jsonb(j)::text FROM ch_jobs j WHERE id<>? ORDER BY id",id(101))(_.getString(1)))
      val request=id(9000)
      val result=applyPlan(db,"a",plan,request)
      assertEquals(result,RetryFailedResult(request,target,1,expected))
      val updated=db.transaction(c => Sql.one(c,"SELECT state,attempts,fence,lease_until,error,completed_windows,total_windows FROM ch_jobs WHERE id=?",id(101)) { r =>
        (r.getString(1),r.getInt(2),r.getLong(3),Option(r.getTimestamp(4)),Option(r.getString(5)),r.getInt(6),Option(r.getObject(7)))
      }.get)
      assertEquals(updated,("Queued",0,10L,None,Some("actual-error"),0,None))
      assertEquals(db.transaction(c => Sql.rows(c,"SELECT to_jsonb(j)::text FROM ch_jobs j WHERE id<>? ORDER BY id",id(101))(_.getString(1))),untouched)
      assertEquals(retained(db),before)
      assertEquals(db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET state='Complete' WHERE id=? AND fence=? AND state='Running'",id(101),9L)),0)
      assertEquals(preview(db,"a").counts,expected.copy(eligibleCurrentFailed=0,unchangedQueued=2))
    }
  }
  test("Behavioral-Blackbox-GoodCommunication specified: empty plan is owner-bound, stable and applies as an exact no-op") {
    withDatabase { db =>
      val before=jobs(db); val preserved=retained(db)
      val plan=preview(db,"c")
      assertEquals(plan,RetryFailedPlan(target,hash("c",target,Nil),empty))
      assertEquals(preview(db,"c"),plan)
      assertEquals(applyPlan(db,"c",plan,id(9001)),RetryFailedResult(id(9001),target,0,empty))
      assertEquals(jobs(db),before); assertEquals(retained(db),preserved)
      db.transaction { c => Sql.exec(c,"INSERT INTO ch_users VALUES('other-empty','other-empty',true,'synthetic')"); Sql.exec(c,"INSERT INTO ch_owner_targets(owner,profile) VALUES('other-empty',?)",target); () }
      assertNotEquals(preview(db,"other-empty").selectionHash,plan.selectionHash)
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: helper checks fresh enabled owners itself on preview and apply") {
    withDatabase { db =>
      val stale=preview(db,"a")
      db.transaction { c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='a'"); () }
      val before=jobs(db)
      List("a","disabled","missing").foreach { owner =>
        assertEquals(intercept[DomainError](preview(db,owner)).code,"unauthorized")
        assertEquals(intercept[DomainError](applyPlan(db,owner,stale,id(9002))).code,"unauthorized")
      }
      assertEquals(jobs(db),before)
      assertEquals(preview(db,"b").counts.eligibleCurrentFailed,1L)
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: confirmation and malformed UTF8 NUL target hash boundaries are domain-invalid before writes") {
    withDatabase { db =>
      val plan=preview(db,"a"); val before=jobs(db)
      val malformed=List("","nul\u0000","bad"+0xd800.toChar,"bad"+0xdc00.toChar)
      malformed.foreach { value =>
        invalid(preview(db,value))
        invalid(db.transaction(c => RetryFailedJobs(c,value,id(9003),target,plan.selectionHash,true)))
        invalid(db.transaction(c => RetryFailedJobs(c,"a",id(9003),value,plan.selectionHash,true)))
      }
      (malformed++List("a"*63,"a"*65,"A"*64,"g"*64,"0"*63+"\n")).foreach { value =>
        invalid(db.transaction(c => RetryFailedJobs(c,"a",id(9003),target,value,true)))
      }
      invalid(db.transaction(c => RetryFailedJobs(c,"a",id(9003),target,plan.selectionHash,false)))
      invalid(db.transaction(c => RetryFailedJobs(c,"a",null,target,plan.selectionHash,true)))
      assertEquals(jobs(db),before)
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: target head fence state membership and ownership drift conflict without partial retries") {
    val changes: List[(String,Connection => Unit)]=List(
      "target" -> { c => Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=epoch+1 WHERE owner='a'",nextTarget); () },
      "head" -> { c => Sql.exec(c,"UPDATE ch_sources SET revision=3 WHERE id=?",id(1)); () },
      "fence" -> { c => Sql.exec(c,"UPDATE ch_jobs SET fence=fence+1 WHERE id=?",id(101)); () },
      "state" -> { c => Sql.exec(c,"UPDATE ch_jobs SET state='Queued' WHERE id=?",id(101)); () },
      "new eligible job" -> { c => addJob(c,id(113),id(7),1,target,"Failed",30) },
      "tombstone" -> { c => Sql.exec(c,"UPDATE ch_sources SET tombstone=true WHERE id=?",id(1)); () },
      "ownership" -> { c => Sql.exec(c,"UPDATE ch_sources SET owner='b' WHERE id=?",id(1)); () }
    )
    changes.foreach { case (name,change) => withDatabase { db =>
      db.transaction(c => addJob(c,id(114),id(2),1,old,"Failed",31))
      val plan=preview(db,"a")
      db.transaction(change)
      val before=jobs(db); val preserved=retained(db)
      val failure=intercept[DomainError](applyPlan(db,"a",plan,id(9004)))
      assertEquals(failure.code,"conflict",name)
      assertEquals(jobs(db),before,name)
      assertEquals(retained(db),preserved,name)
    }}
  }
  test("Behavioral-Effectual-GoodCommunication specified: apply reports recomputed pre-action counts without binding unrelated progress or historical failures") {
    withDatabase { db =>
      val plan=preview(db,"a")
      db.transaction { c =>
        Sql.exec(c,"UPDATE ch_jobs SET attempts=3,error='different-error',completed_windows=3,total_windows=8,lease_until=NULL WHERE id=?",id(101))
        Sql.exec(c,"UPDATE ch_jobs SET state='Failed' WHERE id=?",id(110))
        Sql.exec(c,"UPDATE ch_jobs SET state='Complete' WHERE id=?",id(105))
        ()
      }
      assertEquals(preview(db,"a").selectionHash,plan.selectionHash)
      val recomputed=expected.copy(supersededRevisionAndProfileFailed=2,unchangedQueued=0,unchangedComplete=2)
      assertEquals(applyPlan(db,"a",plan,id(9005)).counts,recomputed)
    }
  }
  test("Behavioral-Blackbox-GoodCommunication specified: hash is canonical UTF8 JSON and follows unsigned SQL UUID order") {
    withDatabase { db =>
      val owner="owner-😀-\"-\n"; val profile=target
      val ids=List("ffffffff-ffff-ffff-ffff-ffffffffffff","80000000-0000-0000-0000-000000000000","00000000-0000-0000-0000-000000000000","7fffffff-ffff-ffff-ffff-ffffffffffff","00000000-0000-0000-8000-000000000000").map(UUID.fromString)
      db.transaction { c =>
        Sql.exec(c,"INSERT INTO ch_users VALUES(?,?,true,'synthetic')",owner,owner)
        Sql.exec(c,"INSERT INTO ch_owner_targets(owner,profile) VALUES(?,?)",owner,profile)
        ids.zipWithIndex.foreach { case (job,n) =>
          Sql.exec(c,"INSERT INTO ch_sources VALUES(?,?,?,1,NULL,false)",id(20+n),owner,s"unicode-$n")
          addJob(c,job,id(20+n),1,profile,"Failed",9007199254740993L+n)
        }
      }
      val plan=preview(db,owner)
      assertEquals(plan.targetProfile,profile)
      assertEquals(plan.selectionHash,hash(owner,profile,ids.zipWithIndex.map { case (job,n) => job->(9007199254740993L+n) }))
      assertEquals(plan.counts,empty.copy(eligibleCurrentFailed=5))
      assertEquals(applyPlan(db,owner,plan,id(9006)).retried,5L)
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: every eligible job beyond 100 and 1000 is hashed and retried") {
    withDatabase { db =>
      val population=1205
      val selected=(1 to population).map(n => id(10000+n)->n.toLong).toList
      db.transaction { c =>
        selected.zipWithIndex.foreach { case ((job,fence),n) =>
          Sql.exec(c,"INSERT INTO ch_sources VALUES(?,'c',?,1,NULL,false)",id(10000+n),s"bulk-$n")
          addJob(c,job,id(10000+n),1,target,"Failed",fence)
        }
      }
      val plan=preview(db,"c")
      assertEquals(plan.counts,empty.copy(eligibleCurrentFailed=population.toLong))
      assertEquals(plan.selectionHash,hash("c",target,selected))
      assertEquals(applyPlan(db,"c",plan,id(9007)).retried,population.toLong)
      assertEquals(preview(db,"c").counts,empty.copy(unchangedQueued=population.toLong))
      assertEquals(db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id WHERE s.owner='c' AND (j.state<>'Queued' OR j.attempts<>0 OR j.fence<>split_part(s.source_key,'-',2)::bigint+2 OR j.error IS DISTINCT FROM 'actual-error' OR j.lease_until IS NOT NULL OR j.completed_windows<>0 OR j.total_windows IS NOT NULL)")(_.getLong(1)).get),0L)
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: legacy single-job retry continues to fence Running work") {
    withDatabase { db =>
      db.transaction(c => Jobs.retry(c,"a",id(106)))
      assertEquals(db.transaction(c => Sql.one(c,"SELECT state,fence,attempts,completed_windows,total_windows,error,lease_until FROM ch_jobs WHERE id=?",id(106)) { r =>
        (r.getString(1),r.getLong(2),r.getInt(3),r.getInt(4),Option(r.getObject(5)),Option(r.getString(6)),Option(r.getTimestamp(7)))
      }.get),("Queued",15L,0,0,None,Some("actual-error"),None))
    }
  }
  private def awaitBlocked(db: Database,name: String): Unit = {
    val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10)
    var blocked=false
    while(!blocked && System.nanoTime()<deadline) {
      blocked=db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=? AND wait_event_type='Lock')",name)(_.getBoolean(1)).get)
      if(!blocked) Thread.sleep(10)
    }
    assert(blocked,s"$name must be observed waiting for a real PostgreSQL lock")
  }
  private def blockedApply(db: Database,plan: RetryFailedPlan,name: String)(hold: Connection => Unit)(inspect: => Unit): Unit = {
    val pool=Executors.newSingleThreadExecutor()
    val started=new CountDownLatch(1)
    var pending: Option[Future[RetryFailedResult]]=None
    try {
      db.transaction { c =>
        hold(c)
        pending=Some(pool.submit(new Callable[RetryFailedResult] {
          def call(): RetryFailedResult = db.transaction { applying =>
            Sql.exec(applying,s"SET application_name='$name'")
            Sql.exec(applying,"SET LOCAL lock_timeout='15s'")
            started.countDown()
            RetryFailedJobs(applying,"a",id(9008),plan.targetProfile,plan.selectionHash,true)
          }
        }))
        assert(started.await(10,TimeUnit.SECONDS))
        awaitBlocked(db,name)
        inspect
      }
      val failure=intercept[ExecutionException](pending.get.get(15,TimeUnit.SECONDS))
      assertEquals(failure.getCause.asInstanceOf[DomainError].code,"conflict")
    } finally {
      pool.shutdownNow()
      assert(pool.awaitTermination(20,TimeUnit.SECONDS))
    }
  }
  private def locked(db: Database,sql: String,args: Sql.Param*): Unit = {
    val failure=intercept[java.sql.SQLException](db.transaction(c => Sql.rows(c,sql,args*)(_ => ())))
    assertEquals(failure.getSQLState,"55P03")
  }
  test("Behavioral-Effectual-GoodCommunication specified: concurrent target retarget is serialized before sources and forces repreview") {
    withDatabase { db =>
      val plan=preview(db,"a"); val before=jobs(db)
      blockedApply(db,plan,"retry-target-race")(c => { Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=epoch+1 WHERE owner='a'",nextTarget); () }) {
        db.transaction(c => Sql.rows(c,"SELECT id FROM ch_sources WHERE id=? FOR UPDATE NOWAIT",id(1))(_ => ()))
        locked(db,"SELECT id FROM ch_users WHERE id='a' FOR UPDATE NOWAIT")
      }
      assertEquals(jobs(db),before)
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: source lock precedes job locks and pins target while a head writer commits") {
    withDatabase { db =>
      db.transaction(c => addJob(c,id(113),id(7),1,target,"Failed",30))
      val plan=preview(db,"a"); val before=jobs(db)
      blockedApply(db,plan,"retry-source-race")(c => { Sql.exec(c,"UPDATE ch_sources SET revision=revision+1 WHERE id=?",id(7)); () }) {
        locked(db,"SELECT profile FROM ch_owner_targets WHERE owner='a' FOR UPDATE NOWAIT")
        locked(db,"SELECT id FROM ch_sources WHERE id=? FOR UPDATE NOWAIT",id(1))
        db.transaction(c => Sql.rows(c,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE NOWAIT",id(101))(_ => ()))
      }
      assertEquals(jobs(db),before)
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: job lock waits after profile and source locks, then detects a new fence") {
    withDatabase { db =>
      val plan=preview(db,"a")
      blockedApply(db,plan,"retry-job-race")(c => { Sql.exec(c,"UPDATE ch_jobs SET fence=fence+1 WHERE id=?",id(101)); () }) {
        locked(db,"SELECT profile FROM ch_owner_targets WHERE owner='a' FOR UPDATE NOWAIT")
        locked(db,"SELECT id FROM ch_sources WHERE id=? FOR UPDATE NOWAIT",id(1))
        locked(db,"SELECT id FROM ch_sources WHERE id=? FOR UPDATE NOWAIT",id(7))
        db.transaction(c => Sql.rows(c,"SELECT id FROM ch_sources WHERE id=? FOR UPDATE NOWAIT",id(5))(_ => ()))
      }
      assertEquals(db.transaction(c => Sql.one(c,"SELECT state,fence,attempts FROM ch_jobs WHERE id=?",id(101))(r => (r.getString(1),r.getLong(2),r.getInt(3))).get),("Failed",10L,5))
    }
  }

  test("Behavioral-Effectual-GoodCommunication specified: successful use drops selection immediately, and caller rollback removes conflict and SQL-failure artifacts") {
    withDatabase { db =>
      val plan=preview(db,"a")
      def noTemp(c: Connection): Unit = assertEquals(Sql.one(c,"SELECT to_regclass('pg_temp.ch_retry_failed_selection') IS NULL")(_.getBoolean(1)),Some(true))
      db.transaction { c =>
        val start=c.setSavepoint()
        conflict(RetryFailedJobs(c,"a",id(9010),target,"0"*64,true))
        c.rollback(start)
        noTemp(c)
        val before=rows(c,"ch_jobs")
        Sql.exec(c,"UPDATE ch_jobs SET fence=? WHERE id=?",Long.MaxValue,id(101))
        val overflow=c.setSavepoint()
        val failedPlan=RetryFailedPlan(target,hash("a",target,List(id(101)->Long.MaxValue)),expected)
        val failure=intercept[java.sql.SQLException](RetryFailedJobs(c,"a",id(9011),target,failedPlan.selectionHash,true))
        assertEquals(failure.getSQLState,"22003")
        c.rollback(overflow)
        noTemp(c)
        c.rollback(start)
        assertEquals(rows(c,"ch_jobs"),before)
        assertEquals(RetryFailedJobs(c,"a",id(9012),target,plan.selectionHash,true).retried,1L)
        noTemp(c)
        assertEquals(RetryFailedJobs(c,"c",id(9013),target,hash("c",target,Nil),true).retried,0L)
        noTemp(c)
      }
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: TEMP privilege is an explicit unavailable precondition without persistent grants or artifacts") {
    withDatabase { db =>
      val plan=preview(db,"a"); val before=jobs(db); val preserved=retained(db)
      db.transaction { c =>
        val start=c.setSavepoint()
        val database=Sql.one(c,"SELECT quote_ident(current_database())")(_.getString(1)).get
        // All privilege changes stay inside the savepoint; no test role is created.
        Sql.exec(c,s"REVOKE TEMPORARY ON DATABASE $database FROM PUBLIC")
        Sql.exec(c,"GRANT UPDATE ON ch_users TO pg_read_all_data")
        Sql.exec(c,"SET LOCAL ROLE pg_read_all_data")
        val failure=intercept[DomainError](RetryFailedJobs(c,"a",id(9014),target,plan.selectionHash,true))
        assertEquals(failure.code,"unavailable")
        assert(failure.detail.contains("TEMP"))
        c.rollback(start)
        assertEquals(Sql.one(c,"SELECT to_regclass('pg_temp.ch_retry_failed_selection') IS NULL")(_.getBoolean(1)),Some(true))
      }
      assertEquals(jobs(db),before); assertEquals(retained(db),preserved)
    }
  }
  test("Behavioral-Effectual-GoodCommunication specified: preview and apply cannot read raw revisions messages or metadata under least table privileges") {
    withDatabase { db =>
      val before=jobs(db); val preserved=retained(db)
      db.transaction { c =>
        c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
        val start=c.setSavepoint()
        val schema=Sql.one(c,"SELECT quote_ident(current_schema())")(_.getString(1)).get
        Sql.exec(c,s"GRANT USAGE ON SCHEMA $schema TO pg_read_all_settings")
        Sql.exec(c,"GRANT SELECT,UPDATE ON ch_users,ch_owner_targets,ch_sources,ch_jobs TO pg_read_all_settings")
        Sql.exec(c,"GRANT SELECT ON ch_index_profiles,ch_embedding_spaces TO pg_read_all_settings")
        Sql.exec(c,"SET LOCAL ROLE pg_read_all_settings")
        List("ch_revisions","ch_revision_info","ch_messages","ch_generations","ch_chunks","ch_ingest_receipts","ch_mutations","ch_groups","ch_members").foreach { table =>
          assertEquals(Sql.one(c,"SELECT has_table_privilege(current_user,?,'SELECT')",table)(_.getBoolean(1)),Some(false))
        }
        val plan=RetryFailedJobs.preview(c,"a")
        assertEquals(plan.counts,expected)
        assertEquals(RetryFailedJobs(c,"a",id(9015),target,plan.selectionHash,true).retried,1L)
        c.rollback(start)
      }
      assertEquals(jobs(db),before); assertEquals(retained(db),preserved)
    }
  }
  private def gated(c: Connection,sqlMatches: String => Boolean,arrived: CountDownLatch,resume: CountDownLatch): Connection =
    Proxy.newProxyInstance(classOf[Connection].getClassLoader,Array(classOf[Connection]),new InvocationHandler {
      def invoke(proxy: Object,method: Method,args: Array[Object]): Object = {
        val parameters=if(args==null) Array.empty[Object] else args
        if(method.getName=="prepareStatement" && parameters.nonEmpty && sqlMatches(parameters(0).toString)) {
          arrived.countDown()
          assert(resume.await(15,TimeUnit.SECONDS),"real JDBC execution gate must be released")
        }
        try method.invoke(c,parameters*) catch { case failure: InvocationTargetException => throw failure.getCause }
      }
    }).asInstanceOf[Connection]
  test("Behavioral-Whitebox-GoodCommunication specified: a newly exhausted Running job between confirmation and update is never included") {
    withDatabase { db =>
      val plan=preview(db,"a")
      val arrived=new CountDownLatch(1); val resume=new CountDownLatch(1)
      val pool=Executors.newSingleThreadExecutor()
      try {
        val result=pool.submit(new Callable[RetryFailedResult] {
          def call(): RetryFailedResult = db.transaction { c =>
            val connection=gated(c,_.startsWith("UPDATE ch_jobs j SET state='Queued'"),arrived,resume)
            RetryFailedJobs(connection,"a",id(9016),target,plan.selectionHash,true)
          }
        })
        assert(arrived.await(10,TimeUnit.SECONDS))
        locked(db,"SELECT profile FROM ch_owner_targets WHERE owner='a' FOR UPDATE NOWAIT")
        locked(db,"SELECT id FROM ch_sources WHERE id=? FOR UPDATE NOWAIT",id(3))
        db.transaction { c =>
          assertEquals(Sql.exec(c,"UPDATE ch_jobs SET state='Failed',error='lease-exhausted',lease_until=NULL WHERE id=? AND state='Running' AND attempts>=5",id(106)),1)
        }
        resume.countDown()
        assertEquals(result.get(15,TimeUnit.SECONDS),RetryFailedResult(id(9016),target,1,expected))
        assertEquals(db.transaction(c => Sql.one(c,"SELECT state,fence,attempts,error,completed_windows,total_windows FROM ch_jobs WHERE id=?",id(106)) { r =>
          (r.getString(1),r.getLong(2),r.getInt(3),r.getString(4),r.getInt(5),r.getInt(6))
        }.get),("Failed",14L,5,"lease-exhausted",2,4))
        assertEquals(preview(db,"a").counts,expected.copy(unchangedQueued=2,unchangedRunning=0))
      } finally {
        resume.countDown(); pool.shutdownNow()
        assert(pool.awaitTermination(20,TimeUnit.SECONDS))
      }
    }
  }
  test("Behavioral-Whitebox-GoodCommunication specified: caller repeatable-read preview keeps count and selection on one snapshot during concurrent drift") {
    withDatabase { db =>
      val arrived=new CountDownLatch(1); val resume=new CountDownLatch(1)
      val pool=Executors.newSingleThreadExecutor()
      try {
        val result=pool.submit(new Callable[RetryFailedPlan] {
          def call(): RetryFailedPlan = db.transaction { c =>
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
            RetryFailedJobs.preview(gated(c,_.startsWith("SELECT j.id,j.fence"),arrived,resume),"a")
          }
        })
        assert(arrived.await(10,TimeUnit.SECONDS))
        db.transaction { c =>
          Sql.exec(c,"UPDATE ch_sources SET revision=3 WHERE id=?",id(1))
          Sql.exec(c,"UPDATE ch_jobs SET fence=fence+1,state='Queued' WHERE id=?",id(101))
          Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=epoch+1 WHERE owner='a'",nextTarget)
          ()
        }
        resume.countDown()
        assertEquals(result.get(15,TimeUnit.SECONDS),RetryFailedPlan(target,hash("a",target,List(id(101)->9L)),expected))
        assertNotEquals(preview(db,"a").targetProfile,target)
      } finally {
        resume.countDown(); pool.shutdownNow()
        assert(pool.awaitTermination(20,TimeUnit.SECONDS))
      }
    }
  }

}
