package ponygirls.auth.http4s

import cats.effect.IO
import cats.effect.unsafe.{IORuntime, IORuntimeConfig, Scheduler}
import io.circe.Json
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.time.{Clock, Duration, Instant, ZoneOffset}
import java.util.concurrent.{ConcurrentLinkedQueue, Executors, ThreadFactory}
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger, AtomicReference}
import org.http4s.{Header, Headers, Method, Request, Response, Status, Uri}
import org.typelevel.ci.CIString
import ponygirls.auth.*
import ponygirls.auth.boundary.*
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** The configuration of one account decision in these suites. */
final case class PlaneSnapshot(users: Vector[AccountUser], declared: DeclaredDirectory, imperative: Option[ImperativeSettings],
    configured: ConfiguredTokens) extends AccountSnapshot[PlaneSnapshot] {
  def unchangedIn(current: PlaneSnapshot): Boolean = current eq this
}

/** An effect runtime whose timers never fire: request bodies and transactions of these suites never race a wall-clock
  * deadline. Its pools are daemon threads; nothing here waits for them. */
private object FrozenTime {
  val Now: Instant = Instant.parse("2026-11-27T12:00:00Z")
  val clock: Clock = Clock.fixed(Now, ZoneOffset.UTC)
  private def threads(name: String): ThreadFactory = task => {
    val thread = new Thread(task, name)
    thread.setDaemon(true)
    thread
  }
  private object NeverFires extends Scheduler {
    def sleep(delay: FiniteDuration, task: Runnable): Runnable = () => ()
    def nowMillis(): Long = Now.toEpochMilli
    def monotonicNanos(): Long = 0L
  }
  val runtime: IORuntime = IORuntime(ExecutionContext.fromExecutor(Executors.newFixedThreadPool(4, threads("plane-compute"))),
    ExecutionContext.fromExecutor(Executors.newCachedThreadPool(threads("plane-blocking"))), NeverFires, () => (), IORuntimeConfig())
}

/** BA and Communication: the account service and the account plane, specified once over the shared types and run
  * against the in-memory store and the shared PostgreSQL tables (dual tests). Synthetic `.test` names, synthetic
  * credentials in temporary files, a fixed clock and timers that never fire. */
abstract class AccountPlaneContract extends munit.FunSuite {
  private given IORuntime = FrozenTime.runtime
  /** Starts from empty stores. */
  protected def withStorage(body: AccountStorage => Unit): Unit

  private val Host = "svc.test:8443"
  private val Origin = "https://svc.test:8443"
  private val Password = "synthetic-plane-password-not-a-secret"
  private val Configured = Secrets.generate()
  private val Cookies = SessionCookies("__Host-svc", "svc-dev", CookieValue.Trimmed)
  private val Policy = OriginPolicy.load(Vector("svc.test"), Vector(Origin), Vector.empty, cookieSecure = true).fold(r => fail(s"refused: $r"), identity)
  private val Indexing = IndexingPolicy(defaultEnabled = true, allowOptIn = true, allowOptOut = true)
  private val CacheControl = CIString("Cache-Control")
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
  private lazy val passwordFile = write("password", ponygirls.auth.Password.hash(Password.toCharArray))
  /** Alice: an admin with a password and the configured token `browser`; Bob: a password and the given tokens. */
  private def declare(bobTokens: Vector[DeclaredTokenConfig]): Declared = DeclaredUsers.load(Vector(
      DeclaredUserConfig("alice", "human", "Alice", Vector(DeclaredTokenConfig("browser", write("alice.sha", Secrets.digest(Configured)))),
        Some("alice"), Some(passwordFile), true, true),
      DeclaredUserConfig("bob", "human", "Bob", bobTokens, Some("bob"), Some(passwordFile), true, false)),
    DeclaredIdRules.Haystack, DigestRead.Snapshot, DigestReader.Stream).fold(r => fail(s"refused: $r"), identity)
  private lazy val declared: Declared = declare(Vector.empty)
  private lazy val switchedOff = PlaneSnapshot(declared.users, declared.directory, None, declared.tokens)
  private lazy val switchedOn = switchedOff.copy(imperative = Some(ImperativeSettings("svc", false, true, false, 10, Duration.ofHours(24), "Service",
    Set.empty, TotpVault.load(Path.of(write("totp.key", Secrets.generate())), "svc"))))

