package ontology

import cats.effect.IO
import cats.syntax.all.*
import ontology.api.*
import ontology.domain.*
import java.util.UUID

abstract class RelationCoverageContract extends ReviewRepositoryContract {
  private val at = "2026-11-11T00:00:00Z"
  private val actor = Actor("coverage-author", ActorKind.Agent)
  private val host = Actor("coverage-host", ActorKind.Service)
  private def scope(): String = "coverage-" + UUID.randomUUID()
  private def apply(repo: GraphRepository, scope: String, operations: List[Operation]): IO[ApplyResult] = repo.read(scope).flatMap { graph =>
    val request = ApplyRequest(scope, UUID.randomUUID(), graph.generation, operations, None)
    repo.apply(request, Admission(TestContexts.principal(scope, actor), host, request.requestId, at, TestContexts.trace("fixture-apply"), Nil))
  }
  private def ref(result: ApplyResult, alias: String): Ref = result.created.find(_.alias == alias).get.ref
  private val applicability = TestAuthoring.applicability(TestApplicability.unresolved)
  private def create(alias: String, content: ContentInput): Operation = Operation.Create(alias, applicability, content, Nil)
  private def select(alias: String, binding: Target, basis: Ref): Operation = Operation.SelectBinding(alias, binding, true, "Explicit fixture selection", List(Target.Exact(basis)))
  private def requirement(plan: Ref, condition: Ref, context: String): Operation = Operation.Relate("requires", applicability, RelationKind.Requires,
    List(Target.Exact(plan)), List(Target.Exact(condition)), RelationDetailInput.PlanRequirement(context), "Condition of this selected plan context")
  private final case class PlanFixture(scope: String, plan: Ref, condition: Ref, bindingB: Ref)
  private def plans(repo: GraphRepository): IO[PlanFixture] = {
    val s = scope()
    for {
      made <- apply(repo, s, List(create("condition", ContentInput.Statement("Condition", Modality.Assertion)),
        Operation.Bind("cb", Target.Created("condition"), Nil, "condition"),
        Operation.SelectBinding("condition-selected", Target.Created("cb"), true, "Explicit condition context", List(Target.Created("condition"))),
        create("plan", ContentInput.Decision("Chosen approach", List("Alternative approach"), "Accountable plan")),
        Operation.Bind("plan-B", Target.Created("plan"), Nil, "B"),
        Operation.SelectBinding("B-selected", Target.Created("plan-B"), true, "Explicit B context", List(Target.Created("plan")))))
    } yield PlanFixture(s, ref(made, "plan"), ref(made, "cb"), ref(made, "plan-B"))
  }
  private def planOperations(f: PlanFixture): List[Operation] = List(requirement(f.plan, f.condition, "A"),
    Operation.Bind("plan-A", Target.Exact(f.plan), List(Target.Created("requires")), "A"), select("A-selected", Target.Created("plan-A"), f.plan))
  private def planA(repo: GraphRepository, f: PlanFixture): IO[ApplyResult] = apply(repo, f.scope, planOperations(f))
  private def code[A](value: Either[Throwable, A]): Option[String] = value.left.toOption.collect { case fault: Fault => fault.code }
  private def queries(repo: GraphRepository): GraphQueries = new GraphQueries(repo, new CursorSigner(Array.fill[Byte](32)(1)), QueryLimits(100, 100, 1024 * 1024, 4096))
  private def revise(value: Relation, standing: Standing): Operation = Operation.ReviseRelation("revised", value.ref, applicability,
    value.sources.map(Target.Exact(_)), value.targets.map(Target.Exact(_)), TestAuthoring.detail(value.detail), "Explicit requirement revision", standing)
  private def capture(repo: GraphRepository, s: String, observation: Observation): IO[IngestResult] = {
    val context = CaptureContext("controlled-host", None, None, LineageStatus.Unknown, "fixture", new UUID(0L, 1L))
    val request = IngestRequest(s, UUID.randomUUID(), UUID.randomUUID(), Some(TestContexts.claim(context)), None, EventOrigin.ToolOutput,
      CaptureMetadata("controlled-observation", None, None, SourceRepresentation.HostReceipt, Nil, Nil), "Synthetic host observation account", observation)
    repo.ingest(request, Principal("host-credential", host, Set(s), Set(Capability.Capture, Capability.HostCapture)), host, at, TestContexts.trace("fixture-capture"))
  }
  private def artifact(repo: GraphRepository, s: String, path: String): IO[Ref] = capture(repo, s, Observation.FileVersion(path, 1L, Digests.text(path), path.length.toLong)).map(_.artifacts.head)
  private def produced(source: Ref, target: Ref): Operation = Operation.Relate("produced", applicability, RelationKind.Produced,
    List(Target.Exact(source)), List(Target.Exact(target)), RelationDetailInput.Empty(), "Attributed association, not acceptance or causal proof")

