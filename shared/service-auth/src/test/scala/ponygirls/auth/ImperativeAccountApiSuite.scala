package ponygirls.auth

import cats.effect.{Deferred, IO}
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.nio.file.Files
import java.time.{Clock, Duration, Instant, ZoneId, ZoneOffset}
import ponygirls.runtime.AdmissionConfig
import scala.concurrent.duration.*

/** The dispatcher over the in-memory imperative store and the shared session store, with an injected clock. */
final class ImperativeAccountApiSuite extends munit.FunSuite {
  import AccountEndpoint as E

  private val password = "synthetic account password"
  private val newPassword = "synthetic replacement password"
  private val wrongPassword = "synthetic wrong password"
  private val secretText = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  private val start = Instant.parse("2026-01-01T00:00:00Z")
  private val keyDirectory = Files.createTempDirectory("imperative-api-")
  private lazy val vault = {
    val file = keyDirectory.resolve("key")
    Files.writeString(file, Secrets.generate())
    TotpVault.load(file, "api")
  }
  private lazy val (sharedGate, closeGate) = CredentialGate.resource.allocated.unsafeRunSync()
  override def afterAll(): Unit = {
    closeGate.unsafeRunSync()
    Files.list(keyDirectory).forEach(Files.delete(_))
    Files.delete(keyDirectory)
  }

  private final class MovableClock(var now: Instant) extends Clock {
    def getZone: ZoneId = ZoneOffset.UTC
    override def withZone(zone: ZoneId): Clock = this
    def instant(): Instant = now
    def advance(by: Duration): Unit = now = now.plus(by)
  }

  private final class Sessions(shared: Accounts, rows: AccountRepository, directory: () => Vector[AccountUser]) extends AccountSessions {
    def lockOwners(declarative: Vector[String], imperative: Vector[String]): Unit = shared.lockOwners(declarative, imperative)
    def sessionOwner(secret: String): Option[String] = Some(secret).filter(Secrets.canonical).flatMap(value => rows.session(Secrets.digest(value))).map(_.owner)
    def live(session: AccountCredential): Boolean = shared.live(directory(), session.userId, session.tokenId, session.digest)
    def establish(user: AccountUser, replaced: Option[String]): AccountSession =
      shared.establish(directory().filterNot(_.id == user.id) :+ user, user.id, replaced).session
    def revokeSessions(userId: String, keep: Option[AccountCredential]): Unit = shared.revokeSessions(userId, keep)
    def revokeTokens(userId: String): Unit = shared.revokeTokens(userId)
    def activated(user: AccountUser): Unit = ()
    def updated(user: AccountUser): Unit = ()
  }

  private final class Fixture(gate: CredentialGate) {
    val clock = new MovableClock(start)
    private val users = new MemoryImperativeUsers
    private val rows = new MemoryAccounts
    private val declaredHash = FastPasswordHasher.hash(password.toCharArray)
    val declared: DeclaredDirectory = DeclaredDirectory(Vector(
      AccountUser("root", "human", "Root", Some("root"), Some(declaredHash), true, AccountOrigin.Declarative),
      AccountUser("dora", "human", "Dora", Some("dora"), Some(declaredHash), true, AccountOrigin.Declarative)), Set("root"))
    var settings: Option[ImperativeSettings] =
      Some(ImperativeSettings("api", true, false, true, 100, Duration.ofHours(24), "Api test", Set.empty, vault))
    var transactionCount = 0
    val replies = scala.collection.mutable.ArrayBuffer.empty[AccountReply]
    val api = new ImperativeAccountApi(new AttemptLimiter(AttemptLimiter.Capacity, clock), gate)
    private var addresses = 0
    new Accounts(rows, clock).reconcile(declared.users)

