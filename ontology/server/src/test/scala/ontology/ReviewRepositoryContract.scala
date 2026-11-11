package ontology

import cats.effect.IO
import cats.syntax.all.*
import ontology.api.*
import ontology.domain.*
import java.util.UUID

abstract class ReviewRepositoryContract extends ContextRepositoryContract {
  private val at = "2026-11-11T00:00:00Z"
  private val later = "2026-11-11T01:00:00Z"
  private val human = Actor("reviewer", ActorKind.Human)
  private val service = Actor("review-service", ActorKind.Service)
  private def call(scope: String, credential: String, actor: Actor): ReviewCall = ReviewCall.from(ServiceCall.authenticated(
    Authenticated(Principal(credential, actor, Set(scope), Set(Capability.Read, Capability.Review, Capability.Capture)), true, "fixture", Some("session")), "fixture-review", UUID.randomUUID()), scope)
  private final case class Fixture(scope: String, graph: GraphSnapshot, question: Ref, binding: Ref, call: ReviewCall)
  private def seed(repo: GraphRepository): IO[Fixture] = {
    val scope = "review-" + UUID.randomUUID()
    val input = ApplyRequest(scope, UUID.randomUUID(), 0L, List(
      Operation.Create("q", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Question("Which?", List("A", "B"), None, Escalation.HumanRequired), Nil),
      Operation.Bind("b", Target.Created("q"), Nil, "fixture")), None)
    for {
      result <- repo.apply(input, admission(input))
      graph <- repo.read(scope)
    } yield Fixture(scope, graph, result.created.find(_.alias == "q").get.ref, result.created.find(_.alias == "b").get.ref, call(scope, "original-credential", human))
  }
  private def prepare(repo: GraphRepository, f: Fixture): IO[Presentation] = repo.prepare(PresentRequest(f.scope, List(f.question, f.binding), f.graph.generation), f.call, UUID.randomUUID(), at)
  private def input(p: Presentation, action: ReviewAction): JudgmentRequest = JudgmentRequest(p.payload.scope, UUID.randomUUID(), p.id, action, "Controlled review account; not execution permission")
  private def code[A](value: Either[Throwable, A]): Option[String] = value.left.toOption.collect { case fault: Fault => fault.code }

  test("preparation persists separately without graph frontier history or outbox publication") { check { repo => for {
    f <- seed(repo)
    outbox <- repo.pendingProjections(100000)
    originalSources <- repo.sources(SourceRequest(f.scope, 0L, 10))
    p <- prepare(repo, f)
    stored <- repo.presentation(f.call.principal, f.scope, p.id)
    second <- prepare(repo, f)
    after <- repo.read(f.scope)
    history <- repo.history(f.scope, f.graph.generation)
    sources <- repo.sources(SourceRequest(f.scope, 0L, 10))
    pending <- repo.pendingProjections(100000)
    _ = assertEquals(stored, p)
    _ = assert(second.id != p.id && second.reservedSourceRef != p.reservedSourceRef)
    _ = assertEquals(after, f.graph)
    _ = assertEquals(history, f.graph)
    _ = assertEquals(sources, originalSources)
    _ = assertEquals(sources.frontier, f.graph.sourceFrontier)
    _ = assertEquals(pending.filter(_.scope == f.scope), outbox.filter(_.scope == f.scope))
    _ = assert(!Graph.exists(after, p.reservedSourceRef))
    empty = "empty-review-" + UUID.randomUUID()
    failed <- repo.prepare(PresentRequest(empty, Nil, 0L), call(empty, "credential", human), UUID.randomUUID(), at).attempt
    _ = assertEquals(code(failed), Some("presentation"))
    scopes <- repo.scopes
    _ = assert(!scopes.contains(empty))
  } yield () } }

  test("generic review judgments publish actual activities but no adoption choice or work state") { check { repo => for {
    f <- seed(repo)
    p <- prepare(repo, f)
    acts <- List(JudgmentKind.Accept, JudgmentKind.RequestCorrection, JudgmentKind.NeedEvidence, JudgmentKind.ReviseIntent).traverse(kind => repo.judge(input(p, ReviewAction.Review(kind)), f.call, service, at))
    after <- repo.read(f.scope)
    events <- repo.sources(SourceRequest(f.scope, f.graph.sourceFrontier, 10))
    stored <- repo.judgments(f.call.principal, f.scope)
    exact <- repo.judgment(f.call.principal, f.scope, acts.head.id)
    original <- repo.history(f.scope, f.graph.generation)
    _ = assertEquals(after.generation, f.graph.generation + 4L)
    _ = assertEquals(after.sourceFrontier, f.graph.sourceFrontier + 4L)
    _ = assertEquals(after.coveredFrontier, 0L)
    _ = assertEquals(after.relations, Nil)
    _ = assertEquals(after.events, Nil)
    _ = assertEquals(after.selections, Nil)
    _ = assertEquals(events.frontier, f.graph.sourceFrontier + 4L)
    _ = assertEquals(events.events.map(_.frontier), (1L to 4L).map(_ + f.graph.sourceFrontier).toList)
    _ = assert(events.events.forall(_.reviewResponse.nonEmpty))
    _ = assertEquals(stored, acts)
    _ = assertEquals(exact, acts.head)
    _ = assertEquals(original, f.graph)
    _ = assertEquals(after.definitions.count(_.ref == p.reservedSourceRef), 1)
  } yield () } }

