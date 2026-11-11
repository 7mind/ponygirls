package ontology

import ontology.domain.{PresentationLimits, ReviewDomain, ReviewLimits}

object TestReview {
  private val MaximumTargets = 32
  private val MaximumRecords = 256
  private val MaximumPayloadBytes = 1024 * 1024
  private val MaximumRationaleBytes = 65536
  private val MaximumRequestBytes = 131072
  def domain: ReviewDomain = new ReviewDomain(ReviewLimits(
    PresentationLimits(MaximumTargets, MaximumRecords, MaximumPayloadBytes), MaximumRationaleBytes, MaximumRequestBytes))
}
