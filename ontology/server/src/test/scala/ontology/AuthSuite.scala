package ontology

import ontology.api.*
import ontology.domain.Fault
import java.nio.file.{Files, Path}
import java.time.{Clock, Instant, ZoneId, ZoneOffset}
import java.util.Base64
import munit.FunSuite

final class AuthSuite extends FunSuite {
  private def token(n: Int): String = Base64.getUrlEncoder.withoutPadding().encodeToString(Array.fill[Byte](32)(n.toByte))
  private val humanToken = token(1)
  private val agentToken = token(2)
  private val origin = "https://ontology.example"
  private val human = CredentialConfig("human-key", Actor("owner", ActorKind.Human), Set("alpha"), Set(Capability.Read, Capability.Mutate, Capability.Review), Path.of("/fixture/human.hash"))
  private val agent = CredentialConfig("agent-key", Actor("worker", ActorKind.Agent), Set("alpha"), Set(Capability.Read, Capability.Mutate), Path.of("/fixture/agent.hash"))
  private final class ClockFixture extends Clock {
    var now: Instant = Instant.parse("2026-11-10T00:00:00Z")
    def getZone: ZoneId = ZoneOffset.UTC
    override def withZone(zone: ZoneId): Clock = Clock.fixed(now, zone)
    def instant(): Instant = now
  }
  private final class DigestsFixture extends CredentialDigests {
    var humanHash: String = Digests.text(humanToken)
    def read(config: CredentialConfig): String = if (config.id == human.id) humanHash else Digests.text(agentToken)
  }
  private final class SecretsFixture extends SessionSecrets {
    private var n = 10
    def next(): String = { n += 1; token(n) }
  }
  private def headers: RequestAuthority = RequestAuthority(List("ontology.example"), List(origin), Nil, Nil, List("owner"))
  private def fixture(): (Auth, DigestsFixture, ClockFixture) = {
    val clock = new ClockFixture; val digests = new DigestsFixture
    (new Auth(AuthConfig(origin, false, List(human, agent), 60L, 10), digests, new SecretsFixture, clock), digests, clock)
  }
  private def cookie(login: LoginSession): String = login.cookie.takeWhile(_ != ';')
  private def denied(code: String)(f: => Any): Unit = assertEquals(intercept[Fault](f).code, code)