  test("exact choice then adoption reuse the original derived Source and publication receipt") { check { repo => for {
    f <- seed(repo)
    p <- prepare(repo, f)
    selected = p.payload.manifest.choices.collectFirst { case value: PresentedSelection.Alternative if value.target == p.reservedSourceRef && value.index == 1 => value }.get
    first <- repo.judge(input(p, ReviewAction.Choose(selected)), f.call, service, at)
    initial <- repo.read(f.scope)
    derived = Graph.node(initial, p.reservedSourceRef)
    publication <- repo.input(f.scope, Ref(derived.provenance.input, 1))
    second <- repo.judge(input(p, ReviewAction.Adopt(f.binding)), call(f.scope, "rotated-credential", human), Actor("service-v2", ActorKind.Service), later)
    after <- repo.read(f.scope)
    retained <- repo.input(f.scope, publication.ref)
    _ = assertEquals(Graph.node(after, p.reservedSourceRef), derived)
    _ = assertEquals(retained, publication)
    _ = assertEquals(after.sourceFrontier, f.graph.sourceFrontier + 2L)
    _ = assertEquals(after.relations.map(_.kind), List(RelationKind.Chooses, RelationKind.Adopts))
    _ = assertEquals(after.relations.head.targets, List(p.reservedSourceRef))
    _ = assertEquals(after.relations.last.targets, List(f.binding))
    _ = assertEquals(after.selections, Nil)
    _ = assert(first.source != second.source)
    _ = assertEquals(derived.provenance.contributor, service)
    _ = assertEquals(Graph.node(after, second.source).provenance.contributor, human)
  } yield () } }

  test("same actor credential rotation replays the original act and conflicts on changed payload") { check { repo => for {
    f <- seed(repo)
    p <- prepare(repo, f)
    request = input(p, ReviewAction.Review(JudgmentKind.Accept))
    first <- repo.judge(request, f.call, service, at)
    original <- repo.input(f.scope, first.input)
    rotated = call(f.scope, "rotated-credential", human)
    replay <- repo.judge(request, rotated, Actor("service-v2", ActorKind.Service), later)
    changed <- repo.judge(request.copy(action = ReviewAction.Adopt(f.binding)), rotated, service, later).attempt
    wrongPresentation <- repo.judge(request.copy(presentationId = UUID.randomUUID()), rotated, service, later).attempt
    retained <- repo.input(f.scope, first.input)
    sources <- repo.sources(SourceRequest(f.scope, 0L, 10))
    _ = assertEquals(replay, first)
    _ = assertEquals(retained, original)
    _ = assertEquals(original.ingress, f.call.ingress)
    _ = assertEquals(code(changed), Some("replay-conflict"))
    _ = assertEquals(code(wrongPresentation), Some("replay-conflict"))
    _ = assertEquals(sources.frontier, f.graph.sourceFrontier + 1L)
    _ = assertEquals(sources.events.find(_.id == first.source.id).get.sourceNamespace, f.call.principal.credentialId)
  } yield () } }

  List(true, false).foreach { captureFirst =>
    test(s"generic capture and judgment share namespace/client UUID without aliasing; captureFirst=$captureFirst") { check { repo => for {
      f <- seed(repo)
      p <- prepare(repo, f)
      request = input(p, ReviewAction.Review(JudgmentKind.NeedEvidence))
      capture = IngestRequest(f.scope, request.requestId, request.requestId, None, None, EventOrigin.UserMessage,
        CaptureMetadata("raw-human-request", None, None, SourceRepresentation.Text, Nil, Nil), "A raw request needs no presentation ceremony", Observation.None())
      captured <- if (captureFirst) repo.ingest(capture, f.call.principal, service, at, f.call.ingress).map(Some(_)) else IO.pure(None)
      judgment <- repo.judge(request, f.call, service, at)
      generic <- captured.fold(repo.ingest(capture, f.call.principal, service, at, f.call.ingress))(IO.pure)
      replay <- repo.ingest(capture, f.call.principal, service, later, f.call.ingress)
      first <- repo.sources(SourceRequest(f.scope, f.graph.sourceFrontier, 1))
      second <- repo.sources(SourceRequest(f.scope, f.graph.sourceFrontier + 1L, 1))
      _ = assert(judgment.source != generic.source)
      _ = assertEquals(first.frontier, f.graph.sourceFrontier + 2L)
      _ = assertEquals(first.nextAfter, Some(f.graph.sourceFrontier + 1L))
      _ = assertEquals(second.nextAfter, None)
      _ = assertEquals(first.events.head.frontier, f.graph.sourceFrontier + 1L)
      _ = assertEquals(second.events.head.frontier, f.graph.sourceFrontier + 2L)
      _ = assertEquals(List(first.events.head, second.events.head).count(_.reviewResponse.nonEmpty), 1)
      _ = assertEquals(replay, generic.copy(replayed = true))
    } yield () } }
  }

