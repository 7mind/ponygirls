package manure

import cats.effect.{ExitCode,IO,IOApp,Resource}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import com.comcast.ip4s.{Host,Port}
import distage.*
import manure.plugins.{ManurePlugin,RuntimeServices}
import manure.storage.{ConfinedDirectory,ExistingFileAccess,PosixNative,RelativeName,RootLease}
import ponygirls.runtime.{CatsIOInjector,JdbcDatabase,Migration}
import ponygirls.retrieval.{EmbeddingClient,EmbeddingTelemetry}
import org.http4s.ember.server.EmberServerBuilder
import scala.concurrent.duration.*
import java.nio.file.Path
import scala.util.Using
import io.circe.Json

object Main extends IOApp:
  def run(args: List[String]): IO[ExitCode] = args match
    case List("serve",path) => runServer(Path.of(path)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case List("--config",path) => runServer(Path.of(path)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case _ => IO.println("usage: manure-server serve CONFIG.json | --config CONFIG.json").as(ExitCode.Error)
  private def safeFailure(error: Throwable): IO[ExitCode] =
    // No stack trace/cause/SQL/filesystem/config/credential output.
    IO(System.err.println("manure startup-or-runtime failure")).as(ExitCode.Error)
  private def schema: String =
    val input = getClass.getResourceAsStream("/manure-schema.sql")
    Require(input != null, "unavailable")
    Using.resource(scala.io.Source.fromInputStream(input,"UTF-8"))(_.mkString)
  private def embedding(config: Config): Resource[IO,Option[EmbeddingClient]] = config.embedding match
    case None => Resource.pure(None)
    case Some(settings) => EmbeddingClient.resource(settings.endpoint,settings.maxConcurrent,settings.maxQueued,EmbeddingTelemetry.noop).map(Some(_))
  /** Acquisition order is security-critical: physical root claim and service lease
    * precede JDBC/migrations/recovery/HTTP/workers. Release reverses that order,
    * awaiting uncancelable JDBC and streamed file cleanup before releasing claim.
    */
  def resources(config: Config): Resource[IO,RuntimeServices] = for
    bridge <- Resource.eval(IO.blocking(config.nativeMode match
      case "shared" => PosixNative.shared(config.posixLibrary.get)
      case "linked" => PosixNative.linked()
      case _ => throw DomainError("bad-envelope")))
    directory <- Resource.make(IO.blocking(ConfinedDirectory.open(config.dataDir,bridge)))(root => IO.blocking(root.close()))
    lease <- Resource.make(IO.blocking(directory.lease()))(lease => IO.blocking(lease.close()))
    database <- JdbcDatabase.resource(config.database)
    models <- embedding(config)
    gate <- Resource.eval(Semaphore[IO](1L))
    graph <- Resource.make(IO.pure(CatsIOInjector().produceGet[RuntimeServices](new ModuleDef {
      include(ManurePlugin)
      make[Config].fromValue(config)
      make[ConfinedDirectory].fromValue(directory)
      make[RootLease].fromValue(lease)
      make[JdbcDatabase].fromValue(database)
      make[Option[EmbeddingClient]].fromValue(models)
      make[Semaphore[IO]].fromValue(gate)
    })))(_ => IO.unit)
    // distage Lifecycle remains scoped inside the outer resource ownership graph.
    services <- Resource.make(graph.acquire)(graph.release).evalMap(inner => graph.extract(inner).fold(identity,IO.pure))
    _ <- Resource.eval(services.database.transaction { c =>
      // Offline import control state is NEVER cleared/adopted automatically.
      val imported = Jdbc.rows(c,"SELECT to_regclass('manure_offline.destination') IS NOT NULL")(_.getBoolean(1)).head
      if imported then
        val records = Jdbc.rows(c,"SELECT root,source,writes_started FROM manure_offline.destination") { r =>
          (r.getString(1),Option(r.getString(2)),r.getBoolean(3))
        }
        Require(records.size == 1 && records.head._1 == config.dataDir.toString && records.head._2.nonEmpty && records.head._3, "unavailable")
        Using.resource(directory.openExistingFile(RelativeName.parse("COMPLETE"),ExistingFileAccess.ReadOnly)) { marker =>
          Require(marker.size() <= 16384, "unavailable")
          val json = CurrentWire.parse(Exact.string(marker.read(0,16384)))
          Require(json.hcursor.get[String]("source").toOption == records.head._2, "unavailable")
        }
    })
    _ <- Resource.eval(IO.blocking(lease.validate()) *> database.migrate("manure",List(Migration(1,"metadata-byte-exact",schema))))
    _ <- Resource.eval(services.database.transaction(services.projection.initialize))
    _ <- Resource.eval(services.artifacts.initialize())
    _ <- Resource.eval(backfill(services))
  yield services
  private def backfill(services: RuntimeServices): IO[Unit] =
    def loop(after: Option[String]): IO[Unit] = services.database.transaction { c =>
      val tx = new PostgresTxn(c,services.projection)
      val batch = tx.artifacts(after,1000)
      batch.foreach(a => services.projection.put(c,a))
      batch.lastOption.map(_.id).filter(_ => batch.size == 1000)
    }.flatMap {
      case Some(next) => loop(Some(next))
      case None => IO.unit
    }
    loop(None)
  def runServer(path: Path): IO[Unit] = IO.blocking(Config.load(path)).flatMap { config => resources(config).use { services =>
    val sweeper = (IO.sleep(config.sweepInterval) *> services.artifacts.sweep().void.handleErrorWith(_ => IO.unit)).foreverM
    val poll = config.embedding.map(_.pollInterval).getOrElse(1.second)
    val indexer = (services.worker.once().handleErrorWith(_ => IO.pure(false)).flatMap(worked => if worked then IO.cede else IO.sleep(poll))).foreverM
    EmberServerBuilder.default[IO]
      .withHost(Host.fromString(config.listenAddress).getOrElse(throw DomainError("bad-envelope")))
      .withPort(Port.fromInt(config.port).getOrElse(throw DomainError("bad-envelope")))
      .withMaxConnections(config.maxConnections).withMaxHeaderSize(16384)
      .withShutdownTimeout(config.requestTimeout+5.seconds)
      .withHttpApp(services.http.app).build.use { server =>
        val port = server.address.getPort
        val effective = if config.port == 0 then
          val uri = java.net.URI.create(config.apiOrigin.value)
          config.apiOrigin.scheme + "://" + uri.getHost + ":" + port
        else config.apiOrigin.value
        IO(services.http.setBoundPort(port)) *>
          IO.println("MANURE_READY " + Json.obj("apiOrigin" -> Json.fromString(effective),"port" -> Json.fromInt(port),"pid" -> Json.fromLong(ProcessHandle.current().pid())).noSpaces) *>
          (sweeper,indexer).parTupled.void
      }
  }}