  test("selected Decision requirements admit atomically without governing other work contexts") { check { repo => for {
    f <- plans(repo)
    made <- planA(repo, f)
    graph <- repo.read(f.scope)
    _ = Graph.validateSelectedBinding(graph, Graph.binding(graph, f.bindingB))
    _ = Graph.validateSelectedBinding(graph, Graph.binding(graph, ref(made, "plan-A")))
    _ = assertEquals(intercept[Fault](Gates.evaluate(graph, Graph.binding(graph, ref(made, "plan-A")))).code, "condition")
    _ = assert(!Gates.evaluate(graph, Graph.binding(graph, f.bindingB)).references.contains(ref(made, "requires")))
  } yield () } }

  test("unselected and wrong-context Decision requirements fail atomically") { check { repo => for {
    f <- plans(repo)
    before <- repo.read(f.scope)
    bare <- apply(repo, f.scope, List(requirement(f.plan, f.condition, "A"))).attempt
    _ = assertEquals(code(bare), Some("plan-selection"))
    wrong <- apply(repo, f.scope, List(requirement(f.plan, f.condition, "A"),
      Operation.Bind("wrong-context", Target.Exact(f.plan), List(Target.Created("requires")), "B"), select("selected", Target.Created("wrong-context"), f.plan))).attempt
    _ = assertEquals(code(wrong), Some("stale-context"))
    condition <- apply(repo, f.scope, Operation.SelectBinding("retire-condition", Target.Exact(f.condition), false, "Retired condition", List(Target.Exact(f.plan))) :: planOperations(f)).attempt
    _ = assertEquals(code(condition), Some("unselected-context"))
    after <- repo.read(f.scope)
    _ = assertEquals(after, before)
  } yield () } }

  test("plan governing completeness and revisions stay local to the declared context") { check { repo => for {
    f <- plans(repo)
    made <- planA(repo, f)
    graph <- repo.read(f.scope)
    requirement = Graph.relation(graph, ref(made, "requires"))
    omitted <- apply(repo, f.scope, List(Operation.Bind("omitted", Target.Exact(f.plan), Nil, "A"))).attempt
    _ = assertEquals(code(omitted), Some("missing-context"))
    unpinned <- apply(repo, f.scope, List(revise(requirement, Standing.Active))).attempt
    _ = assertEquals(code(unpinned), Some("plan-selection"))
    retarget <- apply(repo, f.scope, List(Operation.ReviseRelation("retarget", requirement.ref, applicability,
      requirement.sources.map(Target.Exact(_)), requirement.targets.map(Target.Exact(_)), RelationDetailInput.PlanRequirement("B"), "Not an in-place context change", Standing.Active))).attempt
    _ = assertEquals(code(retarget), Some("identity"))
    replacement <- apply(repo, f.scope, List(revise(requirement, Standing.Active),
      Operation.Bind("new-A", Target.Exact(f.plan), List(Target.Created("revised")), "A"), select("new-A-selected", Target.Created("new-A"), f.plan),
      Operation.Bind("new-B", Target.Exact(f.plan), Nil, "B"), select("new-B-selected", Target.Created("new-B"), f.plan)))
    current <- repo.read(f.scope)
    _ = Graph.validateSelectedBinding(current, Graph.binding(current, ref(replacement, "new-B")))
    _ = assertEquals(Graph.binding(current, ref(replacement, "new-B")).context, Nil)
    _ = assertEquals(Graph.binding(current, ref(replacement, "new-A")).context, List(ref(replacement, "revised")))
  } yield () } }

