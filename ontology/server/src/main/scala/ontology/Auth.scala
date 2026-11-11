package ontology

import ontology.api.{Actor, ActorKind, Capability, Identity}
import ontology.domain.{Fault, Require}
import ponygirls.runtime.BoundedSecretFile
import java.nio.file.Path
import java.nio.charset.StandardCharsets.US_ASCII
import java.security.{MessageDigest, SecureRandom}
import java.time.{Clock, Instant}
import java.net.URI
import java.util.Base64

final case class CredentialConfig(id: String, actor: Actor, scopes: Set[String], capabilities: Set[Capability], hashFile: Path)
final case class AuthConfig(publicOrigin: String, loopbackDevelopment: Boolean, credentials: List[CredentialConfig], sessionTtlSeconds: Long, maxSessions: Int)
final case class Principal(credentialId: String, actor: Actor, scopes: Set[String], capabilities: Set[Capability]) {
  def require(scope: String, capability: Capability): Unit = Require(scopes.contains(scope) && capabilities.contains(capability), "forbidden", "scope or capability denied")
  def identity: Identity = Identity(actor, scopes.toList.sorted, capabilities.toList.sortBy(_.toString))
}
trait CredentialDigests { def read(config: CredentialConfig): String }
final class FileCredentialDigests extends CredentialDigests {
  def read(config: CredentialConfig): String = {
    Require(config.hashFile.isAbsolute, "config", "absolute credential hash path required")
    val raw = try BoundedSecretFile.read(config.hashFile, 65) catch { case _: Exception => throw Fault("config", "credential hash unavailable") }
    val digest = raw.stripSuffix("\n")
    Require(digest.matches("[0-9a-f]{64}"), "config", "invalid credential hash")
    digest
  }
}
trait SessionSecrets { def next(): String }
final class RandomSessionSecrets(random: SecureRandom) extends SessionSecrets {
  def next(): String = { val bytes = new Array[Byte](32); random.nextBytes(bytes); Base64.getUrlEncoder.withoutPadding().encodeToString(bytes) }
}
final case class RequestAuthority(hosts: List[String], origins: List[String], authorization: List[String], cookies: List[String], expectedActor: List[String])
final case class Authenticated(principal: Principal, session: Boolean, credentialDigest: String, sessionDigest: Option[String])
final case class LoginSession(principal: Principal, cookie: String)

