package haystack.auth

import cats.effect.IO
import haystack.application.ItemService
import haystack.http.{Http,LiveHub}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import java.lang.reflect.{InvocationHandler,InvocationTargetException,Method as JavaMethod,Proxy}
import java.sql.{Connection,Driver,DriverManager,Statement}
import java.time.{Clock,Instant,ZoneOffset}
import java.util.Properties
import java.util.concurrent.ConcurrentLinkedQueue
import org.http4s.{Header,Method,Request,Status,Uri}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.auth.{PasswordHasher,Secrets,Totp}
import ponygirls.retrieval.postgres.PostgresRetrieval
import scala.jdk.CollectionConverters.*

/** Communication through the production routes and an owned PostgreSQL: the statements one authenticated request makes
  * on the shared account tables. A JDBC driver registered ahead of PostgreSQL's for the test opens the pool's
  * PostgreSQL connections and records the SQL of every statement they prepare or execute. */
class HttpAccountReadsTest extends ContractSuite {
  import AuthFixtures.*
  private val Now=Instant.parse("2026-11-27T12:00:00Z")
  private val TotpSecret="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  private val Host="Host"->"ts.test:8445"

  /** Records the SQL text of every statement of the connections it opens. */
  private final class StatementRecorder extends Driver {
    private val postgres=new org.postgresql.Driver
    val statements=new ConcurrentLinkedQueue[String]
    private def forwarded(target:AnyRef,method:JavaMethod,args:Array[AnyRef]):AnyRef=
      try method.invoke(target,(if(args==null)Array.empty[AnyRef] else args)*) catch { case failure:InvocationTargetException=>throw failure.getCause }
    private def proxy[A](kind:Class[A],handler:InvocationHandler):A=kind.cast(Proxy.newProxyInstance(getClass.getClassLoader,Array[Class[?]](kind),handler))
    private def recorded(statement:Statement):Statement=proxy(classOf[Statement],(_,method,args)=>{
      if(Set("execute","executeQuery","executeUpdate","executeLargeUpdate","addBatch")(method.getName) && args!=null && args.nonEmpty)
        args(0) match { case sql:String=>statements.add(sql); case _=>() }
      forwarded(statement,method,args)
    })
    private def recorded(connection:Connection):Connection=proxy(classOf[Connection],(_,method,args)=>{
      if(Set("prepareStatement","prepareCall")(method.getName)) statements.add(args(0).asInstanceOf[String])
      forwarded(connection,method,args) match {
        case statement:Statement if method.getName=="createStatement"=>recorded(statement)
        case other=>other
      }
    })
    def connect(url:String,info:Properties):Connection=Option(postgres.connect(url,info)).map(recorded).orNull
    def acceptsURL(url:String):Boolean=postgres.acceptsURL(url)
    def getPropertyInfo(url:String,info:Properties):Array[java.sql.DriverPropertyInfo]=postgres.getPropertyInfo(url,info)
    def getMajorVersion:Int=postgres.getMajorVersion
    def getMinorVersion:Int=postgres.getMinorVersion
    def jdbcCompliant:Boolean=postgres.jdbcCompliant
    def getParentLogger:java.util.logging.Logger=postgres.getParentLogger
  }
  /** The recorder ahead of the registered PostgreSQL driver for `body`, then unregistered. */
  private def recording[A](body:StatementRecorder=>A):A={
    val recorder=new StatementRecorder
    val registered=DriverManager.getDrivers.asScala.toVector.filter(_.isInstanceOf[org.postgresql.Driver])
    registered.foreach(DriverManager.deregisterDriver)
    DriverManager.registerDriver(recorder)
    registered.foreach(DriverManager.registerDriver)
    try body(recorder) finally DriverManager.deregisterDriver(recorder)
  }

  test("an imperative user's browser session costs the reads of its credential lookup and no more") { directory { dir=>
    val base=passwordConfig(dir)
    val auth=Auth.load(base.copy(users=base.users.updated(0,base.users.head.copy(admin=true)),accounts=Some(AccountsConfig(true,
      Some(write(dir,"accounts.key",Secrets.generate())),SignupConfig(true,false,100),EnrollmentConfig(false,86400),Some("Haystack test"),Vector.empty))))
    val code=Totp.code(Totp.decodeSecret(TotpSecret).get,Totp.stepAt(Now))
    recording { recorder=>
      run(TestSupport.emptyDatabase.use { db=>ImperativeRuntime.resource(Clock.fixed(Now,ZoneOffset.UTC),PasswordHasher.Pbkdf2).use { runtime=>for{
        _<-Migrations.initialize(db,TestSupport.Activity)
        accounts=new AccountService(db,()=>auth,runtime)
        _<-accounts.install(auth)
        hub<-LiveHub.create
        retrieval=new HaystackRetrieval(db,ProjectionPolicy("reads-test",true,Vector.empty,4096),new PostgresRetrieval("reads-test",None),None,4)
        http=new Http(()=>auth,new ItemService(new PostgresItemRepository(db),(_,_)=>IO.unit),hub,None,retrieval,accounts)
        ws<-WebSocketBuilder2[IO]
        signup=Request[IO](Method.POST,Uri.unsafeFromString("/api/account/v1/signup")).withEntity(
          s"""{"username":"carol","email":"carol@example.test","password":"synthetic imperative password","totpSecret":"$TotpSecret","totpCode":"$code","requireTotp":false}""")
          .putHeaders(Header.Raw(CIString(Host._1),Host._2),Header.Raw(CIString("Origin"),Secure),Header.Raw(CIString("Content-Type"),"application/json"))
        signedUp<-http.routes(ws).orNotFound(signup)
        _=assertEquals(signedUp.status,Status.Ok)
        session=signedUp.headers.get(CIString("Set-Cookie")).map(_.head.value).getOrElse(fail("session cookie expected")).takeWhile(_!=';').dropWhile(_!='=').drop(1)
        _=recorder.statements.clear()
        whoami<-http.routes(ws).orNotFound(Request[IO](Method.GET,Uri.unsafeFromString("/api/v1/whoami"))
          .putHeaders(Header.Raw(CIString(Host._1),Host._2),Header.Raw(CIString("Cookie"),"__Host-haystack="+session)))
        _<-whoami.body.compile.drain
        _=assertEquals(whoami.status,Status.Ok)
        statements=recorder.statements.asScala.toVector.map(_.trim.replaceAll("\\s+"," ")).filter(_.contains("ponygirls_"))
      }yield assertEquals(statements,Vector(
        // The merged directory: the imperative accounts (the master switch is on).
        "SELECT * FROM ponygirls_imperative_users ORDER BY id",
        // The browser session by the digest of its secret. Nothing else, the administrator flag Haystack does not use included.
        "SELECT * FROM ponygirls_account_sessions WHERE digest=?"))
      }})
    }
  }}
}
