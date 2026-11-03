package haystack.auth

import haystack.domain.{Fault, Principal, QualifiedId}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.security.{MessageDigest, SecureRandom}
import java.net.URI
import java.util.{Base64, Locale}

final case class TokenConfig(id: String, hashFile: String)
final case class UserConfig(id: String, userType: String, displayName: String, tokens: Vector[TokenConfig])
final case class RateLimit(windowMs: Long, max: Int) {
  require(windowMs > 0 && max > 0, "invalid rate limit")
}
final case class AuthConfig(activityProjectId: String, users: Vector[UserConfig], cookieSecure: Boolean = true,
  allowedHosts: Vector[String] = Vector.empty, allowedOrigins: Vector[String] = Vector.empty,
  insecureHttpOrigins: Vector[String] = Vector.empty, rateLimit: Option[RateLimit] = None)

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

final class Auth private(val config: AuthConfig, digests: Vector[(Array[Byte], Principal)]) {
  def authenticate(token: String): Option[Principal] = {
    if (!Tokens.canonical(token)) return None
    val presented = Tokens.hash(token).getBytes(StandardCharsets.US_ASCII)
    var result: Option[Principal] = None
    digests.foreach { case (digest, principal) => if (MessageDigest.isEqual(presented, digest)) result = Some(principal) }
    result
  }
}
object Auth {
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
    val entries = config.users.flatMap { user =>
      if (!validId(user.id,128) || !Set("human", "agent").contains(user.userType)) throw Fault("config", "invalid user")
      if (user.tokens.isEmpty) throw Fault("config", "user has no tokens")
      unique(user.tokens.map(_.id), "duplicate token id")
      user.tokens.map { token =>
        if (!validId(token.id,64)) throw Fault("config", "invalid token id")
        Tokens.readDigest(token.hashFile) -> Principal(user.id, user.userType, token.id)
      }
    }
    unique(entries.map(_._1), "digest assigned twice")
    new Auth(config, entries.map { case (digest, principal) => digest.getBytes(StandardCharsets.US_ASCII) -> principal })
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
final case class Authenticated(principal: Principal, token: String, cookie: Boolean, secureCookie: Boolean)
object Sessions {
  val SecureName = "__Host-haystack"
  val PlainName = "haystack-dev"
  val MaxAge = 15552000
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
  def resolve(auth: Auth, headers: RequestHeaders, mutate: Boolean = false, mcp: Boolean = false): Authenticated = {
    validateTransport(auth.config, headers)
    val secureCookie = secure(auth.config, headers)
    val session = cookie(headers, name(secureCookie))
    if (headers.authorization.size > 1) throw Fault("ambiguous-credentials", "ambiguous credentials")
    if (mcp && (cookie(headers, SecureName).isDefined || cookie(headers, PlainName).isDefined)) throw Fault("unauthorized", "cookie not accepted")
    if (headers.authorization.nonEmpty && session.isDefined) throw Fault("ambiguous-credentials", "ambiguous credentials")
    val bearer = headers.authorization.headOption.map { value =>
      if (!value.matches("Bearer [^\\s]+")) throw Fault("unauthorized", "invalid credentials")
      value.drop(7)
    }
    val token = bearer.orElse(if (mcp) None else session).getOrElse(throw Fault("unauthorized", "invalid credentials"))
    val principal = auth.authenticate(token).getOrElse(throw Fault("unauthorized", "invalid credentials"))
    val isCookie = bearer.isEmpty
    if (mutate && isCookie) csrf(auth.config, headers)
    Authenticated(principal, token, isCookie, secureCookie)
  }
}
