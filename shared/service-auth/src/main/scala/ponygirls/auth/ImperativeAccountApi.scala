package ponygirls.auth

import cats.effect.IO
import io.circe.Json
import java.time.Duration

/** A request to the account plane, already through the service boundary (exact Host/Origin, no query string,
  * no bearer credential, body parsed by `AccountJson.parseUtf8`). `path` is relative to `/api/account/v1`
  * (for example `/profile`); `body` is empty exactly when the request had none; `actor` holds every
  * `X-Account-Actor` value; `session` is the live browser session the presented cookie resolved to under the
  * merged directory, and `sessionSecret` the presented cookie value itself, valid or not.
  */
final case class AccountRequest(method: String, path: String, body: Option[Json], actor: Vector[String],
  session: Option[AccountCredential], sessionSecret: Option[String], clientAddress: String) {
  override def toString: String = s"AccountRequest($method,$path,<redacted>)"
}

/** What to do with the session cookie. No new endpoint ends a session without replacing it, so there is no
  * clearing effect: clearing on a refusal would race a login in another tab that already replaced the cookie.
  */
sealed trait CookieEffect
object CookieEffect {
  case object Keep extends CookieEffect
  /** Set the session cookie to this new secret. */
  final case class Set(secret: String) extends CookieEffect {
    override def toString: String = "Set(<redacted>)"
  }
}

/** Security events of design §4.6.4. */
enum AccountEventKind(val text: String) {
  case Signup extends AccountEventKind("account.signup")
  case Approved extends AccountEventKind("account.approved")
  case ApplicationRejected extends AccountEventKind("account.rejected")
  case EnrollmentCreated extends AccountEventKind("account.enrollment.created")
  case EnrollmentRevoked extends AccountEventKind("account.enrollment.revoked")
  case EnrollmentRedeemed extends AccountEventKind("account.enrollment.redeemed")
  case ResetIssued extends AccountEventKind("account.reset.issued")
  case ResetRedeemed extends AccountEventKind("account.reset.redeemed")
  case RecoverySucceeded extends AccountEventKind("account.recovery.succeeded")
  case RecoveryRejected extends AccountEventKind("account.recovery.rejected")
  case Locked extends AccountEventKind("account.locked")
  case PasswordChanged extends AccountEventKind("account.password.changed")
  case TotpReplaced extends AccountEventKind("account.totp.replaced")
  case TotpRequiredChanged extends AccountEventKind("account.totp.required-changed")
  case EmailChanged extends AccountEventKind("account.email.changed")
  case AdminGranted extends AccountEventKind("account.admin.granted")
  case AdminRevoked extends AccountEventKind("account.admin.revoked")
  case Enabled extends AccountEventKind("account.enabled")
  case Disabled extends AccountEventKind("account.disabled")
  case ProofRejected extends AccountEventKind("account.proof.rejected")
}
/** An audit event; by construction it holds only the allowlisted fields, never a secret, e-mail, code or body.
  * `actor` and `target` are account ids, usernames or enrollment ids; `outcome` is a fixed word.
  */
final case class AccountEvent(kind: AccountEventKind, actor: Option[String], target: Option[String], outcome: Option[String],
  clientAddress: String) {
  /** The fields to log, named as in the allowlist; absent ones are omitted. */
  def fields: Vector[(String, String)] = Vector(AccountEvent.Event -> kind.text) ++ actor.map(AccountEvent.Actor -> _) ++
    target.map(AccountEvent.Target -> _) ++ outcome.map(AccountEvent.Outcome -> _) :+ (AccountEvent.ClientAddress -> clientAddress)
}
object AccountEvent {
  val Event = "event"
  val Actor = "actor"
  val Target = "target"
  val Outcome = "outcome"
  val ClientAddress = "clientAddress"
  val Allowlist: Vector[String] = Vector(Event, Actor, Target, Outcome, ClientAddress)
}

/** The adapter writes `status`, `body` (with `Cache-Control: no-store`), the cookie effect and `Retry-After`,
  * and logs `events` after the transaction committed. A non-2xx reply is a normal value (design D27).
  */
