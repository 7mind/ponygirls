package ontology

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.time.Instant
import java.util.UUID
import ontology.api.*
import ontology.domain.*

private[ontology] final case class PreparedCapsule(value: Capsule, material: CapsuleMaterial, previous: Option[CapsuleBaseline]) {
  def baseline: CapsuleBaseline = CapsuleBaseline.validated(value, material, previous)
}
abstract class CapsuleProjectionContract extends CurationRepositorySupport {
  protected val workContext = "controlled-work"
  protected val capsuleLimits = CapsuleLimits(256, 1048576)
  protected val reportedNative = ContextRecordInput(OriginContextInput.ReportedNative(CaptureContext("fixture-session", None, None, LineageStatus.Unknown, "fixture-branch", UUID.randomUUID())), Nil)
  protected val unresolved = ApplicabilityInput.Unresolved("Controlled unresolved applicability", Nil, Nil)
  protected def applyAs(repo: GraphRepository, scope: String, actor: Actor, operations: List[Operation]): IO[ApplyResult] = for {
    head <- repo.read(scope)
    request = ApplyRequest(scope, UUID.randomUUID(), head.generation, operations, None)
    principal = Principal("fixture-author", actor, Set(scope), Set(Capability.Read, Capability.Mutate))
    trace = RequestTrace(UUID.randomUUID(), "fixture-apply", if (actor.kind == ActorKind.Human) RequestTransport.Cookie else RequestTransport.Bearer)
    result <- repo.apply(request, Admission(principal, Actor("fixture-service", ActorKind.Service), request.requestId, "2026-11-11T00:00:00Z", trace, Nil))
  } yield result
  protected def material(repo: GraphRepository, settings: CurationStoreSettings, scope: String, previous: Option[CapsuleBaseline]): IO[CapsuleMaterial] = for {
    graph <- repo.read(scope)
    status <- repo.curation.status(settings.principal, scope)
    source <- repo.sources(SourceRequest(scope, 0L, 1000))
    pending = source.events.filter(e => e.frontier > graph.coveredFrontier && e.frontier <= graph.sourceFrontier)
    plan = CapsuleProjection.blueprint(graph, workContext, pending, previous, capsuleLimits)
    inputs <- CapsuleSelection.provenanceRefs(plan.plan.records).traverse(repo.input(scope, _))
    claims = CapsuleSelection.reviewClaims(plan.plan.records)
    judgments <- if (claims.isEmpty) IO.pure(List.empty[Judgment]) else repo.judgments(settings.principal, scope)
    reviews <- claims.traverse { claim => for {
      presentation <- repo.presentation(settings.principal, scope, claim.presentationId)
      judgment = judgments.find(_.source == claim.response).getOrElse(throw new AssertionError("fixture judgment missing"))
      event = source.events.find(_.id == judgment.source.id).getOrElse(throw new AssertionError("fixture event missing"))
      receipt <- repo.input(scope, judgment.input)
      publication <- repo.input(scope, TestReview.domain.publicationInput(presentation))
      evidence = ReviewEvidence(presentation, judgment, event, receipt, publication)
      _ <- IO(TestReview.domain.validateEvidence(graph, evidence))
    } yield evidence }
  } yield CapsuleMaterial(graph, CapsuleContext.cut(status), pending, inputs, reviews, Nil)
  protected def prepare(repo: GraphRepository, settings: CurationStoreSettings, scope: String, previous: Option[CapsuleBaseline]): IO[PreparedCapsule] = for {
    source <- material(repo, settings, scope, previous)
    request = CapsuleRequest(scope, UUID.randomUUID(), workContext, Some(reportedNative), source.snapshot.sourceFrontier, previous.map(_.capsule.id))
    call = ServiceCall.internal(settings.principal, "capsule.prepare", UUID.randomUUID())
    value <- IO(CapsuleProjection.prepare(source, request, call, UUID.randomUUID(), Instant.parse("2026-11-11T00:01:00Z"),
      CapsuleSettings(Set(WorkContextKey(scope, workContext)), capsuleLimits), previous))
  } yield PreparedCapsule(value, source, previous)
  private val human = Actor("fixture-human", ActorKind.Human)
  private val agent = Actor("fixture-agent", ActorKind.Agent)
  private def ref(result: ApplyResult, alias: String): Ref = result.created.find(_.alias == alias).get.ref
  private def work(repo: GraphRepository, scope: String): IO[ApplyResult] = applyAs(repo, scope, human, List(
    Operation.Create("taskA", unresolved, ContentInput.Task("Work A", AcceptanceInput(List("Controlled acceptance"), None), Execution.Delegated), Nil),
    Operation.Create("taskB", unresolved, ContentInput.Task("Other context work", AcceptanceInput(List("Other acceptance"), None), Execution.Delegated), Nil),
    Operation.Bind("bindingA", Target.Created("taskA"), Nil, workContext), Operation.Bind("bindingB", Target.Created("taskB"), Nil, "other-context"),
    Operation.SelectBinding("selectionA", Target.Created("bindingA"), true, "Select A", List(Target.Created("taskA"))),
    Operation.SelectBinding("selectionB", Target.Created("bindingB"), true, "Select B elsewhere", List(Target.Created("taskB"))),
    Operation.State("planned", Target.Created("bindingA"), None, Phase.Planned, None, None, Nil, "Recorded plan, not execution")))