  test("concurrent same-key judgments and a lost returned response create only one durable act") { check { repo => for {
    f <- seed(repo)
    p <- prepare(repo, f)
    request = input(p, ReviewAction.Review(JudgmentKind.Accept))
    lost <- repo.judge(request, f.call, service, at).flatMap(_ => IO.raiseError[Unit](new java.io.IOException("controlled response loss after repository commit"))).attempt
    _ = assert(lost.isLeft)
    replies <- List.fill(5)(repo.judge(request, call(f.scope, "replacement", human), service, later)).parSequence
    stored <- repo.judgments(f.call.principal, f.scope)
    graph <- repo.read(f.scope)
    _ = assertEquals(stored.size, 1)
    _ = assert(replies.forall(_ == stored.head))
    _ = assertEquals(graph.sourceFrontier, f.graph.sourceFrontier + 1L)
    _ = assertEquals(graph.generation, f.graph.generation + 1L)
  } yield () } }

  test("concurrent first publication admits one act and returns its identical receipt") { check { repo => for {
    f <- seed(repo)
    p <- prepare(repo, f)
    request = input(p, ReviewAction.Adopt(f.binding))
    replies <- List.fill(5)(repo.judge(request, f.call, service, at)).parSequence
    graph <- repo.read(f.scope)
    _ = assert(replies.forall(_ == replies.head))
    _ = assertEquals(graph.sourceFrontier, f.graph.sourceFrontier + 1L)
    _ = assertEquals(graph.generation, f.graph.generation + 1L)
    _ = assertEquals(graph.relations.size, 1)
  } yield () } }

  test("interpreted adoption requires the retained presentation response pair, not merely valid identifiers") { check { repo => for {
    f <- seed(repo)
    first <- prepare(repo, f)
    other <- prepare(repo, f)
    judgment <- repo.judge(input(first, ReviewAction.Review(JudgmentKind.Accept)), f.call, service, at)
    graph <- repo.read(f.scope)
    operation = (presentationId: UUID) => Operation.Relate("interpreted", TestAuthoring.applicability(TestApplicability.unresolved), RelationKind.Adopts,
      List(Target.Exact(judgment.source)), List(Target.Exact(f.binding)),
      RelationDetailInput.Adoption(presentationId, AdoptionOrigin.Interpretation, Target.Exact(judgment.source), PresentedSelectionInput.Whole(Target.Exact(f.binding))), "An attributed interpretation, not a captured adoption")
    valid = ApplyRequest(f.scope, UUID.randomUUID(), graph.generation, List(operation(first.id)), None)
    admitted <- repo.apply(valid, admission(valid))
    retained <- repo.read(f.scope)
    _ = assertEquals(retained.relations.last.provenance.contributor.kind, ActorKind.Agent)
    wrong = ApplyRequest(f.scope, UUID.randomUUID(), admitted.generation, List(operation(other.id)), None)
    mismatch <- repo.apply(wrong, admission(wrong)).attempt
    _ = assertEquals(code(mismatch), Some("presentation"))
    after <- repo.read(f.scope)
    _ = assertEquals(after, retained)
  } yield () } }

