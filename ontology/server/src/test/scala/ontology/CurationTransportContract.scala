package ontology

import cats.effect.{IO, Ref as Cell, Resource}
import cats.syntax.all.*
import com.comcast.ip4s.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Files
import java.util.UUID
import ontology.api.*
import ontology.curation.*
import ontology.domain.*
import org.http4s.{HttpApp, Response, Status}
import org.http4s.ember.server.EmberServerBuilder
import scala.concurrent.duration.*

abstract class CurationTransportContract extends CurationRepositorySupport {
  private def model(app: HttpApp[IO]): Resource[IO, CuratorModel] = for {
    credential <- Resource.make(IO.blocking(Files.createTempFile("ontology-curation-test-", ".key")))(path => IO.blocking(Files.deleteIfExists(path)).void)
    server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(app).build
    config = CuratorConfig("controlled-transport", s"http://127.0.0.1:${server.address.getPort}/model", "controlled-model", credential.toString,
      5.seconds, 1048576, 1048576, 1024, Some("max"), true, CuratorOutputTokenField.MaxCompletionTokens, CuratorResponseFormat.JsonObject)
    value <- CuratorModel.resource(config, new CompiledCurationSchemas)
  } yield value

  for (stale <- List(false, true); coordinated <- List(false, true)) test(s"loopback provider and durable audit compose with stale=$stale coordinated=$coordinated") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    calls <- Cell.of[IO, Int](0)
    providerErrors <- Cell.of[IO, List[String]](Nil)
    app: HttpApp[IO] = cats.data.Kleisli { request => (for {
      body <- request.as[String]
      _ <- IO(Wire.parse(body.getBytes(UTF_8)))
      status <- repo.curation.status(settings.principal, scope)
      id = status.attempt.getOrElse(throw new AssertionError("model dispatched before claim was retained")).attemptId
      audit <- repo.curation.inspect(settings.principal, scope, id)
      claim = audit.attempt.claim
      _ = assertEquals(audit.journal.last.stage, CurationAuditStage.DispatchPossible)
      _ = assertEquals(audit.journal.head.payload.map(_.content), Some(body))
      _ <- calls.update(_ + 1)
      _ <- if (stale) capture(repo, scope).void else IO.unit
      proposal = CurationProposal(claim.baseGeneration, claim.frontier, Nil)
      reply = Json.obj("choices" -> Json.arr(Json.obj("finish_reason" -> Json.fromString("stop"), "message" -> Json.obj(
        "role" -> Json.fromString("assistant"), "content" -> Json.fromString(StoredJson.encode(CurationProposal.codecJson, proposal))))))
    } yield Response[IO](Status.Ok).withEntity(reply.noSpaces)).onError { case error => providerErrors.update(_ :+ s"${error.getClass.getName}: ${error.getMessage}") } }
    _ <- model(app).use { provider => if (coordinated) {
      val diagnostics = new CurationDiagnostics {
        def outcome(value: ScopeOutcome): IO[Unit] = IO.unit
        def stopped(value: CycleStop): IO[Unit] = IO.unit
      }
      for {
        worker <- CurationCoordinator.create(repo.curation, repo, settings.principal, provider, new CursorSigner(Array.fill[Byte](32)(7)),
          QueryLimits(100, 64, 65536, 2048), CurationCycleConfig(2, 1, 2.seconds), IO(UUID.randomUUID()), diagnostics, new SupervisedCurationCleanup)
        report <- worker.cycle(lease.fence)
        _ = assertEquals(report.stopped, None)
        _ = assertEquals(report.outcomes.size, 1)
        _ = if (stale) assert(report.outcomes.head.isInstanceOf[ScopeOutcome.Terminal]) else assert(report.outcomes.head.isInstanceOf[ScopeOutcome.Published])
        current <- repo.curation.status(settings.principal, scope)
        _ = assertEquals(current.coveredFrontier, if (stale) 0L else 1L)
        _ = assertEquals(current.state, if (stale) CurationState.Pending else CurationState.Idle)
        _ = assertEquals(current.attempt.map(_.state), Some(if (stale) CurationAttemptState.Stale else CurationAttemptState.Published))
      } yield ()
    } else for {
      id <- IO(UUID.randomUUID())
      claimed <- repo.curation.claim(lease.fence, scope, id, provider.profile)
      attempt = claimed.asInstanceOf[CurationClaimResult.Claimed].attempt
      _ = assertEquals(attempt.claim.profileDigest, provider.profile.profileDigest)
      _ <- repo.curation.seal(lease.fence, scope, id)
      frozen <- repo.curation.frozen(settings.principal, scope, id)
      reader = new FrozenCurationReader(frozen, repo, settings.principal, new CursorSigner(Array.fill[Byte](32)(7)), QueryLimits(100, 64, 65536, 2048))
      audit <- RepositoryCurationAudit.create(repo.curation, frozen)
      observed <- provider.propose(frozen.material.input, reader, audit).onError { case _ =>
        providerErrors.get.flatMap(errors => if (errors.nonEmpty) IO(fail(errors.mkString("\n"))) else IO.unit)
      }
      candidate = CurationCandidate(id, frozen.material.manifest.inputDigest, observed.responseOrdinal, observed.responseDigest, observed.proposal,
        Digests.text(StoredJson.encode(CurationProposal.codecJson, observed.proposal)))
      result <- repo.curation.publish(lease.fence, scope, id, candidate, UUID.randomUUID())
      retained <- repo.curation.inspect(settings.principal, scope, id)
      _ = assertEquals(retained.journal.size, 3)
      _ = assertEquals(retained.journal.last.payload.map(_.digest), Some(observed.responseDigest))
      graph <- repo.read(scope)
      _ = if (stale) {
        assert(result.isInstanceOf[CurationWriteResult.Terminal])
        assertEquals(retained.attempt.state, CurationAttemptState.Stale)
        assertEquals((graph.sourceFrontier, graph.coveredFrontier), (2L, 0L))
      } else {
        assert(result.isInstanceOf[CurationWriteResult.Published])
        assertEquals((graph.sourceFrontier, graph.coveredFrontier), (1L, 1L))
      }
    } yield () }
    count <- calls.get
    _ = assertEquals(count, 1)
  } yield () } } }
}

final class MemoryCurationTransportSuite extends CurationTransportContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] =
    Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresCurationTransportSuite extends CurationTransportContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