    def transaction[A](work: (ImperativeAccounts, Accounts) => A): A = {
      val (sessions, tokens) = (rows.sessions, rows.allTokens)
      try users.transaction {
        val shared = new Accounts(rows, clock)
        lazy val core: ImperativeAccounts = users.accounts(settings, declared, new Sessions(shared, rows, () => core.directory), _ => false,
          FastPasswordHasher, clock)
        work(core, shared)
      } catch {
        case failure: Throwable =>
          rows.sessions.foreach(row => rows.deleteSession(row.digest))
          sessions.foreach(rows.insertSession)
          rows.allTokens.foreach(row => rows.deleteToken(row.id))
          tokens.foreach(rows.insertToken)
          throw failure
      }
    }
    val transactions: ImperativeTransactions = new ImperativeTransactions {
      def run[A](work: ImperativeAccounts => A): IO[A] = IO {
        transactionCount += 1
        transaction((core, _) => work(core))
      }
    }
    /** The service's declarative path, with the test hasher in place of PBKDF2. */
    val declarative: DeclarativeLogin = (login, secret, previous) => IO(transaction { (core, shared) =>
      val user = declared.users.find(_.login.contains(login)).filter(found => FastPasswordHasher.verify(secret.toCharArray, found.passwordHash.get))
        .getOrElse(throw AccountFailure("unauthorized"))
      SignedIn(user, shared.establish(core.directory, user.id, previous).session)
    })

    /** A fresh client address per request, so that the per-address windows stay out of the way. */
    def address(): String = {
      addresses += 1
      s"192.0.2.$addresses"
    }
    def credential(secret: String): Option[AccountCredential] = transaction((core, shared) => shared.browser(core.directory, secret))
    def live(secret: String): Boolean = credential(secret).nonEmpty
    def send(request: AccountRequest): AccountReply = record(api.handle(settings, declared, transactions, request))
    def record(reply: IO[AccountReply]): AccountReply = {
      val done = reply.unsafeRunSync()
      replies += done
      done
    }
    def anonymous(method: String, path: String, body: Option[Json]): AccountReply =
      send(AccountRequest(method, path, body, Vector.empty, None, None, address()))
    /** A browser request with the session's cookie and, for a POST, its actor binding. */
    def as(secret: String, method: String, path: String, body: Option[Json]): AccountReply = {
      val session = credential(secret)
      val actor = if (method == E.Post) session.map(found => AccountJson.actor(found.userId)).toVector else Vector.empty
      send(AccountRequest(method, path, body, actor, session, Some(secret), address()))
    }
    def login(name: String, secret: String, totp: Option[String], address: String): AccountReply =
      record(api.login(settings.get, declared, transactions, declarative, AccountRequest(E.Post, "/login",
        json(s"""{"login":"$name","password":"$secret"${totp.fold("")(code => s""","totp":"$code"""")}}"""), Vector.empty, None, None, address)))

    def code: String = Totp.code(Totp.decodeSecret(secretText).get, Totp.stepAt(clock.instant()))
    /** Codes are single use per step: move on before the next one. */
    def tick(): Unit = clock.advance(Duration.ofSeconds(Totp.StepSeconds))
    def signup(name: String, requireTotp: Boolean): AccountReply = {
      val reply = anonymous(E.Post, "/signup", json(s"""{"username":"$name","email":"$name@example.test","password":"$password",""" +
        s""""totpSecret":"$secretText","totpCode":"$code","requireTotp":$requireTotp}"""))
      tick()
      reply
    }
    def rootSession: String = transaction((core, shared) => shared.establish(core.directory, "root", None).session.secret)
  }

  private def json(text: String): Option[Json] = Some(AccountJson.parse(text))
  private val empty = json("{}")
  private def withFixture(body: Fixture => Unit): Unit = body(new Fixture(sharedGate))
  private def code(reply: AccountReply): String = reply.body.hcursor.downField("error").get[String]("code").getOrElse(fail(s"no error in $reply"))
  private def assertError(reply: AccountReply, status: Int, expected: String): Unit = assertEquals((reply.status, code(reply)), (status, expected))
  private def secret(reply: AccountReply): String = reply.cookie match {
    case CookieEffect.Set(value) => value
    case CookieEffect.Keep => fail(s"expected a new session in $reply")
  }
  private def kinds(reply: AccountReply): Vector[String] = reply.events.map(_.kind.text)
  private val concrete: Map[AccountEndpoint, String] = AccountEndpoint.values.map(endpoint =>
    endpoint -> endpoint.segments.map(segment => if (segment == AccountEndpoint.Id) "alice" else segment).mkString("/", "/", "")).toMap

