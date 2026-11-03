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
    case List("migrate",path) => IO.blocking(Config.load(Path.of(path))).flatMap(config => buildResources(config,false).use(_ => IO.unit)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case List("--config",path) => runServer(Path.of(path)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case _ => IO.println("usage: manure-server serve CONFIG.json | migrate CONFIG.json | --config CONFIG.json").as(ExitCode.Error)
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
    _ <- Resource.eval(services.database.transaction { c =>
      // Offline import control state is NEVER cleared/adopted automatically.
      val imported = Jdbc.rows(c,"SELECT to_regclass('manure_offline.destination') IS NOT NULL")(_.getBoolean(1)).head
      if recover && imported then
        val receipt = control.getOrElse(throw DomainError("migration-required"))
        val records = Jdbc.rows(c,"SELECT id,root,source,writes_started FROM manure_offline.destination") { r =>
          (r.getString(1),r.getString(2),Option(r.getString(3)),r.getBoolean(4))
        }
        Require(records.size == 1 && records.head._2 == config.migrationReceiptDir.get.toString && records.head._3.nonEmpty && records.head._4, "migration-required")
        def read(name: String): Json = Using.resource(receipt.openExistingFile(RelativeName.parse(name),ExistingFileAccess.ReadOnly)) { marker =>
          Require(marker.size() <= 16384, "migration-required")
          CurrentWire.parse(Exact.string(marker.read(0,16384)))
        }
        val marker = read("COMPLETE")
        val owner = read("OWNER.json")
        val physical = receipt.physicalIdentity.map(java.lang.Long.toUnsignedString)
        Require(marker.hcursor.get[String]("source").toOption == records.head._3 &&
          marker.hcursor.get[String]("destination").toOption.contains(records.head._1) &&
          owner.hcursor.get[String]("id").toOption.contains(records.head._1) &&
          owner.hcursor.get[String]("root").toOption.contains(records.head._2) &&
          owner.hcursor.get[BigInt]("device").toOption.map(_.toString).contains(physical(0)) &&
          owner.hcursor.get[BigInt]("inode").toOption.map(_.toString).contains(physical(1)), "migration-required")
      if recover && !imported then
        val hasTable = Jdbc.rows(c,"SELECT to_regclass('manure.artifacts') IS NOT NULL")(_.getBoolean(1)).head
        val empty = !hasTable || Jdbc.rows(c,"SELECT NOT EXISTS(SELECT 1 FROM manure.artifacts)")(_.getBoolean(1)).head
        if empty then
          val unexpected = Vector("staging","live").exists { name =>
            try directory.tree(RelativeName.parse(name),config.limits.cleanupEntries,68).nonEmpty
            catch case _: NoSuchFileException => false
          }
          Require(!unexpected, "migration-required")

    })
    _ <- Resource.eval(stage("schema",IO.blocking(lease.validate()) *> database.migrate("manure",List(Migration(1,"metadata-byte-exact",schema),Migration(2,"physical-root-binding","CREATE TABLE IF NOT EXISTS manure.root_owner(singleton boolean PRIMARY KEY CHECK(singleton),identity bytea NOT NULL)")))))
    _ <- Resource.eval(services.database.transaction { c =>
      val identity = java.nio.ByteBuffer.allocate(16)
      directory.physicalIdentity.foreach(identity.putLong)
      val bytes = identity.array()
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
