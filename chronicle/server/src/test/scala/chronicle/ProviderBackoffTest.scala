package chronicle

import cats.effect.unsafe.implicits.global
import ProviderBackoffFixtures.*

/** The back-off after model-provider failures (`indexing.providerBackoff`; design note
  * docs/drafts/20261126-1845-indexing-provider-backoff-design.md, owner's decisions Q177/Q178), on PostgreSQL, through the
  * production annotator, embedder and ModelHttp against a provider stub on loopback. */
class ProviderBackoffTest extends munit.FunSuite {
  private def database(config: Config)(f: (Config,Database,PostgresArchive) => Unit): Unit = ClaimOrderPostgres.withDatabase(config)(f)
  private val orders=List(ClaimOrderSetting.SourceId,ClaimOrderSetting.Waiting)

  // The reproduction (note §1, §3.7: job 7fc785e8 spent five attempts in 62 s on one window). Flag off it documents today's
  // behaviour: a job answered HTTP 429 is Queued again without a next attempt time, claimed again at once, and Failed when
  // its fifth attempt is answered 429, every attempt spending one reservation of the same window.
  for(order <- orders; continuations <- List(false,true)) {
    val mode=s"claimOrder ${order.key}, continuations ${if(continuations) "on" else "off"}"
    test(s"provider back-off off: a job answered HTTP 429 at annotation is offered again at once and fails after five attempts ($mode)") {
      val config=configured(ClaimOrderPostgres.config(),order,continuations,backoff=false)
      provider.use { (stub,client) => cats.effect.IO {
        val c=stub.configure(config); stub.chat=_ => 429
        database(c) { (c,db,a) =>
          val id=a.ingest("a",Fixtures.snapshot()).jobId; val worker=ProviderBackoffFixtures.worker(a,c,client,logstage.IzLogger())
          (1 to Jobs.attemptLimit).foreach { attempt =>
            assert(once(worker,c),s"attempt $attempt: the job is claimed at once")
            assertEquals(stub.chatCalls.get,attempt)
            val state=if(attempt<Jobs.attemptLimit) "Queued" else "Failed"
            assertEquals(row(db,id),JobRow(state,attempt,Some("model-http"),Some("Annotation"),None,0),s"attempt $attempt: no next attempt time")
          }
          assert(!once(worker,c),"nothing is left to claim")
          assertEquals((stub.chatCalls.get,ledger(db,id)),(Jobs.attemptLimit,Jobs.attemptLimit),"one call and one reservation of the window per attempt")
        }
      }}.unsafeRunSync()
    }
    test(s"provider back-off on: a job answered HTTP 429 at annotation is held with its attempt refunded and not offered again before the hold ends ($mode)") {
      val config=configured(ClaimOrderPostgres.config(),order,continuations,backoff=true)
      provider.use { (stub,client) => cats.effect.IO {
        val c=stub.configure(config); stub.chat=_ => 429
        database(c) { (c,db,a) =>
          val id=a.ingest("a",Fixtures.snapshot()).jobId; val worker=ProviderBackoffFixtures.worker(a,c,client,logstage.IzLogger())
          assert(once(worker,c))
          val held=row(db,id)
          assertEquals(held.copy(leaseSeconds=None),JobRow("Queued",0,Some("model-http"),Some("Annotation"),None,1),"held, attempt refunded, first of the shared count")
          assert(held.leaseSeconds.exists(s => s>55 && s<=60),s"held for the first interval (60 s): $held")
          assert(!once(worker,c),"the held job is not claimed before its hold ends")
          assertEquals((stub.chatCalls.get,ledger(db,id)),(1,1))
        }
      }}.unsafeRunSync()
    }
  }
}