  test("routing table: every endpoint by method and path; anything else, and everything with the master switch off, is not-found") {
    AccountEndpoint.values.foreach { endpoint =>
      val expectedId = Option.when(endpoint.segments.contains(AccountEndpoint.Id))("alice")
      assertEquals(ImperativeAccountApi.route(endpoint.method, concrete(endpoint)), Some(AccountRoute(endpoint, expectedId)), endpoint.toString)
    }
    assertEquals(AccountEndpoint.values.map(endpoint => (endpoint.method, endpoint.label)).distinct.length, AccountEndpoint.values.length)
    assertEquals(ImperativeAccountApi.route(E.Post, "/admin/users/enrollment-0f8e/approve").map(_.id), Some(Some("enrollment-0f8e")))
    for ((method, path) <- Vector(E.Get -> "/signup", E.Post -> "/policy", E.Post -> "/login", E.Get -> "", E.Get -> "/", E.Post -> "/tokens",
        E.Get -> "/policy/", E.Post -> "/admin/users//approve", E.Post -> "/admin/users/a b/approve", E.Post -> "/admin/users/alice/delete",
        E.Get -> "policy", "PUT" -> "/profile/email", E.Get -> "/admin/users/alice"))
      assertEquals(ImperativeAccountApi.route(method, path), None, s"$method $path")
    withFixture { fixture =>
      assertError(fixture.anonymous(E.Get, "/unknown", None), 404, "not-found")
      fixture.settings = None
      val root = fixture.rootSession
      AccountEndpoint.values.foreach { endpoint =>
        assertError(fixture.as(root, endpoint.method, concrete(endpoint), Option.when(endpoint.method == E.Post)(Json.obj())), 404, "not-found")
      }
      assertEquals(fixture.transactionCount, 0)
    }
  }

  test("availability: signup and invitation issuance follow their flags; resets and the shared enrollment paths follow the master switch") {
    withFixture { fixture =>
      val alice = secret(fixture.signup("alice", false))
      fixture.settings = fixture.settings.map(_.copy(signup = false, enrollment = false))
      val root = fixture.rootSession
      val before = fixture.transactionCount
      assertError(fixture.signup("bob", false), 404, "not-found")
      assertError(fixture.as(root, E.Post, "/admin/enrollments", json("""{"username":"carol"}""")), 404, "not-found")
      assertEquals(fixture.transactionCount, before)
      val reset = fixture.as(root, E.Post, "/admin/users/alice/reset", json(s"""{"currentPassword":"$password"}"""))
      assertEquals(reset.status, 200)
      val resetCode = reset.body.hcursor.get[String]("code").toOption.get
      assertEquals(fixture.anonymous(E.Post, "/enrollments/inspect", json(s"""{"code":"$resetCode"}""")).body.hcursor.get[String]("kind"), Right("reset"))
      assertEquals(fixture.as(root, E.Get, "/admin/enrollments", None).body.hcursor.downField("enrollments").downArray.get[String]("kind"), Right("reset"))
      assertEquals(fixture.as(alice, E.Get, "/policy", None).body.hcursor.get[Boolean]("reset"), Right(true))
    }
  }

  test("strict decoding: unknown members, wrong types, oversized values and unexpected or missing bodies are invalid") {
    withFixture { fixture =>
      val valid = s""""username":"alice","email":"alice@example.test","password":"$password","totpSecret":"$secretText","totpCode":"000000""""
      val longEmail = "a" * (ImperativePolicy.EmailMaximumLength - "@example.test".length + 1) + "@example.test"
      for (body <- Vector(s"""{$valid,"requireTotp":false,"admin":true}""", s"""{$valid,"requireTotp":"false"}""", s"""{$valid}""",
          s"""{$valid,"requireTotp":false}""".replace("alice@example.test", longEmail), "[]"))
        assertError(fixture.anonymous(E.Post, "/signup", json(body)), 400, "invalid")
      assertError(fixture.anonymous(E.Post, "/recover", None), 400, "invalid")
      assertError(fixture.anonymous(E.Get, "/policy", empty), 400, "invalid")
      assertError(fixture.anonymous(E.Post, "/enrollments/inspect", json("""{"code":7}""")), 400, "invalid")
      assertError(fixture.login("alice", password, Some("1234567"), fixture.address()), 400, "invalid")
      assertEquals(fixture.transactionCount, 0)
    }
  }

