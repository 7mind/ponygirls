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
