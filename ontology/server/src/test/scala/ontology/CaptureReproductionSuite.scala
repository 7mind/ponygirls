package ontology

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import munit.FunSuite
import ontology.api.*
import ontology.domain.*
import java.util.UUID
import scala.util.Using

final class CaptureReproductionSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private val recorder = Actor("test-service", ActorKind.Service)
  private val at = "2026-11-11T00:00:00Z"
  private def example(): (IngestRequest, Principal) = {
    val scope = "capture-repro-" + UUID.randomUUID()
    val context = CaptureContext("native-fixture", None, None, LineageStatus.Unknown, "fixture-branch", UUID.randomUUID())
    val request = IngestRequest(scope, UUID.randomUUID(), UUID.randomUUID(), Some(ontology.TestContexts.claim(context)), None, EventOrigin.UserMessage, CaptureMetadata("e", None, None, SourceRepresentation.PiTranscript, Nil, Nil), "A transcript role, not authenticated Human authorship", Observation.None())
    request -> Principal("collector", Actor("collector", ActorKind.Collector), Set(scope), Set(Capability.Capture, Capability.Read))
  }
  private def fault[A](result: Either[Throwable, A], code: String): Unit = assertEquals(result.left.toOption.collect { case f: Fault => f.code }, Some(code))
  test("missing source frontier row is not a complete prefix") {
    RepositoryReproductionDatabase.resource.use { db => RepositoryReproductionDatabase.store(db).flatMap { repo =>
      val (request, principal) = example()
      for {
        first <- repo.ingest(request, principal, recorder, at, ontology.TestContexts.trace("fixture-ingest"))
        _ <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID()), principal, recorder, at, ontology.TestContexts.trace("fixture-ingest"))
        original <- repo.sources(SourceRequest(request.scope, 0L, 10))
        event = original.events.head
        _ <- db.transaction { c => Using.resource(c.prepareStatement("DELETE FROM ontology_captures WHERE scope = ? AND frontier = 1")) { s => s.setString(1, request.scope); assertEquals(s.executeUpdate(), 1) } }
        result <- repo.sources(SourceRequest(request.scope, 0L, 10)).attempt.guarantee(db.transaction { c =>
          Using.resource(c.prepareStatement("INSERT INTO ontology_captures(scope, source_namespace, event_id, capture_id, frontier, fingerprint, payload, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")) { s =>
            s.setString(1, request.scope); s.setString(2, principal.credentialId); s.setObject(3, request.eventId); s.setObject(4, event.id); s.setLong(5, 1L)
            s.setString(6, CaptureIdentity.fingerprint(principal.credentialId, request)); s.setString(7, StoredJson.encode(CapturedEvent.codecJson, event)); s.setString(8, StoredJson.encode(IngestResult.codecJson, first)); assertEquals(s.executeUpdate(), 1)
          }
        })
        _ = fault(result, "corrupt")
      } yield ()
    } }.unsafeRunSync()(using runtime)
  }
  test("captured attribution must agree with independently retained input receipt") {
    RepositoryReproductionDatabase.resource.use { db => RepositoryReproductionDatabase.store(db).flatMap { repo =>
      val (request, principal) = example()
      for {
        _ <- repo.ingest(request, principal, recorder, at, ontology.TestContexts.trace("fixture-ingest"))
        original <- repo.sources(SourceRequest(request.scope, 0L, 10))
        event = original.events.head
        altered = event.copy(provenance = event.provenance.copy(contributor = Actor("not-established-human", ActorKind.Human)))
        _ <- db.transaction { c => Using.resource(c.prepareStatement("UPDATE ontology_captures SET payload = ? WHERE scope = ? AND frontier = 1")) { s => s.setString(1, StoredJson.encode(CapturedEvent.codecJson, altered)); s.setString(2, request.scope); assertEquals(s.executeUpdate(), 1) } }
        result <- repo.sources(SourceRequest(request.scope, 0L, 10)).attempt.guarantee(db.transaction { c =>
          Using.resource(c.prepareStatement("UPDATE ontology_captures SET payload = ? WHERE scope = ? AND frontier = 1")) { s => s.setString(1, StoredJson.encode(CapturedEvent.codecJson, event)); s.setString(2, request.scope); assertEquals(s.executeUpdate(), 1) }
        })
        _ = fault(result, "corrupt")
      } yield ()
    } }.unsafeRunSync()(using runtime)
  }
  test("source listing cannot turn a disagreeing head counter into a complete prefix") {
    RepositoryReproductionDatabase.resource.use { db => RepositoryReproductionDatabase.store(db).flatMap { repo =>
      val (request, principal) = example()
      def setFrontier(value: Long): IO[Unit] = db.transaction { c =>
        Using.resource(c.prepareStatement("UPDATE ontology_scopes SET frontier = ? WHERE scope = ?")) { s =>
          s.setLong(1, value); s.setString(2, request.scope); assertEquals(s.executeUpdate(), 1)
        }
      }
      for {
        _ <- repo.ingest(request, principal, recorder, at, ontology.TestContexts.trace("fixture-ingest"))
        _ <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID()), principal, recorder, at, ontology.TestContexts.trace("fixture-ingest"))
        _ <- setFrontier(1L)
        outcomes <- (for {
          head <- repo.read(request.scope).attempt
          listing <- repo.sources(SourceRequest(request.scope, 0L, 10)).attempt
        } yield (head, listing)).guarantee(setFrontier(2L))
        _ = fault(outcomes._1, "corrupt")
        _ = fault(outcomes._2, "corrupt")
      } yield ()
    } }.unsafeRunSync()(using runtime)
  }
  test("source-page lookahead limit contract matches between adapters") {
    val scope = "empty-" + UUID.randomUUID()
    val request = SourceRequest(scope, 0L, Int.MaxValue)
    (for {
      memory <- new MemoryGraphRepository(new AdmissionEngine).sources(request).attempt
      postgres <- RepositoryReproductionDatabase.resource.evalMap(RepositoryReproductionDatabase.store).use(_.sources(request).attempt)
      _ = fault(memory, "source-page")
      _ = fault(postgres, "source-page")
    } yield ()).unsafeRunSync()(using runtime)
  }
}