  test("the five existing endpoints keep byte-identical shapes and error codes") {
    val user = AccountUser("ops", "human", "Operations", Some("dora"), None, true, AccountOrigin.Declarative)
    val actor = AccountJson.actor("ops")
    val token = AccountToken("issued-1", "CLI", "issued", Some("2026-01-01T00:00:00Z"), false, Vector("api"))
    assertEquals(AccountJson.user(user).noSpaces, s"""{"id":"ops","login":"dora","displayName":"Operations","actor":"$actor"}""")
    assertEquals(AccountJson.account(user, Vector(token, token.copy(id = "configured", source = "configured", createdAt = None, revoked = true)), Vector("api")).noSpaces,
      s"""{"user":{"id":"ops","login":"dora","displayName":"Operations","actor":"$actor"},"tokens":[""" +
        """{"id":"issued-1","name":"CLI","source":"issued","createdAt":"2026-01-01T00:00:00Z","revoked":false,"scopes":["api"]},""" +
        """{"id":"configured","name":"CLI","source":"configured","createdAt":null,"revoked":true,"scopes":["api"]}],"scopes":["api"]}""")
    assertEquals(AccountJson.issued(AccountIssued(token, "secret-text")).noSpaces,
      """{"token":{"id":"issued-1","name":"CLI","source":"issued","createdAt":"2026-01-01T00:00:00Z","revoked":false,"scopes":["api"]},"secret":"secret-text"}""")
    for (code <- Vector("invalid", "unauthorized", "forbidden", "not-found", "conflict", "rate-limited", "too-large", "unavailable"))
      assertEquals(AccountJson.failure(code).noSpaces, s"""{"error":{"code":"$code","message":"${code.replace('-', ' ')}"}}""")
    assertEquals(AccountJson.failure("SELECT secret").noSpaces, """{"error":{"code":"unavailable","message":"unavailable"}}""")
    assertEquals(AccountJson.decodeLogin(json("""{"login":"dora","password":"pw"}""").get), ("dora", "pw"))
    assertEquals(intercept[AccountFailure](AccountJson.decodeLogin(json("""{"login":"dora","password":"pw","totp":"123456"}""").get)).code, "invalid")
  }

  test("policy and profile have the members the web client validates, including reset") {
    withFixture { fixture =>
      val alice = secret(fixture.signup("alice", true))
      assertEquals(fixture.anonymous(E.Get, "/policy", None).body.noSpaces,
        """{"signup":true,"approval":false,"enrollment":true,"reset":true,"issuer":"Api test","username":{"pattern":"^[a-z][a-z0-9_-]{2,31}$"},""" +
          """"password":{"minLength":12,"maxLength":1024},"totp":{"algorithm":"SHA1","digits":6,"period":30,"secretBytes":20}}""")
      assertEquals(fixture.as(alice, E.Get, "/profile", None).body.noSpaces,
        s"""{"user":{"id":"alice","login":"alice","displayName":"alice","actor":"${AccountJson.actor("alice")}"},"source":"imperative",""" +
          """"admin":false,"email":"alice@example.test","totp":{"required":true,"state":"ok"},""" +
          """"manage":{"email":true,"password":true,"totp":true,"users":false,"enrollment":false,"reset":false}}""")
      fixture.settings = fixture.settings.map(_.copy(enrollment = false))
      assertEquals(fixture.as(fixture.rootSession, E.Get, "/profile", None).body.noSpaces,
        s"""{"user":{"id":"root","login":"root","displayName":"Root","actor":"${AccountJson.actor("root")}"},"source":"declarative",""" +
          """"admin":true,"email":null,"totp":{"required":false,"state":"none"},""" +
          """"manage":{"email":false,"password":false,"totp":false,"users":true,"enrollment":false,"reset":true}}""")
    }
  }

