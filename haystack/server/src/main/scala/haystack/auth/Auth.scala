package haystack.auth

import haystack.domain.{Fault, Principal, QualifiedId}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.security.{MessageDigest, SecureRandom}
import java.net.URI
import java.util.{Base64, Locale}
import ponygirls.auth.{AccountOrigin,AccountUser,AccountToken,DeclaredDirectory,ImperativeSettings,Password,PersistentCookie,TotpVault}

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
  insecureHttpOrigins: Vector[String] = Vector.empty, rateLimit: Option[RateLimit] = None, accounts: Option[AccountsConfig] = None)

object Tokens {
  private val encoder = Base64.getUrlEncoder.withoutPadding()
  def canonical(token: String): Boolean = token.matches("[A-Za-z0-9_-]{43}") && (try {
    val bytes = Base64.getUrlDecoder.decode(token)
    bytes.length == 32 && encoder.encodeToString(bytes) == token
  } catch { case _: IllegalArgumentException => false })
  def generate(): String = { val bytes = new Array[Byte](32); new SecureRandom().nextBytes(bytes); encoder.encodeToString(bytes) }
  def hash(token: String): String = {
    if (!canonical(token)) throw Fault("unauthorized", "invalid credentials")
    MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII)).map(b => f"${b & 255}%02x").mkString
  }
  private def read(path: String, length: Int, pattern: String): String = {
    // At most exact bytes + optional LF + one overflow byte. A malformed
    // runtime file cannot force allocation proportional to its source size.
    val raw = try {
      val input = Files.newInputStream(Path.of(path))
      try input.readNBytes(length + 2) finally input.close()
    } catch { case _: Exception => throw Fault("config", "unreadable credential file") }
    val body = if (raw.lastOption.contains(10.toByte)) raw.dropRight(1) else raw
    if (body.length != length || body.exists(b => b < 0 || b == 0 || b == 10 || b == 13)) throw Fault("config", "malformed credential file")
    val text = new String(body, StandardCharsets.US_ASCII)
    if (!text.matches(pattern)) throw Fault("config", "malformed credential file")
    text
  }
  def readToken(path: String): String = { val token = read(path, 43, "[A-Za-z0-9_-]{43}"); if (!canonical(token)) throw Fault("config", "malformed credential file"); token }
  def readDigest(path: String): String = read(path, 64, "[0-9a-f]{64}")
}