final case class AccountReply(status: Int, body: Json, cookie: CookieEffect, retryAfterSeconds: Option[Long], events: Vector[AccountEvent]) {
  override def toString: String = s"AccountReply($status,<redacted>,$cookie,$retryAfterSeconds,$events)"
}

/** One database transaction per call over the service's store: committed when `work` returns, whatever it
  * returns (a rejection may carry a failure counter), rolled back when it throws. The adapter builds the
  * `ImperativeAccounts` from the transaction's connection with the same settings and declared directory it
  * passes to `ImperativeAccountApi`.
  */
trait ImperativeTransactions {
  def run[A](work: ImperativeAccounts => A): IO[A]
}

/** The service's existing password login for a declared login; it signals a refusal by raising `AccountFailure`. */
trait DeclarativeLogin {
  def login(login: String, password: String, previous: Option[String]): IO[SignedIn]
}

/** The account endpoints added for imperative accounts; `path` is relative to `/api/account/v1`. */
enum AccountEndpoint(val method: String, val segments: Vector[String]) {
  case Policy extends AccountEndpoint(AccountEndpoint.Get, Vector("policy"))
  case Signup extends AccountEndpoint(AccountEndpoint.Post, Vector("signup"))
  case InspectEnrollment extends AccountEndpoint(AccountEndpoint.Post, Vector("enrollments", "inspect"))
  case RedeemEnrollment extends AccountEndpoint(AccountEndpoint.Post, Vector("enrollments", "redeem"))
  case Recover extends AccountEndpoint(AccountEndpoint.Post, Vector("recover"))
  case Profile extends AccountEndpoint(AccountEndpoint.Get, Vector("profile"))
  case ChangeEmail extends AccountEndpoint(AccountEndpoint.Post, Vector("profile", "email"))
  case ChangePassword extends AccountEndpoint(AccountEndpoint.Post, Vector("profile", "password"))
  case ReplaceTotp extends AccountEndpoint(AccountEndpoint.Post, Vector("profile", "totp"))
  case SetTotpRequired extends AccountEndpoint(AccountEndpoint.Post, Vector("profile", "totp-required"))
  case ListUsers extends AccountEndpoint(AccountEndpoint.Get, Vector("admin", "users"))
  case Approve extends AccountEndpoint(AccountEndpoint.Post, Vector("admin", "users", AccountEndpoint.Id, "approve"))
  case Reject extends AccountEndpoint(AccountEndpoint.Post, Vector("admin", "users", AccountEndpoint.Id, "reject"))
  case SetEnabled extends AccountEndpoint(AccountEndpoint.Post, Vector("admin", "users", AccountEndpoint.Id, "enabled"))
  case SetAdmin extends AccountEndpoint(AccountEndpoint.Post, Vector("admin", "users", AccountEndpoint.Id, "admin"))
  case IssueReset extends AccountEndpoint(AccountEndpoint.Post, Vector("admin", "users", AccountEndpoint.Id, "reset"))
  case ListEnrollments extends AccountEndpoint(AccountEndpoint.Get, Vector("admin", "enrollments"))
  case IssueInvitation extends AccountEndpoint(AccountEndpoint.Post, Vector("admin", "enrollments"))
  case RevokeEnrollment extends AccountEndpoint(AccountEndpoint.Post, Vector("admin", "enrollments", AccountEndpoint.Id, "revoke"))

  /** A fixed route label, for example `/admin/users/{id}/approve`, usable as a telemetry label. */
  def label: String = segments.mkString("/", "/", "")
}
object AccountEndpoint {
  // Constant definitions (`final val`) are inlined: the cases above are initialized before this object's fields.
  final val Get = "GET"
  final val Post = "POST"
  final val Id = "{id}"
}
final case class AccountRoute(endpoint: AccountEndpoint, id: Option[String])

/** Transport-neutral dispatcher of the account endpoints added for imperative accounts (design §5.1 with the
  * amendments of §12) and of the imperative part of `POST /login`. It owns, per request: routing and
  * availability, the strict codec, the actor binding, the per-address and admin-proof windows, the credential
  * gate, the mapping of outcomes to replies after commit (D27) and the audit events. Long-lived; `settings`,
  * `declared` and `transactions` are passed per request because a service may reload them.
  */
