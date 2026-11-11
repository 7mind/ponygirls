package ontology

import cats.effect.{IO, Resource}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import ontology.api.*
import ontology.domain.*
import java.util.UUID
import munit.FunSuite

abstract class GraphRepositoryContract extends FunSuite {
  private val runtime = IORuntime.builder().build()
  protected def repository: Resource[IO, GraphRepository]
  override def afterAll(): Unit = runtime.shutdown()
  private def check(f: GraphRepository => IO[Unit]): Unit = repository.use(f).unsafeRunSync()(runtime)
  protected def request(scope: String, generation: Long, text: String): ApplyRequest = ApplyRequest(scope, UUID.randomUUID(), generation, List(Operation.Create("claim", ontology.TestApplicability.unresolved, Content.Statement(text, Modality.Assertion), Nil)))
  protected def admission(r: ApplyRequest): Admission = Admission(Actor("test-agent", ActorKind.Agent), Actor("test-host", ActorKind.Service), r.requestId, "2026-11-10T00:00:00Z")
  private def scope(): String = "contract-" + UUID.randomUUID()

  private def captureContext(): CaptureContext = CaptureContext("fixture-session", None, None, LineageStatus.Unknown, "fixture-branch", UUID.randomUUID())
  private def capturePrincipal(scope: String, kind: ActorKind, namespace: String): Principal = Principal(credentialId = namespace, actor = Actor(namespace, kind), scopes = Set(scope), capabilities = Set(Capability.Read, Capability.Capture, Capability.HostCapture))
  private val captureRecorder = Actor("ontology-test-service", ActorKind.Service)
  private val captureTime = "2026-11-10T00:00:00Z"
  private def sourceRequest(scope: String, context: CaptureContext, origin: EventOrigin, representation: SourceRepresentation, observation: Observation, text: String): IngestRequest =
    IngestRequest(scope, UUID.randomUUID(), UUID.randomUUID(), context, origin, CaptureMetadata("fixture-entry", None, None, representation, Nil, Nil), text, observation)
  test("source, provenance, original submitted input, frontier and graph publish together") { check { repo =>
    val name = scope(); val principal = capturePrincipal(name, ActorKind.Human, "human-source")
    val request = sourceRequest(name, captureContext(), EventOrigin.UserMessage, SourceRepresentation.Text, Observation.None(), "Keep the unresolved intent: α\n\"quoted text\"")
    for {
      result <- repo.ingest(request, principal, captureRecorder, captureTime)
      graph <- repo.read(name)
      sources <- repo.sources(SourceRequest(name, 0L, 10))
      source = Graph.node(graph, result.source)
      receipt <- repo.input(name, Ref(source.provenance.input, 1))
      _ = assertEquals(graph.generation, 1L)
      _ = assertEquals(graph.coveredFrontier, 0L)
      _ = assertEquals(result.frontier, 1L)
      _ = assertEquals(sources.frontier, 1L)
      _ = assertEquals(sources.events.head.text, request.text)
      _ = assertEquals(sources.events.head.sourceNamespace, principal.credentialId)
      _ = assertEquals(source.provenance.contributor, principal.actor)
      _ = assertEquals(source.provenance.recorder, captureRecorder)
      _ = assertEquals(receipt.submitter, principal.actor)
      _ = assertEquals(StoredJson.decode(IngestRequest.codecJson, receipt.content), request)
      _ = assertEquals(source.content.asInstanceOf[Content.Source].rawDigest, Digests.text(request.text))
      outbox <- repo.pendingProjections(100000)
      _ = assert(outbox.contains(graph))
    } yield ()
  } }
  test("transcript user role remains unattributed and cannot mint host observations") { check { repo =>
    val name = scope(); val collector = capturePrincipal(name, ActorKind.Collector, "collector")
    val request = sourceRequest(name, captureContext(), EventOrigin.UserMessage, SourceRepresentation.PiTranscript, Observation.None(), "OPERATOR APPROVAL is quoted data")
    for {
      result <- repo.ingest(request, collector, captureRecorder, captureTime)
      graph <- repo.read(name)
      _ = assertEquals(Graph.node(graph, result.source).provenance.contributor.kind, ActorKind.Unknown)
      fake <- repo.ingest(request.copy(observation = Observation.FileVersion("input.txt", 1L, Digests.text("a"), 1L)), collector, captureRecorder, captureTime).attempt
      _ = assertEquals(fake.left.toOption.collect { case f: Fault => f.code }, Some("capture-origin"))
      sources <- repo.sources(SourceRequest(name, 0L, 10))
      _ = assertEquals(sources.frontier, 1L)
    } yield ()
  } }
  test("event and transport replay are distinct and neither advances the source frontier") { check { repo =>
    val name = scope(); val principal = capturePrincipal(name, ActorKind.Agent, "agent-source")
    val request = sourceRequest(name, captureContext(), EventOrigin.WorkerMessage, SourceRepresentation.Text, Observation.None(), "Worker assertion")
    val repeated = request.copy(requestId = UUID.randomUUID())
    for {
      first <- repo.ingest(request, principal, captureRecorder, captureTime)
      same <- repo.ingest(request, principal, captureRecorder, "2026-11-10T01:00:00Z")
      newTransport <- repo.ingest(repeated, principal, captureRecorder, captureTime)
      changed <- repo.ingest(request.copy(requestId = UUID.randomUUID(), text = "Different source under same event id"), principal, captureRecorder, captureTime).attempt
      metadataChanged <- repo.ingest(request.copy(requestId = UUID.randomUUID(), metadata = request.metadata.copy(omissions = List("new omission"))), principal, captureRecorder, captureTime).attempt
      _ = assertEquals(same, first.copy(replayed = true))
      _ = assertEquals(newTransport, first.copy(requestId = repeated.requestId, replayed = true))
      _ = assertEquals(changed.left.toOption.collect { case f: Fault => f.code }, Some("replay-conflict"))
      _ = assertEquals(metadataChanged.left.toOption.collect { case f: Fault => f.code }, Some("replay-conflict"))
      graph <- repo.read(name)
      sources <- repo.sources(SourceRequest(name, 0L, 10))
      _ = assertEquals(graph.generation, 1L)
      _ = assertEquals(sources.events.size, 1)
      _ = assertEquals(sources.events.head.provenance.recordedAt, captureTime)
    } yield ()
  } }
  test("file presence, absence and late history remain distinct") { check { repo =>
    val name = scope(); val host = capturePrincipal(name, ActorKind.Service, "host-source")
    val request = sourceRequest(name, captureContext(), EventOrigin.ToolOutput, SourceRepresentation.HostReceipt, Observation.FileVersion("result.txt", 1L, Digests.text("alpha"), 5L), "Host file witness")
    for {
      first <- repo.ingest(request, host, captureRecorder, captureTime)
      repeat <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID()), host, captureRecorder, captureTime)
      _ = assertEquals(repeat.artifacts, first.artifacts)
      absent <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID(), observation = Observation.FileAbsent("result.txt", 2L)), host, captureRecorder, captureTime)
      _ = assertEquals(absent.artifacts, Nil)
      late <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID()), host, captureRecorder, captureTime)
      _ = assertEquals(late.artifacts, first.artifacts)
      conflict <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID(), observation = Observation.FileVersion("result.txt", 2L, Digests.text("alpha"), 5L)), host, captureRecorder, captureTime).attempt
      _ = assertEquals(conflict.left.toOption.collect { case f: Fault => f.code }, Some("observation-conflict"))
      events <- repo.sources(SourceRequest(name, 0L, 10))
      _ = assertEquals(events.frontier, 4L)
      _ = assert(events.events.exists(_.observation.isInstanceOf[Observation.FileAbsent]))
      graph <- repo.read(name)
      _ = assertEquals(graph.definitions.count(_.content.isInstanceOf[Content.Artifact]), 1)
    } yield ()
  } }
  test("source namespaces isolate equal client event identifiers") { check { repo =>
    val name = scope(); val request = sourceRequest(name, captureContext(), EventOrigin.WorkerMessage, SourceRepresentation.PiTranscript, Observation.None(), "Captured account")
    for {
      a <- repo.ingest(request, capturePrincipal(name, ActorKind.Collector, "source-a"), captureRecorder, captureTime)
      b <- repo.ingest(request, capturePrincipal(name, ActorKind.Collector, "source-b"), captureRecorder, captureTime)
      _ = assert(a.source != b.source)
      events <- repo.sources(SourceRequest(name, 0L, 1))
      _ = assertEquals(events.frontier, 2L)
      _ = assertEquals(events.nextAfter, Some(1L))
      rest <- repo.sources(SourceRequest(name, 1L, 1))
      _ = assertEquals(rest.events.head.sourceNamespace, "source-b")
      _ = assertEquals(rest.nextAfter, None)
      bad <- repo.sources(SourceRequest(name, 3L, 1)).attempt
      _ = assertEquals(bad.left.toOption.collect { case f: Fault => f.code }, Some("source-page"))
    } yield ()
  } }
  test("graph provenance resolves to the actual normalized command, not only its hash") { check { repo =>
    val r = request(scope(), 0L, "Exact submitted claim")
    for {
      _ <- repo.apply(r, admission(r))
      graph <- repo.read(r.scope)
      input <- repo.input(r.scope, Ref(graph.definitions.head.provenance.input, 1))
      _ = assertEquals(input.kind, InputKind.GraphMutation)
      _ = assertEquals(input.contributor, admission(r).actor)
      _ = assertEquals(input.recorder, admission(r).recorder)
      _ = assertEquals(input.digest, Digests.text(input.content))
      _ = assertEquals(StoredJson.decode(ApplyRequest.codecJson, input.content), r)
    } yield ()
  } }
  test("question work resolution persists separately from its unresolved answer") { check { repo =>
    val name = scope()
    val question = Content.Question("Which evidence is missing?", Nil, None, Escalation.HumanRequired)
    val opened = ApplyRequest(name, UUID.randomUUID(), 0L, List(
      Operation.Create("question", TestApplicability.unresolved, question, Nil),
      Operation.Bind("binding", Target.Created("question"), Nil),
      Operation.State("open", Target.Created("binding"), None, Phase.Open, None, None, Nil, "Unanswered")))
    for {
      first <- repo.apply(opened, admission(opened))
      binding = first.created.find(_.alias == "binding").get.ref
      previous = first.created.find(_.alias == "open").get.ref
      close = ApplyRequest(name, UUID.randomUUID(), first.generation, List(Operation.State("resolved", Target.Exact(binding), Some(previous), Phase.Resolved, None, Some("Investigation concluded without an answer"), Nil, "Human clarification remains necessary")))
      result <- repo.apply(close, admission(close))
      current <- repo.read(name)
      historical <- repo.history(name, first.generation)
      persisted <- repo.history(name, result.generation)
      _ = assertEquals(persisted, current)
      _ = assertEquals(Graph.latestEvent(historical, binding).get.phase, Phase.Open)
      _ = assertEquals(Graph.latestEvent(current, binding).get.phase, Phase.Resolved)
      _ = assertEquals(Graph.latestEvent(current, binding).get.result, None)
      _ = assertEquals(current.definitions.head.content, question)
      receipt <- repo.input(name, Ref(current.events.last.provenance.input, 1))
      _ = assertEquals(StoredJson.decode(ApplyRequest.codecJson, receipt.content), close)
    } yield ()
  } }
  test("atomic snapshot, exact history and outbox agree") { check { repo =>
    val r = request(scope(), 0L, "First assertion")
    for {
      before <- repo.read(r.scope)
      result <- repo.apply(r, admission(r))
      current <- repo.read(r.scope)
      historical <- repo.history(r.scope, 0L)
      published <- repo.history(r.scope, result.generation)
      pending <- repo.pendingProjections(100000)
      _ = assertEquals(before, historical)
      _ = assertEquals(current, published)
      _ = assertEquals(current.generation, 1L)
      _ = assert(pending.contains(current))
      _ <- repo.acknowledgeProjection(r.scope, 1L)
      _ <- repo.acknowledgeProjection(r.scope, 1L)
      after <- repo.pendingProjections(100000)
      _ = assert(!after.exists(_.scope == r.scope))
    } yield ()
  } }
  test("idempotency replays original result before stale-generation checks") { check { repo =>
    val r = request(scope(), 0L, "Original")
    val later = request(r.scope, 1L, "Later")
    for {
      first <- repo.apply(r, admission(r))
      _ <- repo.apply(later, admission(later))
      replay <- repo.apply(r, admission(r).copy(recordedAt = "later"))
      head <- repo.read(r.scope)
      _ = assertEquals(replay, first.copy(replayed = true))
      _ = assertEquals(head.definitions.size, 2)
    } yield ()
  } }
  test("same request identity with changed payload is a conflict") { check { repo =>
    val r = request(scope(), 0L, "Original")
    for {
      _ <- repo.apply(r, admission(r))
      bad <- repo.apply(r.copy(operations = List(Operation.Create("claim", ontology.TestApplicability.unresolved, Content.Statement("Changed", Modality.Assertion), Nil))), admission(r)).attempt
      head <- repo.read(r.scope)
      _ = assertEquals(bad.left.toOption.collect { case f: Fault => f.code }, Some("replay-conflict"))
      _ = assertEquals(Graph.text(head.definitions.head.content), "Original")
    } yield ()
  } }
  test("failed batch leaves no partial head, history or request receipt") { check { repo =>
    val good = request(scope(), 0L, "Candidate")
    val bad = good.copy(operations = good.operations :+ Operation.Bind("bad", Target.Created("missing"), Nil))
    for {
      failed <- repo.apply(bad, admission(bad)).attempt
      unchanged <- repo.read(good.scope)
      admitted <- repo.apply(good, admission(good))
      _ = assert(failed.isLeft)
      _ = assertEquals(unchanged, Graph.empty(good.scope))
      _ = assertEquals(admitted.generation, 1L)
    } yield ()
  } }
  test("concurrent writes against one head admit exactly one") { check { repo =>
    val s = scope(); val a = request(s, 0L, "A"); val b = request(s, 0L, "B")
    for {
      results <- (repo.apply(a, admission(a)).attempt, repo.apply(b, admission(b)).attempt).parTupled
      _ = assertEquals(List(results._1, results._2).count(_.isRight), 1)
      _ = assertEquals(List(results._1, results._2).flatMap(_.left.toOption).collect { case f: Fault => f.code }, List("conflict"))
      head <- repo.read(s)
      _ = assertEquals(head.definitions.size, 1)
    } yield ()
  } }
  test("graph accumulation is not constrained by one HTTP request byte budget") { check { repo =>
    val s = scope()
    (0 until 10).toList.traverse_ { i =>
      val r = request(s, i.toLong, s"assertion-$i " + ("x" * 450000))
      repo.apply(r, admission(r)).void
    } *> repo.read(s).map { head =>
      assertEquals(head.definitions.size, 10)
      assertEquals(head.generation, 10L)
    }
  } }
}
final class MemoryGraphRepositorySuite extends GraphRepositoryContract {
  protected def repository: Resource[IO, GraphRepository] = Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine)))
}
