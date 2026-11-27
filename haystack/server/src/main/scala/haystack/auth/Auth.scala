package haystack.auth

import haystack.domain.{Fault, Principal, QualifiedId}
import java.net.URI
import ponygirls.auth.{AccountSnapshot,AccountUser,AccountToken,DeclaredDirectory,ImperativeSettings,PersistentCookie,Secrets}
import ponygirls.auth.boundary
import ponygirls.auth.boundary.{BoundaryRefused,CanonicalOrigin,ConfigRefused,ConfigRefusal,CookieValue,CredentialAccept,CredentialSelection,DeclaredIdRules,DeclaredUsers,
  DigestRead,DigestReader,ExactCredentialFile,ImperativeConfig,KeyFilePolicy,OriginPolicy,PresentedHeaders,Refusal,RequestAuthority,SecureAttribute,SessionCookie,SessionCookies}

final case class TokenConfig(id: String, hashFile: String)
final case class UserConfig(id: String, userType: String, displayName: String, tokens: Vector[TokenConfig],
  login: Option[String] = None, passwordHashFile: Option[String] = None, enabled: Boolean = true, admin: Boolean = false)
/** `auth.accounts` (design §6.1): imperative accounts. Absent means the master switch is off. */
final case class AccountsConfig(enabled: Boolean, keyFile: Option[String], signup: SignupConfig, enrollment: EnrollmentConfig,
  issuer: Option[String], reservedUsernames: Vector[String])
final case class SignupConfig(enabled: Boolean, requireApproval: Boolean, maxUsers: Int)
final case class EnrollmentConfig(enabled: Boolean, ttlSeconds: Long)
final case class RateLimit(windowMs: Long, max: Int) {
  require(windowMs > 0 && max > 0, "invalid rate limit")
}
final case class AuthConfig(activityProjectId: String, users: Vector[UserConfig], cookieSecure: Boolean = true,
  allowedHosts: Vector[String] = Vector.empty, allowedOrigins: Vector[String] = Vector.empty,
  insecureHttpOrigins: Vector[String] = Vector.empty, rateLimit: Option[RateLimit] = None, accounts: Option[AccountsConfig] = None) {
  /** Compiled once per configuration value; a reload or `copy` makes a new value and so a new policy. */
  private[auth] lazy val originPolicy: OriginPolicy = OriginPolicy.deferred(allowedHosts, allowedOrigins, insecureHttpOrigins, cookieSecure)
}

