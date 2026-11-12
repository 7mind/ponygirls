package ontology

import java.time.Instant
import ontology.api.*
import ontology.domain.*

private[ontology] object CurationObservations {
  def summary(view: CurationAttemptView): CurationAttemptSummary = {
    val a = view.attempt; val c = a.claim
    CurationAttemptSummary(c.attemptId, c.baseGeneration, c.frontier, c.previousCoveredFrontier, a.state, a.inputManifest.map(_.inputDigest),
      view.journal.lastOption.map(_.ordinal), view.journal.lastOption.map(_.stage), a.terminalCode, a.auditUncertain, c.claimedAt, c.deadlineAt, a.finishedAt)
  }
  def notAfter(value: String, observedAt: Instant): Unit = {
    val time = try Instant.parse(value) catch { case _: java.time.format.DateTimeParseException => throw Fault("corrupt", "invalid observed evidence time") }
    Require(!time.isAfter(observedAt), "corrupt", "observation precedes its named evidence")
  }
  def validate(scope: String, cut: CapsuleCut, observed: CurationAttemptSummary, retained: CurationAttemptView, observedAt: Instant): Unit = try {
    val actual = retained.attempt; val claim = actual.claim
    val limits = CurationGuardLimits.retained(claim)
    CurationGuards.validate(actual, retained.journal, limits)
    Require(claim.scope == scope && observed.attemptId == claim.attemptId && observed.baseGeneration == claim.baseGeneration &&
      observed.frontier == claim.frontier && observed.previousCoveredFrontier == claim.previousCoveredFrontier &&
      observed.claimedAt == claim.claimedAt && observed.deadlineAt == claim.deadlineAt, "corrupt", "observed claim differs")
    Require(claim.baseGeneration <= cut.generation && claim.frontier <= cut.frontier && claim.previousCoveredFrontier <= cut.coveredFrontier,
      "corrupt", "observed claim is ahead of its cut")
    val manifest = observed.inputDigest.map { digest =>
      val value = actual.inputManifest.getOrElse(throw Fault("corrupt", "observed input seal missing"))
      Require(value.inputDigest == digest, "corrupt", "observed input seal differs")
      value
    }
    val prefix = (observed.lastOrdinal, observed.lastStage) match {
      case (None, None) => Nil
      case (Some(ordinal), Some(stage)) =>
        val index = retained.journal.indexWhere(entry => entry.ordinal == ordinal && entry.stage == stage)
        Require(index >= 0, "corrupt", "observed journal endpoint missing")
        retained.journal.take(index + 1)
      case _ => throw Fault("corrupt", "incomplete observed journal endpoint")
    }
    if (CurationGuards.active(observed.state)) {
      Require(!actual.publication.exists(_.generation <= cut.generation), "corrupt", "observed active attempt was already published in this cut")
      val projected = actual.copy(state = observed.state, inputManifest = manifest, candidate = None, publication = None,
        terminalCode = observed.terminalCode, auditUncertain = observed.auditUncertain, finishedAt = observed.finishedAt)
      CurationGuards.validate(projected, prefix, limits)
    } else {
      Require(observed == summary(retained), "corrupt", "observed terminal outcome differs")
      actual.publication.foreach(value => Require(value.generation <= cut.generation && value.coveredFrontier <= cut.coveredFrontier,
        "corrupt", "observed publication is outside its cut"))
    }
    notAfter(claim.claimedAt, observedAt)
    manifest.foreach(value => notAfter(value.sealedAt, observedAt))
    prefix.foreach(value => notAfter(value.observedAt, observedAt))
    observed.finishedAt.foreach(notAfter(_, observedAt))
  } catch { case _: Fault => throw Fault("corrupt", "invalid retained attempt observation") }
}
