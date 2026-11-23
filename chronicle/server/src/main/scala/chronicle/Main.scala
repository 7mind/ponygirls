package chronicle
import cats.effect.{IO,IOApp,ExitCode}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import org.http4s.ember.server.EmberServerBuilder
import com.comcast.ip4s.{Host,Port}
import distage.*
import izumi.distage.model.definition.Lifecycle
import ponygirls.runtime.{DatabaseWait,StartFailure}
import scala.concurrent.duration.*

final class RuntimeServices(val database: Database,val http: Http,val worker: Worker,val archive: PostgresArchive,val logger: logstage.IzLogger)
object Main extends IOApp {
  def run(args: List[String]): IO[ExitCode] = unobserved.around(args match {
    case List("password-hash") => stage("password-hash",IO.blocking {
      val console=System.console()
      val chars=if(console!=null) console.readPassword() else { val line=scala.io.StdIn.readLine(); Check(line!=null,"invalid","password required on stdin"); line.toCharArray }
      Check(chars!=null && chars.nonEmpty && chars.length<=1024,"invalid","password required on stdin")
      try println(Password.hash(chars)) finally java.util.Arrays.fill(chars,'\u0000')
    }).as(ExitCode.Success)
    case List("migrate",path) =>
      stage("config",IO.blocking(Config.load(path))).flatMap { config =>
        awaitDatabase(config) *> cats.effect.Resource.make(stage("database",IO.blocking(new Database(config,IndexProfileCatalog.current(config)))))(db => IO.blocking(db.close()))
          .use(initialize)
      }.as(ExitCode.Success)
    case List(mode,path) if mode=="serve" || mode=="serve-standby" =>
      stage("config",IO.blocking { val config=Config.load(path); listener(config); config }).flatMap { config =>
        awaitDatabase(config) *> stage("wiring",ModelHttp.client(config).use { client =>
          // Explicit graph registration: no classpath scanning in native images.
          val lifecycle = ChronicleInjector().produceGet[RuntimeServices](new ModuleDef {
            include(_root_.chronicle.plugins.ChroniclePlugin)
            make[Config].fromValue(config)
            make[org.http4s.client.Client[IO]].fromValue(client)
          })
          lifecycle.use { services =>
            initialize(services.database) *> serve(config,services,mode=="serve")
          }
        })
      }.as(ExitCode.Success)
    case _ => IO.println("usage: chronicle-server serve CONFIG.json | serve-standby CONFIG.json (writable API, no background workers) | migrate CONFIG.json | password-hash (stdin)").as(ExitCode.Error)
  })(failure)
  private final case class StageFailure(stage: String,port: Option[Int],error: Throwable) extends RuntimeException(stage,error)
  /** Names the start step that failed; the innermost stage wins, a failure outside every stage is `start`. */
  private def stage[A](name: String,work: => IO[A],port: Option[Int] = None): IO[A] = IO.defer(work).adaptError {
    case error if !error.isInstanceOf[StageFailure] => StageFailure(name,port,error)
  }
  /** A refused start names its reason and remedy. Every `migration-required` and `config` detail in this server is fixed
    * text, code constants (table and index names, the operator's remedy) and database counts or sizes; any other detail
    * can carry a value, so only its code is printed. */
  private val known: StartFailure.Known = {
    case refused: DomainError if refused.code=="migration-required" || refused.code=="config" => (refused.code,refused.detail)
    case other: DomainError => (other.code,other.code)
  }
  private def failure(error: Throwable): IO[ExitCode] = {
    val (name,port,cause) = error match {
      case failed: StageFailure => (failed.stage,failed.port,failed.error)
      case other => ("start",None,other)
    }
    IO.blocking { unobserved.settle(Some(cause)); System.err.println(StartFailure.line("chronicle",name,StartFailure.classify(cause,known),port)) }.as(ExitCode.Error)
  }
  /** IOApp's default prints the stack trace of a failure no fiber observed; one sanitized `background` line instead. */
  private val unobserved = new StartFailure.Unobserved(error => System.err.println(StartFailure.line("chronicle","background",StartFailure.classify(error,known),None)))
  override protected def reportFailure(error: Throwable): IO[Unit] = IO.blocking(unobserved.report(error))
  private def initialize(database: Database): IO[Unit] = stage("migrate",IO.blocking(database.initialize()))
  /** Before the database runtime and the graph's background work exist. */
  private def awaitDatabase(config: Config): IO[Unit] =
    stage("database-wait",IO.interruptibleMany(DatabaseWait.await(config.jdbcConfig,config.databaseStartWait,line => System.err.println("chronicle " + line))))
  /** The listen address; the config stage validates it before anything starts. */
  private def listener(config: Config): (Host,Port) =
    (Host.fromString(config.listenHost).getOrElse(throw DomainError("config","invalid listenHost")),Port.fromInt(config.listenPort).getOrElse(throw DomainError("config","invalid port")))
  private[chronicle] def background(workersEnabled: Boolean,worker: => IO[Unit]): IO[Unit] =
    if(workersEnabled) worker else IO.never[Unit]
  private def reportAccounts(s: RuntimeServices,accounts: Option[AccountPlane]): IO[Unit] = accounts match {
    case None => IO.blocking(s.database.transaction(Database.activeImperativeAccounts)).flatMap { suspended =>
      IO(if(suspended>0) s.logger.warn(s"accounts.enabled is off: imperative accounts are suspended, their rows and tokens are kept; $suspended"))
    }
    case Some(plane) => IO.blocking(s.database.transaction(Database.imperativeAccountsSealedByAnotherKey(_,plane.access.settings.vault.keyId))).flatMap { sealedByAnotherKey =>
      IO(if(sealedByAnotherKey>0) s.logger.warn(s"imperative accounts whose TOTP secret another key sealed need an administrator reset; $sealedByAnotherKey"))
    }
  }
  private[chronicle] def serve(config: Config,s: RuntimeServices,workersEnabled: Boolean): IO[Nothing] = stage("accounts",s.http.accountPlane.use { accounts => for {
    _ <- reportAccounts(s,accounts)
    gate <- Semaphore[IO](2)
    (host,port) = listener(config)
    _ <- stage("bind",EmberServerBuilder.default[IO].withHost(host).withPort(port).withMaxConnections(128).withMaxHeaderSize(16384).withHttpWebSocketApp(ws => s.http.routes(ws,gate,accounts).orNotFound).build.use { server =>
      IO(unobserved.settle(None)) *> IO(s.logger.info(s"chronicle listening address=${server.address} workersEnabled=$workersEnabled")) *> stage("serve",background(workersEnabled,s.worker.run))
    },Some(config.listenPort))
    never <- IO.never[Nothing]
  } yield never })
}