/** Haystack's failure codes and messages for the refusals of the shared boundary (`ponygirls.auth.boundary`). */
private object Refused {
  def fault(refusal: Refusal): Fault = refusal match {
    case Refusal.DisallowedHost => Fault("forbidden", "disallowed host")
    case Refusal.AmbiguousOrigin => Fault("forbidden", "ambiguous origin")
    case Refusal.DisallowedOrigin => Fault("forbidden", "disallowed origin")
    case Refusal.OriginHostMismatch => Fault("forbidden", "origin/host mismatch")
    case Refusal.SameOriginProofMissing => Fault("forbidden", "missing or invalid origin")
    case Refusal.BrowserSessionRequired => Fault("unauthorized", "browser session required")
    case Refusal.CookieNotAccepted => Fault("unauthorized", "cookie not accepted")
    case Refusal.DuplicateSessionCookie => Fault("ambiguous-credentials", "duplicate session cookies")
    case Refusal.AmbiguousCredentials => Fault("ambiguous-credentials", "ambiguous credentials")
    case Refusal.InvalidCredentials => Fault("unauthorized", "invalid credentials")
  }
  def fault(refusal: ConfigRefusal): Fault = Fault("config", refusal match {
    case ConfigRefusal.MalformedOrigin => "invalid origin"
    case ConfigRefusal.NonCanonicalOrigin => "invalid canonical origin"
    case ConfigRefusal.InsecureOriginNotDedicated => "insecure origins require a dedicated allowed HTTP authority"
    case ConfigRefusal.NoUsers => "at least one user required"
    case ConfigRefusal.DuplicateUserId => "duplicate user id"
    case ConfigRefusal.DuplicateLogin => "duplicate login"
    case ConfigRefusal.InvalidPasswordCredentials => "invalid password credentials"
    case ConfigRefusal.InvalidLogin => "invalid login"
    case ConfigRefusal.InvalidPasswordFile => "invalid password credential file"
    case ConfigRefusal.InvalidUser => "invalid user"
    case ConfigRefusal.NoCredentials => "user has no credentials"
    case ConfigRefusal.DuplicateTokenId => "duplicate token id"
    case ConfigRefusal.InvalidTokenId => "invalid token id"
    case ConfigRefusal.UnreadableCredentialFile => "unreadable credential file"
    case ConfigRefusal.MalformedCredentialFile => "malformed credential file"
    case ConfigRefusal.DigestAssignedTwice => "digest assigned twice"
    case ConfigRefusal.AccountsFlagsWithoutSwitch => "accounts.signup and accounts.enrollment require accounts.enabled"
    case ConfigRefusal.AccountsKeyFile => "accounts.keyFile must be an absolute runtime path"
    case ConfigRefusal.AccountsIssuer => "accounts.issuer required"
    case ConfigRefusal.AccountsAdmin => "accounts require an enabled declarative admin"
  })
  def apply[A](body: => A): A = try body catch {
    case BoundaryRefused(refusal) => throw fault(refusal)
    case ConfigRefused(refusal) => throw fault(refusal)
  }
  def configured[A](result: Either[ConfigRefusal, A]): A = result.fold(refusal => throw fault(refusal), identity)
}

object Tokens {
  def hash(token: String): String = {
    if (!Secrets.canonical(token)) throw Fault("unauthorized", "invalid credentials")
    Secrets.digest(token)
  }
  def readToken(path: String): String = {
    val token = Refused.configured(ExactCredentialFile.read(path, 43, "[A-Za-z0-9_-]{43}"))
    if (!Secrets.canonical(token)) throw Refused.fault(ConfigRefusal.MalformedCredentialFile)
    token
  }
  def readDigest(path: String): String = Refused.configured(DigestReader.Stream.read(path))
}

/** `users` are the declarative users; `imperative` exists only while the master switch `auth.accounts.enabled` is on. */
final class Auth private(val config: AuthConfig, val users: Vector[AccountUser], val declared: DeclaredDirectory,
  val imperative: Option[ImperativeSettings], val configured: boundary.ConfiguredTokens) extends AccountSnapshot[Auth] {
  /** Configured tokens only: an imperative user has none. */
  def configuredTokens(owner: String): Vector[AccountToken] = configured.listed(owner)
  def authenticate(token: String): Option[Principal] = configured.authenticate(token).map(t => Principal(t.userId, t.userType, t.tokenId))
  /** A reload that changes neither the configuration nor the declared directory leaves an admitted decision standing. */
  def unchangedIn(current: Auth): Boolean = (current eq this) || (current.config == config && current.declared == declared)
}
object Auth {
  /** Service name bound into the associated data of every encrypted TOTP secret. */
  val ServiceName = "haystack"
  private def declaredUser(user: UserConfig): boundary.DeclaredUserConfig =
    boundary.DeclaredUserConfig(user.id, user.userType, user.displayName, user.tokens.map(t => boundary.DeclaredTokenConfig(t.id, t.hashFile)),
      user.login, user.passwordHashFile, user.enabled, user.admin)
  private def accounts(a: AccountsConfig): boundary.ImperativeAccountsConfig =
    boundary.ImperativeAccountsConfig(a.enabled, a.keyFile, a.signup.enabled, a.signup.requireApproval, a.signup.maxUsers,
      a.enrollment.enabled, a.enrollment.ttlSeconds, a.issuer, a.reservedUsernames)
  def load(config: AuthConfig): Auth = {
    QualifiedId.encodeComponent(config.activityProjectId)
    val users = config.users.map(declaredUser)
    // The origin checks run between the user-id checks and the remaining user checks, as before the move.
    Refused.configured(DeclaredUsers.identities(users))
    Refused.configured(config.originPolicy.checked)
    val declared = Refused.configured(DeclaredUsers.load(users, DeclaredIdRules.Haystack, DigestRead.Snapshot, DigestReader.Stream))
    val imperative = Refused.configured(ImperativeConfig.settings(ServiceName, config.accounts.map(accounts), declared.directory, KeyFilePolicy.LiteralStorePrefix))
    new Auth(config, declared.users, declared.directory, imperative, declared.tokens)
  }
}

