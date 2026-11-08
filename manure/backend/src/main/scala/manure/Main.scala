package manure

import cats.effect.{ExitCode,IO,IOApp,Resource}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import com.comcast.ip4s.{Host,Port}
import distage.*
import manure.plugins.{ManurePlugin,RuntimeServices}
import manure.storage.{ConfinedDirectory,RelativeName,RootLease,RootLocked}
import ponygirls.runtime.{CatsIOInjector,JdbcDatabase,Migration}
import ponygirls.retrieval.{EmbeddingClient,EmbeddingTelemetry}
import org.http4s.ember.server.EmberServerBuilder
import scala.concurrent.duration.*
import java.nio.file.{Path,NoSuchFileException}
import scala.util.Using
import io.circe.Json

object Main extends IOApp:
  def run(args: List[String]): IO[ExitCode] = args match
    case List("check-casefold") => IO.blocking(UnicodeCaseFoldProbe.main(Array.empty[String])).as(ExitCode.Success).handleErrorWith(safeFailure)
    case List("serve",path) => runServer(Path.of(path)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case List("check-config",path) => IO.blocking(Config.load(Path.of(path))).flatMap(_ => IO.println("MANURE_CONFIG_OK")).as(ExitCode.Success).handleErrorWith(safeFailure)
    case List("migrate",path) => IO.blocking(Config.load(Path.of(path))).flatMap(config => buildResources(config,false,config.rootAuthority.map(RootAuthorityProvider.kubernetes)).use(_ => IO.unit)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case List("plan-root-identity",path,output,evidence) => stage("plan-root-identity",for
      config <- IO.blocking(Config.load(Path.of(path)))
      plan <- RootIdentityMigration.prepare(config,RootAuthorityProvider.configured(config),evidence)
      _ <- IO.blocking(RootMigrationPlan.writeNew(plan,Path.of(output)))
      _ <- IO.println(Json.obj("status" -> Json.fromString("planned-not-applied"),"planSha256" -> Json.fromString(plan.sha256)).noSpaces)
    yield ExitCode.Success).handleErrorWith(safeFailure)
    case List("migrate-root-identity",path,input,expected) => stage("migrate-root-identity",for
      config <- IO.blocking(Config.load(Path.of(path)))
      plan <- IO.blocking(RootMigrationPlan.read(Path.of(input)))
      result <- RootIdentityMigration.applyPlan(config,RootAuthorityProvider.configured(config),plan,expected,RootMigrationCheckpoints.quiet)
      _ <- IO.println(Json.obj("status" -> Json.fromString(if result.replayed then "replayed" else "applied"),"planSha256" -> Json.fromString(result.planSha256),"contextRefreshed" -> Json.fromBoolean(result.contextRefreshed)).noSpaces)
    yield ExitCode.Success).handleErrorWith(safeFailure)
    case List("--config",path) => runServer(Path.of(path)).as(ExitCode.Success).handleErrorWith(safeFailure)
    case _ => IO.println("usage: manure-server serve CONFIG.json | migrate CONFIG.json | check-config CONFIG.json | --config CONFIG.json | plan-root-identity CONFIG.json PRIVATE_PLAN.json PRIOR_VOLUME_EVIDENCE | migrate-root-identity CONFIG.json PRIVATE_PLAN.json EXPECTED_SHA256").as(ExitCode.Error)
  private final case class StartupFailure(stage: String,code: String) extends RuntimeException(code)
  private def safeCode(error: Throwable): String = error match
    case s: StartupFailure => s.code
    case d: DomainError if d.code.matches("[a-z][a-z-]{0,63}") => d.code
    case r: ponygirls.runtime.RuntimeFailure if r.code.matches("[a-z][a-z-]{0,63}") => r.code
    case j: ponygirls.runtime.JdbcFailure => "jdbc-" + j.sqlState.getOrElse("unknown")
    case n: manure.storage.NativeFailure => "posix-" + n.errno()
    case _: RootLocked => "root-locked"
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
    val input = getClass.getResourceAsStream("/001_metadata.sql")
    Require(input != null, "unavailable")
    Using.resource(scala.io.Source.fromInputStream(input,"UTF-8"))(_.mkString)
  private def embedding(config: Config): Resource[IO,Option[EmbeddingClient]] = config.embedding match
    case None => Resource.pure(None)
    case Some(settings) => EmbeddingClient.resource(settings.endpoint,settings.maxConcurrent,settings.maxQueued,EmbeddingTelemetry.noop).map(Some(_))
  /** Acquisition order is security-critical: physical root claim and service lease
    * precede JDBC/migrations/recovery/HTTP/workers. Release reverses that order,
    * awaiting uncancelable JDBC and streamed file cleanup before releasing claim.
    */
  def resources(config: Config): Resource[IO,RuntimeServices] = buildResources(config,true,config.rootAuthority.map(RootAuthorityProvider.kubernetes))
  private[manure] def resourcesWithAuthority(config: Config,provider: RootAuthorityProvider): Resource[IO,RuntimeServices] = buildResources(config,true,Some(provider))
  private def buildResources(config: Config,recover: Boolean,provider: Option[RootAuthorityProvider]): Resource[IO,RuntimeServices] = for
    files <- RootDirectories.resource(config,recover)
    directory=files.payload
    lease=files.lease
    control=files.control
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
      RootOwnership.read(c)
    })
    ownership <- Resource.eval(RootOwnership.verify(config,files,observation,provider))
    _ <- Resource.eval(IO.blocking {
      ownership.revalidate(directory)
      observation.destination match
        case Some(record) if recover || record.source.nonEmpty =>
          ImportReceipt.validate(config,directory,control.getOrElse(throw DomainError("migration-required")),record,observation.binding.isEmpty,recover,ownership.imported)
        case _ => ()
      if recover then
        observation.destination match
          // A matching existing binding already establishes this root's domain
          // ownership. Empty metadata can follow a committed last-row delete
          // whose filesystem cleanup was interrupted; normal orphan recovery is
          // then required. This refusal is ONLY for first, unbound adoption.
          case None if observation.emptyArtifacts && observation.binding.isEmpty =>
            val unexpected=Vector("staging","live").exists { name =>
              try directory.tree(RelativeName.parse(name),config.limits.cleanupEntries,68).nonEmpty
              catch case _: NoSuchFileException => false
            }
            Require(!unexpected,"migration-required")
          case _ => ()
    })
    _ <- Resource.eval(stage("schema",IO.blocking(lease.validate()) *> database.migrate("manure",List(Migration(1,"metadata-byte-exact",schema),Migration(2,"physical-root-binding","CREATE TABLE IF NOT EXISTS manure.root_owner(singleton boolean PRIMARY KEY CHECK(singleton),identity bytea NOT NULL)"),CatalogueProjection.migration,ExternalPasswords.migration))))
    _ <- Resource.eval(services.database.transaction { c =>
      if recover then
        // File/hash validation above ran without an open DB transaction. Both
        // physical claims remain held; check root identities again before the
        // FIRST insert. migrate is schema-only and NEVER adopts a payload root.
        ownership.revalidate(directory)
        val bytes=ownership.binding.bytes
        control.foreach(_.physicalIdentity)
        if observation.binding.isEmpty then Jdbc.exec(c,"INSERT INTO manure.root_owner(singleton,identity) VALUES(true,?) ON CONFLICT DO NOTHING",bytes)
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