  test("unbound intent and pending activity remain visible without promoting transcript roles to Human authority") { check { (repo, settings, scope) => for {
    a <- applyAs(repo, scope, human, List(Operation.Create("humanRule", unresolved, ContentInput.Constraint("Human-authenticated constraint", Polarity.Prohibited, Force.Required), Nil)))
    captured <- capture(repo, scope)
    b <- applyAs(repo, scope, agent, List(Operation.Create("reportedRule", unresolved, ContentInput.Constraint("Interpretation of captured user-role text", Polarity.Required, Force.Unresolved), List(Target.Exact(captured.source)))))
    before <- repo.read(scope)
    prepared <- prepare(repo, settings, scope, None)
    manifest = prepared.value.payload.manifest
    records = prepared.value.payload.records
    _ = assert(records.exists(r => Graph.recordRef(r) == ref(a, "humanRule")))
    _ = assert(records.exists(r => Graph.recordRef(r) == captured.source))
    _ = assert(manifest.qualifications.exists(q => q.code == CapsuleQualificationCode.CoverageLag))
    _ = assert(manifest.qualifications.exists(q => q.code == CapsuleQualificationCode.UnboundIntent && q.subjects.contains(ref(a, "humanRule"))))
    _ = assert(manifest.qualifications.exists(q => q.code == CapsuleQualificationCode.MissingHumanBasis && q.subjects.contains(ref(b, "reportedRule"))))
    _ = assert(!manifest.qualifications.exists(q => q.code == CapsuleQualificationCode.MissingHumanBasis && q.subjects.contains(ref(a, "humanRule"))))
    humans = manifest.entries.filter(_.roles.contains(CapsuleRole.HumanBasisAccount)).map(_.ref)
    _ = assertEquals(humans.size, 1)
    _ = assert(records.exists { case GraphRecord.Input(input) => humans.contains(input.ref) && input.contributor == human; case _ => false })
    after <- repo.read(scope)
    _ = assertEquals(after, before)
    _ = CapsuleProjection.validate(prepared.value, prepared.material, None)
  } yield () } }

  test("only the requested work context is selected while complete source receipts remain inspectable") { check { (repo, settings, scope) => for {
    created <- work(repo, scope)
    prepared <- prepare(repo, settings, scope, None)
    entries = prepared.value.payload.manifest.entries
    _ = assert(entries.exists(e => e.ref == ref(created, "bindingA") && e.partition == CapsulePartition.SelectedWorkContext))
    _ = assert(entries.exists(e => e.ref == ref(created, "planned") && e.roles.contains(CapsuleRole.Progress)))
    _ = assert(!entries.exists(_.ref == ref(created, "bindingB")))
    _ = assert(!entries.exists(_.ref == ref(created, "taskB")))
    _ = assertEquals(entries.map(_.ref), prepared.value.payload.records.map(Graph.recordRef))
    _ = assert(prepared.value.payload.records.exists(_.isInstanceOf[GraphRecord.Input]))
  } yield () } }

