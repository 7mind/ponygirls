package chronicle

import chronicle.api.*
import java.util.UUID

class ArchivePublishedFormatTest extends munit.FunSuite {
  private def browse(index: ArchiveIndex,reader: String): ArchiveResult =
    index.browse(reader,ArchiveQuery("",ArchiveSort.Title,SortDirection.Asc,None,10,false),ArchiveExpression.parse(""),Nil)
  private def transition(service: OwnerReindex): Unit = {
    val plan=service.preview("a")
    service("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)
    ()
  }
  test("Blackbox GoodCommunication: published format survives queued running and failed same-revision replacement independently of job state") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
    val original=Fixtures.snapshot(); val receipt=archive.ingest("a",original)
    val initial=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publish(initial,Nil))
    val index=new PostgresArchiveIndex(db,archive,config)
    def row: ArchiveRow = browse(index,"a").rows.head
    val published=row.publishedView.get
    assertEquals(published.revision,row.head.revision)
    assertEquals(row.publishedFormat,Some(PassageFormat.ContextAwareProblems)); assertEquals(row.headJob.map(_.state),Some(JobState.Complete))
    val service=new PostgresOwnerReindex(db); transition(service)
    assertEquals(row.publishedView,Some(published)); assertEquals(row.publishedFormat,Some(PassageFormat.ContextAwareProblems))
    assertEquals(row.headJob.map(_.state),Some(JobState.Queued))
    (1 to 5).foreach { _ =>
      val claim=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
      assertEquals(claim.profile,catalog.preferred.profile)
      assertEquals(row.headJob.map(_.state),Some(JobState.Running)); assertEquals(row.publishedFormat,Some(PassageFormat.ContextAwareProblems))
      archive.fail(claim,"synthetic-model-failure")
    }
    assertEquals(row.headJob.map(_.state),Some(JobState.Failed)); assertEquals(row.publishedView,Some(published))
    assertEquals(row.publishedFormat,Some(PassageFormat.ContextAwareProblems))
    transition(service)
    val replacement=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publishProblems(replacement,ProblemPublicationFixtures.oneProblem(replacement)))
    assertEquals(row.headJob.map(_.state),Some(JobState.Complete)); assertEquals(row.publishedFormat,Some(PassageFormat.ContextAwareProblems))
    assertNotEquals(row.publishedView,Some(published))
    assertEquals(intercept[DomainError](archive.passages("a",receipt.sessionId,0,100,Some(published))).code,"indexed-view-retired")
    assertEquals(archive.headSnapshot("a",receipt.sessionId),original)
  }}
  test("Blackbox GoodCommunication: missing stored provenance stays unknown even for a known current profile and live ACL controls its visibility") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
    val request=Fixtures.snapshot(); val receipt=archive.ingest("a",request)
    val index=new PostgresArchiveIndex(db,archive,config)
    val unindexed=browse(index,"a").rows.head
    assertEquals(unindexed.publishedView,None); assertEquals(unindexed.publishedFormat,None)
    assert(archive.publish(archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get,Nil))
    val published=browse(index,"a").rows.head.publishedView.get
    val group=UUID.randomUUID()
    db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','synthetic')",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group) }
    assertEquals(browse(index,"b").rows.head.publishedFormat,Some(PassageFormat.ContextAwareProblems))
    db.transaction(c => Sql.exec(c,"UPDATE ch_generations SET passage_format=NULL WHERE id=?",published.generationId.get))
    val unknown=browse(index,"a").rows.head
    assertEquals(unknown.publishedView,Some(published)); assertEquals(unknown.publishedFormat,None)
    assertEquals(unknown.headJob.map(_.state),Some(JobState.Complete))
    archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    assertEquals(browse(index,"a").rows.head.publishedView,Some(published)); assertEquals(browse(index,"a").rows.head.publishedFormat,None)
    db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group))
    assertEquals(browse(index,"b").total,0L)
    db.transaction { c => Sql.exec(c,"INSERT INTO ch_members VALUES(?,'b')",group); Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='b'") }
    assertEquals(browse(index,"b").total,0L)
    assertEquals(archive.messages("a",receipt.sessionId,0,100,Some(published)).view,published)
  }}
}
