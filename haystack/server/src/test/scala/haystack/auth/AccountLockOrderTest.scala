package haystack.auth

import cats.effect.IO
import cats.syntax.all.*
import haystack.storage.{ContractSuite,Migrations,TestSupport}
import ponygirls.runtime.{JdbcDatabase,JdbcFailure}
import java.util.concurrent.{CountDownLatch,TimeUnit}
import scala.concurrent.duration.*

/** Exact PostgreSQL lock-order regression: the insert trigger is a controlled
  * barrier after owner-lock acquisition and before session insertion. */
class AccountLockOrderTest extends ContractSuite {
  import AuthFixtures.*
  private val GateLock=848975299L
  private def waitFor(database:JdbcDatabase,condition:String):IO[Unit]={
    def poll(remaining:Int):IO[Unit]=database.transaction { c=>
      val s=c.createStatement()
      try {val rows=s.executeQuery(condition);try {rows.next();rows.getBoolean(1)}finally rows.close()}finally s.close()
    }.flatMap { ready=>
      if(ready)IO.unit
      else if(remaining==0)IO.raiseError(new IllegalStateException("expected owned PostgreSQL lock barrier"))
      else IO.sleep(10.millis) *> poll(remaining-1)
    }
    poll(200)
  }
  test("cross-owner password login replacement and sorted directory reconciliation cannot deadlock") { directory { dir=>
    val cfg=passwordConfig(dir)
    val users=cfg.users :+ UserConfig("bob","human","Bob",Vector.empty,Some("bob"),cfg.users.head.passwordHashFile,true)
    val auth=Auth.load(cfg.copy(users=users))
    // Reconciliation is change-driven: only a changed directory takes the directory and owner locks.
    val changed=Auth.load(cfg.copy(users=users.map(user=>if(user.id=="bot")user.copy(enabled=false)else user)))
    val gateHeld=new CountDownLatch(1);val release=new CountDownLatch(1)
    run(TestSupport.emptyDatabase.use { db=>for{
      _<-Migrations.initialize(db,TestSupport.Activity)
      accounts=new AccountService(db,()=>auth,imperative)
      _<-accounts.install(auth)
      old<-accounts.login("alice",AlicePassword,None)
      _<-db.transaction { c=>
        val statement=c.createStatement()
        try {
          statement.execute(s"CREATE FUNCTION account_insert_barrier() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN PERFORM pg_advisory_xact_lock($GateLock); RETURN NEW; END $$$$")
          statement.execute("CREATE TRIGGER account_insert_barrier BEFORE INSERT ON ponygirls_account_sessions FOR EACH ROW EXECUTE FUNCTION account_insert_barrier()")
        }finally statement.close()
      }
      holder<-db.transaction { c=>
        val statement=c.createStatement()
        try statement.execute(s"SELECT pg_advisory_xact_lock($GateLock)")finally statement.close()
        gateHeld.countDown()
        if(!release.await(10,TimeUnit.SECONDS))throw new IllegalStateException("owned test gate release deadline")
      }.start
      _<-IO.blocking(assert(gateHeld.await(2,TimeUnit.SECONDS)))
      login<-accounts.login("bob",AlicePassword,Some(old.session.secret)).attempt.start
      _<-waitFor(db,s"SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND classid=0 AND objid=$GateLock)")
      reconcile<-accounts.install(changed).attempt.start
      // Blocked on an owner lock that the waiting login holds, not merely on the directory lock or the gate.
      _<-waitFor(db,s"""SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objsubid=1 AND
        ((classid::bigint<<32)|objid::bigint) IN (hashtextextended('ponygirls-account:alice',71393723),hashtextextended('ponygirls-account:bob',71393723)))""")
      _<-IO(release.countDown())
      outcomes<-(login.joinWithNever,reconcile.joinWithNever).tupled.timeout(8.seconds)
      _<-holder.joinWithNever
      errors=Vector(outcomes._1.left.toOption,outcomes._2.left.toOption).flatten
      states=errors.collect { case e:JdbcFailure=>e.sqlState.getOrElse(e.code) }
      _=assertEquals(errors.size,0,"valid operations must both succeed; SQL states="+states.mkString(","))
    }yield()}.guarantee(IO(release.countDown())))
  }}
}
