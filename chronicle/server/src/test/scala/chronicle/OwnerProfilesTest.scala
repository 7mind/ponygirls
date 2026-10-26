package chronicle

import chronicle.api.*
import java.time.Clock
import java.util.UUID

abstract class OwnerProfileContract extends munit.FunSuite {
  def withOwnerProfiles(f: (SessionArchive,OwnerReindex,Config,IndexProfileCatalog) => Unit): Unit
  private def applyPlan(service: OwnerReindex,owner: String): OwnerReindexOutcome = {
    val plan=service.preview(owner)
    service(owner,UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)
  }
  test("Behavioral Blackbox Atomic/GoodCommunication regression: owner transition preserves another owner's pending legacy execution") { withOwnerProfiles { (a,reindex,c,catalog) =>
    val own=a.ingest("a",Fixtures.snapshot()); val other=a.ingest("b",Fixtures.snapshot())
    val obsolete=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    val unrelated=a.claim(catalog.knownProfiles,ClaimScope.Owner("b"),300).get
    val result=applyPlan(reindex,"a")
    assertEquals(result.heads,1L); assertEquals(result.queued,1L); assertEquals(result.invalidatedClaims,1L)
    assert(!a.renew(obsolete,300)); assert(!a.progress(obsolete,1,1)); a.fail(obsolete,"late-failure"); assert(!a.publish(obsolete,Nil))
    assert(a.renew(unrelated,300)); assert(a.progress(unrelated,1,1)); assert(a.publish(unrelated,Nil))
    assertEquals(a.session("b",other.sessionId).indexedRevision,Some(1))
    val fresh=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals(fresh.owner,"a"); assertEquals(fresh.profile,catalog.preferred.profile); assert(fresh.targetEpoch>obsolete.targetEpoch)
    assert(!reindex.completed("a"),"claimed work is not publication evidence")
    assertEquals(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300),None)
    assert(!reindex.completed("a"),"empty claim cannot establish completion when a parallel worker holds it")
    assert(ProblemPublicationFixtures.publish(a,fresh,catalog)); assert(reindex.completed("a")); assertEquals(a.session("a",own.sessionId).indexedRevision,Some(1))
  }}
  test("Behavioral Blackbox Atomic/GoodCommunication: target-resolved ingestion, preview conflicts, and running-target retention") { withOwnerProfiles { (a,reindex,c,catalog) =>
    val original=Fixtures.snapshot(); val out=a.ingest("a",original)
    val stale=reindex.preview("a")
    a.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    assertEquals(intercept[DomainError](reindex("a",UUID.randomUUID(),stale.targetProfile,stale.selectionHash,true)).code,"conflict")
    applyPlan(reindex,"a")
    val claimed=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals(claimed.revision,2); assertEquals(claimed.profile,catalog.preferred.profile)
    val same=applyPlan(reindex,"a"); assertEquals(same.queued,0L); assertEquals(same.invalidatedClaims,0L)
    assert(a.renew(claimed,300)); assert(ProblemPublicationFixtures.publish(a,claimed,catalog))
    val noop=applyPlan(reindex,"a"); assertEquals(noop.alreadyCurrent,1L); assertEquals(noop.queued,0L)
    a.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=2))
    val appended=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals(appended.profile,catalog.preferred.profile); assertEquals(appended.revision,3)
    assertEquals(a.session("a",out.sessionId).indexedRevision,Some(2))
  }}
  test("Behavioral Blackbox Atomic/GoodCommunication: owner and job identity cannot be forged in worker claims") { withOwnerProfiles { (a,reindex,c,catalog) =>
    a.ingest("a",Fixtures.snapshot()); val other=a.ingest("b",Fixtures.snapshot())
    val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    List(claim.copy(owner="b"),claim.copy(sessionId=other.sessionId),claim.copy(revision=claim.revision+1),claim.copy(fence=claim.fence+1),claim.copy(targetEpoch=claim.targetEpoch+1)).foreach { forged =>
      assert(!a.progress(forged,1,1)); assert(!a.renew(forged,300)); assert(!a.publish(forged,Nil)); a.fail(forged,"forged-claim")
    }
    assert(a.renew(claim,300)); assert(a.publish(claim,Nil))
  }}
  test("Behavioral Blackbox Atomic/GoodCommunication: owner plan preserves publication until atomic replacement and binds job versions") { withOwnerProfiles { (a,reindex,c,catalog) =>
    val source=Fixtures.snapshot(); val out=a.ingest("a",source)
    assert(a.publish(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get,Nil))
    val published=a.session("a",out.sessionId).view
    val plan=reindex.preview("a")
    reindex("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)
    assertEquals(a.session("a",out.sessionId).view,published)
    val stale=reindex.preview("a")
    val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals(intercept[DomainError](reindex("a",UUID.randomUUID(),stale.targetProfile,stale.selectionHash,true)).code,"conflict")
    assertEquals(a.headSnapshot("a",out.sessionId).files,source.files)
    assert(ProblemPublicationFixtures.publish(a,claim,catalog)); assertNotEquals(a.session("a",out.sessionId).view,published)
  }}
  test("Behavioral Blackbox Atomic/GoodCommunication: failed destination work is retried by an explicit confirmed owner plan") { withOwnerProfiles { (a,reindex,c,catalog) =>
    a.ingest("a",Fixtures.snapshot()); applyPlan(reindex,"a")
    (1 to 5).foreach { _ => a.fail(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get,"synthetic-model-failure") }
    assertEquals(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300),None)
    val plan=reindex.preview("a")
    assertEquals(intercept[DomainError](reindex("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,false)).code,"invalid")
    assertEquals(reindex("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true).queued,1L)
    assert(ProblemPublicationFixtures.publish(a,a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get,catalog)); assert(reindex.completed("a"))
  }}
}
final class OwnerProfilesDummyTest extends OwnerProfileContract {
  def withOwnerProfiles(f: (SessionArchive,OwnerReindex,Config,IndexProfileCatalog) => Unit): Unit = {
    val c=Fixtures.config(); val catalog=IndexProfileCatalog.passages(c,PassagePolicyIdentity("synthetic:contiguous-v1"))
    val a=new DummyArchive(c,catalog); List("a","b","c").foreach(a.retainTarget(_,c.profile))
    f(a,a,c,catalog)
  }
}
final class OwnerProfilesPostgresTest extends OwnerProfileContract {
  def withOwnerProfiles(f: (SessionArchive,OwnerReindex,Config,IndexProfileCatalog) => Unit): Unit = {
    OwnerProfilePostgres.withDatabase { (c,db,a,catalog) => f(a,new PostgresOwnerReindex(db),c,catalog) }
  }
}
private[chronicle] object OwnerProfilePostgres extends munit.Assertions {
  def withDatabase(f: (Config,Database,PostgresArchive,IndexProfileCatalog) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped")
    }
    val c=Fixtures.config(); val legacy=new Database(c,IndexProfileCatalog.legacyOnly(c)); legacy.initialize()
    legacy.transaction { x =>
      Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_members CASCADE")
      Sql.exec(x,"UPDATE ch_profile SET active=?,target=?,maintenance=false",c.profile,c.profile)
      Sql.exec(x,"UPDATE ch_owner_targets SET profile=?,epoch=0",c.profile)
    }
    val catalog=IndexProfileCatalog.passages(c,PassagePolicyIdentity("synthetic:contiguous-v1"))
    val db=new Database(c,catalog); db.initialize()
    f(c,db,new PostgresArchive(db,c),catalog)
  }
}
final class OwnerProfilePostgresTest extends munit.FunSuite {
  private def applyPlan(db: Database,owner: String): OwnerReindexOutcome = {
    val service=new PostgresOwnerReindex(db); val plan=service.preview(owner)
    service(owner,UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)
  }
  private def fingerprint(db: Database,owner: String): List[String] = db.transaction { c =>
    Sql.rows(c,"SELECT to_jsonb(j)::text FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id WHERE s.owner=? ORDER BY j.id",owner)(_.getString(1))++
      Sql.rows(c,"SELECT to_jsonb(s)::text FROM ch_sources s WHERE owner=? ORDER BY id",owner)(_.getString(1))++
      Sql.rows(c,"SELECT to_jsonb(t)::text FROM ch_owner_targets t WHERE owner=?",owner)(_.getString(1))
  }
  test("Blackbox GoodCommunication regression: operator maintenance requeues Running destination work from an earlier target epoch") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    a.ingest("a",Fixtures.snapshot()); val old=a.claim(Set(c.profile),ClaimScope.Owner("a"),300).get
    val next=c.copy(embedding=c.embedding.copy(revision="synthetic-global-B")); val b=new PostgresArchive(db,next)
    b.beginMaintenance(); assert(b.publish(b.claim(Set(next.profile),ClaimScope.Owner("a"),300).get,Nil)); assert(b.finishMaintenance())
    val middle=a.session("a",old.sessionId).view
    a.beginMaintenance()
    assert(!a.renew(old,300)); assert(!a.publish(old,Nil))
    val fresh=a.claim(Set(c.profile),ClaimScope.Owner("a"),300)
    assert(fresh.isDefined,"a Running A job from an older target epoch must not prevent fresh A work")
    assert(fresh.get.fence>old.fence); assert(fresh.get.targetEpoch>old.targetEpoch)
    a.beginMaintenance(); assert(a.renew(fresh.get,300),"same-target operator resume must retain valid in-flight work")
    assert(a.publish(fresh.get,Nil)); assert(a.finishMaintenance())
    assertEquals(a.readSession("a",old.sessionId,Some(middle)).session.view,middle)
  }}
  test("Blackbox GoodCommunication regression: global maintenance excludes owner transitions until its publication domain completes") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    a.ingest("a",Fixtures.snapshot())
    val service=new PostgresOwnerReindex(db); val plan=service.preview("a")
    a.beginMaintenance()
    assertEquals(intercept[DomainError](service.preview("a")).code,"conflict")
    assertEquals(intercept[DomainError](service("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)).code,"conflict")
    assert(a.publish(a.claim(Set(c.profile),ClaimScope.Owner("a"),300).get,Nil)); assert(a.finishMaintenance())
    assertEquals(service.preview("a").targetProfile,catalog.preferred.profile)
  }}
  test("Effectual GoodCommunication: owner scope includes exhausted-lease cleanup and leaves other owner rows byte-identical") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    a.ingest("a",Fixtures.snapshot()); a.ingest("b",Fixtures.snapshot())
    (1 to 5).foreach(_ => assert(a.claim(catalog.knownProfiles,ClaimScope.Owner("b"),0).isDefined))
    val before=fingerprint(db,"b")
    applyPlan(db,"a")
    a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300)
    assertEquals(fingerprint(db,"b"),before)
    assertEquals(a.claim(catalog.knownProfiles,ClaimScope.Owner("b"),300),None)
    assertNotEquals(fingerprint(db,"b"),before)
    assertEquals(a.statuses("b",0,100).jobs.head.error,Some("lease-exhausted"))
  }}
  test("Effectual GoodCommunication regression: A/B/A target epochs reject stale progress renew publish and fail even when profile returns") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    a.ingest("a",Fixtures.snapshot()); val old=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    applyPlan(db,"a")
    val b=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get; assert(ProblemPublicationFixtures.publish(a,b,catalog))
    a.beginMaintenance(); assert(!a.finishMaintenance())
    val back=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals(back.profile,old.profile); assert(back.targetEpoch>old.targetEpoch)
    assert(!a.progress(old,1,1)); assert(!a.renew(old,300)); assert(!a.publish(old,Nil))
    val before=fingerprint(db,"a"); a.fail(old,"stale-aba"); assertEquals(fingerprint(db,"a"),before)
    assert(a.publish(back,Nil)); assert(a.finishMaintenance())
  }}
  test("Effectual GoodCommunication: restart retains owner targets and seeds only genuinely new owners to preferred") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    a.ingest("a",Fixtures.snapshot()); applyPlan(db,"a")
    val before=fingerprint(db,"a")++fingerprint(db,"b")
    db.initialize(); assertEquals(fingerprint(db,"a")++fingerprint(db,"b"),before)
    val owner="new-owner-"+UUID.randomUUID().toString
    val next=c.copy(users=c.users:+c.users.head.copy(id=owner,login=owner))
    new Database(next,catalog).initialize()
    assertEquals(db.transaction(x => Sql.one(x,"SELECT profile FROM ch_owner_targets WHERE owner=?",owner)(_.getString(1)).get),catalog.preferred.profile)
    new Database(c,catalog).initialize()
  }}
  test("Blackbox GoodCommunication: mixed verified legacy/new publication profiles remain semantically readable through every search leg") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    val first=a.ingest("a",Fixtures.snapshot()); val other=a.ingest("b",Fixtures.snapshot())
    def publish(claim: Claim): Unit = catalog.resolve(claim.profile).policy match {
      case IndexPolicy.LegacyV4 => assert(a.publish(claim,List(IndexedChunk(Fragments.split(claim.snapshot.messages).head.copy(sessionId=claim.sessionId),List(1.0,0.0,0.0)))))
      case IndexPolicy.ContiguousPassagesV1 => assert(a.publishProblems(claim,ProblemPublicationFixtures.oneProblem(claim)))
    }
    publish(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get)
    publish(a.claim(catalog.knownProfiles,ClaimScope.Owner("b"),300).get)
    db.transaction { x =>
      val group=UUID.randomUUID(); Sql.exec(x,"INSERT INTO ch_groups VALUES(?,'a','synthetic')",group)
      Sql.exec(x,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group)
    }
    applyPlan(db,"a")
    val search=new PostgresSearch(db,a,c)
    val query=SearchQuery("archive",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),20,0)
    assertEquals(search.search("a",query,Some(List(1.0,0.0,0.0))).total,2,"old publication remains available during owner-only reprocessing")
    publish(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get)
    List(SearchMode.Semantic,SearchMode.Hybrid).foreach { mode =>
      assertEquals(search.search("a",query.copy(mode=mode),Some(List(1.0,0.0,0.0))).total,2)
      assertEquals(search.searchLegacy("a",query.copy(mode=mode),Some(List(1.0,0.0,0.0))).total,2)
      val q=ArchiveQuery(s"mode:${mode.toString.toLowerCase(java.util.Locale.ROOT)} archive",ArchiveSort.Title,SortDirection.Asc,None,20)
      val parsed=ArchiveExpression.parse(q.expression)
      assertEquals(new PostgresArchiveIndex(db,a,c).browse("a",q,parsed,List(ArchiveVector("archive",List(1.0,0.0,0.0)))).total,2L)
    }
    val activity=new PostgresActivity(db,Clock.systemUTC()).jobs("a",ActivityJobsQuery(None,ActivityJobScope.Current,"",ActivityJobSort.JobId,SortDirection.Asc,None,20))
    assertEquals(activity.jobs.map(_.profile),List(catalog.preferred.profile))
    val archiveQuery=ArchiveQuery("mode:lexical",ArchiveSort.Title,SortDirection.Asc,None,20)
    assertEquals(new PostgresArchiveIndex(db,a,c).browse("a",archiveQuery,ArchiveExpression.parse(archiveQuery.expression),Nil).rows.find(_.head.id==first.sessionId).get.headJob.get.state,JobState.Complete)
  }}
  test("Blackbox GoodCommunication: unknown same-dimension and incompatible published profiles are explicit availability failures") { OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
    val out=a.ingest("a",Fixtures.snapshot()); val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(a.publish(claim,List(IndexedChunk(Fragments.split(claim.snapshot.messages).head.copy(sessionId=out.sessionId),List(1.0,0.0,0.0)))))
    val search=new PostgresSearch(db,a,c); val q=SearchQuery("archive",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),20,0)
    def rejected(): Unit = {
      assertEquals(intercept[DomainError](search.search("a",q,Some(List(1.0,0.0,0.0)))).code,"unavailable")
      assertEquals(intercept[DomainError](search.searchLegacy("a",q,Some(List(1.0,0.0,0.0)))).code,"unavailable")
    }
    db.transaction(x => Sql.exec(x,"UPDATE ch_generations SET profile='opaque-same-dimensions' WHERE session_id=?",out.sessionId)); rejected()
    val incompatible=c.copy(embedding=c.embedding.copy(revision="different-space-same-dimensions"))
    db.transaction { x => IndexProfileCatalog.legacyOnly(incompatible).register(x); Sql.exec(x,"UPDATE ch_generations SET profile=? WHERE session_id=?",incompatible.profile,out.sessionId) }
    rejected()
    assertEquals(search.search("a",q.copy(mode=SearchMode.Lexical),None).total,1)
    db.transaction(x => Sql.exec(x,"UPDATE ch_owner_targets SET profile='unresolved-retained' WHERE owner='a'"))
    assertEquals(intercept[DomainError](new PostgresOwnerReindex(db).preview("a")).code,"unavailable")
    assertEquals(intercept[DomainError](a.ingest("a",Fixtures.snapshot())).code,"unavailable")
  }}
}