final class ImperativeAccountApi(limiter: AttemptLimiter, gate: CredentialGate) {
  import AccountEndpoint as E
  import AccountOutcome.{Completed, Rejected}
  import ImperativeAccountApi.*
  import ImperativeAccountJson.{MaximumTextLength, body, credentials, noBody}
  import ImperativePolicy.*

  /** Every path under the prefix other than the five existing endpoints. With the master switch off every
    * request is `404 not-found` and nothing is read or counted.
    */
  def handle(settings: Option[ImperativeSettings], declared: DeclaredDirectory, transactions: ImperativeTransactions,
    request: AccountRequest): IO[AccountReply] = settings.flatMap(active => route(request.method, request.path).filter(found => available(found.endpoint, active)).map(active -> _)) match {
    case None => IO.pure(failure(NotFoundCode, None, Vector.empty))
    case Some((active, found)) => guarded(dispatch(active, declared, transactions, request, found))
  }

  /** `POST /login` while the master switch is on; with it off the service keeps its existing login unchanged.
    * `{login,password}` or `{login,password,totp}`. A declared login takes the service's declarative path
    * (`totp` ignored); any other login is decided by the imperative core. Both pass the per-address window
    * and the credential gate.
    */
  def login(settings: ImperativeSettings, declared: DeclaredDirectory, transactions: ImperativeTransactions,
    declarative: DeclarativeLogin, request: AccountRequest): IO[AccountReply] = guarded {
    val fields = body(request.body, Set("login", "password"), Set("totp"))
    val name = fields.text("login", LoginMaximumLength)
    val password = fields.text("password", PasswordMaximumLength)
    val totp = fields.optionalText("totp", Totp.Digits)
    def fallback: IO[AccountOutcome[SignedIn]] = declarative.login(name, password, request.sessionSecret).map(Completed(_))
    admitted(request, CredentialEndpoint.Login) {
      gated {
        val decided = if (declared.hasLogin(name)) fallback else transactions.run(_.login(name, password, totp, request.sessionSecret)).flatMap {
          case LoginDecision.NotImperative => fallback
          case LoginDecision.Imperative(outcome) => IO.pure(outcome)
        }
        decided.map(reply(request, _, None, username(name), None)(signedIn => established(signedIn, Vector.empty)))
      }
    }
  }