/** `users` are the declarative users; `imperative` exists only while the master switch `auth.accounts.enabled` is on. */
final class Auth private(val config: AuthConfig, val users: Vector[AccountUser], val declared: DeclaredDirectory,
  val imperative: Option[ImperativeSettings], digests: Vector[(Array[Byte], Principal)]) {
  /** Configured tokens only: an imperative user has none. */
  def configuredTokens(owner:String):Vector[AccountToken]=config.users.find(_.id==owner).toVector.flatMap(_.tokens).map(t=>AccountToken(t.id,t.id,"configured",None,false,Vector("api")))
  def authenticate(token: String): Option[Principal] = {
    if (!Tokens.canonical(token)) return None
    val presented = Tokens.hash(token).getBytes(StandardCharsets.US_ASCII)
    var result: Option[Principal] = None
    digests.foreach { case (digest, principal) => if (MessageDigest.isEqual(presented, digest)) result = Some(principal) }
    result
  }
}
object Auth {
  /** Service name bound into the associated data of every encrypted TOTP secret. */
  val ServiceName = "haystack"
  private val NixStore = "/nix/store/"
  /** Design §6.2–§6.3: the creation flags never imply the master switch; the master switch requires the key
    * file, an issuer and an enabled declarative admin; the remaining bounds are checked by `ImperativeSettings`.
    */
  private def imperative(accounts: Option[AccountsConfig], declared: DeclaredDirectory): Option[ImperativeSettings] = accounts.flatMap { a =>
    if (!a.enabled && (a.signup.enabled || a.enrollment.enabled)) throw Fault("config", "accounts.signup and accounts.enrollment require accounts.enabled")
    Option.when(a.enabled) {
      val keyFile = a.keyFile.filter(path => path.startsWith("/") && !path.startsWith(NixStore)).getOrElse(throw Fault("config", "accounts.keyFile must be an absolute runtime path"))
      val issuer = a.issuer.getOrElse(throw Fault("config", "accounts.issuer required"))
      if (!declared.users.exists(user => user.enabled && declared.admins(user.id))) throw Fault("config", "accounts require an enabled declarative admin")
      ImperativeSettings(ServiceName, a.signup.enabled, a.signup.requireApproval, a.enrollment.enabled, a.signup.maxUsers,
        java.time.Duration.ofSeconds(a.enrollment.ttlSeconds), issuer, a.reservedUsernames.toSet, TotpVault.load(Path.of(keyFile), ServiceName))
    }
  }
  def load(config: AuthConfig): Auth = {
    QualifiedId.encodeComponent(config.activityProjectId)
    if (config.users.isEmpty) throw Fault("config", "at least one user required")
    def unique(values: Vector[String], message: String): Unit = if (values.distinct.size != values.size) throw Fault("config", message)
    unique(config.users.map(_.id), "duplicate user id")
    config.allowedOrigins.foreach(Origin.canonical)
    config.insecureHttpOrigins.foreach { raw =>
      val uri = Origin.canonical(raw)
      val conflicts = config.allowedOrigins.exists { other =>
        val u = Origin.canonical(other)
        u.getScheme == "https" && u.getHost == uri.getHost && (Origin.authority(u) == Origin.authority(uri) || Origin.port(u) == Origin.port(uri))
      }
      if (uri.getScheme != "http" || !config.allowedOrigins.contains(raw) || !config.allowedHosts.exists(_.equalsIgnoreCase(uri.getHost)) || conflicts)
        throw Fault("config", "insecure origins require a dedicated allowed HTTP authority")
    }
    // Baseline ECMAScript /[^\\s:]{1,n}/ counts UTF16 units. Java's
    // isWhitespace additionally classifies U+001C..001F as separators and Java
    // regex quantifiers count supplementary code points; neither may alter
    // an acknowledged author/token identity or credential mapping.
    def idWhitespace(c:Char):Boolean =
      c >= '\u0009' && c <= '\u000d' || c == ' ' || c == '\u00a0' || c == '\u1680' ||
      c >= '\u2000' && c <= '\u200a' || c == '\u2028' || c == '\u2029' ||
      c == '\u202f' || c == '\u205f' || c == '\u3000' || c == '\ufeff'
    def validId(value:String,max:Int):Boolean=value.nonEmpty && value.length<=max && !value.exists(c=>c==':' || idWhitespace(c))
    unique(config.users.flatMap(_.login), "duplicate login")
    val users = config.users.map { user =>
      if (user.login.isDefined != user.passwordHashFile.isDefined || user.login.isDefined && user.userType != "human") throw Fault("config", "invalid password credentials")
      user.login.foreach { login =>
        if (login.isEmpty || login.length > 128 || login != login.trim || login.exists(_.isControl)) throw Fault("config", "invalid login")
      }
      val passwordHash=user.passwordHashFile.map { path =>
        try Password.readHash(Path.of(path)) catch { case _: Exception => throw Fault("config", "invalid password credential file") }
      }
      AccountUser(user.id,user.userType,user.displayName,user.login,passwordHash,user.enabled,AccountOrigin.Declarative)
    }
    val entries = config.users.flatMap { user =>
      if (!validId(user.id,128) || !Set("human", "agent").contains(user.userType)) throw Fault("config", "invalid user")
      if (user.tokens.isEmpty && user.login.isEmpty) throw Fault("config", "user has no credentials")
      unique(user.tokens.map(_.id), "duplicate token id")
      user.tokens.map { token =>
        if (!validId(token.id,64)) throw Fault("config", "invalid token id")
        Tokens.readDigest(token.hashFile) -> Principal(user.id, user.userType, token.id)
      }
    }
    unique(entries.map(_._1), "digest assigned twice")
    val declared = DeclaredDirectory(users, config.users.filter(_.admin).map(_.id).toSet)
    new Auth(config, users, declared, imperative(config.accounts, declared), entries.filter { case (_,principal)=>users.exists(u=>u.id==principal.userId && u.enabled) }.map { case (digest, principal) => digest.getBytes(StandardCharsets.US_ASCII) -> principal })
  }
}

object Origin {
  def port(uri: URI): Int = if (uri.getPort >= 0) uri.getPort else if (uri.getScheme == "https") 443 else 80
  def authority(uri: URI): String = uri.getHost.toLowerCase(Locale.ROOT) + ":" + port(uri)
  def canonical(value: String): URI = {
    val uri = try new URI(value) catch { case _: Exception => throw Fault("config", "invalid origin") }
    val scheme = uri.getScheme
    if (!Set("http", "https").contains(scheme) || uri.getPort > 65535 || uri.getHost == null || uri.getRawUserInfo != null || uri.getRawQuery != null || uri.getRawFragment != null || Option(uri.getRawPath).exists(_.nonEmpty) || uri.getHost != uri.getHost.toLowerCase(Locale.ROOT) || uri.getPort == (if (scheme == "https") 443 else 80))
      throw Fault("config", "invalid canonical origin")
    uri
  }
  def requestAuthority(host: String): URI = {
    if (host.isEmpty || host.exists(c => c.isWhitespace || "/@?#\\".contains(c))) throw Fault("forbidden", "disallowed host")
    val uri = try new URI("http://" + host) catch { case _: Exception => throw Fault("forbidden", "disallowed host") }
    if (uri.getHost == null || uri.getPort > 65535 || uri.getRawUserInfo != null) throw Fault("forbidden", "disallowed host")
    uri
  }
}
final case class RequestHeaders(host: String, authorization: Vector[String] = Vector.empty, cookie: Vector[String] = Vector.empty,
  origin: Vector[String] = Vector.empty, fetchSite: Option[String] = None)