  test("plan retirement preserves history without current requirement or automatic fallback") { check { repo => for {
    f <- plans(repo)
    made <- planA(repo, f)
    binding = ref(made, "plan-A")
    requirement = ref(made, "requires")
    before <- repo.read(f.scope)
    principal = TestContexts.principal(f.scope, actor)
    initial <- queries(repo).read(principal, ReadRequest(f.scope, ReadView.Current, Nil, None, 100))
    _ = assert(initial.records.exists(value => Graph.recordRef(value) == requirement))
    _ <- apply(repo, f.scope, List(Operation.SelectBinding("retired-A", Target.Exact(binding), false, "Retirement is not cancellation", List(Target.Exact(f.plan)))))
    _ <- apply(repo, f.scope, List(create("unrelated", ContentInput.Statement("Unrelated later account", Modality.Assertion))))
    current <- queries(repo).read(principal, ReadRequest(f.scope, ReadView.Current, Nil, None, 100))
    history <- queries(repo).read(principal, ReadRequest(f.scope, ReadView.History, List(requirement), None, 100))
    context <- queries(repo).read(principal, ReadRequest(f.scope, ReadView.BindingContext, List(binding), None, 100))
    graph <- repo.read(f.scope)
    _ = assert(!current.records.exists(value => Graph.recordRef(value) == requirement))
    _ = assert(history.records.exists(value => Graph.recordRef(value) == requirement))
    _ = assert(context.records.exists(value => Graph.recordRef(value) == requirement))
    _ = assertEquals(Graph.relation(graph, requirement).standing, Standing.Active)
    _ = assertEquals(graph.events, before.events)
    _ = assert(Selections.selected(graph, Graph.binding(graph, f.bindingB)))
    _ <- apply(repo, f.scope, List(select("reselected-A", Target.Exact(binding), f.plan)))
    reselected <- queries(repo).read(principal, ReadRequest(f.scope, ReadView.Current, Nil, None, 100))
    _ = assert(reselected.records.exists(value => Graph.recordRef(value) == requirement))
  } yield () } }

  test("explicit requirement withdrawal permits replacement without rewriting retained plan history") { check { repo => for {
    f <- plans(repo)
    made <- planA(repo, f)
    before <- repo.read(f.scope)
    requirement = Graph.relation(before, ref(made, "requires"))
    retired <- apply(repo, f.scope, List(revise(requirement, Standing.Withdrawn), Operation.Bind("replacement", Target.Exact(f.plan), Nil, "A"), select("replacement-selected", Target.Created("replacement"), f.plan)))
    graph <- repo.read(f.scope)
    _ = assertEquals(Graph.relation(graph, requirement.ref), requirement)
    _ = assertEquals(Graph.relation(graph, ref(retired, "revised")).standing, Standing.Withdrawn)
    _ = assertEquals(Graph.binding(graph, ref(retired, "replacement")).context, Nil)
    _ = Graph.validateSelectedBinding(graph, Graph.binding(graph, ref(retired, "replacement")))
    current <- queries(repo).read(TestContexts.principal(f.scope, actor), ReadRequest(f.scope, ReadView.Current, Nil, None, 100))
    _ = assert(current.records.exists(value => Graph.recordRef(value) == ref(retired, "revised")))
  } yield () } }

