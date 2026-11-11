package ontology

import ontology.api.*
import ontology.domain.{CaptureIdentity, Require}
import java.util.UUID

sealed trait PrimaryOutcome
object PrimaryOutcome {
  final case class Captured(value: IngestResult) extends PrimaryOutcome
  final case class Reviewed(value: Judgment) extends PrimaryOutcome
}
final case class PrimaryRecord(eventId: UUID, event: CapturedEvent, fingerprint: String, outcome: PrimaryOutcome) {
  def kind: InputKind = outcome match {
    case _: PrimaryOutcome.Captured => InputKind.Capture
    case _: PrimaryOutcome.Reviewed => InputKind.Judgment
  }
}
object PrimaryRecord {
  def validateCaptureResult(event: CapturedEvent, result: IngestResult, eventId: UUID): Unit =
    Require(result.scope == event.scope && result.eventId == eventId && result.sourceNamespace == event.sourceNamespace &&
      result.source == Ref(event.id, 1) && result.frontier == event.frontier && result.artifacts == CaptureIdentity.artifacts(event),
      "corrupt", "capture result binding mismatch")
}