  private def dispatch(active: ImperativeSettings, declared: DeclaredDirectory, transactions: ImperativeTransactions,
    request: AccountRequest, found: AccountRoute): IO[AccountReply] = {
    val previous = request.sessionSecret
    def event(kind: AccountEventKind, actor: Option[String], target: Option[String], outcome: Option[String]): AccountEvent =
      AccountEvent(kind, actor, target, outcome, request.clientAddress)
    lazy val id = found.id.getOrElse(throw AccountFailure("invalid"))
    found.endpoint match {
      case E.Policy =>
        noBody(request.body)
        IO.pure(ok(ImperativeAccountJson.policy(active)))
      case E.Signup =>
        val fields = body(request.body, Set("username", "email", "password", "totpSecret", "totpCode", "requireTotp"), Set.empty)
        val (name, email, offered) = (fields.text("username", MaximumTextLength), fields.text("email", EmailMaximumLength), credentials(fields))
        admitted(request, CredentialEndpoint.Signup) {
          IO(limiter.reserveSignup(request.clientAddress)).flatMap {
            case Left(wait) => IO.pure(rateLimited(wait))
            case Right(reservation) =>
              gate.run(transactions.run(_.signup(name, email, offered, previous))).onError { case _ => IO(limiter.refund(reservation)) }.flatMap {
                case Some(Completed(SignupResult.Pending)) =>
                  IO.pure(AccountReply(Accepted, ImperativeAccountJson.signupPending, CookieEffect.Keep, None,
                    Vector(event(AccountEventKind.Signup, None, Some(name), Some(AccountStatus.Pending.text)))))
                case Some(Completed(SignupResult.Active(signedIn))) =>
                  IO.pure(AccountReply(Ok, ImperativeAccountJson.signupActive(signedIn.user), CookieEffect.Set(signedIn.session.secret), None,
                    Vector(event(AccountEventKind.Signup, None, Some(name), Some(AccountStatus.Active.text)))))
                case Some(refused: Rejected) => IO(limiter.refund(reservation)).as(rejection(request, refused, None, None, None))
                case None => IO(limiter.refund(reservation)).as(unavailable)
              }
          }
        }
      case E.InspectEnrollment =>
        val code = body(request.body, Set("code"), Set.empty).text("code", MaximumTextLength)
        admitted(request, CredentialEndpoint.Inspect) {
          transactions.run(_.inspectEnrollment(code)).map(reply(request, _, None, None, None)(info => ok(ImperativeAccountJson.inspected(info))))
        }
      case E.RedeemEnrollment =>
        val fields = body(request.body, Set("code", "password", "totpSecret", "totpCode", "requireTotp"), Set("email"))
        val (code, email, offered) = (fields.text("code", MaximumTextLength), fields.optionalText("email", EmailMaximumLength), credentials(fields))
        val kind = if (email.nonEmpty) AccountEventKind.EnrollmentRedeemed else AccountEventKind.ResetRedeemed
        admitted(request, CredentialEndpoint.Redeem) {
          gated(transactions.run(_.redeemEnrollment(code, email, offered, previous)).map(reply(request, _, None, None, None) { signedIn =>
            established(signedIn, Vector(event(kind, None, Some(signedIn.user.id), None)))
          }))
        }
      case E.Recover =>
        val fields = body(request.body, Set("username", "totp", "password"), Set.empty)
        val (name, totp, password) = (fields.text("username", MaximumTextLength), fields.text("totp", Totp.Digits), fields.text("password", PasswordMaximumLength))
        admitted(request, CredentialEndpoint.Recover) {
          gated(transactions.run(_.recover(name, totp, password, previous)).map {
            case refused: Rejected =>
              val refusal = rejection(request, refused, None, username(name), None)
              refusal.copy(events = refusal.events :+ event(AccountEventKind.RecoveryRejected, None, username(name), Some(refused.reason.code)))
            case recovered => reply(request, recovered, None, None, None) { signedIn =>
              established(signedIn, Vector(event(AccountEventKind.RecoverySucceeded, None, Some(signedIn.user.id), None)))
            }
          })
        }
      case E.Profile => authenticated(request, mutation = false) { session =>
        noBody(request.body)
        transactions.run(_.profile(session)).map(reply(request, _, None, None, None)(found => ok(ImperativeAccountJson.profile(found, active))))
      }
      case E.ChangeEmail => authenticated(request, mutation = true) { session =>
        val email = body(request.body, Set("email"), Set.empty).text("email", EmailMaximumLength)
        selfService(request, session, transactions.run(_.changeEmail(session, email)), AccountEventKind.EmailChanged, None)
      }
      case E.ChangePassword => authenticated(request, mutation = true) { session =>
        val fields = body(request.body, Set("currentPassword", "newPassword"), Set.empty)
        val (current, replacement) = (fields.text("currentPassword", PasswordMaximumLength), fields.text("newPassword", PasswordMaximumLength))
        val self = Some(session.userId)
        transactions.run(_.changePassword(session, current, replacement)).map(reply(request, _, self, self, self) { signedIn =>
          AccountReply(Ok, ImperativeAccountJson.ok, CookieEffect.Set(signedIn.session.secret), None,
            Vector(event(AccountEventKind.PasswordChanged, self, self, None)))
        })
      }
      case E.ReplaceTotp => authenticated(request, mutation = true) { session =>
        val fields = body(request.body, Set("currentPassword", "totpSecret", "totpCode"), Set("currentTotp"))
        val (current, secret, code, currentTotp) = (fields.text("currentPassword", PasswordMaximumLength),
          fields.text("totpSecret", Totp.SecretTextLength), fields.text("totpCode", Totp.Digits), fields.optionalText("currentTotp", Totp.Digits))
        selfService(request, session, transactions.run(_.replaceTotp(session, current, secret, code, currentTotp)), AccountEventKind.TotpReplaced, None)
      }
      case E.SetTotpRequired => authenticated(request, mutation = true) { session =>
        val fields = body(request.body, Set("required", "totp"), Set.empty)
        val (required, totp) = (fields.flag("required"), fields.text("totp", Totp.Digits))
        selfService(request, session, transactions.run(_.setTotpRequired(session, required, totp)), AccountEventKind.TotpRequiredChanged,
          Some(if (required) RequiredOn else RequiredOff))
      }
      case E.ListUsers => authenticated(request, mutation = false) { session =>
        noBody(request.body)
        transactions.run(_.listUsers(session)).map(reply(request, _, None, None, None)(listed => ok(ImperativeAccountJson.users(listed))))
      }
      case E.Approve => administered(request, transactions)(_.approve(_, id), AccountEventKind.Approved, Some(id))
      case E.Reject => administered(request, transactions)(_.reject(_, id), AccountEventKind.ApplicationRejected, Some(id))
      case E.SetEnabled => authenticated(request, mutation = true) { session =>
        val enabled = body(request.body, Set("enabled"), Set.empty).flag("enabled")
        val kind = if (enabled) AccountEventKind.Enabled else AccountEventKind.Disabled
        transactions.run(_.setEnabled(session, id, enabled)).map(administration(request, session, kind, Some(id)))
      }
      case E.SetAdmin => authenticated(request, mutation = true) { session =>
        val fields = body(request.body, Set("admin", "currentPassword"), Set.empty)
        val (admin, current) = (fields.flag("admin"), fields.text("currentPassword", PasswordMaximumLength))
        val kind = if (admin) AccountEventKind.AdminGranted else AccountEventKind.AdminRevoked
        proven(declared, session)(transactions.run(_.setAdmin(session, id, admin, current))).map(administration(request, session, kind, Some(id)))
      }
      case E.IssueReset => authenticated(request, mutation = true) { session =>
        val current = body(request.body, Set("currentPassword"), Set.empty).text("currentPassword", PasswordMaximumLength)
        val actor = Some(session.userId)
        proven(declared, session)(transactions.run(_.issueReset(session, id, current))).map(reply(request, _, actor, actor, Some(id)) { issued =>
          AccountReply(Ok, ImperativeAccountJson.issued(issued), CookieEffect.Keep, None, Vector(event(AccountEventKind.ResetIssued, actor, Some(id), None)))
        })
      }
      case E.ListEnrollments => authenticated(request, mutation = false) { session =>
        noBody(request.body)
        transactions.run(_.listEnrollments(session)).map(reply(request, _, None, None, None)(listed => ok(ImperativeAccountJson.enrollments(listed))))
      }
      case E.IssueInvitation => authenticated(request, mutation = true) { session =>
        val name = body(request.body, Set("username"), Set.empty).text("username", MaximumTextLength)
        val actor = Some(session.userId)
        transactions.run(_.issueInvitation(session, name)).map(reply(request, _, actor, None, Some(name)) { issued =>
          AccountReply(Ok, ImperativeAccountJson.issued(issued), CookieEffect.Keep, None,
            Vector(event(AccountEventKind.EnrollmentCreated, actor, Some(issued.enrollment.username), None)))
        })
      }
      case E.RevokeEnrollment => administered(request, transactions)(_.revokeEnrollment(_, id), AccountEventKind.EnrollmentRevoked, Some(id))
    }
  }

