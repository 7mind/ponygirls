package ponygirls.auth

import java.time.{Duration, Instant}

/** Lifecycle of an imperative account. `Pending` is outside the directory and never held authority;
  * `Disabled` is administrative and reversible. Declarative users are listed as `Active` or `Disabled`.
  */
enum AccountStatus(val text: String) {
  case Pending extends AccountStatus("pending")
  case Active extends AccountStatus("active")
  case Disabled extends AccountStatus("disabled")
}
enum CreatedVia(val text: String) {
  case Signup extends CreatedVia("signup")
  case Enrollment extends CreatedVia("enrollment")
}
enum EnrollmentKind(val text: String) {
  case Invite extends EnrollmentKind("invite")
  case Reset extends EnrollmentKind("reset")
}
/** The three independent per-account failure counters. */
enum FailurePath(val text: String) {
  case Password extends FailurePath("password")
  case Recovery extends FailurePath("recovery")
  case Totp extends FailurePath("totp")
}

final case class FailureCounter(failures: Int, failedAt: Option[Instant])
object FailureCounter {
  val Clear: FailureCounter = FailureCounter(0, None)
}

/** A lock is never stored: it is derived from a counter and the time of its last failure. From `threshold`
  * failures on, the path is locked for `min(cap, base * 2^(failures - threshold))` after the last failure.
  * A counter with a `lapse` counts as clear once that long has passed without a failure.
  */
final case class LockSchedule(threshold: Int, base: Duration, cap: Duration, lapse: Option[Duration]) {
  def effective(counter: FailureCounter, now: Instant): FailureCounter =
    if (lapse.exists(quiet => counter.failedAt.exists(at => !now.isBefore(at.plus(quiet))))) FailureCounter.Clear else counter
  def lockedUntil(counter: FailureCounter, now: Instant): Option[Instant] = {
    val current = effective(counter, now)
    current.failedAt.filter(_ => current.failures >= threshold).map(_.plus(lockFor(current.failures))).filter(now.isBefore)
  }
  def retryAfter(counter: FailureCounter, now: Instant): Option[Duration] = lockedUntil(counter, now).map(Duration.between(now, _))
  def failed(counter: FailureCounter, now: Instant): FailureCounter = FailureCounter(effective(counter, now).failures + 1, Some(now))
  private def lockFor(failures: Int): Duration = {
    val doublings = failures - threshold
    val uncapped = if (doublings >= LockSchedule.MaximumDoublings) cap else base.multipliedBy(1L << doublings)
    if (uncapped.compareTo(cap) > 0) cap else uncapped
  }
}
object LockSchedule {
  private val MaximumDoublings = 30
  val Password: LockSchedule = LockSchedule(10, Duration.ofMinutes(1), Duration.ofMinutes(15), None)
  /** Codes checked after a correct password or inside a session. Not cleared by a successful code. */
  val Totp: LockSchedule = LockSchedule(5, Duration.ofMinutes(15), Duration.ofHours(24), Some(Duration.ofDays(7)))
  /** Codes checked by anonymous recovery; same schedule, separate counter. */
  val Recovery: LockSchedule = Totp
  def of(path: FailurePath): LockSchedule = path match {
    case FailurePath.Password => Password
    case FailurePath.Recovery => Recovery
    case FailurePath.Totp => Totp
  }
}

/** One row of the imperative user store. `id` is the immutable username, login and public user id. */
private[auth] final case class StoredImperativeUser(id: String, status: AccountStatus, email: String, passwordHash: String,
  totp: SealedTotp, totpLastStep: Long, totpRequired: Boolean, admin: Boolean,
  passwordFailures: FailureCounter, totpFailures: FailureCounter, recoveryFailures: FailureCounter,
  createdAt: Instant, createdVia: CreatedVia, createdBy: Option[String], approvedBy: Option[String], approvedAt: Option[Instant],
  credentialsAt: Instant, updatedAt: Instant) {
  def counter(path: FailurePath): FailureCounter = path match {
    case FailurePath.Password => passwordFailures
    case FailurePath.Recovery => recoveryFailures
    case FailurePath.Totp => totpFailures
  }
  def withCounter(path: FailurePath, value: FailureCounter): StoredImperativeUser = path match {
    case FailurePath.Password => copy(passwordFailures = value)
    case FailurePath.Recovery => copy(recoveryFailures = value)
    case FailurePath.Totp => copy(totpFailures = value)
  }
  override def toString: String = s"StoredImperativeUser($id,$status,<redacted>)"
}
/** A pending invitation or credential reset. Only the digest of its code is stored. */
private[auth] final case class StoredEnrollment(id: String, digest: String, username: String, kind: EnrollmentKind,
  createdBy: String, createdAt: Instant, expiresAt: Instant)

