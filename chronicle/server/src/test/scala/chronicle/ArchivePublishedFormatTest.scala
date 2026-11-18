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
  test("Blackbox GoodCommunication: the published format is read from the stored generation, a leftover old-format label fails the projection, and live ACL controls its visibility") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
    val request=Fixtures.snapshot(); val receipt=archive.ingest("a",request)
    val index=new PostgresArchiveIndex(db,archive,config)
    val unindexed=browse(index,"a").rows.head
    assertEquals(unindexed.publishedView,None); assertEquals(unindexed.publishedFormat,None)
    assert(archive.publish(archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get,Nil))
    val published=browse(index,"a").rows.head.publishedView.get
    val group=UUID.randomUUID()
    db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','synthetic')",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group) }
    assertEquals(browse(index,"b").rows.head.publishedFormat,Some(PassageFormat.ContextAwareProblems))
    Fixtures.leftover(db,published.generationId.get)(assertEquals(intercept[DomainError](browse(index,"a")).code,"projection"))
    archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    val pending=browse(index,"a").rows.head
    assertEquals(pending.publishedView,Some(published)); assertEquals(pending.publishedFormat,Some(PassageFormat.ContextAwareProblems))
    db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group))
    assertEquals(browse(index,"b").total,0L)
    db.transaction { c => Sql.exec(c,"INSERT INTO ch_members VALUES(?,'b')",group); Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='b'") }
    assertEquals(browse(index,"b").total,0L)
    assertEquals(archive.messages("a",receipt.sessionId,0,100,Some(published)).view,published)
  }}
  test("Blackbox GoodCommunication: a published leftover in an old format is unavailable to its session, message, search, facet, tag and hint readers; revision-only reads stay") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
    val request=Fixtures.snapshot(); val receipt=archive.ingest("a",request)
    val claim=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publish(claim,List(IndexedChunk(Fragments.split(claim.snapshot.messages).head.copy(sessionId=receipt.sessionId,tags=List("generated")),List(1.0,0.0,0.0)))))
    val view=archive.session("a",receipt.sessionId).view
    val search=new PostgresSearch(db,archive,config); val hints=new PostgresExpressionHintIndex(db,archive,java.time.Clock.systemUTC())
    val noFilter=SearchFilter(None,None,None,None,Nil); val lexical=SearchQuery("synthetic",SearchMode.Lexical,noFilter,20,0)
    val reads: List[() => Any]=List(
      () => archive.readSession("a",receipt.sessionId,Some(view)),
      () => archive.messages("a",receipt.sessionId,0,100,Some(view)),
      () => search.search("a",lexical,None),
      () => search.facets("a",noFilter),
      () => search.tags("a",TagSearchQuery("",noFilter,None,100)),
      () => hints.hints("a",ExpressionHintQuery(ExpressionHintTarget.Archive(),"tag:",4,20)))
    reads.foreach(read => read())
    Fixtures.leftover(db,view.generationId.get) {
      reads.foreach(read => assertEquals(intercept[DomainError](read()).code,"unavailable"))
      val revision=ContentView(1,None)
      assertEquals(archive.messages("a",receipt.sessionId,0,100,Some(revision)).view,revision)
      assertEquals(archive.raw("a",receipt.sessionId,Some(1)).files,request.files)
    }
    assertEquals(search.search("a",lexical,None).hits.map(_.session.id),List(receipt.sessionId))
  }}
}
