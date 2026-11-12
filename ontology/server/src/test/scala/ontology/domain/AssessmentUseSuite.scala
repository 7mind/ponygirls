package ontology.domain

import munit.FunSuite
import ontology.api.*
import java.util.UUID

final class AssessmentUseSuite extends FunSuite {
  private val engine = new AdmissionEngine
  private val applicability = ApplicabilityInput.Declared("Only this synthetic work context", Nil, Nil)
  private def run(graph: GraphSnapshot, operations: List[Operation]): Applied = {
    val id = UUID.randomUUID()
    engine(graph, ApplyRequest(graph.scope, id, graph.generation, operations, None), Admission(ontology.TestContexts.principal(graph.scope, Actor("curator", ActorKind.Agent)), Actor("fixture-host", ActorKind.Service), id, "fixture", ontology.TestContexts.trace("fixture-apply"), Nil))
  }
  private def setup: List[Operation] = List(
    Operation.Create("condition", applicability, ContentInput.Statement("Required condition", Modality.Assertion), Nil),
    Operation.Bind("condition-binding", Target.Created("condition"), Nil, "fixture"),
    Operation.SelectBinding("select-condition", Target.Created("condition-binding"), true, "Fixture condition", List(Target.Created("condition"))),
    Operation.Create("review", applicability, ContentInput.Review("Assessment", List("Supported within its declared scope"), List(Target.Created("condition-binding")), List(Target.Created("condition")), "Not independent verification", Assessment.Supported), Nil),
    Operation.Relate("assessment", applicability, RelationKind.Assesses, List(Target.Created("review")), List(Target.Created("condition-binding")), RelationDetailInput.Empty(), "Exact assessed subject"),
    Operation.Create("task", applicability, ContentInput.Task("Conditional work", AcceptanceInput(List("Observable outcome"), None), Execution.Delegated), Nil),
    Operation.Relate("requirement", applicability, RelationKind.Requires, List(Target.Created("task")), List(Target.Created("condition-binding")), RelationDetailInput.Empty(), "Condition required"),
    Operation.Bind("consumer", Target.Created("task"), List(Target.Created("requirement")), "fixture"),
    Operation.SelectBinding("select-consumer", Target.Created("consumer"), true, "Fixture plan", List(Target.Created("task"))))

  private val unqualified = ApplicabilityInput.Unresolved("Scope unresolved", Nil, Nil)
  private val opening = Operation.State("start", Target.Created("consumer"), None, Phase.Active, None, None, Nil, "Reported work")
  private def reference(result: Applied, alias: String): Ref = result.result.created.find(_.alias == alias).get.ref
  private def use(alias: String, assessmentAlias: String, disposition: AssessmentUseDisposition, qualification: ApplicabilityInput): Operation.Relate =
    Operation.Relate(alias, qualification, RelationKind.UsesAssessment, List(Target.Created(assessmentAlias)), List(Target.Created("consumer")), RelationDetailInput.AssessmentUse(Target.Created("requirement"), disposition, List(Target.Created("condition"))), "Explicit synthetic applicability account")
  private def fixture(unresolvedAt: String, assessment: Assessment): List[Operation] = setup.map {
    case value: Operation.Create =>
      val content = value.content match {
        case review: ContentInput.Review => review.copy(assessment = assessment, findings = List(assessment.toString))
        case other => other
      }
      value.copy(applicability = if (value.alias == unresolvedAt) unqualified else value.applicability, content = content)
    case value: Operation.Relate => value.copy(applicability = if (value.alias == unresolvedAt) unqualified else value.applicability)
    case other => other
  }
  private def rejected(code: String, operations: List[Operation]): Unit = {
    val seed = Graph.empty("fixture")
    assertEquals(intercept[Fault](run(seed, operations)).code, code)
    assertEquals(seed, Graph.empty("fixture"))
  }