  /** The failure codes of these suites: the protocol's codes for the shared refusals. */
  private def failureCode(error: Throwable): String = error match {
    case AccountFailure("bad-envelope") => "invalid"
    case AccountFailure(code) => code
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
    case "rate-limited" => Status.TooManyRequests
    case "too-large" => Status.PayloadTooLarge
    case "unavailable" => Status.ServiceUnavailable
    case _ => Status.BadRequest
  }
  /** A JSON response without any caching header: the plane adds `no-store` itself. */
  private def plainJson(status: Status, value: Json): Response[IO] =
    Response[IO](status).withEntity(value.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"), "application/json"))

  /** The store the service uses, observed: transactions, password verifications, an outage, and a failure before the
    * commit of a transaction that used the indexing preferences. */
  private final class Observed(underlying: AccountStorage) extends AccountStorage {
    val broken = new AtomicBoolean(false)
    val failBeforeCommit = new AtomicBoolean(false)
    val transactions = new AtomicInteger
    /** `loginReplacing` is the only store operation that verifies a password. */
    val verifications = new AtomicInteger
    def afterCommit(failure: Throwable): Boolean = underlying.afterCommit(failure)
    def transaction[A](work: AccountStore => A): IO[A] = IO.defer {
      transactions.incrementAndGet()
      if (broken.get) IO.raiseError(new IllegalStateException("synthetic storage outage"))
      else underlying.transaction { store =>
        val recording = new Recording(store)
        val result = work(recording)
        if (failBeforeCommit.get && recording.indexed) throw new IllegalStateException("synthetic failure before commit")
        result
      }
    }
    private final class Recording(store: AccountStore) extends AccountStore {
      var indexed = false
      def directory(settings: Option[ImperativeSettings], declared: DeclaredDirectory): Vector[AccountUser] = store.directory(settings, declared)
      def installDeclared(declared: DeclaredDirectory, users: Vector[AccountUser]): Unit = store.installDeclared(declared, users)
      def activeImperativeUsers(): Int = store.activeImperativeUsers()
      def browser(users: Vector[AccountUser], secret: String): Option[AccountCredential] = store.browser(users, secret)
      def bearer(users: Vector[AccountUser], secret: String): Option[AccountCredential] = store.bearer(users, secret)
      def loginReplacing(users: Vector[AccountUser], login: String, password: String, previous: Option[String]): AccountLogin = {
        verifications.incrementAndGet()
        store.loginReplacing(users, login, password, previous)
      }
      def logout(users: Vector[AccountUser], secret: String): Unit = store.logout(users, secret)
      def tokens(owner: String): Vector[AccountToken] = store.tokens(owner)
      def issue(users: Vector[AccountUser], session: AccountCredential, name: String): AccountIssued = store.issue(users, session, name)
      def revoke(users: Vector[AccountUser], session: AccountCredential, id: String): Unit = store.revoke(users, session, id)
      def imperative(settings: Option[ImperativeSettings], declared: DeclaredDirectory, directory: () => Vector[AccountUser],
          hasher: PasswordHasher, clock: Clock, record: LifecycleRecord): ImperativeAccounts = store.imperative(settings, declared, directory, hasher, clock, record)
      def indexing(service: IndexingService, policy: IndexingPolicy): IndexingPreferences = {
        indexed = true
        store.indexing(service, policy)
      }
    }
  }
  /** What a world varies. */
  private final case class Choices(retryAfterOn503: Boolean, order: SecureAttribute, respond: (Status, Json) => Response[IO],
    codes: Throwable => String, admission: LoginAdmission)
  private val Defaults = Choices(retryAfterOn503 = true, SecureAttribute.Last, plainJson, failureCode, LoginAdmission.Unguarded)

  /** One service and plane over a store, with a fresh credential runtime (limiter windows, gate) on the fixed clock. */
  private final class World(storage: AccountStorage, runtime: ImperativeRuntime, choices: Choices) {
    val snapshot = new AtomicReference[PlaneSnapshot](switchedOff)
    val store = new Observed(storage)
    val events = new ConcurrentLinkedQueue[AccountEvent]
    val ended = new ConcurrentLinkedQueue[String]
    val admitted = new AtomicInteger
    val service = new DeclarativeAccountService[PlaneSnapshot](store, () => snapshot.get, runtime, IndexingService.Haystack, Indexing,
      BearerSecretPasswords.Accepted, DeclaredInstallation.Reconciled, AccountLifecycle.Unobserved)
    val plane = new AccountPlane[PlaneSnapshot](service, AccountPlaneSettings[PlaneSnapshot](
      current = () => snapshot.get, origins = _ => Policy, cookies = Cookies, cookieOrder = choices.order, respond = choices.respond,
      failureCode = choices.codes, status = status, audit = event => IO(events.add(event)).void, endSession = secret => IO(ended.add(secret)).void,
      clientAddress = _ => "client-a", admitted = _ => admitted.incrementAndGet(),
      delivered = (response, a) => response.putHeaders(Header.Raw(CIString("X-Authority"), a.authority.userId)),
      bodyTimeout = 30.seconds, retryAfterOn503 = choices.retryAfterOn503, loginAdmission = choices.admission))
    def run(method: Method, path: String, body: Option[String], headers: (String, String)*): (Response[IO], Json) = {
      val plain = Request[IO](method, Uri.unsafeFromString(path))
      val request = body.fold(plain)(plain.withEntity(_)).withHeaders(Headers(headers.map((name, value) => Header.Raw(CIString(name), value))*))
      val response = plane.routes.lift(request).getOrElse(fail(s"not an account route: $path")).unsafeRunSync()
      val text = response.as[String].unsafeRunSync()
      (response, if (text.isEmpty) Json.Null else io.circe.parser.parse(text).fold(throw _, identity))
    }
    def login(user: String, previous: Option[String] = None): String = {
      val (response, _) = run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"$user","password":"$Password"}"""), (json ++ previous.map(session))*)
      assertEquals(response.status, Status.Ok)
      cookieOf(response).getOrElse(fail("session cookie expected"))
    }
    def browser(secret: String): Captured = service.resolve(_ => Presented(secret, true, true)).unsafeRunSync()
  }
  private val json: Vector[(String, String)] = Vector("Host" -> Host, "Origin" -> Origin, "Content-Type" -> "application/json")
  private val read: Vector[(String, String)] = Vector("Host" -> Host, "Origin" -> Origin)
  private def session(secret: String): (String, String) = "Cookie" -> ("__Host-svc=" + secret)
  private def actor(user: String): (String, String) = AccountPlane.ActorHeader -> AccountJson.actor(user)
  private def setCookie(response: Response[IO]): Option[String] = response.headers.get(CIString("Set-Cookie")).map(_.head.value)
  private def cookieOf(response: Response[IO]): Option[String] = setCookie(response).map(_.takeWhile(_ != ';').dropWhile(_ != '=').drop(1)).filter(_.nonEmpty)
  private def code(body: Json): Option[String] = body.hcursor.downField("error").get[String]("code").toOption
  private def world(choices: Choices = Defaults)(body: World => Unit): Unit = withStorage { storage =>
    val (runtime, release) = ImperativeRuntime.resource(FrozenTime.clock, PasswordHasher.Pbkdf2).allocated.unsafeRunSync()
    try {
      val w = new World(storage, runtime, choices)
      w.service.install(w.snapshot.get).unsafeRunSync()
      body(w)
    } finally release.unsafeRunSync()
  }

  test("declared password login sets the session cookie with the service's attributes; the session it replaces is ended and refused") { world() { w =>
    val first = w.login("alice")
    val second = w.login("alice", Some(first))
    assert((w.ended.asScala.toVector) == (Vector(first)), "a session cookie or ended session differs")
    assertEquals(intercept[AccountRefused](w.browser(first)).refusal, AccountRefusal.InvalidCredentials)
    assertEquals(code(w.run(Method.GET, "/api/account/v1", None, (read :+ session(first))*)._2), Some("unauthorized"))
    assertEquals(w.browser(second).authority.userId, "alice")
    val (again, body) = w.run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"bob","password":"$Password"}"""), json*)
    assertEquals(body.hcursor.downField("user").get[String]("id").toOption, Some("bob"))
    assert((setCookie(again)) == (Some(SessionCookie.serialize("__Host-svc", cookieOf(again), true, SecureAttribute.Last))), "a session cookie or ended session differs")
    val (wrong, wrongBody) = w.run(Method.POST, "/api/account/v1/login", Some("""{"login":"alice","password":"wrong"}"""), json*)
    assert((wrong.status, code(wrongBody), setCookie(wrong).isEmpty) == (Status.Unauthorized, Some("unauthorized"), true), "a wrong password was not refused without a cookie")
  }}
  test("the plane writes cookies in the attribute order it is given") { world(Defaults.copy(order = SecureAttribute.BeforeMaxAge)) { w =>
    val (response, _) = w.run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"bob","password":"$Password"}"""), json*)
    assert((setCookie(response)) == (Some(SessionCookie.serialize("__Host-svc", cookieOf(response), true, SecureAttribute.BeforeMaxAge))), "a session cookie or ended session differs")
  }}
  test("a guarded password login is refused by its guard before any password is verified; an admitting guard lets it through") {
    world(Defaults.copy(admission = LoginAdmission.Guarded(_ => IO.raiseError(AccountFailure("rate-limited"))))) { w =>
      val (response, body) = w.run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"alice","password":"$Password"}"""), json*)
      assert((response.status, code(body), setCookie(response).isEmpty) == (Status.TooManyRequests, Some("rate-limited"), true), "a guarded login was not refused without a cookie")
      assertEquals(w.store.verifications.get, 0)
    }
    world(Defaults.copy(admission = LoginAdmission.Guarded(_ => IO.unit))) { w =>
      w.login("alice")
      assertEquals(w.store.verifications.get, 1)
    }
  }
  test("the account read lists the configured and the issued tokens with the one scope, renews, admits and labels") { world() { w =>
    val secret = w.login("alice")
    val (issued, issuedBody) = w.run(Method.POST, "/api/account/v1/tokens", Some("""{"name":"client","scopes":["api"]}"""), (json :+ session(secret) :+ actor("alice"))*)
    assertEquals(issued.status, Status.Ok)
    val issuedId = issuedBody.hcursor.downField("token").get[String]("id").fold(throw _, identity)
    val (response, body) = w.run(Method.GET, "/api/account/v1", None, (read :+ session(secret))*)
    assertEquals(response.status, Status.Ok)
    val tokens = body.hcursor.downField("tokens").focus.flatMap(_.asArray).getOrElse(fail("tokens expected"))
    assertEquals(tokens.map(t => (t.hcursor.get[String]("id").toOption, t.hcursor.get[String]("source").toOption)),
      Vector(Some("browser") -> Some("configured"), Some(issuedId) -> Some("issued")))
    val advertised = body.hcursor.get[Vector[String]]("scopes").fold(throw _, identity)
    assertEquals(tokens.map(_.hcursor.get[Vector[String]]("scopes").fold(throw _, identity)), Vector(advertised, advertised))
    assert((setCookie(response)) == (Some(SessionCookie.serialize("__Host-svc", Some(secret), true, SecureAttribute.Last))), "a session cookie or ended session differs")
    assertEquals(response.headers.get(CIString("X-Authority")).map(_.head.value), Some("alice"))
    assertEquals(w.admitted.get, 2)
  }}
  test("issue needs the session owner's actor and the one scope; a configured token is immutable; logout ends the session") { world() { w =>
    val secret = w.login("alice")
    val owner = json :+ session(secret)
    val issue = Some("""{"name":"client","scopes":["api"]}""")
    assertEquals(code(w.run(Method.POST, "/api/account/v1/tokens", issue, owner*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/tokens", issue, (owner :+ actor("bob"))*)._2), Some("conflict"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/tokens", Some("""{"name":"client","scopes":["read"]}"""), (owner :+ actor("alice"))*)._2), Some("forbidden"))
    val (issued, issuedBody) = w.run(Method.POST, "/api/account/v1/tokens", issue, (owner :+ actor("alice"))*)
    assertEquals(issued.status, Status.Ok)
    val issuedSecret = issuedBody.hcursor.get[String]("secret").fold(throw _, identity)
    val issuedId = issuedBody.hcursor.downField("token").get[String]("id").fold(throw _, identity)
    val bearer = w.service.resolve(_ => Presented(issuedSecret, false, true)).unsafeRunSync()
    assertEquals(bearer.authority, Authority("alice", "human", issuedId))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/tokens/browser/revoke", Some("{}"), (owner :+ actor("alice"))*)._2), Some("forbidden"))
    assertEquals(w.run(Method.POST, s"/api/account/v1/tokens/$issuedId/revoke", Some("{}"), (owner :+ actor("alice"))*)._1.status, Status.Ok)
    assert(!w.service.live(bearer).unsafeRunSync())
    val (logout, _) = w.run(Method.POST, "/api/account/v1/logout", Some("{}"), (owner :+ actor("alice"))*)
    assert(((logout.status, setCookie(logout))) == ((Status.Ok, Some(SessionCookie.serialize("__Host-svc", None, true, SecureAttribute.Last)))), "a session cookie or ended session differs")
    assert((w.ended.asScala.toVector) == (Vector(secret)), "a session cookie or ended session differs")
    assertEquals(code(w.run(Method.GET, "/api/account/v1", None, (read :+ session(secret))*)._2), Some("unauthorized"))
  }}
  test("the boundary refuses a bearer, a second Host, a query, a foreign Origin, a non-JSON or oversized body and a non-empty logout body") { world() { w =>
    val secret = w.login("alice")
    assertEquals(code(w.run(Method.GET, "/api/account/v1", None, (read :+ ("Authorization" -> ("Bearer " + Configured)))*)._2), Some("unauthorized"))
    assertEquals(code(w.run(Method.GET, "/api/account/v1", None, (read :+ ("Host" -> Host) :+ session(secret))*)._2), Some("forbidden"))
    assertEquals(code(w.run(Method.GET, "/api/account/v1?x=1", None, (read :+ session(secret))*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/logout", Some("{}"), "Host" -> Host, "Origin" -> "https://evil.test", "Content-Type" -> "application/json", session(secret))._2), Some("forbidden"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/logout", Some("{}"), (read :+ session(secret) :+ actor("alice"))*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/logout", Some("x" * (AccountJson.maxBodyBytes + 1)), (json :+ session(secret) :+ actor("alice"))*)._2), Some("too-large"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/logout", Some("""{"x":1}"""), (json :+ session(secret) :+ actor("alice"))*)._2), Some("invalid"))
    assertEquals(w.run(Method.GET, "/api/account/v1", None, (read :+ session(secret))*)._1.status, Status.Ok)
  }}
  test("imperative paths are not found while the switch is off and dispatched while it is on, the login included") { world() { w =>
    assertEquals(code(w.run(Method.GET, "/api/account/v1/policy", None, read*)._2), Some("not-found"))
    assertEquals(code(w.run(Method.GET, "/api/account/v2/policy", None, read*)._2), Some("not-found"))
    assertEquals(code(w.run(Method.GET, "/api/account/v2/policy?x=1", None, read*)._2), Some("invalid"))
    w.snapshot.set(switchedOn)
    val (policy, policyBody) = w.run(Method.GET, "/api/account/v1/policy", None, read*)
    assertEquals((policy.status, policyBody.hcursor.get[String]("issuer").toOption), (Status.Ok, Some("Service")))
    val secret = w.login("alice")
    assertEquals(w.browser(secret).authority.userId, "alice")
  }}
  test("indexing preferences are served with the switch off and audited only once committed; a GET body or a second Content-Type is refused") { world() { w =>
    val secret = w.login("alice")
    assertEquals(w.run(Method.GET, "/api/account/v1/indexing", None, (read :+ session(secret))*)._1.status, Status.Ok)
    w.store.failBeforeCommit.set(true)
    val (rolledBack, rolledBackBody) = w.run(Method.POST, "/api/account/v1/indexing", Some("""{"choice":"disabled"}"""), (json :+ session(secret) :+ actor("alice"))*)
    assertEquals((rolledBack.status, code(rolledBackBody), w.events.asScala.toVector), (Status.ServiceUnavailable, Some("unavailable"), Vector.empty))
    w.store.failBeforeCommit.set(false)
    val (unchanged, unchangedBody) = w.run(Method.GET, "/api/account/v1/indexing", None, (read :+ session(secret))*)
    assertEquals(unchanged.status, Status.Ok)
    val (changed, changedBody) = w.run(Method.POST, "/api/account/v1/indexing", Some("""{"choice":"disabled"}"""), (json :+ session(secret) :+ actor("alice"))*)
    assertEquals(changed.status, Status.Ok)
    assertNotEquals(changedBody, unchangedBody)
    assertEquals(w.events.asScala.toVector.map(_.fields.toMap), Vector(Map("event" -> "account.indexing.choice-changed", "actor" -> "alice", "target" -> "alice",
      "outcome" -> "disabled", "clientAddress" -> "client-a")))
    assertEquals(code(w.run(Method.GET, "/api/account/v1/indexing", Some("{}"), (json :+ session(secret))*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/indexing", Some("""{"choice":"enabled"}"""),
      (json :+ ("Content-Type" -> "application/json") :+ session(secret) :+ actor("alice"))*)._2), Some("invalid"))
    assertEquals(code(w.run(Method.POST, "/api/account/v1/indexing", Some("""{"choice":"enabled"}"""),
      "Host" -> Host, "Content-Type" -> "application/json", session(secret), actor("alice"))._2), Some("forbidden"))
  }}
  Vector(true, false).foreach { retry =>
    test(s"a 503 raised outside the dispatcher on its routes carries Retry-After exactly when chosen ($retry)") { world(Defaults.copy(retryAfterOn503 = retry)) { w =>
      val secret = w.login("alice")
      w.store.broken.set(true)
      val (indexing, body) = w.run(Method.GET, "/api/account/v1/indexing", None, (read :+ session(secret))*)
      assertEquals((indexing.status, code(body)), (Status.ServiceUnavailable, Some("unavailable")))
      assertEquals(indexing.headers.get(CIString("Retry-After")).map(_.head.value), Option.when(retry)(ImperativeAccountApi.UnavailableRetryAfterSeconds.toString))
      val (account, _) = w.run(Method.GET, "/api/account/v1", None, (read :+ session(secret))*)
      assertEquals((account.status, account.headers.get(CIString("Retry-After"))), (Status.ServiceUnavailable, None))
    }}
    test(s"a failure code outside the protocol is unavailable in body and status, also at the dispatcher boundary ($retry)") {
      val codes: Throwable => String = {
        case _: IllegalStateException => "config"
        case other => failureCode(other)
      }
      world(Defaults.copy(retryAfterOn503 = retry, codes = codes)) { w =>
        val secret = w.login("alice")
        w.store.broken.set(true)
        val (indexing, body) = w.run(Method.GET, "/api/account/v1/indexing", None, (read :+ session(secret))*)
        assertEquals((indexing.status, code(body)), (Status.ServiceUnavailable, Some("unavailable")))
        assertEquals(indexing.headers.get(CIString("Retry-After")).map(_.head.value), Option.when(retry)(ImperativeAccountApi.UnavailableRetryAfterSeconds.toString))
        val (account, accountBody) = w.run(Method.GET, "/api/account/v1", None, (read :+ session(secret))*)
        assertEquals((account.status, code(accountBody)), (Status.ServiceUnavailable, Some("unavailable")))
      }
    }
  }
  test("every final response carries exactly one Cache-Control: no-store, whatever the responder writes") {
    def check(w: World, secret: String): Unit = {
      val responses = Vector(
        w.run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"bob","password":"$Password"}"""), json*)._1,
        w.run(Method.GET, "/api/account/v1", None, (read :+ session(secret))*)._1,
        w.run(Method.POST, "/api/account/v1/tokens", Some("""{"name":"client","scopes":["api"]}"""), (json :+ session(secret) :+ actor("alice"))*)._1,
        w.run(Method.GET, "/api/account/v1/indexing", None, (read :+ session(secret))*)._1,
        w.run(Method.GET, "/api/account/v1/policy", None, read*)._1,
        w.run(Method.GET, "/api/account/v2", None, read*)._1,
        w.run(Method.GET, "/api/account/v1", None, read*)._1)
      responses.foreach(response => assertEquals(response.headers.headers.filter(_.name == CacheControl).map(_.value), List("no-store"), response.status.toString))
    }
    world() { w => check(w, w.login("alice")) }
    world(Defaults.copy(respond = (status, value) => plainJson(status, value).putHeaders(Header.Raw(CacheControl, "public, max-age=60")))) { w => check(w, w.login("alice")) }
    val stored: (Status, Json) => Response[IO] = (status, value) => plainJson(status, value).putHeaders(Header.Raw(CacheControl, "no-store"), Header.Raw(CIString("X-Service"), "1"))
    world(Defaults.copy(respond = stored)) { w =>
      check(w, w.login("alice"))
      val (response, body) = w.run(Method.GET, "/api/account/v2", None, read*)
      assertEquals(response.headers.headers, stored(response.status, body).headers.headers)
    }
  }
  test("advertised and accepted scopes are the one scope that issued tokens carry") { world() { w =>
    val secret = w.login("alice")
    val owner = json :+ session(secret) :+ actor("alice")
    assertEquals(code(w.run(Method.POST, "/api/account/v1/tokens", Some("""{"name":"client","scopes":["read"]}"""), owner*)._2), Some("forbidden"))
    val (issued, issuedBody) = w.run(Method.POST, "/api/account/v1/tokens", Some("""{"name":"client","scopes":["api"]}"""), owner*)
    assertEquals(issued.status, Status.Ok)
    val (_, body) = w.run(Method.GET, "/api/account/v1", None, (read :+ session(secret))*)
    val advertised = body.hcursor.get[Vector[String]]("scopes").fold(throw _, identity)
    assertEquals(issuedBody.hcursor.downField("token").get[Vector[String]]("scopes").toOption, Some(advertised))
    assertEquals(advertised, AccountScopes.Api)
  }}
  test("credentials resolve configured tokens first without consulting the store, even when an issued token has the same secret") { world() { w =>
    val configured = w.service.resolve(_ => Presented(Configured, false, true)).unsafeRunSync()
    assertEquals(configured.authority, Authority("alice", "human", "browser"))
    assert(w.service.live(configured).unsafeRunSync())
    assertEquals(intercept[AccountRefused](w.service.resolve(_ => Presented(Secrets.generate(), false, true)).unsafeRunSync()).refusal, AccountRefusal.InvalidCredentials)
    assertEquals(intercept[AccountRefused](w.service.account(configured).unsafeRunSync()).refusal, AccountRefusal.BrowserSessionRequired)
    val secret = w.login("alice")
    val (_, issuedBody) = w.run(Method.POST, "/api/account/v1/tokens", Some("""{"name":"client","scopes":["api"]}"""), (json :+ session(secret) :+ actor("alice"))*)
    val issuedSecret = issuedBody.hcursor.get[String]("secret").fold(throw _, identity)
    assertEquals(w.service.resolve(_ => Presented(issuedSecret, false, true)).unsafeRunSync().authority.userId, "alice")
    val pinned = declare(Vector(DeclaredTokenConfig("pinned", write("bob.sha", Secrets.digest(issuedSecret)))))
    w.snapshot.set(switchedOff.copy(configured = pinned.tokens))
    val before = w.store.transactions.get
    assertEquals(w.service.resolve(_ => Presented(issuedSecret, false, true)).unsafeRunSync().authority, Authority("bob", "human", "pinned"))
    assertEquals(w.store.transactions.get, before)
    val bob = w.browser(w.login("bob"))
    val alice = w.browser(secret)
    assertEquals(intercept[AccountRefused](w.service.account(bob.copy(authority = alice.authority)).unsafeRunSync()).refusal, AccountRefusal.AuthorityChanged)
    assertEquals(w.service.suspended(switchedOff).unsafeRunSync(), 0)
    assertEquals(w.service.suspended(switchedOn).unsafeRunSync(), 0)
    w.service.logout(bob, None).unsafeRunSync()
    assert(!w.service.live(bob).unsafeRunSync())
  }}
  test("a browser credential prints neither its cookie secret nor its stored digest") { world() { w =>
    val secret = w.login("alice")
    val captured = w.browser(secret)
    assert(captured.authority.tokenId.startsWith("session-"))
    Vector(captured.toString, captured.authority.toString, captured.presented.toString).foreach { text =>
      Vector(secret, Secrets.digest(secret)).foreach(value => assert(!text.contains(value), "a browser credential prints its secret or digest"))
    }
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
      Vector(secret, Secrets.digest(secret), hash).foreach(value => assert(!text.contains(value), "a type prints a secret, a digest or a password hash"))
    }
  }
  test("telemetry labels name the shared account endpoints only") {
    assertEquals(AccountPlane.label(Method.GET, "/api/account/v1/indexing"), Some("account/indexing"))
    assertEquals(AccountPlane.label(Method.POST, "/api/account/v1/signup"), Some("account/signup"))
    assertEquals(AccountPlane.label(Method.GET, "/api/account/v1"), None)
    assertEquals(AccountPlane.label(Method.GET, "/api/account/v1/unknown"), None)
  }
}