  // ---- building blocks ----

  /** Maps the failures raised outside the core's returned outcomes: codec, actor binding, aborted transactions. */
  private def guarded(work: => IO[AccountReply]): IO[AccountReply] = IO.defer(work).recover { case AccountFailure(code) => failure(code, None, Vector.empty) }

  private def admitted(request: AccountRequest, endpoint: CredentialEndpoint)(next: => IO[AccountReply]): IO[AccountReply] =
    IO(limiter.request(request.clientAddress, endpoint)).flatMap(_.fold(next)(wait => IO.pure(rateLimited(wait))))
  private def gated(work: IO[AccountReply]): IO[AccountReply] = gate.run(work).map(_.getOrElse(unavailable))

  /** A browser session is required; a mutation also requires exactly one `X-Account-Actor` naming its owner. */
  private def authenticated(request: AccountRequest, mutation: Boolean)(work: AccountCredential => IO[AccountReply]): IO[AccountReply] =
    request.session match {
      case None => IO.pure(failure(UnauthorizedCode, None, Vector.empty))
      case Some(session) =>
        if (mutation) AccountJson.requireActor(request.actor, session.userId)
        work(session)
    }
  private def selfService(request: AccountRequest, session: AccountCredential, run: IO[AccountOutcome[Unit]], kind: AccountEventKind,
    outcome: Option[String]): IO[AccountReply] = {
    val self = Some(session.userId)
    run.map(reply(request, _, self, self, self)(_ =>
      AccountReply(Ok, ImperativeAccountJson.ok, CookieEffect.Keep, None, Vector(AccountEvent(kind, self, self, outcome, request.clientAddress)))))
  }
  /** Admin actions with an empty request body and an `{ok:true}` answer. */
  private def administered(request: AccountRequest, transactions: ImperativeTransactions)(
    work: (ImperativeAccounts, AccountCredential) => AccountOutcome[Unit], kind: AccountEventKind, target: Option[String]): IO[AccountReply] =
    authenticated(request, mutation = true) { session =>
      body(request.body, Set.empty, Set.empty)
      transactions.run(work(_, session)).map(administration(request, session, kind, target))
    }
  private def administration(request: AccountRequest, session: AccountCredential, kind: AccountEventKind, target: Option[String])(
    outcome: AccountOutcome[Unit]): AccountReply = {
    val actor = Some(session.userId)
    reply(request, outcome, actor, actor, target)(_ =>
      AccountReply(Ok, ImperativeAccountJson.ok, CookieEffect.Keep, None, Vector(AccountEvent(kind, actor, target, None, request.clientAddress))))
  }
  /** Fresh-proof operations: a declarative actor has no persistent password counter, so its failed proofs are
    * bounded by the in-memory window (design §4.6.3); an imperative actor's proofs count on its row.
    */
  private def proven[A](declared: DeclaredDirectory, session: AccountCredential)(run: IO[AccountOutcome[A]]): IO[AccountOutcome[A]] =
    if (!declared.contains(session.userId)) run
    else IO(limiter.proofBlocked(session.userId)).flatMap {
      case Some(wait) => IO.pure(Rejected(AccountRejection.RateLimited(wait), None))
      case None => run.flatTap {
        case Rejected(AccountRejection.ProofRejected, _) => IO(limiter.proofFailed(session.userId))
        case _ => IO.unit
      }
    }

