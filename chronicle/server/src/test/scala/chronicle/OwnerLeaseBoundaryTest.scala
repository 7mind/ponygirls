package chronicle

import chronicle.api.*
import io.circe.Json
import java.util.UUID
import java.util.concurrent.{Callable,Executors,Future,TimeUnit}
import scala.concurrent.duration.*

final class OwnerLeaseBoundaryTest extends munit.FunSuite {
  private def awaitBlocked(db: Database,prefix: String): Unit = {
    val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
    def blocked: Boolean = db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ?)",prefix+"%")(_.getBoolean(1)).get)
    while(!blocked && System.nanoTime()<deadline) Thread.sleep(5)
    assert(blocked,s"expected real PostgreSQL lock wait for $prefix")
  }
  List("progress","renew","publish","fail").foreach { operation => List("source","job").foreach { blocking =>
    test(s"Effectual GoodCommunication regression: $operation rejects a lease that expires while waiting for the $blocking lock") {
      OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
        a.ingest("a",Fixtures.snapshot())
        val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),1).get
        val pool=Executors.newSingleThreadExecutor()
        var pending: Future[Boolean]=null
        try {
          db.transaction { held =>
            if(blocking=="source") Sql.one(held,"SELECT id FROM ch_sources WHERE id=? FOR UPDATE",claim.sessionId)(_.getString(1))
            else Sql.one(held,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",claim.jobId)(_.getString(1))
            pending=pool.submit(new Callable[Boolean] { def call(): Boolean = operation match {
              case "progress" => a.progress(claim,1,1)
              case "renew" => a.renew(claim,1)
              case "publish" => a.publish(claim,Nil)
              case "fail" => a.fail(claim,"late-expired-failure"); false
            } })
            // A publication writes its generation before it locks the source row: there the held lock first stops its key-share insert.
            val prefix=if(blocking=="job") "SELECT j.id FROM ch_jobs" else if(operation=="publish") "INSERT INTO ch_generations" else "SELECT revision FROM ch_sources"
            awaitBlocked(db,prefix)
            Thread.sleep(1200)
          }
          assert(!pending.get(5,TimeUnit.SECONDS),s"$operation must check expiry after the lock wait, not at transaction start")
          db.transaction { x =>
            assertEquals(Sql.one(x,"SELECT state,completed_windows,error,lease_until>clock_timestamp() FROM ch_jobs WHERE id=?",claim.jobId)(r => (r.getString(1),r.getInt(2),Option(r.getString(3)),r.getBoolean(4))).get,("Running",0,None,false))
            assertEquals(Sql.one(x,"SELECT published IS NULL FROM ch_sources WHERE id=?",claim.sessionId)(_.getBoolean(1)).get,true)
          }
        } finally { pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)) }
      }
    }
  }}
  test("Effectual GoodCommunication regression: an ingest projecting the next revision does not hold up the heartbeat, progress, checkpoint or failure record of the claim on that source") {
    OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
      val original=Fixtures.snapshot(); a.ingest("a",original)
      val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
      // The claim's writes get one second: on the source row lock of a parked ingest they would time out.
      val bounded=c.copy(databaseLimits=c.databaseLimits.copy(statementTimeout=1.second,lockTimeout=1.second))
      val workerDb=new Database(bounded,catalog); val worker=new PostgresArchive(workerDb,bounded)
      val key=IndexCheckpoints.key(claim,IndexingStage.Annotation,0,0,ProblemPassages.identity,Json.fromString("window"))
      val pool=Executors.newSingleThreadExecutor()
      try {
        val pending=db.transaction { held =>
          // Parks the ingest at its projection step, inside its transaction, as slow storage does.
          Sql.exec(held,"LOCK TABLE ch_archive_fragments IN SHARE MODE")
          val pending=pool.submit(new Callable[IngestReceipt] { def call(): IngestReceipt = a.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1)) })
          awaitBlocked(db,"INSERT INTO ch_archive_fragments")
          assert(worker.renew(claim,300)); assert(worker.progress(claim,1,3))
          worker.checkpoint(claim,key,Json.fromString("accepted")); assertEquals(worker.checkpoint(claim,key),Some(Json.fromString("accepted")))
          worker.fail(claim,"model-timeout",IndexingStage.Annotation)
          assertEquals(db.transaction(x => Sql.one(x,"SELECT state,error FROM ch_jobs WHERE id=?",claim.jobId)(r => (r.getString(1),r.getString(2)))),Some(("Queued","model-timeout")))
          assertEquals(a.session("a",claim.sessionId).revision,1,"the next revision stays invisible until the ingest commits")
          pending
        }
        assertEquals(pending.get(10,TimeUnit.SECONDS).revision,2)
        assertEquals(a.session("a",claim.sessionId).revision,2)
        assertEquals(db.transaction(x => Sql.one(x,"SELECT state,error FROM ch_jobs WHERE id=?",claim.jobId)(r => (r.getString(1),r.getString(2)))),Some(("Failed",Jobs.supersededRevision)))
      } finally { pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)); workerDb.close() }
    }
  }
  private def bounded(c: Config,timeout: FiniteDuration): Config = c.copy(databaseLimits=c.databaseLimits.copy(statementTimeout=timeout,lockTimeout=timeout))
  test("Effectual GoodCommunication regression: a claim streaming its snapshot does not hold up the projection of an ingest of a source whose older job's lease ended") {
    OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
      val original=Fixtures.snapshot(); a.ingest("a",original)
      val older=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
      val head=a.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1)); val other=a.ingest("a",Fixtures.snapshot())
      db.transaction { x =>
        Sql.exec(x,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",older.jobId)
        // A deferred large head job: a claim without the large-job permit passes this source and takes the next one.
        Sql.exec(x,"UPDATE ch_jobs SET total_windows=? WHERE id=?",LargeJobs.windows+1,head.jobId)
        // Parks a claim at its job update, just before it streams the claimed snapshot, holding the locks it streams under.
        Sql.exec(x,"CREATE FUNCTION ch_test_park_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock_shared(71393722); RETURN NEW; END $$")
        Sql.exec(x,"CREATE TRIGGER ch_test_park_claim BEFORE UPDATE ON ch_jobs FOR EACH ROW WHEN (OLD.state='Queued' AND NEW.state='Running') EXECUTE FUNCTION ch_test_park_claim()")
      }
      val limited=bounded(c,1.second); val ingestDb=new Database(limited,catalog)
      val pool=Executors.newSingleThreadExecutor()
      try {
        val pending=db.transaction { held =>
          Sql.exec(held,"SELECT pg_advisory_xact_lock(71393722)")
          val pending=pool.submit(new Callable[Option[Claim]] { def call(): Option[Claim] = a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300,LargeJobs.Skipped) })
          awaitBlocked(db,"UPDATE ch_jobs SET state='Running'")
          assertEquals(new PostgresArchive(ingestDb,limited).ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=2)).revision,3)
          pending
        }
        assertEquals(pending.get(5,TimeUnit.SECONDS).map(_.jobId),Some(other.jobId))
        assertEquals(db.transaction(x => Sql.one(x,"SELECT state,error FROM ch_jobs WHERE id=?",older.jobId)(r => (r.getString(1),r.getString(2)))),Some(("Failed",Jobs.supersededRevision)))
      } finally {
        pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)); ingestDb.close()
        db.transaction(x => Sql.exec(x,"DROP FUNCTION ch_test_park_claim() CASCADE"))
      }
    }
  }
  private def messages(original: IngestRequest,count: Int): IngestRequest = {
    val values=(0 until count).map(i => chronicle.api.Message(s"m$i",None,"user",s"synthetic message $i",None,i)).toList
    val raw=values.map(m => io.circe.Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(m.text)).noSpaces+"\n").mkString
    original.copy(messages=values,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  test("Effectual GoodCommunication regression: a publication writing its generation does not hold up the job's renewal and progress or the source's next revision switch, and still publishes its revision") {
    OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
      val original=Fixtures.snapshot(); a.ingest("a",original)
      val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
      val limited=bounded(c,1.second); val workerDb=new Database(limited,catalog); val worker=new PostgresArchive(workerDb,limited)
      val pool=Executors.newSingleThreadExecutor()
      try {
        val pending=db.transaction { held =>
          // Parks the publication at its search rows, as their vector-index insertion does for a large job.
          Sql.exec(held,"LOCK TABLE ch_search_chunks IN SHARE MODE")
          val pending=pool.submit(new Callable[Boolean] { def call(): Boolean = a.publishProblems(claim,CurrentIndexDatabase.publication(claim,false)) })
          awaitBlocked(db,"%ch_search_chunks")
          assert(worker.renew(claim,300)); assert(worker.progress(claim,1,1))
          assertEquals(worker.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1)).revision,2)
          pending
        }
        assert(pending.get(10,TimeUnit.SECONDS),"a newer revision does not void the publication of a running job")
        assertEquals((a.session("a",claim.sessionId).revision,a.session("a",claim.sessionId).indexedRevision),(2,Some(1)))
        assertEquals(db.transaction(x => Sql.one(x,"SELECT count(*)>0 FROM ch_search_chunks WHERE session_id=? AND revision=1",claim.sessionId)(_.getBoolean(1))),Some(true))
      } finally { pool.shutdownNow(); assert(pool.awaitTermination(6,TimeUnit.SECONDS)); workerDb.close() }
    }
  }
  test("Effectual GoodCommunication regression: a publication's search rows are inserted in statements that do not grow with the job") {
    OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
      val rows=PostgresArchive.searchRowsPerStatement*3
      a.ingest("a",messages(Fixtures.snapshot(),rows))
      val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
      val publication=CurrentIndexDatabase.publication(claim,false); assertEquals(publication.chunks.size,rows)
      // A statement costs one millisecond per search row it inserts: a bounded statement half a second, all rows at once 1.5 s.
      val limited=bounded(c,1.second); val workerDb=new Database(limited,catalog)
      db.transaction { x =>
        Sql.exec(x,"CREATE FUNCTION ch_test_slow_search_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.001*(SELECT count(*) FROM inserted)); RETURN NULL; END $$")
        Sql.exec(x,"CREATE TRIGGER ch_test_slow_search_row AFTER INSERT ON ch_search_chunks REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION ch_test_slow_search_row()")
      }
      try assert(new PostgresArchive(workerDb,limited).publishProblems(claim,publication))
      finally {
        db.transaction(x => Sql.exec(x,"DROP FUNCTION ch_test_slow_search_row() CASCADE")); workerDb.close()
      }
      assertEquals(a.session("a",claim.sessionId).indexedRevision,Some(1))
      assertEquals(db.transaction(x => Sql.one(x,"SELECT count(*) FROM ch_search_chunks WHERE session_id=?",claim.sessionId)(_.getInt(1))),Some(rows))
    }
  }
  test("Effectual GoodCommunication: a claim carries the stored revision's messages, in order, and its digest, but not its raw files") {
    OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
      val receipt=a.ingest("a",messages(Fixtures.snapshot(),3*PostgresArchive.claimedMessagesPerFetch+1))
      val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
      assertEquals(claim.snapshot,a.headSnapshot("a",receipt.sessionId).copy(files=Nil))
    }
  }
  test("Effectual GoodCommunication: a deferred large job returns to the queue without its attempt and only claims that admit large jobs take it") {
    OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
      val large=a.ingest("a",Fixtures.snapshot()); val small=a.ingest("b",Fixtures.snapshot())
      val claim=a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300,LargeJobs.Skipped).get
      assert(a.defer(claim,LargeJobs.windows+1))
      assertEquals(db.transaction(x => Sql.one(x,"SELECT state,attempts,total_windows,lease_until IS NULL FROM ch_jobs WHERE id=?",large.jobId)(r => (r.getString(1),r.getInt(2),r.getInt(3),r.getBoolean(4)))),Some(("Queued",0,LargeJobs.windows+1,true)))
      assert(!a.defer(claim,LargeJobs.windows+1),"the deferred claim is stale")
      assertEquals(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300,LargeJobs.Skipped),None)
      assertEquals(a.claim(catalog.knownProfiles,ClaimScope.AllOwners,300,LargeJobs.Skipped).map(_.jobId),Some(small.jobId))
      assertEquals(a.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300,LargeJobs.Admitted).map(_.jobId),Some(large.jobId))
    }
  }
}
