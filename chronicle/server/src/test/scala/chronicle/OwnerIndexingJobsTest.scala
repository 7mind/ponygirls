package chronicle

import cats.effect.{Deferred,IO,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import chronicle.api.*
import io.circe.Json
import org.http4s.{Response,Status}
import org.http4s.client.Client
import ponygirls.auth.{IndexingChoice,IndexingPreferenceSql,IndexingService}
import java.util.UUID
import scala.concurrent.duration.*
import scala.util.Using

/** Chronicle's job and dispatch authority, on the owned suite database and an in-process synthetic model transport. */
final class OwnerIndexingJobsTest extends munit.FunSuite {
  private def cleanPreferences(db: Database): Unit = db.transaction { c =>
    Sql.exec(c,"DELETE FROM ponygirls_indexing_preferences WHERE service IN('chronicle','haystack') AND owner_key IN(?,?)",
      IndexingPreferenceSql.ownerKey("a"),IndexingPreferenceSql.ownerKey("b"))
    ()
  }
  private def fixture(f: (Config,Database,PostgresArchive,IndexProfileCatalog) => Unit): Unit =
    OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
      cleanPreferences(db)
      try f(config,db,archive,catalog) finally cleanPreferences(db)
    }
  private def set(db: Database,config: Config,choice: IndexingChoice,owner: String="a",service: IndexingService=IndexingService.Chronicle): Unit =
    db.transaction { c => IndexingPreferenceSql.store(c,service,config.indexingPolicy).setOverride(owner,choice); () }
  private def disabled(db: Database,config: Config): Unit = set(db,config,IndexingChoice.Disable)
  private def enabled(db: Database,config: Config): Unit = set(db,config,IndexingChoice.Enable)
  private def status(archive: PostgresArchive,id: UUID): JobInfo = archive.statuses("a",0,100).jobs.find(_.id==id).get
  private def physical(db: Database,id: UUID): (String,Int) = db.transaction(c =>
    Sql.one(c,"SELECT state,attempts FROM ch_jobs WHERE id=?",id)(r => (r.getString(1),r.getInt(2))).get)
  private def paid(db: Database,id: UUID): (Int,Int,Int) = db.transaction(c => Sql.one(c,"""SELECT
    (SELECT count(*) FROM ch_annotation_attempts WHERE job_id=j.id),
    (SELECT count(*) FROM ch_index_checkpoints WHERE job_id=j.id AND stage='Annotation'),
    (SELECT count(*) FROM ch_index_checkpoints WHERE job_id=j.id AND stage='Embedding') FROM ch_jobs j WHERE id=?""",id)(r => (r.getInt(1),r.getInt(2),r.getInt(3))).get)

  test("Effectual GoodCommunication: opted-out owner gets durable ingest and upload receipts and raw reads; only eligible owners claim") { fixture { (base,db,_,catalog) =>
    val config=base.copy(indexingPolicy=base.indexingPolicy.copy(defaultEnabled=false))
    // Use the actual default of the Database that backs claim/authority, not merely a local test predicate.
    Using.resource(new Database(config,catalog)) { parkedDb =>
      val archive=new PostgresArchive(parkedDb,config)
      val request=Fixtures.snapshot()
      val ingest=archive.ingest("a",request)
      val uploads=new Uploads(parkedDb,config,UploadPolicy.production)
      val content=UploadFixtures.header(3)++UploadFixtures.pi("u1","s","user","synthetic staged upload",1)
      val opened=uploads.open("a",UploadFixtures.declaration(UploadFixtures.source(),0,content,None))
      UploadFixtures.send(uploads,"a",opened.uploadId,UploadFixtures.part(0,content))
      val uploaded=uploads.commit("a",opened.uploadId)
      assertEquals(archive.ingest("a",request),ingest)
      assertEquals(uploads.commit("a",opened.uploadId),uploaded)
      assertEquals(archive.raw("a",uploaded.sessionId,Some(1)).files.map(_.content).mkString,content.raw)
      assertEquals(archive.raw("a",ingest.sessionId,None).files,request.files)
      assertEquals(archive.session("a",ingest.sessionId).view,ContentView(1,None))
      val other=archive.ingest("b",Fixtures.snapshot())
      set(db,config,IndexingChoice.Enable,owner="b")
      val picked=archive.claim(catalog.knownProfiles,ClaimScope.AllOwners,300).get
      assertEquals((picked.owner,picked.jobId),("b",other.jobId)); assert(archive.publish(picked,Nil))
      assertEquals(archive.claim(catalog.knownProfiles,ClaimScope.AllOwners,300),None)
      for(receipt <- List(ingest,uploaded)) {
        assertEquals(physical(db,receipt.jobId),("Queued",0))
        assertEquals(paid(db,receipt.jobId),(0,0,0))
      }
      enabled(db,config)
      val resumed=List.fill(2)(archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get)
      assertEquals(resumed.map(_.jobId).toSet,Set(ingest.jobId,uploaded.jobId))
      resumed.foreach(claim => assert(archive.publish(claim,Nil)))
    }
  }}

  test("Effectual GoodCommunication regression: a parked owner archives new snapshots and uploads despite an unexecutable retained target") { fixture { (config,db,_,catalog) =>
    val request=Fixtures.snapshot()
    val content=UploadFixtures.header(3)++UploadFixtures.pi("u1","s","user","synthetic upload after rotation",1)
    def declaration()=UploadFixtures.declaration(UploadFixtures.source(),0,content,None)
    val legacy=new Uploads(db,config,UploadPolicy.production)
    val started=legacy.open("a",declaration())
    UploadFixtures.send(legacy,"a",started.uploadId,UploadFixtures.part(0,content))
    val rotated=config.copy(annotation=config.annotation.copy(revision="synthetic-rotation"))
    val newCatalog=IndexProfileCatalog.current(rotated)
    assert(!newCatalog.knownProfiles(catalog.preferred.profile))
    Using.resource(new Database(rotated,newCatalog)) { on =>
      on.initialize()
      val archive=new PostgresArchive(on,rotated)
      val uploads=new Uploads(on,rotated,UploadPolicy.production)
      assertEquals(intercept[DomainError](archive.ingest("a",request)).code,"unavailable")
      assertEquals(intercept[DomainError](uploads.open("a",declaration())).code,"unavailable")
      assertEquals(intercept[DomainError](uploads.commit("a",started.uploadId)).code,"unavailable")
    }
    val parked=rotated.copy(indexingPolicy=rotated.indexingPolicy.copy(defaultEnabled=false))
    Using.resource(new Database(parked,newCatalog)) { off =>
      val archive=new PostgresArchive(off,parked)
      val uploads=new Uploads(off,parked,UploadPolicy.production)
      val direct=archive.ingest("a",request)
      val continued=uploads.commit("a",started.uploadId)
      val opened=uploads.open("a",declaration())
      UploadFixtures.send(uploads,"a",opened.uploadId,UploadFixtures.part(0,content))
      val fresh=uploads.commit("a",opened.uploadId)
      assertEquals(archive.ingest("a",request),direct)
      assertEquals(uploads.commit("a",started.uploadId),continued)
      assertEquals(archive.raw("a",direct.sessionId,None).files,request.files)
      for(receipt <- List(continued,fresh))
        assertEquals(archive.raw("a",receipt.sessionId,Some(1)).files.map(_.content).mkString,content.raw)
      for(receipt <- List(direct,continued,fresh)) {
        assertEquals(physical(off,receipt.jobId),("Queued",0))
        assertEquals(off.transaction(c => Sql.one(c,"SELECT profile FROM ch_jobs WHERE id=?",receipt.jobId)(_.getString(1))),Some(catalog.preferred.profile))
      }
      assertEquals(archive.claim(newCatalog.knownProfiles,ClaimScope.AllOwners,300),None)
      enabled(off,parked)
      assertEquals(archive.claim(newCatalog.knownProfiles,ClaimScope.AllOwners,300),None,"opting in alone does not retarget an obsolete profile")
    }
  }}

  test("Effectual GoodCommunication: opt-out rejects rerun, bulk retry and rebuild without changing jobs; pre-toggle plans cannot execute after re-enable") { fixture { (config,db,archive,catalog) =>
    val auth=new Auth(db,config)
    val (_,cookie)=auth.login(LoginRequest("a","synthetic"))
    val owner=auth.browser(cookie)
    val ingest=archive.ingest("a",Fixtures.snapshot())
    archive.fail(archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get,IndexingBudget.exceededCode)
    val original=physical(db,ingest.jobId)
    val retry=auth.previewRetryFailed(owner)
    val rebuild=auth.previewOwnerReindex(owner)
    val one=ClientEnvelope(UUID.randomUUID(),Operation.RetryJob(ingest.jobId))
    val many=ClientEnvelope(UUID.randomUUID(),Operation.ApplyRetryFailed(retry.targetProfile,retry.selectionHash,true))
    val force=ClientEnvelope(UUID.randomUUID(),Operation.ApplyOwnerReindex(rebuild.targetProfile,rebuild.selectionHash,true))
    disabled(db,config)
    List(one,many,force).foreach(e => assertEquals(intercept[DomainError](auth.mutate(owner,e)).code,"forbidden"))
    assertEquals(intercept[DomainError](archive.retry("a",ingest.jobId)).code,"forbidden")
    assertEquals(intercept[DomainError](auth.previewRetryFailed(owner)).code,"forbidden")
    assertEquals(intercept[DomainError](auth.previewOwnerReindex(owner)).code,"forbidden")
    assertEquals(physical(db,ingest.jobId),original)
    enabled(db,config)
    List(many,force).foreach { e => auth.mutate(owner,e) match {
      case Result.Error(failure) => assertEquals(failure.code,"conflict")
      case value => fail(s"stale preview accepted: $value")
    }}
    assertEquals(physical(db,ingest.jobId),original)
    val current=auth.previewRetryFailed(owner)
    val next=ClientEnvelope(UUID.randomUUID(),Operation.ApplyRetryFailed(current.targetProfile,current.selectionHash,true))
    val receipt=auth.mutate(owner,next)
    assertEquals(receipt.asInstanceOf[Result.RetryFailed].result.retried,1L)
    disabled(db,config)
    assertEquals(auth.mutate(owner,next),receipt,"replaying a receipt authorizes no new work")
    assertEquals(physical(db,ingest.jobId),("Queued",0))
  }}

  test("Effectual GoodCommunication: a quick off-on invalidates an unexpired, last-attempt lease without dropping its accepted work") { fixture { (config,db,archive,catalog) =>
    val ingest=archive.ingest("a",Fixtures.snapshot())
    val before=db.transaction(SecurityEpoch.current)
    set(db,config,IndexingChoice.Enable)
    set(db,config,IndexingChoice.Disable,service=IndexingService.Haystack)
    assertEquals(db.transaction(SecurityEpoch.current),before,"unchanged effective Chronicle choice and other services don't invalidate runs")
    db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET attempts=? WHERE id=?",Jobs.attemptLimit-1,ingest.jobId))
    val old=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    val accepted=IndexCheckpoints.key(old,IndexingStage.Embedding,0,0,"synthetic",Json.obj())
    val later=accepted.copy(part=1)
    val vector=CheckpointJson.vectors(List(List(1.0,0.0,0.0)))
    archive.checkpoint(old,accepted,vector)
    val annotation=IndexCheckpoints.annotation(old,0,Json.obj())
    val reservation=archive.reserveAnnotation(old,annotation,false).asInstanceOf[AnnotationReservation.Reserved].attempt
    disabled(db,config)
    assertEquals(archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300),None)
    val parked=status(archive,ingest.jobId)
    assertEquals((parked.state,parked.attempts),(JobState.Queued,Jobs.attemptLimit-1))
    assert(!archive.renew(old,300))
    enabled(db,config)
    assertEquals(db.transaction(SecurityEpoch.current),before+2)
    assert(!archive.renew(old,300)); assert(!archive.progress(old,1,1))
    assertEquals(intercept[DomainError](archive.authorizeModelDispatch(old)).code,"stale-claim")
    assertEquals(intercept[DomainError](archive.checkpoint(old,later,vector)).code,"stale-claim")
    assertEquals(intercept[DomainError](archive.acceptAnnotation(old,annotation,reservation,0,Json.obj())).code,"stale-claim")
    assert(!archive.publish(old,Nil)); assertEquals(paid(db,ingest.jobId),(1,0,1))
    val resumed=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals((resumed.jobId,resumed.runId),(old.jobId,old.runId)); assert(resumed.fence>old.fence)
    assertEquals(physical(db,ingest.jobId),("Running",Jobs.attemptLimit))
    archive.fail(old,"late-failure")
    assertEquals(physical(db,ingest.jobId),("Running",Jobs.attemptLimit),"late failure must not park the new lease")
    assertEquals(archive.checkpoint(resumed,accepted),Some(vector))
    assertEquals(archive.checkpoint(resumed,later),None)
    assert(archive.publish(resumed,Nil))
  }}

  test("Effectual GoodCommunication: a publication between batches cannot restage or switch after off-on; its current run resumes") { fixture { (config,db,archive,catalog) =>
    val ingest=archive.ingest("a",Fixtures.snapshot())
    val old=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    val rows=ProblemsPublication.rows(ProblemPublicationFixtures.oneProblem(old))
    def staged(): List[UUID] = db.transaction(c => Sql.rows(c,"SELECT generation FROM ch_staged_generations WHERE job_id=?",old.jobId)(_.getObject(1,classOf[UUID])))
    val paused=new ProblemRows {
      def parent: Option[PublicationParent] = rows.parent
      def passages(from: Int)(write: (Int,ProblemRows.Passages) => Unit): ProblemRows.Replayed = {
        assertEquals(staged().size,1,"the run has staged before replay")
        val result=rows.passages(from)(write)
        // No JDBC resource is held across this replay boundary. The tiny batch has not been flushed.
        disabled(db,config); enabled(db,config)
        result
      }
      def pieces(from: Int,stored: ProblemRows.Stored)(write: (Int,Vector[ProblemRows.Piece]) => Unit): Unit =
        fail("a stale batch cannot advance to pieces")
    }
    assert(!archive.publishProblems(old,paused))
    val generation=staged().head
    assertEquals(db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_problem_passages WHERE generation=?",generation)(_.getInt(1))),Some(0))
    assertEquals(archive.session("a",ingest.sessionId).view,ContentView(1,None))
    val resumed=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals(resumed.runId,old.runId)
    assert(archive.publishProblems(resumed,rows))
    assertEquals(archive.session("a",ingest.sessionId).view,ContentView(1,Some(generation)))
  }}

  private val annotationResult=Json.obj("choices" -> Json.arr(Json.obj("finish_reason" -> Json.fromString("stop"),
    "message" -> Json.obj("content" -> Json.fromString("""{"parts":[{"kind":"Problem","start":{"fragmentIndex":0,"scalarOffset":0},"end":{"fragmentIndex":1,"scalarOffset":0},"continuePrevious":false,"summary":"synthetic goal","tags":[]}]}""")))))
  private val embeddingResult=Json.obj("data" -> Json.arr(Json.obj("index" -> Json.fromInt(0),"embedding" -> Json.arr(Json.fromInt(1),Json.fromInt(0),Json.fromInt(0)))))

  private def modelWorker(archive: SessionArchive,config: Config,catalog: IndexProfileCatalog,admission: ModelAdmission,handler: String => IO[Json]): IO[Worker] =
    ModelTelemetry.make(new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO])).map { telemetry =>
      val client=Client.fromHttpApp[IO](cats.data.Kleisli(request => handler(request.uri.path.renderString).map(json => Response[IO](Status.Ok).withEntity(json.noSpaces))))
      val http=new ModelHttp(client,telemetry,admission)
      new Worker(archive,new OpenAIProblemPassageAnnotator(http,config),new OpenAIEmbedder(http,config),config,catalog,admission,logstage.IzLogger(),ModelFixtures.failureBackoff,ModelFixtures.snapshots)
    }

  List(ModelWorkload.IndexAnnotation,ModelWorkload.IndexEmbedding).foreach { workload =>
    test(s"Effectual GoodCommunication: $workload waiting on model admission is not sent, even after off-on") { fixture { (base,db,archive,catalog) =>
      val config=base.copy(indexing=IndexingCapacity(1,1,1,annotationContinuations=workload==ModelWorkload.IndexAnnotation))
      val receipt=archive.ingest("a",Fixtures.snapshot())
      val before=if(workload==ModelWorkload.IndexAnnotation) Vector.empty[String] else Vector("/chat")
      (for {
        calls <- Ref.of[IO,Vector[String]](Vector.empty)
        waiting <- Deferred[IO,Unit]
        release <- Deferred[IO,Unit]
        held <- Deferred[IO,Unit]
        base <- ModelAdmission.make(config.indexing)
        admission = new ModelAdmission {
          def annotationSession: Resource[IO,Unit] = base.annotationSession
          def largeJob: Resource[IO,Boolean] = base.largeJob
          def request(purpose: ModelWorkload): Resource[IO,Unit] =
            Resource.eval(if(purpose==workload) waiting.complete(()).void else IO.unit) *> base.request(purpose)
        }
        worker <- modelWorker(archive,config,catalog,admission,path => calls.update(_:+path).as(if(path=="/chat") annotationResult else embeddingResult))
        _ <- base.request(workload).use(_ => held.complete(()) *> release.get).background.use { _ =>
          held.get *> worker.once.background.use { done =>
            for {
              _ <- waiting.get.timeout(10.seconds)
              seen <- calls.get
              _ <- IO(assertEquals(seen,before))
              _ <- IO.blocking { disabled(db,config); enabled(db,config) }
              _ <- release.complete(())
              ran <- done.timeout(10.seconds).flatMap(_.embedNever)
              after <- calls.get
              _ <- IO { assert(ran); assertEquals(after,before,"the stale waiter reached model transport") }
            } yield ()
          }
        }
        _ <- IO.blocking {
          assertEquals(paid(db,receipt.jobId),if(before.isEmpty) (0,0,0) else (1,1,0))
          assertEquals(physical(db,receipt.jobId),("Queued",0))
        }
        ran <- worker.once
        seen <- calls.get
        _ <- IO.blocking {
          assert(ran); assertEquals(seen,Vector("/chat","/embedding"))
          assertEquals(physical(db,receipt.jobId),("Complete",1))
        }
      } yield ()).unsafeRunSync()
    }}
  }

  test("Effectual GoodCommunication: an already-dispatched model response arriving after opt-out cannot be accepted") { fixture { (base,db,archive,catalog) =>
    val config=base.copy(annotation=base.annotation.copy(timeoutSeconds=30))
    val receipt=archive.ingest("a",Fixtures.snapshot())
    (for {
      sent <- Deferred[IO,Unit]
      respond <- Deferred[IO,Unit]
      admission <- ModelAdmission.make(config.indexing)
      worker <- modelWorker(archive,config,catalog,admission,path =>
        if(path=="/chat") sent.complete(()) *> respond.get.as(annotationResult)
        else IO.raiseError(new AssertionError("invalidated annotation sent a document embedding")))
      _ <- worker.once.background.use { done =>
        for {
          _ <- sent.get.timeout(10.seconds)
          _ <- IO.blocking { disabled(db,config) }
          _ <- respond.complete(())
          ran <- done.timeout(10.seconds).flatMap(_.embedNever)
          _ <- IO.blocking {
            assert(ran); assertEquals(physical(db,receipt.jobId),("Queued",0))
            assertEquals(paid(db,receipt.jobId),(1,0,0),"the admitted reservation is retained but its answer is not accepted")
            assertEquals(archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300),None)
            assertEquals(archive.session("a",receipt.sessionId).view,ContentView(1,None))
          }
        } yield ()
      }
    } yield ()).unsafeRunSync()
  }}
}