  test("stale selected work remains visible and explicit baseline reasons are preserved") { check { (repo, settings, scope) => for {
    created <- work(repo, scope)
    before <- prepare(repo, settings, scope, None)
    revised <- applyAs(repo, scope, human, List(Operation.Revise("changed", ref(created, "taskA"), unresolved,
      ContentInput.Task("Revised work A", AcceptanceInput(List("Revised acceptance"), None), Execution.Delegated), Standing.Active, List(Target.Exact(ref(created, "taskA"))), "Recorded Human change reason")))
    after <- prepare(repo, settings, scope, Some(before.baseline))
    manifest = after.value.payload.manifest
    _ = assert(manifest.qualifications.exists(q => q.code == CapsuleQualificationCode.StaleBinding && q.subjects.contains(ref(created, "bindingA"))))
    _ = assert(after.value.payload.records.exists(r => Graph.recordRef(r) == ref(created, "taskA")))
    change = manifest.changes.find(_.account == ref(revised, "changed")).get
    _ = assertEquals(change.previous, Some(ref(created, "taskA")))
    _ = assertEquals(change.current, Some(ref(revised, "changed")))
    _ = assertEquals(change.reason, Some("Recorded Human change reason"))
    _ = assert(change.humanBasis.nonEmpty)
    _ = CapsuleProjection.validate(after.value, after.material, Some(before.baseline))
    _ = assertEquals(intercept[Fault](CapsuleProjection.validate(after.value.copy(preparedAt = "2026-11-11T00:00:30Z"), after.material, Some(before.baseline))).code, "corrupt")
  } yield () } }

  test("new Review revisions remain inspectable when they invalidate a recorded warrant") { check { (repo, settings, scope) => for {
    operations = AssessmentFixture.operations.map { case b: Operation.Bind => b.copy(workContext = workContext); case other => other }
    created <- applyAs(repo, scope, human, operations)
    revised <- applyAs(repo, scope, human, List(AssessmentFixture.changedReview(created)))
    prepared <- prepare(repo, settings, scope, None)
    refs = prepared.value.payload.records.map(Graph.recordRef).toSet
    _ = assert(refs.contains(ref(created, "review")))
    _ = assert(refs.contains(ref(revised, "review2")), "the current invalidating Review revision must not be hidden")
    _ = assert(refs.contains(ref(created, "done")))
    _ = assert(prepared.value.payload.manifest.qualifications.exists(q => q.code == CapsuleQualificationCode.StaleWarrant && q.subjects.contains(ref(created, "done"))))
  } yield () } }

  test("malformed assessment use fails structurally instead of becoming a stale-warrant qualification") { check { (repo, settings, scope) => for {
    operations = AssessmentFixture.operations.map { case b: Operation.Bind => b.copy(workContext = workContext); case other => other }
    created <- applyAs(repo, scope, human, operations)
    source <- material(repo, settings, scope, None)
    bad = source.snapshot.copy(relations = source.snapshot.relations.map(r => if (r.ref == ref(created, "use")) r.copy(detail = r.detail.asInstanceOf[RelationDetail.AssessmentUse].copy(basis = Nil)) else r))
    request = CapsuleRequest(scope, UUID.randomUUID(), workContext, Some(reportedNative), bad.sourceFrontier, None)
    _ = intercept[Fault](CapsuleProjection.prepare(source.copy(snapshot = bad), request, ServiceCall.internal(settings.principal, "capsule.prepare", UUID.randomUUID()),
      UUID.randomUUID(), Instant.parse("2026-11-11T00:01:00Z"), CapsuleSettings(Set(WorkContextKey(scope, workContext)), capsuleLimits), None))
  } yield () } }

