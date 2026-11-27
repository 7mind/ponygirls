package ponygirls.auth.boundary

import cats.syntax.all.*
import java.net.URI
import java.util.Locale
import ponygirls.auth.{PersistentCookie, Secrets}

/** The request headers the boundary reads. `host` and `fetchSite` are single values the caller selected (absent: an
  * empty host, no fetch site); the other headers are every value in arrival order. */
final case class PresentedHeaders(host: String, authorization: Vector[String], cookie: Vector[String],
  origin: Vector[String], fetchSite: Option[String], accountRequest: Vector[String]) {
  override def toString: String =
    s"PresentedHeaders($host,<${authorization.size} authorization redacted>,<${cookie.size} cookie redacted>,$origin,$fetchSite,$accountRequest)"
}

/** A configured browser origin: `scheme://host[:port]`, lower-case host, no default port, nothing else. */
object CanonicalOrigin {
  def port(uri: URI): Int = if (uri.getPort >= 0) uri.getPort else if (uri.getScheme == "https") 443 else 80
  def authority(uri: URI): String = uri.getHost.toLowerCase(Locale.ROOT) + ":" + port(uri)
  def parse(value: String): Either[ConfigRefusal, URI] = {
    val parsed = try Right(new URI(value)) catch { case _: Exception => Left(ConfigRefusal.MalformedOrigin) }
    parsed.flatMap { uri =>
      val scheme = uri.getScheme
      if (!Set("http", "https").contains(scheme) || uri.getPort > 65535 || uri.getHost == null || uri.getRawUserInfo != null || uri.getRawQuery != null || uri.getRawFragment != null || Option(uri.getRawPath).exists(_.nonEmpty) || uri.getHost != uri.getHost.toLowerCase(Locale.ROOT) || uri.getPort == (if (scheme == "https") 443 else 80))
        Left(ConfigRefusal.NonCanonicalOrigin)
      else Right(uri)
    }
  }
}

/** The authority a request names in its `Host` header. */
object RequestAuthority {
  def parse(host: String): URI = {
    if (host.isEmpty || host.exists(c => c.isWhitespace || "/@?#\\".contains(c))) throw BoundaryRefused(Refusal.DisallowedHost)
    val uri = try new URI("http://" + host) catch { case _: Exception => throw BoundaryRefused(Refusal.DisallowedHost) }
    if (uri.getHost == null || uri.getPort > 65535 || uri.getRawUserInfo != null) throw BoundaryRefused(Refusal.DisallowedHost)
    uri
  }
}

/** How a session cookie's value is read: with surrounding whitespace removed, or byte for byte. */
enum CookieValue(val read: String => String) {
  case Trimmed extends CookieValue(_.trim)
  case Exact extends CookieValue(identity)
}
/** Where `Secure` stands among the attributes of a serialised session cookie. */
enum SecureAttribute { case Last, BeforeMaxAge }

/** A service's session cookies under `OriginPolicy`: the name on a secure and on an opted-in plain-HTTP origin, and
  * how their values are read. */
final case class SessionCookies(secure: String, plain: String, value: CookieValue) {
  def name(secureCookie: Boolean): String = if (secureCookie) secure else plain
}

object SessionCookie {
  /** A host-only, HttpOnly, SameSite=Strict session cookie with the persistent lifetime; `None` clears it. */
  def serialize(name: String, secret: Option[String], secure: Boolean, order: SecureAttribute): String = {
    val maxAge = Vector(s"Max-Age=${if (secret.isDefined) PersistentCookie.maxAgeSeconds else 0}")
    val secureFlag = if (secure) Vector("Secure") else Vector.empty
    val trailing = order match {
      case SecureAttribute.Last => maxAge ++ secureFlag
      case SecureAttribute.BeforeMaxAge => secureFlag ++ maxAge
    }
    (Vector(s"$name=${secret.getOrElse("")}", "Path=/", "HttpOnly", "SameSite=Strict") ++ trailing).mkString("; ")
  }
  /** The value of the cookie `name` across every `Cookie` header; two values are refused, never chosen between. */
  def select(cookieHeaders: Vector[String], name: String, value: CookieValue): Option[String] = {
    val values = cookieHeaders.flatMap(_.split(";").toVector).flatMap { part =>
      val index = part.indexOf('=')
      if (index >= 0 && part.take(index).trim == name) Some(value.read(part.drop(index + 1))) else None
    }
    if (values.size > 1) throw BoundaryRefused(Refusal.DuplicateSessionCookie)
    values.headOption
  }
}