  test("execution input/output roles participate in event and transport replay identity") { check { repo =>
    val s = scope()
    val principal = Principal("host-credential", host, Set(s), Set(Capability.Capture, Capability.HostCapture))
    for {
      input <- artifact(repo, s, "input.txt")
      output <- artifact(repo, s, "output.txt")
      observation = Observation.Execution("run", "fixture", None, List(input), List(output), Some(0), true)
      context = TestContexts.claim(CaptureContext("fixture", None, None, LineageStatus.Unknown, "branch", UUID.randomUUID()))
      request = IngestRequest(s, UUID.randomUUID(), UUID.randomUUID(), Some(context), None, EventOrigin.ToolOutput,
        CaptureMetadata("execution", None, None, SourceRepresentation.HostReceipt, Nil, Nil), "Synthetic execution", observation)
      first <- repo.ingest(request, principal, host, at, TestContexts.trace("fixture"))
      before <- repo.read(s)
      swapped = request.copy(observation = observation.copy(inputs = List(output), outputs = List(input)))
      transport <- repo.ingest(swapped, principal, host, at, TestContexts.trace("fixture")).attempt
      event <- repo.ingest(swapped.copy(requestId = UUID.randomUUID()), principal, host, at, TestContexts.trace("fixture")).attempt
      _ = assertEquals(code(transport), Some("replay-conflict"))
      _ = assertEquals(code(event), Some("replay-conflict"))
      after <- repo.read(s)
      _ = assertEquals(after, before)
      source = Graph.node(after, first.source).content.asInstanceOf[Content.Source]
      _ = assertEquals(source.context, List(input, output))
    } yield ()
  } }

  test("protected execution output can be Produced without a Task completion surrogate") { check { repo =>
    val s = scope()
    for {
      input <- artifact(repo, s, "input.txt")
      output <- artifact(repo, s, "output.txt")
      execution <- capture(repo, s, Observation.Execution("controlled run", "fixture instrument", None, List(input), List(output), Some(1), true))
      _ = assertEquals(execution.artifacts, Nil)
      made <- apply(repo, s, List(produced(execution.source, output)))
      graph <- repo.read(s)
      _ = assertEquals(Graph.relation(graph, ref(made, "produced")).targets, List(output))
      _ = assertEquals(graph.events, Nil)
    } yield ()
  } }

  test("Produced distinguishes output membership from inputs unrelated artifacts and other scopes") { check { repo =>
    val s = scope()
    for {
      input <- artifact(repo, s, "input.txt")
      output <- artifact(repo, s, "output.txt")
      unrelated <- artifact(repo, s, "unrelated.txt")
      foreign <- artifact(repo, scope(), "foreign.txt")
      execution <- capture(repo, s, Observation.Execution("run", "fixture", None, List(input), List(output), Some(0), true))
      before <- repo.read(s)
      _ <- List(input, unrelated).traverse_(target => apply(repo, s, List(produced(execution.source, target))).attempt.map(result => assertEquals(code(result), Some("produced-output"))))
      _ <- List(foreign, Ref(UUID.randomUUID(), 1)).traverse_(target => apply(repo, s, List(produced(execution.source, target))).attempt.map(result => assertEquals(code(result), Some("reference"))))
      after <- repo.read(s)
      _ = assertEquals(after, before)
    } yield ()
  } }

  test("failed incomplete and unknown-exit executions retain outputs without implying work completion") { check { repo =>
    val s = scope()
    for {
      artifactRef <- artifact(repo, s, "unchanged-output.txt")
      _ <- List((Some(1), true), (None, false), (None, true)).traverse_ { case (exitCode, complete) => for {
        execution <- capture(repo, s, Observation.Execution("reported run", "fixture", None, List(artifactRef), List(artifactRef), exitCode, complete))
        _ <- apply(repo, s, List(produced(execution.source, artifactRef)))
        graph <- repo.read(s)
        receipt <- repo.input(s, Ref(Graph.node(graph, execution.source).provenance.input, 1))
        submitted = StoredJson.decode(IngestRequest.codecJson, receipt.content).observation.asInstanceOf[Observation.Execution]
        _ = assertEquals(submitted.inputs, List(artifactRef))
        _ = assertEquals(submitted.outputs, List(artifactRef))
        _ = assertEquals(submitted.exitCode, exitCode)
        _ = assertEquals(submitted.complete, complete)
        _ = assertEquals(graph.events, Nil)
        retained <- repo.history(s, graph.generation)
        _ = assertEquals(retained, graph)
      } yield () }
      before <- repo.read(s)
      duplicate <- capture(repo, s, Observation.Execution("run", "fixture", None, List(artifactRef, artifactRef), List(artifactRef), None, false)).attempt
      duplicateOutput <- capture(repo, s, Observation.Execution("run", "fixture", None, Nil, List(artifactRef, artifactRef), None, false)).attempt
      _ = assertEquals(code(duplicate), Some("observation"))
      _ = assertEquals(code(duplicateOutput), Some("observation"))
      after <- repo.read(s)
      _ = assertEquals(after, before)
    } yield ()
  } }