  private def ready: Applied = run(Graph.empty("fixture"), fixture("", Assessment.Supported) ++ List(use("use", "assessment", AssessmentUseDisposition.Applicable, applicability), opening))
  private def exact(r: Applied, alias: String): Target = Target.Exact(reference(r, alias))
  private def exactUse(r: Applied, alias: String, assessment: Target): Operation.Relate =
    use(alias, "unused", AssessmentUseDisposition.Applicable, applicability).copy(sources = List(assessment), targets = List(exact(r, "consumer")), detail = RelationDetailInput.AssessmentUse(exact(r, "requirement"), AssessmentUseDisposition.Applicable, List(exact(r, "condition"))))
  private def furtherReview(r: Applied): ContentInput.Review = ContentInput.Review("Further account", List("Supported"), List(exact(r, "condition-binding")), List(exact(r, "condition")), "Synthetic", Assessment.Supported)
  private def more(r: Applied, accounted: Boolean): List[Operation] = List[Operation](
    Operation.Create("extra-review", applicability, furtherReview(r), Nil),
    Operation.Relate("extra-assessment", applicability, RelationKind.Assesses, List(Target.Created("extra-review")), List(exact(r, "condition-binding")), RelationDetailInput.Empty(), "Additional assessment")) ++
    (if (accounted) List(exactUse(r, "extra-use", Target.Created("extra-assessment"))) else Nil)
  private def editUse(r: Applied, standing: Standing): Operation.ReviseRelation = {
    val value = exactUse(r, "unused", exact(r, "assessment"))
    Operation.ReviseRelation("edited-use", reference(r, "use"), applicability, value.sources, value.targets, value.detail, "Explicit account revision", standing)
  }

  test("use admission rejects wrong exact endpoints and immutable detail repurposing") {
    val r = ready
    val value = exactUse(r, "bad", exact(r, "assessment"))
    val detail = value.detail.asInstanceOf[RelationDetailInput.AssessmentUse]
    List(value.copy(sources = List(exact(r, "requirement"))), value.copy(targets = List(exact(r, "condition-binding"))), value.copy(detail = detail.copy(requirement = exact(r, "assessment")))).foreach { invalid =>
      assertEquals(intercept[Fault](run(r.snapshot, List(invalid))).code, "assessment-use")
    }
    val changed = editUse(r, Standing.Active).copy(detail = detail.copy(disposition = AssessmentUseDisposition.Excluded))
    assertEquals(intercept[Fault](run(r.snapshot, List(changed))).code, "identity")
    assertEquals(Graph.relation(r.snapshot, reference(r, "use")).detail.asInstanceOf[RelationDetail.AssessmentUse].disposition, AssessmentUseDisposition.Applicable)
  }

  test("a stale Review candidate cannot disappear behind another supporting assessment") {
    val r = ready
    val revision = Operation.Revise("review-v2", reference(r, "review"), applicability, furtherReview(r), Standing.Active, List(exact(r, "condition")), "Revised assessment account")
    val changed = run(r.snapshot, more(r, true) :+ revision)
    val consumer = Graph.binding(changed.snapshot, reference(r, "consumer"))
    assertEquals(intercept[Fault](Gates.evaluate(changed.snapshot, consumer)).code, "assessment-use")
    assertEquals(Graph.relation(changed.snapshot, reference(r, "assessment")).standing, Standing.Active)
    assertEquals(Graph.node(changed.snapshot, reference(r, "review")), Graph.node(r.snapshot, reference(r, "review")))
  }

  test("transaction-end validation rejects withdrawal or a new unaccounted candidate after a report") {
    val r = ready
    val report = Operation.State("again", exact(r, "consumer"), Some(reference(r, "start")), Phase.Active, None, None, Nil, "Reported work")
    val before = r.snapshot
    List(List[Operation](editUse(r, Standing.Withdrawn)), more(r, false)).foreach { suffix =>
      assertEquals(intercept[Fault](run(r.snapshot, report :: suffix)).code, "assessment-use")
      assertEquals(r.snapshot, before)
      assertEquals(Graph.latestEvent(r.snapshot, reference(r, "consumer")).get.ref, reference(r, "start"))
    }
  }

  test("same-binding reselection and unrelated evidence preserve the recorded warrant") {
    val r = ready
    val event = Graph.event(r.snapshot, reference(r, "start"))
    val selections = List("consumer", "condition-binding").map { alias =>
      Operation.SelectBinding("reselect-" + alias, exact(r, alias), true, "Reaffirm same contract", List(exact(r, "condition")))
    }
    val changed = run(r.snapshot, selections :+ Operation.Create("unrelated", applicability, ContentInput.Statement("Unrelated observation account", Modality.ObservationAccount), Nil))
    Gates.validateEvent(changed.snapshot, event)
    assertEquals(Graph.event(changed.snapshot, event.ref), event)
    assert(Selections.current(changed.snapshot, Graph.binding(changed.snapshot, reference(r, "consumer"))).get.ref != reference(r, "select-consumer"))
  }