  test("login: totp-required, pending-approval, then rate-limited with Retry-After and a lock event; declared logins keep their path") {
    withFixture { fixture =>
      fixture.signup("alice", true)
      assertError(fixture.login("alice", password, None, fixture.address()), 401, "totp-required")
      val signedIn = fixture.login("Alice", password, Some(fixture.code), fixture.address())
      assertEquals((signedIn.status, signedIn.body.hcursor.downField("user").get[String]("id")), (200, Right("alice")))
      assert(fixture.live(secret(signedIn)))
      val failures = (1 to 10).map(_ => fixture.login("alice", wrongPassword, None, fixture.address()))
      assert(failures.forall(reply => reply.status == 401 && code(reply) == "unauthorized"))
      assertEquals(failures.last.events.map(_.fields), Vector(Vector("event" -> "account.locked", "target" -> "alice", "outcome" -> "password",
        "clientAddress" -> failures.last.events.head.clientAddress)))
      val locked = fixture.login("alice", password, None, fixture.address())
      assertError(locked, 429, "rate-limited")
      assertEquals(locked.retryAfterSeconds, Some(60L))

      fixture.settings = fixture.settings.map(_.copy(requireApproval = true))
      fixture.signup("bob", false)
      assertError(fixture.login("bob", wrongPassword, None, fixture.address()), 401, "unauthorized")
      assertError(fixture.login("bob", password, None, fixture.address()), 403, "pending-approval")
      assertError(fixture.login("nobody", password, None, fixture.address()), 401, "unauthorized")

      val before = fixture.transactionCount
      val declared = fixture.login("root", password, Some("123456"), fixture.address())
      assertEquals((declared.status, fixture.transactionCount), (200, before))
      assert(fixture.live(secret(declared)))
      assertError(fixture.login("root", wrongPassword, None, fixture.address()), 401, "unauthorized")
      val address = fixture.address()
      (1 to AttemptLimiter.RequestsPerAddress).foreach(_ => fixture.login("nobody", wrongPassword, None, address))
      assertError(fixture.login("root", password, None, address), 429, "rate-limited")
    }
  }

  test("signup answers 202 without a cookie in approval mode and 200 with a session otherwise") {
    withFixture { fixture =>
      val active = fixture.signup("alice", false)
      assertEquals((active.status, active.body.hcursor.get[String]("status")), (200, Right("active")))
      assertEquals(active.body.hcursor.downField("user").get[String]("id"), Right("alice"))
      assert(fixture.live(secret(active)))
      fixture.settings = fixture.settings.map(_.copy(requireApproval = true))
      val pending = fixture.signup("bob", false)
      assertEquals((pending.status, pending.body.noSpaces, pending.cookie), (202, """{"status":"pending"}""", CookieEffect.Keep))
      assertEquals(pending.events.map(event => (event.kind, event.target, event.outcome)),
        Vector((AccountEventKind.Signup, Some("bob"), Some("pending"))))
      assertError(fixture.signup("bob", false), 409, "username-unavailable")
    }
  }

  test("redeem, recover and password change replace the session cookie; audit events carry only allowlisted fields and no secrets") {
    withFixture { fixture =>
      val root = fixture.rootSession
      val issued = fixture.as(root, E.Post, "/admin/enrollments", json("""{"username":"carol"}"""))
      val invitation = issued.body.hcursor.get[String]("code").toOption.get
      assertEquals(issued.body.hcursor.downField("enrollment").get[String]("kind"), Right("invite"))
      assertEquals(fixture.anonymous(E.Post, "/enrollments/inspect", json(s"""{"code":"$invitation"}""")).body.hcursor.get[String]("username"), Right("carol"))
      val redeemed = fixture.anonymous(E.Post, "/enrollments/redeem", json(s"""{"code":"$invitation","email":"carol@example.test",""" +
        s""""password":"$password","totpSecret":"$secretText","totpCode":"${fixture.code}","requireTotp":false}"""))
      assertEquals((redeemed.status, kinds(redeemed)), (200, Vector("account.enrollment.redeemed")))
      val first = secret(redeemed)
      fixture.tick()
      val recovered = fixture.anonymous(E.Post, "/recover", json(s"""{"username":"carol","totp":"${fixture.code}","password":"$newPassword"}"""))
      assertEquals((recovered.status, kinds(recovered)), (200, Vector("account.recovery.succeeded")))
      val second = secret(recovered)
      assert(!fixture.live(first) && fixture.live(second))
      val changed = fixture.as(second, E.Post, "/profile/password", json(s"""{"currentPassword":"$newPassword","newPassword":"$password"}"""))
      assertEquals((changed.status, changed.body.noSpaces, kinds(changed)), (200, """{"ok":true}""", Vector("account.password.changed")))
      assert(!fixture.live(second) && fixture.live(secret(changed)))
      val email = fixture.as(secret(changed), E.Post, "/profile/email", json("""{"email":"carol@elsewhere.test"}"""))
      assertEquals((email.cookie, kinds(email)), (CookieEffect.Keep, Vector("account.email.changed")))
      val rejected = fixture.anonymous(E.Post, "/recover", json(s"""{"username":"carol","totp":"000000","password":"$newPassword"}"""))
      assertEquals((rejected.status, kinds(rejected)), (401, Vector("account.recovery.rejected")))

      val events = fixture.replies.flatMap(_.events).toVector
      assert(events.size >= 5, events)
      val secrets = Vector(password, newPassword, invitation, secretText, "carol@example.test", "carol@elsewhere.test", first, second, root)
      events.foreach { event =>
        assert(event.fields.map(_._1).forall(AccountEvent.Allowlist.contains), event)
        assert(!event.fields.exists { case (_, value) => secrets.exists(value.contains) }, event)
      }
    }
  }