object Origin {
  def port(uri: URI): Int = CanonicalOrigin.port(uri)
  def authority(uri: URI): String = CanonicalOrigin.authority(uri)
  def canonical(value: String): URI = Refused.configured(CanonicalOrigin.parse(value))
  def requestAuthority(host: String): URI = Refused(RequestAuthority.parse(host))
}
final case class RequestHeaders(host: String, authorization: Vector[String] = Vector.empty, cookie: Vector[String] = Vector.empty,
  origin: Vector[String] = Vector.empty, fetchSite: Option[String] = None, accountRequest: Vector[String] = Vector.empty) {
  def presented: PresentedHeaders = PresentedHeaders(host, authorization, cookie, origin, fetchSite, accountRequest)
}
final case class Authenticated(principal: Principal, token: String, cookie: Boolean, secureCookie: Boolean) {
  override def toString:String=s"Authenticated($principal,<redacted>,$cookie,$secureCookie)"
}
final case class Presented(token:String,cookie:Boolean,secureCookie:Boolean) {
  override def toString:String=s"Presented(<redacted>,$cookie,$secureCookie)"
}
/** Haystack's cookie names and origin policy over the shared transport rules (`ponygirls.auth.boundary`). */
object Sessions {
  val SecureName = "__Host-haystack"
  val PlainName = "haystack-dev"
  private val Cookies = SessionCookies(SecureName, PlainName, CookieValue.Trimmed)
  val MaxAge: Long = PersistentCookie.maxAgeSeconds
  def name(secure: Boolean): String = Cookies.name(secure)
  def serialize(token: Option[String], secure: Boolean): String = SessionCookie.serialize(name(secure), token, secure, SecureAttribute.Last)
  def cookie(headers: RequestHeaders, cookieName: String): Option[String] = Refused(SessionCookie.select(headers.cookie, cookieName, Cookies.value))
  def secure(config: AuthConfig, headers: RequestHeaders): Boolean = Refused(config.originPolicy.secureCookie(headers.presented))
  def validateTransport(config: AuthConfig, headers: RequestHeaders): Unit = Refused(config.originPolicy.validateTransport(headers.presented))
  def csrf(config: AuthConfig, headers: RequestHeaders): Unit = Refused(config.originPolicy.csrf(headers.presented))
  /** Sent by the shared account module (shared/account-web/account-client.js) with every account-plane request. */
  val AccountRequestHeader = OriginPolicy.AccountRequestHeader
  val AccountRequestValue = OriginPolicy.AccountRequestValue
  /** `OriginPolicy.accountTransport`: on an opted-in plain-HTTP origin, a GET proves same origin with the account request header. */
  def accountTransport(config:AuthConfig,headers:RequestHeaders,safeRead:Boolean):Unit=
    Refused(config.originPolicy.accountTransport(headers.presented, safeRead, Cookies))
  def resolve(config: AuthConfig, headers: RequestHeaders, mutate: Boolean = false, mcp: Boolean = false): Presented = {
    val selected = select(config, headers, mutate, mcp)
    Presented(selected.secret, selected.cookie, selected.secureCookie)
  }
  private[auth] def select(config: AuthConfig, headers: RequestHeaders, mutate: Boolean, mcp: Boolean): boundary.Presented = {
    val accept = if (mcp) CredentialAccept.BearerOnly else CredentialAccept.BearerOrCookie
    Refused(CredentialSelection.resolve(config.originPolicy, Cookies, headers.presented, accept, mutate))
  }
}