  test("new relevant assessments or changed use revisions invalidate the old exact warrant") {
    val r = ready
    val event = Graph.event(r.snapshot, reference(r, "start"))
    List(more(r, true), List[Operation](editUse(r, Standing.Active))).foreach { operations =>
      val changed = run(r.snapshot, operations)
      Gates.evaluate(changed.snapshot, Graph.binding(changed.snapshot, reference(r, "consumer")))
      assertEquals(intercept[Fault](Gates.validateEvent(changed.snapshot, event)).code, "stale-warrant")
      assertEquals(Graph.event(changed.snapshot, event.ref), event)
    }
  }

  test("an inspectable historical retirement in applicability basis is not a live selection witness") {
    val r = ready
    val replacement = exactUse(r, "replacement-use", exact(r, "assessment")).copy(detail = RelationDetailInput.AssessmentUse(exact(r, "requirement"), AssessmentUseDisposition.Applicable, List(Target.Created("retirement"))))
    val result = run(r.snapshot, List(
      Operation.Create("other", applicability, ContentInput.Statement("Other context", Modality.Assertion), Nil),
      Operation.Bind("other-binding", Target.Created("other"), Nil, "other-context"),
      Operation.SelectBinding("other-selection", Target.Created("other-binding"), true, "Then selected", List(Target.Created("other"))),
      Operation.SelectBinding("retirement", Target.Created("other-binding"), false, "Historical applicability evidence", List(Target.Created("other"))),
      editUse(r, Standing.Withdrawn), replacement,
      Operation.State("again", exact(r, "consumer"), Some(reference(r, "start")), Phase.Active, None, None, Nil, "New report")))
    val event = Graph.event(result.snapshot, reference(result, "again"))
    assert(event.gateBasis.references.contains(reference(result, "retirement")))
    assert(!event.gateBasis.selectionWitnesses.contains(reference(result, "retirement")))
    Gates.validateEvent(result.snapshot, event)
  }

  test("a stored warrant missing its actual selection witnesses must be rejected") {
    val r = ready
    val event = Graph.event(r.snapshot, reference(r, "start"))
    val missing = event.copy(gateBasis = event.gateBasis.copy(selectionWitnesses = Nil))
    assertEquals(intercept[Fault](Gates.validateEvent(r.snapshot, missing)).code, "stale-warrant")
  }

  test("extraneous or non-selection control witnesses cannot enter a stored warrant") {
    val r = ready
    val event = Graph.event(r.snapshot, reference(r, "start"))
    val changed = run(r.snapshot, List(
      Operation.Create("other", applicability, ContentInput.Statement("Unrelated context", Modality.Assertion), Nil),
      Operation.Bind("other-binding", Target.Created("other"), Nil, "unrelated"),
      Operation.SelectBinding("other-selection", Target.Created("other-binding"), true, "Separate selection", List(Target.Created("other")))))
    val extra = event.copy(gateBasis = event.gateBasis.copy(selectionWitnesses = event.gateBasis.selectionWitnesses :+ reference(changed, "other-selection")))
    assertEquals(intercept[Fault](Gates.validateEvent(changed.snapshot, extra)).code, "stale-warrant")
    val wrongKind = event.copy(gateBasis = event.gateBasis.copy(selectionWitnesses = List(reference(r, "consumer"))))
    assertEquals(intercept[Fault](Gates.validateEvent(changed.snapshot, wrongKind)).code, "corrupt")
    Gates.validateEvent(changed.snapshot, event)
  }

  test("Applicable support admits work and records exact host-derived gate witnesses") {
    val result = run(Graph.empty("fixture"), fixture("", Assessment.Supported) ++ List(use("use", "assessment", AssessmentUseDisposition.Applicable, applicability), opening))
    val event = Graph.event(result.snapshot, reference(result, "start"))
    val expected = Set("consumer", "select-consumer", "requirement", "condition-binding", "select-condition", "assessment", "review", "use", "condition").map(name => reference(result, name))
    assertEquals(event.phase, Phase.Active)
    assertEquals(Gates.references(event.gateBasis).toSet, expected)
    assertEquals(event.gateBasis.selectionWitnesses.toSet, Set(reference(result, "select-consumer"), reference(result, "select-condition")))
    assertEquals(event.gateBasis.references.distinct, event.gateBasis.references)
    assertEquals(event.evidence, Nil)
    val binding = Graph.binding(result.snapshot, reference(result, "consumer"))
    assert(!binding.context.contains(reference(result, "use")))
  }

