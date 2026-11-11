package ontology

import cats.effect.IO
import cats.syntax.all.*
import ontology.api.*
import ontology.domain.*
import java.util.UUID

abstract class ContextRepositoryContract extends GraphRepositoryContract {
  private def name(): String = "context-" + UUID.randomUUID()
  private val recorder = Actor("context-fixture-host", ActorKind.Service)
  private def trace(): RequestTrace = TestContexts.trace("fixture-context")
  private def native(session: String): CaptureContext = CaptureContext(session, Some("root"), None, LineageStatus.Recorded, "branch", UUID.randomUUID())
  private def collector(scope: String): Principal = Principal("collector", Actor("collector", ActorKind.Collector), Set(scope), Set(Capability.Capture))
  private def source(scope: String, occurrence: Option[ContextRecordInput], contribution: Option[ContextRecordInput]): IngestRequest =
    IngestRequest(scope, UUID.randomUUID(), UUID.randomUUID(), occurrence, contribution, EventOrigin.UserMessage,
      CaptureMetadata("fixture-source", None, None, SourceRepresentation.PiTranscript, Nil, Nil), "Controlled account", Observation.None())
  private def code[A](result: Either[Throwable, A]): Option[String] = result.left.toOption.collect { case f: Fault => f.code }
  private def cut(graph: GraphSnapshot, ref: Ref): ReportedInheritance =
    ReportedInheritance(InheritanceKind.Import, graph.scope, graph.generation, graph.sourceFrontier, graph.coveredFrontier, Nil, List(ref), None)
  private def applyWith(repo: GraphRepository, input: ApplyRequest, readable: Set[String]): IO[ApplyResult] = {
    val base = admission(input)
    repo.apply(input, base.copy(principal = base.principal.copy(scopes = readable + input.scope)))
  }

