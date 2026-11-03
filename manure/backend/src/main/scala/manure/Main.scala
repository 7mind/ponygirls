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
import java.nio.file.{Path,NoSuchFileException}
import scala.util.Using
import io.circe.Json

object Main extends IOApp:
  def run(args: List[String]): IO[ExitCode] = args match
    case List("serve",path) => runServer(Path.of(path)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case List("check-config",path) => IO.blocking(Config.load(Path.of(path))).flatMap(_ => IO.println("MANURE_CONFIG_OK")).as(ExitCode.Success).handleErrorWith(safeFailure)
    case List("migrate",path) => IO.blocking(Config.load(Path.of(path))).flatMap(config => buildResources(config,false).use(_ => IO.unit)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case List("--config",path) => runServer(Path.of(path)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case _ => IO.println("usage: manure-server serve CONFIG.json | migrate CONFIG.json | check-config CONFIG.json | --config CONFIG.json").as(ExitCode.Error)
  private final case class StartupFailure(stage: String,code: String) extends RuntimeException(code)
  private def safeCode(error: Throwable): String = error match
    case s: StartupFailure => s.code
    case d: DomainError if d.code.matches("[a-z][a-z-]{0,63}") => d.code
    case r: ponygirls.runtime.RuntimeFailure if r.code.matches("[a-z][a-z-]{0,63}") => r.code
    case j: ponygirls.runtime.JdbcFailure => "jdbc-" + j.sqlState.getOrElse("unknown")
    case n: manure.storage.NativeFailure => "posix-" + n.errno()
    case _: java.nio.file.FileSystemException => "filesystem"
    case _: java.io.IOException => "io"
    case e if e.getClass.getName.startsWith("izumi.") => "wiring"
    case _: IllegalArgumentException => "configuration"
    case _ => "internal"
  private def stage[A](name: String,work: IO[A]): IO[A] = work.handleErrorWith(error => IO.raiseError(StartupFailure(name,safeCode(error))))
  private def safeFailure(error: Throwable): IO[ExitCode] =
    val label = error match
      case s: StartupFailure => s.stage
      case _ => "serve"
    // Enumerated stage/category ONLY. No stack/cause/SQL/path/provider detail.
    IO(System.err.println("manure failure stage=" + label + " code=" + safeCode(error))).as(ExitCode.Error)
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
  def resources(config: Config): Resource[IO,RuntimeServices] = buildResources(config,true)
  private def buildResources(config: Config,recover: Boolean): Resource[IO,RuntimeServices] = for
    bridge <- Resource.eval(IO.blocking(config.nativeMode match
      case "shared" => PosixNative.shared(config.posixLibrary.get)
      case "linked" => PosixNative.linked()
      case _ => throw DomainError("bad-envelope")))
    directory <- Resource.make(IO.blocking(ConfinedDirectory.open(config.dataDir,bridge)))(root => IO.blocking(root.close()))
    lease <- Resource.make(IO.blocking(directory.lease()))(lease => IO.blocking(lease.close()))
    control <- config.migrationReceiptDir.traverse { path =>
      Resource.make(IO.blocking(ConfinedDirectory.open(path,bridge)))(r => IO.blocking(r.close())).flatMap { r =>
        Resource.make(IO.blocking(r.lease()))(l => IO.blocking(l.close())).as(r)
      }
    }
    _ <- Resource.eval(IO.blocking {
      if recover then
        val legacy = try
          Using.resource(directory.openExistingFile(RelativeName.parse("manure.db"),ExistingFileAccess.ReadOnly))(_ => true)
        catch case _: NoSuchFileException => false
        Require(!legacy, "migration-required")
    })
    database <- JdbcDatabase.resource(config.database)
    models <- if recover then embedding(config) else Resource.pure[IO,Option[EmbeddingClient]](None)
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
    services <- Resource.make(stage("wiring",graph.acquire))(graph.release).evalMap(inner => stage("wiring",graph.extract(inner).fold(identity,IO.pure)))
    observation <- Resource.eval(services.database.transaction { c =>
      // Read-only observation: no root-owner adoption or artifact mutation may
      // precede complete imported payload verification.
      val imported = Jdbc.rows(c,"SELECT to_regclass('manure_offline.destination') IS NOT NULL")(_.getBoolean(1)).head
      val record = if imported then
        val records = Jdbc.rows(c,"SELECT id,root,source,writes_started FROM manure_offline.destination") { r =>
          ImportedDestination(r.getString(1),r.getString(2),Option(r.getString(3)).getOrElse(""),r.getBoolean(4))
        }
        Require(records.size == 1,"migration-required");Some(records.head)
      else None
      val bound = if Jdbc.rows(c,"SELECT to_regclass('manure.root_owner') IS NOT NULL")(_.getBoolean(1)).head then
        val bindings=Jdbc.rows(c,"SELECT identity FROM manure.root_owner WHERE singleton")(_.getBytes(1))
        Require(bindings.size <= 1,"migration-required");bindings.headOption
      else None
      val hasArtifacts=Jdbc.rows(c,"SELECT to_regclass('manure.artifacts') IS NOT NULL")(_.getBoolean(1)).head
      val empty = !hasArtifacts || Jdbc.rows(c,"SELECT NOT EXISTS(SELECT 1 FROM manure.artifacts)")(_.getBoolean(1)).head
      (record,bound,empty)
    })
    _ <- Resource.eval(IO.blocking {
      observation._2.foreach(expected => Require(java.util.Arrays.equals(expected,ImportReceipt.rootBytes(directory)),"migration-required"))
      observation._1 match
        case Some(record) if recover || record.source.nonEmpty =>
          ImportReceipt.validate(config,directory,control.getOrElse(throw DomainError("migration-required")),record,observation._2.isEmpty,recover)
        case _ => ()
      if recover then
        observation._1 match
          case None if observation._3 =>
            val unexpected=Vector("staging","live").exists { name =>
              try directory.tree(RelativeName.parse(name),config.limits.cleanupEntries,68).nonEmpty
              catch case _: NoSuchFileException => false
            }
            Require(!unexpected,"migration-required")
          case _ => ()
    })
    _ <- Resource.eval(stage("schema",IO.blocking(lease.validate()) *> database.migrate("manure",List(Migration(1,"metadata-byte-exact",schema),Migration(2,"physical-root-binding","CREATE TABLE IF NOT EXISTS manure.root_owner(singleton boolean PRIMARY KEY CHECK(singleton),identity bytea NOT NULL)"),CatalogueProjection.migration))))
    _ <- Resource.eval(services.database.transaction { c =>
      if recover then
        // File/hash validation above ran without an open DB transaction. Both
        // physical claims remain held; check root identities again before the
        // FIRST insert. migrate is schema-only and NEVER adopts a payload root.
        val bytes=ImportReceipt.rootBytes(directory)
        control.foreach(_.physicalIdentity)
        Jdbc.exec(c,"INSERT INTO manure.root_owner(singleton,identity) VALUES(true,?) ON CONFLICT DO NOTHING",bytes)
        Require(Jdbc.rows(c,"SELECT identity FROM manure.root_owner WHERE singleton")(_.getBytes(1)).headOption.exists(java.util.Arrays.equals(_,bytes)), "migration-required")
      services.projection.initialize(c)
    })
    _ <- Resource.eval(stage("reconcile",if recover then services.artifacts.initialize() else IO.unit))
    _ <- Resource.eval(stage("projection",if recover then backfill(services) else IO.unit))
  yield services
  private def backfill(services: RuntimeServices): IO[Unit] =
    def loop(after: Option[String]): IO[Unit] = services.database.transaction { c =>
      val tx = new PostgresTxn(c,services.projection)
      val batch = tx.artifacts(after,1000)
      batch.foreach { a =>
        CatalogueProjection.backfill(c,a)
        services.projection.put(c,a)
      }
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
    // Count admitted requests THROUGH response-stream finalization using the
    // standard http4s cancellation-safe middleware, not just response creation.
    // One additional transport slot is reserved for immediate bounded rejection.
    org.http4s.server.middleware.MaxActiveRequests.httpApp[IO](config.maxConnections.toLong,services.http.overloaded).flatMap { admission =>
    EmberServerBuilder.default[IO]
      .withHost(Host.fromString(config.listenAddress).getOrElse(throw DomainError("bad-envelope")))
      .withPort(Port.fromInt(config.port).getOrElse(throw DomainError("bad-envelope")))
      .withMaxConnections(math.min(Int.MaxValue.toLong,config.maxConnections.toLong+1).toInt).withMaxHeaderSize(16384)
      .withRequestHeaderReceiveTimeout(config.requestTimeout).withIdleTimeout(config.requestTimeout)
      .withShutdownTimeout(config.requestTimeout+5.seconds)
      .withHttpApp(admission(services.http.app)).build.use { server =>
        val port = server.address.getPort
        val effective = if config.port == 0 then
          val uri = java.net.URI.create(config.apiOrigin.value)
          config.apiOrigin.scheme + "://" + uri.getHost + ":" + port
        else config.apiOrigin.value
        IO(services.http.setBoundPort(port)) *>
          IO.println("MANURE_READY " + Json.obj("apiOrigin" -> Json.fromString(effective),"port" -> Json.fromInt(port),"pid" -> Json.fromLong(ProcessHandle.current().pid())).noSpaces) *>
          (sweeper,indexer).parTupled.void
      }
    }
  }}
