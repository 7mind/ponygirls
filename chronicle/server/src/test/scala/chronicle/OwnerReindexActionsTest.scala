package chronicle

import chronicle.api.*
import java.util.{UUID,Properties}
import java.sql.{Connection,Driver,DriverManager,DriverPropertyInfo,PreparedStatement,SQLException}
import java.lang.reflect.{InvocationTargetException,Proxy}
import java.util.concurrent.{Callable,CountDownLatch,ExecutionException,Executors,Future,TimeUnit}
import java.util.concurrent.atomic.AtomicBoolean

final class OwnerReindexActionsTest extends munit.FunSuite {
  private final case class Context(config: Config,db: Database,archive: PostgresArchive,auth: Auth,owner: Identity)
  private def database(f: Context => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped")
    }
    val c=Fixtures.config(); val legacy=new Database(c,IndexProfileCatalog.legacyOnly(c)); legacy.initialize()
    legacy.transaction { x =>
      Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_sessions,ch_mutations,ch_tokens,ch_collector_progress CASCADE")
      Sql.exec(x,"UPDATE ch_owner_targets SET profile=?,epoch=0",c.profile)
      Sql.exec(x,"UPDATE ch_profile SET active=?,target=?,maintenance=false",c.profile,c.profile)
    }
    val catalog=IndexProfileCatalog.passages(c,PassagePolicyIdentity(ProblemPassages.identity))
    val db=new Database(c,catalog); db.initialize()
    val auth=new Auth(db,c); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    f(Context(c,db,new PostgresArchive(db,c),auth,owner))
  }
  private def plan(c: Context): OwnerReindexPlan = c.auth.previewOwnerReindex(c.owner)
  private def envelope(p: OwnerReindexPlan): ClientEnvelope = ClientEnvelope(UUID.randomUUID(),Operation.ApplyOwnerReindex(p.targetProfile,p.selectionHash,true))
  private def rows(c: Context,table: String): List[String] = c.db.transaction(x => Sql.rows(x,s"SELECT to_jsonb(t)::text FROM $table t ORDER BY to_jsonb(t)::text")(_.getString(1)))
  private def retained(c: Context): List[(String,List[String])] =
    List("ch_revisions","ch_revision_info","ch_messages","ch_generations","ch_chunks","ch_search_chunks","ch_generation_tags","ch_ingest_receipts").map(table => table->rows(c,table))
  private def ownerRows(c: Context,owner: String): List[String] = c.db.transaction { x =>
    Sql.rows(x,"SELECT to_jsonb(j)::text FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id WHERE s.owner=? ORDER BY j.id",owner)(_.getString(1))++
      Sql.rows(x,"SELECT to_jsonb(s)::text FROM ch_sources s WHERE s.owner=? ORDER BY s.id",owner)(_.getString(1))++
      Sql.rows(x,"SELECT to_jsonb(t)::text FROM ch_owner_targets t WHERE t.owner=?",owner)(_.getString(1))
  }
  private def receiptCount(c: Context,id: UUID): Long = c.db.transaction(x => Sql.one(x,"SELECT count(*) FROM ch_mutations WHERE owner='a' AND request_id=?",id)(_.getLong(1)).get)
  private def applied(c: Context,request: ClientEnvelope): OwnerReindexResult = c.auth.mutate(c.owner,request).asInstanceOf[Result.OwnerReindexed].result
  test("specified: Auth executes owner replacement with the envelope request ID") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot())
    val request=envelope(plan(c))
    val result=c.auth.mutate(c.owner,request).asInstanceOf[Result.OwnerReindexed].result
    assertEquals(result.requestId,request.requestId); assertEquals(result.heads,1L); assertEquals(result.queued,1L)
  }}
  test("Blackbox GoodCommunication regression: same-target live claim is forcibly replaced once and its exact stored receipt never fences the new worker again") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot())
    applied(c,envelope(plan(c)))
    val claim=c.archive.claim(c.db.profiles.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals(claim.profile,c.db.profiles.preferred.profile)
    val before=ownerRows(c,"a")
    val preview=plan(c)
    assertEquals(preview.currentTargetProfile,preview.targetProfile)
    assertEquals((preview.heads,preview.alreadyCurrent,preview.replacements),(1L,0L,1L))
    val request=envelope(preview)
    val result=c.auth.mutate(c.owner,request)
    assertEquals(result,Result.OwnerReindexed(OwnerReindexResult(request.requestId,preview.targetProfile,1L,1L,0L,1L)))
    val after=ownerRows(c,"a"); assertNotEquals(after,before)
    assertEquals(c.auth.receipt(c.owner,request.requestId),result)
    assertEquals(c.auth.mutate(c.owner,request),result)
    assertEquals(receiptCount(c,request.requestId),1L)
    assertEquals(ownerRows(c,"a"),after,"receipt replay cannot repeat the replacement")
    assert(!c.archive.renew(claim,300))
    val fresh=c.archive.claim(c.db.profiles.knownProfiles,ClaimScope.Owner("a"),300).get
    assertNotEquals(fresh.runId,claim.runId); assert(fresh.fence>claim.fence && fresh.targetEpoch>claim.targetEpoch)
    assert(ProblemPublicationFixtures.publish(c.archive,fresh,c.db.profiles))
  }}
  test("specified: Auth retains owner selection conflicts as a digest-bound terminal receipt") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot())
    val request=envelope(plan(c)); c.archive.ingest("a",Fixtures.snapshot())
    val result=c.auth.mutate(c.owner,request).asInstanceOf[Result.Error]
    assertEquals(result.failure.code,"conflict"); assertEquals(c.auth.receipt(c.owner,request.requestId),result)
  }}
  test("Blackbox GoodCommunication: preview and apply select every live owned HEAD, not filtered or shared sources, preserving immutable history") { database { c =>
    val first=c.archive.ingest("a",Fixtures.snapshot())
    assert(c.archive.publish(c.archive.claim(Set(c.config.profile),ClaimScope.Owner("a"),300).get,Nil))
    val original=Fixtures.snapshot(); val second=c.archive.ingest("a",original)
    val updated=original.copy(requestId=UUID.randomUUID(),expectedRevision=1)
    c.archive.ingest("a",updated)
    val running=c.archive.claim(Set(c.config.profile),ClaimScope.Owner("a"),300).get
    c.archive.ingest("a",Fixtures.snapshot())
    val removed=c.archive.ingest("a",Fixtures.snapshot())
    c.auth.mutate(c.owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(removed.sessionId)))
    val foreign=c.archive.ingest("b",Fixtures.snapshot())
    val group=c.auth.mutate(c.owner,ClientEnvelope(UUID.randomUUID(),Operation.CreateGroup("synthetic"))).asInstanceOf[Result.Mutation].receipt.entityId.get
    val invitation=c.auth.mutate(c.owner,ClientEnvelope(UUID.randomUUID(),Operation.Invite(group,"b"))).asInstanceOf[Result.Mutation].receipt.entityId.get
    val other=c.auth.browser(c.auth.login(LoginRequest("b","synthetic"))._2)
    c.auth.mutate(other,ClientEnvelope(UUID.randomUUID(),Operation.AcceptInvite(invitation,true)))
    val q=ArchiveQuery("mode:lexical user:b",ArchiveSort.Title,SortDirection.Asc,None,100)
    assertEquals(new PostgresArchiveIndex(c.db,c.archive,c.config).browse("a",q,ArchiveExpression.parse(q.expression),Nil).rows.map(_.head.id),List(foreign.sessionId))
    val preserved=retained(c); val others=ownerRows(c,"b"); val priorReceipts=rows(c,"ch_mutations")
    val sourceRows=rows(c,"ch_sources"); val published=c.archive.session("a",first.sessionId).view
    val preview=plan(c)
    assertEquals(preview,OwnerReindexPlan(c.config.profile,c.db.profiles.preferred.profile,preview.selectionHash,3L,0L,3L))
    assertEquals(retained(c),preserved); assertEquals(rows(c,"ch_mutations"),priorReceipts)
    val request=envelope(preview); val result=applied(c,request)
    assertEquals(result,OwnerReindexResult(request.requestId,preview.targetProfile,3L,3L,0L,1L))
    assertEquals(retained(c),preserved); assertEquals(ownerRows(c,"b"),others); assertEquals(rows(c,"ch_sources"),sourceRows)
    val afterReceipts=rows(c,"ch_mutations")
    assert(priorReceipts.forall(afterReceipts.contains)); assertEquals(afterReceipts.size,priorReceipts.size+1)
    assertEquals(c.archive.session("a",first.sessionId).view,published)
    assertEquals(c.db.transaction(x => Sql.one(x,"SELECT profile,epoch FROM ch_owner_targets WHERE owner='a'")(r => (r.getString(1),r.getLong(2))).get),(preview.targetProfile,1L))
    assert(!c.archive.renew(running,300)); assert(!c.archive.publish(running,Nil))
    assertEquals(c.archive.ingest("a",updated).sessionId,second.sessionId)
    val continued=c.archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=2))
    assertEquals(c.db.transaction(x => Sql.one(x,"SELECT profile FROM ch_jobs WHERE id=?",continued.jobId)(_.getString(1)).get),preview.targetProfile)
  }}
  test("Blackbox GoodCommunication: own 1.4 codecs retain exact request identity, payload binding and original replay counts") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot()); val request=envelope(plan(c))
    val decoded=Wire.decode(ClientEnvelope.codecJson,Wire.encode(ClientEnvelope.codecJson,request))
    assertEquals(decoded,request)
    val result=c.auth.mutate(c.owner,decoded)
    assertEquals(Wire.decode(Result.codecJson,Wire.encode(Result.codecJson,result)),result)
    val before=ownerRows(c,"a"); c.archive.ingest("a",Fixtures.snapshot())
    val afterIngest=ownerRows(c,"a")
    assertEquals(c.auth.mutate(c.owner,decoded),result); assertEquals(c.auth.receipt(c.owner,request.requestId),result)
    assertEquals(ownerRows(c,"a"),afterIngest); assertEquals(receiptCount(c,request.requestId),1L)
    assertEquals(intercept[DomainError](c.auth.mutate(c.owner,request.copy(operation=Operation.ApplyOwnerReindex(c.db.profiles.preferred.profile,"0"*64,true)))).code,"conflict")
    assertEquals(c.auth.receipt(c.owner,request.requestId),result); assertNotEquals(before,afterIngest)
  }}
  List("disabled","expired","revoked","changed-principal").foreach { change =>
    test(s"Blackbox GoodCommunication: $change browser authority is rejected before preview, apply and stored-receipt replay") { database { c =>
      c.archive.ingest("a",Fixtures.snapshot()); val request=envelope(plan(c)); applied(c,request)
      val next=envelope(plan(c)); val oldReceipt=c.auth.receipt(c.owner,request.requestId)
      c.db.transaction { x => change match {
        case "disabled" => Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id='a'")
        case "expired" => Sql.exec(x,"UPDATE ch_sessions SET expires=clock_timestamp()-interval '1 second' WHERE hash=?",c.owner.credentialHash)
        case "revoked" => Sql.exec(x,"DELETE FROM ch_sessions WHERE hash=?",c.owner.credentialHash)
        case "changed-principal" => Sql.exec(x,"UPDATE ch_sessions SET owner='b' WHERE hash=?",c.owner.credentialHash)
      } }
      val before=ownerRows(c,"a"); val others=ownerRows(c,"b")
      assertEquals(intercept[DomainError](plan(c)).code,"unauthorized")
      List(request,next).foreach(e => assertEquals(intercept[DomainError](c.auth.mutate(c.owner,e)).code,"unauthorized"))
      assertEquals(ownerRows(c,"a"),before); assertEquals(ownerRows(c,"b"),others)
      assertEquals(receiptCount(c,next.requestId),0L); assertEquals(c.auth.receipt(c.owner,request.requestId),oldReceipt)
    }}
  }
  test("Blackbox GoodCommunication: browser and Read are mandatory; invalid input does not leave a terminal receipt") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot()); val request=envelope(plan(c))
    val token=c.auth.mutate(c.owner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("synthetic",List(Scope.Read)))).asInstanceOf[Result.Token].result.secret.get
    List(c.auth.bearer(token),c.owner.copy(user=c.owner.user.copy(scopes=Nil))).foreach { i =>
      assertEquals(intercept[DomainError](c.auth.previewOwnerReindex(i)).code,"forbidden")
      assertEquals(intercept[DomainError](c.auth.mutate(i,request)).code,"forbidden")
    }
    val before=ownerRows(c,"a")
    List(Operation.ApplyOwnerReindex(c.db.profiles.preferred.profile,plan(c).selectionHash,false),Operation.ApplyOwnerReindex(c.db.profiles.preferred.profile,"invalid",true)).foreach { operation =>
      val invalid=ClientEnvelope(UUID.randomUUID(),operation)
      assertEquals(intercept[DomainError](c.auth.mutate(c.owner,invalid)).code,"invalid")
      assertEquals(receiptCount(c,invalid.requestId),0L)
    }
    assertEquals(receiptCount(c,request.requestId),0L); assertEquals(ownerRows(c,"a"),before)
  }}
  private enum ConnectionFault { case None,CreateSavepoint,RollbackSavepoint,ReleaseSavepoint }
  private final class ObservedDriver(prefix: String,before: String => Unit,after: (String,Connection) => Unit,fault: ConnectionFault) extends Driver {
    private val delegate=new org.postgresql.Driver(); private val faulted=new AtomicBoolean(false)
    def acceptsURL(url: String): Boolean = url.startsWith(prefix)
    def connect(url: String,properties: Properties): Connection = {
      if(!acceptsURL(url)) return null
      val connection=delegate.connect(url.stripPrefix(prefix),properties)
      Proxy.newProxyInstance(classOf[Connection].getClassLoader,Array(classOf[Connection]),(_,method,args) => {
        val arguments=if(args==null) Array.empty[Object] else args
        val failing=fault match {
          case ConnectionFault.None => false
          case ConnectionFault.CreateSavepoint => method.getName=="setSavepoint"
          case ConnectionFault.RollbackSavepoint => method.getName=="rollback" && arguments.nonEmpty
          case ConnectionFault.ReleaseSavepoint => method.getName=="releaseSavepoint"
        }
        if(failing && faulted.compareAndSet(false,true)) throw new SQLException("synthetic savepoint fault")
        if(method.getName=="prepareStatement") {
          val sql=arguments(0).asInstanceOf[String]; before(sql)
          val statement=try method.invoke(connection,arguments*).asInstanceOf[PreparedStatement] catch { case e: InvocationTargetException => throw e.getCause }
          Proxy.newProxyInstance(classOf[PreparedStatement].getClassLoader,Array(classOf[PreparedStatement]),(_,operation,parameters) => {
            val values=if(parameters==null) Array.empty[Object] else parameters
            val result=try operation.invoke(statement,values*) catch { case e: InvocationTargetException => throw e.getCause }
            if(Set("executeUpdate","executeLargeUpdate","executeQuery").contains(operation.getName)) after(sql,connection)
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
  private def observed(c: Context,before: String => Unit,after: (String,Connection) => Unit,fault: ConnectionFault)(f: Auth => Unit): Unit = {
    val prefix="jdbc:owner-actions-"+UUID.randomUUID()+":"; val driver=new ObservedDriver(prefix,before,after,fault)
    DriverManager.registerDriver(driver)
    try {
      val config=c.config.copy(jdbcUrl=prefix+c.config.jdbcUrl)
      f(new Auth(new Database(config,c.db.profiles),config))
    } finally DriverManager.deregisterDriver(driver)
  }
  test("Effectual GoodCommunication: preview authenticates and selects on one repeatable-read connection without mutation") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot()); val before=ownerRows(c,"a"); val receipts=rows(c,"ch_mutations")
    var observedConnection: Option[Connection]=None; val authenticated=new AtomicBoolean(false)
    observed(c,_ => (),(sql,connection) => {
      assert(sql.startsWith("SELECT")); assertEquals(connection.getTransactionIsolation,Connection.TRANSACTION_REPEATABLE_READ)
      observedConnection match { case None => observedConnection=Some(connection); case Some(first) => assert(first eq connection) }
      if(sql.startsWith("SELECT u.id,u.login FROM ch_sessions")) authenticated.set(true)
    },ConnectionFault.None) { auth =>
      assertEquals(auth.previewOwnerReindex(c.owner),plan(c)); assert(authenticated.get())
    }
    assertEquals(ownerRows(c,"a"),before); assertEquals(rows(c,"ch_mutations"),receipts)
  }}
  test("Effectual GoodCommunication: handler Conflict rolls back actual partial owner/job effects before sanitized receipt storage") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot()); val request=envelope(plan(c)); val before=ownerRows(c,"a"); val wrote=new AtomicBoolean(false)
    observed(c,_ => (),(sql,connection) => if(sql.startsWith("INSERT INTO ch_jobs(")) {
      assertEquals(Sql.one(connection,"SELECT profile FROM ch_owner_targets WHERE owner='a'")(_.getString(1)).get,c.db.profiles.preferred.profile)
      assertEquals(Sql.one(connection,"SELECT count(*) FROM ch_jobs WHERE profile=?",c.db.profiles.preferred.profile)(_.getLong(1)).get,1L)
      wrote.set(true); throw DomainError("conflict","synthetic handler detail must not be persisted")
    },ConnectionFault.None) { auth =>
      val result=auth.mutate(c.owner,request)
      assert(wrote.get()); assertEquals(result,Result.Error(Failure("conflict","owner reindex selection changed; preview again")))
      assertEquals(ownerRows(c,"a"),before); assertEquals(c.auth.receipt(c.owner,request.requestId),result)
      assertEquals(c.auth.mutate(c.owner,request),result)
    }
  }}
  test("Effectual GoodCommunication: receipt insertion and savepoint faults roll back instead of creating safe terminal conflicts") {
    List(ConnectionFault.None,ConnectionFault.CreateSavepoint,ConnectionFault.RollbackSavepoint,ConnectionFault.ReleaseSavepoint).foreach { fault => database { c =>
      c.archive.ingest("a",Fixtures.snapshot()); val request=envelope(plan(c)); val before=ownerRows(c,"a")
      observed(c,sql => if(fault==ConnectionFault.None && sql.startsWith("INSERT INTO ch_mutations")) throw new SQLException("synthetic receipt fault"),(sql,_) => if(fault==ConnectionFault.RollbackSavepoint && sql.startsWith("INSERT INTO ch_jobs(")) throw DomainError("conflict","synthetic handler conflict"),fault) { auth =>
        intercept[SQLException](auth.mutate(c.owner,request))
        assertEquals(ownerRows(c,"a"),before); assertEquals(receiptCount(c,request.requestId),0L)
      }
    }}
  }
  test("Effectual GoodCommunication: actual PostgreSQL overflow is not converted to a terminal Conflict") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot())
    c.db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET fence=? WHERE session_id IN(SELECT id FROM ch_sources WHERE owner='a')",Long.MaxValue))
    val request=envelope(plan(c)); val before=ownerRows(c,"a")
    assertEquals(intercept[SQLException](c.auth.mutate(c.owner,request)).getSQLState,"22003")
    assertEquals(ownerRows(c,"a"),before); assertEquals(receiptCount(c,request.requestId),0L)
  }}
  test("Effectual GoodCommunication: delayed original cannot execute after actual A to AB to A selection restoration") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot()); val preview=plan(c); val request=envelope(preview)
    val entered=new CountDownLatch(1); val resume=new CountDownLatch(1); val once=new AtomicBoolean(true)
    val pool=Executors.newSingleThreadExecutor()
    try observed(c,sql => if(sql.contains("pg_advisory_xact_lock") && once.compareAndSet(true,false)) {
      entered.countDown(); assert(resume.await(10,TimeUnit.SECONDS))
    },(_,_) => (),ConnectionFault.None) { auth =>
      val pending=pool.submit(new Callable[Result] { def call(): Result = auth.mutate(c.owner,request) })
      assert(entered.await(10,TimeUnit.SECONDS))
      val added=c.archive.ingest("a",Fixtures.snapshot())
      val rejected=c.auth.mutate(c.owner,request)
      assertEquals(rejected,Result.Error(Failure("conflict","owner reindex selection changed; preview again")))
      c.auth.mutate(c.owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(added.sessionId)))
      assertEquals(plan(c),preview,"the real selected source/job membership returned to A with unchanged versions")
      val before=ownerRows(c,"a"); resume.countDown()
      assertEquals(pending.get(10,TimeUnit.SECONDS),rejected); assertEquals(c.auth.mutate(c.owner,request),rejected)
      assertEquals(c.auth.receipt(c.owner,request.requestId),rejected); assertEquals(ownerRows(c,"a"),before)
      assertEquals(applied(c,envelope(plan(c))).queued,1L)
    } finally { resume.countDown(); pool.shutdownNow(); assert(pool.awaitTermination(10,TimeUnit.SECONDS)) }
  }}
  test("Effectual GoodCommunication: natural session expiry during the owner mutation mutex wait rejects the apply") { database { c =>
    c.archive.ingest("a",Fixtures.snapshot()); val request=envelope(plan(c)); val before=ownerRows(c,"a")
    val pool=Executors.newSingleThreadExecutor(); var pending: Future[Result]=null
    try {
      c.db.transaction { held =>
        Sql.lock(held,"mutation:a")
        c.db.transaction(x => Sql.exec(x,"UPDATE ch_sessions SET expires=clock_timestamp()+interval '300 milliseconds' WHERE hash=?",c.owner.credentialHash))
        pending=pool.submit(new Callable[Result] { def call(): Result = c.auth.mutate(c.owner,request) })
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
        def blocked: Boolean = c.db.transaction(x => Sql.one(x,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock%')")(_.getBoolean(1)).get)
        while(!blocked && System.nanoTime()<deadline) Thread.sleep(5)
        assert(blocked); Thread.sleep(400)
      }
      assertEquals(intercept[ExecutionException](pending.get(5,TimeUnit.SECONDS)).getCause.asInstanceOf[DomainError].code,"unauthorized")
      assertEquals(ownerRows(c,"a"),before); assertEquals(receiptCount(c,request.requestId),0L)
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)) }
  }}
}