/** A configured origin. It is parsed when a check first needs it, and the result is kept. */
private final class ConfiguredOrigin(val raw: String) {
  lazy val parsed: Either[ConfigRefusal, URI] = CanonicalOrigin.parse(raw)
  def uri: URI = parsed.fold(refusal => throw ConfigRefused(refusal), identity)
  lazy val authority: String = CanonicalOrigin.authority(uri)
}

/** Exact Host and Origin admission over configured host names and canonical origins. An origin listed in
  * `insecureHttpOrigins` is a plain-HTTP origin on a dedicated authority, where the session cookie is not `Secure`.
  *
  * The checks parse a configured origin only where they need it, in configuration order, and keep each parse for
  * the life of the policy: a check that refuses the request before it needs an origin parses none. A policy from
  * `load` has every origin checked, so its checks never throw `ConfigRefused`; one from `deferred` throws it from the
  * first check that needs an invalid origin. */
final class OriginPolicy private (allowedHosts: Vector[String], allowedOrigins: Vector[String], insecureHttpOrigins: Vector[String],
    cookieSecure: Boolean) {
  private val allowed: Vector[ConfiguredOrigin] = allowedOrigins.map(new ConfiguredOrigin(_))
  private val allowedByRaw: Map[String, ConfiguredOrigin] = allowed.reverse.map(origin => origin.raw -> origin).toMap
  private val insecure: Vector[ConfiguredOrigin] = insecureHttpOrigins.map(new ConfiguredOrigin(_))
  private def refuse(refusal: Refusal): Nothing = throw BoundaryRefused(refusal)
  private def insecureAt(request: URI): Option[String] = {
    val authority = CanonicalOrigin.authority(request)
    insecure.find(_.authority == authority).map(_.raw)
  }

  /** Every configured origin canonical; an insecure origin is an allowed `http` origin of an allowed host whose
    * authority and effective port no allowed `https` origin of the same host shares. */
  def checked: Either[ConfigRefusal, OriginPolicy] = for {
    uris <- allowed.traverse(_.parsed)
    _ <- insecure.traverse_ { origin =>
      origin.parsed.flatMap { uri =>
        val conflicts = uris.exists { u =>
          u.getScheme == "https" && u.getHost == uri.getHost && (CanonicalOrigin.authority(u) == CanonicalOrigin.authority(uri) || CanonicalOrigin.port(u) == CanonicalOrigin.port(uri))
        }
        if (uri.getScheme != "http" || !allowedOrigins.contains(origin.raw) || !allowedHosts.exists(_.equalsIgnoreCase(uri.getHost)) || conflicts)
          Left(ConfigRefusal.InsecureOriginNotDedicated)
        else Right(())
      }
    }
  } yield this

  /** Whether the session cookie of this request's authority carries `Secure`. */
  def secureCookie(headers: PresentedHeaders): Boolean = {
    val request = RequestAuthority.parse(headers.host)
    cookieSecure && insecureAt(request).isEmpty
  }
  /** Host among the allowed host names (any port); at most one Origin, allowed and of the request's own security class. */
  def validateTransport(headers: PresentedHeaders): Unit = {
    val request = RequestAuthority.parse(headers.host)
    if (!allowedHosts.exists(_.equalsIgnoreCase(request.getHost))) refuse(Refusal.DisallowedHost)
    if (headers.origin.size > 1) refuse(Refusal.AmbiguousOrigin)
    headers.origin.headOption.foreach { origin =>
      if (!allowedOrigins.contains(origin)) refuse(Refusal.DisallowedOrigin)
      val selected = insecureAt(request)
      if (selected.exists(_ != origin) || (selected.isEmpty && insecureHttpOrigins.contains(origin))) refuse(Refusal.OriginHostMismatch)
    }
  }
  /** Same-origin proof of a cookie write: one allowed Origin, or no Origin and `Sec-Fetch-Site: same-origin`. */
  def csrf(headers: PresentedHeaders): Unit = {
    if (!(headers.origin.size == 1 && allowedOrigins.contains(headers.origin.head)) && !(headers.origin.isEmpty && headers.fetchSite.contains("same-origin")))
      refuse(Refusal.SameOriginProofMissing)
  }
  /**
   * The account plane: the transport rule, a same-origin proof also for reads, an Origin of the request's exact
   * authority, no bearer credential and no duplicate session cookie of either name. On an opted-in plain-HTTP origin,
   * browsers send neither Origin nor Sec-Fetch-Site with a same-origin GET (Fetch Metadata is limited to secure
   * contexts), so `csrf` cannot recognise the account module's reads there. Only for such a safe read (`safeRead`:
   * GET) on an insecure-HTTP origin does the module's custom header prove same origin instead: a cross-origin page
   * cannot add a custom header without a CORS preflight, and the service grants none. Writes keep requiring Origin
   * (browsers send it with every POST).
   */
  def accountTransport(headers: PresentedHeaders, safeRead: Boolean, cookies: SessionCookies): Unit = {
    validateTransport(headers)
    val request = RequestAuthority.parse(headers.host)
    val insecureOrigin = insecureAt(request).nonEmpty
    val headerProof = safeRead && insecureOrigin && headers.origin.isEmpty && headers.fetchSite.isEmpty && headers.accountRequest == Vector(OriginPolicy.AccountRequestValue)
    if (!headerProof) csrf(headers)
    def matches(origin: URI): Boolean = {
      val port = if (request.getPort >= 0) request.getPort else if (origin.getScheme == "https") 443 else 80
      origin.getHost.equalsIgnoreCase(request.getHost) && CanonicalOrigin.port(origin) == port
    }
    // `validateTransport` admitted only allowed origins, so every presented one is in `allowedByRaw`.
    if (!allowed.exists(origin => matches(origin.uri)) || headers.origin.exists(raw => !matches(allowedByRaw(raw).uri))) refuse(Refusal.OriginHostMismatch)
    if (headers.authorization.nonEmpty) refuse(Refusal.BrowserSessionRequired)
    SessionCookie.select(headers.cookie, cookies.secure, cookies.value)
    SessionCookie.select(headers.cookie, cookies.plain, cookies.value)
    ()
  }
}
object OriginPolicy {
  /** Sent by the shared account module (shared/account-web/account-client.js) with every account-plane request. */
  val AccountRequestHeader = "X-Account-Request"
  val AccountRequestValue = "1"

