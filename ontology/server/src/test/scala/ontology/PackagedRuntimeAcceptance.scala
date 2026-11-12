package ontology

import cats.effect.{ExitCode, IO, IOApp, Resource}
import cats.syntax.all.*
import io.circe.Json
import java.nio.file.{Files, Path}
import java.util.UUID
import java.util.concurrent.TimeUnit
import ontology.api.*
import ontology.domain.*
import org.http4s.*
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import org.typelevel.ci.CIString
import scala.concurrent.duration.*
import scala.util.Using
import ponygirls.runtime.JdbcDatabase

object PackagedRuntimeAcceptance extends IOApp {
  private val startupDeadline = 15.seconds
  private val progressDeadline = 15.seconds
  private val stopSeconds = 15L
  private val terminatedBySigterm = 143
  private def check(condition: Boolean, message: String): IO[Unit] =
    IO.raiseUnless(condition)(new AssertionError(message))
  private[ontology] def request(f: RuntimeFixture, path: String): Request[IO] =
    Request[IO](Method.GET, Uri.unsafeFromString(f.config.auth.publicOrigin + path)).putHeaders(
      Header.Raw(CIString("Origin"), f.config.auth.publicOrigin),
      Header.Raw(CIString("X-Ontology-Version"), Wire.versions.current),
      Header.Raw(CIString("Authorization"), "Bearer " + f.agentToken))
  private[ontology] def scopes(client: Client[IO], f: RuntimeFixture): IO[ScopesResult] =
    client.run(request(f, "/api/v1/scopes")).use { response =>
      check(response.status == Status.Ok, "scope request rejected") *>
        response.body.compile.to(Array).map(bytes => Wire.decode(ScopesResult.codecJson, Wire.parse(bytes)))
    }
  private def await[A](operation: IO[A])(ready: A => Boolean): IO[A] =
    IO.defer(operation.flatMap(value => if (ready(value)) IO.pure(value) else IO.sleep(25.millis) *> await(operation)(ready)))
  private[ontology] def process(executable: Path, f: RuntimeFixture, report: Path): Resource[IO, Process] =
    Resource.make(IO.blocking {
      new ProcessBuilder(executable.toString, "serve", f.configFile.toString)
        .redirectOutput(report.resolve("server.stdout").toFile)
        .redirectError(report.resolve("server.stderr").toFile).start()
    })(child => stop(child, report))
  private[ontology] def stop(child: Process, report: Path): IO[Unit] = IO.blocking {
      if (!child.isAlive) throw new AssertionError("packaged server exited before intentional shutdown: " + child.exitValue())
      child.destroy()
      val stopped = child.waitFor(stopSeconds, TimeUnit.SECONDS)
      if (!stopped) {
        child.destroyForcibly()
        val killed = child.waitFor(stopSeconds, TimeUnit.SECONDS)
        throw new AssertionError(s"packaged server exceeded graceful shutdown deadline; forced exit observed=$killed")
      }
      val exit = child.exitValue()
      Files.writeString(report.resolve("server-exit"), exit.toString + "\n")
      if (exit != terminatedBySigterm) throw new AssertionError("unexpected packaged server termination: " + exit)
      ()
    }
  private def asset(client: Client[IO], f: RuntimeFixture, web: Path, path: String): IO[Unit] =
    client.run(request(f, path)).use { response => for {
      _ <- check(response.status == Status.Ok, "packaged asset request rejected: " + path)
      _ <- check(response.headers.headers.exists(h => h.name == CIString("X-Content-Type-Options") && h.value == "nosniff"), "missing nosniff")
      _ <- check(response.headers.headers.exists(h => h.name == CIString("Content-Security-Policy") && h.value.contains("default-src 'none'")), "missing CSP")
      bytes <- response.body.compile.to(Array)
      expected <- IO.blocking(Files.readAllBytes(web.resolve(if (path == "/") "index.html" else path.drop(1))))
      _ <- check(java.util.Arrays.equals(bytes, expected), "served asset differs from installed bytes: " + path)
    } yield () }
  private def exercise(client: Client[IO], f: RuntimeFixture, web: Path): IO[ScopeSummary] = for {
    _ <- asset(client, f, web, "/")
    html <- IO.blocking(Files.readString(web.resolve("index.html")))
    assets = "(?:src|href)=\"(/[^\"]+\\.(?:js|css))\"".r.findAllMatchIn(html).map(_.group(1)).toList
    _ <- check(assets.nonEmpty, "packaged index has no script or style assets")
    _ <- assets.traverse_(path => asset(client, f, web, path))
    command = ApplyRequest(f.scope, UUID.randomUUID(), 0L, List(Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Controlled packaged runtime account", Modality.Assertion), Nil)), None)
    _ <- client.run(request(f, "/api/v1/apply").withMethod(Method.POST)
      .withEntity(Wire.encode(ApplyRequest.codecJson, command).noSpaces)
      .putHeaders(Header.Raw(CIString("Content-Type"), "application/json"))).use { response =>
        check(response.status == Status.Ok, "packaged graph command rejected") *> response.body.compile.drain
      }
    current <- await(scopes(client, f))(s => s.items.size == 1 && s.items.head.coveredFrontier == 1L && s.items.head.rdfGeneration.contains(s.items.head.generation)).timeout(progressDeadline)
    _ <- check(current.items.head.generation == 2L, "unexpected publication generation")
    calls <- f.requests.get
    _ <- check(calls.size == 1, "expected exactly one controlled model request")
  } yield current.items.head
  private[ontology] def coordinator(db: JdbcDatabase): IO[CoordinatorState] = db.transaction { connection =>
    Using.resource(connection.createStatement()) { statement =>
      Using.resource(statement.executeQuery("SELECT epoch, payload FROM ontology_curation_coordinator WHERE singleton")) { rows =>
        require(rows.next(), "coordinator row missing")
        CoordinatorState(rows.getLong(1), Option(rows.getString(2)).map(value => StoredJson.decode(CoordinatorLease.codecJson, value)))
      }
    }
  }
  private[ontology] def verifyRelease(repo: GraphRepository, db: JdbcDatabase, fence: CoordinatorFence): IO[Unit] =
    coordinator(db).flatMap { retained =>
      check(retained.epoch == fence.epoch && retained.lease.isEmpty, "captured coordinator ownership was not durably released")
    } *> repo.curation.acquire(UUID.randomUUID()).flatMap(lease => repo.curation.release(lease.fence))
  private[ontology] def complete[A, B](resource: Resource[IO, A])(run: A => IO[B])(publish: B => IO[Unit]): IO[Unit] =
    resource.use(run).flatMap(publish)
  private def runAcceptance(packageRoot: Path, web: Path, report: Path): IO[Unit] = {
    val executable = packageRoot.resolve("bin/ontology-server")
    complete(RuntimeFixture.resource.product(EmberClientBuilder.default[IO].build)) { case (f, client) => for {
      _ <- IO.blocking {
        Files.createDirectory(report)
        val json = Wire.parse(Files.readAllBytes(f.configFile))
        val configured = json.mapObject(o => o.add("http", o("http").get.mapObject(_.add("webRoot", Json.fromString(web.toString)))))
        Files.writeString(f.configFile, configured.noSpaces)
      }
      observed <- process(executable, f, report).use { child =>
        def ready: IO[Unit] = IO.defer {
          check(child.isAlive, "packaged server exited before readiness") *> scopes(client, f).attempt.flatMap {
            case Right(_) => IO.unit
            case Left(error: AssertionError) => IO.raiseError(error)
            case Left(error: Fault) => IO.raiseError(error)
            case Left(_) => IO.sleep(25.millis) *> ready
          }
        }
        ready.timeout(startupDeadline) *> exercise(client, f, web).flatMap { scope =>
          RepositoryReproductionDatabase.resource.use(db => coordinator(db).map(value => scope -> value.lease.get.fence))
        }
      }
      (finalScope, fence) = observed
      gone <- scopes(client, f).attempt.timeout(5.seconds)
      _ <- check(gone.isLeft, "packaged listener remained available after process exit")
      retained <- RdfProjection.resource(f.config.projection.storage, f.config.projection.settings.targetId, 5,
        IO.raiseError(new AssertionError("packaged RDF identity was not retained"))).use(_.observe(f.scope).map(_.get))
      _ <- check(retained.snapshot.generation == finalScope.generation, "packaged RDF generation differs")
      _ <- RepositoryReproductionDatabase.resource.use { db =>
        val repo = new PostgresGraphRepository(db, new AdmissionEngine, new ReviewDomain(f.config.review), f.config.curation)
        repo.read(f.scope).flatMap(graph => check(graph == retained.snapshot, "packaged RDF differs from PostgreSQL")) *>
          verifyRelease(repo, db, fence)
      }
    } yield Json.obj(
      "package" -> Json.fromString(packageRoot.toString), "webRoot" -> Json.fromString(web.toString),
      "generation" -> Json.fromLong(finalScope.generation),
      "frontier" -> Json.fromLong(finalScope.frontier), "browserAcceptance" -> Json.False)
    }(value => IO.blocking(Files.writeString(report.resolve("passed.json"), value.spaces2 + "\n")).void)
  }
  override def run(args: List[String]): IO[ExitCode] = args match {
    case packageRoot :: web :: report :: Nil if List(packageRoot, web, report).forall(value => Path.of(value).isAbsolute) =>
      runAcceptance(Path.of(packageRoot), Path.of(web), Path.of(report)).as(ExitCode.Success)
    case _ => IO.raiseError(new IllegalArgumentException("expected absolute package root, web root and fresh report directory"))
  }
}
