package ontology.domain

import munit.FunSuite
import ontology.api.*
import java.util.UUID

final class QuotationRelationSuite extends FunSuite {
  private val engine = new AdmissionEngine
  private val applicability = ApplicabilityInput.Unresolved("Fixture does not establish semantic scope", Nil, Nil)
  private def run(graph: GraphSnapshot, operations: List[Operation]): Applied = {
    val id = UUID.randomUUID()
    engine(graph, ApplyRequest(graph.scope, id, graph.generation, operations, None), Admission(ontology.TestContexts.principal(graph.scope, Actor("interpreter", ActorKind.Agent)), Actor("fixture-host", ActorKind.Service), id, "fixture", ontology.TestContexts.trace("fixture-apply"), Nil))
  }
  private def definition(alias: String, text: String): Operation = Operation.Create(alias, applicability, ContentInput.Statement(text, Modality.Assertion), Nil)
  private def relation(kind: RelationKind, source: Target, target: Target): Operation = Operation.Relate("account", applicability, kind, List(source), List(target), RelationDetailInput.Empty(), "Attributed relation account, not independent verification")
  List(RelationKind.Quotes, RelationKind.Interprets).foreach { kind =>
    test(s"$kind permits exact definition-to-definition accounts without changing attribution") {
      val result = run(Graph.empty("fixture"), List(definition("prior", "Original formulation"), definition("derived", "Quoted or interpreted formulation"), relation(kind, Target.Created("prior"), Target.Created("derived"))))
      val edge = result.snapshot.relations.head
      assertEquals(edge.sources, List(result.result.created.find(_.alias == "prior").get.ref))
      assertEquals(edge.targets, List(result.result.created.find(_.alias == "derived").get.ref))
      assertEquals(edge.provenance.contributor.kind, ActorKind.Agent)
      assertEquals(result.snapshot.definitions.head.content, Content.Statement("Original formulation", Modality.Assertion))
      assertEquals(edge.applicability, Applicability.Unresolved("Fixture does not establish semantic scope", Nil, Nil))
    }
    test(s"$kind does not admit actor endpoints or cross-namespace references") {
      val actor = ActorRecord(Ref(UUID.randomUUID(), 1), Actor("registered-actor", ActorKind.Agent))
      val base = run(Graph.empty("fixture").copy(actors = List(actor)), List(definition("claim", "Statement")))
      val claim = base.snapshot.definitions.head.ref
      intercept[Fault](run(base.snapshot, List(relation(kind, Target.Exact(actor.ref), Target.Exact(claim)))))
      val foreign = run(Graph.empty("foreign"), List(definition("foreign", "Other namespace"))).snapshot.definitions.head.ref
      assertEquals(intercept[Fault](run(base.snapshot, List(relation(kind, Target.Exact(foreign), Target.Exact(claim))))).code, "reference")
      assertEquals(base.snapshot.relations, Nil)
    }
  }
}
