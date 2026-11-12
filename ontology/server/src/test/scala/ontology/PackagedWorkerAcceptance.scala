package ontology

import cats.effect.{ExitCode, IO, IOApp}
import cats.syntax.all.*
import io.circe.Json
import java.nio.file.{Files, Path}
import java.nio.file.attribute.PosixFilePermissions
import java.util.UUID
import ontology.api.*
import ontology.domain.*
import org.http4s.ember.client.EmberClientBuilder
import scala.concurrent.duration.*

object PackagedWorkerAcceptance extends IOApp {
  private[ontology] def exposureIds(matrix: List[List[UUID]]): List[UUID] = {
    val ids = matrix.flatten.distinct
    require(matrix.size == 4 && matrix.head.isEmpty && matrix(1).size == 1 && matrix(2) == matrix(1) &&
      matrix(3).size == 1 && matrix(3) != matrix(1) && ids.size == 2, "request-specific delivery linkage missing")
    ids
  }
  private def check(value: Boolean, message: String): IO[Unit] = IO.raiseUnless(value)(new AssertionError(message))
  private def until[A](work: IO[A])(ready: A => Boolean): IO[A] = IO.defer(work.flatMap(value =>
    if (ready(value)) IO.pure(value) else IO.sleep(25.millis) *> until(work)(ready)))
  private def configure(f: RuntimeFixture): IO[Path] = IO.blocking {
    val collectorToken = "c" * 43
    val collectorHash = f.directory.resolve("collector.sha256")
    val collectorSecret = f.directory.resolve("collector.token")
    val workerSecret = f.directory.resolve("worker.token")
    Files.writeString(collectorHash, Digests.text(collectorToken))
    List(collectorSecret -> collectorToken, workerSecret -> f.agentToken).foreach { case (path, text) =>
      Files.createFile(path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))
      Files.writeString(path, text)
    }
    val server = Wire.parse(Files.readAllBytes(f.configFile))
    val credential = Json.obj("id" -> Json.fromString("fixture-collector-credential"),
      "actor" -> Json.obj("id" -> Json.fromString("fixture-collector"), "kind" -> Json.fromString("Collector")),
      "scopes" -> Json.arr(Json.fromString(f.scope)), "capabilities" -> Json.arr(Json.fromString("Read"), Json.fromString("Capture")),
      "hashFile" -> Json.fromString(collectorHash.toString))
    val configured = server.mapObject(o => o.add("auth", o("auth").get.mapObject(a =>
      a.add("credentials", Json.arr((a("credentials").get.asArray.get :+ credential)*)))))
    Files.writeString(f.configFile, configured.noSpaces)
    val config = Json.obj("version" -> Json.fromInt(1), "captureAuthorization" -> Json.fromString("current-session-from-attachment"),
      "http" -> Json.obj("origin" -> Json.fromString(f.config.auth.publicOrigin), "deadlineMs" -> Json.fromInt(5000),
        "maxRequestBytes" -> Json.fromInt(1048576), "maxResponseBytes" -> Json.fromInt(1048576)),
      "coordinator" -> Json.obj("scope" -> Json.fromString(f.scope), "workContext" -> Json.fromString("fixture-work"),
        "workerActorId" -> Json.fromString("fixture-worker"), "collectorActorId" -> Json.fromString("fixture-collector"),
        "collectorNamespace" -> Json.fromString("fixture-collector-credential"), "boundaryDeadlineMs" -> Json.fromInt(15000),
        "pollEveryMs" -> Json.fromInt(25), "maxNewEntries" -> Json.fromInt(100), "maxTrackedEntries" -> Json.fromInt(1000),
        "maxCaptureTextBytes" -> Json.fromInt(65536), "maxCapsuleBytes" -> Json.fromInt(1048576)),
      "workerTokenFile" -> Json.fromString(workerSecret.toString), "collectorTokenFile" -> Json.fromString(collectorSecret.toString))
    val path = f.directory.resolve("worker.json"); Files.writeString(path, config.noSpaces); path
  }
  private def acceptance(pkg: Path, python: Path, node: Path, driver: Path, sdk: Path, workerRoot: Path, report: Path): IO[Unit] =
    PackagedRuntimeAcceptance.complete(RuntimeFixture.resource.product(EmberClientBuilder.default[IO].build)) { case (f, client) => for {
      _ <- IO.blocking(Files.createDirectory(report))
      workerConfig <- configure(f)
      observed <- PackagedRuntimeAcceptance.process(pkg.resolve("bin/ontology-server"), f, report).use { child =>
        def ready: IO[Unit] = IO.defer(check(child.isAlive, "installed service exited before SDK readiness") *>
          PackagedRuntimeAcceptance.scopes(client, f).attempt.flatMap {
            case Right(_) => IO.unit
            case Left(error: AssertionError) => IO.raiseError(error)
            case Left(error: Fault) => IO.raiseError(error)
            case Left(_) => IO.sleep(25.millis) *> ready
          })
        for {
          _ <- ready.timeout(15.seconds)
          _ <- AcceptanceNodeProcess.run(python, node, driver, List(workerConfig.toString, sdk.toString, workerRoot.toString, report.toString), report, "worker", 120L)
          status <- until(PackagedRuntimeAcceptance.scopes(client, f))(s => s.items.head.frontier == 4L &&
            s.items.head.coveredFrontier == 4L && s.items.head.rdfGeneration.contains(s.items.head.generation)).timeout(15.seconds)
          observation <- IO.blocking(Wire.parse(Files.readAllBytes(report.resolve("worker-observations.json"))))
          slots = observation.hcursor.downField("slots").focus.get.asArray.get.map(_.asString.get).toList
          manifest = observation.hcursor.downField("manifest").focus.get.asArray.get.toList
          sessionId = observation.hcursor.get[String]("sessionId").toOption.get
          _ <- check(slots.size == 2, "SDK worker did not observe both request capsules")
          evidence <- RepositoryReproductionDatabase.resource.use { db =>
            val repo = new PostgresGraphRepository(db, new AdmissionEngine, new ReviewDomain(f.config.review), f.config.curation)
            val principal = Principal("fixture-worker", Actor("fixture-worker", ActorKind.Agent), Set(f.scope), Set(Capability.Read))
            for {
              sources <- repo.sources(SourceRequest(f.scope, 0L, 100))
              _ <- check(sources.events.size == 4 && sources.events.forall(_.provenance.contributor.kind == ActorKind.Unknown), "collector became authenticated contributor")
              _ <- check(manifest.size == 4 && sources.events.zip(manifest).forall { case (event, expected) =>
                event.metadata.sourceId == expected.hcursor.get[String]("sourceId").toOption.get &&
                  event.metadata.parentSourceId == expected.hcursor.downField("parentSourceId").focus.get.asString &&
                  event.origin.toString == expected.hcursor.get[String]("origin").toOption.get &&
                  event.text == expected.hcursor.get[String]("text").toOption.get && event.sourceNamespace == "fixture-collector-credential" &&
                  event.metadata.representation == SourceRepresentation.PiTranscript && event.observation.isInstanceOf[Observation.None]
              }, "durable captures differ from finalized native entry manifest")
              native = Contexts.reportedNative(sources.events.head.context, Contexts.ProtocolLimits)
              _ <- check(native.sessionId == sessionId && native.lineage == LineageStatus.Unknown && native.rootSessionId.isEmpty && native.parentSessionId.isEmpty &&
                sources.events.forall(event => event.context == sources.events.head.context && event.context.reportedInherited.isEmpty), "capture context differs from actual SDK session")
              _ <- sources.events.traverse_(event => repo.input(f.scope, Ref(event.provenance.input, 1)).flatMap(input =>
                check(input.submitter == Actor("fixture-collector", ActorKind.Collector), "capture submitter is not the configured collector")))
              _ <- check(sources.events.head.origin == EventOrigin.UserMessage && sources.events.head.metadata.exposedDeliveries.isEmpty, "user input inherited model exposure")
              _ <- check(sources.events.last.text.contains("finalized-worker-output") && !sources.events.exists(e => e.text.contains("copied historical input") || e.text.contains("original-worker-output")), "capture differs from finalized authorized entries")
              ids = exposureIds(sources.events.map(_.metadata.exposedDeliveries))
              receipts <- ids.traverse(id => repo.capsules(f.config.capsule).delivery(principal, f.scope, id))
              capsules <- receipts.traverse(receipt => repo.capsules(f.config.capsule).capsule(principal, f.scope, receipt.capsuleId))
              _ <- check(receipts.forall(receipt => receipt.boundary == DeliveryBoundary.ExtensionContext && receipt.reportedContext == sources.events.head.context) &&
                capsules.zip(slots).forall { case (capsule, slot) => slot.contains(capsule.payload.text) && capsule.payload.reportedContext == sources.events.head.context }, "provider slot or reported context differs from retained capsule")
              state <- PackagedRuntimeAcceptance.coordinator(db)
            } yield state.lease.get.fence
          }
        } yield (status.items.head, evidence)
      }
      (status, fence) = observed
      gone <- PackagedRuntimeAcceptance.scopes(client, f).attempt.timeout(5.seconds)
      _ <- check(gone.isLeft, "installed listener survived shutdown")
      retained <- RdfProjection.resource(f.config.projection.storage, f.config.projection.settings.targetId, 5,
        IO.raiseError(new AssertionError("RDF identity absent"))).use(_.observe(f.scope).map(_.get))
      _ <- RepositoryReproductionDatabase.resource.use { db =>
        val repo = new PostgresGraphRepository(db, new AdmissionEngine, new ReviewDomain(f.config.review), f.config.curation)
        repo.read(f.scope).flatMap(graph => check(graph == retained.snapshot && graph.sourceFrontier == 4L, "SDK SQL/RDF correspondence failed")) *>
          PackagedRuntimeAcceptance.verifyRelease(repo, db, fence)
      }
      requests <- f.requests.get
    } yield Json.obj("realPiSdk" -> Json.True, "realBackend" -> Json.True, "browserAcceptance" -> Json.False,
      "humanStudy" -> Json.False, "semanticQuality" -> Json.False, "package" -> Json.fromString(pkg.toString),
      "sdk" -> Json.fromString(sdk.toString), "workerRoot" -> Json.fromString(workerRoot.toString), "generation" -> Json.fromLong(status.generation),
      "frontier" -> Json.fromLong(status.frontier), "curatorRequests" -> Json.fromInt(requests.size))
    }(value => IO.blocking(Files.writeString(report.resolve("passed.json"), value.spaces2 + "\n")).void)
  override def run(args: List[String]): IO[ExitCode] = args match {
    case pkg :: python :: node :: driver :: sdk :: workerRoot :: report :: Nil if args.forall(value => Path.of(value).isAbsolute) =>
      acceptance(Path.of(pkg), Path.of(python), Path.of(node), Path.of(driver), Path.of(sdk), Path.of(workerRoot), Path.of(report)).as(ExitCode.Success)
    case _ => IO.raiseError(new IllegalArgumentException("expected absolute package, Python, Node, driver, SDK, installed worker and fresh report paths"))
  }
}