  test("complete payload capacity and retained bytes are checked without truncation or new primary activity") { check { (repo, settings, scope) => for {
    _ <- work(repo, scope)
    before <- repo.read(scope)
    prepared <- prepare(repo, settings, scope, None)
    request = CapsuleRequest(scope, UUID.randomUUID(), workContext, Some(reportedNative), before.sourceFrontier, None)
    call = ServiceCall.internal(settings.principal, "capsule.prepare", UUID.randomUUID())
    _ = assertEquals(intercept[Fault](CapsuleProjection.prepare(prepared.material, request, call, UUID.randomUUID(), Instant.parse("2026-11-11T00:01:00Z"),
      CapsuleSettings(Set(WorkContextKey(scope, workContext)), CapsuleLimits(1, capsuleLimits.maxPayloadBytes)), None)).code, "capacity")
    _ = assertEquals(intercept[Fault](CapsuleProjection.prepare(prepared.material, request, call, UUID.randomUUID(), Instant.parse("2026-11-11T00:01:00Z"),
      CapsuleSettings(Set(WorkContextKey(scope, workContext)), CapsuleLimits(256, 1024)), None)).code, "capacity")
    changedPayload = prepared.value.payload.copy(text = "Different rendered account")
    changed = prepared.value.copy(payload = changedPayload, payloadDigest = Digests.text(Wire.encode(CapsulePayload.codecJson, changedPayload).noSpaces))
    _ = assertEquals(intercept[Fault](CapsuleProjection.validate(changed, prepared.material, None)).code, "corrupt")
    _ = assertEquals(intercept[Fault](CapsuleProjection.prepare(prepared.material.copy(inputs = Nil), request, call, UUID.randomUUID(), Instant.parse("2026-11-11T00:01:00Z"),
      CapsuleSettings(Set(WorkContextKey(scope, workContext)), capsuleLimits), None)).code, "corrupt")
    after <- repo.read(scope)
    _ = assertEquals(after, before)
  } yield () } }

  test("authenticated review evidence retains its captured action and derived offer without activating work") { check { (repo, settings, scope) => for {
    created <- work(repo, scope)
    graph <- repo.read(scope)
    reviewer = Principal("fixture-reviewer", human, Set(scope), Set(Capability.Read, Capability.Review))
    call = ReviewCall.from(ServiceCall.authenticated(Authenticated(reviewer, true, "f" * 64, Some("e" * 64)), "review", UUID.randomUUID()), scope)
    presentation <- repo.prepare(PresentRequest(scope, List(ref(created, "bindingA")), graph.generation), call, UUID.randomUUID(), "2026-11-11T00:00:01Z")
    judgment <- repo.judge(JudgmentRequest(scope, UUID.randomUUID(), presentation.id, ReviewAction.Adopt(ref(created, "bindingA")), "Adopt the presented contract, not execution permission"),
      call, Actor("fixture-service", ActorKind.Service), "2026-11-11T00:00:02Z")
    prepared <- prepare(repo, settings, scope, None)
    records = prepared.value.payload.records
    _ = assert(records.exists(r => Graph.recordRef(r) == judgment.source))
    _ = assert(prepared.value.payload.manifest.entries.exists(e => e.ref == judgment.input && e.roles.contains(CapsuleRole.HumanBasisAccount)))
    offered = prepared.value.payload.manifest.entries.find(_.ref == presentation.reservedSourceRef).get
    _ = assert(offered.roles.contains(CapsuleRole.DerivedAccount) && !offered.roles.contains(CapsuleRole.Observation))
    _ = assert(records.exists { case GraphRecord.Edge(r) => r.detail match { case a: RelationDetail.Adoption => a.origin == AdoptionOrigin.CapturedAction; case _ => false }; case _ => false })
    _ = assertEquals(prepared.material.snapshot.events.map(_.phase), List(Phase.Planned))
  } yield () } }