  test("textual accounts and derived presentations cannot stand in for a captured execution") { check { repo => for {
    f <- plans(repo)
    output <- artifact(repo, f.scope, "output.txt")
    _ <- List(ActorKind.Agent, ActorKind.Collector, ActorKind.Human).traverse_ { kind =>
      val principal = Principal("text-" + kind, Actor("text-" + kind, kind), Set(f.scope), Set(Capability.Capture))
      val origin = if (kind == ActorKind.Agent) EventOrigin.WorkerMessage else EventOrigin.UserMessage
      val representation = if (kind == ActorKind.Collector) SourceRepresentation.PiTranscript else SourceRepresentation.Text
      val request = IngestRequest(f.scope, UUID.randomUUID(), UUID.randomUUID(), None, None, origin,
        CaptureMetadata("submitted", None, None, representation, Nil, Nil), "Claims that execution produced output.txt", Observation.None())
      for {
        account <- repo.ingest(request, principal, host, at, TestContexts.trace("fixture-text"))
        result <- apply(repo, f.scope, List(produced(account.source, output))).attempt
        _ = assertEquals(code(result), Some("kind"))
      } yield ()
    }
    absence <- capture(repo, f.scope, Observation.FileAbsent("missing.txt", 1L))
    notExecution <- apply(repo, f.scope, List(produced(absence.source, output))).attempt
    _ = assertEquals(code(notExecution), Some("kind"))
    human = Principal("human", Actor("human", ActorKind.Human), Set(f.scope), Set(Capability.Read, Capability.Review))
    call = ReviewCall.from(ServiceCall.authenticated(Authenticated(human, true, "fixture", Some("session")), "fixture-review", UUID.randomUUID()), f.scope)
    graph <- repo.read(f.scope)
    p <- repo.prepare(PresentRequest(f.scope, List(f.plan), graph.generation), call, UUID.randomUUID(), at)
    _ <- repo.judge(JudgmentRequest(f.scope, UUID.randomUUID(), p.id, ReviewAction.Review(JudgmentKind.Accept), "Controlled review"), call, host, at)
    derived <- apply(repo, f.scope, List(produced(p.reservedSourceRef, output))).attempt
    _ = assertEquals(code(derived), Some("kind"))
  } yield () } }

  test("completed-state production remains valid while planned and cancelled reports are not producers") { check { repo =>
    val s = scope()
    for {
      output <- artifact(repo, s, "output.txt")
      work <- apply(repo, s, List(create("task", ContentInput.Task("Task", AcceptanceInput(List("Check output"), None), Execution.Delegated)),
        Operation.Bind("b", Target.Created("task"), Nil, "work"), Operation.SelectBinding("selected", Target.Created("b"), true, "Explicit", List(Target.Created("task"))),
        Operation.State("done", Target.Created("b"), None, Phase.Completed, Some(Resolution.NotFulfilled), Some("Finished without fulfillment"), List(Target.Exact(output)), "Fixture account")))
      _ <- apply(repo, s, List(produced(ref(work, "done"), output)))
      _ <- List(Phase.Planned, Phase.Cancelled).traverse_ { phase =>
        val state = Operation.State("state", Target.Exact(ref(work, "b")), Some(ref(work, "done")), phase, None, Some("Qualified report"), Nil, "Fixture account")
        val edge = Operation.Relate("produced", applicability, RelationKind.Produced, List(Target.Created("state")), List(Target.Exact(output)), RelationDetailInput.Empty(), "Must reject")
        apply(repo, s, List(state, edge)).attempt.map(result => assertEquals(code(result), Some("kind")))
      }
    } yield ()
  } }
}
