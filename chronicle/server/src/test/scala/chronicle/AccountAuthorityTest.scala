package chronicle

import cats.effect.{IO,Resource,Deferred}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import chronicle.api.*
import java.sql.{Connection,DriverManager,PreparedStatement,ResultSet}
import java.util.UUID
import java.util.concurrent.{CountDownLatch,TimeUnit}
import java.util.concurrent.atomic.{AtomicBoolean,AtomicInteger}
import ponygirls.runtime.{BlockingJdbcDatabase,JdbcConnectionFactory}
import scala.concurrent.duration.*

class AccountAuthorityTest extends munit.FunSuite {
  override val munitTimeout=90.seconds
  private def config: IO[Config] = IO {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    Fixtures.config()
  }
  private def database(config: Config): Resource[IO,Database] = Resource.make(IO.blocking {
    val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize(); db
  })(db => IO.blocking(db.close()))

  test("BG GoodCommunication specified: stale WS Logout cannot revoke a reassigned session or store a success receipt") {
    (for {
      c <- Resource.eval(config)
      db <- database(c)
    } yield (c,db)).use { case (c,db) => IO.blocking {
      val auth=new Auth(db,c)
      val secret=auth.login(LoginRequest("a","synthetic"))._2
      val owner=auth.browser(secret)
      db.transaction(x => Sql.exec(x,"UPDATE ch_sessions SET owner='b' WHERE hash=?",Wire.hash(secret)))
      val request=ClientEnvelope(UUID.randomUUID(),Operation.Logout())
      assertEquals(intercept[DomainError](auth.mutate(owner,request)).code,"unauthorized")
      assertEquals(auth.browser(secret).user.id,"b")
      assertEquals(db.transaction(x => Sql.one(x,"SELECT count(*) FROM ch_mutations WHERE owner='a' AND request_id=?",request.requestId)(_.getInt(1)).get),0)
    }}.unsafeRunSync()
  }

  test("BG GoodCommunication specified: password format validation preserves credential normalization and rolls back invalid configuration") {
    (for {
      c <- Resource.eval(config)
      db <- database(c)
    } yield (c,db)).use { case (c,db) => IO.blocking {
      val auth=new Auth(db,c)
      val secret=auth.login(LoginRequest("a","synthetic"))._2
      val original=Config.credential(c.users.find(_.id=="a").get.passwordHashFile)
      val file=java.nio.file.Files.createTempFile("chronicle-invalid-password-",".hash")
      val changed=c.copy(users=c.users.map(u => if(u.id=="a") u.copy(passwordHashFile=file.toString) else u))
      val reload=new Database(changed,db.profiles)
      try {
        java.nio.file.Files.writeString(file,"not-a-password-hash")
        assertEquals(intercept[DomainError](reload.initialize()).code,"config")
        assertEquals(auth.browser(secret).user.id,"a")
        assertEquals(db.transaction(x => Sql.one(x,"SELECT credential FROM ch_users WHERE id='a'")(_.getString(1)).get),original)
        java.nio.file.Files.writeString(file,original+"\r\n")
        reload.initialize()
        assertEquals(auth.browser(secret).user.id,"a")
      } finally { reload.close(); java.nio.file.Files.deleteIfExists(file) }
    }}.unsafeRunSync()
  }

