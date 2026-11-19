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
            val prefix=if(blocking=="source") "SELECT id FROM ch_sources" else "SELECT j.id FROM ch_jobs"
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
}
