package chronicle

import chronicle.api.*
import java.util.UUID
import java.sql.Connection

object CurrentIndexDatabase extends munit.Assertions {
  def withDatabase(run: (Config,Database,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_reindex_members,ch_reindex_requests,ch_sources,ch_mutations,ch_sessions,ch_groups CASCADE")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
    }
    run(config,db,new PostgresArchive(db,config))
  }
  def publication(claim: Claim,contextOnly: Boolean): ProblemsPublication = {
    val source=ProblemPassages.Source(claim.snapshot.messages); var state=ProblemPassages.State.start(claim.sessionId,claim.runId); var builder=ProblemsPublication.empty
    var next=source.next(state.nextSource)
    while(next.nonEmpty) {
      val window=next.get
      val part=if(contextOnly) ProblemPassages.Part.context(ProblemPassages.Point(0,0),window.terminal)
        else ProblemPassages.Part(ProblemPassages.Point(0,0),window.terminal,state.carry.nonEmpty,"synthetic goal",Nil)
      val delta=ProblemPassages.accept(state,window,ProblemPassages.Decision(Vector(part)))
      builder=builder.append(delta,delta.pieces.map(piece => IndexedChunk(piece.chunk,List(1e-10,-0.0,1.25))).toList)
      state=delta.state; next=source.next(state.nextSource)
    }
    builder.append(ProblemPassages.finish(state,source),Nil).result
  }
  def status(db: Database,id: UUID): ReindexStatusResult = db.transaction { c => c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ); ReindexCohort.status(c,"a",id) }
}