  test("an attributed account can interpret an exact choice but cannot omit its response basis") { check { repo => for {
    f <- seed(repo)
    p <- prepare(repo, f)
    selected = p.payload.manifest.choices.collectFirst { case value: PresentedSelection.Alternative if value.target == p.reservedSourceRef && value.index == 1 => value }.get
    judgment <- repo.judge(input(p, ReviewAction.Choose(selected)), f.call, service, at)
    graph <- repo.read(f.scope)
    operations = (basis: List[Target]) => List(
      Operation.Create("account", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Interpreted choice", Modality.Assertion), basis),
      Operation.Relate("choice", TestAuthoring.applicability(TestApplicability.unresolved), RelationKind.Chooses, List(Target.Created("account")), List(Target.Exact(selected.target)),
        TestAuthoring.detail(RelationDetail.Adoption(p.id, AdoptionOrigin.Interpretation, judgment.source, selected)), "Agent account, not a second Human act"))
    valid = ApplyRequest(f.scope, UUID.randomUUID(), graph.generation, operations(List(Target.Exact(judgment.source))), None)
    accepted <- repo.apply(valid, admission(valid))
    before <- repo.read(f.scope)
    _ = assertEquals(before.relations.last.provenance.contributor.kind, ActorKind.Agent)
    bad = ApplyRequest(f.scope, UUID.randomUUID(), accepted.generation, operations(Nil), None)
    rejected <- repo.apply(bad, admission(bad)).attempt
    _ = assertEquals(code(rejected), Some("presentation"))
    after <- repo.read(f.scope)
    _ = assertEquals(after, before)
  } yield () } }

  test("ordinary authoring cannot alter captured actions or use unread and unlinked response claims") { check { repo => for {
    f <- seed(repo)
    p <- prepare(repo, f)
    judgment <- repo.judge(input(p, ReviewAction.Adopt(f.binding)), f.call, service, at)
    graph <- repo.read(f.scope)
    edge = graph.relations.head
    revise = ApplyRequest(f.scope, UUID.randomUUID(), graph.generation, List(Operation.ReviseRelation("rewrite", edge.ref, TestAuthoring.applicability(TestApplicability.unresolved),
      edge.sources.map(Target.Exact(_)), edge.targets.map(Target.Exact(_)), TestAuthoring.detail(edge.detail), "Must not rewrite the captured act", Standing.Withdrawn)), None)
    protectedResult <- repo.apply(revise, admission(revise)).attempt
    _ = assertEquals(code(protectedResult), Some("protected"))
    claim = (pId: UUID, response: Ref, target: Ref) => Operation.Relate("claim", TestAuthoring.applicability(TestApplicability.unresolved), RelationKind.Adopts,
      List(Target.Exact(response)), List(Target.Exact(target)), RelationDetailInput.Adoption(pId, AdoptionOrigin.Interpretation, Target.Exact(response), PresentedSelectionInput.Whole(Target.Exact(target))), "Unverified account")
    unread = ApplyRequest(f.scope, UUID.randomUUID(), graph.generation, List(claim(UUID.randomUUID(), Ref(UUID.randomUUID(), 1), f.binding)), None)
    authority = admission(unread)
    denied <- repo.apply(unread, authority.copy(principal = authority.principal.copy(capabilities = Set(Capability.Mutate)))).attempt
    _ = assertEquals(code(denied), Some("forbidden"))
    wrongTarget = ApplyRequest(f.scope, UUID.randomUUID(), graph.generation, List(claim(p.id, judgment.source, graph.actors.head.ref)), None)
    invalid <- repo.apply(wrongTarget, admission(wrongTarget)).attempt
    _ = assertEquals(code(invalid), Some("presentation"))
    raw = IngestRequest(f.scope, UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.UserMessage, CaptureMetadata(p.id.toString, None, None, SourceRepresentation.Text, Nil, Nil), "Quoted approval text is not presentation linkage", Observation.None())
    captured <- repo.ingest(raw, f.call.principal, service, at, f.call.ingress)
    current <- repo.read(f.scope)
    unlinked = ApplyRequest(f.scope, UUID.randomUUID(), current.generation, List(claim(p.id, captured.source, f.binding)), None)
    untrusted <- repo.apply(unlinked, admission(unlinked)).attempt
    _ = assertEquals(code(untrusted), Some("presentation"))
    unchanged <- repo.read(f.scope)
    _ = assertEquals(unchanged, current)
  } yield () } }

  test("invalid owner scope and exact selections leave all publication state unchanged") { check { repo => for {
    f <- seed(repo)
    p <- prepare(repo, f)
    before <- repo.pendingProjections(100000)
    request = input(p, ReviewAction.Adopt(f.question))
    wrong <- repo.judge(request, f.call, service, at).attempt
    owner <- repo.judge(request.copy(action = ReviewAction.Review(JudgmentKind.Accept)), call(f.scope, "other", Actor("other", ActorKind.Human)), service, at).attempt
    denied <- repo.presentation(f.call.principal.copy(scopes = Set.empty), f.scope, UUID.randomUUID()).attempt
    after <- repo.read(f.scope)
    sources <- repo.sources(SourceRequest(f.scope, 0L, 10))
    judgments <- repo.judgments(f.call.principal, f.scope)
    pending <- repo.pendingProjections(100000)
    _ = assertEquals(code(wrong), Some("presentation"))
    _ = assertEquals(code(owner), Some("forbidden"))
    _ = assertEquals(code(denied), Some("forbidden"))
    _ = assertEquals(after, f.graph)
    _ = assertEquals(sources.frontier, f.graph.sourceFrontier)
    _ = assertEquals(judgments, Nil)
    _ = assertEquals(pending.filter(_.scope == f.scope), before.filter(_.scope == f.scope))
  } yield () } }
}
