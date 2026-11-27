package ponygirls.auth.http4s

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import io.circe.Json
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.time.Duration
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.{AtomicBoolean, AtomicReference}
import org.http4s.{Header, Headers, Method, Request, Response, Status, Uri}
import org.http4s.dsl.io.*
import org.typelevel.ci.CIString
import ponygirls.auth.*
import ponygirls.auth.boundary.*
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** The configuration of one account decision of the test consumer: the shared members, and the declared ids its
  * operator states return to the same principal. */
final case class ChatSnapshot(users: Vector[AccountUser], declared: DeclaredDirectory, imperative: Option[ImperativeSettings],
    configured: ConfiguredTokens, reinstated: Set[String]) extends AccountSnapshot[ChatSnapshot] {
  def unchangedIn(current: ChatSnapshot): Boolean = current eq this
}

/** The test consumer's rule on its declared ids (Blabber's design §4.3, reduced): an id that left the configuration does
  * not return unless the operator lists it as reinstated. `recorded` maps every id ever installed to whether it left. */
object DeclaredIdBinding {
  final case class Refused(ids: Vector[String]) extends RuntimeException("removed declared ids return: " + ids.mkString(","))
  def next(recorded: Map[String, Boolean], s: ChatSnapshot): Map[String, Boolean] = {
    val declared = s.users.map(_.id).toSet
    val returning = declared.filter(id => recorded.get(id).contains(true) && !s.reinstated(id)).toVector.sorted
    if (returning.nonEmpty) throw Refused(returning)
    (recorded.keySet ++ declared).map(id => id -> !declared(id)).toMap
  }
}

/** BA and Communication: the shared account module as a fourth service uses it, through a test consumer with its own
  * routes (a chat service shaped like Blabber's accounts unit): a route for bearer tokens only, one for browser sessions
  * only, one for either, the actor header on browser sessions, an administrator-only route, a long wait, its own
  * installation rule and its indexing key. Run against the in-memory store and the shared PostgreSQL tables (dual tests). */
abstract class ServiceCallersContract extends munit.FunSuite {
  private given IORuntime = FrozenTime.runtime
  /** One store and the consumer's declared-id records over it, starting empty. */
  protected trait Backend {
    def storage: AccountStorage
    /** The consumer's installation: `DeclaredIdBinding` in the installing transaction. */
    def installation: DeclaredInstallation[ChatSnapshot]
    def recorded(): Map[String, Boolean]
    /** The effective administrator flag as the backend's connection-level read gives it. */
    def administrator(settings: Option[ImperativeSettings], declared: DeclaredDirectory, userId: String): Boolean
  }
  protected def withBackend(body: Backend => Unit): Unit