object ImperativePolicy {
  val UsernamePattern = "^[a-z][a-z0-9_-]{2,31}$"
  val ReservedUsernames: Set[String] = Set("admin", "administrator", "root", "operator", "agent", "system", "support",
    "security", "service", "anonymous", "null", "undefined", "me", "self")
  val PasswordMinimumLength = 12
  val PasswordMaximumLength = 1024
  val EmailMinimumLength = 3
  val EmailMaximumLength = 254
  val LoginMaximumLength = 128
  val TotpCodePattern = "^[0-9]{6}$"
  /** Imperative rows of every status, per service, whatever `maxUsers` says. */
  val HardUserCeiling = 1000
  val MinimumEnrollmentTtl: Duration = Duration.ofSeconds(300)
  val MaximumEnrollmentTtl: Duration = Duration.ofSeconds(604800)
  val IssuerMaximumLength = 64

  /** ASCII lower-casing only: names are compared the way the username pattern spells them. */
  def fold(value: String): String = value.map(c => if (c >= 'A' && c <= 'Z') (c + ('a' - 'A')).toChar else c)
  def validUsername(value: String): Boolean = value.matches(UsernamePattern)
  def validEmail(value: String): Boolean = {
    val at = value.indexOf('@')
    value.length >= EmailMinimumLength && value.length <= EmailMaximumLength && at > 0 && at < value.length - 1 &&
      value.indexOf('@', at + 1) < 0 && !value.exists(c => c.isWhitespace || c.isControl || Character.isSpaceChar(c))
  }
  /** Length in UTF-16 units; no composition rules; never equal to one of the account's own identifiers. */
  def validPassword(value: String, username: String, email: Option[String]): Boolean =
    value.length >= PasswordMinimumLength && value.length <= PasswordMaximumLength &&
      !value.equalsIgnoreCase(username) && !email.exists(value.equalsIgnoreCase)
  def validTotpCode(value: String): Boolean = value.matches(TotpCodePattern)
}

/** Exists only while the master switch `accounts.enable` is on; adapters hold `Option[ImperativeSettings]`.
  * `signup` governs self-registration, `enrollment` governs invitations; credential resets follow the master switch.
  */
final case class ImperativeSettings(service: String, signup: Boolean, requireApproval: Boolean, enrollment: Boolean, maxUsers: Int,
  enrollmentTtl: Duration, issuer: String, reservedUsernames: Set[String], vault: TotpVault) {
  import ImperativePolicy.*
  if (service.isEmpty || maxUsers < 1 || maxUsers > HardUserCeiling ||
      enrollmentTtl.compareTo(MinimumEnrollmentTtl) < 0 || enrollmentTtl.compareTo(MaximumEnrollmentTtl) > 0 ||
      issuer.isEmpty || issuer.length > IssuerMaximumLength || issuer.exists(c => c.isControl || c == ':') ||
      !reservedUsernames.forall(validUsername)) throw AccountFailure("config")
}

/** The declarative users of the service configuration and which of them are administrators. */
final case class DeclaredDirectory(users: Vector[AccountUser], admins: Set[String]) {
  private val byId = users.map(user => user.id -> user).toMap
  if (byId.size != users.size || users.exists(_.origin != AccountOrigin.Declarative) ||
      !admins.forall(id => byId.get(id).exists(user => user.userType == "human" && user.login.nonEmpty))) throw AccountFailure("config")
  def user(id: String): Option[AccountUser] = byId.get(id)
  def contains(id: String): Boolean = byId.contains(id)
  def hasLogin(login: String): Boolean = users.exists(_.login.contains(login))
  /** Whether the folded name equals the ASCII-lower-cased form of a declared id or login. */
  def claims(name: String): Boolean = users.exists(user => ImperativePolicy.fold(user.id) == name || user.login.exists(ImperativePolicy.fold(_) == name))
}
