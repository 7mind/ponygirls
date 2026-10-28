package chronicle

import chronicle.api.*
import cats.effect.unsafe.implicits.global
import java.util.concurrent.{CountDownLatch,TimeUnit}

// Specified-origin: exact database resource/isolation behavior is intentionally not simulated by the dummy.
class SessionMessageSearchBoundaryTest extends munit.FunSuite {
  test("GoodCommunication: restarting the archive reader instance invalidates its old search cursor") { OwnerProfilePostgres.withDatabase { (config,db,a,_) =>
    val original=Fixtures.snapshot()
    val request=original.copy(messages=original.messages++original.messages.map(_.copy(id="second")))
    val out=a.ingest("a",request); val view=ContentView(1,None)
    val first=a.searchSessionMessages("a",out.sessionId,view,"archive",None,1)
    assert(first.nextCursor.nonEmpty)
    val restarted=new PostgresArchive(db,config)
    assertEquals(intercept[DomainError](restarted.searchSessionMessages("a",out.sessionId,view,"archive",first.nextCursor,1)).code,"invalid")
    assertEquals(restarted.searchSessionMessages("a",out.sessionId,view,"archive",None,1).hits,first.hits)
  }}
  test("GoodCommunication: unrestricted browser materialization still preflights huge locator IDs") { OwnerProfilePostgres.withDatabase { (_,db,a,_) =>
    val out=a.ingest("a",Fixtures.snapshot())
    db.transaction(c => Sql.exec(c,"UPDATE ch_messages SET message_id=repeat('x',100000) WHERE session_id=?",out.sessionId))
    assertEquals(intercept[DomainError](a.searchSessionMessages("a",out.sessionId,ContentView(1,None),"archive",None,1)).code,"read-budget")
  }}
  test("GoodCommunication: zero-budget caller is denied on view metadata before locator retrieval") { OwnerProfilePostgres.withDatabase { (_,_,a,_) =>
    val out=a.ingest("a",Fixtures.snapshot()); val view=ContentView(1,None)
    val admission=ReadAdmission.limited(0).unsafeRunSync()
    assertEquals(intercept[DomainError](a.searchSessionMessages("a",out.sessionId,view,"archive",None,1,ReadMaterialization.admitted(admission))).code,"read-budget")
  }}
  test("GoodCommunication: lock wait hits explicit five second database deadline, never empty or partial hits") { OwnerProfilePostgres.withDatabase { (_,db,a,_) =>
    val out=a.ingest("a",Fixtures.snapshot()); val acquired=new CountDownLatch(1); val release=new CountDownLatch(1)
    val blocker=new Thread(() => db.transaction { c =>
      Sql.exec(c,"LOCK TABLE ch_messages IN ACCESS EXCLUSIVE MODE")
      acquired.countDown(); release.await(20,TimeUnit.SECONDS); ()
    })
    blocker.start()
    try {
      assert(acquired.await(5,TimeUnit.SECONDS))
      val started=System.nanoTime()
      assertEquals(intercept[DomainError](a.searchSessionMessages("a",out.sessionId,ContentView(1,None),"archive",None,100)).code,"deadline")
      val millis=(System.nanoTime()-started)/1000000
      assert(millis>=4000 && millis<15000,s"deadline elapsed=$millis ms")
    } finally { release.countDown(); blocker.join(5000); assert(!blocker.isAlive) }
  }}
  test("GoodCommunication: a caller's stricter statement deadline is not weakened") { OwnerProfilePostgres.withDatabase { (_,db,a,_) =>
    val out=a.ingest("a",Fixtures.snapshot()); val acquired=new CountDownLatch(1); val release=new CountDownLatch(1)
    val blocker=new Thread(() => db.transaction { c => Sql.exec(c,"LOCK TABLE ch_messages IN ACCESS EXCLUSIVE MODE"); acquired.countDown(); release.await(15,TimeUnit.SECONDS); () })
    // The database session default is a controllable fixture only, restored in finally.
    db.transaction(c => Sql.exec(c,"ALTER ROLE postgres SET statement_timeout='100ms'"))
    blocker.start()
    try {
      assert(acquired.await(5,TimeUnit.SECONDS))
      val started=System.nanoTime()
      assertEquals(intercept[DomainError](a.searchSessionMessages("a",out.sessionId,ContentView(1,None),"archive",None,1)).code,"deadline")
      assert((System.nanoTime()-started)/1000000<3000)
    } finally {
      release.countDown(); blocker.join(5000)
      db.transaction(c => Sql.exec(c,"ALTER ROLE postgres RESET statement_timeout"))
    }
  }}
}