  test("structural config validation is separate from runtime credential loading") {
    val config = AuthConfig(origin, false, List(human, agent), 60L, 10)
    assertEquals(AuthConfig.validate(config).toString, origin)
    val unavailable = new CredentialDigests { def read(config: CredentialConfig): String = throw Fault("fixture-secret-read", "controlled credential read") }
    denied("fixture-secret-read") { new Auth(config, unavailable, new SecretsFixture, new ClockFixture) }
    denied("config") { AuthConfig.validate(config.copy(credentials = List(agent.copy(capabilities = Set(Capability.Review))))) }
  }
  test("browser session preserves actual actor and explicit scope grants") {
    val (auth, _, _) = fixture(); val login = auth.login(humanToken, headers)
    assert(login.cookie.contains("HttpOnly; SameSite=Strict")); assert(login.cookie.endsWith("; Secure"))
    val identity = auth.authenticate(headers.copy(cookies = List(cookie(login))), true, false)
    assertEquals(identity.principal.actor, human.actor)
    identity.principal.require("alpha", Capability.Review)
    denied("forbidden") { identity.principal.require("other", Capability.Read) }
  }
  test("bearer and browser transports cannot be mixed or ambiguously selected") {
    val (auth, _, _) = fixture(); val login = auth.login(humanToken, headers)
    val bearer = headers.copy(authorization = List("Bearer " + agentToken), origins = Nil, expectedActor = Nil)
    assertEquals(auth.authenticate(bearer, true, true).principal.actor, agent.actor)
    denied("ambiguous-credentials") { auth.authenticate(bearer.copy(cookies = List(cookie(login))), true, false) }
    denied("ambiguous-credentials") { auth.authenticate(bearer.copy(authorization = bearer.authorization ++ bearer.authorization), false, true) }
    denied("unauthorized") { auth.authenticate(headers.copy(cookies = List(cookie(login))), false, true) }
  }
  test("cookie mutations require the actual origin and presented principal") {
    val (auth, _, _) = fixture(); val login = auth.login(humanToken, headers)
    val request = headers.copy(cookies = List(cookie(login)))
    denied("forbidden") { auth.authenticate(request.copy(origins = Nil), true, false) }
    denied("forbidden") { auth.authenticate(request.copy(origins = List("https://other.example")), true, false) }
    denied("forbidden") { auth.authenticate(request.copy(expectedActor = List("someone-else")), true, false) }
    denied("forbidden") { auth.authenticate(request.copy(hosts = List("other.example")), false, false) }
    denied("forbidden") { auth.authenticate(request.copy(hosts = List("ontology.example", "other.example")), false, false) }
  }
  test("credential rotation invalidates sessions and revalidation after body reads") {
    val (auth, digests, _) = fixture(); val login = auth.login(humanToken, headers)
    val request = headers.copy(cookies = List(cookie(login)))
    val captured = auth.authenticate(request, true, false)
    digests.humanHash = Digests.text(token(3))
    denied("unauthorized") { auth.revalidate(request, captured, true, false) }
    denied("unauthorized") { auth.login(humanToken, headers) }
  }
  test("expiry and logout invalidate actual sessions") {
    val (auth, _, clock) = fixture(); val login = auth.login(humanToken, headers)
    val request = headers.copy(cookies = List(cookie(login)))
    val captured = auth.authenticate(request, true, false)
    assert(auth.logout(captured).contains("Max-Age=0"))
    denied("unauthorized") { auth.authenticate(request, false, false) }
    val next = auth.login(humanToken, headers)
    clock.now = clock.now.plusSeconds(60)
    denied("unauthorized") { auth.authenticate(headers.copy(cookies = List(cookie(next))), false, false) }
  }
  test("agent credentials cannot acquire a Human browser session") {
    val (auth, _, _) = fixture()
    denied("forbidden") { auth.login(agentToken, headers) }
  }
  test("plain HTTP is an explicit loopback-only development mode") {
    val digests = new DigestsFixture
    denied("config") { new Auth(AuthConfig("http://ontology.example", true, List(human), 60, 10), digests, new SecretsFixture, new ClockFixture) }
    val auth = new Auth(AuthConfig("http://127.0.0.1:8040", true, List(human), 60, 10), digests, new SecretsFixture, new ClockFixture)
    val local = RequestAuthority(List("127.0.0.1:8040"), List("http://127.0.0.1:8040"), Nil, Nil, List("owner"))
    val login = auth.login(humanToken, local)
    assert(login.cookie.startsWith("ontology-dev=")); assert(!login.cookie.contains("; Secure"))
  }
  test("a valid fresh login can recover from a malformed old cookie") {
    val (auth, _, _) = fixture()
    val login = auth.login(humanToken, headers.copy(cookies = List("__Host-ontology=malformed")))
    assertEquals(auth.authenticate(headers.copy(cookies = List(cookie(login))), false, false).principal.actor, human.actor)
  }
  test("revoked sessions do not consume capacity for replacement login") {
    val digests = new DigestsFixture
    val auth = new Auth(AuthConfig(origin, false, List(human), 60L, 1), digests, new SecretsFixture, new ClockFixture)
    auth.login(humanToken, headers)
    digests.humanHash = Digests.text(token(3))
    val replacement = auth.login(token(3), headers)
    assertEquals(auth.authenticate(headers.copy(cookies = List(cookie(replacement))), false, false).principal.actor, human.actor)
  }
  test("login rejects an obsolete transport cookie before allocating a session") {
    val auth = new Auth(AuthConfig(origin, false, List(human), 60L, 1), new DigestsFixture, new SecretsFixture, new ClockFixture)
    denied("unauthorized") { auth.login(humanToken, headers.copy(cookies = List("ontology-dev=" + token(30)))) }
    val valid = auth.login(humanToken, headers)
    assertEquals(auth.authenticate(headers.copy(cookies = List(cookie(valid))), false, false).principal.actor, human.actor)
  }
  test("credential hash files accept exactly one optional LF") {
    val path = Files.createTempFile("ontology-hash-", ".txt")
    try {
      Files.writeString(path, Digests.text(humanToken) + "\n")
      assertEquals(new FileCredentialDigests().read(human.copy(hashFile = path)), Digests.text(humanToken))
      Files.writeString(path, Digests.text(humanToken) + "\n\n")
      denied("config") { new FileCredentialDigests().read(human.copy(hashFile = path)) }
    } finally Files.delete(path)
  }
}
