package ponygirls.auth.http4s

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.time.{Clock, Duration}
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger, AtomicReference}
import org.http4s.{Header, Headers, Method, Request, Response, Status, Uri}
import org.typelevel.ci.CIString
import ponygirls.auth.*
import ponygirls.auth.boundary.*
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** The configuration of one account decision in these suites. */
final case class PlaneSnapshot(users: Vector[AccountUser], declared: DeclaredDirectory, imperative: Option[ImperativeSettings],
    configured: ConfiguredTokens) extends AccountSnapshot[PlaneSnapshot] {
  def unchangedIn(current: PlaneSnapshot): Boolean = current eq this
}

/** BA and Communication: the account service and the account plane, specified once over the shared types and run
  * against the in-memory store and the shared PostgreSQL tables (dual tests). Synthetic `.test` names, synthetic
  * credentials in temporary files. */
abstract class AccountPlaneContract extends munit.FunSuite {
  /** Starts from empty stores. */
  protected def withStorage(body: AccountStorage => Unit): Unit

  private val Host = "svc.test:8443"
  private val Origin = "https://svc.test:8443"
  private val Password = "synthetic-plane-password-not-a-secret"
  private val Configured = Secrets.generate()
  private val Cookies = SessionCookies("__Host-svc", "svc-dev", CookieValue.Trimmed)
  private val Policy = OriginPolicy.load(Vector("svc.test"), Vector(Origin), Vector.empty, cookieSecure = true).fold(r => fail(s"refused: $r"), identity)
  private val Indexing = IndexingPolicy(defaultEnabled = true, allowOptIn = true, allowOptOut = true)
  private val directory = Files.createTempDirectory("account-plane-")
  override def afterAll(): Unit = {
    val paths = Files.walk(directory)
    try paths.iterator.asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)) finally paths.close()
  }
  private def write(name: String, value: String): String = {
    val path = directory.resolve(name)
    Files.writeString(path, value, StandardCharsets.UTF_8)
    path.toString
  }
  private lazy val declared: Declared = DeclaredUsers.load(Vector(
      DeclaredUserConfig("alice", "human", "Alice", Vector(DeclaredTokenConfig("browser", write("alice.sha", Secrets.digest(Configured)))),
        Some("alice"), Some(write("alice.password", ponygirls.auth.Password.hash(Password.toCharArray))), true, true),
      DeclaredUserConfig("bob", "human", "Bob", Vector.empty, Some("bob"), Some(write("bob.password", ponygirls.auth.Password.hash(Password.toCharArray))), true, false)),
    DeclaredIdRules.Haystack, DigestRead.Snapshot, DigestReader.Stream).fold(r => fail(s"refused: $r"), identity)
  private lazy val switchedOff = PlaneSnapshot(declared.users, declared.directory, None, declared.tokens)
  private lazy val switchedOn = switchedOff.copy(imperative = Some(ImperativeSettings("svc", false, true, false, 10, Duration.ofHours(24), "Service",
    Set.empty, TotpVault.load(Path.of(write("totp.key", Secrets.generate())), "svc"))))
  /** The production clock and PBKDF2, like the one runtime of a server; its gate has no finalizer. */
  private lazy val runtime: ImperativeRuntime = ImperativeRuntime.resource(Clock.systemUTC(), PasswordHasher.Pbkdf2).allocated.unsafeRunSync()._1

  /** The failure codes of these suites: the protocol's codes for the shared refusals. */
  private def failureCode(error: Throwable): String = error match {
    case AccountFailure("bad-envelope") => "invalid"
    case AccountFailure(code) if Set("invalid", "unauthorized", "forbidden", "not-found", "conflict", "rate-limited", "too-large")(code) => code
    case BoundaryRefused(refusal) => refusal match {
      case Refusal.DisallowedHost | Refusal.AmbiguousOrigin | Refusal.DisallowedOrigin | Refusal.OriginHostMismatch | Refusal.SameOriginProofMissing |
           Refusal.AmbiguousHost | Refusal.OriginRequired => "forbidden"
      case Refusal.BrowserSessionRequired | Refusal.CookieNotAccepted | Refusal.DuplicateSessionCookie | Refusal.AmbiguousCredentials |
           Refusal.InvalidCredentials => "unauthorized"
      case Refusal.QueryParameters | Refusal.JsonRequired | Refusal.BodyOnGet | Refusal.EmptyObjectRequired | Refusal.OneContentTypeRequired => "invalid"
      case Refusal.BodyTooLarge => "too-large"
    }
    case AccountRefused(AccountRefusal.InvalidTokenScopes | AccountRefusal.ConfiguredTokenImmutable) => "forbidden"
    case AccountRefused(_) => "unauthorized"
    case _ => "unavailable"
  }
  private def status(code: String): Status = code match {
    case "unauthorized" => Status.Unauthorized
    case "forbidden" => Status.Forbidden
    case "not-found" => Status.NotFound
    case "conflict" => Status.Conflict
    case "too-large" => Status.PayloadTooLarge
    case "unavailable" => Status.ServiceUnavailable
    case _ => Status.BadRequest
  }

  private final class Switchable(underlying: AccountStorage, broken: AtomicBoolean) extends AccountStorage {
    def transaction[A](work: AccountStore => A): IO[A] =
      if (broken.get) IO.raiseError(new IllegalStateException("synthetic storage outage")) else underlying.transaction(work)
  }
  /** One service and plane over a store, with everything the plane reports recorded. */
  private final class World(storage: AccountStorage, retryAfterOn503: Boolean, order: SecureAttribute) {
    val snapshot = new AtomicReference[PlaneSnapshot](switchedOff)
    val broken = new AtomicBoolean(false)
    val events = new ConcurrentLinkedQueue[AccountEvent]
    val ended = new ConcurrentLinkedQueue[String]
    val admitted = new AtomicInteger
    val service = new DeclarativeAccountService[PlaneSnapshot](new Switchable(storage, broken), () => snapshot.get, runtime,
      IndexingService.Haystack, Indexing, Vector("api"))
    val plane = new AccountPlane[PlaneSnapshot](service, AccountPlaneSettings[PlaneSnapshot](
      current = () => snapshot.get, origins = _ => Policy, cookies = Cookies, cookieOrder = order,
      respond = (status, value) => Response[IO](status).withEntity(value.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"), "application/json")),
      failureCode = failureCode, status = status, audit = event => IO(events.add(event)).void, endSession = secret => IO(ended.add(secret)).void,
      clientAddress = _ => "client-a", admitted = _ => admitted.incrementAndGet(), delivered = (response, a) => response.putHeaders(Header.Raw(CIString("X-Authority"), a.authority.userId)),
      bodyTimeout = 30.seconds, retryAfterOn503 = retryAfterOn503, scopes = Vector("api")))
    def run(method: Method, path: String, body: Option[String], headers: (String, String)*): (Response[IO], Json) = {
      val plain = Request[IO](method, Uri.unsafeFromString(path))
      val request = body.fold(plain)(plain.withEntity(_)).withHeaders(Headers(headers.map((name, value) => Header.Raw(CIString(name), value))*))
      val response = plane.routes.lift(request).getOrElse(fail(s"not an account route: $path")).unsafeRunSync()
      val text = response.as[String].unsafeRunSync()
      (response, if (text.isEmpty) Json.Null else io.circe.parser.parse(text).fold(throw _, identity))
    }
    def install(): Unit = service.install(snapshot.get).unsafeRunSync()
    def login(user: String): String = {
      val (response, _) = run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"$user","password":"$Password"}"""), json*)
      assertEquals(response.status, Status.Ok)
      cookieOf(response).getOrElse(fail("session cookie expected"))
    }
  }
  private val json: Vector[(String, String)] = Vector("Host" -> Host, "Origin" -> Origin, "Content-Type" -> "application/json")
  private def session(secret: String): (String, String) = "Cookie" -> ("__Host-svc=" + secret)
  private def actor(user: String): (String, String) = AccountPlane.ActorHeader -> AccountJson.actor(user)
  private def setCookie(response: Response[IO]): Option[String] = response.headers.get(CIString("Set-Cookie")).map(_.head.value)
  private def cookieOf(response: Response[IO]): Option[String] = setCookie(response).map(_.takeWhile(_ != ';').dropWhile(_ != '=').drop(1)).filter(_.nonEmpty)
  private def code(body: Json): Option[String] = body.hcursor.downField("error").get[String]("code").toOption
  private def world(retryAfterOn503: Boolean = true, order: SecureAttribute = SecureAttribute.Last)(body: World => Unit): Unit = withStorage { storage =>
    val w = new World(storage, retryAfterOn503, order)
    w.install()
    body(w)
  }

  test("declared password login sets the session cookie with the service's attributes and ends the session it replaces") { world() { w =>
    val first = w.login("alice")
    val (again, body) = w.run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"alice","password":"$Password"}"""), (json :+ session(first))*)
    assertEquals(again.status, Status.Ok)
    assertEquals(body.hcursor.downField("user").get[String]("id").toOption, Some("alice"))
    val second = cookieOf(again).getOrElse(fail("session cookie expected"))
    assertEquals(setCookie(again), Some(SessionCookie.serialize("__Host-svc", Some(second), true, SecureAttribute.Last)))
    assertEquals(w.ended.asScala.toVector, Vector(first))
    val (wrong, wrongBody) = w.run(Method.POST, "/api/account/v1/login", Some("""{"login":"alice","password":"wrong"}"""), json*)
    assertEquals((wrong.status, code(wrongBody), setCookie(wrong)), (Status.Unauthorized, Some("unauthorized"), None))
  }}
  test("the plane writes cookies in the attribute order it is given") { world(order = SecureAttribute.BeforeMaxAge) { w =>
    val (response, _) = w.run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"bob","password":"$Password"}"""), json*)
    val secret = cookieOf(response).getOrElse(fail("session cookie expected"))
    assertEquals(setCookie(response), Some(SessionCookie.serialize("__Host-svc", Some(secret), true, SecureAttribute.BeforeMaxAge)))
  }}
  test("the account read lists configured and issued tokens with the offered scopes, renews, admits and labels") { world() { w =>
    val secret = w.login("alice")
    val (response, body) = w.run(Method.GET, "/api/account/v1", None, "Host" -> Host, "Origin" -> Origin, session(secret))
    assertEquals(response.status, Status.Ok)
    assertEquals(body.hcursor.downField("tokens").focus.flatMap(_.asArray).map(_.flatMap(_.hcursor.get[String]("source").toOption)), Some(Vector("configured")))
    assertEquals(body.hcursor.get[Vector[String]]("scopes").toOption, Some(Vector("api")))
    assertEquals(setCookie(response), Some(SessionCookie.serialize("__Host-svc", Some(secret), true, SecureAttribute.Last)))
    assertEquals(response.headers.get(CIString("X-Authority")).map(_.head.value), Some("alice"))
    assertEquals(w.admitted.get, 1)
  }}
  test("issue needs the session owner's actor and the offered scopes; a configured token is immutable; logout ends the session") { world() { w =>
    val secret = w.login("alice")
    val read = json :+ session(secret)
    val issue = Some("""{"name":"client","scopes":["api"]}""")
    assertEquals(code(w.run(Method.POST, "/api/account/v1/tokens", issue, read*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/tokens", issue, (read :+ actor("bob"))*)._2), Some("conflict"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/tokens", Some("""{"name":"client","scopes":["other"]}"""), (read :+ actor("alice"))*)._2), Some("forbidden"))
    val (issued, issuedBody) = w.run(Method.POST, "/api/account/v1/tokens", issue, (read :+ actor("alice"))*)
    assertEquals(issued.status, Status.Ok)
    val issuedSecret = issuedBody.hcursor.get[String]("secret").fold(throw _, identity)
    val issuedId = issuedBody.hcursor.downField("token").get[String]("id").fold(throw _, identity)
    val bearer = w.service.resolve(_ => Presented(issuedSecret, false, true)).unsafeRunSync()
    assertEquals(bearer.authority.userId, "alice")
    assertEquals(code(w.run(Method.POST, "/api/account/v1/tokens/browser/revoke", Some("{}"), (read :+ actor("alice"))*)._2), Some("forbidden"))
    assertEquals(w.run(Method.POST, s"/api/account/v1/tokens/$issuedId/revoke", Some("{}"), (read :+ actor("alice"))*)._1.status, Status.Ok)
    assert(!w.service.live(bearer).unsafeRunSync())
    val (logout, _) = w.run(Method.POST, "/api/account/v1/logout", Some("{}"), (read :+ actor("alice"))*)
    assertEquals((logout.status, setCookie(logout)), (Status.Ok, Some(SessionCookie.serialize("__Host-svc", None, true, SecureAttribute.Last))))
    assertEquals(w.ended.asScala.toVector, Vector(secret))
    assertEquals(code(w.run(Method.GET, "/api/account/v1", None, "Host" -> Host, "Origin" -> Origin, session(secret))._2), Some("unauthorized"))
  }}
  test("the boundary refuses a bearer, a second Host, a query, a foreign Origin, a non-JSON or oversized body and a non-empty logout body") { world() { w =>
    val secret = w.login("alice")
    val base = Vector("Host" -> Host, "Origin" -> Origin)
    assertEquals(code(w.run(Method.GET, "/api/account/v1", None, (base :+ ("Authorization" -> ("Bearer " + Configured)))*)._2), Some("unauthorized"))
    assertEquals(code(w.run(Method.GET, "/api/account/v1", None, (base :+ ("Host" -> Host) :+ session(secret))*)._2), Some("forbidden"))
    assertEquals(code(w.run(Method.GET, "/api/account/v1?x=1", None, (base :+ session(secret))*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/logout", Some("{}"), "Host" -> Host, "Origin" -> "https://evil.test", "Content-Type" -> "application/json", session(secret))._2), Some("forbidden"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/logout", Some("{}"), (base :+ session(secret) :+ actor("alice"))*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/logout", Some("x" * (AccountJson.maxBodyBytes + 1)), (json :+ session(secret) :+ actor("alice"))*)._2), Some("too-large"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/logout", Some("""{"x":1}"""), (json :+ session(secret) :+ actor("alice"))*)._2), Some("invalid"))
    assertEquals(w.run(Method.GET, "/api/account/v1", None, (base :+ session(secret))*)._1.status, Status.Ok)
  }}
  test("imperative paths are not found while the switch is off and dispatched while it is on, the login included") { world() { w =>
    val base = Vector("Host" -> Host, "Origin" -> Origin)
    assertEquals(code(w.run(Method.GET, "/api/account/v1/policy", None, base*)._2), Some("not-found"))
    assertEquals(code(w.run(Method.GET, "/api/account/v2/policy", None, base*)._2), Some("not-found"))
    assertEquals(code(w.run(Method.GET, "/api/account/v2/policy?x=1", None, base*)._2), Some("invalid"))
    w.snapshot.set(switchedOn)
    val (policy, policyBody) = w.run(Method.GET, "/api/account/v1/policy", None, base*)
    assertEquals((policy.status, policyBody.hcursor.get[String]("issuer").toOption), (Status.Ok, Some("Service")))
    val (login, _) = w.run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"alice","password":"$Password"}"""), json*)
    assertEquals(login.status, Status.Ok)
    val secret = cookieOf(login).getOrElse(fail("session cookie expected"))
    assertEquals(w.service.resolve(_ => Presented(secret, true, true)).unsafeRunSync().authority.userId, "alice")
  }}
  test("indexing preferences are served with the switch off, audited after commit, and a GET body or a second Content-Type is refused") { world() { w =>
    val secret = w.login("alice")
    val (profile, _) = w.run(Method.GET, "/api/account/v1/indexing", None, "Host" -> Host, "Origin" -> Origin, session(secret))
    assertEquals(profile.status, Status.Ok)
    val (changed, _) = w.run(Method.POST, "/api/account/v1/indexing", Some("""{"choice":"disabled"}"""), (json :+ session(secret) :+ actor("alice"))*)
    assertEquals(changed.status, Status.Ok)
    val events = w.events.asScala.toVector
    assertEquals(events.map(_.fields.toMap), Vector(Map("event" -> "account.indexing.choice-changed", "actor" -> "alice", "target" -> "alice",
      "outcome" -> "disabled", "clientAddress" -> "client-a")))
    assertEquals(code(w.run(Method.GET, "/api/account/v1/indexing", Some("{}"), (json :+ session(secret))*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/indexing", Some("""{"choice":"enabled"}"""),
      (json :+ ("Content-Type" -> "application/json") :+ session(secret) :+ actor("alice"))*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/indexing", Some("""{"choice":"enabled"}"""),
      "Host" -> Host, "Content-Type" -> "application/json", session(secret), actor("alice"))._2), Some("forbidden"))
  }}
  Vector(true, false).foreach { retry =>
    test(s"a 503 raised outside the dispatcher on its routes carries Retry-After exactly when chosen ($retry)") { world(retryAfterOn503 = retry) { w =>
      val secret = w.login("alice")
      w.broken.set(true)
      val (indexing, body) = w.run(Method.GET, "/api/account/v1/indexing", None, "Host" -> Host, "Origin" -> Origin, session(secret))
      assertEquals((indexing.status, code(body)), (Status.ServiceUnavailable, Some("unavailable")))
      assertEquals(indexing.headers.get(CIString("Retry-After")).map(_.head.value), Option.when(retry)(ImperativeAccountApi.UnavailableRetryAfterSeconds.toString))
      val (read, _) = w.run(Method.GET, "/api/account/v1", None, "Host" -> Host, "Origin" -> Origin, session(secret))
      assertEquals((read.status, read.headers.get(CIString("Retry-After"))), (Status.ServiceUnavailable, None))
    }}
  }
  test("credentials resolve configured tokens first, then issued tokens and sessions; liveness follows the store") { world() { w =>
    val configured = w.service.resolve(_ => Presented(Configured, false, true)).unsafeRunSync()
    assertEquals(configured.authority, Authority("alice", "human", "browser"))
    assert(w.service.live(configured).unsafeRunSync())
    assertEquals(intercept[AccountRefused](w.service.resolve(_ => Presented(Secrets.generate(), false, true)).unsafeRunSync()).refusal, AccountRefusal.InvalidCredentials)
    assertEquals(intercept[AccountRefused](w.service.account(configured).unsafeRunSync()).refusal, AccountRefusal.BrowserSessionRequired)
    val secret = w.login("bob")
    val bob = w.service.resolve(_ => Presented(secret, true, true)).unsafeRunSync()
    val alice = w.service.resolve(_ => Presented(w.login("alice"), true, true)).unsafeRunSync()
    assertEquals(intercept[AccountRefused](w.service.account(bob.copy(authority = alice.authority)).unsafeRunSync()).refusal, AccountRefusal.AuthorityChanged)
    assertEquals(w.service.suspended(switchedOff).unsafeRunSync(), 0)
    assertEquals(w.service.suspended(switchedOn).unsafeRunSync(), 0)
    w.service.logout(bob, None).unsafeRunSync()
    assert(!w.service.live(bob).unsafeRunSync())
  }}
}

/** BA: the types this stage added print no credential. */
final class AccountPlaneTypesSuite extends munit.FunSuite {
  test("captured credentials, account views and refusals never print a secret, a digest or a password hash") {
    val secret = Secrets.generate()
    val hash = ponygirls.auth.Password.hash("synthetic-types-password".toCharArray)
    val captured = Captured(Authority("alice", "human", "browser"), Presented(secret, true, true))
    val view = AccountView(AccountUser("alice", "human", "Alice", Some("alice"), Some(hash), true, AccountOrigin.Declarative),
      Vector(AccountToken("t", "client", "issued", None, false, Vector("api"))))
    Vector(captured.toString, view.toString, AccountRefused(AccountRefusal.InvalidCredentials).getMessage, captured.authority.toString).foreach { text =>
      Vector(secret, Secrets.digest(secret), hash).foreach(value => assert(!text.contains(value), text))
    }
  }
  test("telemetry labels name the shared account endpoints only") {
    assertEquals(AccountPlane.label(Method.GET, "/api/account/v1/indexing"), Some("account/indexing"))
    assertEquals(AccountPlane.label(Method.POST, "/api/account/v1/signup"), Some("account/signup"))
    assertEquals(AccountPlane.label(Method.GET, "/api/account/v1"), None)
    assertEquals(AccountPlane.label(Method.GET, "/api/account/v1/unknown"), None)
  }
}
