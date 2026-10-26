package chronicle
import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.time.Clock
import java.util.{Base64,UUID,Properties}
import java.sql.{Connection,Driver,DriverManager,DriverPropertyInfo,PreparedStatement,SQLException}
import java.lang.reflect.{InvocationTargetException,Proxy}
import java.util.concurrent.{Callable,CountDownLatch,Executors,TimeUnit}
import java.util.concurrent.atomic.AtomicBoolean

final class RetryFailedActionsTest extends munit.FunSuite {
  private final case class Context(config: Config,db: Database,archive: PostgresArchive,auth: Auth,app: Application,owner: Identity)
  private def database(f: Context => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations,ch_collector_progress CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
      Sql.exec(c,"UPDATE ch_users SET enabled=true")
    }
    val archive=new PostgresArchive(db,config); val auth=new Auth(db,config)
    val (_,cookie)=auth.login(LoginRequest("a","synthetic")); val owner=auth.browser(cookie)
    val forbiddenEmbedder=new Embedder {
      def query(text: String): IO[List[Double]] = IO.raiseError(new AssertionError("Activity/actions must not invoke embeddings"))
      def documents(text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("Activity/actions must not invoke models"))
    }
    val app=new Application(archive,new PostgresSearch(db,archive,config),forbiddenEmbedder,auth,db,new CollectorProgress(new PostgresCollectorProgressStore(db),Clock.systemUTC()),new PostgresArchiveIndex(db,archive,config),new PostgresActivity(db,Clock.systemUTC()))
    f(Context(config,db,archive,auth,app,owner))
  }
  private def call(c: Context,i: Identity,operation: Operation): Result = c.app.operation(i,ClientEnvelope(UUID.randomUUID(),operation)).unsafeRunSync()
  private def preview(c: Context): RetryFailedPlan = call(c,c.owner,Operation.PreviewRetryFailed()).asInstanceOf[Result.RetryFailedPreview].result
  private def ingest(c: Context,owner: String,name: String): IngestReceipt = {
    val source=Fixtures.snapshot()
    c.archive.ingest(owner,source.copy(source=source.source.copy(producerSessionId=name)),c.config.profile)
  }
  private def fail(c: Context,id: UUID): Unit = c.db.transaction { connection =>
    Sql.exec(connection,"UPDATE ch_jobs SET state='Failed',attempts=5,fence=7,lease_until=now()+interval '60 seconds',error='model-http',completed_windows=3,total_windows=5 WHERE id=?",id)
    ()
  }
  private def envelope(plan: RetryFailedPlan,confirm: Boolean): ClientEnvelope = ClientEnvelope(UUID.randomUUID(),Operation.ApplyRetryFailed(plan.targetProfile,plan.selectionHash,confirm))
  private def apply(c: Context,request: ClientEnvelope): RetryFailedResult = c.app.operation(c.owner,request).unsafeRunSync().asInstanceOf[Result.RetryFailed].result
  private def fence(c: Context,id: UUID): Long = c.db.transaction(connection => Sql.one(connection,"SELECT fence FROM ch_jobs WHERE id=?",id)(_.getLong(1)).get)
  private def receipts(c: Context): Long = c.db.transaction(connection => Sql.one(connection,"SELECT count(*) FROM ch_mutations")(_.getLong(1)).get)

  test("Behavioral-Blackbox GoodCommunication specified: browser preview is read-only and apply is all-owned, independent of Activity filters") { database { c =>
    val failed=ingest(c,"a","failed"); fail(c,failed.jobId)
    val other=ingest(c,"b","foreign"); fail(c,other.jobId)
    val filtered=call(c,c.owner,Operation.ActivityJobs(ActivityJobsQuery(None,ActivityJobScope.All,"status:complete",ActivityJobSort.LastTimestamp,SortDirection.Desc,None,1))).asInstanceOf[Result.ActivityJobs].result
    assertEquals(filtered.total,0L)
    val plan=preview(c)
    assertEquals(plan.targetProfile,c.config.profile); assertEquals(plan.counts.eligibleCurrentFailed,1L)
    assertEquals(receipts(c),0L); assertEquals(fence(c,failed.jobId),7L)
    val request=envelope(plan,true); val result=apply(c,request)
    assertEquals(result.requestId,request.requestId); assertEquals(result.retried,1L); assertEquals(result.counts,plan.counts)
    assertEquals(fence(c,failed.jobId),8L); assertEquals(fence(c,other.jobId),7L)
    val jobs=c.archive.statuses("a",0,100).jobs
    assertEquals(jobs.map(_.state),List(JobState.Queued)); assertEquals(jobs.head.attempts,0)
    assertEquals(jobs.head.error,None); assertEquals(jobs.head.completedWindows,0); assertEquals(jobs.head.totalWindows,None)
    assertEquals(receipts(c),1L)
    assertEquals(preview(c).counts.eligibleCurrentFailed,0L)
  }}
  test("Behavioral-Blackbox GoodCommunication specified: same request replays original counts; changed payload conflicts before any action") { database { c =>
    val failed=ingest(c,"a","failed"); fail(c,failed.jobId)
    val request=envelope(preview(c),true); val result=apply(c,request)
    val newFailure=ingest(c,"a","later"); fail(c,newFailure.jobId)
    assertEquals(apply(c,request),result)
    assertEquals(c.auth.receipt(c.owner,request.requestId),Result.RetryFailed(result))
    assertEquals(fence(c,failed.jobId),8L); assertEquals(fence(c,newFailure.jobId),7L)
    assertEquals(receipts(c),1L)
    val changed=request.copy(operation=Operation.ApplyRetryFailed(c.config.profile,"0"*64,true))
    assertEquals(intercept[DomainError](apply(c,changed)).code,"conflict")
    assertEquals(receipts(c),1L); assertEquals(fence(c,newFailure.jobId),7L)
  }}

  test("Behavioral-Blackbox GoodCommunication specified: Activity bare text stays metadata-only without embedding or message search") { database { c =>
    ingest(c,"a","metadata-only")
    val query=ActivityJobsQuery(None,ActivityJobScope.All,"synthetic",ActivityJobSort.LastTimestamp,SortDirection.Desc,None,100)
    assertEquals(call(c,c.owner,Operation.ActivityJobs(query)).asInstanceOf[Result.ActivityJobs].result.total,1L)
    assertEquals(call(c,c.owner,Operation.ActivityJobs(query.copy(expression="PostgreSQL"))).asInstanceOf[Result.ActivityJobs].result.total,0L)
    val collectors=call(c,c.owner,Operation.Activity(ActivityQuery("PostgreSQL",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,100))).asInstanceOf[Result.Activity].result
    assertEquals(collectors.totalCollectors,0L); assertEquals(collectors.allCollectors,1L)
  }}
  test("Behavioral-Blackbox GoodCommunication specified: compact Activity pages use constant SQL statements and never raw/content tables") { database { c =>
    (1 to 3).foreach(n => ingest(c,"a",s"metadata-$n"))
    val statements=new java.util.concurrent.atomic.AtomicInteger(0)
    val prefix="jdbc:chronicle-counted:"+UUID.randomUUID()+":"
    val driver=new GatedDriver(prefix,sql => {
      statements.incrementAndGet()
      List("ch_revisions","ch_messages","ch_chunks","ch_archive_lexical","snapshot").foreach(name => assert(!sql.contains(name),s"metadata-only SQL must not access $name"))
    },(_,_) => (),ConnectionFault.None)
    DriverManager.registerDriver(driver)
    try {
      val config=c.config.copy(jdbcUrl=prefix+c.config.jdbcUrl)
      val activity=new PostgresActivity(new Database(config),Clock.systemUTC())
      List(1,100).foreach { limit =>
        statements.set(0)
        assertEquals(activity.jobs("a",ActivityJobsQuery(None,ActivityJobScope.All,"synthetic",ActivityJobSort.Title,SortDirection.Asc,None,limit)).jobs.size,math.min(limit,3))
        assertEquals(statements.get(),3)
        statements.set(0)
        assertEquals(activity.summary(c.owner.user,ActivityQuery("",ActivityCollectorSort.CurrentTotal,SortDirection.Desc,None,limit)).collectors.size,math.min(limit,3))
        assertEquals(statements.get(),4)
      }
    } finally DriverManager.deregisterDriver(driver)
  }}
  private val gateTimeoutSeconds=10L
  private enum ConnectionFault { case None,RollbackSavepoint,ReleaseSavepoint }
  private final class GatedDriver(prefix: String,before: String => Unit,after: (String,Connection) => Unit,fault: ConnectionFault) extends Driver {
    private val delegate=new org.postgresql.Driver()
    private val faulted=new AtomicBoolean(false)
    def acceptsURL(url: String): Boolean = url.startsWith(prefix)
    def connect(url: String,properties: Properties): Connection = {
      if(!acceptsURL(url)) return null
      val connection=delegate.connect(url.stripPrefix(prefix),properties)
      Proxy.newProxyInstance(classOf[Connection].getClassLoader,Array(classOf[Connection]),(_,method,args) => {
        val arguments=if(args==null) Array.empty[Object] else args
        val failing=fault match {
          case ConnectionFault.None => false
          case ConnectionFault.RollbackSavepoint => method.getName=="rollback" && arguments.nonEmpty
          case ConnectionFault.ReleaseSavepoint => method.getName=="releaseSavepoint"
        }
        if(failing && faulted.compareAndSet(false,true)) throw new SQLException("injected transaction-control failure")
        if(method.getName=="prepareStatement") {
          val sql=arguments(0).asInstanceOf[String]; before(sql)
          val statement=try method.invoke(connection,arguments*).asInstanceOf[PreparedStatement] catch { case e: InvocationTargetException => throw e.getCause }
          Proxy.newProxyInstance(classOf[PreparedStatement].getClassLoader,Array(classOf[PreparedStatement]),(_,operation,parameters) => {
            val values=if(parameters==null) Array.empty[Object] else parameters
            val result=try operation.invoke(statement,values*) catch { case e: InvocationTargetException => throw e.getCause }
            if(Set("executeUpdate","executeLargeUpdate").contains(operation.getName)) after(sql,connection)
            result
          })
        } else try method.invoke(connection,arguments*) catch { case e: InvocationTargetException => throw e.getCause }
      }).asInstanceOf[Connection]
    }
    def getPropertyInfo(url: String,properties: Properties): Array[DriverPropertyInfo] = delegate.getPropertyInfo(url.stripPrefix(prefix),properties)
    def getMajorVersion(): Int = delegate.getMajorVersion()
    def getMinorVersion(): Int = delegate.getMinorVersion()
    def jdbcCompliant(): Boolean = delegate.jdbcCompliant()
    def getParentLogger(): java.util.logging.Logger = delegate.getParentLogger()
  }
  private def outcome(f: => Result): Result = try f catch { case d: DomainError => Result.Error(Failure(d.code,d.detail)) }
  test("Behavioral-Blackbox GoodCommunication regression: a terminal same-ID membership-reversal rejection prevents a delayed original apply") { database { c =>
    val first=ingest(c,"a","A"); fail(c,first.jobId)
    val plan=preview(c); val request=envelope(plan,true)
    val entered=new CountDownLatch(1); val release=new CountDownLatch(1); val once=new AtomicBoolean(true)
    val prefix="jdbc:chronicle-delayed:"+UUID.randomUUID()+":"
    val driver=new GatedDriver(prefix,sql => if(sql.contains("pg_advisory_xact_lock") && once.compareAndSet(true,false)) {
      entered.countDown(); assert(release.await(gateTimeoutSeconds,TimeUnit.SECONDS),"release delayed original before owner mutex")
    },(_,_) => (),ConnectionFault.None)
    val executor=Executors.newSingleThreadExecutor()
    DriverManager.registerDriver(driver)
    try {
      val config=c.config.copy(jdbcUrl=prefix+c.config.jdbcUrl)
      val auth=new Auth(new Database(config),config)
      val delayed=executor.submit(new Callable[Result] { def call(): Result = outcome(auth.mutate(c.owner,request)) })
      assert(entered.await(gateTimeoutSeconds,TimeUnit.SECONDS),"original reached pre-mutex dispatch gate")
      val second=ingest(c,"a","B"); fail(c,second.jobId)
      val rejected=outcome(c.auth.mutate(c.owner,request)).asInstanceOf[Result.Error]
      assertEquals(rejected.failure.code,"conflict")
      assertEquals(fence(c,first.jobId),7L)
      val source=c.archive.headSnapshot("a",second.sessionId)
      c.archive.ingest("a",source.copy(requestId=UUID.randomUUID(),expectedRevision=1),c.config.profile)
      assertEquals(preview(c).selectionHash,plan.selectionHash,"membership returned A→AB→A with A fence unchanged")
      release.countDown()
      val late=delayed.get(gateTimeoutSeconds,TimeUnit.SECONDS)
      assertEquals(late,rejected,"late original must replay terminal rejection, not mutate A after UI resolves uncertainty")
      assertEquals(fence(c,first.jobId),7L)
      assertEquals(c.archive.statuses("a",0,100).jobs.find(_.id==first.jobId).get.state,JobState.Failed)
      assertEquals(c.auth.receipt(c.owner,request.requestId),rejected)
      assertEquals(c.auth.mutate(c.owner,request),rejected)
      val changed=request.copy(operation=Operation.ApplyRetryFailed(plan.targetProfile,"0"*64,true))
      assertEquals(intercept[DomainError](c.auth.mutate(c.owner,changed)).code,"conflict")
      assertEquals(apply(c,envelope(preview(c),true)).retried,1L)
    } finally {
      release.countDown(); executor.shutdownNow(); DriverManager.deregisterDriver(driver)
    }
  }}

  test("Behavioral-Blackbox GoodCommunication specified: only browser Read can preview/apply; invalid confirmation and disabled ownership leave no receipt") { database { c =>
    val failed=ingest(c,"a","failed"); fail(c,failed.jobId)
    val plan=preview(c); val request=envelope(plan,true)
    val agent=c.owner.copy(browser=false)
    val withoutRead=c.owner.copy(user=c.owner.user.copy(scopes=Nil))
    List(agent,withoutRead).foreach { identity =>
      assertEquals(intercept[DomainError](call(c,identity,Operation.PreviewRetryFailed())).code,"forbidden")
      assertEquals(intercept[DomainError](c.auth.mutate(identity,request)).code,"forbidden")
    }
    assertEquals(intercept[DomainError](apply(c,envelope(plan,false))).code,"invalid")
    c.db.transaction(connection => Sql.exec(connection,"UPDATE ch_users SET enabled=false WHERE id='a'"))
    assertEquals(intercept[DomainError](preview(c)).code,"unauthorized")
    assertEquals(intercept[DomainError](apply(c,request)).code,"unauthorized")
    assertEquals(receipts(c),0L); assertEquals(fence(c,failed.jobId),7L)
  }}
  test("Behavioral-Blackbox GoodCommunication specified: savepoint rollback removes real partial effects before storing a sanitized terminal conflict") { database { c =>
    val failed=ingest(c,"a","failed"); fail(c,failed.jobId)
    val request=envelope(preview(c),true); val wrote=new AtomicBoolean(false)
    val prefix="jdbc:chronicle-postwrite:"+UUID.randomUUID()+":"
    val driver=new GatedDriver(prefix,_ => (),(sql,connection) => if(sql.startsWith("UPDATE ch_jobs j SET state='Queued'")) {
      val actual=Sql.one(connection,"SELECT state,fence FROM ch_jobs WHERE id=?",failed.jobId)(r => (r.getString(1),r.getLong(2))).get
      assertEquals(actual,("Queued",8L)); wrote.set(true)
      throw DomainError("conflict","injected detail must never be persisted")
    },ConnectionFault.None)
    DriverManager.registerDriver(driver)
    try {
      val config=c.config.copy(jdbcUrl=prefix+c.config.jdbcUrl)
      val auth=new Auth(new Database(config),config)
      val result=auth.mutate(c.owner,request)
      assert(wrote.get()); assertEquals(result,Result.Error(Failure("conflict","retry selection changed; preview again")))
      assertEquals(fence(c,failed.jobId),7L); assertEquals(c.archive.statuses("a",0,100).jobs.head.state,JobState.Failed)
      assertEquals(c.auth.receipt(c.owner,request.requestId),result); assertEquals(auth.mutate(c.owner,request),result)
      assertEquals(receipts(c),1L)
      val fresh=apply(c,envelope(preview(c),true))
      assertEquals(fresh.retried,1L); assertEquals(fence(c,failed.jobId),8L)
      assertEquals(receipts(c),2L)
    } finally DriverManager.deregisterDriver(driver)
  }}
  test("Behavioral-Blackbox GoodCommunication specified: failed savepoint rollback, release or receipt insertion never records a terminal outcome") {
    List(ConnectionFault.RollbackSavepoint,ConnectionFault.ReleaseSavepoint,ConnectionFault.None).foreach { fault => database { c =>
      val failed=ingest(c,"a","failed"); fail(c,failed.jobId)
      val request=envelope(preview(c),true)
      val prefix="jdbc:chronicle-rollback-failure:"+UUID.randomUUID()+":"
      val driver=new GatedDriver(prefix,sql => if(fault==ConnectionFault.None && sql.startsWith("INSERT INTO ch_mutations")) throw new SQLException("injected receipt failure"),(sql,_) => if(sql.startsWith("UPDATE ch_jobs j SET state='Queued'")) throw DomainError("conflict","injected post-write conflict"),fault)
      DriverManager.registerDriver(driver)
      try {
        val config=c.config.copy(jdbcUrl=prefix+c.config.jdbcUrl)
        val auth=new Auth(new Database(config),config)
        intercept[SQLException](auth.mutate(c.owner,request))
        assertEquals(receipts(c),0L); assertEquals(fence(c,failed.jobId),7L)
        assertEquals(c.archive.statuses("a",0,100).jobs.head.state,JobState.Failed)
      } finally DriverManager.deregisterDriver(driver)
    }}
  }
  test("Behavioral-Blackbox GoodCommunication specified: actual SQL failure rolls back jobs and does not become a rejected or successful receipt") { database { c =>
    val failed=ingest(c,"a","overflow"); fail(c,failed.jobId)
    c.db.transaction(connection => Sql.exec(connection,"UPDATE ch_jobs SET fence=? WHERE id=?",Long.MaxValue,failed.jobId))
    val request=envelope(preview(c),true)
    intercept[SQLException](apply(c,request))
    assertEquals(receipts(c),0L); assertEquals(fence(c,failed.jobId),Long.MaxValue)
    assertEquals(c.archive.statuses("a",0,100).jobs.head.state,JobState.Failed)
  }}
  test("Behavioral-Blackbox GoodCommunication specified: same-ID receipt replay needs no TEMP capability; unavailable new apply changes no rows or receipts") { database { c =>
    val first=ingest(c,"a","first"); fail(c,first.jobId)
    val request=envelope(preview(c),true); val result=apply(c,request)
    val second=ingest(c,"a","second"); fail(c,second.jobId)
    val next=envelope(preview(c),true)
    val role="retry_receipt_"+UUID.randomUUID().toString.replace("-","")
    val database=c.db.transaction(connection => Sql.one(connection,"SELECT current_database()")(_.getString(1)).get)
    def quote(value: String): String = "\""+value.replace("\"","\"\"")+"\""
    c.db.transaction { connection =>
      Sql.exec(connection,s"CREATE ROLE $role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE")
      Sql.exec(connection,s"GRANT USAGE ON SCHEMA public TO $role")
      Sql.exec(connection,s"GRANT SELECT,INSERT,UPDATE ON ch_users,ch_profile,ch_sources,ch_jobs,ch_mutations TO $role")
      Sql.exec(connection,s"REVOKE TEMP ON DATABASE ${quote(database)} FROM PUBLIC")
    }
    try {
      val config=c.config.copy(databaseUser=role); val db=new Database(config); val auth=new Auth(db,config)
      assert(!db.transaction(connection => Sql.one(connection,"SELECT has_database_privilege(current_user,current_database(),'TEMP')")(_.getBoolean(1)).get))
      assertEquals(auth.mutate(c.owner,request),Result.RetryFailed(result))
      assertEquals(intercept[DomainError](auth.mutate(c.owner,next)).code,"unavailable")
      assertEquals(receipts(c),1L); assertEquals(fence(c,second.jobId),7L)
    } finally c.db.transaction { connection =>
      Sql.exec(connection,s"GRANT TEMP ON DATABASE ${quote(database)} TO PUBLIC")
      Sql.exec(connection,s"DROP OWNED BY $role"); Sql.exec(connection,s"DROP ROLE $role")
    }
  }}

  test("Behavioral-Blackbox GoodCommunication specified: Activity title references retain job-revision keys across HEAD changes and reject invalid anchors") { database { c =>
    val source=Fixtures.snapshot(); val original=source.copy(metadata=source.metadata.copy(title="a"))
    val first=c.archive.ingest("a",original,c.config.profile)
    val secondSource=Fixtures.snapshot(); val second=c.archive.ingest("a",secondSource.copy(metadata=secondSource.metadata.copy(title="b")),c.config.profile)
    val query=ActivityJobsQuery(None,ActivityJobScope.Current,"",ActivityJobSort.Title,SortDirection.Asc,None,1)
    val cursor=call(c,c.owner,Operation.ActivityJobs(query)).asInstanceOf[Result.ActivityJobs].result.nextCursor.get
    c.archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=original.metadata.copy(title="z")),c.config.profile)
    def next(value: String): ActivityJobsResult = call(c,c.owner,Operation.ActivityJobs(query.copy(cursor=Some(value)))).asInstanceOf[Result.ActivityJobs].result
    assertEquals(next(cursor).jobs.head.job.sessionId,second.sessionId)
    val fields=Wire.parse(new String(Base64.getUrlDecoder.decode(cursor),java.nio.charset.StandardCharsets.UTF_8)).asArray.get
    val position=fields.size-2; val anchor=RevisionSortAnchor.decode(fields(position))
    def encoded(values: Vector[io.circe.Json]): String = Base64.getUrlEncoder.withoutPadding.encodeToString(io.circe.Json.fromValues(values).noSpaces.getBytes(java.nio.charset.StandardCharsets.UTF_8))
    List(anchor.copy(revision=2),anchor.copy(keyHash="0"*64)).foreach { changed =>
      assertEquals(intercept[DomainError](next(encoded(fields.updated(position,RevisionSortAnchor.encode(changed))))).code,"conflict")
    }
    val foreignSource=Fixtures.snapshot(); val foreign=c.archive.ingest("b",foreignSource.copy(metadata=foreignSource.metadata.copy(title="a")),c.config.profile)
    assertEquals(intercept[DomainError](next(encoded(fields.updated(fields.size-1,io.circe.Json.fromString(foreign.jobId.toString))))).code,"conflict")
    assertEquals(intercept[DomainError](next(encoded(fields.updated(position,io.circe.Json.fromString("not-an-anchor"))))).code,"invalid")
    call(c,c.owner,Operation.Purge(first.sessionId))
    assertEquals(intercept[DomainError](next(cursor)).code,"conflict")
  }}

  private final case class UnboundedArchiveField(sort: ArchiveSort,update: (Metadata,String) => Metadata)
  private val unboundedArchiveFields=List(
    UnboundedArchiveField(ArchiveSort.Title,(metadata,value) => metadata.copy(title=value)),
    UnboundedArchiveField(ArchiveSort.Project,(metadata,value) => metadata.copy(project=Some(value))),
    UnboundedArchiveField(ArchiveSort.Branch,(metadata,value) => metadata.copy(gitBranch=Some(value))),
    UnboundedArchiveField(ArchiveSort.Producer,(metadata,value) => metadata.copy(producer=value)),
    UnboundedArchiveField(ArchiveSort.Model,(metadata,value) => metadata.copy(model=Some(value))))
  private def continuationBytes(operation: Operation): Int = Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),operation)).noSpaces.getBytes(java.nio.charset.StandardCharsets.UTF_8).length
  unboundedArchiveFields.foreach { field =>
    test(s"Behavioral-Blackbox GoodCommunication regression: actual valid ${field.sort} ingestion yields an Archive continuation within the WebSocket frame bound") { database { c =>
      (1 to 2).foreach { n =>
        val source=Fixtures.snapshot(); val metadata=field.update(source.metadata,"x"*50000+n)
        c.archive.ingest("a",source.copy(metadata=metadata),c.config.profile)
      }
      val query=ArchiveQuery("mode:lexical",field.sort,SortDirection.Asc,None,1)
      val first=call(c,c.owner,Operation.Archive(query)).asInstanceOf[Result.Archive].result
      val next=query.copy(cursor=first.nextCursor)
      assert(next.cursor.nonEmpty)
      val bytes=continuationBytes(Operation.Archive(next))
      println(s"ARCHIVE ${field.sort} actual-ingestion cursor bytes=$bytes existingFrameLimit=${Http.socketFrameBytes}")
      assert(bytes<=Http.socketFrameBytes,s"server-produced ${field.sort} continuation $bytes exceeds ${Http.socketFrameBytes}")
      val second=call(c,c.owner,Operation.Archive(next)).asInstanceOf[Result.Archive].result
      assertEquals(second.rows.size,1); assert(first.rows.head.head.id!=second.rows.head.head.id)
    }}
  }
  test("Behavioral-Blackbox GoodCommunication regression: actual valid long Title ingestion yields an Activity continuation within the WebSocket frame bound") { database { c =>
    (1 to 2).foreach { n =>
      val source=Fixtures.snapshot()
      c.archive.ingest("a",source.copy(metadata=source.metadata.copy(title="x"*50000+n)),c.config.profile)
    }
    val query=ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.Title,SortDirection.Asc,None,1)
    val first=call(c,c.owner,Operation.ActivityJobs(query)).asInstanceOf[Result.ActivityJobs].result
    val next=query.copy(cursor=first.nextCursor)
    assert(next.cursor.nonEmpty)
    val bytes=continuationBytes(Operation.ActivityJobs(next))
    println(s"ACTIVITY Title actual-ingestion cursor bytes=$bytes existingFrameLimit=${Http.socketFrameBytes}")
    assert(bytes<=Http.socketFrameBytes,s"server-produced Title continuation $bytes exceeds ${Http.socketFrameBytes}")
    val second=call(c,c.owner,Operation.ActivityJobs(next)).asInstanceOf[Result.ActivityJobs].result
    assertEquals(second.jobs.size,1); assert(first.jobs.head.job.id!=second.jobs.head.job.id)
  }}

  test("Behavioral-Blackbox GoodCommunication regression: admitted long owner identities do not expand cursor context beyond the WebSocket frame bound") { database { c =>
    val owner="x"*50000
    val configured=c.config.copy(users=c.config.users:+UserConfig(owner,"long-owner",c.config.users.head.passwordHashFile,true))
    configured.validate()
    val db=new Database(configured); db.initialize()
    val auth=new Auth(db,configured)
    val (_,cookie)=auth.login(LoginRequest("long-owner","synthetic")); val identity=auth.browser(cookie)
    assertEquals(identity.user.id.length,owner.length)
    val archive=new PostgresArchive(db,configured)
    (1 to 2).foreach { n => val source=Fixtures.snapshot(); archive.ingest(owner,source.copy(metadata=source.metadata.copy(title=s"bounded-$n")),configured.profile) }
    val activity=new PostgresActivity(db,Clock.systemUTC())
    val jobQuery=ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.JobId,SortDirection.Asc,None,1)
    val jobs=activity.jobs(owner,jobQuery)
    val collectorQuery=ActivityQuery("",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,1)
    val collectors=activity.summary(identity.user,collectorQuery)
    val archiveQuery=ArchiveQuery("mode:lexical",ArchiveSort.Owner,SortDirection.Asc,None,1)
    val index=new PostgresArchiveIndex(db,archive,configured)
    val result=index.browse(owner,archiveQuery,ArchiveExpression.parse(archiveQuery.expression),Nil)
    val frames=List(
      "ActivityJobs"->continuationBytes(Operation.ActivityJobs(jobQuery.copy(cursor=jobs.nextCursor))),
      "ActivityCollectors"->continuationBytes(Operation.Activity(collectorQuery.copy(cursor=collectors.nextCursor))),
      "ArchiveOwner"->continuationBytes(Operation.Archive(archiveQuery.copy(cursor=result.nextCursor))))
    frames.foreach { case (family,bytes) => println(s"$family actual-admitted-owner cursor bytes=$bytes existingFrameLimit=${Http.socketFrameBytes}") }
    assert(frames.forall(_._2<=Http.socketFrameBytes),s"admitted owner continuation sizes ${frames.map { case (family,bytes) => s"$family=$bytes" }.mkString(",")} exceed ${Http.socketFrameBytes}")
  }}
  test("Behavioral-Blackbox GoodCommunication regression: admitted mutable failure reasons use bounded guarded cursor positions") { database { c =>
    (1 to 2).foreach { n =>
      ingest(c,"a",s"reason-$n")
      (1 to 5).foreach { _ => val claim=c.archive.claim(c.config.profile,300).get; c.archive.fail(claim,"x"*50000+n) }
    }
    val query=ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.Reason,SortDirection.Asc,None,1)
    val first=call(c,c.owner,Operation.ActivityJobs(query)).asInstanceOf[Result.ActivityJobs].result
    val next=query.copy(cursor=first.nextCursor)
    val bytes=continuationBytes(Operation.ActivityJobs(next))
    println(s"ACTIVITY Reason actual-admitted-code cursor bytes=$bytes existingFrameLimit=${Http.socketFrameBytes}")
    assert(bytes<=Http.socketFrameBytes,s"admitted Reason continuation $bytes exceeds ${Http.socketFrameBytes}")
    val second=call(c,c.owner,Operation.ActivityJobs(next)).asInstanceOf[Result.ActivityJobs].result
    assertEquals(second.jobs.size,1); assert(first.jobs.head.job.id!=second.jobs.head.job.id)
  }}

}