  private final case class LookupPause(entered: CountDownLatch,release: CountDownLatch,pid: AtomicInteger,armed: AtomicBoolean) {
    private def invoke(target: Object,method: java.lang.reflect.Method,args: Array[Object]): Object =
      try method.invoke(target,args*) catch { case e: java.lang.reflect.InvocationTargetException => throw e.getCause }
    def connection(underlying: Connection): Connection = java.lang.reflect.Proxy.newProxyInstance(classOf[Connection].getClassLoader,Array(classOf[Connection]),(_,method,args) => {
      val arguments=if(args==null) Array.empty[Object] else args
      val result=invoke(underlying,method,arguments)
      if(method.getName=="prepareStatement" && arguments(0).asInstanceOf[String].startsWith("SELECT id,credential FROM ch_users")) {
        val statement=result.asInstanceOf[PreparedStatement]
        java.lang.reflect.Proxy.newProxyInstance(classOf[PreparedStatement].getClassLoader,Array(classOf[PreparedStatement]),(_,statementMethod,statementArgs) => {
          val values=if(statementArgs==null) Array.empty[Object] else statementArgs
          val selected=invoke(statement,statementMethod,values)
          if(statementMethod.getName=="executeQuery") {
            val rows=selected.asInstanceOf[ResultSet]
            java.lang.reflect.Proxy.newProxyInstance(classOf[ResultSet].getClassLoader,Array(classOf[ResultSet]),(_,rowMethod,rowArgs) => {
              val rowValues=if(rowArgs==null) Array.empty[Object] else rowArgs
              val value=invoke(rows,rowMethod,rowValues)
              if(rowMethod.getName=="close" && armed.getAndSet(false)) {
                pid.set(Sql.one(underlying,"SELECT pg_backend_pid()")(_.getInt(1)).get)
                entered.countDown()
                Check(release.await(15,TimeUnit.SECONDS),"test","login lookup barrier release timed out")
              }
              value
            }).asInstanceOf[ResultSet]
          } else selected
        }).asInstanceOf[PreparedStatement]
      } else result
    }).asInstanceOf[Connection]
  }

  List("legacy","account").foreach { endpoint => List("disabled","removed","password").foreach { change =>
    test(s"BG GoodCommunication specified: $endpoint login cannot survive $change reconciliation between credential lookup and session insertion") {
      (for {
        original <- Resource.eval(config)
        pause=LookupPause(new CountDownLatch(1),new CountDownLatch(1),new AtomicInteger(0),new AtomicBoolean(true))
        runtime=BlockingJdbcDatabase.withConnectionFactory(original.jdbcConfig,new JdbcConnectionFactory {
          def open(url: String,properties: java.util.Properties): Connection=pause.connection(DriverManager.getConnection(url,properties))
        })
        db <- Resource.make(IO.blocking { val db=Database.withRuntime(original,IndexProfileCatalog.current(original),runtime); db.initialize(); db })(db => IO.blocking(db.close()))
      } yield (original,pause,db)).use { case (original,pause,db) =>
        val auth=new Auth(db,original)
        val login=IO.blocking(if(endpoint=="legacy") auth.login(LoginRequest("a","synthetic"))._2 else auth.accountLogin("a","synthetic")._2)
        Resource.make(login.start)(fiber => IO(pause.release.countDown()) *> fiber.cancel).use { loginFiber => for {
          _ <- IO.blocking(assert(pause.entered.await(5,TimeUnit.SECONDS),"login must reach the post-lookup barrier"))
          changed <- IO.blocking {
            change match {
              case "disabled" => original.copy(users=original.users.map(u => if(u.id=="a") u.copy(enabled=false) else u))
              case "removed" => original.copy(users=original.users.filterNot(_.id=="a"))
              case "password" =>
                val file=java.nio.file.Files.createTempFile("chronicle-login-password-",".hash")
                java.nio.file.Files.writeString(file,Password.hash("different synthetic".toCharArray))
                original.copy(users=original.users.map(u => if(u.id=="a") u.copy(passwordHashFile=file.toString) else u))
            }
          }
          done <- Deferred[IO,Unit]
          _ <- database(changed).use { _ => done.complete(()).void }.start.bracket { reconciliation => for {
            _ <- IO.race(done.get,McpTestFixtures.await(IO.blocking(db.transaction(c => Sql.one(c,"SELECT count(*) FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid))",pause.pid.get())(_.getInt(1)).get)))(_>=1)).timeout(10.seconds)
            _ <- IO(pause.release.countDown())
            secret <- loginFiber.joinWithNever
            _ <- reconciliation.joinWithNever
            _ <- if(change=="password") IO.unit else IO.blocking(db.initialize())
            _ <- IO.blocking(assertEquals(intercept[DomainError](auth.browser(secret)).code,"unauthorized"))
          } yield () }(fiber => IO(pause.release.countDown()) *> fiber.cancel)
        } yield () }
      }.unsafeRunSync()
    }
  } }
}
