package ontology

import cats.effect.{ExitCode, IO, IOApp}
import cats.syntax.all.*
import io.circe.Json
import java.nio.file.{Files, Path}
import java.nio.file.attribute.PosixFilePermissions
import java.util.UUID
import ontology.api.*
import ontology.domain.*
import org.http4s.*
import org.http4s.ember.client.EmberClientBuilder
import org.typelevel.ci.CIString
import scala.concurrent.duration.*

object PackagedBrowserAcceptance extends IOApp {
  private val originalText = "Controlled original browser account"
  private val revisedText = "Controlled revised browser account"
  private def check(value: Boolean, message: String): IO[Unit] = IO.raiseUnless(value)(new AssertionError(message))
  private def until[A](work: IO[A])(ready: A => Boolean): IO[A] = IO.defer(work.flatMap(value =>
    if (ready(value)) IO.pure(value) else IO.sleep(25.millis) *> until(work)(ready)))
  private def acceptance(pkg: Path, web: Path, python: Path, node: Path, driver: Path, report: Path): IO[Unit] =
    PackagedRuntimeAcceptance.complete(RuntimeFixture.resource.product(EmberClientBuilder.default[IO].build)) { case (f, client) => for {
      _ <- IO.blocking {
        Files.createDirectory(report)
        val json = Wire.parse(Files.readAllBytes(f.configFile))
        Files.writeString(f.configFile, json.mapObject(o => o
          .add("http", o("http").get.mapObject(_.add("webRoot", Json.fromString(web.toString))))
          .add("query", o("query").get.mapObject(_.add("maxPageRecords", Json.fromInt(1))))).noSpaces)
      }
      observed <- PackagedRuntimeAcceptance.process(pkg.resolve("bin/ontology-server"), f, report).use { child =>
        def ready: IO[Unit] = IO.defer(check(child.isAlive, "installed service exited before browser readiness") *>
          PackagedRuntimeAcceptance.scopes(client, f).attempt.flatMap {
            case Right(_) => IO.unit
            case Left(error: AssertionError) => IO.raiseError(error)
            case Left(error: Fault) => IO.raiseError(error)
            case Left(_) => IO.sleep(25.millis) *> ready
          })
        for {
          _ <- ready.timeout(15.seconds)
          command = ApplyRequest(f.scope, UUID.randomUUID(), 0L, List(Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved),
            ContentInput.Statement(originalText, Modality.Assertion), Nil)), None)
          result <- client.run(PackagedRuntimeAcceptance.request(f, "/api/v1/apply").withMethod(Method.POST)
            .withEntity(Wire.encode(ApplyRequest.codecJson, command).noSpaces).putHeaders(Header.Raw(CIString("Content-Type"), "application/json"))).use { response =>
              check(response.status == Status.Ok, "browser seed command rejected") *> response.body.compile.to(Array).map(bytes => Wire.decode(ApplyResult.codecJson, Wire.parse(bytes)))
            }
          _ <- until(PackagedRuntimeAcceptance.scopes(client, f))(s => s.items.head.generation == 2L && s.items.head.coveredFrontier == 1L && s.items.head.rdfGeneration.contains(2L)).timeout(15.seconds)
          seed = result.created.head.ref
          config <- IO.blocking {
            val path = f.directory.resolve("browser.json")
            Files.createFile(path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))
            Files.writeString(path, Json.obj("origin" -> Json.fromString(f.config.auth.publicOrigin), "scope" -> Json.fromString(f.scope),
              "humanToken" -> Json.fromString(f.humanToken), "agentToken" -> Json.fromString(f.agentToken), "seedId" -> Json.fromString(seed.id.toString),
              "originalText" -> Json.fromString(originalText), "revisedText" -> Json.fromString(revisedText)).noSpaces)
            path
          }
          _ <- AcceptanceNodeProcess.run(python, node, driver, List(config.toString, report.toString), report, "browser", 120L)
          status <- until(PackagedRuntimeAcceptance.scopes(client, f))(s => s.items.head.generation == 6L && s.items.head.frontier == 3L &&
            s.items.head.coveredFrontier == 3L && s.items.head.rdfGeneration.contains(6L)).timeout(15.seconds)
          observations <- IO.blocking(Wire.parse(Files.readAllBytes(report.resolve("browser-observations.json"))))
          presentation = Wire.decode(Presentation.codecJson, observations.hcursor.downField("presentation").focus.get)
          judgment = Wire.decode(Judgment.codecJson, observations.hcursor.downField("judgment").focus.get)
          request = Wire.decode(JudgmentRequest.codecJson, observations.hcursor.downField("request").focus.get)
          fence <- RepositoryReproductionDatabase.resource.use { db =>
            val repo = new PostgresGraphRepository(db, new AdmissionEngine, new ReviewDomain(f.config.review), f.config.curation)
            val human = Actor("fixture-human", ActorKind.Human)
            val principal = Principal("fixture-human", human, Set(f.scope), Set(Capability.Read, Capability.Review))
            for {
              retained <- repo.presentation(principal, f.scope, presentation.id)
              saved <- repo.judgment(principal, f.scope, judgment.id)
              _ <- check(retained == presentation && saved == judgment && retained.payload.generation == 2L && retained.payload.targets == List(seed), "browser evidence differs from retained review")
              _ <- check(retained.payloadDigest == Digests.bytes(PresentationEngine.canonical(retained.payload)), "browser presentation digest differs")
              _ <- check(saved.action == ReviewAction.Review(JudgmentKind.NeedEvidence) && saved.presentationId == retained.id && saved.requestId == request.requestId &&
                saved.rationale == request.rationale && saved.presentationSource == retained.reservedSourceRef, "judgment correspondence differs")
              input <- repo.input(f.scope, saved.input)
              _ <- check(input.submitter == human && input.contributor == human && input.ingress.transport == RequestTransport.Cookie && input.ingress.operation == "/api/v1/judge", "review did not use authenticated Human cookie ingress")
              graph <- repo.read(f.scope)
              _ <- check(List(1, 2).forall(revision => graph.definitions.exists(_.ref == Ref(seed.id, revision))), "review drift lost a retained revision")
              source <- repo.sources(SourceRequest(f.scope, 0L, 100))
              _ <- check(source.events.exists(_.reviewResponse.contains(ReviewResponseLink(retained.id, saved.id, retained.reservedSourceRef, retained.payloadDigest))), "protected review-response Source link absent")
              state <- PackagedRuntimeAcceptance.coordinator(db)
            } yield state.lease.get.fence
          }
        } yield (status.items.head, fence)
      }
      (status, fence) = observed
      gone <- PackagedRuntimeAcceptance.scopes(client, f).attempt.timeout(5.seconds)
      _ <- check(gone.isLeft, "installed browser service listener survived shutdown")
      retained <- RdfProjection.resource(f.config.projection.storage, f.config.projection.settings.targetId, 5,
        IO.raiseError(new AssertionError("browser service RDF identity absent"))).use(_.observe(f.scope).map(_.get))
      _ <- RepositoryReproductionDatabase.resource.use { db =>
        val repo = new PostgresGraphRepository(db, new AdmissionEngine, new ReviewDomain(f.config.review), f.config.curation)
        repo.read(f.scope).flatMap(graph => check(graph == retained.snapshot && graph.generation == 6L, "browser SQL/RDF correspondence failed")) *>
          PackagedRuntimeAcceptance.verifyRelease(repo, db, fence)
      }
      requests <- f.requests.get
      _ <- check(requests.size == 3, "browser scenario should produce three serialized primary maintenance calls")
    } yield Json.obj("realBackendIntegration" -> Json.True, "browserAcceptance" -> Json.True, "humanStudy" -> Json.False,
      "semanticQuality" -> Json.False, "package" -> Json.fromString(pkg.toString), "webRoot" -> Json.fromString(web.toString),
      "generation" -> Json.fromLong(status.generation), "frontier" -> Json.fromLong(status.frontier), "curatorRequests" -> Json.fromInt(requests.size))
    }(value => IO.blocking(Files.writeString(report.resolve("passed.json"), value.spaces2 + "\n")).void)
  override def run(args: List[String]): IO[ExitCode] = args match {
    case pkg :: web :: python :: node :: driver :: report :: Nil if args.forall(value => Path.of(value).isAbsolute) =>
      acceptance(Path.of(pkg), Path.of(web), Path.of(python), Path.of(node), Path.of(driver), Path.of(report)).as(ExitCode.Success)
    case _ => IO.raiseError(new IllegalArgumentException("expected absolute package, web root, Python, Node, driver and fresh report paths"))
  }
}