class ReindexCohortTest extends munit.FunSuite {
  import CurrentIndexDatabase.*
  // Regression-origin: observing an already committed ingest receipt must not need a current model executor.
  test("GoodCommunication: receipt replay survives an unexecutable target while new ingestion remains fail-closed") { withDatabase { (_,db,archive) =>
    val original=Fixtures.snapshot(); val receipt=archive.ingest("a",original)
    db.transaction(c => Sql.exec(c,"UPDATE ch_owner_targets SET profile='unconfigured-policy' WHERE owner='a'"))
    assertEquals(archive.ingest("a",original),receipt)
    assertEquals(intercept[DomainError](archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))).code,"unavailable")
    assertEquals(db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_revisions")(_.getLong(1)).get),1L)
  }}
  test("GoodCommunication: bulk failed retry refuses a registered but unexecutable target") { withDatabase { (config,db,archive) =>
    archive.ingest("a",Fixtures.snapshot())
    val retired=IndexProfileCatalog.current(config.copy(annotation=config.annotation.copy(revision="unconfigured-revision")))
    db.transaction { c =>
      retired.register(c)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner='a'",retired.preferred.profile)
      Sql.exec(c,"UPDATE ch_jobs SET profile=?,state='Failed'",retired.preferred.profile)
    }
    val auth=new Auth(db,config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    assertEquals(intercept[DomainError](auth.previewRetryFailed(owner)).code,"unavailable")
    assertEquals(db.transaction(c => Sql.one(c,"SELECT state FROM ch_jobs")(_.getString(1)).get),"Failed")
  }}
  test("GoodCommunication: fixed-current rebuild preserves prior publication until atomic replacement then retires all old derived pins") { withDatabase { (config,db,archive) =>
    val original=Fixtures.snapshot(); val receipt=archive.ingest("a",original)
    val first=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publishProblems(first,publication(first,false))); val oldest=archive.session("a",receipt.sessionId).view
    archive.retry("a",receipt.jobId)
    val second=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    val secondPublication=publication(second,false)
    assert(archive.publishProblems(second,secondPublication)); val previous=archive.session("a",receipt.sessionId).view
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_generations SET profile='obsolete-library-policy',passage_format='LegacyAnnotations' WHERE id=?",oldest.generationId.get)
      Sql.exec(c,"UPDATE ch_generations SET profile='obsolete-library-policy',passage_format='ContiguousProblems' WHERE id=?",previous.generationId.get)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile='unconfigured-policy' WHERE owner='a'")
    }
    val service=new PostgresOwnerReindex(db); val plan=service.preview("a"); val id=UUID.randomUUID()
    assertEquals(plan.alreadyCurrent,0L); assertEquals(plan.replacements,1L); assertEquals(plan.targetProfile,config.profile)
    val result=service("a",id,plan.targetProfile,plan.selectionHash,true)
    assertEquals(result.queued,1L); assertEquals(result.alreadyCurrent,0L)
    assertEquals(service("a",id,plan.targetProfile,plan.selectionHash,true),result)
    assertEquals(archive.session("a",receipt.sessionId).view,previous)
    assert(archive.pageChunks("a",receipt.sessionId,0,100,Some(previous)).chunks.nonEmpty)
    assertEquals(status(db,id),ReindexStatusResult(id,config.profile,1,0,0,0,1))
    val replacement=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(replacement.runId!=second.runId)
    assert(archive.publishProblems(replacement,publication(replacement,true)))
    assertEquals(status(db,id),ReindexStatusResult(id,config.profile,1,1,0,0,0))
    val current=archive.session("a",receipt.sessionId).view
    assert(current!=previous); assertEquals(archive.passages("a",receipt.sessionId,0,100,Some(current)).format,PassageFormat.ContextAwareProblems)
    assertEquals(archive.pageChunks("a",receipt.sessionId,0,100,Some(current)).total,0)
    assertEquals(archive.passages("a",receipt.sessionId,0,100,Some(current)).total,0L)
    val readOld: List[() => Any]=List(
      () => archive.readSession("a",receipt.sessionId,Some(previous)),
      () => archive.messages("a",receipt.sessionId,0,100,Some(previous)),
      () => archive.pageChunks("a",receipt.sessionId,0,100,Some(previous)),
      () => archive.locateMessage("a",receipt.sessionId,previous,"u"),
      () => archive.searchSessionMessages("a",receipt.sessionId,previous,"synthetic",None,100),
      () => archive.passages("a",receipt.sessionId,0,100,Some(previous)),
      () => archive.passageSpans("a",receipt.sessionId,secondPublication.passages.head.id,0,100,Some(previous)),
      () => archive.pageChunks("a",receipt.sessionId,0,100,Some(oldest)))
    readOld.foreach(read => assertEquals(intercept[DomainError](read()).code,"indexed-view-retired"))
    assertEquals(intercept[DomainError](archive.messages("b",receipt.sessionId,0,1,Some(previous))).code,"not-found")
    val sourceOnly=ContentView(1,None)
    assertEquals(archive.messages("a",receipt.sessionId,0,100,Some(sourceOnly)).messages,SnapshotProjection(original).messages)
    assertEquals(archive.searchSessionMessages("a",receipt.sessionId,sourceOnly,"synthetic",None,100).hits,List(MessageSearchHit("u",0)))
    assertEquals(archive.raw("a",receipt.sessionId,Some(1)).files,original.files)
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_generations WHERE session_id=? AND retired",receipt.sessionId)(_.getLong(1)).get,2L)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_chunks")(_.getLong(1)).get,0L)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_problem_passages")(_.getLong(1)).get,0L)
      assert(Sql.one(c,"SELECT count(*) FROM ch_context_spans WHERE generation=?",current.generationId.get)(_.getLong(1)).get>0)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_jobs WHERE id=?",receipt.jobId)(_.getLong(1)).get,1L)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revisions")(_.getLong(1)).get,1L)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_ingest_receipts WHERE owner='a' AND request_id=?",original.requestId)(_.getLong(1)).get,1L)
    }
  }}
  test("GoodCommunication: cohort totals are finite, completed outcomes persist, later HEADs are superseded not chased, purge cannot shrink totals") { withDatabase { (config,db,archive) =>
    val original=Fixtures.snapshot(); val receipt=archive.ingest("a",original)
    val service=new PostgresOwnerReindex(db); val plan=service.preview("a"); val id=UUID.randomUUID()
    service("a",id,plan.targetProfile,plan.selectionHash,true)
    val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publishProblems(claim,publication(claim,true)))
    assertEquals(status(db,id).complete,1L)
    val again=service.preview("a"); val next=UUID.randomUUID()
    assertEquals(again.alreadyCurrent,0L); assertEquals(again.replacements,1L)
    service("a",next,again.targetProfile,again.selectionHash,true)
    archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    archive.ingest("a",Fixtures.snapshot())
    assertEquals(status(db,next),ReindexStatusResult(next,config.profile,1,0,1,0,0))
    assertEquals(status(db,id),ReindexStatusResult(id,config.profile,1,1,0,0,0))
    val auth=new Auth(db,config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(receipt.sessionId)))
    assertEquals(status(db,next).total,1L); assertEquals(status(db,next).superseded,1L)
    assertEquals(status(db,id).complete,1L)
  }}
  test("GoodCommunication regression: obsolete global transition flag cannot disable compatible current-policy semantic publications") { withDatabase { (config,db,archive) =>
    archive.ingest("a",Fixtures.snapshot()); val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publishProblems(claim,publication(claim,false)))
    db.transaction(c => Sql.exec(c,"UPDATE ch_profile SET maintenance=true"))
    val query=SearchQuery("archive",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),20,0)
    assertEquals(new PostgresSearch(db,archive,config).search("a",query,Some(List(1.0,0.0,0.0))).total,1)
  }}
  // Regression-origin: nonempty status rows must project the new optional stage, not read an absent JDBC column.
  test("GoodCommunication regression: nonempty IngestStatus reports an unknown historical stage as None") { withDatabase { (_,_,archive) =>
    val receipt=archive.ingest("a",Fixtures.snapshot())
    val result=archive.statuses("a",0,10)
    assertEquals(result.jobs.map(_.id),List(receipt.jobId)); assertEquals(result.jobs.head.failureStage,None)
  }}
  test("GoodCommunication regression: supersession replaces the error and clears its old annotation/embedding stage") { withDatabase { (_,db,archive) =>
    val original=Fixtures.snapshot(); val receipt=archive.ingest("a",original)
    val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    archive.fail(claim,"model-timeout",IndexingStage.Embedding)
    archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    val stored=db.transaction(c => Sql.one(c,"SELECT error,failure_stage FROM ch_jobs WHERE id=?",receipt.jobId)(row => (row.getString(1),Option(row.getString(2))))).get
    assertEquals(stored,("superseded-revision",None))
  }}
  test("GoodCommunication regression: fifth lease exhaustion replaces the error with an unknown failure stage") { withDatabase { (_,db,archive) =>
    val receipt=archive.ingest("a",Fixtures.snapshot())
    (1 to 4).foreach { _ => val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get; archive.fail(claim,"model-timeout",IndexingStage.Embedding) }
    val fifth=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",fifth.jobId))
    assertEquals(archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300),None)
    val stored=db.transaction(c => Sql.one(c,"SELECT error,failure_stage FROM ch_jobs WHERE id=?",receipt.jobId)(row => (row.getString(1),Option(row.getString(2))))).get
    assertEquals(stored,("lease-exhausted",None))
  }}
  test("GoodCommunication regression: superseded cohort revision may retire old payload on latest accepted replacement without completing its old member") { withDatabase { (config,db,archive) =>
    val original=Fixtures.snapshot(); val receipt=archive.ingest("a",original)
    val first=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publishProblems(first,publication(first,false))); val old=archive.session("a",receipt.sessionId).view
    db.transaction(c => Sql.exec(c,"UPDATE ch_generations SET passage_format='LegacyAnnotations' WHERE id=?",old.generationId.get))
    val service=new PostgresOwnerReindex(db); val plan=service.preview("a"); val id=UUID.randomUUID()
    service("a",id,plan.targetProfile,plan.selectionHash,true)
    archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    val latest=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get; assertEquals(latest.revision,2)
    assert(archive.publishProblems(latest,publication(latest,false)))
    val replacement=archive.session("a",receipt.sessionId).view
    assertEquals(status(db,id),ReindexStatusResult(id,config.profile,1,0,1,0,0))
    val retirement=scala.util.Try(archive.pageChunks("a",receipt.sessionId,0,100,Some(old))).failed.toOption.collect { case error: DomainError => error.code }
    assertEquals(archive.raw("a",receipt.sessionId,Some(1)).files,original.files)
    archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=2))
    val ordinary=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publishProblems(ordinary,publication(ordinary,false)))
    val preserved=scala.util.Try(archive.pageChunks("a",receipt.sessionId,0,100,Some(replacement))).toOption.exists(_.chunks.nonEmpty)
    assertEquals((retirement,preserved),(Some("indexed-view-retired"),true),"retirement is required once, never consent to discard future ordinary history")
    assertEquals(status(db,id),ReindexStatusResult(id,config.profile,1,0,1,0,0))
  }}
}