  test("absent occurrence and contribution stay unknown while actual ingress is retained") { check { repo =>
    val scope = name(); val input = source(scope, None, None); val ingress = trace()
    for {
      captured <- repo.ingest(input, collector(scope), recorder, "fixture", ingress)
      graph <- repo.read(scope)
      definition = Graph.node(graph, captured.source)
      receipt <- repo.input(scope, Ref(definition.provenance.input, 1))
      _ = assertEquals(definition.content.asInstanceOf[Content.Source].captureContext, ContextRecord(OriginContext.Unknown(Contexts.MissingOccurrence), Nil))
      _ = assertEquals(receipt.contributionContext, ContextRecord(OriginContext.Unknown(Contexts.MissingContribution), Nil))
      _ = assertEquals(receipt.ingress, ingress)
      _ = assertEquals(receipt.contributor.kind, ActorKind.Unknown)
      command = request(scope, graph.generation, "An interpretation citing this source").copy(operations = List(Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Interpretation", Modality.Assertion), List(Target.Exact(captured.source)))))
      _ <- repo.apply(command, admission(command))
      contributed <- repo.input(scope, Ref(admission(command).provenance.input, 1))
      _ = assertEquals(contributed.contributionContext, ContextRecord(OriginContext.Unknown(Contexts.MissingContribution), Nil))
    } yield ()
  } }

  test("server-owned internal contribution uses request context without inventing native metadata") { check { repo =>
    val input = request(name(), 0L, "Internal maintenance")
    val ingress = RequestTrace(UUID.randomUUID(), "curation-publication", RequestTransport.Internal)
    val admitted = admission(input).copy(ingress = ingress)
    for {
      result <- repo.apply(input, admitted)
      receipt <- repo.input(input.scope, Ref(admitted.provenance.input, 1))
      replay <- repo.apply(input, admitted.copy(ingress = trace()))
      retained <- repo.input(input.scope, receipt.ref)
      _ = assertEquals(receipt.contributionContext, ContextRecord(OriginContext.ServiceRequest(ingress), Nil))
      _ = assertEquals(receipt.ingress, ingress)
      _ = assertEquals(replay, result.copy(replayed = true))
      _ = assertEquals(retained, receipt)
    } yield ()
  } }

  test("occurrence A, contribution B and ingress stay independent through both replay identities") { check { repo =>
    val scope = name(); val occurrence = native("occurrence-A"); val contribution = native("contribution-B")
    val input = source(scope, Some(TestContexts.claim(occurrence)), Some(TestContexts.claim(contribution)))
    val changed = input.copy(contributionContext = Some(TestContexts.claim(native("different-contribution"))))
    val ingress = trace()
    for {
      original <- repo.ingest(input, collector(scope), recorder, "original", ingress)
      graph <- repo.read(scope)
      receipt <- repo.input(scope, Ref(Graph.node(graph, original.source).provenance.input, 1))
      same <- repo.ingest(input, collector(scope), recorder, "later", trace())
      conflict <- repo.ingest(changed, collector(scope), recorder, "later", trace()).attempt
      eventReplay <- repo.ingest(changed.copy(requestId = UUID.randomUUID()), collector(scope), recorder, "later", trace())
      retained <- repo.input(scope, receipt.ref)
      after <- repo.read(scope)
      events <- repo.sources(SourceRequest(scope, 0L, 10))
      _ = assertEquals(events.events.head.context, TestContexts.reported(occurrence))
      _ = assertEquals(receipt.contributionContext, TestContexts.reported(contribution))
      _ = assertEquals(receipt.ingress, ingress)
      _ = assertEquals(same, original.copy(replayed = true))
      _ = assertEquals(code(conflict), Some("replay-conflict"))
      _ = assert(eventReplay.replayed)
      _ = assertEquals(eventReplay.source, original.source)
      _ = assertEquals(retained, receipt)
      _ = assertEquals(after, graph)
    } yield ()
  } }

  test("reported inherited source cuts remain pinned when the source head advances") { check { repo =>
    val origin = name(); val destination = name(); val parent = native("parent")
    val first = source(origin, Some(TestContexts.claim(parent)), None)
    for {
      captured <- repo.ingest(first, collector(origin), recorder, "first", trace())
      frozen <- repo.read(origin)
      _ <- repo.ingest(first.copy(requestId = UUID.randomUUID(), eventId = UUID.randomUUID(), text = "Later source"), collector(origin), recorder, "later", trace())
      inherited = cut(frozen, captured.source).copy(kind = InheritanceKind.Fork, anchor = Some(InheritanceAnchor.ReportedParent(captured.source, parent.epoch)))
      child = native("child").copy(parentSessionId = Some(parent.sessionId))
      context = ContextRecordInput(OriginContextInput.ReportedNative(child), List(inherited))
      input = request(destination, 0L, "New contribution using a reported frozen cut").copy(contributionContext = Some(context))
      result <- applyWith(repo, input, Set(origin))
      receipt <- repo.input(destination, Ref(admission(input).provenance.input, 1))
      changed <- applyWith(repo, input.copy(contributionContext = Some(context.copy(reportedInherited = List(inherited.copy(sourceFrontier = 2L))))), Set(origin)).attempt
      replay <- applyWith(repo, input, Set(origin))
      _ = assertEquals(receipt.contributionContext, ContextRecord(OriginContext.ReportedNative(child), List(inherited)))
      _ = assert(child.epoch != parent.epoch)
      _ = assertEquals(code(changed), Some("replay-conflict"))
      _ = assertEquals(replay, result.copy(replayed = true))
    } yield ()
  } }

  test("all inherited namespaces require Read before any source snapshot lookup") { check { repo =>
    val destination = name(); val missing = name(); val forbidden = name()
    val claims = List(missing, forbidden).map(scope => ReportedInheritance(InheritanceKind.Import, scope, 0L, 0L, 0L, Nil, Nil, None))
    val context = ContextRecordInput(OriginContextInput.Unknown("No native session claimed"), claims)
    val input = request(destination, 0L, "Must not be published").copy(contributionContext = Some(context))
    for {
      result <- applyWith(repo, input, Set(missing)).attempt
      _ = assertEquals(code(result), Some("forbidden"))
      graph <- repo.read(destination)
      _ = assertEquals(graph.generation, 0L)
      receipt <- repo.input(destination, Ref(admission(input).provenance.input, 1)).attempt
      _ = assertEquals(code(receipt), Some("not-found"))
      captureInput = source(destination, Some(context), None)
      capturePrincipal = collector(destination).copy(scopes = Set(destination, missing), capabilities = Set(Capability.Capture, Capability.Read))
      captureResult <- repo.ingest(captureInput, capturePrincipal, recorder, "fixture", trace()).attempt
      _ = assertEquals(code(captureResult), Some("forbidden"))
      after <- repo.read(destination)
      _ = assertEquals(after, graph)
    } yield ()
  } }

  test("inherited cuts require exact generation, both frontiers and correctly typed exact references") { check { repo =>
    val origin = name(); val destination = name()
    for {
      captured <- repo.ingest(source(origin, None, None), collector(origin), recorder, "fixture", trace())
      task = request(origin, 1L, "unused").copy(operations = List(
        Operation.Create("task", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Task("Task", AcceptanceInput(List("Controlled criterion"), None), Execution.Delegated), Nil),
        Operation.Bind("binding", Target.Created("task"), Nil, "fixture")))
      bound <- repo.apply(task, admission(task))
      graph <- repo.read(origin)
      binding = bound.created.find(_.alias == "binding").get.ref
      definition = bound.created.find(_.alias == "task").get.ref
      valid = cut(graph, captured.source).copy(bindingRefs = List(binding))
      context = ContextRecordInput(OriginContextInput.Unknown("Import without native lineage"), List(valid))
      input = request(destination, 0L, "Retained import claim").copy(contributionContext = Some(context))
      accepted <- applyWith(repo, input, Set(origin))
      variants = List(
        valid.copy(sourceFrontier = valid.sourceFrontier + 1L) -> "context",
        valid.copy(coveredFrontier = valid.coveredFrontier + 1L) -> "context",
        valid.copy(generation = graph.generation + 1L) -> "not-found",
        valid.copy(bindingRefs = List(captured.source)) -> "context",
        valid.copy(sourceRefs = List(definition)) -> "context",
        valid.copy(sourceRefs = List(captured.source.copy(revision = 2))) -> "reference")
      _ <- variants.traverse_ { case (invalid, expected) =>
        val rejected = input.copy(requestId = UUID.randomUUID(), expectedGeneration = accepted.generation, contributionContext = Some(context.copy(reportedInherited = List(invalid))))
        applyWith(repo, rejected, Set(origin)).attempt.map(result => assertEquals(code(result), Some(expected)))
      }
      after <- repo.read(destination)
      _ = assertEquals(after.generation, accepted.generation)
    } yield ()
  } }

  test("parent matching checks reported parent, root and source epoch without equating child epochs") { check { repo =>
    val origin = name(); val destination = name(); val parent = native("parent")
    for {
      captured <- repo.ingest(source(origin, Some(TestContexts.claim(parent)), None), collector(origin), recorder, "fixture", trace())
      graph <- repo.read(origin)
      child = native("child").copy(parentSessionId = Some(parent.sessionId))
      inherited = cut(graph, captured.source).copy(kind = InheritanceKind.Fork, anchor = Some(InheritanceAnchor.ReportedParent(captured.source, parent.epoch)))
      unknown = CaptureContext("child", None, None, LineageStatus.Unknown, "branch", UUID.randomUUID())
      variants = List(
        TestContexts.claim(child.copy(parentSessionId = Some("wrong-parent"))).copy(reportedInherited = List(inherited)) -> "context",
        TestContexts.claim(child.copy(rootSessionId = Some("wrong-root"))).copy(reportedInherited = List(inherited)) -> "context",
        TestContexts.claim(child.copy(parentSessionId = None)).copy(reportedInherited = List(inherited)) -> "context",
        TestContexts.claim(child).copy(reportedInherited = List(inherited.copy(anchor = Some(InheritanceAnchor.ReportedParent(captured.source, UUID.randomUUID()))))) -> "context",
        TestContexts.claim(unknown).copy(reportedInherited = List(inherited)) -> "context-unknown",
        ContextRecordInput(OriginContextInput.Unknown("No native metadata"), List(inherited)) -> "context-unknown")
      _ <- variants.traverse_ { case (context, expected) =>
        val input = request(destination, 0L, "Rejected parent claim").copy(contributionContext = Some(context))
        applyWith(repo, input, Set(origin)).attempt.map(result => assertEquals(code(result), Some(expected)))
      }
      unlinked = ContextRecordInput(OriginContextInput.Unknown("Import makes no parent claim"), List(cut(graph, captured.source).copy(anchor = Some(InheritanceAnchor.ReportedEpoch(captured.source, parent.epoch)))))
      accepted <- applyWith(repo, request(destination, 0L, "Epoch-pinned import").copy(contributionContext = Some(unlinked)), Set(origin))
      _ = assertEquals(accepted.generation, 1L)
    } yield ()
  } }

  test("host observation cannot invent a missing occurrence epoch") { check { repo =>
    val scope = name()
    val host = Principal("host", Actor("host", ActorKind.Service), Set(scope), Set(Capability.Capture, Capability.HostCapture))
    val input = source(scope, None, None).copy(origin = EventOrigin.ToolOutput,
      metadata = CaptureMetadata("fixture-host", None, None, SourceRepresentation.HostReceipt, Nil, Nil),
      observation = Observation.FileAbsent("result.txt", 1L))
    for {
      result <- repo.ingest(input, host, recorder, "fixture", trace()).attempt
      _ = assertEquals(code(result), Some("context-unknown"))
      graph <- repo.read(scope)
      _ = assertEquals(graph, Graph.empty(scope))
    } yield ()
  } }
}