  test("historical prerequisite evidence is not reclassified as a failed current warrant") { check { (repo, settings, scope) => for {
    created <- applyAs(repo, scope, human, List(
      Operation.Create("prior", unresolved, ContentInput.Task("Prior task", AcceptanceInput(List("Prior acceptance"), None), Execution.Delegated), Nil),
      Operation.Create("evidence", unresolved, ContentInput.Statement("Reported fixture result", Modality.Assertion), Nil),
      Operation.Bind("priorBinding", Target.Created("prior"), Nil, "other-context"),
      Operation.SelectBinding("priorSelection", Target.Created("priorBinding"), true, "Prior selection", List(Target.Created("prior"))),
      Operation.State("priorDone", Target.Created("priorBinding"), None, Phase.Completed, Some(Resolution.Fulfilled), Some("Reported fulfillment"), List(Target.Created("evidence")), "Not independently verified"),
      Operation.Create("next", unresolved, ContentInput.Task("Next task", AcceptanceInput(List("Next acceptance"), None), Execution.Delegated), Nil),
      Operation.Relate("historical", unresolved, RelationKind.DependsOn, List(Target.Created("next")), List(Target.Created("priorBinding")),
        RelationDetailInput.Dependency(Gate.Fulfillment, Consumption.Historical, Some(Target.Created("priorDone")), "Explicit historical use"), "Do not require current predecessor"),
      Operation.Bind("nextBinding", Target.Created("next"), List(Target.Created("historical")), workContext),
      Operation.SelectBinding("nextSelection", Target.Created("nextBinding"), true, "Next selection", List(Target.Created("next"))),
      Operation.State("active", Target.Created("nextBinding"), None, Phase.Active, None, None, Nil, "Reported activity")))
    _ <- applyAs(repo, scope, human, List(Operation.SelectBinding("retired", Target.Exact(ref(created, "priorBinding")), false, "Prior context no longer selected", List(Target.Exact(ref(created, "prior"))))))
    prepared <- prepare(repo, settings, scope, None)
    qualifications = prepared.value.payload.manifest.qualifications
    _ = assert(qualifications.exists(q => q.code == CapsuleQualificationCode.HistoricalEvidence && q.subjects.contains(ref(created, "priorDone"))))
    _ = assert(!qualifications.exists(q => q.code == CapsuleQualificationCode.StaleWarrant && q.subjects.contains(ref(created, "priorDone"))), "historical consumption must not impose current selection")
    _ = assert(!qualifications.exists(q => q.code == CapsuleQualificationCode.StaleWarrant && q.subjects.contains(ref(created, "active"))))
  } yield () } }

  test("reported inheritance is authorized and remains source-scoped instead of expanding foreign records") { check { (repo, settings, scope) => for {
    _ <- work(repo, scope)
    foreign <- capture(repo, scope + "-other")
    foreignGraph <- repo.read(scope + "-other")
    source <- material(repo, settings, scope, None)
    inherited = ReportedInheritance(InheritanceKind.Import, foreignGraph.scope, foreignGraph.generation, foreignGraph.sourceFrontier, foreignGraph.coveredFrontier, Nil, List(foreign.source), None)
    context = reportedNative.copy(reportedInherited = List(inherited))
    request = CapsuleRequest(scope, UUID.randomUUID(), workContext, Some(context), source.snapshot.sourceFrontier, None)
    call = ServiceCall.internal(settings.principal, "capsule.prepare", UUID.randomUUID())
    cfg = CapsuleSettings(Set(WorkContextKey(scope, workContext)), capsuleLimits)
    prepared = CapsuleProjection.prepare(source.copy(contextSnapshots = List(foreignGraph)), request, call, UUID.randomUUID(), Instant.parse("2026-11-11T00:01:00Z"), cfg, None)
    _ = assertEquals(prepared.payload.reportedContext.reportedInherited, List(inherited))
    _ = assert(!prepared.payload.records.exists(r => Graph.recordRef(r) == foreign.source))
    denied = ServiceCall.internal(settings.principal.copy(scopes = Set(scope)), "capsule.prepare", UUID.randomUUID())
    _ = assertEquals(intercept[Fault](CapsuleProjection.prepare(source, request, denied, UUID.randomUUID(), Instant.parse("2026-11-11T00:01:00Z"), cfg, None)).code, "forbidden")
  } yield () } }

  test("a resealed but incorrect baseline projection cannot become comparison evidence") { check { (repo, settings, scope) => for {
    _ <- work(repo, scope)
    before <- prepare(repo, settings, scope, None)
    payload = before.value.payload.copy(text = "Unrelated baseline account")
    altered = before.value.copy(payload = payload, payloadDigest = Digests.text(Wire.encode(CapsulePayload.codecJson, payload).noSpaces))
    result <- IO(CapsuleBaseline.validated(altered, before.material, None)).flatMap(baseline => prepare(repo, settings, scope, Some(baseline))).attempt
    _ = fault(result, "corrupt")
  } yield () } }

