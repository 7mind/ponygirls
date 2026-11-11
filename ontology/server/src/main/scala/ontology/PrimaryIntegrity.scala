package ontology

import ontology.api.*
import ontology.domain.*

object PrimaryIntegrity {
  private def frame(graph: GraphSnapshot, record: PrimaryRecord): Unit = Require(
    record.event.scope == graph.scope && record.event.frontier > 0 && record.event.frontier <= graph.sourceFrontier &&
      CaptureIdentity.fingerprint(record.event, record.eventId) == record.fingerprint, "corrupt", "primary record binding mismatch")

  def inventory(graph: GraphSnapshot, records: List[PrimaryRecord]): Unit = {
    val expected = records.flatMap(record => record.outcome match {
      case PrimaryOutcome.Reviewed(value) => ReviewRecords.relation(value, record.event.provenance).toList
      case _: PrimaryOutcome.Captured | _: PrimaryOutcome.Commanded => Nil
    })
    val actual = graph.relations.filter(_.detail match {
      case value: RelationDetail.Adoption => value.origin == AdoptionOrigin.CapturedAction
      case _ => false
    })
    def ordered(values: List[Relation]): List[Relation] = values.sortBy(value => (value.ref.id.toString, value.ref.revision))
    Require(ordered(actual) == ordered(expected), "corrupt", "protected action relation inventory differs from retained judgments")
  }

  def capture(graph: GraphSnapshot, record: PrimaryRecord, receipt: InputReceipt, indexedAsJudgment: Boolean): Unit = {
    frame(graph, record)
    Require(!indexedAsJudgment, "corrupt", "generic capture has a judgment index")
    val result = record.outcome match {
      case PrimaryOutcome.Captured(value) => value
      case _ => throw Fault("corrupt", "generic capture outcome required")
    }
    val input = StoredJson.decode(IngestRequest.codecJson, receipt.content)
    Require(input.eventId == record.eventId && input.requestId == result.requestId, "corrupt", "capture request identity mismatch")
    PrimaryRecord.validateCaptureResult(record.event, result, record.eventId)
    SourceIntegrity.source(graph, SourceIntegrity.capture(record.event, receipt, graph.generation))
  }

  def command(graph: GraphSnapshot, record: PrimaryRecord, receipt: InputReceipt, indexedAsJudgment: Boolean,
              before: GraphSnapshot, evidence: List[ReviewEvidence], engine: AdmissionEngine): Unit = {
    frame(graph, record)
    Require(!indexedAsJudgment, "corrupt", "command has a judgment index")
    val result = record.outcome match {
      case PrimaryOutcome.Commanded(value) => value
      case _ => throw Fault("corrupt", "command outcome required")
    }
    Require(record.eventId == result.requestId, "corrupt", "command primary request identity differs")
    GraphCommandIntegrity.validate(graph, record.event, result, receipt, before, evidence, engine)
  }

  def judgment(graph: GraphSnapshot, record: PrimaryRecord, evidence: ReviewEvidence, review: ReviewDomain): Unit = {
    frame(graph, record)
    Require(record.outcome == PrimaryOutcome.Reviewed(evidence.judgment) && record.event == evidence.event &&
      record.eventId == evidence.judgment.requestId, "corrupt", "judgment primary row mismatch")
    review.validateEvidence(graph, evidence)
  }
}
