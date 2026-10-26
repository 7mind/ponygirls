package chronicle

import chronicle.api.*
import java.util.UUID
import java.util.concurrent.{Callable,ExecutionException,Executors,Future,TimeUnit}

final class OwnerTargetConcurrencyTest extends munit.FunSuite {
  private def awaitBlocked(db: Database,prefix: String): Unit = {
    val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
    def blocked: Boolean = db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ?)",prefix+"%")(_.getBoolean(1)).get)
    while(!blocked && System.nanoTime()<deadline) Thread.sleep(5)
    assert(blocked,s"expected real PostgreSQL lock wait for $prefix")
  }
  private def rows(db: Database,owner: String): List[String] = db.transaction { c =>
    Sql.rows(c,"SELECT to_jsonb(j)::text FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id WHERE s.owner=? ORDER BY j.id",owner)(_.getString(1))++
      Sql.rows(c,"SELECT to_jsonb(t)::text FROM ch_owner_targets t WHERE owner=?",owner)(_.getString(1))
  }
  test("Effectual GoodCommunication: ingest-first serializes owner apply and stale preview cannot omit an appended head") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    val request=Fixtures.snapshot(); a.ingest("a",request); a.ingest("b",Fixtures.snapshot())
    val old=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    val plan=new PostgresOwnerReindex(db).preview("a"); val untouched=rows(db,"b")
    val pool=Executors.newFixedThreadPool(2)
    var ingesting: Future[IngestReceipt]=null; var applying: Future[OwnerReindexOutcome]=null
    try {
      db.transaction { held =>
        Sql.one(held,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",old.jobId)(_.getString(1))
        ingesting=pool.submit(new Callable[IngestReceipt] { def call(): IngestReceipt = a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1)) })
        awaitBlocked(db,"UPDATE ch_jobs SET state='Failed'")
        applying=pool.submit(new Callable[OwnerReindexOutcome] { def call(): OwnerReindexOutcome = new PostgresOwnerReindex(db).apply("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true) })
        awaitBlocked(db,"SELECT profile,epoch FROM ch_owner_targets")
      }
      assertEquals(ingesting.get(5,TimeUnit.SECONDS).revision,2)
      assertEquals(intercept[ExecutionException](applying.get(5,TimeUnit.SECONDS)).getCause.asInstanceOf[DomainError].code,"conflict")
      assertEquals(rows(db,"b"),untouched)
      val service=new PostgresOwnerReindex(db); val fresh=service.preview("a")
      assertEquals(service("a",UUID.randomUUID(),fresh.targetProfile,fresh.selectionHash,true).heads,1L)
      assertEquals(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get.revision,2)
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)) }
  }}
  test("Effectual GoodCommunication: transition-first ingestion resolves the committed owner target without deploy-profile coupling") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    val request=Fixtures.snapshot(); a.ingest("a",request); a.ingest("b",Fixtures.snapshot())
    val old=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    val plan=new PostgresOwnerReindex(db).preview("a"); val untouched=rows(db,"b")
    val pool=Executors.newFixedThreadPool(2)
    var ingesting: Future[IngestReceipt]=null; var applying: Future[OwnerReindexOutcome]=null
    try {
      db.transaction { held =>
        Sql.one(held,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",old.jobId)(_.getString(1))
        applying=pool.submit(new Callable[OwnerReindexOutcome] { def call(): OwnerReindexOutcome = new PostgresOwnerReindex(db).apply("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true) })
        awaitBlocked(db,"SELECT j.id FROM ch_sources s JOIN ch_jobs j")
        ingesting=pool.submit(new Callable[IngestReceipt] { def call(): IngestReceipt = a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1)) })
        awaitBlocked(db,"SELECT profile,epoch FROM ch_owner_targets")
      }
      assertEquals(applying.get(5,TimeUnit.SECONDS).queued,1L)
      val receipt=ingesting.get(5,TimeUnit.SECONDS); assertEquals(receipt.revision,2)
      assertEquals(db.transaction(x => Sql.one(x,"SELECT profile FROM ch_jobs WHERE id=?",receipt.jobId)(_.getString(1)).get),catalog.preferred.profile)
      assertEquals(rows(db,"b"),untouched)
      assert(!a.renew(old,300)); assert(!a.publish(old,Nil))
      val fresh=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
      assertEquals(fresh.revision,2); assertEquals(fresh.profile,catalog.preferred.profile); assert(a.publishProblems(fresh,ProblemPublicationFixtures.oneProblem(fresh)))
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)) }
  }}
  test("Effectual GoodCommunication: claim lease is created after a target lock wait and remains usable") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    a.ingest("a",Fixtures.snapshot())
    val pool=Executors.newSingleThreadExecutor(); var pending: Future[Option[Claim]]=null
    try {
      db.transaction { held =>
        Sql.one(held,"SELECT profile FROM ch_owner_targets WHERE owner='a' FOR UPDATE")(_.getString(1))
        pending=pool.submit(new Callable[Option[Claim]] { def call(): Option[Claim] = a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),1) })
        awaitBlocked(db,"SELECT profile,epoch FROM ch_owner_targets")
        Thread.sleep(1200)
      }
      val claim=pending.get(5,TimeUnit.SECONDS).get
      assertEquals(db.transaction(x => Sql.one(x,"SELECT lease_until>clock_timestamp() FROM ch_jobs WHERE id=?",claim.jobId)(_.getBoolean(1)).get),true)
      assert(a.renew(claim,300)); assert(a.publish(claim,Nil))
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)) }
  }}
  test("Effectual GoodCommunication: expiry during generation persistence rolls back all publication side effects") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    val out=a.ingest("a",Fixtures.snapshot()); val first=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    def chunks(claim: Claim): List[IndexedChunk] = List(IndexedChunk(Fragments.split(claim.snapshot.messages).head.copy(sessionId=claim.sessionId),List(1.0,0.0,0.0)))
    assert(a.publish(first,chunks(first))); val previous=a.session("a",out.sessionId).view
    val service=new PostgresOwnerReindex(db); val plan=service.preview("a")
    service("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)
    db.transaction { x =>
      Sql.exec(x,"CREATE FUNCTION ch_test_delayed_chunk() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END$$")
      Sql.exec(x,"CREATE TRIGGER ch_test_delayed_chunk BEFORE INSERT ON ch_chunks FOR EACH ROW EXECUTE FUNCTION ch_test_delayed_chunk()")
    }
    try {
      val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),1).get
      assert(!a.publishProblems(claim,ProblemPublicationFixtures.oneProblem(claim)))
      assertEquals(a.session("a",out.sessionId).view,previous)
      db.transaction { x =>
        assertEquals(Sql.one(x,"SELECT count(*) FROM ch_generations WHERE session_id=?",out.sessionId)(_.getLong(1)).get,1L)
        assertEquals(Sql.one(x,"SELECT count(*) FROM ch_chunks")(_.getLong(1)).get,1L)
        assertEquals(Sql.one(x,"SELECT count(*) FROM ch_search_chunks")(_.getLong(1)).get,1L)
        assertEquals(Sql.one(x,"SELECT state FROM ch_jobs WHERE id=?",claim.jobId)(_.getString(1)).get,"Running")
      }
    } finally db.transaction { x => Sql.exec(x,"DROP TRIGGER ch_test_delayed_chunk ON ch_chunks"); Sql.exec(x,"DROP FUNCTION ch_test_delayed_chunk()") }
  }}
}