  test("projection bytes are deterministic and unusable explicit baselines do not silently disappear") { check { (repo, settings, scope) => for {
    _ <- work(repo, scope)
    prepared <- prepare(repo, settings, scope, None)
    source = prepared.material
    reordered = source.copy(snapshot = source.snapshot.copy(actors = source.snapshot.actors.reverse, definitions = source.snapshot.definitions.reverse, relations = source.snapshot.relations.reverse), inputs = source.inputs.reverse)
    same = CapsuleProjection.payload(reordered, workContext, prepared.value.payload.reportedContext, None, prepared.value.limits)
    _ = assertEquals(same, prepared.value.payload)
    request = CapsuleRequest(scope, UUID.randomUUID(), workContext, None, source.snapshot.sourceFrontier, Some(prepared.value.id))
    call = ServiceCall.internal(settings.principal, "capsule.prepare", UUID.randomUUID())
    cfg = CapsuleSettings(Set(WorkContextKey(scope, workContext)), capsuleLimits)
    _ = assertEquals(intercept[Fault](CapsuleProjection.prepare(source, request, call, UUID.randomUUID(), Instant.parse("2026-11-11T00:02:00Z"), cfg, None)).code, "capsule")
    _ = assertEquals(intercept[Fault](CapsuleProjection.prepare(source, request, call, UUID.randomUUID(), Instant.parse("2026-11-11T00:02:00Z"), cfg, Some(prepared.baseline))).code, "context")
  } yield () } }

  test("delivery retains a client boundary report without claiming equality with capsule bytes or provider use") { check { (repo, settings, scope) => for {
    _ <- work(repo, scope)
    prepared <- prepare(repo, settings, scope, None)
    before <- repo.read(scope)
    request = DeliveryRequest(scope, UUID.randomUUID(), prepared.value.id, prepared.value.payloadDigest, workContext, Some(reportedNative),
      DeliveryBoundary.ExtensionContext, Some("2027-01-01T00:00:00Z"), Some(ReportedBoundaryDigest("controlled-full-context-json", "a" * 64)))
    call = ServiceCall.internal(settings.principal, "delivery.report", UUID.randomUUID())
    receipt = DeliveryEngine.record(request, call, prepared.baseline, prepared.value.payload.cut, Nil, UUID.randomUUID(), Instant.parse("2026-11-11T00:02:00Z"))
    _ = assertEquals(receipt.reportedBoundaryPayload, request.reportedBoundaryPayload)
    _ = assertEquals(receipt.capsulePayloadDigest, prepared.value.payloadDigest)
    _ = assertEquals(receipt.reportedAt, request.reportedAt)
    _ = assertEquals(receipt.cutComparison, DeliveryCutComparison.SameGraphAndCoverage)
    _ = DeliveryEngine.validate(receipt, request, prepared.baseline, Nil)
    after <- repo.read(scope)
    _ = assertEquals(after, before)
  } yield () } }

  test("late delivery is retained with a changed-cut qualification rather than rejected as fresh admission") { check { (repo, settings, scope) => for {
    _ <- work(repo, scope)
    prepared <- prepare(repo, settings, scope, None)
    _ <- capture(repo, scope)
    status <- repo.curation.status(settings.principal, scope)
    request = DeliveryRequest(scope, UUID.randomUUID(), prepared.value.id, prepared.value.payloadDigest, workContext, Some(reportedNative), DeliveryBoundary.ClientContext, None, None)
    receipt = DeliveryEngine.record(request, ServiceCall.internal(settings.principal, "delivery.report", UUID.randomUUID()), prepared.baseline,
      CapsuleContext.cut(status), Nil, UUID.randomUUID(), Instant.parse("2026-11-11T00:02:00Z"))
    _ = assertEquals(receipt.cutComparison, DeliveryCutComparison.ChangedGraphOrCoverage)
    _ = assertEquals(receipt.observedCut.frontier, 1L)
    _ = assertEquals(receipt.observedCut.coveredFrontier, 0L)
    _ = DeliveryEngine.validate(receipt, request, prepared.baseline, Nil)
  } yield () } }