  /** `owner` is the account whose counters the operation checks (for `account.locked`), `target` the account
    * a rejected fresh proof was meant for (for `account.proof.rejected`).
    */
  private def reply[A](request: AccountRequest, outcome: AccountOutcome[A], actor: Option[String], owner: Option[String],
    target: Option[String])(completed: A => AccountReply): AccountReply = outcome match {
    case Completed(value) => completed(value)
    case refused: Rejected => rejection(request, refused, actor, owner, target)
  }
  private def rejection(request: AccountRequest, refused: Rejected, actor: Option[String], owner: Option[String], target: Option[String]): AccountReply = {
    val locked = refused.locked.map(path => AccountEvent(AccountEventKind.Locked, actor, owner, Some(path.text), request.clientAddress))
    val proof = Option.when(refused.reason == AccountRejection.ProofRejected)(AccountEvent(AccountEventKind.ProofRejected, actor, target, None, request.clientAddress))
    val wait = refused.reason match {
      case AccountRejection.RateLimited(retryAfter) => Some(retryAfter)
      case _ => None
    }
    failure(refused.reason.code, wait, locked.toVector ++ proof)
  }
  private def established(signedIn: SignedIn, events: Vector[AccountEvent]): AccountReply =
    AccountReply(Ok, ImperativeAccountJson.signedIn(signedIn.user), CookieEffect.Set(signedIn.session.secret), None, events)

}
object ImperativeAccountApi {
  private val Ok = 200
  private val Accepted = 202
  private val NotFoundCode = "not-found"
  private val UnauthorizedCode = "unauthorized"
  private val UnavailableCode = "unavailable"
  private val RateLimitedCode = "rate-limited"
  private val RequiredOn = "on"
  private val RequiredOff = "off"
  /** `Retry-After` of a `503`, whose cause (saturation, a fault) gives no better estimate. */
  val UnavailableRetryAfterSeconds = 5L
  private val PathSeparator = "/"