  private val Host = "chat.test:8448"
  private val Origin = "https://chat.test:8448"
  private val Cookies = SessionCookies("__Host-chat", "chat-dev", CookieValue.Trimmed)
  private val Policy = OriginPolicy.load(Vector("chat.test"), Vector(Origin), Vector.empty, cookieSecure = true).fold(r => fail(s"refused: $r"), identity)
  private val Indexing = IndexingPolicy(defaultEnabled = true, allowOptIn = true, allowOptOut = true)
  private val Password = "synthetic-chat-password-not-a-secret"
  private val AliceToken = Secrets.generate()
  private val CiToken = Secrets.generate()
  private val TotpSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
  private val directory = Files.createTempDirectory("service-callers-")
  override def afterAll(): Unit = {
    val paths = Files.walk(directory)
    try paths.iterator.asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)) finally paths.close()
  }
  private def file(name: String, value: String): String = {
    val path = directory.resolve(name)
    Files.writeString(path, value, StandardCharsets.UTF_8)
    path.toString
  }
  private def passwordFile(name: String, password: String): String = file(name, ponygirls.auth.Password.hash(password.toCharArray))
  private lazy val shared = passwordFile("password", Password)
  /** Alice: an administrator with a password and the configured token `laptop`; Bob: a password; CI: an agent with the
    * configured token `default`; Dora: a person whose password is Alice's configured token. */
  private lazy val alice = DeclaredUserConfig("alice", "human", "Alice", Vector(DeclaredTokenConfig("laptop", file("alice.sha", Secrets.digest(AliceToken)))),
    Some("alice"), Some(shared), true, true)
  private lazy val bob = DeclaredUserConfig("bob", "human", "Bob", Vector.empty, Some("bob"), Some(shared), true, false)
  private lazy val ci = DeclaredUserConfig("ci", "agent", "CI", Vector(DeclaredTokenConfig("default", file("ci.sha", Secrets.digest(CiToken)))), None, None, true, false)
  private lazy val dora = DeclaredUserConfig("dora", "human", "Dora", Vector.empty, Some("dora"), Some(passwordFile("dora", AliceToken)), true, false)
  private lazy val everyone = Vector(alice, bob, ci, dora)
  private val EveToken = Secrets.generate()
  /** A canonical secret Erin chooses as her password before a configuration declares it as a token's. */
  private val ErinSecret = Secrets.generate()
  /** Eve: disabled, with a configured token whose digest stays configured; Fay: a person whose password is Eve's token. */
  private lazy val eve = DeclaredUserConfig("eve", "human", "Eve", Vector(DeclaredTokenConfig("old", file("eve.sha", Secrets.digest(EveToken)))), None, None, false, false)
  private lazy val fay = DeclaredUserConfig("fay", "human", "Fay", Vector.empty, Some("fay"), Some(passwordFile("fay", EveToken)), true, false)
  private lazy val erinToken = DeclaredTokenConfig("rotation", file("erin.sha", Secrets.digest(ErinSecret)))
  private def configuration(users: Vector[DeclaredUserConfig], reinstated: Set[String] = Set.empty): ChatSnapshot = {
    val declared = DeclaredUsers.load(users, DeclaredIdRules.Blabber, DigestRead.Snapshot, DigestReader.Stream).fold(r => fail(s"refused: $r"), identity)
    ChatSnapshot(declared.users, declared.directory, None, declared.tokens, reinstated)
  }
  private lazy val imperative = ImperativeSettings("chat", true, false, false, 10, Duration.ofHours(24), "Chat", Set.empty,
    TotpVault.load(Path.of(file("totp.key", Secrets.generate())), "chat"))
  private def switchedOn(s: ChatSnapshot): ChatSnapshot = s.copy(imperative = Some(imperative))

  /** The consumer's failure codes, as Blabber's `Failure`: a code and, for an actor of another account, a reason. */
  private def code(error: Throwable): String = error match {
    case CallerRefused(CallerRefusal.CredentialKindNotServed) => "forbidden"
    case CallerRefused(CallerRefusal.ActorRequired) => "invalid"
    case CallerRefused(CallerRefusal.ActorMismatch) => "conflict"
    case NotAdministrator => "forbidden"
    case AccountFailure(code) => AccountJson.code(code)
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
  private def json(status: Status, value: Json): Response[IO] =
    Response[IO](status).withEntity(value.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"), "application/json"))
  private case object NotAdministrator extends RuntimeException("not an administrator")

  /** The consumer's own routes. Each admits its caller before the body, reads the body, checks the caller again and
    * renews a browser session's cookie on the answer, which names the caller. */
  private final class Chat(callers: ServiceCallers[ChatSnapshot, Identified], pause: AtomicReference[IO[Unit]]) {
    private val Whoami = CallerRoute(CredentialAccept.BearerOrCookie, RouteCredential.Either, mutate = false, ActorRule.NotRequired)
    private val AgentWrite = CallerRoute(CredentialAccept.BearerOrCookie, RouteCredential.Bearer, mutate = true, ActorRule.Required)
    private val PersonWrite = CallerRoute(CredentialAccept.BearerOrCookie, RouteCredential.BrowserSession, mutate = true, ActorRule.Required)
    private val AnyWrite = CallerRoute(CredentialAccept.BearerOrCookie, RouteCredential.Either, mutate = true, ActorRule.Required)
    private def answer(caller: Identified): Response[IO] = json(Status.Ok, Json.obj(
      "userId" -> Json.fromString(caller.captured.authority.userId), "userType" -> Json.fromString(caller.captured.authority.userType),
      "displayName" -> Json.fromString(caller.displayName), "tokenId" -> Json.fromString(caller.captured.authority.tokenId),
      "browser" -> Json.fromBoolean(caller.captured.presented.cookie), "administrator" -> Json.fromBoolean(caller.administrator)))
    private def handled(operation: IO[Response[IO]]): IO[Response[IO]] = operation.handleError { error =>
      val failure = code(error)
      val reason = error match {
        case CallerRefused(CallerRefusal.ActorMismatch) => Json.fromString("actor-mismatch")
        case _ => Json.Null
      }
      json(status(failure), Json.obj("error" -> Json.obj("code" -> Json.fromString(failure), "reason" -> reason)))
    }
    /** Admitted, then the body, then `waited` (which checks again after any wait of its own), then checked once more. */
    private def call(r: Request[IO], route: CallerRoute)(waited: Captured => IO[Unit])(render: Identified => Response[IO]): IO[Response[IO]] =
      handled(callers.admit(r, route).flatMap { admitted =>
        r.body.compile.drain *> callers.recheck(r, route, admitted.captured) *> waited(admitted.captured) *>
          callers.recheck(r, route, admitted.captured).map(current => callers.renewed(render(current), current.captured))
      })
    private def noWait(captured: Captured): IO[Unit] = IO.unit
    val routes: PartialFunction[Request[IO], IO[Response[IO]]] = {
      case r @ GET -> Root / "api" / "v1" / "whoami" => call(r, Whoami)(noWait)(answer)
      case r @ POST -> Root / "api" / "v1" / "attach" => call(r, AgentWrite)(noWait)(answer)
      case r @ POST -> Root / "api" / "v1" / "say" => call(r, PersonWrite)(noWait)(answer)
      case r @ POST -> Root / "api" / "v1" / "rooms" => call(r, AnyWrite)(noWait)(answer)
      case r @ POST -> Root / "api" / "v1" / "archive" => call(r, PersonWrite)(noWait)(caller => if (caller.administrator) answer(caller) else throw NotAdministrator)
      case r @ POST -> Root / "api" / "v1" / "pull" => call(r, AnyWrite)(_ => pause.get)(answer)
    }
  }

  /** What the account service told the consumer. */
  private enum Told {
    case Ended(credentialId: String)
    case Changed(accountId: String)
  }
  /** The store the service uses, with two probes: an effect run once before the next transaction starts (`gate`), and a
    * failure before the commit of the next transaction that changes sessions or tokens (`failMutation`). */
  private final class Probe(underlying: AccountStorage) extends AccountStorage {
    val gate = new AtomicReference[Option[IO[Unit]]](None)
    val failMutation = new AtomicBoolean(false)
    def transaction[A](work: AccountStore => A): IO[A] = IO.defer(gate.getAndSet(None).getOrElse(IO.unit)) *> underlying.transaction { store =>
      val recording = new Recording(store)
      val result = work(recording)
      if (recording.mutated && failMutation.getAndSet(false)) throw new IllegalStateException("synthetic failure before commit")
      result
    }
    private final class Recording(store: AccountStore) extends AccountStore {
      var mutated = false
      def directory(settings: Option[ImperativeSettings], declared: DeclaredDirectory): Vector[AccountUser] = store.directory(settings, declared)
      def installDeclared(declared: DeclaredDirectory, users: Vector[AccountUser]): Unit = store.installDeclared(declared, users)
      def activeImperativeUsers(): Int = store.activeImperativeUsers()
      def browser(users: Vector[AccountUser], secret: String): Option[AccountCredential] = store.browser(users, secret)
      def bearer(users: Vector[AccountUser], secret: String): Option[AccountCredential] = store.bearer(users, secret)
      def loginReplacing(users: Vector[AccountUser], login: String, password: String, previous: Option[String]): AccountLogin =
        store.loginReplacing(users, login, password, previous)
      def logout(users: Vector[AccountUser], secret: String): Unit = { mutated = true; store.logout(users, secret) }
      def tokens(owner: String): Vector[AccountToken] = store.tokens(owner)
      def issue(users: Vector[AccountUser], session: AccountCredential, name: String): AccountIssued = store.issue(users, session, name)
      def revoke(users: Vector[AccountUser], session: AccountCredential, id: String): Unit = { mutated = true; store.revoke(users, session, id) }
      def imperative(settings: Option[ImperativeSettings], declared: DeclaredDirectory, directory: () => Vector[AccountUser],
          hasher: PasswordHasher, clock: java.time.Clock): ImperativeAccounts = store.imperative(settings, declared, directory, hasher, clock)
      def indexing(service: IndexingService, policy: IndexingPolicy): IndexingPreferences = store.indexing(service, policy)
    }
  }
  /** The consumer's published configuration: a reload publishes its result, a failure included, and every decision
    * taken under a published failure fails with it (Haystack's reload pattern). */
  private final class Published(initial: ChatSnapshot) {
    val value = new AtomicReference[Either[Throwable, ChatSnapshot]](Right(initial))
    def get: ChatSnapshot = value.get.fold(throw _, identity)
    def set(next: ChatSnapshot): Unit = value.set(Right(next))
  }

  /** One consumer over a backend: its account service, account plane and routes, with a fresh credential runtime. */
  private final class World(val backend: Backend, runtime: ImperativeRuntime, passwords: BearerSecretPasswords, ambiguity: RequestAmbiguity) {
    val snapshot = new Published(configuration(everyone))
    val pause = new AtomicReference[IO[Unit]](IO.unit)
    val ended = new ConcurrentLinkedQueue[String]
    val probe = new Probe(backend.storage)
    private val telling = new ConcurrentLinkedQueue[Told]
    /** What was told since the last call. */
    def told(): Vector[Told] = Iterator.continually(telling.poll()).takeWhile(_ != null).toVector
    private val limiter = new AttemptLimiter(AttemptLimiter.Capacity, FrozenTime.clock)
    private def client(r: Request[IO]): String = r.headers.get(CIString("X-Test-Client")).fold("client-a")(_.head.value)
    val service = new DeclarativeAccountService[ChatSnapshot](probe, () => snapshot.get, runtime, IndexingService.Blabber, Indexing,
      passwords, backend.installation, AccountLifecycle.Observed(id => IO(telling.add(Told.Ended(id))).void, id => IO(telling.add(Told.Changed(id))).void))
    private val plane = new AccountPlane[ChatSnapshot](service, AccountPlaneSettings[ChatSnapshot](
      current = () => snapshot.get, origins = _ => Policy, cookies = Cookies, cookieOrder = SecureAttribute.Last, respond = json, failureCode = code,
      status = status, audit = _ => IO.unit, endSession = secret => IO(ended.add(secret)).void, clientAddress = client, admitted = _ => (),
      delivered = (response, _) => response, bodyTimeout = 30.seconds, retryAfterOn503 = true,
      loginAdmission = LoginAdmission.Guarded(r => IO(limiter.request(client(r), CredentialEndpoint.Login)).flatMap {
        case None => IO.unit
        case Some(_) => IO.raiseError(AccountFailure("rate-limited"))
      })))
    private val chat = new Chat(new ServiceCallers[ChatSnapshot, Identified](service,
      ServiceCallerSettings(_ => Policy, Cookies, SecureAttribute.Last, ambiguity, CallerReads.WithAdministrator)), pause)
    private val routes = plane.routes.orElse(chat.routes)
    def run(method: Method, path: String, body: Option[String], headers: (String, String)*): (Response[IO], Json) = {
      val plain = Request[IO](method, Uri.unsafeFromString(path))
      val request = body.fold(plain)(plain.withEntity(_)).withHeaders(Headers(headers.map((name, value) => Header.Raw(CIString(name), value))*))
      val response = routes.lift(request).getOrElse(fail(s"no route: $path")).unsafeRunSync()
      val text = response.as[String].unsafeRunSync()
      (response, if (text.isEmpty) Json.Null else io.circe.parser.parse(text).fold(throw _, identity))
    }
    /** One reload: its result is published, the configuration once installed or the failure. */
    def reloading(next: ChatSnapshot): IO[Either[Throwable, ChatSnapshot]] =
      service.reloaded(IO.pure(next)).flatTap(result => IO(snapshot.value.set(result)))
    def reload(next: ChatSnapshot): Either[Throwable, ChatSnapshot] = reloading(next).unsafeRunSync()
    def signIn(login: String, password: String): Response[IO] = signingIn(login, password, None)._1
    def signingIn(login: String, password: String, previous: Option[String]): (Response[IO], Json) =
      run(Method.POST, "/api/account/v1/login", Some(Json.obj("login" -> Json.fromString(login), "password" -> Json.fromString(password)).noSpaces),
        (write ++ previous.map(cookie))*)
    def login(user: String): String = {
      val response = signIn(user, Password)
      assertEquals(response.status, Status.Ok)
      cookieOf(response).getOrElse(fail("session cookie expected"))
    }
    /** A self-signup with imperative accounts on: the new account's session. */
    def signup(user: String, password: String): String = {
      val response = signingUp(user, password)._1
      assertEquals(response.status, Status.Ok)
      cookieOf(response).getOrElse(fail("session cookie expected"))
    }
    def signingUp(user: String, password: String): (Response[IO], Json) = {
      val code = Totp.code(Totp.decodeSecret(TotpSecret).getOrElse(fail("secret")), Totp.stepAt(FrozenTime.Now))
      val body = Json.obj("username" -> Json.fromString(user), "email" -> Json.fromString(s"$user@example.test"), "password" -> Json.fromString(password),
        "totpSecret" -> Json.fromString(TotpSecret), "totpCode" -> Json.fromString(code), "requireTotp" -> Json.False)
      run(Method.POST, "/api/account/v1/signup", Some(body.noSpaces), write*)
    }
    /** A password change of the session's owner. */
    def changingPassword(session: String, user: String, current: String, next: String): (Response[IO], Json) =
      run(Method.POST, "/api/account/v1/profile/password", Some(Json.obj("currentPassword" -> Json.fromString(current), "newPassword" -> Json.fromString(next)).noSpaces),
        (write :+ cookie(session) :+ actor(user))*)
    /** An issued token of the session's owner: its id and secret. */
    def issue(session: String, user: String): (String, String) = {
      val (response, body) = run(Method.POST, "/api/account/v1/tokens", Some("""{"name":"client","scopes":["api"]}"""), (write :+ cookie(session) :+ actor(user))*)
      assertEquals(response.status, Status.Ok)
      (body.hcursor.downField("token").get[String]("id").fold(throw _, identity), body.hcursor.get[String]("secret").fold(throw _, identity))
    }
    def captured(secret: String, browser: Boolean): Captured = service.resolve(_ => Presented(secret, browser, true)).unsafeRunSync()
  }
  private def world(passwords: BearerSecretPasswords = BearerSecretPasswords.Refused, ambiguity: RequestAmbiguity = RequestAmbiguity.OneHostAnyCookie)(
      body: World => Unit): Unit = withBackend { backend =>
    val (runtime, release) = ImperativeRuntime.resource(FrozenTime.clock, PasswordHasher.Pbkdf2).allocated.unsafeRunSync()
    try {
      val w = new World(backend, runtime, passwords, ambiguity)
      w.service.install(w.snapshot.get).unsafeRunSync()
      body(w)
    } finally release.unsafeRunSync()
  }

  private val read: Vector[(String, String)] = Vector("Host" -> Host)
  private val write: Vector[(String, String)] = Vector("Host" -> Host, "Origin" -> Origin, "Content-Type" -> "application/json")
  private def cookie(secret: String): (String, String) = "Cookie" -> ("__Host-chat=" + secret)
  private def bearer(secret: String): (String, String) = "Authorization" -> ("Bearer " + secret)
  private def actor(user: String): (String, String) = AccountPlane.ActorHeader -> AccountJson.actor(user)
  private def setCookie(response: Response[IO]): Option[String] = response.headers.get(CIString("Set-Cookie")).map(_.head.value)
  private def cookieOf(response: Response[IO]): Option[String] = setCookie(response).map(_.takeWhile(_ != ';').dropWhile(_ != '=').drop(1)).filter(_.nonEmpty)
  /** Who a consumer route answered for. */
  private final case class Answer(userId: String, userType: String, displayName: String, tokenId: String, browser: Boolean, administrator: Boolean)
  private def answered(result: (Response[IO], Json)): Answer = {
    val (response, body) = result
    assertEquals(response.status, Status.Ok, body.noSpaces)
    val c = body.hcursor
    def text(name: String): String = c.get[String](name).fold(throw _, identity)
    def flag(name: String): Boolean = c.get[Boolean](name).fold(throw _, identity)
    Answer(text("userId"), text("userType"), text("displayName"), text("tokenId"), flag("browser"), flag("administrator"))
  }
  /** A refusal as status, code and reason. */
  private def refused(result: (Response[IO], Json)): (Int, Option[String], Option[String]) = {
    val error = result._2.hcursor.downField("error")
    (result._1.status.code, error.get[String]("code").toOption, error.get[String]("reason").toOption)
  }
  private val Forbidden = (403, Some("forbidden"), None)
  private val Invalid = (400, Some("invalid"), None)
  private val Unauthorized = (401, Some("unauthorized"), None)

  test("a bearer route serves configured and issued tokens; a browser session there is forbidden, decided before the actor") { world() { w =>
    assertEquals(answered(w.run(Method.POST, "/api/v1/attach", Some("{}"), (write :+ bearer(AliceToken))*)), Answer("alice", "human", "Alice", "laptop", false, false))
    assertEquals(answered(w.run(Method.POST, "/api/v1/attach", Some("{}"), (write :+ bearer(CiToken))*)), Answer("ci", "agent", "CI", "default", false, false))
    val session = w.login("alice")
    val (issuedId, issued) = w.issue(session, "alice")
    assertEquals(answered(w.run(Method.POST, "/api/v1/attach", Some("{}"), (write :+ bearer(issued))*)), Answer("alice", "human", "Alice", issuedId, false, false))
    assertEquals(refused(w.run(Method.POST, "/api/v1/attach", Some("{}"), (write :+ cookie(session) :+ actor("alice"))*)), Forbidden)
    assertEquals(refused(w.run(Method.POST, "/api/v1/attach", Some("{}"), (write :+ cookie(session))*)), Forbidden)
    assertEquals(refused(w.run(Method.POST, "/api/v1/attach", Some("{}"), (write :+ bearer(Secrets.generate()))*)), Unauthorized)
  }}
  test("a browser-session route needs the owner's actor and the same-origin proof; another account's actor is a conflict, actor-mismatch") { world() { w =>
    val session = w.login("alice")
    val (said, body) = w.run(Method.POST, "/api/v1/say", Some("{}"), (write :+ cookie(session) :+ actor("alice"))*)
    val caller = answered((said, body))
    assertEquals(caller.copy(tokenId = ""), Answer("alice", "human", "Alice", "", true, true))
    assert(caller.tokenId.startsWith("session-"), caller.tokenId)
    assert(setCookie(said) == Some(SessionCookie.serialize("__Host-chat", Some(session), true, SecureAttribute.Last)), "the renewed session cookie differs")
    assertEquals(refused(w.run(Method.POST, "/api/v1/say", Some("{}"), (write :+ bearer(AliceToken))*)), Forbidden)
    assertEquals(refused(w.run(Method.POST, "/api/v1/say", Some("{}"), (write :+ cookie(session))*)), Invalid)
    assertEquals(refused(w.run(Method.POST, "/api/v1/say", Some("{}"), (write :+ cookie(session) :+ actor("alice") :+ actor("alice"))*)), Invalid)
    assertEquals(refused(w.run(Method.POST, "/api/v1/say", Some("{}"), (write :+ cookie(session) :+ (AccountPlane.ActorHeader -> "alice"))*)), Invalid)
    assertEquals(refused(w.run(Method.POST, "/api/v1/say", Some("{}"), (write :+ cookie(session) :+ actor("bob"))*)), (409, Some("conflict"), Some("actor-mismatch")))
    assertEquals(refused(w.run(Method.POST, "/api/v1/say", Some("{}"), "Host" -> Host, "Content-Type" -> "application/json", cookie(session), actor("alice"))), Forbidden)
    assertEquals(answered(w.run(Method.POST, "/api/v1/say", Some("{}"), "Host" -> Host, "Content-Type" -> "application/json", "Sec-Fetch-Site" -> "same-origin",
      cookie(session), actor("alice"))).userId, "alice")
  }}
  test("a route for either credential: a bearer needs no actor, a session does; whoami needs none; the administrator flag is a session's only") { world() { w =>
    val alice = w.login("alice")
    val bob = w.login("bob")
    assertEquals(answered(w.run(Method.POST, "/api/v1/rooms", Some("{}"), (write :+ bearer(AliceToken))*)), Answer("alice", "human", "Alice", "laptop", false, false))
    assertEquals(refused(w.run(Method.POST, "/api/v1/rooms", Some("{}"), (write :+ cookie(alice))*)), Invalid)
    assertEquals(answered(w.run(Method.POST, "/api/v1/rooms", Some("{}"), (write :+ cookie(alice) :+ actor("alice"))*)).administrator, true)
    val (whoami, whoamiBody) = w.run(Method.GET, "/api/v1/whoami", None, (read :+ cookie(bob))*)
    assertEquals(answered((whoami, whoamiBody)).copy(tokenId = ""), Answer("bob", "human", "Bob", "", true, false))
    assert(setCookie(whoami) == Some(SessionCookie.serialize("__Host-chat", Some(bob), true, SecureAttribute.Last)), "the renewed session cookie differs")
    assert(setCookie(w.run(Method.GET, "/api/v1/whoami", None, (read :+ bearer(AliceToken))*)._1).isEmpty, "a bearer request got a session cookie")
    assertEquals(refused(w.run(Method.GET, "/api/v1/whoami", None, (read :+ cookie(alice) :+ bearer(AliceToken))*)), Unauthorized)
  }}
  test("an administrator-only route is served to an administrator's browser session alone") { world() { w =>
    val alice = w.login("alice")
    val bob = w.login("bob")
    assertEquals(answered(w.run(Method.POST, "/api/v1/archive", Some("{}"), (write :+ cookie(alice) :+ actor("alice"))*)).administrator, true)
    assertEquals(refused(w.run(Method.POST, "/api/v1/archive", Some("{}"), (write :+ cookie(bob) :+ actor("bob"))*)), Forbidden)
    assertEquals(refused(w.run(Method.POST, "/api/v1/archive", Some("{}"), (write :+ bearer(AliceToken))*)), Forbidden)
  }}
  test("the check after a wait refuses a credential that ended meanwhile and reads the administrator flag again") { world() { w =>
    val first = w.login("alice")
    w.pause.set(w.service.logout(w.captured(first, browser = true), None))
    assertEquals(refused(w.run(Method.POST, "/api/v1/pull", Some("{}"), (write :+ cookie(first) :+ actor("alice"))*)), Unauthorized)
    val second = w.login("alice")
    val demoted = configuration(Vector(alice.copy(admin = false), bob, ci, dora))
    w.pause.set(w.reloading(demoted).map(result => assert(result.isRight)))
    assertEquals(answered(w.run(Method.POST, "/api/v1/pull", Some("{}"), (write :+ cookie(second) :+ actor("alice"))*)).administrator, false)
    val (issuedId, issued) = w.issue(second, "alice")
    w.pause.set(w.service.revoke(w.captured(second, browser = true), issuedId, Vector(AccountJson.actor("alice"))))
    assertEquals(refused(w.run(Method.POST, "/api/v1/pull", Some("{}"), (write :+ bearer(issued))*)), Unauthorized)
  }}
  test("the standing of a captured credential: live with the administrator flag now, empty once it ended") { world() { w =>
    val session = w.login("alice")
    val captured = w.captured(session, browser = true)
    def standing(c: Captured): Option[(String, Boolean)] = w.service.standing(c).unsafeRunSync().map(i => (i.displayName, i.administrator))
    assertEquals(standing(captured), Some(("Alice", true)))
    assertEquals(standing(w.captured(AliceToken, browser = false)), Some(("Alice", false)))
    assert(w.reload(configuration(Vector(alice.copy(admin = false, displayName = "Alice A."), bob, ci, dora))).isRight)
    assertEquals(standing(captured), Some(("Alice A.", false)))
    assertEquals(standing(captured.copy(authority = captured.authority.copy(userId = "bob"))), None)
    w.service.logout(captured, None).unsafeRunSync()
    assertEquals(standing(captured), None)
  }}
  test("an imperative account is an administrator on its browser session once promoted, never on its token, and not while suspended") { world() { w =>
    val on = switchedOn(w.snapshot.get)
    assert(w.reload(on).isRight)
    val carol = w.signup("carol", "synthetic-carol-password")
    assertEquals(answered(w.run(Method.GET, "/api/v1/whoami", None, (read :+ cookie(carol))*)).copy(tokenId = ""), Answer("carol", "human", "carol", "", true, false))
    assertEquals(w.backend.administrator(on.imperative, on.declared, "carol"), false)
    val alice = w.login("alice")
    val promote = Json.obj("admin" -> Json.True, "currentPassword" -> Json.fromString(Password)).noSpaces
    assertEquals(w.run(Method.POST, "/api/account/v1/admin/users/carol/admin", Some(promote), (write :+ cookie(alice) :+ actor("alice"))*)._1.status, Status.Ok)
    assertEquals(answered(w.run(Method.GET, "/api/v1/whoami", None, (read :+ cookie(carol))*)).administrator, true)
    assertEquals(Vector("carol", "alice", "bob", "nobody").map(w.backend.administrator(on.imperative, on.declared, _)), Vector(true, true, false, false))
    assertEquals(w.backend.administrator(None, on.declared, "carol"), false)
    val (_, token) = w.issue(carol, "carol")
    assertEquals(answered(w.run(Method.POST, "/api/v1/rooms", Some("{}"), (write :+ bearer(token))*)).administrator, false)
    w.snapshot.set(on.copy(imperative = None))
    assertEquals(refused(w.run(Method.GET, "/api/v1/whoami", None, (read :+ cookie(carol))*)), Unauthorized)
  }}
  Vector(BearerSecretPasswords.Refused, BearerSecretPasswords.Accepted).foreach { choice =>
    test(s"a password that is the secret of a configured or a live issued token, declared and imperative logins ($choice)") { world(choice) { w =>
      val signsIn = choice == BearerSecretPasswords.Accepted
      def outcome(response: Response[IO]): (Status, Boolean) = (response.status, cookieOf(response).isDefined)
      val expected = if (signsIn) (Status.Ok, true) else (Status.Unauthorized, false)
      assertEquals(outcome(w.signIn("dora", AliceToken)), expected)
      val (_, issued) = w.issue(w.login("alice"), "alice")
      val rotated = configuration(Vector(alice, bob.copy(passwordHashFile = Some(passwordFile("bob-issued", issued))), ci, dora))
      assert(w.reload(rotated).isRight)
      assertEquals(outcome(w.signIn("bob", issued)), expected)
      // A configured digest whose owner is disabled is still a configured secret.
      val retained = configuration(Vector(alice, bob.copy(passwordHashFile = Some(passwordFile("bob-issued", issued))), ci, dora, eve, fay))
      assert(w.reload(retained).isRight)
      assertEquals(outcome(w.signIn("fay", EveToken)), expected)
      assert(w.reload(switchedOn(retained)).isRight)
      assertEquals(outcome(w.signIn("dora", AliceToken)), expected)
      // An imperative password that a later configuration declares as a token's secret.
      w.signup("erin", ErinSecret)
      assert(w.reload(switchedOn(configuration(Vector(alice, bob, ci.copy(tokens = ci.tokens :+ erinToken), dora, eve, fay)))).isRight)
      assertEquals(outcome(w.signIn("erin", ErinSecret)), expected)
      assertEquals(outcome(w.signIn("alice", Password)), (Status.Ok, true))
    }}
  }
  test("a refused bearer secret and a wrong password get the same answer, declared and imperative") { world() { w =>
    def answer(login: String, password: String): (Int, Json, Option[String]) = {
      val (response, body) = w.signingIn(login, password, None)
      (response.status.code, body, setCookie(response))
    }
    assertEquals(answer("dora", AliceToken), answer("dora", "synthetic-wrong-password"))
    assert(w.reload(switchedOn(w.snapshot.get)).isRight)
    assertEquals(answer("dora", AliceToken), answer("dora", "synthetic-wrong-password"))
    w.signup("erin", ErinSecret)
    assert(w.reload(switchedOn(configuration(Vector(alice, bob, ci.copy(tokens = ci.tokens :+ erinToken), dora)))).isRight)
    assertEquals(answer("erin", ErinSecret), answer("erin", "synthetic-wrong-password"))
  }}
  Vector(BearerSecretPasswords.Refused, BearerSecretPasswords.Accepted).foreach { choice =>
    test(s"a bearer secret offered as a new password, at sign-up and at a password change ($choice)") { world(choice) { w =>
      val refuses = choice == BearerSecretPasswords.Refused
      assert(w.reload(switchedOn(w.snapshot.get)).isRight)
      val (signup, signupBody) = w.signingUp("erin", CiToken)
      if (refuses) {
        assertEquals(refused((signup, signupBody)), (400, Some("weak-password"), None))
        assert(setCookie(signup).isEmpty, "a refused sign-up set a cookie")
        assertEquals(w.signIn("erin", CiToken).status, Status.Unauthorized)
      } else assertEquals((signup.status, cookieOf(signup).isDefined), (Status.Ok, true))
      val carol = w.signup("carol", "synthetic-carol-password")
      val other = cookieOf(w.signingIn("carol", "synthetic-carol-password", None)._1).getOrElse(fail("session cookie expected"))
      w.told()
      val (change, changeBody) = w.changingPassword(carol, "carol", "synthetic-carol-password", CiToken)
      if (refuses) {
        assertEquals(refused((change, changeBody)), (400, Some("weak-password"), None))
        assert(setCookie(change).isEmpty, "a refused change set a cookie")
        assertEquals(w.told(), Vector.empty)
        Vector(carol, other).foreach(session => assertEquals(answered(w.run(Method.GET, "/api/v1/whoami", None, (read :+ cookie(session))*)).userId, "carol"))
        assertEquals(w.signIn("carol", "synthetic-carol-password").status, Status.Ok)
      } else {
        assertEquals((change.status, cookieOf(change).isDefined), (Status.Ok, true))
        assertEquals(w.signIn("carol", CiToken).status, Status.Ok)
      }
    }}
  }
  test("the consumer's installation runs in the installing transaction: a refused one is published, and every request is refused") { world() { w =>
    assertEquals(w.backend.recorded(), Map("alice" -> false, "bob" -> false, "ci" -> false, "dora" -> false))
    val session = w.login("alice")
    val (_, issued) = w.issue(session, "alice")
    val withoutBob = configuration(Vector(alice, ci, dora))
    assert(w.reload(withoutBob).isRight)
    assertEquals(w.backend.recorded()("bob"), true)
    assertEquals(w.signIn("bob", Password).status, Status.Unauthorized)
    val returning = configuration(Vector(alice.copy(enabled = false, admin = false), bob, ci, dora))
    assertEquals(w.reload(returning).left.toOption, Some(DeclaredIdBinding.Refused(Vector("bob"))))
    assertEquals(w.snapshot.value.get.left.toOption, Some(DeclaredIdBinding.Refused(Vector("bob"))))
    assertEquals(w.backend.recorded()("bob"), true)
    val Unavailable = (503, Some("unavailable"), None)
    assertEquals(refused(w.run(Method.GET, "/api/v1/whoami", None, (read :+ cookie(session))*)), Unavailable)
    assertEquals(refused(w.run(Method.POST, "/api/v1/rooms", Some("{}"), (write :+ bearer(issued))*)), Unavailable)
    assertEquals(refused(w.run(Method.GET, "/api/account/v1", None, (write :+ cookie(session))*)), Unavailable)
    assertEquals(w.signIn("alice", Password).status, Status.ServiceUnavailable)
  }}
  test("a valid configuration published after a refused one serves again; the refused installation wrote nothing") { world() { w =>
    val session = w.login("alice")
    val (_, issued) = w.issue(session, "alice")
    val withoutBob = configuration(Vector(alice, ci, dora))
    assert(w.reload(withoutBob).isRight)
    // Bob returns in the configuration that would disable Alice: refused, so neither her session nor her token ended.
    assert(w.reload(configuration(Vector(alice.copy(enabled = false, admin = false), bob, ci, dora))).isLeft)
    assert(w.reload(withoutBob).isRight)
    assertEquals(answered(w.run(Method.GET, "/api/v1/whoami", None, (read :+ cookie(session))*)).userId, "alice")
    assertEquals(answered(w.run(Method.POST, "/api/v1/rooms", Some("{}"), (write :+ bearer(issued))*)).userId, "alice")
    // A shared refusal after the consumer's rule would pass: a declared id of an imperative account. Its records stay.
    assert(w.reload(switchedOn(withoutBob)).isRight)
    w.signup("erin", "synthetic-erin-password")
    val erin = DeclaredUserConfig("erin", "human", "Erin", Vector.empty, Some("erin-declared"), Some(shared), true, false)
    assertEquals(w.reload(switchedOn(configuration(Vector(alice, ci, dora, erin), Set("bob")))).left.toOption, Some(AccountFailure("config")))
    assertEquals(w.backend.recorded(), Map("alice" -> false, "bob" -> true, "ci" -> false, "dora" -> false))
    assert(w.reload(configuration(everyone, Set("bob"))).isRight)
    assertEquals(w.backend.recorded()("bob"), false)
    w.login("bob")
  }}
  test("the consumer's indexing preferences are kept under its own service key") { world() { w =>
    val session = w.login("alice")
    assertEquals(w.run(Method.POST, "/api/account/v1/indexing", Some("""{"choice":"disabled"}"""), (write :+ cookie(session) :+ actor("alice"))*)._1.status, Status.Ok)
    val (own, other) = w.backend.storage.transaction(store =>
      (store.indexing(IndexingService.Blabber, Indexing).get("alice"), store.indexing(IndexingService.Haystack, Indexing).get("alice"))).unsafeRunSync()
    assertEquals((own.choice, other), (IndexingChoice.Disable, IndexingPreference.inherited))
    assertEquals(IndexingService.Blabber.key, "blabber")
  }}
  test("the consumer's login guard refuses a client address's eleventh declared login in the window before verifying it") { world() { w =>
    (1 to 10).foreach(attempt => assertEquals(w.signIn("bob", "wrong-password").status, Status.Unauthorized, attempt.toString))
    assertEquals(w.signIn("bob", Password).status, Status.TooManyRequests)
    assertEquals(w.run(Method.POST, "/api/account/v1/login", Some(s"""{"login":"bob","password":"$Password"}"""), (write :+ ("X-Test-Client" -> "client-b"))*)._1.status, Status.Ok)
  }}
  Vector(RequestAmbiguity.FirstHostClassCookie, RequestAmbiguity.OneHostAnyCookie).foreach { ambiguity =>
    test(s"a bearer beside the other class's session cookie and a second Host on the consumer's routes ($ambiguity)") { world(ambiguity = ambiguity) { w =>
      val strict = ambiguity == RequestAmbiguity.OneHostAnyCookie
      val session = w.login("alice")
      val beside = w.run(Method.GET, "/api/v1/whoami", None, (read :+ bearer(AliceToken) :+ ("Cookie" -> ("chat-dev=" + session)))*)
      if (strict) assertEquals(refused(beside), Unauthorized) else assertEquals(answered(beside).tokenId, "laptop")
      val hosts = w.run(Method.GET, "/api/v1/whoami", None, "Host" -> Host, "Host" -> "other.test", bearer(AliceToken))
      if (strict) assertEquals(refused(hosts), Forbidden) else assertEquals(answered(hosts).tokenId, "laptop")
      assertEquals(refused(w.run(Method.GET, "/api/v1/whoami", None, (read :+ bearer(AliceToken) :+ cookie(session))*)), Unauthorized)
    }}
  }
  test("a caller is judged against the configuration current when its lookup runs: a demotion published while it waited decides") { world() { w =>
    val session = w.login("alice")
    val captured = w.captured(session, browser = true)
    val demoted = configuration(Vector(alice.copy(admin = false), bob, ci, dora))
    w.probe.gate.set(Some(w.reloading(demoted).map(result => assert(result.isRight))))
    assertEquals(w.service.identify(_ => captured.presented).unsafeRunSync().administrator, false)
    w.probe.gate.set(Some(w.reloading(configuration(everyone)).map(result => assert(result.isRight))))
    assertEquals(w.service.standing(captured).unsafeRunSync().map(_.administrator), Some(true))
    w.probe.gate.set(Some(w.reloading(demoted).map(result => assert(result.isRight))))
    assertEquals(w.service.standing(captured).unsafeRunSync().map(_.administrator), Some(false))
  }}
  test("a sign-out, a replacing sign-in and a token revocation tell the credential's id after their commit") { world() { w =>
    val first = w.login("alice")
    val firstId = w.captured(first, browser = true).authority.tokenId
    val second = cookieOf(w.signingIn("alice", Password, Some(first))._1).getOrElse(fail("session cookie expected"))
    assertEquals(w.told(), Vector(Told.Ended(firstId)))
    val secondId = w.captured(second, browser = true).authority.tokenId
    val (tokenId, _) = w.issue(second, "alice")
    assertEquals(w.run(Method.POST, s"/api/account/v1/tokens/$tokenId/revoke", Some("{}"), (write :+ cookie(second) :+ actor("alice"))*)._1.status, Status.Ok)
    assertEquals(w.run(Method.POST, "/api/account/v1/logout", Some("{}"), (write :+ cookie(second) :+ actor("alice"))*)._1.status, Status.Ok)
    assertEquals(w.told(), Vector(Told.Ended(tokenId), Told.Ended(secondId)))
    assert(!firstId.contains(first) && !secondId.contains(second), "a credential id carries its secret")
  }}
  test("nothing is told for a sign-out or a revocation that rolled back") { world() { w =>
    val session = w.login("alice")
    val (tokenId, token) = w.issue(session, "alice")
    w.told()
    val Unavailable = (503, Some("unavailable"), None)
    w.probe.failMutation.set(true)
    assertEquals(refused(w.run(Method.POST, "/api/account/v1/logout", Some("{}"), (write :+ cookie(session) :+ actor("alice"))*)), Unavailable)
    w.probe.failMutation.set(true)
    assertEquals(refused(w.run(Method.POST, s"/api/account/v1/tokens/$tokenId/revoke", Some("{}"), (write :+ cookie(session) :+ actor("alice"))*)), Unavailable)
    assertEquals(w.told(), Vector.empty)
    assertEquals(answered(w.run(Method.GET, "/api/v1/whoami", None, (read :+ cookie(session))*)).userId, "alice")
    assertEquals(answered(w.run(Method.POST, "/api/v1/rooms", Some("{}"), (write :+ bearer(token))*)).tokenId, tokenId)
  }}
  test("dispatcher changes tell the account, a replaced session its id, and the master switch going off every active imperative account") { world() { w =>
    assert(w.reload(switchedOn(w.snapshot.get)).isRight)
    val carol = w.signup("carol", "synthetic-carol-password")
    val alice = w.login("alice")
    assertEquals(w.told(), Vector.empty)
    val promote = Json.obj("admin" -> Json.True, "currentPassword" -> Json.fromString(Password)).noSpaces
    assertEquals(w.run(Method.POST, "/api/account/v1/admin/users/carol/admin", Some(promote), (write :+ cookie(alice) :+ actor("alice"))*)._1.status, Status.Ok)
    assertEquals(w.told(), Vector(Told.Changed("carol")))
    val carolId = w.captured(carol, browser = true).authority.tokenId
    val again = cookieOf(w.signingIn("carol", "synthetic-carol-password", Some(carol))._1).getOrElse(fail("session cookie expected"))
    assertEquals(w.told(), Vector(Told.Ended(carolId)))
    val againId = w.captured(again, browser = true).authority.tokenId
    assertEquals(w.changingPassword(again, "carol", "synthetic-carol-password", "synthetic-carol-password-2")._1.status, Status.Ok)
    assertEquals(w.told(), Vector(Told.Ended(againId), Told.Changed("carol")))
    assertEquals(w.run(Method.POST, "/api/account/v1/admin/users/carol/enabled", Some("""{"enabled":false}"""), (write :+ cookie(alice) :+ actor("alice"))*)._1.status,
      Status.Ok)
    assertEquals(w.told(), Vector(Told.Changed("carol")))
    w.signup("erin", "synthetic-erin-password")
    assert(w.reload(w.snapshot.get.copy(imperative = None)).isRight)
    assertEquals(w.told(), Vector(Told.Changed("erin")))
  }}
  test("a reload tells the declared accounts it changed or removed; a refused one tells nothing") { world() { w =>
    assert(w.reload(configuration(Vector(alice.copy(admin = false), ci, dora))).isRight)
    assertEquals(w.told(), Vector(Told.Changed("alice"), Told.Changed("bob")))
    assert(w.reload(configuration(everyone)).isLeft)
    assertEquals(w.told(), Vector.empty)
    assert(w.reload(configuration(Vector(alice.copy(admin = false), bob, ci, dora), Set("bob"))).isRight)
    assertEquals(w.told(), Vector(Told.Changed("bob")))
  }}
}

/** BA: the types stage 3 added print no credential. */
final class ServiceCallersTypesSuite extends munit.FunSuite {
  test("an identified caller and the callers' refusals never print a secret or its digest") {
    val secret = Secrets.generate()
    val identified = Identified(Captured(Authority("alice", "human", "session-1"), Presented(secret, true, true)), "Alice", true)
    Vector("Identified" -> identified.toString).++(CallerRefusal.values.toVector.map(refusal => refusal.toString -> CallerRefused(refusal).getMessage)).foreach {
      (label, text) => Vector("secret" -> secret, "digest" -> Secrets.digest(secret)).foreach((kind, value) => assert(!text.contains(value), s"$label prints the $kind"))
    }
  }
}