  /** A policy whose configured origins are checked when a request check first needs them (`ConfigRefused`). */
  def deferred(allowedHosts: Vector[String], allowedOrigins: Vector[String], insecureHttpOrigins: Vector[String], cookieSecure: Boolean): OriginPolicy =
    new OriginPolicy(allowedHosts, allowedOrigins, insecureHttpOrigins, cookieSecure)
  /** A policy whose configured origins are all checked now (`checked`). */
  def load(allowedHosts: Vector[String], allowedOrigins: Vector[String], insecureHttpOrigins: Vector[String],
      cookieSecure: Boolean): Either[ConfigRefusal, OriginPolicy] = deferred(allowedHosts, allowedOrigins, insecureHttpOrigins, cookieSecure).checked
}

/** Which credentials a route takes. */
enum CredentialAccept { case BearerOrCookie, BearerOnly }

/** The one credential a request presents, before any lookup. */
final case class Presented(secret: String, cookie: Boolean, secureCookie: Boolean) {
  override def toString: String = s"Presented(<redacted>,$cookie,$secureCookie)"
}

object CredentialSelection {
  /** The transport rule, then exactly one canonical credential: `Authorization: Bearer <secret>` or the session cookie
    * of the request's security class. Two bearers, or a bearer with that cookie, are ambiguous; a `BearerOnly` route
    * refuses either session cookie. A cookie credential of a mutation (`mutate`) needs the same-origin proof. */
  def resolve(policy: OriginPolicy, cookies: SessionCookies, headers: PresentedHeaders, accept: CredentialAccept, mutate: Boolean): Presented = {
    policy.validateTransport(headers)
    val secureCookie = policy.secureCookie(headers)
    val session = SessionCookie.select(headers.cookie, cookies.name(secureCookie), cookies.value)
    val bearerOnly = accept == CredentialAccept.BearerOnly
    if (headers.authorization.size > 1) throw BoundaryRefused(Refusal.AmbiguousCredentials)
    if (bearerOnly && (SessionCookie.select(headers.cookie, cookies.secure, cookies.value).isDefined || SessionCookie.select(headers.cookie, cookies.plain, cookies.value).isDefined))
      throw BoundaryRefused(Refusal.CookieNotAccepted)
    if (headers.authorization.nonEmpty && session.isDefined) throw BoundaryRefused(Refusal.AmbiguousCredentials)
    val bearer = headers.authorization.headOption.map { value =>
      if (!value.matches("Bearer [^\\s]+")) throw BoundaryRefused(Refusal.InvalidCredentials)
      value.drop(7)
    }
    val secret = bearer.orElse(if (bearerOnly) None else session).getOrElse(throw BoundaryRefused(Refusal.InvalidCredentials))
    if (!Secrets.canonical(secret)) throw BoundaryRefused(Refusal.InvalidCredentials)
    val isCookie = bearer.isEmpty
    if (mutate && isCookie) policy.csrf(headers)
    Presented(secret, isCookie, secureCookie)
  }
}