  test("delivery owner payload context and retained classification cannot be substituted") { check { (repo, settings, scope) => for {
    _ <- work(repo, scope)
    prepared <- prepare(repo, settings, scope, None)
    request = DeliveryRequest(scope, UUID.randomUUID(), prepared.value.id, prepared.value.payloadDigest, workContext, Some(reportedNative), DeliveryBoundary.ExtensionContext, None, None)
    call = ServiceCall.internal(settings.principal, "delivery.report", UUID.randomUUID())
    now = Instant.parse("2026-11-11T00:02:00Z")
    receipt = DeliveryEngine.record(request, call, prepared.baseline, prepared.value.payload.cut, Nil, UUID.randomUUID(), now)
    foreign = ServiceCall.internal(settings.principal.copy(actor = Actor("other-agent", ActorKind.Agent)), "delivery.report", UUID.randomUUID())
    _ = assertEquals(intercept[Fault](DeliveryEngine.record(request, foreign, prepared.baseline, prepared.value.payload.cut, Nil, UUID.randomUUID(), now)).code, "forbidden")
    _ = assertEquals(intercept[Fault](DeliveryEngine.record(request.copy(capsulePayloadDigest = "b" * 64), call, prepared.baseline, prepared.value.payload.cut, Nil, UUID.randomUUID(), now)).code, "delivery")
    _ = assertEquals(intercept[Fault](DeliveryEngine.record(request.copy(reportedContext = None), call, prepared.baseline, prepared.value.payload.cut, Nil, UUID.randomUUID(), now)).code, "context")
    _ = assertEquals(intercept[Fault](DeliveryEngine.validate(receipt.copy(cutComparison = DeliveryCutComparison.ChangedGraphOrCoverage), request, prepared.baseline, Nil)).code, "corrupt")
  } yield () } }

  test("selection replacement is an account revision, not deletion or transfer of prior binding-local progress") { check { (repo, settings, scope) => for {
    created <- work(repo, scope)
    before <- prepare(repo, settings, scope, None)
    replacement <- applyAs(repo, scope, human, List(
      Operation.Bind("replacement", Target.Exact(ref(created, "taskA")), Nil, workContext),
      Operation.SelectBinding("replacementSelection", Target.Created("replacement"), true, "Select a new contract instance", List(Target.Exact(ref(created, "taskA"))))))
    after <- prepare(repo, settings, scope, Some(before.baseline))
    changes = after.value.payload.manifest.changes
    _ = assert(changes.exists(c => c.previous.contains(ref(created, "selectionA")) && c.current.contains(ref(replacement, "replacementSelection"))))
    _ = assert(!changes.exists(c => c.account == ref(created, "planned") || c.previous.contains(ref(created, "planned"))))
    _ = assert(changes.forall(_.current.nonEmpty))
    _ = assert(!after.material.snapshot.events.exists(_.subject == ref(replacement, "replacement")))
  } yield () } }

  test("retirement does not manufacture fallback selection or cancellation") { check { (repo, settings, scope) => for {
    created <- work(repo, scope)
    before <- prepare(repo, settings, scope, None)
    retired <- applyAs(repo, scope, human, List(Operation.SelectBinding("retired", Target.Exact(ref(created, "bindingA")), false, "Retain but stop selecting", List(Target.Exact(ref(created, "taskA"))))))
    after <- prepare(repo, settings, scope, Some(before.baseline))
    _ = assert(after.value.payload.records.contains(GraphRecord.Progress(after.material.snapshot.events.head)))
    _ = assert(after.value.payload.manifest.entries.exists(e => e.ref == ref(created, "bindingA") && e.partition == CapsulePartition.HistoricalContext))
    change = after.value.payload.manifest.changes.find(_.account == ref(retired, "retired")).get
    _ = assertEquals(change.reason, Some("Retain but stop selecting"))
    _ = assertEquals(after.material.snapshot.events.size, 1)
    _ = assertEquals(after.material.snapshot.events.head.phase, Phase.Planned)
  } yield () } }
}

final class MemoryCapsuleProjectionSuite extends CapsuleProjectionContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] =
    Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresCapsuleProjectionSuite extends CapsuleProjectionContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