final class Auth(config: AuthConfig, digests: CredentialDigests, secrets: SessionSecrets, clock: Clock) {
  private final case class Session(credentialId: String, digest: String, expiresAt: Instant)
  private var sessions = Map.empty[String, Session]
  private val origin = validateConfig()
  private val secure = origin.getScheme == "https"
  val cookieName: String = if (secure) "__Host-ontology" else "ontology-dev"
  private val otherCookieName: String = if (secure) "ontology-dev" else "__Host-ontology"
  private def canonicalToken(token: String): Boolean = token.matches("[A-Za-z0-9_-]{43}") && scala.util.Try {
    val bytes = Base64.getUrlDecoder.decode(token)
    bytes.length == 32 && Base64.getUrlEncoder.withoutPadding().encodeToString(bytes) == token
  }.getOrElse(false)
  private def tokenDigest(token: String): String = {
    Require(canonicalToken(token), "unauthorized", "invalid credentials")
    Digests.text(token)
  }
  private def equal(a: String, b: String): Boolean = MessageDigest.isEqual(a.getBytes(US_ASCII), b.getBytes(US_ASCII))
  private def current(): List[(CredentialConfig, String)] = {
    val entries = config.credentials.map(c => c -> digests.read(c))
    Require(entries.map(_._2).distinct.size == entries.size, "config", "credential digest assigned twice")
    entries
  }
  private def principal(c: CredentialConfig): Principal = Principal(c.id, c.actor, c.scopes, c.capabilities)
  private def validateConfig(): URI = {
    val uri = try new URI(config.publicOrigin) catch { case _: Exception => throw Fault("config", "invalid public origin") }
    Require(Set("http", "https").contains(uri.getScheme) && uri.getHost != null && uri.getRawUserInfo == null && uri.getRawQuery == null && uri.getRawFragment == null && Option(uri.getRawPath).forall(_.isEmpty) && uri.getPort <= 65535, "config", "absolute origin without path required")
    Require(uri.getScheme == "https" || config.loopbackDevelopment && Set("localhost", "127.0.0.1", "[::1]", "::1").contains(uri.getHost), "config", "HTTP is restricted to explicit loopback development")
    Require(config.sessionTtlSeconds > 0 && config.sessionTtlSeconds <= 604800 && config.maxSessions > 0, "config", "invalid session bounds")
    Require(config.credentials.nonEmpty && config.credentials.map(_.id).distinct.size == config.credentials.size, "config", "unique credential identities required")
    config.credentials.foreach { c =>
      Require(c.id.nonEmpty && c.actor.id.nonEmpty && c.scopes.nonEmpty && c.scopes.forall(_.trim.nonEmpty) && c.capabilities.nonEmpty, "config", "invalid credential grants")
      Require(!c.capabilities.contains(Capability.Review) || c.actor.kind == ActorKind.Human, "config", "review capability requires a Human principal")
      Require(!c.capabilities.contains(Capability.HostCapture) || c.actor.kind == ActorKind.Service, "config", "host capture requires a trusted service principal")
    }
    current()
    uri
  }
  def validateTransport(headers: RequestAuthority, mutateCookie: Boolean): Unit = {
    Require(headers.hosts.size == 1 && headers.hosts.head.equalsIgnoreCase(origin.getRawAuthority), "forbidden", "host mismatch")
    Require(headers.origins.size <= 1 && headers.origins.forall(_ == config.publicOrigin), "forbidden", "origin mismatch")
    if (mutateCookie) Require(headers.origins == List(config.publicOrigin), "forbidden", "same-origin mutation required")
  }
  private def cookie(headers: RequestAuthority, name: String): Option[String] = {
    val values = headers.cookies.flatMap(_.split(';').toList).flatMap { item =>
      val at = item.indexOf('=')
      if (at >= 0 && item.take(at).trim == name) Some(item.drop(at + 1).trim) else None
    }
    Require(values.size <= 1, "ambiguous-credentials", "duplicate session cookies")
    values.headOption
  }
  def authenticate(headers: RequestAuthority, mutation: Boolean, mcp: Boolean): Authenticated = synchronized {
    validateTransport(headers, false)
    Require(headers.authorization.size <= 1, "ambiguous-credentials", "duplicate authorization")
    val sessionToken = cookie(headers, cookieName)
    Require(cookie(headers, otherCookieName).isEmpty, "unauthorized", "wrong session transport")
    Require(!(headers.authorization.nonEmpty && sessionToken.nonEmpty), "ambiguous-credentials", "mixed credentials")
    val entries = current()
    val authenticated = headers.authorization.headOption match {
      case Some(value) =>
        Require(value.startsWith("Bearer "), "unauthorized", "bearer credentials required")
        val hash = tokenDigest(value.drop(7))
        val entry = entries.find(e => equal(e._2, hash)).getOrElse(throw Fault("unauthorized", "invalid credentials"))
        Authenticated(principal(entry._1), false, hash, None)
      case None =>
        Require(!mcp, "unauthorized", "MCP requires bearer credentials")
        val hash = tokenDigest(sessionToken.getOrElse(throw Fault("unauthorized", "session required")))
        val session = sessions.getOrElse(hash, throw Fault("unauthorized", "session unavailable"))
        Require(clock.instant().isBefore(session.expiresAt), "unauthorized", "session expired")
        val entry = entries.find(e => e._1.id == session.credentialId && equal(e._2, session.digest)).getOrElse(throw Fault("unauthorized", "session credential revoked"))
        if (mutation) validateTransport(headers, true)
        Authenticated(principal(entry._1), true, session.digest, Some(hash))
    }
    if (mutation && authenticated.session) Require(headers.expectedActor == List(authenticated.principal.actor.id), "forbidden", "presented principal changed")
    authenticated
  }
  def login(token: String, headers: RequestAuthority): LoginSession = synchronized {
    validateTransport(headers, true)
    Require(headers.authorization.isEmpty, "ambiguous-credentials", "login does not accept authorization header")
    Require(cookie(headers, otherCookieName).isEmpty, "unauthorized", "wrong session transport")
    val hash = tokenDigest(token)
    val entries = current()
    val entry = entries.find(e => equal(e._2, hash)).getOrElse(throw Fault("unauthorized", "invalid credentials"))
    Require(entry._1.actor.kind == ActorKind.Human, "forbidden", "browser login requires a Human principal")
    sessions = sessions.filter { case (_, s) => clock.instant().isBefore(s.expiresAt) && entries.exists(e => e._1.id == s.credentialId && equal(e._2, s.digest)) }
    cookie(headers, cookieName).filter(canonicalToken).foreach { old => sessions = sessions - tokenDigest(old) }
    Require(sessions.size < config.maxSessions, "session-capacity", "session capacity reached")
    val secret = secrets.next(); val sessionHash = tokenDigest(secret)
    Require(!sessions.contains(sessionHash), "internal", "session secret collision")
    sessions = sessions.updated(sessionHash, Session(entry._1.id, hash, clock.instant().plusSeconds(config.sessionTtlSeconds)))
    LoginSession(principal(entry._1), serializeCookie(Some(secret)))
  }
  def revalidate(headers: RequestAuthority, previous: Authenticated, mutation: Boolean, mcp: Boolean): Authenticated = {
    val now = authenticate(headers, mutation, mcp)
    Require(now == previous, "unauthorized", "request authority changed")
    now
  }
  def logout(authenticated: Authenticated): String = synchronized {
    Require(authenticated.session, "forbidden", "browser session required")
    authenticated.sessionDigest.foreach(hash => sessions = sessions - hash)
    serializeCookie(None)
  }
  private def serializeCookie(secret: Option[String]): String = s"$cookieName=${secret.getOrElse("")}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${if (secret.nonEmpty) config.sessionTtlSeconds else 0}" + (if (secure) "; Secure" else "")
}
