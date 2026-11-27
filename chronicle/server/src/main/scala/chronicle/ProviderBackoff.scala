package chronicle

/** The class of a model-provider failure under `indexing.providerBackoff` (design note 20261126-1845 §2; owner's decision
  * Q178 item 2). Either class holds its job Queued until `lease_until`, 1, 2, 4, 8, then 15 minutes by the job's count of
  * consecutive failures without saved progress (`transient_failures`, shared with the database holds: Jobs.transientBackoff). */
enum ProviderFailureClass(val key: String) {
  /** An explicit refusal, HTTP 429, 503 or 529: the claim's attempt is refunded. */
  case Refunded extends ProviderFailureClass("refunded")
  /** Ambiguous, HTTP 500, 502, 504 or 408, `model-timeout` or `model-transport`: the attempt stays charged, and a failure
    * at the attempt limit is terminal, not held. */
  case Charged extends ProviderFailureClass("charged")
}
/** A classified provider failure as the fenced record takes it: its code, its stage, its class, and for an annotation call
  * the reservation of its window the call used (decision 3: the window's last one ends the job with this code). */
final case class ProviderFailure(code: String,stage: IndexingStage,failureClass: ProviderFailureClass,reservation: Option[Int]) {
  def refunded: Boolean = failureClass==ProviderFailureClass.Refunded
}
/** Why a provider failure ended its job Failed with its code. */
enum ProviderTerminal(val key: String) {
  /** A charged failure of the attempt that reached Jobs.attemptLimit. */
  case AttemptLimit extends ProviderTerminal("attempt-limit")
  /** The tenth failure in a row without saved progress (Jobs.transientBackoff.limit), of either kind. */
  case ConsecutiveLimit extends ProviderTerminal("consecutive-limit")
  /** The call used the last reservation of its window (AnnotationAttempts.reservationLimit). */
  case ReservationLimit extends ProviderTerminal("reservation-limit")
}
enum ProviderOutcome {
  /** Queued until `nextAttempt`, after the `consecutive`-th failure in a row. */
  case Held(consecutive: Int,nextAttempt: java.time.Instant)
  /** Failed with the provider code; `terminal` None: a record of this attempt read again (its commit acknowledgement lost). */
  case Failed(consecutive: Int,terminal: Option[ProviderTerminal])
  /** The owner's indexing no longer admits the claim: parked Queued with the attempt refunded, as `fail` parks it. */
  case Parked
  /** Nothing recorded: the claim ended (its lease, a newer revision, its owner target). */
  case Ended
}
object ProviderBackoff {
  val refundedStatuses: Set[Int] = Set(429,503,529)
  val chargedStatuses: Set[Int] = Set(500,502,504,408)
  /** Configuration-like statuses: recorded as before, and an alert line is logged. */
  val alertStatuses: Set[Int] = Set(401,403,404)
  /** The stages whose failures are model calls'. */
  private def modelStage(stage: Option[IndexingStage]): Boolean = stage.contains(IndexingStage.Annotation) || stage.contains(IndexingStage.Embedding)
  /** The class of a failure at `stage`; None: recorded as before (`fail`). */
  def classify(stage: Option[IndexingStage],error: Throwable): Option[ProviderFailureClass] =
    if(!modelStage(stage)) None else error match {
      case http: ModelHttpStatus if refundedStatuses(http.status) => Some(ProviderFailureClass.Refunded)
      case http: ModelHttpStatus if chargedStatuses(http.status) => Some(ProviderFailureClass.Charged)
      case _: ModelHttpStatus => None
      case DomainError("model-timeout",_) | DomainError("model-transport",_) => Some(ProviderFailureClass.Charged)
      case _ => None
    }
  /** The status of a configuration-like answer at a model call's stage. */
  def alert(stage: Option[IndexingStage],error: Throwable): Option[Int] = error match {
    case http: ModelHttpStatus if modelStage(stage) && alertStatuses(http.status) => Some(http.status)
    case _ => None
  }
  /** The server's line of the back-off, logged once it serves and only when `indexing.providerBackoff` is on (off, the
    * server logs exactly as before): its hold schedule and consecutive limit, and the lanes' cool-down. */
  def startLine(config: Config): Option[String] = Option.when(config.indexing.providerBackoff) {
    val holds=(1 to 5).map(k => Jobs.transientBackoff.delay(k).toMinutes).mkString(",")
    val pauses=(1 to 5).map(k => Worker.CoolDown.production.delay(k).toMinutes).mkString(",")
    s"provider back-off on holdMinutes=$holds consecutiveLimit=${Jobs.transientBackoff.limit} laneCoolDownMinutes=$pauses"
  }
  def status(error: Throwable): Option[Int] = error match {
    case http: ModelHttpStatus => Some(http.status)
    case _ => None
  }
}
