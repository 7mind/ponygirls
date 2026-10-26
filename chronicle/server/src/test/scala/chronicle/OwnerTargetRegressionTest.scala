package chronicle

import chronicle.api.*

final class OwnerTargetRegressionTest extends munit.FunSuite {
  private def database(f: (Config,Database,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped")
    }
    val c=Fixtures.config(); val db=new Database(c,IndexProfileCatalog.legacyOnly(c)); db.initialize()
    db.transaction { x =>
      Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE")
      Sql.exec(x,"UPDATE ch_profile SET active=?,target=?,maintenance=false",c.profile,c.profile); Sql.exec(x,"UPDATE ch_owner_targets SET profile=?,epoch=0",c.profile)
    }
    f(c,db,new PostgresArchive(db,c))
  }
  test("regression: owner replacement must leave another owner's pending legacy claim executable") { database { (c,db,a) =>
    a.ingest("a",Fixtures.snapshot())
    a.ingest("b",Fixtures.snapshot())
    val first=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    val second=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    val other=List(first,second).find(claim => db.transaction(x => Sql.one(x,"SELECT owner FROM ch_sources WHERE id=?",claim.sessionId)(_.getString(1)).get)=="b").get
    val catalog=IndexProfileCatalog.passages(c,PassagePolicyIdentity("synthetic-owner-regression-v1"))
    val replacement=new Database(c,catalog); replacement.initialize()
    val service=new PostgresOwnerReindex(replacement); val plan=service.preview("a")
    service("a",java.util.UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)
    assert(a.publish(other,Nil),"an owner-only transition must preserve an unrelated legacy claim")
  }}
  test("regression: annotation-only profile changes must not disable compatible semantic reads") { database { (c,db,a) =>
    val out=a.ingest("a",Fixtures.snapshot())
    val claim=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    val chunk=Fragments.split(claim.snapshot.messages).head.copy(sessionId=out.sessionId)
    assert(a.publish(claim,List(IndexedChunk(chunk,List(1.0,0.0,0.0)))))
    val next=c.copy(annotation=c.annotation.copy(revision="owner-new-policy"))
    val q=SearchQuery("archive",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),20,0)
    assertEquals(new PostgresSearch(db,a,next).search("a",q,Some(List(1.0,0.0,0.0))).total,1)
  }}
}
