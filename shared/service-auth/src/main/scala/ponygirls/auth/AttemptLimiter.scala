package ponygirls.auth

import cats.effect.{IO, Resource}
import java.net.InetAddress
import java.time.{Clock, Duration, Instant}
import ponygirls.runtime.{Admission, AdmissionConfig}
import scala.collection.mutable
import scala.concurrent.duration.{DurationInt, FiniteDuration}

/** Unauthenticated account endpoints that take a per-address request window (design §4.7). */
enum CredentialEndpoint {
  case Login, Signup, Recover, Inspect, Redeem
}

/** One counted slot of a successful-signup window; returned when the signup does not succeed. */
final class SignupReservation private[auth] (private[auth] val address: String, private[auth] val addressWindow: Instant,
  private[auth] val globalWindow: Instant)

/** In-memory fixed windows of design §4.7: requests per client address and credential endpoint, successful
  * signups per address and globally, and failed admin proofs per declarative actor. Every map is bounded:
  * expired windows are dropped when a map is full, and a new key that still does not fit is refused, never
  * admitted. Plain synchronized state, usable from blocking and IO code; the clock is injected.
  */
final class AttemptLimiter(capacity: Int, clock: Clock) {
  import AttemptLimiter.*
  require(capacity > 0, "limiter capacity must be positive")

  private val requests = new FixedWindows(RequestsPerAddress, RequestWindow, capacity)
  private val addressSignups = new FixedWindows(SignupsPerAddress, AddressSignupWindow, capacity)
  private val globalSignups = new FixedWindows(SignupsGlobal, GlobalSignupWindow, 1)
  private val proofs = new FixedWindows(ProofFailuresPerActor, ProofWindow, capacity)

  /** Counts one request; the wait until the window admits again when it is refused. */
  def request(address: String, endpoint: CredentialEndpoint): Option[Duration] = synchronized {
    requests.take(endpoint.toString + "\u0000" + address, clock.instant()).left.toOption
  }
  /** Takes a slot of both successful-signup windows, or neither. */
  def reserveSignup(address: String): Either[Duration, SignupReservation] = synchronized {
    val now = clock.instant()
    addressSignups.take(address, now).flatMap { addressWindow =>
      globalSignups.take(GlobalKey, now) match {
        case Left(wait) => addressSignups.refund(address, addressWindow); Left(wait)
        case Right(globalWindow) => Right(new SignupReservation(address, addressWindow, globalWindow))
      }
    }
  }
  def refund(reservation: SignupReservation): Unit = synchronized {
    addressSignups.refund(reservation.address, reservation.addressWindow)
    globalSignups.refund(GlobalKey, reservation.globalWindow)
  }
  /** Whether further admin proofs of this actor are refused, without counting. */
  def proofBlocked(actor: String): Option[Duration] = synchronized(proofs.exhausted(actor, clock.instant()))
  def proofFailed(actor: String): Unit = synchronized {
    proofs.take(actor, clock.instant())
    ()
  }
}
object AttemptLimiter {
  /** Production bound of every per-key map. */
  val Capacity = 16384
  val RequestsPerAddress = 10
  val RequestWindow: Duration = Duration.ofMinutes(1)
  val SignupsPerAddress = 5
  val AddressSignupWindow: Duration = Duration.ofDays(1)
  val SignupsGlobal = 20
  val GlobalSignupWindow: Duration = Duration.ofHours(1)
  val ProofFailuresPerActor = 5
  val ProofWindow: Duration = Duration.ofMinutes(15)
  private val GlobalKey = "global"

  private final case class Window(start: Instant, count: Int)

  /** Not thread-safe; the owner synchronizes. */
  private final class FixedWindows(limit: Int, length: Duration, capacity: Int) {
    private val entries = mutable.HashMap.empty[String, Window]
    private def current(key: String, now: Instant): Option[Window] = entries.get(key).filter(window => now.isBefore(window.start.plus(length)))
    private def remaining(window: Window, now: Instant): Duration = Duration.between(now, window.start.plus(length))
    def exhausted(key: String, now: Instant): Option[Duration] = current(key, now).filter(_.count >= limit).map(remaining(_, now))
    /** Right(start of the counted window), or Left(wait). */
    def take(key: String, now: Instant): Either[Duration, Instant] = current(key, now) match {
      case Some(window) if window.count >= limit => Left(remaining(window, now))
      case Some(window) =>
        entries.update(key, window.copy(count = window.count + 1))
        Right(window.start)
      case None =>
        entries.remove(key)
        if (entries.size >= capacity) entries.filterInPlace((_, window) => now.isBefore(window.start.plus(length)))
        if (entries.size >= capacity) Left(length)
        else {
          entries.update(key, Window(now, 1))
          Right(now)
        }
    }
    def refund(key: String, start: Instant): Unit =
      entries.get(key).filter(window => window.start == start && window.count > 0).foreach(window => entries.update(key, window.copy(count = window.count - 1)))
  }
}

/** Global bound on PBKDF2 work of unauthenticated account endpoints (design §4.7): a few concurrent
  * operations and a bounded wait queue; anything beyond is refused, and the caller answers `503`.
  */
final class CredentialGate private (admission: Admission) {
  /** `None` when the gate refused the work; failures of the work itself are propagated unchanged. */
  def run[A](work: IO[A]): IO[Option[A]] =
    admission.run(work.attempt).attempt.flatMap {
      case Right(result) => IO.fromEither(result).map(Some(_))
      case Left(_: ponygirls.runtime.RuntimeFailure) => IO.pure(None)
      case Left(other) => IO.raiseError(other)
    }
}
object CredentialGate {
  val Concurrency = 2
  val QueueLength = 16
  val QueueTimeout: FiniteDuration = 10.seconds
  def resource: Resource[IO, CredentialGate] = resource(AdmissionConfig(Concurrency, QueueLength, QueueTimeout))
  private[auth] def resource(config: AdmissionConfig): Resource[IO, CredentialGate] = Admission.resource(config).map(new CredentialGate(_))
}

/** The address that the per-address windows are keyed by (design §4.7). */
object ClientAddress {
  private val ForwardedSeparator = ','

  /** The right-most `X-Forwarded-For` element when the socket peer is a trusted proxy and that element is an
    * IP literal; otherwise the socket peer. `xForwardedFor` holds every header value in arrival order. An absent
    * or unusable header behind a proxy puts all its clients into the proxy's bucket: stricter, never weaker.
    * `trusted` receives `socketPeer` as given; the result is the canonical text of the chosen literal.
    */
  def resolve(socketPeer: String, xForwardedFor: Vector[String], trusted: String => Boolean): String = {
    val peer = literal(socketPeer).getOrElse(socketPeer)
    val forwarded = xForwardedFor.lastOption.map(_.split(ForwardedSeparator.toString, -1).last.trim)
    if (!trusted(socketPeer)) peer else forwarded.flatMap(literal).getOrElse(peer)
  }
  /** Canonical text of an IPv4 or IPv6 literal; never a name lookup. */
  private def literal(value: String): Option[String] =
    try Some(InetAddress.ofLiteral(value).getHostAddress) catch { case _: IllegalArgumentException => None }
}
