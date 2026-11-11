package ontology

import cats.effect.IO
import cats.syntax.all.*
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
          Using.resource(c.prepareStatement("INSERT INTO ontology_captures(scope, source_namespace, event_id, capture_id, frontier, fingerprint, payload, result, input_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Capture')")) { s =>
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
  List("head", "history", "sources", "input").foreach { boundary =>
    test(s"$boundary rejects a graph Source that disagrees with its retained capture") {
      RepositoryReproductionDatabase.resource.use { db => RepositoryReproductionDatabase.store(db).flatMap { repo =>
        val (request, principal) = example()
        for {
          result <- repo.ingest(request, principal, recorder, at, TestContexts.trace("fixture-ingest"))
          original <- repo.read(request.scope)
          source = Graph.node(original, result.source)
          content = source.content.asInstanceOf[Content.Source]
          different = "Another valid account, not this captured input"
          altered = original.copy(definitions = original.definitions.map(node => if (node.ref == source.ref) node.copy(content = content.copy(text = different, rawDigest = Digests.text(different))) else node))
          table = if (boundary == "history") "ontology_revisions" else "ontology_scopes"
          set = (value: GraphSnapshot) => db.transaction { connection =>
            Using.resource(connection.prepareStatement(s"UPDATE $table SET snapshot = ? WHERE scope = ? AND generation = ?")) { statement =>
              statement.setString(1, StoredJson.encode(GraphSnapshot.codecJson, value)); statement.setString(2, request.scope); statement.setLong(3, original.generation)
              assertEquals(statement.executeUpdate(), 1)
            }
          }
          _ <- set(altered)
          checked <- (boundary match {
            case "head" => repo.read(request.scope).void
            case "history" => repo.history(request.scope, original.generation).void
            case "sources" => repo.sources(SourceRequest(request.scope, 0L, 10)).void
            case "input" => repo.input(request.scope, Ref(source.provenance.input, 1)).void
          }).attempt.guarantee(set(original))
          _ = fault(checked, "corrupt")
        } yield ()
      } }.unsafeRunSync()(using runtime)
    }
  }
  test("swapped valid execution roles cannot detach a retained input from its captured Source") {
    RepositoryReproductionDatabase.resource.use { db => RepositoryReproductionDatabase.store(db).flatMap { repo =>
      val scope = "execution-roles-" + UUID.randomUUID()
      val host = Actor("fixture-host", ActorKind.Service)
      val principal = Principal("host", host, Set(scope), Set(Capability.Capture, Capability.HostCapture))
      val occurrence = Some(TestContexts.claim(CaptureContext("fixture-host", None, None, LineageStatus.Unknown, "fixture", UUID.randomUUID())))
      def request(value: Observation): IngestRequest = IngestRequest(scope, UUID.randomUUID(), UUID.randomUUID(), occurrence, None, EventOrigin.ToolOutput,
        CaptureMetadata("fixture", None, None, SourceRepresentation.HostReceipt, Nil, Nil), "Synthetic execution evidence", value)
      def capture(value: Observation): IO[IngestResult] = repo.ingest(request(value), principal, recorder, at, TestContexts.trace("fixture"))
      for {
        input <- capture(Observation.FileVersion("in", 1L, Digests.text("in"), 2L))
        output <- capture(Observation.FileVersion("out", 1L, Digests.text("out"), 3L))
        execution = request(Observation.Execution("run", "fixture", None, input.artifacts, output.artifacts, Some(1), true))
        recorded <- repo.ingest(execution, principal, recorder, at, TestContexts.trace("fixture"))
        graph <- repo.read(scope)
        receipt <- repo.input(scope, Ref(Graph.node(graph, recorded.source).provenance.input, 1))
        swapped = execution.copy(observation = execution.observation.asInstanceOf[Observation.Execution].copy(inputs = output.artifacts, outputs = input.artifacts))
        content = StoredJson.encode(IngestRequest.codecJson, swapped)
        changed = receipt.copy(content = content, digest = Digests.text(content))
        set = (value: InputReceipt) => db.transaction { connection => Using.resource(connection.prepareStatement("UPDATE ontology_inputs SET payload = ? WHERE scope = ? AND input_id = ?")) { statement =>
          statement.setString(1, StoredJson.encode(InputReceipt.codecJson, value)); statement.setString(2, scope); statement.setObject(3, receipt.ref.id)
          assertEquals(statement.executeUpdate(), 1)
        } }
        results <- (set(changed) *> List(repo.read(scope).void, repo.sources(SourceRequest(scope, 0L, 10)).void, repo.input(scope, receipt.ref).void).traverse(_.attempt)).guarantee(set(receipt))
        _ = results.foreach(result => fault(result, "corrupt"))
      } yield ()
    } }.unsafeRunSync()(using runtime)
  }
  test("source-page lookahead limit contract matches between adapters") {
    val scope = "empty-" + UUID.randomUUID()
    val request = SourceRequest(scope, 0L, Int.MaxValue)
    (for {
      memory <- new MemoryGraphRepository(new AdmissionEngine, TestReview.domain).sources(request).attempt
      postgres <- RepositoryReproductionDatabase.resource.evalMap(RepositoryReproductionDatabase.store).use(_.sources(request).attempt)
      _ = fault(memory, "source-page")
      _ = fault(postgres, "source-page")
    } yield ()).unsafeRunSync()(using runtime)
  }
}
