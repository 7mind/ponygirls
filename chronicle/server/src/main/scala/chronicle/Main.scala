package chronicle
import cats.effect.{IO,IOApp,ExitCode}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import org.http4s.ember.server.EmberServerBuilder
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
    case List("serve",path) =>
      IO.blocking(Config.load(path)).flatMap { config =>
        ModelHttp.client(config).use { client =>
          // Explicit graph registration: no classpath scanning in native images.
          val lifecycle = ChronicleInjector().produceGet[RuntimeServices](new ModuleDef {
            include(_root_.chronicle.plugins.ChroniclePlugin)
            make[Config].fromValue(config)
            make[org.http4s.client.Client[IO]].fromValue(client)
          })
          lifecycle.use { services =>
            IO.blocking(services.database.initialize()) *> serve(config,services)
          }
        }
      }.as(ExitCode.Success)
    case _ => IO.println("usage: chronicle-server serve CONFIG.json | password-hash (stdin)").as(ExitCode.Error)
  }
  private def serve(config: Config,s: RuntimeServices): IO[Nothing] = for {
    gate <- Semaphore[IO](2)
    _ <- EmberServerBuilder.default[IO].withHost(Host.fromString(config.listenHost).getOrElse(throw DomainError("config","invalid listenHost"))).withPort(Port.fromInt(config.listenPort).getOrElse(throw DomainError("config","invalid port"))).withMaxConnections(128).withMaxHeaderSize(16384).withHttpWebSocketApp(ws => s.http.routes(ws,gate).orNotFound).build.use { server =>
      IO(s.logger.info(s"chronicle listening address=${server.address}")) *> s.worker.run
    }
    never <- IO.never[Nothing]
  } yield never
}
