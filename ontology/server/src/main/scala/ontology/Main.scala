package ontology

import cats.effect.{ExitCode, IO, IOApp}
import cats.syntax.all.*
import java.nio.file.Path
import java.security.SecureRandom
import java.time.Clock
import java.util.UUID
import logstage.IzLogger
import ponygirls.runtime.{CatsIOInjector, JdbcDatabase}

object Main extends IOApp {
  private val Usage = "usage: ontology-server check-config CONFIG.json | migrate CONFIG.json | serve CONFIG.json"
  private def environment: IO[RuntimeEnvironment] = IO.blocking(RuntimeEnvironment(Clock.systemUTC(), new RuntimeIds(() => UUID.randomUUID()),
    new FileCredentialDigests, new RandomSessionSecrets(new SecureRandom), IzLogger()))
  def run(args: List[String]): IO[ExitCode] = execute(args, environment, value => IO.println(value))
  private[ontology] def execute(args: List[String], environment: IO[RuntimeEnvironment], output: String => IO[Unit]): IO[ExitCode] = {
    def load(path: String): IO[Config] = IO.blocking(Config.load(Path.of(path)))
    val command = args match {
      case List("check-config", path) => load(path).as(ExitCode.Success)
      case List("migrate", path) => load(path).flatMap { config =>
        JdbcDatabase.resource(config.database).use(database => CatsIOInjector().produceGet[PostgresGraphRepository](new RepositoryModule(config, database)).use(_.initialize))
      }.as(ExitCode.Success)
      case List("serve", path) => load(path).flatMap { config => environment.flatMap { supplied =>
        RuntimeInputs.resource(config, supplied).use { inputs =>
          CatsIOInjector().produceGet[RuntimeApplication](new RuntimeModule(inputs)).use(_.run).flatMap { result =>
            IO(supplied.logger.warn(s"ontology runtime stopped reason=${result.reason} stopped=${result.stopped}")).as(ExitCode.Error)
          }
        }
      } }
      case _ => output(Usage).as(ExitCode.Error)
    }
    command.handleErrorWith(error => output(CommandFailure.render(error)).as(ExitCode.Error))
  }
}
