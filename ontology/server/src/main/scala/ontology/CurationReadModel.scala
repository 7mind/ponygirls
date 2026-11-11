package ontology

import java.time.Instant
import ontology.api.*
import ontology.domain.*

private[ontology] final case class CurationCurrent(snapshot: GraphSnapshot, status: CurationStatus)

private[ontology] final class CurationReadModel(validation: CurationValidation) {
  def summary(view: CurationAttemptView): CurationAttemptSummary = CurationObservations.summary(view)
  def retainedCut(read: CurationReadContext, scope: String, cut: CapsuleCut, observedAt: Instant): GraphSnapshot = {
    Require(cut.generation >= 0 && cut.frontier >= 0 && cut.coveredFrontier >= 0 && cut.coveredFrontier <= cut.frontier,
      "corrupt", "invalid retained graph cut")
    val graph = if (cut.generation == 0L) Graph.empty(scope) else read.history(scope, cut.generation)
    Require(graph.scope == scope && graph.generation == cut.generation && graph.sourceFrontier == cut.frontier && graph.coveredFrontier == cut.coveredFrontier,
      "corrupt", "retained cut differs from historical graph")
    validation.graph(read, graph)
    val publications = read.publications(scope, cut.generation).map(validation.attempt(read, _)).flatMap(_.attempt.publication)
    Require(cut.lastPublicationGeneration == publications.lastOption.map(_.generation) &&
      publications.lastOption.fold(0L)(_.coveredFrontier) == cut.coveredFrontier, "corrupt", "retained publication cut differs")
    publications.foreach(publication => CurationObservations.notAfter(publication.recordedAt, observedAt))
    publications.lastOption.foreach { publication =>
      Require(cut.attempt.exists(_.frontier >= publication.coveredFrontier), "corrupt", "retained observation omits an included publication attempt")
    }
    cut.attempt.foreach { observed =>
      val retained = read.find(scope, observed.attemptId).getOrElse(throw Fault("corrupt", "observed attempt missing"))
      CurationObservations.validate(scope, cut, observed, validation.attempt(read, retained), observedAt)
    }
    graph
  }
  def current(read: CurationReadContext, scope: String): CurationCurrent = {
    val head = read.head(scope)
    val last = read.latest(scope, false).map(validation.attempt(read, _))
    Require(head.scope == scope && last.forall(v => v.attempt.claim.frontier <= head.sourceFrontier && v.attempt.claim.baseGeneration <= head.generation),
      "corrupt", "attempt is ahead of scope head")
    val state = if (last.exists(v => CurationGuards.active(v.attempt.state))) CurationState.Running
      else if (CurationGuards.eligible(head, last.map(_.attempt.claim.frontier), false)) CurationState.Pending
      else last.map(_.attempt.state) match {
        case Some(CurationAttemptState.Failed) => CurationState.Failed
        case Some(CurationAttemptState.Stale) => CurationState.Stale
        case Some(CurationAttemptState.Interrupted) => CurationState.Interrupted
        case _ => CurationState.Idle
      }
    val published = read.latest(scope, true).map(validation.attempt(read, _)).flatMap(_.attempt.publication)
    Require(published.forall(_.generation <= head.generation) && published.fold(0L)(_.coveredFrontier) == head.coveredFrontier,
      "corrupt", "scope coverage differs from its last publication")
    CurationCurrent(head, CurationStatus(scope, head.generation, head.sourceFrontier, head.coveredFrontier, state,
      last.flatMap(_.attempt.terminalCode), published.map(_.generation), last.map(summary)))
  }
}