  test("each required qualification independently blocks Applicable consumption when Unresolved") {
    List("task", "condition", "requirement", "assessment", "review", "use").foreach { alias =>
      val qualification = if (alias == "use") unqualified else applicability
      val operations = fixture(alias, Assessment.Supported) ++ List(use("use", "assessment", AssessmentUseDisposition.Applicable, qualification), opening)
      rejected("assessment-use", operations)
    }
  }

  test("Applicable contradictory mixed or unassessed reviews cannot satisfy the condition") {
    List(Assessment.Contradicted, Assessment.Mixed, Assessment.Unassessed).foreach { assessment =>
      rejected("condition", fixture("", assessment) ++ List(use("use", "assessment", AssessmentUseDisposition.Applicable, applicability), opening))
    }
  }

  test("explicit exclusion preserves contradictory or unassessed records with unresolved scope") {
    List(Assessment.Contradicted, Assessment.Unassessed).foreach { assessment =>
      val extra = List[Operation](
        Operation.Create("excluded-review", unqualified, ContentInput.Review("Other scoped assessment", List(assessment.toString), List(Target.Created("condition-binding")), List(Target.Created("condition")), "Scope unresolved", assessment), Nil),
        Operation.Relate("excluded-assessment", unqualified, RelationKind.Assesses, List(Target.Created("excluded-review")), List(Target.Created("condition-binding")), RelationDetailInput.Empty(), "Retained exact assessment"),
        use("excluded-use", "excluded-assessment", AssessmentUseDisposition.Excluded, applicability))
      val result = run(Graph.empty("fixture"), fixture("", Assessment.Supported) ++ List(use("use", "assessment", AssessmentUseDisposition.Applicable, applicability)) ++ extra :+ opening)
      val definition = Graph.node(result.snapshot, reference(result, "excluded-review"))
      val review = definition.content.asInstanceOf[Content.Review]
      assertEquals(review.assessment, assessment)
      assertEquals(review.findings, List(assessment.toString))
      assertEquals(review.uncertainty, "Scope unresolved")
      assertEquals(definition.applicability, Applicability.Unresolved("Scope unresolved", Nil, Nil))
      assertEquals(definition.standing, Standing.Active)
      assertEquals(Graph.relation(result.snapshot, reference(result, "excluded-assessment")).standing, Standing.Active)
      val excluded = Graph.relation(result.snapshot, reference(result, "excluded-use"))
      assertEquals(excluded.detail.asInstanceOf[RelationDetail.AssessmentUse].disposition, AssessmentUseDisposition.Excluded)
      assert(Graph.event(result.snapshot, reference(result, "start")).gateBasis.references.contains(excluded.ref))
    }
  }

  test("all-excluded ambiguous or unresolved use cannot open the gate") {
    val cases: List[(String, List[Operation])] = List(
      "condition" -> List(use("use", "assessment", AssessmentUseDisposition.Excluded, applicability)),
      "assessment-use" -> List(use("use", "assessment", AssessmentUseDisposition.Unresolved, applicability)),
      "assessment-use" -> List(use("use", "assessment", AssessmentUseDisposition.Excluded, unqualified)),
      "assessment-use" -> List(use("first", "assessment", AssessmentUseDisposition.Applicable, applicability), use("second", "assessment", AssessmentUseDisposition.Applicable, applicability)))
    cases.foreach { case (code, accounts) => rejected(code, fixture("", Assessment.Supported) ++ accounts :+ opening) }
  }

  test("Supported assessment without an explicit consumer applicability account cannot open a requirement gate") {
    val seed = Graph.empty("fixture")
    val attempt = setup :+ Operation.State("start", Target.Created("consumer"), None, Phase.Active, None, None, Nil, "Reported work")
    assertEquals(intercept[Fault](run(seed, attempt)).code, "assessment-use")
    assertEquals(seed, Graph.empty("fixture"))
  }
}