final case class Authenticated(principal: Principal, token: String, cookie: Boolean, secureCookie: Boolean) {
  override def toString:String=s"Authenticated($principal,<redacted>,$cookie,$secureCookie)"
}
final case class Presented(token:String,cookie:Boolean,secureCookie:Boolean) {
  override def toString:String=s"Presented(<redacted>,$cookie,$secureCookie)"
}
object Sessions {
  val SecureName = "__Host-haystack"
  val PlainName = "haystack-dev"
  val MaxAge: Long = PersistentCookie.maxAgeSeconds
  def name(secure: Boolean): String = if (secure) SecureName else PlainName
  def serialize(token: Option[String], secure: Boolean): String =
    s"${name(secure)}=${token.getOrElse("")}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${if (token.isDefined) MaxAge else 0}" + (if (secure) "; Secure" else "")
  def cookie(headers: RequestHeaders, cookieName: String): Option[String] = {
    val values = headers.cookie.flatMap(_.split(";").toVector).flatMap { part =>
      val index = part.indexOf('=')
      if (index >= 0 && part.take(index).trim == cookieName) Some(part.drop(index + 1).trim) else None
    }
    if (values.size > 1) throw Fault("ambiguous-credentials", "duplicate session cookies")
    values.headOption
  }
  def secure(config: AuthConfig, headers: RequestHeaders): Boolean = {
    val request = Origin.requestAuthority(headers.host)
    config.cookieSecure && !config.insecureHttpOrigins.exists(raw => Origin.authority(Origin.canonical(raw)) == Origin.authority(request))
  }
  def validateTransport(config: AuthConfig, headers: RequestHeaders): Unit = {
    val request = Origin.requestAuthority(headers.host)
    if (!config.allowedHosts.exists(_.equalsIgnoreCase(request.getHost))) throw Fault("forbidden", "disallowed host")
    if (headers.origin.size > 1) throw Fault("forbidden", "ambiguous origin")
    headers.origin.headOption.foreach { origin =>
      if (!config.allowedOrigins.contains(origin)) throw Fault("forbidden", "disallowed origin")
      val selected = config.insecureHttpOrigins.find(raw => Origin.authority(Origin.canonical(raw)) == Origin.authority(request))
      if (selected.exists(_ != origin) || (selected.isEmpty && config.insecureHttpOrigins.contains(origin))) throw Fault("forbidden", "origin/host mismatch")
    }
  }
  def csrf(config: AuthConfig, headers: RequestHeaders): Unit = {
    if (!(headers.origin.size == 1 && config.allowedOrigins.contains(headers.origin.head)) && !(headers.origin.isEmpty && headers.fetchSite.contains("same-origin")))
      throw Fault("forbidden", "missing or invalid origin")
  }
  def accountTransport(config:AuthConfig,headers:RequestHeaders):Unit={
    validateTransport(config,headers)
    csrf(config,headers)
    val request=Origin.requestAuthority(headers.host)
    def matches(raw:String):Boolean={
      val origin=Origin.canonical(raw)
      val port=if(request.getPort>=0)request.getPort else if(origin.getScheme=="https")443 else 80
      origin.getHost.equalsIgnoreCase(request.getHost) && Origin.port(origin)==port
    }
    if(!config.allowedOrigins.exists(matches) || headers.origin.exists(raw=> !matches(raw))) throw Fault("forbidden","origin/host mismatch")
    if(headers.authorization.nonEmpty) throw Fault("unauthorized","browser session required")
    cookie(headers,SecureName);cookie(headers,PlainName)
    ()
  }
  def resolve(config: AuthConfig, headers: RequestHeaders, mutate: Boolean = false, mcp: Boolean = false): Presented = {
    validateTransport(config, headers)
    val secureCookie = secure(config, headers)
    val session = cookie(headers, name(secureCookie))
    if (headers.authorization.size > 1) throw Fault("ambiguous-credentials", "ambiguous credentials")
    if (mcp && (cookie(headers, SecureName).isDefined || cookie(headers, PlainName).isDefined)) throw Fault("unauthorized", "cookie not accepted")
    if (headers.authorization.nonEmpty && session.isDefined) throw Fault("ambiguous-credentials", "ambiguous credentials")
    val bearer = headers.authorization.headOption.map { value =>
      if (!value.matches("Bearer [^\\s]+")) throw Fault("unauthorized", "invalid credentials")
      value.drop(7)
    }
    val token = bearer.orElse(if (mcp) None else session).getOrElse(throw Fault("unauthorized", "invalid credentials"))
    if (!Tokens.canonical(token)) throw Fault("unauthorized", "invalid credentials")
    val isCookie = bearer.isEmpty
    if (mutate && isCookie) csrf(config, headers)
    Presented(token, isCookie, secureCookie)
  }
}
