package chronicle
import cats.effect.{IO,IOApp,ExitCode}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.ember.client.EmberClientBuilder
import com.comcast.ip4s.{Host,Port}
import distage.*
import izumi.distage.model.definition.Lifecycle
import scala.concurrent.duration.*

final class RuntimeServices(val database: Database,val http: Http,val worker: Worker,val archive: PostgresArchive,val logger: logstage.IzLogger)
object Main extends IOApp {
  def run(args: List[String]): IO[ExitCode] = args match {
    case List("password-hash") => IO.blocking {
      val console=System.console()
      val chars=if(console!=null) console.readPassword() else { val line=scala.io.StdIn.readLine(); Check(line!=null,"invalid","password required on stdin"); line.toCharArray }
      Check(chars!=null && chars.nonEmpty && chars.length<=1024,"invalid","password required on stdin")
      try println(Password.hash(chars)) finally java.util.Arrays.fill(chars,'\u0000')
    }.as(ExitCode.Success)
    case List(command,path) if Set("serve","maintenance-reindex").contains(command) =>
      IO.blocking(Config.load(path)).flatMap { config =>
        EmberClientBuilder.default[IO].withTimeout(120.seconds).withMaxResponseHeaderSize(16384).build.use { client =>
          // Explicit graph registration: no classpath scanning in native images.
          val lifecycle = Injector().produceGet[RuntimeServices](new ModuleDef {
            include(_root_.chronicle.plugins.ChroniclePlugin)
            make[Config].fromValue(config)
            make[org.http4s.client.Client[IO]].fromValue(client)
          })
          lifecycle.toEffect[IO].use { services =>
            IO.blocking(services.database.initialize()) *> (if(command=="serve") serve(config,services) else maintenance(services))
          }
        }
      }.as(ExitCode.Success)
    case _ => IO.println("usage: chronicle-server serve CONFIG.json | maintenance-reindex CONFIG.json | password-hash (stdin)").as(ExitCode.Error)
  }
  private def serve(config: Config,s: RuntimeServices): IO[Nothing] = for {
    gate <- Semaphore[IO](2)
    _ <- EmberServerBuilder.default[IO].withHost(Host.fromString(config.listenHost).getOrElse(throw DomainError("config","invalid listenHost"))).withPort(Port.fromInt(config.listenPort).getOrElse(throw DomainError("config","invalid port"))).withMaxConnections(128).withMaxHeaderSize(16384).withHttpWebSocketApp(ws => s.http.routes(ws,gate).orNotFound).build.use { server =>
      IO(s.logger.info(s"chronicle listening address=${server.address}")) *> s.worker.run
    }
    never <- IO.never[Nothing]
  } yield never
  private def maintenance(s: RuntimeServices): IO[Unit] = IO.blocking(s.archive.beginMaintenance()) *> {
    def loop: IO[Unit] = IO.blocking(s.archive.finishMaintenance()).flatMap { done => if(done) IO.unit else s.worker.once.flatMap(found => if(found) IO.defer(loop) else IO.raiseError(DomainError("unavailable","maintenance incomplete; inspect failed jobs and retry before resuming"))) }
    loop
  }
}
