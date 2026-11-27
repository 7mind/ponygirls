package ponygirls.auth

import java.time.{Duration, Instant}

trait PasswordHasher {
  def hash(chars: Array[Char]): String
  def verify(chars: Array[Char], encoded: String): Boolean
}
object PasswordHasher {
  val Pbkdf2: PasswordHasher = new PasswordHasher {
    def hash(chars: Array[Char]): String = Password.hash(chars)
    def verify(chars: Array[Char], encoded: String): Boolean = Password.verify(chars, encoded)
  }
}

/** The imperative user store. Every method runs in the caller's transaction. */
private[auth] trait ImperativeUserRepository {
  /** Level 1 of the lock order (design D22): the same lock as `AccountRepository.lockDirectory`. */
  def lockDirectory(): Unit
  def users: Vector[StoredImperativeUser]
  def user(id: String): Option[StoredImperativeUser]
  /** Insert only; an existing id is a fault, never an adoption. */
  def insertUser(row: StoredImperativeUser): Unit
  /** Exactly one existing row. */
  def updateUser(row: StoredImperativeUser): Unit
  /** Rejection of a pending application. */
  def deleteUser(id: String): Unit
  def enrollments: Vector[StoredEnrollment]
  def enrollmentByDigest(digest: String): Option[StoredEnrollment]
  /** Replaces the pending row for the same username. */
  def putEnrollment(row: StoredEnrollment): Unit
  def deleteEnrollment(id: String): Unit
  /** Deletes every row with `expiresAt <= now`. */
  def deleteExpiredEnrollments(now: Instant): Unit
}

/** Service-owned sessions, tokens, owner locks and projections, in the caller's transaction.
  * A method may abort the transaction with an `AccountFailure`; it never reports a rejection that way.
  */
trait AccountSessions {
  /** Levels 2 and 3 of the lock order: declarative-scope owners sorted, then imperative owners sorted.
    * The imperative core calls it exactly once per operation, after any directory lock.
    */
  def lockOwners(declarative: Vector[String], imperative: Vector[String]): Unit
  /** Owner of the stored browser session with this secret, valid or not; an unlocked read, used only to
    * put the owner of a session that is about to be replaced into the `lockOwners` call.
    */
  def sessionOwner(secret: String): Option[String]
  /** Whether the browser session is live now. Called under its owner's lock, before any effect. */
  def live(session: AccountCredential): Boolean
  /** Creates a browser session for the verified `user` and revokes the presented session `replaced` when it is valid. */
  def establish(user: AccountUser, replaced: Option[String]): AccountSession
  def revokeSessions(userId: String, keep: Option[AccountCredential]): Unit
  /** Haystack/Manure: marks issued tokens revoked. Chronicle: nothing (its disabled-owner gate applies). */
  def revokeTokens(userId: String): Unit
  /** A newly active imperative user. Chronicle inserts its projection; a conflict aborts the transaction. */
  def activated(user: AccountUser): Unit
  /** The password hash or the enabled state of an imperative user that has been active changed. */
  def updated(user: AccountUser): Unit
  /** The administrator flag of an imperative user changed. A notification hook; nothing by default. */
  def adminChanged(userId: String): Unit = ()
}

/** Whether the service retains a historical identity under this (ASCII-lower-cased) name: design §4.1.3 rule 3. */
trait IdentityHistory {
  def retained(username: String): Boolean
}

enum AccountRejection(val code: String) {
  case Invalid extends AccountRejection("invalid")
  case WeakPassword extends AccountRejection("weak-password")
  case TotpMismatch extends AccountRejection("totp-mismatch")
  case UsernameUnavailable extends AccountRejection("username-unavailable")
  case Forbidden extends AccountRejection("forbidden")
  case NotFound extends AccountRejection("not-found")
  case Unauthorized extends AccountRejection("unauthorized")
  case TotpRequired extends AccountRejection("totp-required")
  case PendingApproval extends AccountRejection("pending-approval")
  case ProofRejected extends AccountRejection("proof-rejected")
  case RateLimited(retryAfter: Duration) extends AccountRejection("rate-limited")
  case Unavailable extends AccountRejection("unavailable")
}

/** Result of every imperative operation (design D27). A rejection can carry state that must persist — a
  * failure counter, a consumed TOTP step — so it is a value: the caller commits the transaction whatever
  * the outcome is and turns a `Rejected` into an error response afterwards. `Rejected` is deliberately not
  * a `Throwable` and has no accessor that raises it.
  */
sealed trait AccountOutcome[+A]
object AccountOutcome {
  final case class Completed[+A](value: A) extends AccountOutcome[A]
  /** `locked` names the counter that this very failure put into a lock (audit event `account.locked`). */
  final case class Rejected(reason: AccountRejection, locked: Option[FailurePath]) extends AccountOutcome[Nothing]
}

enum LoginDecision {
  /** The master switch is off or the login is a declared one: the caller takes its declarative path. */
  case NotImperative
  case Imperative(outcome: AccountOutcome[SignedIn])
}

final case class SignedIn(user: AccountUser, session: AccountSession)
enum SignupResult {
  case Pending
  case Active(signedIn: SignedIn)
}

/** Password and client-generated TOTP secret (canonical base32) with the code that proves possession of it. */
final case class NewCredentials(password: String, totpSecret: String, totpCode: String, requireTotp: Boolean) {
  override def toString: String = "NewCredentials(<redacted>)"
}

enum TotpState(val text: String) {
  case Ok extends TotpState("ok")
  /** The stored secret cannot be decrypted with the loaded key. */
  case Unavailable extends TotpState("unavailable")
}
final case class ProfileDetails(email: String, totpRequired: Boolean, totp: TotpState)
/** `imperative` is empty for a declarative user, whose credentials are owned by configuration. */
final case class AccountProfile(user: AccountUser, admin: Boolean, imperative: Option[ProfileDetails])
final case class ListedDetails(email: String, createdAt: Instant, createdVia: CreatedVia, createdBy: Option[String],
  approvedBy: Option[String], totpRequired: Boolean, totp: TotpState, locked: Boolean, pendingEnrollment: Option[EnrollmentKind])
final case class ListedAccount(id: String, login: Option[String], displayName: String, userType: String, origin: AccountOrigin,
  status: AccountStatus, admin: Boolean, imperative: Option[ListedDetails])
final case class EnrollmentInfo(username: String, kind: EnrollmentKind, expiresAt: Instant)
final case class ListedEnrollment(id: String, username: String, kind: EnrollmentKind, createdBy: String, createdAt: Instant, expiresAt: Instant)
/** The code is returned once and stored nowhere. */
final case class IssuedEnrollment(enrollment: ListedEnrollment, code: String) {
  override def toString: String = s"IssuedEnrollment(${enrollment.id},<redacted>)"
}
