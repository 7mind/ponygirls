package chronicle

import chronicle.api.*
import java.util.UUID
import java.util.concurrent.{Callable,Executors,Future,TimeUnit}

final class OwnerDisabledTest extends munit.FunSuite {
  private def jobs(db: Database,owner: String): List[String] = db.transaction(c => Sql.rows(c,"SELECT to_jsonb(j)::text FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id WHERE s.owner=? ORDER BY j.id",owner)(_.getString(1)))
  List("progress","renew","publish","fail").foreach { operation =>
    test(s"Blackbox GoodCommunication regression: disabled owner makes captured $operation claim ineligible without an adapter fault") {
      OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
        a.ingest("a",Fixtures.snapshot()); a.ingest("b",Fixtures.snapshot())
        val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
        db.transaction(x => Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id='a'"))
        val before=jobs(db,"a"); val other=jobs(db,"b")
        val result=operation match {
          case "progress" => a.progress(claim,1,1)
          case "renew" => a.renew(claim,300)
          case "publish" => a.publish(claim,Nil)
          case "fail" => a.fail(claim,"late-disabled-failure"); false
        }
        assert(!result); assertEquals(jobs(db,"a"),before); assertEquals(jobs(db,"b"),other)
        assertEquals(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300),None)
        val active=a.claim(catalog.knownProfiles,ClaimScope.AllOwners,300).get
        assertEquals(active.owner,"b"); assert(a.publish(active,Nil))
        assertEquals(intercept[DomainError](new PostgresOwnerReindex(db).preview("a")).code,"unauthorized")
      }
    }
  }
  test("Blackbox GoodCommunication: already-disabled queued work is skipped without consuming an attempt") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    a.ingest("a",Fixtures.snapshot()); db.transaction(x => Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id='a'"))
    val before=jobs(db,"a")
    assertEquals(a.claim(catalog.knownProfiles,ClaimScope.AllOwners,300),None)
    assertEquals(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300),None)
    assertEquals(jobs(db,"a"),before)
  }}
  test("Effectual GoodCommunication regression: disable committing during owner-lock wait skips that owner and still claims another") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    a.ingest("a",Fixtures.snapshot()); a.ingest("b",Fixtures.snapshot())
    val before=jobs(db,"a"); val other=jobs(db,"b")
    val pool=Executors.newSingleThreadExecutor(); var pending: Future[Option[Claim]]=null
    try {
      db.transaction { held =>
        Sql.one(held,"SELECT id FROM ch_users WHERE id='a' FOR UPDATE")(_.getString(1))
        pending=pool.submit(new Callable[Option[Claim]] { def call(): Option[Claim] = a.claim(catalog.knownProfiles,ClaimScope.AllOwners,300) })
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
        def waiting: Boolean = db.transaction(x => Sql.one(x,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT 1 FROM ch_users WHERE id=%')")(_.getBoolean(1)).get)
        while(!waiting && System.nanoTime()<deadline) Thread.sleep(5)
        assert(waiting,"claim must be observed waiting on the enabled owner row")
        assertEquals(jobs(db,"b"),other)
        Sql.exec(held,"UPDATE ch_users SET enabled=false WHERE id='a'")
      }
      val claim=pending.get(5,TimeUnit.SECONDS).get
      assertEquals(claim.owner,"b"); assertEquals(jobs(db,"a"),before); assert(a.publish(claim,Nil))
    } finally { pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)) }
  }}
  test("Blackbox GoodCommunication: accepted empty owner IDs retain indexing and owner-transition semantics") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    val config=c.copy(users=c.users:+c.users.head.copy(id="",login="synthetic-empty-owner"))
    val configured=new Database(config,catalog); configured.initialize()
    try {
      val archive=new PostgresArchive(configured,config); val out=archive.ingest("",Fixtures.snapshot())
      val claim=archive.claim(catalog.knownProfiles,ClaimScope.Owner(""),300).get
      assertEquals(claim.owner,""); assert(archive.progress(claim,1,1)); assert(archive.renew(claim,300)); assert(archive.publish(claim,Nil))
      val service=new PostgresOwnerReindex(configured); val plan=service.preview("")
      val result=service("",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)
      assertEquals(result.heads,1L); assertEquals(result.alreadyCurrent,plan.alreadyCurrent); assertEquals(result.queued,plan.replacements)
      val replacement=archive.claim(catalog.knownProfiles,ClaimScope.Owner(""),300)
      assertEquals(replacement.nonEmpty,plan.replacements==1L); replacement.foreach(claim => assert(archive.publish(claim,Nil)))
      assert(service.completed(""))
      assertEquals(archive.session("",out.sessionId).ownerId,"")
    } finally new Database(c,catalog).initialize()
  }}
}
