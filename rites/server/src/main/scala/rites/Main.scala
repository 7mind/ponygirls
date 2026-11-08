package rites

import cats.effect.{ExitCode, IO, IOApp}
import cats.syntax.all.*
import cats.effect.std.Semaphore
import com.comcast.ip4s.{Host, Port}
import distage.ModuleDef
import org.http4s.ember.server.EmberServerBuilder
import ponygirls.runtime.CatsIOInjector

object Main extends IOApp {
  def run(args: List[String]): IO[ExitCode] = args match {
    case List("password-hash") => IO.blocking {
      val console = System.console()
      val chars = if (console != null) console.readPassword() else { val line = scala.io.StdIn.readLine(); Check(line != null, "invalid", "password required on stdin"); line.toCharArray }
      try println(Password.hash(chars)) finally java.util.Arrays.fill(chars, '\u0000')
    }.as(ExitCode.Success)
    case List("check-config", path) => IO.blocking(Config.load(path)).as(ExitCode.Success)
    case List("migrate", path) => withStore(path, _.initialize()).as(ExitCode.Success)
    case List("serve", path) => serve(path).as(ExitCode.Success)
    case _ => IO.println("usage: rites-server serve CONFIG.json | migrate CONFIG.json | check-config CONFIG.json | password-hash").as(ExitCode.Error)
  }
  private def withStore[A](path: String, use: RitesStore => A): IO[A] = for {
    config <- IO.blocking(Config.load(path))
    result <- cats.effect.Resource.make(IO.blocking(new PostgresStore(config)))(store => IO.blocking(store.close())).use(store => IO.blocking(use(store)))
  } yield result
  private def serve(path: String): IO[Unit] = for {
    source <- IO.blocking(Config.load(path))
    config = if (source.webRoot.isEmpty) source.copy(webRoot = sys.env.get("RITES_WEB_ROOT")) else source
    models = RuntimeModels(config.loadModels())
    lifecycle = CatsIOInjector().produceGet[plugins.RuntimeServices](new ModuleDef {
      include(plugins.RitesPlugin)
      make[Config].fromValue(config)
      make[RuntimeModels].fromValue(models)
    })
    _ <- lifecycle.use { services =>
      IO.blocking(services.store.initialize()) *> services.scheduler.initialize() *> Semaphore[IO](2).flatMap { loginGate =>
        EmberServerBuilder.default[IO].withHost(Host.fromString(config.listenHost).getOrElse(throw DomainError("config", "invalid listenHost")))
          .withPort(Port.fromInt(config.listenPort).getOrElse(throw DomainError("config", "invalid port"))).withMaxConnections(128).withMaxHeaderSize(16384)
          .withHttpApp(services.http.routes(loginGate).orNotFound).build.use { server =>
            import cats.syntax.all.*
            IO(services.logger.info(s"rites listening address=${server.address}")) *> services.scheduler.run
          }
      }
    }
  } yield ()
}
