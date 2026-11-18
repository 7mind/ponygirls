package ponygirls.auth

import io.circe.Json
import java.time.Instant

/** Strict codec of the account endpoints added for imperative accounts (design §5.1, §12). Requests follow the
  * `AccountJson` rules: exact member sets (an optional member is either absent or well-typed), non-empty bounded
  * strings, booleans as JSON booleans; any violation is `invalid`. Responses never carry a password, a TOTP
  * secret or a code digest; an enrollment code appears only in the one response that issues it.
  */
private[auth] object ImperativeAccountJson {
  import ImperativePolicy.*

  /** Bound of names, ids and enrollment codes; their policies are checked by the core. */
  val MaximumTextLength: Int = LoginMaximumLength
  private val TotpAlgorithm = "SHA1"

  /** The members of a request body whose member set has been checked. */
  final class Body private[ImperativeAccountJson] (json: Json) {
    private def member(key: String): Option[Json] = json.asObject.flatMap(_(key))
    def text(key: String, maximum: Int): String = optionalText(key, maximum).getOrElse(throw AccountFailure("invalid"))
    def optionalText(key: String, maximum: Int): Option[String] = member(key).map { value =>
      val result = value.asString.getOrElse(throw AccountFailure("invalid"))
      if (result.isEmpty || result.length > maximum) throw AccountFailure("invalid")
      result
    }
    def flag(key: String): Boolean = member(key).flatMap(_.asBoolean).getOrElse(throw AccountFailure("invalid"))
    override def toString: String = "Body(<redacted>)"
  }
  /** A JSON object whose members are exactly `required` plus any subset of `optional`. */
  def body(value: Option[Json], required: Set[String], optional: Set[String]): Body = {
    val keys = value.flatMap(_.asObject).map(_.keys.toSet).getOrElse(throw AccountFailure("invalid"))
    if (!required.subsetOf(keys) || !keys.subsetOf(required ++ optional)) throw AccountFailure("invalid")
    new Body(value.get)
  }
  def noBody(value: Option[Json]): Unit = if (value.nonEmpty) throw AccountFailure("invalid")

  def credentials(body: Body): NewCredentials = NewCredentials(body.text("password", PasswordMaximumLength),
    body.text("totpSecret", Totp.SecretTextLength), body.text("totpCode", Totp.Digits), body.flag("requireTotp"))

  private def text(value: String): Json = Json.fromString(value)
  private def nullable(value: Option[String]): Json = value.fold(Json.Null)(text)
  private def time(value: Instant): Json = text(value.toString)
  private def number(value: Int): Json = Json.fromInt(value)

  val ok: Json = Json.obj("ok" -> Json.True)
  def signedIn(user: AccountUser): Json = Json.obj("user" -> AccountJson.user(user))
  val signupPending: Json = Json.obj("status" -> text(AccountStatus.Pending.text))
  def signupActive(user: AccountUser): Json = Json.obj("status" -> text(AccountStatus.Active.text), "user" -> AccountJson.user(user))

  /** Credential resets follow the master switch (AM1), so `reset` is true wherever this endpoint exists. */
  def policy(settings: ImperativeSettings): Json = Json.obj(
    "signup" -> Json.fromBoolean(settings.signup),
    "approval" -> Json.fromBoolean(settings.requireApproval),
    "enrollment" -> Json.fromBoolean(settings.enrollment),
    "reset" -> Json.True,
    "issuer" -> text(settings.issuer),
    "username" -> Json.obj("pattern" -> text(UsernamePattern)),
    "password" -> Json.obj("minLength" -> number(PasswordMinimumLength), "maxLength" -> number(PasswordMaximumLength)),
    "totp" -> Json.obj("algorithm" -> text(TotpAlgorithm), "digits" -> number(Totp.Digits), "period" -> Json.fromLong(Totp.StepSeconds),
      "secretBytes" -> number(Totp.SecretBytes)))

  private def source(origin: AccountOrigin): Json = text(origin match {
    case AccountOrigin.Declarative => "declarative"
    case AccountOrigin.Imperative => "imperative"
  })
  private val NoTotp = "none"

  def profile(value: AccountProfile, settings: ImperativeSettings): Json = {
    val own = Json.fromBoolean(value.imperative.nonEmpty)
    Json.obj(
      "user" -> AccountJson.user(value.user),
      "source" -> source(value.user.origin),
      "admin" -> Json.fromBoolean(value.admin),
      "email" -> nullable(value.imperative.map(_.email)),
      "totp" -> Json.obj("required" -> Json.fromBoolean(value.imperative.exists(_.totpRequired)),
        "state" -> text(value.imperative.fold(NoTotp)(_.totp.text))),
      "manage" -> Json.obj("email" -> own, "password" -> own, "totp" -> own, "users" -> Json.fromBoolean(value.admin),
        "enrollment" -> Json.fromBoolean(value.admin && settings.enrollment), "reset" -> Json.fromBoolean(value.admin)))
  }

  def users(values: Vector[ListedAccount]): Json = Json.obj("users" -> Json.arr(values.map { value =>
    val details = value.imperative
    Json.obj(
      "id" -> text(value.id),
      "login" -> nullable(value.login),
      "displayName" -> text(value.displayName),
      "type" -> text(value.userType),
      "source" -> source(value.origin),
      "status" -> text(value.status.text),
      "admin" -> Json.fromBoolean(value.admin),
      "email" -> nullable(details.map(_.email)),
      "createdAt" -> details.fold(Json.Null)(listed => time(listed.createdAt)),
      "createdVia" -> nullable(details.map(_.createdVia.text)),
      "createdBy" -> nullable(details.flatMap(_.createdBy)),
      "approvedBy" -> nullable(details.flatMap(_.approvedBy)),
      "totpRequired" -> details.fold(Json.Null)(listed => Json.fromBoolean(listed.totpRequired)),
      "totpState" -> text(details.fold(NoTotp)(_.totp.text)),
      "locked" -> Json.fromBoolean(details.exists(_.locked)),
      "pendingEnrollment" -> nullable(details.flatMap(_.pendingEnrollment.map(_.text))))
  }*))

  def enrollment(value: ListedEnrollment): Json = Json.obj("id" -> text(value.id), "username" -> text(value.username),
    "kind" -> text(value.kind.text), "createdBy" -> text(value.createdBy), "createdAt" -> time(value.createdAt), "expiresAt" -> time(value.expiresAt))
  def enrollments(values: Vector[ListedEnrollment]): Json = Json.obj("enrollments" -> Json.arr(values.map(enrollment)*))
  def issued(value: IssuedEnrollment): Json = Json.obj("enrollment" -> enrollment(value.enrollment), "code" -> text(value.code))
  def inspected(value: EnrollmentInfo): Json =
    Json.obj("username" -> text(value.username), "kind" -> text(value.kind.text), "expiresAt" -> time(value.expiresAt))
}
