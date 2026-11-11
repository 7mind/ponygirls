package ontology

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import ontology.api.*
import ontology.domain.*
import java.util.UUID
import munit.FunSuite

final class BindingCurrentnessReproductions extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private val principal = Principal("read", Actor("reader", ActorKind.Agent), Set("s"), Set(Capability.Read))
  private def task(name: String) = Content.Task(name, Acceptance(List("defined acceptance"), None), Execution.Delegated)
  private def apply(repo: GraphRepository, generation: Long, ops: List[Operation]): IO[ApplyResult] = {
    val id = UUID.randomUUID()
    repo.apply(ApplyRequest("s", id, generation, ops, None), Admission(ontology.TestContexts.principal("s", Actor("a", ActorKind.Agent)), Actor("host", ActorKind.Service), id, "now", ontology.TestContexts.trace("fixture-apply"), Nil))
  }
  private def find(result: ApplyResult, name: String): Ref = result.created.find(_.alias == name).get.ref
  private def query(repo: GraphRepository) = new GraphQueries(repo, new CursorSigner(Array.fill[Byte](32)(9)), QueryLimits(100, 100, 65536, 2048))
  private enum ContextChange { case Revision, Retirement }
  for (consumption <- List(Consumption.Current, Consumption.Historical); change <- ContextChange.values.toList) {
    test(s"$consumption prerequisite $change has explicit applicability semantics") {
      val repo = new MemoryGraphRepository(new AdmissionEngine, TestReview.domain); val queries = query(repo)
      (for {
        p <- apply(repo, 0L, List(Operation.Create("p", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Prerequisite")), Nil), Operation.Create("evidence", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("Reported result", Modality.Assertion)), Nil), Operation.Bind("pb", Target.Created("p"), Nil, "fixture"), Operation.SelectBinding("pb-selection", Target.Created("pb"), true, "Selected by this fixture", List(Target.Created("p"))), Operation.State("pe", Target.Created("pb"), None, Phase.Completed, Some(Resolution.Fulfilled), Some("done"), List(Target.Created("evidence")), "reported, not independently attested")))
        dependent <- apply(repo, 1L, List(Operation.Create("t", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Dependent")), Nil), Operation.Relate("dependency", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.DependsOn, List(Target.Created("t")), List(Target.Exact(find(p, "pb"))), ontology.TestAuthoring.detail(RelationDetail.Dependency(Gate.Fulfillment, consumption, if (consumption == Consumption.Historical) Some(find(p, "pe")) else None, "Bound earlier result")), "Prerequisite"), Operation.Bind("tb", Target.Created("t"), List(Target.Created("dependency")), "fixture"), Operation.SelectBinding("tb-selection", Target.Created("tb"), true, "Selected by this fixture", List(Target.Created("t"))), Operation.State("te", Target.Created("tb"), None, Phase.Active, None, None, Nil, "")))
        mutation = change match {
          case ContextChange.Revision => Operation.Revise("p2", find(p, "p"), ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Revised prerequisite")), Standing.Active, List(Target.Exact(find(p, "evidence"))), "Changed prerequisite contract")
          case ContextChange.Retirement => Operation.SelectBinding("retired", Target.Exact(find(p, "pb")), false, "This contract is no longer selected", List(Target.Exact(find(p, "evidence"))))
        }
        _ <- apply(repo, 2L, List(mutation))
        current <- queries.read(principal, ReadRequest("s", ReadView.Current, Nil, None, 100))
        dependentVisible = current.records.collect { case GraphRecord.Progress(value) if value.subject == find(dependent, "tb") => value }.nonEmpty
        _ = assertEquals(dependentVisible, consumption == Consumption.Historical)
        history <- queries.read(principal, ReadRequest("s", ReadView.History, Nil, None, 100))
        _ = assert(history.records.exists { case GraphRecord.Progress(value) => value.ref == find(dependent, "te"); case _ => false })
      } yield ()).unsafeRunSync()(using runtime)
    }
  }
  test("revised required-condition binding invalidates dependent current progress") {
    val repo = new MemoryGraphRepository(new AdmissionEngine, TestReview.domain); val queries = query(repo)
    val applicability = ApplicabilityInput.Declared("This condition-revision fixture", Nil, Nil)
    (for {
      condition <- apply(repo, 0L, List(Operation.Create("c", applicability, ontology.TestAuthoring.content(Content.Statement("Condition v1", Modality.Assertion)), Nil), Operation.Bind("cb", Target.Created("c"), Nil, "fixture"), Operation.SelectBinding("cb-selection", Target.Created("cb"), true, "Selected by this fixture", List(Target.Created("c")))))
      t <- apply(repo, 1L, List(Operation.Create("review", applicability, ontology.TestAuthoring.content(Content.Review("Assessment", List("Declared support"), List(find(condition, "cb")), List(find(condition, "c")), "not a host fact", Assessment.Supported)), Nil), Operation.Relate("assessment", applicability, RelationKind.Assesses, List(Target.Created("review")), List(Target.Exact(find(condition, "cb"))), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Exact subject"), Operation.Create("t", applicability, ontology.TestAuthoring.content(task("Conditional work")), Nil), Operation.Relate("condition", applicability, RelationKind.Requires, List(Target.Created("t")), List(Target.Exact(find(condition, "cb"))), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Required condition"), Operation.Bind("tb", Target.Created("t"), List(Target.Created("condition")), "fixture"), Operation.SelectBinding("tb-selection", Target.Created("tb"), true, "Selected by this fixture", List(Target.Created("t"))), Operation.Relate("use", applicability, RelationKind.UsesAssessment, List(Target.Created("assessment")), List(Target.Created("tb")), RelationDetailInput.AssessmentUse(Target.Created("condition"), AssessmentUseDisposition.Applicable, List(Target.Exact(find(condition, "c")))), "Explicit applicability to this consumer"), Operation.State("active", Target.Created("tb"), None, Phase.Active, None, None, Nil, "")))
      _ <- apply(repo, 2L, List(Operation.Revise("c2", find(condition, "c"), ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("Changed condition", Modality.Assertion)), Standing.Active, List(Target.Exact(find(condition, "c"))), "Condition applicability changed")))
      current <- queries.read(principal, ReadRequest("s", ReadView.Current, Nil, None, 100))
      _ = assert(!current.records.exists { case GraphRecord.Progress(value) => value.ref == find(t, "active"); case _ => false })
      history <- queries.read(principal, ReadRequest("s", ReadView.History, Nil, None, 100))
      _ = assert(history.records.exists { case GraphRecord.Progress(value) => value.ref == find(t, "active"); case _ => false })
    } yield ()).unsafeRunSync()(using runtime)
  }
  test("unsatisfied completion gate does not hide a structurally current planned binding") {
    val repo = new MemoryGraphRepository(new AdmissionEngine, TestReview.domain); val queries = query(repo)
    (for {
      p <- apply(repo, 0L, List(Operation.Create("p", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Unfinished prerequisite")), Nil), Operation.Bind("pb", Target.Created("p"), Nil, "fixture"), Operation.SelectBinding("pb-selection", Target.Created("pb"), true, "Selected by this fixture", List(Target.Created("p")))))
      t <- apply(repo, 1L, List(Operation.Create("t", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Planned")), Nil), Operation.Relate("dependency", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.DependsOn, List(Target.Created("t")), List(Target.Exact(find(p, "pb"))), ontology.TestAuthoring.detail(RelationDetail.Dependency(Gate.Completion, Consumption.Current, None, "")), "Wait for predecessor"), Operation.Bind("tb", Target.Created("t"), List(Target.Created("dependency")), "fixture"), Operation.SelectBinding("tb-selection", Target.Created("tb"), true, "Selected by this fixture", List(Target.Created("t"))), Operation.State("planned", Target.Created("tb"), None, Phase.Planned, None, None, Nil, "Prerequisite not completed")))
      current <- queries.read(principal, ReadRequest("s", ReadView.Current, Nil, None, 100))
      _ = assert(current.records.exists { case GraphRecord.Progress(value) => value.ref == find(t, "planned"); case _ => false })
    } yield ()).unsafeRunSync()(using runtime)
  }
}
