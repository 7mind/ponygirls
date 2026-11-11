package ontology.domain

import ontology.api.*
import java.util.UUID

final case class AdoptionClaim(presentationId: UUID, response: Ref)
object Adoptions {
  def claims(request: ApplyRequest): List[AdoptionClaim] = request.operations.flatMap { operation =>
    val detail = operation match {
      case value: Operation.Relate if Set(RelationKind.Adopts, RelationKind.Chooses).contains(value.kind) => Some(value.detail)
      case value: Operation.ReviseRelation => Some(value.detail)
      case _ => None
    }
    detail.toList.collect { case value: RelationDetailInput.Adoption if value.origin == AdoptionOrigin.Interpretation =>
      val response = value.response match {
        case Target.Exact(ref) => ref
        case _: Target.Created => throw Fault("presentation", "a retained response requires an exact reference")
      }
      AdoptionClaim(value.presentationId, response)
    }
  }.distinct

  def validate(graph: GraphSnapshot, relation: Relation, detail: RelationDetail.Adoption, evidence: List[ReviewEvidence]): Unit = {
    val matching = evidence.filter(value => value.presentation.id == detail.presentationId && value.judgment.source == detail.response)
    Require(matching.size == 1, "presentation", "validated presentation response pair required")
    val retained = matching.head
    Require(retained.presentation.payload.scope == graph.scope && retained.judgment.scope == graph.scope &&
      retained.judgment.presentationId == detail.presentationId, "presentation", "presentation response scope mismatch")
    val target = detail.selection match {
      case value: PresentedSelection.Whole => value.target
      case value: PresentedSelection.Alternative => value.target
    }
    Require(relation.targets == List(target) && (graph.bindings.exists(_.ref == target) || graph.definitions.exists(node => node.ref == target && node.content.isInstanceOf[Content.Source])),
      "presentation", "adoption target must be the exact presented Source or Binding")
    val manifest = retained.presentation.payload.manifest
    relation.kind match {
      case RelationKind.Adopts => Require(detail.selection.isInstanceOf[PresentedSelection.Whole] && manifest.adoptionTargets.contains(target), "presentation", "target was not presented for adoption")
      case RelationKind.Chooses => Require(manifest.choices.contains(detail.selection), "presentation", "selection was not an exact presented choice")
      case _ => throw Fault("invariant", "adoption validator requires an adoption or choice relation")
    }
    val source = Graph.node(graph, relation.sources.head)
    val account = !source.content.isInstanceOf[Content.Source] && source.basis.contains(detail.response)
    Require(source.ref == detail.response || account, "presentation", "interpretation account must be grounded in the exact linked response")
  }
}
