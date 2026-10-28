package chronicle

import chronicle.api.*
import java.util.UUID

abstract class RebuildRetirementContract extends munit.FunSuite {
  protected final case class F(archive: SessionArchive,rebuild: OwnerReindex,chunks: (UUID,ContentView) => ChunksResult,raw: (UUID,Int) => RawResult)
  protected def withArchive(run: F => Unit): Unit
  private def publish(archive: SessionArchive): Claim = {
    val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    val chunks=Fragments.split(claim.snapshot.messages).map(chunk => IndexedChunk(chunk.copy(sessionId=claim.sessionId,summary="synthetic problem"),List(1.0,0.0,0.0)))
    assert(archive.publishProblems(claim,TestPublications.from(claim,chunks))); claim
  }
  // Regression-origin: supersession is not permission to retain old payload forever or to delete all future history.
  test("GoodCommunication: superseded captured revision fulfills retirement once, preserving later ordinary current-policy history") { withArchive { f =>
    val request=Fixtures.snapshot(); val receipt=f.archive.ingest("a",request)
    publish(f.archive); val original=f.archive.session("a",receipt.sessionId).view
    val plan=f.rebuild.preview("a"); val id=UUID.randomUUID()
    val accepted=f.rebuild("a",id,plan.targetProfile,plan.selectionHash,true)
    assertEquals((accepted.heads,accepted.queued,accepted.alreadyCurrent),(1L,1L,0L))
    f.archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    publish(f.archive); val replacement=f.archive.session("a",receipt.sessionId).view
    val retired=scala.util.Try(f.chunks(receipt.sessionId,original)).failed.toOption.collect { case error: DomainError => error.code }
    assertEquals(f.raw(receipt.sessionId,1).files,request.files)
    assertEquals(f.rebuild.status("a",id),ReindexStatusResult(id,plan.targetProfile,1,0,1,0,0))
    f.archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=2))
    publish(f.archive)
    val preserved=scala.util.Try(f.chunks(receipt.sessionId,replacement)).toOption.exists(_.chunks.nonEmpty)
    assertEquals((retired,preserved),(Some("indexed-view-retired"),true))
    assertEquals(f.rebuild.status("a",id),ReindexStatusResult(id,plan.targetProfile,1,0,1,0,0))
  }}
}
class DummyRebuildRetirementTest extends RebuildRetirementContract {
  protected def withArchive(run: F => Unit): Unit = {
    val config=Fixtures.config(); val archive=new DummyArchive(config,IndexProfileCatalog.current(config))
    run(F(archive,archive,(id,view) => archive.pageChunks("a",id,0,100,Some(view)),(id,revision) => archive.raw("a",id,Some(revision))))
  }
}
class PostgresRebuildRetirementTest extends RebuildRetirementContract {
  protected def withArchive(run: F => Unit): Unit = CurrentIndexDatabase.withDatabase { (_,db,archive) =>
    run(F(archive,new PostgresOwnerReindex(db),(id,view) => archive.pageChunks("a",id,0,100,Some(view)),(id,revision) => archive.raw("a",id,Some(revision))))
  }
}
