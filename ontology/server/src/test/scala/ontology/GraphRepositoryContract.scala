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
  protected def check(f: GraphRepository => IO[Unit]): Unit = repository.use(f).unsafeRunSync()(runtime)
  protected def request(scope: String, generation: Long, text: String): ApplyRequest = ApplyRequest(scope, UUID.randomUUID(), generation, List(Operation.Create("claim", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement(text, Modality.Assertion)), Nil)), None)
  protected def admission(r: ApplyRequest): Admission = Admission(ontology.TestContexts.principal(r.scope, Actor("test-agent", ActorKind.Agent)), Actor("test-host", ActorKind.Service), r.requestId, "2026-11-10T00:00:00Z", ontology.TestContexts.trace("fixture-apply"))
  private def scope(): String = "contract-" + UUID.randomUUID()
  private def reader(scope: String): Principal = Principal("reader", Actor("test-reader", ActorKind.Agent), Set(scope), Set(Capability.Read))
  private def query(repository: GraphRepository): GraphQueries = new GraphQueries(repository, new CursorSigner(Array.fill[Byte](32)(1)), QueryLimits(100, 100, 1024 * 1024, 1024))

  private def captureContext(): CaptureContext = CaptureContext("fixture-session", None, None, LineageStatus.Unknown, "fixture-branch", UUID.randomUUID())
  private def capturePrincipal(scope: String, kind: ActorKind, namespace: String): Principal = Principal(credentialId = namespace, actor = Actor(namespace, kind), scopes = Set(scope), capabilities = Set(Capability.Read, Capability.Capture, Capability.HostCapture))
  private val captureRecorder = Actor("ontology-test-service", ActorKind.Service)
  private val captureTime = "2026-11-10T00:00:00Z"
  private def sourceRequest(scope: String, context: CaptureContext, origin: EventOrigin, representation: SourceRepresentation, observation: Observation, text: String): IngestRequest =
    IngestRequest(scope, UUID.randomUUID(), UUID.randomUUID(), Some(ontology.TestContexts.claim(context)), None, origin, CaptureMetadata("fixture-entry", None, None, representation, Nil, Nil), text, observation)
  test("source, provenance, original submitted input, frontier and graph publish together") { check { repo =>
    val name = scope(); val principal = capturePrincipal(name, ActorKind.Human, "human-source")
    val request = sourceRequest(name, captureContext(), EventOrigin.UserMessage, SourceRepresentation.Text, Observation.None(), "Keep the unresolved intent: α\n\"quoted text\"")
    for {
      result <- repo.ingest(request, principal, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
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
      result <- repo.ingest(request, collector, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      graph <- repo.read(name)
      _ = assertEquals(Graph.node(graph, result.source).provenance.contributor.kind, ActorKind.Unknown)
      fake <- repo.ingest(request.copy(observation = Observation.FileVersion("input.txt", 1L, Digests.text("a"), 1L)), collector, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest")).attempt
      _ = assertEquals(fake.left.toOption.collect { case f: Fault => f.code }, Some("capture-origin"))
      sources <- repo.sources(SourceRequest(name, 0L, 10))
      _ = assertEquals(sources.frontier, 1L)
    } yield ()
  } }
  test("each immutable graph generation retains its own captured source frontier") { check { repo =>
    val name = scope(); val principal = capturePrincipal(name, ActorKind.Human, "human-source")
    val context = captureContext()
    val first = sourceRequest(name, context, EventOrigin.UserMessage, SourceRepresentation.Text, Observation.None(), "First source")
    val second = sourceRequest(name, context, EventOrigin.UserMessage, SourceRepresentation.Text, Observation.None(), "Later source")
    def frontier(snapshot: GraphSnapshot): Long = Wire.encode(GraphSnapshot.codecJson, snapshot).hcursor.get[Long]("sourceFrontier").fold(throw _, identity)
    for {
      one <- repo.ingest(first, principal, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      captured <- repo.read(name)
      mutation = request(name, captured.generation, "Interpretation does not add a source")
      applied <- repo.apply(mutation, admission(mutation))
      two <- repo.ingest(second, principal, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      initial <- repo.history(name, 0L)
      oldCapture <- repo.history(name, captured.generation)
      oldMutation <- repo.history(name, applied.generation)
      current <- repo.read(name)
      _ = assertEquals(frontier(initial), 0L)
      _ = assertEquals(frontier(oldCapture), one.frontier)
      _ = assertEquals(frontier(oldMutation), one.frontier)
      _ = assertEquals(frontier(current), two.frontier)
      _ = assertEquals(two.frontier, 2L)
    } yield ()
  } }
  test("event and transport replay are distinct and neither advances the source frontier") { check { repo =>
    val name = scope(); val principal = capturePrincipal(name, ActorKind.Agent, "agent-source")
    val request = sourceRequest(name, captureContext(), EventOrigin.WorkerMessage, SourceRepresentation.Text, Observation.None(), "Worker assertion")
    val repeated = request.copy(requestId = UUID.randomUUID())
    for {
      first <- repo.ingest(request, principal, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      same <- repo.ingest(request, principal, captureRecorder, "2026-11-10T01:00:00Z", ontology.TestContexts.trace("fixture-ingest"))
      newTransport <- repo.ingest(repeated, principal, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      changed <- repo.ingest(request.copy(requestId = UUID.randomUUID(), text = "Different source under same event id"), principal, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest")).attempt
      metadataChanged <- repo.ingest(request.copy(requestId = UUID.randomUUID(), metadata = request.metadata.copy(omissions = List("new omission"))), principal, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest")).attempt
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
      first <- repo.ingest(request, host, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      repeat <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID()), host, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      _ = assertEquals(repeat.artifacts, first.artifacts)
      absent <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID(), observation = Observation.FileAbsent("result.txt", 2L)), host, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      _ = assertEquals(absent.artifacts, Nil)
      late <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID()), host, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      _ = assertEquals(late.artifacts, first.artifacts)
      conflict <- repo.ingest(request.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID(), observation = Observation.FileVersion("result.txt", 2L, Digests.text("alpha"), 5L)), host, captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest")).attempt
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
      a <- repo.ingest(request, capturePrincipal(name, ActorKind.Collector, "source-a"), captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
      b <- repo.ingest(request, capturePrincipal(name, ActorKind.Collector, "source-b"), captureRecorder, captureTime, ontology.TestContexts.trace("fixture-ingest"))
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
      Operation.Create("question", ontology.TestAuthoring.applicability(TestApplicability.unresolved), ontology.TestAuthoring.content(question), Nil),
      Operation.Bind("binding", Target.Created("question"), Nil, "fixture"), Operation.SelectBinding("binding-selection", Target.Created("binding"), true, "Selected by this fixture", List(Target.Created("question"))),
      Operation.State("open", Target.Created("binding"), None, Phase.Open, None, None, Nil, "Unanswered")), None)
    for {
      first <- repo.apply(opened, admission(opened))
      binding = first.created.find(_.alias == "binding").get.ref
      previous = first.created.find(_.alias == "open").get.ref
      close = ApplyRequest(name, UUID.randomUUID(), first.generation, List(Operation.State("resolved", Target.Exact(binding), Some(previous), Phase.Resolved, None, Some("Investigation concluded without an answer"), Nil, "Human clarification remains necessary")), None)
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
  test("nested authoring publishes exact records and preserves original aliases atomically") { check { repo =>
    val name = scope()
    val applicability = ApplicabilityInput.Unresolved("Fixture does not assert semantic applicability", Nil, Nil)
    val r = ApplyRequest(name, UUID.randomUUID(), 0L, List(
      Operation.Create("question", applicability, ContentInput.Question("Which acceptance applies?", Nil, None, Escalation.Unresolved), Nil),
      Operation.Create("task", applicability, ContentInput.Task("Build", AcceptanceInput(Nil, Some(Target.Created("question"))), Execution.Delegated), Nil),
      Operation.Bind("binding", Target.Created("task"), Nil, "fixture"), Operation.SelectBinding("binding-selection", Target.Created("binding"), true, "Selected by this fixture", List(Target.Created("task"))),
      Operation.Create("review", applicability, ContentInput.Review("Review", Nil, List(Target.Created("binding")), List(Target.Created("question")), "No conclusion", Assessment.Unassessed), Nil),
      Operation.Create("defect", applicability, ContentInput.Defect("Gap", "Observed", "Expected", "Reproduction", List(Target.Created("binding")), Correction.Unresolved), Nil),
      Operation.Create("conflict", applicability, ContentInput.Conflict("Conflict", List(Target.Created("task")), ConflictState.Open, None, "Unresolved"), Nil)), None)
    for {
      result <- repo.apply(r, admission(r))
      graph <- repo.read(name)
      aliases = result.created.map(value => value.alias -> value.ref).toMap
      _ = assertEquals(Graph.node(graph, aliases("task")).content.asInstanceOf[Content.Task].acceptance.question, Some(aliases("question")))
      _ = assertEquals(Graph.node(graph, aliases("review")).content.asInstanceOf[Content.Review].subjects, List(aliases("binding")))
      _ = assertEquals(Graph.node(graph, aliases("defect")).content.asInstanceOf[Content.Defect].affected, List(aliases("binding")))
      _ = assertEquals(Graph.node(graph, aliases("conflict")).content.asInstanceOf[Content.Conflict].subjects, List(aliases("task")))
      receipt <- repo.input(name, Ref(graph.definitions.head.provenance.input, 1))
      _ = assertEquals(StoredJson.decode(ApplyRequest.codecJson, receipt.content), r)
      bad = ApplyRequest(name, UUID.randomUUID(), result.generation, List(
        Operation.Create("scratch", applicability, ContentInput.Statement("Would be rolled back", Modality.Assertion), Nil),
        Operation.Create("invalid", applicability, ContentInput.Task("Unknown acceptance", AcceptanceInput(Nil, Some(Target.Created("future"))), Execution.Delegated), Nil)), None)
      rejected <- repo.apply(bad, admission(bad)).attempt
      _ = assertEquals(rejected.left.toOption.collect { case f: Fault => f.code }, Some("reference"))
      after <- repo.read(name)
      _ = assertEquals(after, graph)
      missing <- repo.input(name, Ref(admission(bad).provenance.input, 1)).attempt
      _ = assertEquals(missing.left.toOption.collect { case f: Fault => f.code }, Some("not-found"))
    } yield ()
  } }
  test("gate witnesses persist while stale progress leaves Current but remains inspectable in History") { check { repo =>
    val name = scope()
    val input = AssessmentFixture.request(name, 0L, AssessmentFixture.operations)
    val principal = reader(name)
    val queries = query(repo)
    for {
      result <- repo.apply(input, AssessmentFixture.admission(input))
      snapshot <- repo.read(name)
      event = Graph.event(snapshot, AssessmentFixture.ref(result, "done"))
      _ = assert(event.gateBasis.references.contains(AssessmentFixture.ref(result, "use")))
      before <- queries.read(principal, ReadRequest(name, ReadView.Current, Nil, None, 100))
      _ = assert(before.records.exists(record => Graph.recordRef(record) == event.ref))
      revision = AssessmentFixture.request(name, result.generation, List(AssessmentFixture.changedReview(result)))
      _ <- repo.apply(revision, AssessmentFixture.admission(revision))
      current <- queries.read(principal, ReadRequest(name, ReadView.Current, Nil, None, 100))
      _ = assert(current.records.exists(record => Graph.recordRef(record) == event.subject))
      _ = assert(!current.records.exists(record => Graph.recordRef(record) == event.ref))
      history <- queries.read(principal, ReadRequest(name, ReadView.History, List(event.ref), None, 100))
      _ = assertEquals(history.records, List(GraphRecord.Progress(event)))
      context <- queries.read(principal, ReadRequest(name, ReadView.BindingContext, List(event.subject), None, 100))
      _ = assert(Gates.references(event.gateBasis).forall(ref => context.records.exists(record => Graph.recordRef(record) == ref)))
      stored <- repo.history(name, result.generation)
      _ = assertEquals(Graph.event(stored, event.ref), event)
    } yield ()
  } }
  test("planned selected work stays visible when its condition has no applicability-use account") { check { repo =>
    val name = scope()
    val plan = AssessmentFixture.operations.filter {
      case operation: Operation.Relate => operation.kind != RelationKind.UsesAssessment
      case _: Operation.State => false
      case _ => true
    } :+ Operation.State("planned", Target.Created("consumer"), None, Phase.Planned, None, None, Nil, "Use remains unresolved")
    val input = AssessmentFixture.request(name, 0L, plan)
    val principal = reader(name)
    val queries = query(repo)
    for {
      result <- repo.apply(input, AssessmentFixture.admission(input))
      current <- queries.read(principal, ReadRequest(name, ReadView.Current, Nil, None, 100))
      _ = assert(current.records.exists(record => Graph.recordRef(record) == AssessmentFixture.ref(result, "consumer")))
      _ = assert(current.records.exists(record => Graph.recordRef(record) == AssessmentFixture.ref(result, "planned")))
    } yield ()
  } }
  List(Consumption.Current, Consumption.Historical).foreach { consumption =>
    test(s"$consumption consumption treats a predecessor's stale gate warrant explicitly") { check { repo =>
      val name = scope()
      val input = AssessmentFixture.request(name, 0L, AssessmentFixture.operations)
      val principal = reader(name)
      val queries = query(repo)
      for {
        upstream <- repo.apply(input, AssessmentFixture.admission(input))
        dependency = RelationDetailInput.Dependency(Gate.Completion, consumption, if (consumption == Consumption.Historical) Some(Target.Exact(AssessmentFixture.ref(upstream, "done"))) else None, "Explicit historical work reuse, not current support")
        child = AssessmentFixture.request(name, upstream.generation, List(
          Operation.Create("child", AssessmentFixture.applicability, ContentInput.Task("Downstream", AcceptanceInput(List("Declared outcome"), None), Execution.Delegated), Nil),
          Operation.Relate("dependency", AssessmentFixture.applicability, RelationKind.DependsOn, List(Target.Created("child")), List(Target.Exact(AssessmentFixture.ref(upstream, "consumer"))), dependency, "Completed predecessor needed"),
          Operation.Bind("child-binding", Target.Created("child"), List(Target.Created("dependency")), "fixture"),
          Operation.SelectBinding("selected", Target.Created("child-binding"), true, "Explicit downstream contract", List(Target.Created("child"))),
          Operation.State("active", Target.Created("child-binding"), None, Phase.Active, None, None, Nil, "Reported only")))
        downstream <- repo.apply(child, AssessmentFixture.admission(child))
        revised = AssessmentFixture.request(name, downstream.generation, List(AssessmentFixture.changedReview(upstream)))
        changed <- repo.apply(revised, AssessmentFixture.admission(revised))
        current <- queries.read(principal, ReadRequest(name, ReadView.Current, Nil, None, 100))
        _ = assertEquals(current.records.exists(record => Graph.recordRef(record) == AssessmentFixture.ref(downstream, "active")), consumption == Consumption.Historical)
        next = AssessmentFixture.request(name, changed.generation, List(Operation.State("again", Target.Exact(AssessmentFixture.ref(downstream, "child-binding")), Some(AssessmentFixture.ref(downstream, "active")), Phase.Active, None, None, Nil, "Reported only")))
        admitted <- repo.apply(next, AssessmentFixture.admission(next)).attempt
        _ = if (consumption == Consumption.Current) assertEquals(admitted.left.toOption.collect { case fault: Fault => fault.code }, Some("assessment-use")) else assert(admitted.isRight)
        history <- repo.history(name, downstream.generation)
        _ = assert(history.events.exists(_.ref == AssessmentFixture.ref(downstream, "active")))
      } yield ()
    } }
  }
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
      bad <- repo.apply(r.copy(operations = List(Operation.Create("claim", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("Changed", Modality.Assertion)), Nil))), admission(r)).attempt
      head <- repo.read(r.scope)
      _ = assertEquals(bad.left.toOption.collect { case f: Fault => f.code }, Some("replay-conflict"))
      _ = assertEquals(Graph.text(head.definitions.head.content), "Original")
    } yield ()
  } }
  test("failed batch leaves no partial head, history or request receipt") { check { repo =>
    val good = request(scope(), 0L, "Candidate")
    val bad = good.copy(operations = good.operations :+ Operation.Bind("bad", Target.Created("missing"), Nil, "fixture"))
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
final class MemoryGraphRepositorySuite extends ContextRepositoryContract {
  protected def repository: Resource[IO, GraphRepository] = Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine)))
}
