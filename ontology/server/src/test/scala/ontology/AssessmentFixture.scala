package ontology

import ontology.api.*
import ontology.domain.*
import java.util.UUID

object AssessmentFixture {
  val applicability: ApplicabilityInput = ApplicabilityInput.Declared("Only this controlled fixture", Nil, Nil)
  def operations: List[Operation] = List(
    Operation.Create("condition", applicability, ContentInput.Statement("Condition", Modality.Assertion), Nil),
    Operation.Bind("cb", Target.Created("condition"), Nil, "fixture"),
    Operation.SelectBinding("sc", Target.Created("cb"), true, "Condition context", List(Target.Created("condition"))),
    Operation.Create("review", applicability, ContentInput.Review("Review", List("Supported within fixture"), List(Target.Created("cb")), List(Target.Created("condition")), "Not independently verified", Assessment.Supported), Nil),
    Operation.Relate("assessment", applicability, RelationKind.Assesses, List(Target.Created("review")), List(Target.Created("cb")), RelationDetailInput.Empty(), "Exact subject"),
    Operation.Create("task", applicability, ContentInput.Task("Conditional task", AcceptanceInput(List("Observable outcome"), None), Execution.Delegated), Nil),
    Operation.Relate("required", applicability, RelationKind.Requires, List(Target.Created("task")), List(Target.Created("cb")), RelationDetailInput.Empty(), "Required condition"),
    Operation.Bind("consumer", Target.Created("task"), List(Target.Created("required")), "fixture"),
    Operation.SelectBinding("st", Target.Created("consumer"), true, "Consumer context", List(Target.Created("task"))),
    Operation.Relate("use", applicability, RelationKind.UsesAssessment, List(Target.Created("assessment")), List(Target.Created("consumer")), RelationDetailInput.AssessmentUse(Target.Created("required"), AssessmentUseDisposition.Applicable, List(Target.Created("condition"))), "Explicit use here"),
    Operation.State("done", Target.Created("consumer"), None, Phase.Completed, Some(Resolution.NotFulfilled), Some("Investigation completed without fulfillment"), Nil, "Reported only"))
  def admission(request: ApplyRequest): Admission = Admission(ontology.TestContexts.principal(request.scope, Actor("fixture-curator", ActorKind.Agent)), Actor("fixture-service", ActorKind.Service), request.requestId, "fixture", ontology.TestContexts.trace("fixture-apply"), Nil)
  def request(scope: String, generation: Long, operations: List[Operation]): ApplyRequest = ApplyRequest(scope, UUID.randomUUID(), generation, operations, None)
  def ref(result: ApplyResult, alias: String): Ref = result.created.find(_.alias == alias).get.ref
  def changedReview(result: ApplyResult): Operation = Operation.Revise("review2", ref(result, "review"), applicability,
    ContentInput.Review("Contradictory revision", List("New contrary information"), List(Target.Exact(ref(result, "cb"))), List(Target.Exact(ref(result, "condition"))), "Needs reassessment", Assessment.Contradicted), Standing.Active, List(Target.Exact(ref(result, "condition"))), "Assessment changed")
  def snapshot(scope: String): GraphSnapshot = {
    val input = request(scope, 0L, operations)
    new AdmissionEngine().apply(Graph.empty(scope), input, admission(input)).snapshot
  }
}
