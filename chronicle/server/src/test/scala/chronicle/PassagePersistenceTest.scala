package chronicle

import chronicle.api.*
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8

trait PassagePersistenceFixture {
  def archive: SessionArchive
  def reader: PassageReader
  def catalog: IndexProfileCatalog
  def chunks(reader: String,id: UUID,view: ContentView): ChunksResult
  def raw(reader: String,id: UUID,revision: Int): RawResult
  def share(): Unit
  def revoke(): Unit
  def disableReader(): Unit
  def purge(id: UUID): Unit
  def clearFormat(generation: UUID): Unit
  def transition(owner: String): Unit
}
abstract class PassagePersistenceContract extends munit.FunSuite {
  import ProblemPublicationFixtures.*
  def withFixture(f: PassagePersistenceFixture => Unit): Unit
  private def claim(f: PassagePersistenceFixture,owner: String): Claim = f.archive.claim(f.catalog.knownProfiles,ClaimScope.Owner(owner),300).get
  private def publish(f: PassagePersistenceFixture,request: IngestRequest): (IngestReceipt,Claim,ProblemsPublication,ContentView) = {
    val receipt=f.archive.ingest("a",request); val current=claim(f,"a"); val publication=topics(current)
    assert(f.archive.publishProblems(current,publication))
    (receipt,current,publication,f.archive.session("a",receipt.sessionId).view)
  }
  test("BG/GoodCommunication: intramessage A/B/A persists three exact Unicode passages, pieces and normalized positions") { withFixture { f =>
    val original=request(List("","A🙂\u0001sameBαsameA🙂"))
    val (receipt,current,publication,view)=publish(f,original)
    val page=f.reader.passages("a",receipt.sessionId,0,100,Some(view))
    assertEquals(page.format,PassageFormat.ContiguousProblems); assertEquals(page.total,3L)
    assertEquals(page.passages,publication.passages.map(ProblemsPublication.info).toList)
    assertEquals(page.passages.map(_.ordinal),List(0,1,2)); assertEquals(page.passages.map(_.id).distinct.size,3)
    page.passages.foreach { passage =>
      val spans=f.reader.passageSpans("a",receipt.sessionId,passage.id,0,100,Some(view))
      assertEquals(spans.total,1L); assertEquals(spans.spans.size,1)
      assertEquals(spans.spans.head.messagePosition,1); assertEquals(spans.spans.head.messageId,"m1")
      assertEquals(spans.spans.head.start,passage.start.byteOffset); assertEquals(spans.spans.head.end,passage.end.byteOffset)
      assertEquals(passage.sourceBytes,(passage.end.byteOffset-passage.start.byteOffset).toLong)
    }
    assertEquals(f.chunks("a",receipt.sessionId,view).chunks,publication.chunks.map(_.chunk))
    assertEquals(f.raw("a",receipt.sessionId,1).files,original.files)
    assert(!f.archive.publishProblems(current,publication))
  }}
  test("BG/GoodCommunication: passage offsets refer to projected normalized text while original NUL-bearing raw files remain exact") { withFixture { f =>
    val original=request(List("A\u0000🙂B")); val (receipt,_,publication,view)=publish(f,original)
    val page=f.reader.passages("a",receipt.sessionId,0,100,Some(view))
    assertEquals(publication.chunks.map(_.chunk.text).mkString,"A\\u0000🙂B")
    val boundary="A\\u0000🙂".getBytes(UTF_8).length
    assertEquals(page.passages.map(_.start.byteOffset),List(0,boundary))
    assertEquals(page.passages.head.end.byteOffset,boundary)
    assertEquals(f.raw("a",receipt.sessionId,1).files,original.files)
  }}
  test("BG/GoodCommunication: a long problem spanning windows coalesces one source span and publishes only final annotations") { withFixture { f =>
    val original=request(List("A"+"🙂α\n"*40000)); val receipt=f.archive.ingest("a",original)
    val current=claim(f,"a"); val publication=oneProblem(current)
    assert(f.archive.publishProblems(current,publication))
    val view=f.archive.session("a",receipt.sessionId).view
    val page=f.reader.passages("a",receipt.sessionId,0,100,Some(view)); val passage=page.passages.head
    assertEquals(page.total,1L); assertEquals(passage.summary,"updated synthetic goal"); assertEquals(passage.spanCount,1L)
    assert(passage.pieceCount>ProblemPassages.maximumWindowFragments*2)
    assertEquals(passage.sourceBytes,original.messages.head.text.getBytes(UTF_8).length.toLong)
    val spans=f.reader.passageSpans("a",receipt.sessionId,passage.id,0,100,Some(view))
    assertEquals(spans.spans,List(PassageSourceSpan("m0",0,0,passage.sourceBytes.toInt)))
    assertEquals(passage.start,PassagePoint("m0",0,0)); assertEquals(passage.end,PassagePoint("m0",0,passage.sourceBytes.toInt))
    assert(f.chunks("a",receipt.sessionId,view).chunks.forall(_.summary==passage.summary))
  }}
  test("BG/GoodCommunication: passage/span paging is ordered and bounded through IntMax offsets, without a 100000 ceiling") { withFixture { f =>
    val (receipt,_,_,view)=publish(f,request(List.fill(160)("A")))
    val passage=f.reader.passages("a",receipt.sessionId,0,1,Some(view)).passages.head
    val first=f.reader.passageSpans("a",receipt.sessionId,passage.id,0,100,Some(view))
    val next=f.reader.passageSpans("a",receipt.sessionId,passage.id,100,100,Some(view))
    assertEquals(first.total,160L); assertEquals(first.spans.map(_.messagePosition),(0 until 100).toList)
    assertEquals(next.spans.map(_.messagePosition),(100 until 160).toList)
    List(100100,Int.MaxValue).foreach { offset =>
      assertEquals(f.reader.passages("a",receipt.sessionId,offset,100,Some(view)).passages,Nil)
      assertEquals(f.reader.passageSpans("a",receipt.sessionId,passage.id,offset,100,Some(view)).spans,Nil)
    }
    List((-1,1),(0,0),(0,101)).foreach { (offset,limit) =>
      assertEquals(intercept[DomainError](f.reader.passages("a",receipt.sessionId,offset,limit,Some(view))).code,"invalid")
      assertEquals(intercept[DomainError](f.reader.passageSpans("a",receipt.sessionId,passage.id,offset,limit,Some(view))).code,"invalid")
    }
  }}
  test("BG/GoodCommunication: explicit source-only and empty indexed views are distinct, with no invented empty problem") { withFixture { f =>
    List(Nil,List("","")).foreach { texts =>
      val original=request(texts); val receipt=f.archive.ingest("a",original)
      val sourceView=ContentView(1,None)
      assertEquals(f.reader.passages("a",receipt.sessionId,0,100,Some(sourceView)),PassagesResult(sourceView,PassageFormat.Unindexed,Nil,0,0))
      val current=claim(f,"a"); assert(f.archive.publishProblems(current,oneProblem(current)))
      val indexed=f.archive.session("a",receipt.sessionId).view
      assert(indexed.generationId.nonEmpty)
      assertEquals(f.reader.passages("a",receipt.sessionId,0,100,None),PassagesResult(indexed,PassageFormat.ContiguousProblems,Nil,0,0))
      assertEquals(f.reader.passages("a",receipt.sessionId,0,100,Some(sourceView)).format,PassageFormat.Unindexed)
      assertEquals(intercept[DomainError](f.reader.passageSpans("a",receipt.sessionId,UUID.randomUUID(),0,100,Some(sourceView))).code,"invalid")
    }
  }}
  test("BG/GoodCommunication regression: P1 rejects legacy payloads, legacy rejects problem payloads, Nil legacy spans stay readable") { withFixture { f =>
    val p1=f.archive.ingest("a",request(List("A"))); val p1claim=claim(f,"a")
    assertEquals(intercept[DomainError](f.archive.publish(p1claim,Nil)).code,"invalid")
    assertEquals(f.archive.session("a",p1.sessionId).indexedRevision,None)
    assert(f.archive.publishProblems(p1claim,oneProblem(p1claim)))
    val old=f.archive.ingest("b",request(List("A original"))); val legacy=claim(f,"b")
    assertEquals(intercept[DomainError](f.archive.publishProblems(legacy,oneProblem(legacy))).code,"invalid")
    val chunk=Chunk(UUID.randomUUID(),old.sessionId,"manual legacy annotation","old",List("retained"),Nil,0.0)
    assert(f.archive.publish(legacy,List(IndexedChunk(chunk,vector))))
    val view=f.archive.session("b",old.sessionId).view
    assertEquals(f.reader.passages("b",old.sessionId,0,100,Some(view)),PassagesResult(view,PassageFormat.LegacyAnnotations,Nil,0,0))
    assertEquals(f.chunks("b",old.sessionId,view).chunks,List(chunk))
    assertEquals(intercept[DomainError](f.reader.passageSpans("b",old.sessionId,chunk.id,0,100,Some(view))).code,"not-found")
    f.transition("b")
    val replacement=claim(f,"b"); assert(f.archive.publishProblems(replacement,oneProblem(replacement)))
    assertEquals(f.reader.passages("b",old.sessionId,0,100,None).format,PassageFormat.ContiguousProblems)
    assertEquals(f.reader.passages("b",old.sessionId,0,100,Some(view)).format,PassageFormat.LegacyAnnotations)
    assertEquals(f.chunks("b",old.sessionId,view).chunks,List(chunk))
  }}
  test("BG/GoodCommunication: source append retains historical generation pins, replacement cannot substitute mismatched or missing views") { withFixture { f =>
    val original=request(List("A🙂Bα")); val (receipt,_,_,old)=publish(f,original)
    val previous=f.reader.passages("a",receipt.sessionId,0,100,Some(old)); val chunkPage=f.chunks("a",receipt.sessionId,old)
    val updated=request(List("A🙂Bα","A verification")).copy(source=original.source,requestId=UUID.randomUUID(),expectedRevision=1)
    f.archive.ingest("a",updated)
    assertEquals(f.reader.passages("a",receipt.sessionId,0,100,None),previous)
    val next=claim(f,"a"); assert(f.archive.publishProblems(next,topics(next)))
    assertEquals(f.reader.passages("a",receipt.sessionId,0,100,Some(old)),previous)
    assertEquals(f.chunks("a",receipt.sessionId,old),chunkPage); assertEquals(f.raw("a",receipt.sessionId,1).files,original.files)
    List(ContentView(2,old.generationId),ContentView(1,Some(UUID.randomUUID())),ContentView(99,None)).foreach { view =>
      assertEquals(intercept[DomainError](f.reader.passages("a",receipt.sessionId,0,100,Some(view))).code,"not-found")
    }
    val foreign=f.archive.ingest("a",request(List("A foreign")))
    assertEquals(intercept[DomainError](f.reader.passages("a",foreign.sessionId,0,100,Some(old))).code,"not-found")
    val passage=previous.passages.head
    val newView=f.archive.session("a",receipt.sessionId).view
    assertEquals(intercept[DomainError](f.reader.passageSpans("a",receipt.sessionId,passage.id,0,100,Some(newView))).code,"not-found")
  }}
  test("BG/GoodCommunication: sharing revocation, disabled reader and purge reauthorize every pinned metadata/span read") { withFixture { f =>
    val (receipt,_,_,view)=publish(f,request(List("A🙂"))); val passage=f.reader.passages("a",receipt.sessionId,0,100,Some(view)).passages.head
    f.share(); assertEquals(f.reader.passages("b",receipt.sessionId,0,100,Some(view)).total,1L)
    assertEquals(f.reader.passageSpans("b",receipt.sessionId,passage.id,0,100,Some(view)).total,1L)
    f.revoke()
    assertEquals(intercept[DomainError](f.reader.passages("b",receipt.sessionId,0,100,Some(view))).code,"not-found")
    assertEquals(intercept[DomainError](f.reader.passageSpans("b",receipt.sessionId,passage.id,0,100,Some(view))).code,"not-found")
    f.share(); f.disableReader()
    assertEquals(intercept[DomainError](f.reader.passages("b",receipt.sessionId,0,100,Some(view))).code,"not-found")
    f.purge(receipt.sessionId)
    assertEquals(intercept[DomainError](f.reader.passages("a",receipt.sessionId,0,100,Some(view))).code,"not-found")
    assertEquals(intercept[DomainError](f.reader.passageSpans("a",receipt.sessionId,passage.id,0,100,Some(view))).code,"not-found")
  }}
  test("BG/GoodCommunication regression: forged snapshot, job identity, expired and superseded claims cannot publish valid problem payloads") { withFixture { f =>
    val original=request(List("A🙂")); val receipt=f.archive.ingest("a",original); val current=claim(f,"a"); val publication=oneProblem(current)
    val forged=current.copy(snapshot=current.snapshot.copy(messages=current.snapshot.messages.map(_.copy(text="fabricated source"))))
    assert(!f.archive.publishProblems(forged,oneProblem(forged)))
    List(current.copy(owner="b"),current.copy(fence=current.fence+1),current.copy(targetEpoch=current.targetEpoch+1),current.copy(jobId=UUID.randomUUID())).foreach { bad =>
      assert(!f.archive.publishProblems(bad,publication))
    }
    f.archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    assert(!f.archive.publishProblems(current,publication)); assertEquals(f.archive.session("a",receipt.sessionId).indexedRevision,None)
    val fresh=claim(f,"a"); assert(f.archive.publishProblems(fresh,oneProblem(fresh)))
    val expired=f.archive.ingest("a",request(List("A expired")))
    val expiring=f.archive.claim(f.catalog.knownProfiles,ClaimScope.Owner("a"),0).get
    assert(!f.archive.publishProblems(expiring,oneProblem(expiring))); assertEquals(f.archive.session("a",expired.sessionId).indexedRevision,None)
  }}
  test("BG/GoodCommunication: unknown provenance is unavailable only to new passage reads, never silently relabeled") { withFixture { f =>
    val (receipt,_,_,view)=publish(f,request(List("A🙂"))); val chunks=f.chunks("a",receipt.sessionId,view)
    f.clearFormat(view.generationId.get)
    assertEquals(intercept[DomainError](f.reader.passages("a",receipt.sessionId,0,100,Some(view))).code,"unavailable")
    assertEquals(f.chunks("a",receipt.sessionId,view),chunks)
    assertEquals(f.reader.passages("a",receipt.sessionId,0,100,Some(ContentView(1,None))).format,PassageFormat.Unindexed)
  }}
}
final class PassagePersistenceDummyTest extends PassagePersistenceContract {
  def withFixture(f: PassagePersistenceFixture => Unit): Unit = {
    val config=Fixtures.config(); val profiles=IndexProfileCatalog.passages(config,PassagePolicyIdentity(ProblemPassages.identity))
    val value=new DummyArchive(config,profiles); value.retainTarget("b",config.profile)
    f(new PassagePersistenceFixture {
      val archive: SessionArchive=value; val reader: PassageReader=value; val catalog: IndexProfileCatalog=profiles
      def chunks(reader: String,id: UUID,view: ContentView): ChunksResult=value.pageChunks(reader,id,0,100,Some(view))
      def raw(reader: String,id: UUID,revision: Int): RawResult=value.raw(reader,id,Some(revision))
      def share(): Unit=value.share("a","b")
      def revoke(): Unit=value.revokeSharing("a","b")
      def disableReader(): Unit=value.setEnabled("b",false)
      def purge(id: UUID): Unit=value.purge(id)
      def clearFormat(generation: UUID): Unit=value.clearFormat(generation)
      def transition(owner: String): Unit={ val plan=value.preview(owner); value(owner,UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true); () }
    })
  }
}
final class PassagePersistencePostgresTest extends PassagePersistenceContract {
  def withFixture(f: PassagePersistenceFixture => Unit): Unit = OwnerProfilePostgres.withDatabase { (config,db,value,profiles) =>
    val service=new PostgresOwnerReindex(db); val plan=service.preview("a"); service("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)
    val group=UUID.randomUUID()
    f(new PassagePersistenceFixture {
      val archive: SessionArchive=value; val reader: PassageReader=value; val catalog: IndexProfileCatalog=profiles
      def chunks(reader: String,id: UUID,view: ContentView): ChunksResult=value.pageChunks(reader,id,0,100,Some(view))
      def raw(reader: String,id: UUID,revision: Int): RawResult=value.raw(reader,id,Some(revision))
      def share(): Unit=db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','synthetic') ON CONFLICT DO NOTHING",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b') ON CONFLICT DO NOTHING",group,group); () }
      def revoke(): Unit=db.transaction { c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group); () }
      def disableReader(): Unit=db.transaction { c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='b'"); () }
      def purge(id: UUID): Unit={ val auth=new Auth(db,config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2); auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(id))); () }
      def clearFormat(generation: UUID): Unit=db.transaction { c => Sql.exec(c,"UPDATE ch_generations SET passage_format=NULL WHERE id=?",generation); () }
      def transition(owner: String): Unit={ val plan=service.preview(owner); service(owner,UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true); () }
    })
  }
}