  /** HTTP status of every error code the account plane answers with; anything else is `503 unavailable`. */
  val Statuses: Map[String, Int] = Map(
    "invalid" -> 400, "weak-password" -> 400, "totp-mismatch" -> 400,
    "unauthorized" -> 401, "totp-required" -> 401,
    "forbidden" -> 403, "pending-approval" -> 403, "proof-rejected" -> 403,
    "not-found" -> 404,
    "conflict" -> 409, "username-unavailable" -> 409,
    "too-large" -> 413,
    RateLimitedCode -> 429,
    UnavailableCode -> 503)

  private def ok(body: Json): AccountReply = AccountReply(Ok, body, CookieEffect.Keep, None, Vector.empty)
  private def seconds(wait: Duration): Long = math.max(1L, wait.getSeconds + (if (wait.getNano > 0) 1L else 0L))
  /** Sanitized `{error:{code,message}}`; 429 and 503 carry `Retry-After`. */
  private def failure(code: String, wait: Option[Duration], events: Vector[AccountEvent]): AccountReply = {
    val safe = if (Statuses.contains(code)) code else UnavailableCode
    val retryAfter = safe match {
      case RateLimitedCode => Some(wait.fold(UnavailableRetryAfterSeconds)(seconds))
      case UnavailableCode => Some(UnavailableRetryAfterSeconds)
      case _ => None
    }
    AccountReply(Statuses(safe), AccountJson.failure(safe), CookieEffect.Keep, retryAfter, events)
  }
  private def rateLimited(wait: Duration): AccountReply = failure(RateLimitedCode, Some(wait), Vector.empty)
  private val unavailable: AccountReply = failure(UnavailableCode, None, Vector.empty)
  /** A submitted name, kept for an event only when it is a well-formed username. */
  private def username(value: String): Option[String] = Some(ImperativePolicy.fold(value)).filter(ImperativePolicy.validUsername)

  private def validId(segment: String): Boolean =
    segment.nonEmpty && segment.length <= ImperativeAccountJson.MaximumTextLength && !segment.exists(c => c.isControl || c.isWhitespace)

  /** The endpoint of `method` and `path`, or none; ids are single non-empty path segments. */
  def route(method: String, path: String): Option[AccountRoute] =
    if (!path.startsWith(PathSeparator)) None
    else {
      val segments = path.substring(PathSeparator.length).split(PathSeparator, -1).toVector
      AccountEndpoint.values.iterator.filter(endpoint => endpoint.method == method && endpoint.segments.size == segments.size).flatMap { endpoint =>
        val pairs = endpoint.segments.zip(segments)
        val ids = pairs.collect { case (AccountEndpoint.Id, segment) => segment }
        val matches = pairs.forall { case (expected, actual) => if (expected == AccountEndpoint.Id) validId(actual) else expected == actual }
        Option.when(matches)(AccountRoute(endpoint, ids.headOption))
      }.nextOption()
    }
  /** Every endpoint exists while the master switch is on, except signup (`signup.enable`) and invitation issuance
    * (`enrollment.enable`). Resets follow the master switch (AM1); invitation codes are filtered by the core.
    */
  def available(endpoint: AccountEndpoint, settings: ImperativeSettings): Boolean = endpoint match {
    case AccountEndpoint.Signup => settings.signup
    case AccountEndpoint.IssueInvitation => settings.enrollment
    case _ => true
  }
}
