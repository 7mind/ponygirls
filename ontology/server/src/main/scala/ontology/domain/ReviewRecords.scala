package ontology.domain

import ontology.api.*
import ontology.Digests
import java.util.UUID

object ReviewRecords {
  val JudgmentEncoding = "ontology.api.JudgmentRequest/0.1.0 canonical JSON"
  def metadata(judgmentId: UUID, presentationId: UUID): CaptureMetadata =
    CaptureMetadata(judgmentId.toString, Some(presentationId.toString), None, SourceRepresentation.HumanJudgment, Nil, Nil)

  def source(event: CapturedEvent, presentation: Presentation): Definition = {
    val ref = Ref(event.id, 1)
    Definition(ref, event.scope, Applicability.Captured(ref), Content.Source(event.text,
      (presentation.reservedSourceRef :: presentation.payload.targets).distinct, Digests.text(event.text),
      SourceDescriptor.PrimaryCapture(event.id, event.sourceNamespace, event.context, event.metadata, event.origin, event.observation, event.reviewResponse)),
      Standing.Active, List(presentation.reservedSourceRef), None, event.provenance)
  }

  def relation(judgment: Judgment, provenance: Provenance): Option[Relation] = {
    val selected = judgment.action match {
      case _: ReviewAction.Review => None
      case value: ReviewAction.Choose => Some(RelationKind.Chooses -> value.selection)
      case value: ReviewAction.Adopt => Some(RelationKind.Adopts -> PresentedSelection.Whole(value.target))
    }
    selected.map { case (kind, selection) =>
      val target = selection match {
        case value: PresentedSelection.Whole => value.target
        case value: PresentedSelection.Alternative => value.target
      }
      Relation(ReviewIdentity.relation(judgment.scope, judgment.actor, judgment.requestId), judgment.scope,
        Applicability.Captured(judgment.source), kind, List(judgment.source), List(target),
        RelationDetail.Adoption(judgment.presentationId, AdoptionOrigin.CapturedAction, judgment.source, selection),
        judgment.rationale, Standing.Active, provenance)
    }
  }
}
