package chronicle

import chronicle.api.*
import java.util.concurrent.{Callable,Executors,Future,TimeUnit}

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
}