  test("authenticated mutations require a browser session and exactly one actor header naming its owner") {
    withFixture { fixture =>
      val alice = secret(fixture.signup("alice", false))
      val session = fixture.credential(alice)
      def change(actor: Vector[String], session: Option[AccountCredential]): AccountReply =
        fixture.send(AccountRequest(E.Post, "/profile/email", json("""{"email":"a@example.test"}"""), actor, session, Some(alice), fixture.address()))
      assertError(change(Vector(AccountJson.actor("alice")), None), 401, "unauthorized")
      assertError(change(Vector.empty, session), 400, "invalid")
      assertError(change(Vector.fill(2)(AccountJson.actor("alice")), session), 400, "invalid")
      assertError(change(Vector(AccountJson.actor("root")), session), 409, "conflict")
      assertEquals(change(Vector(AccountJson.actor("alice")), session).status, 200)
      assertEquals(fixture.send(AccountRequest(E.Get, "/profile", None, Vector.empty, session, Some(alice), fixture.address())).status, 200)
      assertError(fixture.as(alice, E.Get, "/admin/users", None), 403, "forbidden")
    }
  }

  test("failed admin proofs of a declarative admin are answered proof-rejected, then bounded in memory") {
    withFixture { fixture =>
      fixture.signup("alice", false)
      val root = fixture.rootSession
      (1 to AttemptLimiter.ProofFailuresPerActor).foreach { _ =>
        val refused = fixture.as(root, E.Post, "/admin/users/alice/admin", json(s"""{"admin":true,"currentPassword":"$wrongPassword"}"""))
        assertError(refused, 403, "proof-rejected")
        assertEquals(refused.events.map(event => (event.kind, event.actor, event.target)), Vector((AccountEventKind.ProofRejected, Some("root"), Some("alice"))))
      }
      val blocked = fixture.as(root, E.Post, "/admin/users/alice/admin", json(s"""{"admin":true,"currentPassword":"$password"}"""))
      assertEquals((blocked.status, blocked.retryAfterSeconds), (429, Some(AttemptLimiter.ProofWindow.getSeconds)))
      fixture.clock.advance(AttemptLimiter.ProofWindow)
      val granted = fixture.as(root, E.Post, "/admin/users/alice/admin", json(s"""{"admin":true,"currentPassword":"$password"}"""))
      assertEquals((granted.status, kinds(granted)), (200, Vector("account.admin.granted")))
    }
  }

  test("a saturated credential gate answers 503 with Retry-After") {
    val (gate, close) = CredentialGate.resource(AdmissionConfig(1, 0, 1.second)).allocated.unsafeRunSync()
    try {
      val fixture = new Fixture(gate)
      val (entered, release) = (Deferred.unsafe[IO, Unit], Deferred.unsafe[IO, Unit])
      val held: ImperativeTransactions = new ImperativeTransactions {
        def run[A](work: ImperativeAccounts => A): IO[A] = entered.complete(()) *> release.get *> fixture.transactions.run(work)
      }
      def attempt(transactions: ImperativeTransactions): IO[AccountReply] = fixture.api.login(fixture.settings.get, fixture.declared, transactions,
        fixture.declarative, AccountRequest(E.Post, "/login", json(s"""{"login":"nobody","password":"$password"}"""), Vector.empty, None, None, fixture.address()))
      val (admitted, refused) = IO.both(attempt(held), entered.get *> attempt(fixture.transactions) <* release.complete(())).unsafeRunSync()
      assertError(refused, 503, "unavailable")
      assertEquals(refused.retryAfterSeconds, Some(ImperativeAccountApi.UnavailableRetryAfterSeconds))
      assertError(admitted, 401, "unauthorized")
    } finally close.unsafeRunSync()
  }
}
