package ponygirls.auth

import java.nio.file.Files
import java.time.{Clock, Duration, Instant, ZoneId, ZoneOffset}
import java.time.temporal.ChronoUnit
import scala.collection.mutable
import scala.util.Try

/** One transaction per call: committed when `work` returns, rolled back when it throws. */
private[auth] trait ImperativeBackend {
  def transaction[A](work: (ImperativeUserRepository, AccountRepository) => A): A
}

/** The behaviour of imperative accounts, specified once against the user store and the service ports.
  * Sessions and tokens are the shared `Accounts` over the backend's account store, so liveness is the real rule.
  */
abstract class ImperativeAccountContract extends munit.FunSuite {
  import AccountOutcome.{Completed, Rejected}
  import AccountRejection.*

  /** Starts from empty stores. */
  protected def withBackend(body: ImperativeBackend => Unit): Unit

  private val password = "synthetic account password"
  private val newPassword = "synthetic replacement password"
  private val wrongPassword = "synthetic wrong password"
  private val secretText = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  private val otherSecretText = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  private val start = Instant.parse("2026-01-01T00:00:00Z")
  private val keyDirectory = Files.createTempDirectory("imperative-contract-")
  private def vault(name: String): TotpVault = {
    val file = keyDirectory.resolve(name)
    Files.writeString(file, Secrets.generate())
    TotpVault.load(file, "contract")
  }
  private lazy val primaryVault = vault("key")
  private lazy val otherVault = vault("other-key")
  override def afterAll(): Unit = {
    Files.list(keyDirectory).forEach(Files.delete(_))
    Files.delete(keyDirectory)
  }

  private final class MovableClock(var now: Instant) extends Clock {
    def getZone: ZoneId = ZoneOffset.UTC
    override def withZone(zone: ZoneId): Clock = this
    def instant(): Instant = now
    def advance(by: Duration): Unit = now = now.plus(by)
  }

  /** `AccountSessions` over the shared session store. It also enforces the port protocol of design D22:
    * owner locks are taken in one call, and no owner is touched without its lock.
    */
  private final class SharedSessions(shared: Accounts, rows: AccountRepository, directory: () => Vector[AccountUser], world: World) extends AccountSessions {
    private var locked = Option.empty[Set[String]]
    private def holding(owner: String): Unit = assert(locked.exists(_(owner)), s"owner $owner is used without its lock")
    def lockOwners(declarative: Vector[String], imperative: Vector[String]): Unit = {
      assert(locked.isEmpty, "owner locks are acquired in one call")
      shared.lockOwners(declarative, imperative)
      locked = Some((declarative ++ imperative).toSet)
    }
    def sessionOwner(secret: String): Option[String] = Some(secret).filter(Secrets.canonical).flatMap(value => rows.session(Secrets.digest(value))).map(_.owner)
    def live(session: AccountCredential): Boolean = {
      holding(session.userId)
      shared.live(directory(), session.userId, session.tokenId, session.digest)
    }
    def establish(user: AccountUser, replaced: Option[String]): AccountSession = {
      (Vector(user.id) ++ replaced.flatMap(sessionOwner)).foreach(holding)
      shared.establish(directory().filterNot(_.id == user.id) :+ user, user.id, replaced).session
    }
    def revokeSessions(userId: String, keep: Option[AccountCredential]): Unit = {
      holding(userId)
      shared.revokeSessions(userId, keep)
    }
    def revokeTokens(userId: String): Unit = {
      holding(userId)
      shared.revokeTokens(userId)
    }
    def activated(user: AccountUser): Unit = {
      holding(user.id)
      if (world.failActivation) throw AccountFailure("username-unavailable")
      world.hooks += s"activated:${user.id}"
    }
    def updated(user: AccountUser): Unit = {
      holding(user.id)
      world.hooks += s"updated:${user.id}:${user.enabled}"
    }
  }

  private final class Scope(val core: ImperativeAccounts, shared: Accounts, val users: ImperativeUserRepository, val rows: AccountRepository) {
    def browser(secret: String): Boolean = shared.browser(core.directory, secret).nonEmpty
    def bearer(secret: String): Boolean = shared.bearer(core.directory, secret).nonEmpty
    def token(session: AccountSession): String = shared.issue(core.directory, session.credential, "Contract client").secret
    def declaredSession(id: String): AccountSession = shared.establish(core.directory, id, None).session
  }

  private final class World(backend: ImperativeBackend) {
    val clock = new MovableClock(start)
    private val declaredHash = FastPasswordHasher.hash(password.toCharArray)
    var settings: Option[ImperativeSettings] =
      Some(ImperativeSettings("contract", true, false, true, 100, Duration.ofHours(24), "Contract", Set("payroll"), primaryVault))
    var declared: DeclaredDirectory = DeclaredDirectory(Vector(
      AccountUser("root", "human", "Root", Some("root"), Some(declaredHash), true, AccountOrigin.Declarative),
      AccountUser("Ops", "human", "Operations", Some("Dora"), Some(declaredHash), true, AccountOrigin.Declarative),
      AccountUser("robot", "agent", "Robot", None, None, true, AccountOrigin.Declarative)), Set("root"))
    val retained = mutable.Set.empty[String]
    val hooks = mutable.ArrayBuffer.empty[String]
    var failActivation = false
    backend.transaction((_, rows) => new Accounts(rows, clock).reconcile(declared.users))

    def scope[A](work: Scope => A): A = backend.transaction { (users, rows) =>
      val shared = new Accounts(rows, clock)
      lazy val core: ImperativeAccounts = new ImperativeAccounts(users, settings, declared, sessions, name => retained(name), FastPasswordHasher, clock)
      lazy val sessions: AccountSessions = new SharedSessions(shared, rows, () => core.directory, this)
      work(new Scope(core, shared, users, rows))
    }
    def apply[A](work: ImperativeAccounts => A): A = scope(inner => work(inner.core))
    def configure(change: ImperativeSettings => ImperativeSettings): Unit = settings = settings.map(change)
    def declare(user: AccountUser): Unit = declared = DeclaredDirectory(declared.users :+ user, declared.admins)
    def declaredUser(id: String, login: String): AccountUser = AccountUser(id, "human", id, Some(login), Some(declaredHash), true, AccountOrigin.Declarative)

    def now: Instant = clock.instant().truncatedTo(ChronoUnit.MICROS)
    def step: Long = Totp.stepAt(clock.instant())
    def tick(): Unit = clock.advance(Duration.ofSeconds(Totp.StepSeconds))
    def code(secret: String): String = Totp.code(Totp.decodeSecret(secret).get, step)
    /** The code of the next step, which the verification window already accepts. */
    def codeAhead(secret: String): String = Totp.code(Totp.decodeSecret(secret).get, step + Totp.WindowSteps)
    def credentials(requireTotp: Boolean): NewCredentials = NewCredentials(password, secretText, code(secretText), requireTotp)
    def email(name: String): String = s"$name@example.test"

    def signup(name: String, requireTotp: Boolean): AccountOutcome[SignupResult] = apply(_.signup(name, email(name), credentials(requireTotp), None))
    def member(name: String, requireTotp: Boolean): SignedIn = signup(name, requireTotp) match {
      case Completed(SignupResult.Active(signedIn)) => signedIn
      case other => fail(s"expected an active signup, got $other")
    }
    def login(name: String, secret: String, totp: Option[String]): AccountOutcome[SignedIn] = loginReplacing(name, secret, totp, None)
    def loginReplacing(name: String, secret: String, totp: Option[String], previous: Option[String]): AccountOutcome[SignedIn] =
      apply(_.login(name, secret, totp, previous)) match {
        case LoginDecision.Imperative(outcome) => outcome
        case LoginDecision.NotImperative => fail(s"login $name was not handled as imperative")
      }
    def recover(name: String, totp: String, secret: String): AccountOutcome[SignedIn] = apply(_.recover(name, totp, secret, None))
    def stored(name: String): Option[StoredImperativeUser] = scope(_.users.user(name))
    def row(name: String): StoredImperativeUser = stored(name).getOrElse(fail(s"no row for $name"))
    def live(signedIn: SignedIn): Boolean = scope(_.browser(signedIn.session.secret))
    def sessionCount(name: String): Int = scope(_.rows.ownerSessions(name).size)
    /** The declared administrator's session. Established here, so that no test opens a transaction inside another. */
    val root: AccountCredential = scope(_.declaredSession("root")).credential
  }

  private def withWorld(body: World => Unit): Unit = withBackend(backend => body(new World(backend)))
  private def rejected(reason: AccountRejection): AccountOutcome[Nothing] = Rejected(reason, None)
  private def completed[A](outcome: AccountOutcome[A]): A = outcome match {
    case Completed(value) => value
    case other => fail(s"expected a completed operation, got $other")
  }
  private def counters(row: StoredImperativeUser): (Int, Int, Int) =
    (row.passwordFailures.failures, row.totpFailures.failures, row.recoveryFailures.failures)

  test("1 signup without approval creates the account, its activation and a session in one transaction") {
    withWorld { world =>
      val alice = world.member("alice", false)
      val row = world.row("alice")
      assertEquals((row.status, row.createdVia, row.createdBy, row.totpLastStep, row.admin, row.createdAt),
        (AccountStatus.Active, CreatedVia.Signup, None, world.step, false, world.now))
      assertEquals(alice.user, AccountUser("alice", "human", "alice", Some("alice"), Some(row.passwordHash), true, AccountOrigin.Imperative))
      assert(world.live(alice))
      assertEquals(world.hooks.toVector, Vector("activated:alice"))
      assert(world.scope(_.core.directory).contains(alice.user))
      assertEquals(world.scope(_.rows.user("alice")), None)
      world.failActivation = true
      assertEquals(intercept[AccountFailure](world.signup("bob", false)).code, "username-unavailable")
      assertEquals(world.stored("bob"), None)
      assertEquals((world.sessionCount("alice"), world.sessionCount("bob")), (1, 0))
    }
  }

  test("2 signup with approval is pending: no session, no login, no recovery, yet it holds the name and a cap slot") {
    withWorld { world =>
      world.configure(_.copy(requireApproval = true, maxUsers = 1))
      assertEquals(world.signup("alice", false), Completed(SignupResult.Pending))
      assertEquals(world.row("alice").status, AccountStatus.Pending)
      assertEquals(world.hooks.toVector, Vector.empty)
      assert(!world.scope(_.core.directory).exists(_.id == "alice"))
      assertEquals(world.login("alice", wrongPassword, None), rejected(Unauthorized))
      assertEquals(world.login("nobody", wrongPassword, None), rejected(Unauthorized))
      assertEquals(counters(world.row("alice")), (1, 0, 0))
      assertEquals(world.login("alice", password, None), rejected(PendingApproval))
      world.tick()
      val before = world.row("alice")
      assertEquals(world.recover("alice", world.code(secretText), newPassword), rejected(Unauthorized))
      assertEquals(world.recover("nobody", world.code(secretText), newPassword), rejected(Unauthorized))
      val after = world.row("alice")
      assertEquals((after.passwordHash, after.totpLastStep, counters(after)), (before.passwordHash, before.totpLastStep, (0, 0, 0)))
      assertEquals(world.sessionCount("alice"), 0)
      assertEquals(world.signup("alice", false), rejected(UsernameUnavailable))
      assertEquals(world.signup("bob", false), rejected(Forbidden))
    }
  }

  test("3 approval activates after re-checking the namespace; rejection deletes the application and frees the name") {
    withWorld { world =>
      world.configure(_.copy(requireApproval = true))
      Vector("alice", "bob", "carol").foreach(name => assertEquals(world.signup(name, false), Completed(SignupResult.Pending)))
      assertEquals(completed(world(_.listUsers(world.root))).find(_.id == "carol"), Some(ListedAccount("carol", Some("carol"), "carol", "human",
        AccountOrigin.Imperative, AccountStatus.Pending, false, Some(ListedDetails(world.email("carol"), world.now, CreatedVia.Signup, None, None,
          false, TotpState.Ok, false, None)))))
      assertEquals(world(_.approve(world.root, "alice")), Completed(()))
      val alice = world.row("alice")
      assertEquals((alice.status, alice.approvedBy, alice.approvedAt), (AccountStatus.Active, Some("root"), Some(world.now)))
      assertEquals(world.hooks.toVector, Vector("activated:alice"))
      assertEquals(world.sessionCount("alice"), 0)
      assert(world.live(completed(world.login("alice", password, None))))
      assertEquals(world(_.approve(world.root, "alice")), rejected(NotFound))
      assertEquals(world(_.reject(world.root, "bob")), Completed(()))
      assertEquals(world.stored("bob"), None)
      assertEquals(world.signup("bob", false), Completed(SignupResult.Pending))
      world.retained += "carol"
      assertEquals(world(_.approve(world.root, "carol")), rejected(UsernameUnavailable))
      assertEquals(world.row("carol").status, AccountStatus.Pending)
      assertEquals(world(_.reject(world.root, "carol")), Completed(()))
    }
  }

  test("4 reserved, declared, existing, retained and invited names and a full cap are refused and persist nothing") {
    withWorld { world =>
      world.member("alice", false)
      world.retained += "ghost"
      val invitation = completed(world(_.issueInvitation(world.root, "invited")))
      def persisted: (Set[String], Set[String]) = world.scope(inner => (inner.users.users.map(_.id).toSet, inner.users.enrollments.map(_.username).toSet))
      val before = persisted
      Vector("admin", "payroll", "ops", "dora", "alice", "ghost", "invited").foreach { name =>
        assertEquals(world.signup(name, false), rejected(UsernameUnavailable), name)
      }
      Vector("admin", "dora", "alice", "ghost").foreach { name =>
        assertEquals(world(_.issueInvitation(world.root, name)), rejected(UsernameUnavailable), name)
      }
      world.configure(_.copy(maxUsers = 1))
      assertEquals(world.signup("bob", false), rejected(Forbidden))
      assertEquals(persisted, before)
      assert(world.live(completed(world(_.redeemEnrollment(invitation.code, Some(world.email("invited")), world.credentials(false), None)))))
    }
  }

  test("5 a failed TOTP proof persists nothing") {
    withWorld { world =>
      val unproven = NewCredentials(password, secretText, world.code(otherSecretText), false)
      assertEquals(world(_.signup("alice", world.email("alice"), unproven, None)), rejected(TotpMismatch))
      assertEquals(world.stored("alice"), None)
      val invitation = completed(world(_.issueInvitation(world.root, "bob")))
      assertEquals(world(_.redeemEnrollment(invitation.code, Some(world.email("bob")), unproven, None)), rejected(TotpMismatch))
      assertEquals(world.stored("bob"), None)
      assert(world.live(completed(world(_.redeemEnrollment(invitation.code, Some(world.email("bob")), world.credentials(false), None)))))
    }
  }

  test("6 login with a password replacing the presented session, with mandatory TOTP in two stateless steps, never with a replayed step") {
    withWorld { world =>
      world.member("alice", false)
      world.member("bob", true)
      assertEquals(world(_.login("root", password, None, None)), LoginDecision.NotImperative)
      val alice = completed(world.login("ALICE", password, None))
      val ops = world.scope(_.declaredSession("Ops"))
      val replacing = completed(world.loginReplacing("alice", password, None, Some(ops.secret)))
      assertEquals((world.live(alice), world.live(replacing), world.scope(_.browser(ops.secret))), (true, true, false))
      assertEquals(world.login("alice", wrongPassword, None), rejected(Unauthorized))
      assertEquals(world.login("bob", password, None), rejected(TotpRequired))
      assertEquals(world.row("bob").totpFailures, FailureCounter.Clear)
      assertEquals(world.login("bob", password, Some(world.code(secretText))), rejected(Unauthorized))
      world.tick()
      val code = world.code(secretText)
      assert(world.live(completed(world.login("bob", password, Some(code)))))
      assertEquals(world.row("bob").totpLastStep, world.step)
      assertEquals(world.login("bob", password, Some(code)), rejected(Unauthorized))
      assertEquals(counters(world.row("bob")), (0, 2, 0))
      world.tick()
      assert(world.live(completed(world.login("bob", password, Some(world.code(secretText))))))
    }
  }

  test("7 a rejected password attempt is counted in the committed transaction, backs off and clears on success") {
    withWorld { world =>
      world.member("alice", false)
      // Design D27: were the rejection thrown, the transaction and the count it made would be rolled back.
      val first = Try(world.login("alice", wrongPassword, None))
      assertEquals(world.row("alice").passwordFailures, FailureCounter(1, Some(world.now)))
      assertEquals(first.toOption, Some(rejected(Unauthorized)))
      (2 to 9).foreach(_ => assertEquals(world.login("alice", wrongPassword, None), rejected(Unauthorized)))
      assertEquals(world.login("alice", wrongPassword, None), Rejected(Unauthorized, Some(FailurePath.Password)))
      assertEquals(world.login("alice", password, None), rejected(RateLimited(Duration.ofMinutes(1))))
      assertEquals(completed(world(_.listUsers(world.root))).flatMap(_.imperative).map(_.locked), Vector(true))
      world.clock.advance(Duration.ofMinutes(1))
      assertEquals(world.login("alice", wrongPassword, None), Rejected(Unauthorized, Some(FailurePath.Password)))
      world.clock.advance(Duration.ofSeconds(119))
      assertEquals(world.login("alice", password, None), rejected(RateLimited(Duration.ofSeconds(1))))
      assertEquals(counters(world.row("alice")), (11, 0, 0))
      world.clock.advance(Duration.ofSeconds(1))
      assert(world.live(completed(world.login("alice", password, None))))
      assertEquals(world.row("alice").passwordFailures, FailureCounter.Clear)
    }
  }

  test("8 recovery replaces the password, deletes sessions, keeps tokens, consumes the step and clears the counters") {
    withWorld { world =>
      val first = world.member("alice", false)
      val second = completed(world.login("alice", password, None))
      val token = world.scope(_.token(first.session))
      world.tick()
      val code = world.code(secretText)
      assertEquals(world.login("alice", wrongPassword, None), rejected(Unauthorized))
      assertEquals(world.recover("alice", world.code(otherSecretText), newPassword), rejected(Unauthorized))
      assertEquals(counters(world.row("alice")), (1, 0, 1))
      assertEquals(world.recover("nobody", code, "too short"), rejected(WeakPassword))
      assertEquals(world.recover("alice", code, world.email("alice").toUpperCase), rejected(WeakPassword))
      val recovered = completed(world.recover("alice", code, newPassword))
      val row = world.row("alice")
      assertEquals((row.totpLastStep, counters(row), row.credentialsAt), (world.step, (0, 0, 0), world.now))
      assertEquals(Vector(first, second, recovered).map(world.live), Vector(false, false, true))
      assertEquals(world.sessionCount("alice"), 1)
      assert(world.scope(_.bearer(token)))
      assertEquals(world.hooks.last, "updated:alice:true")
      assertEquals(world.login("alice", password, None), rejected(Unauthorized))
      assert(world.live(completed(world.login("alice", newPassword, None))))
      assertEquals(world.recover("alice", code, password), rejected(Unauthorized))
      assertEquals(world.recover("root", code, newPassword), rejected(Unauthorized))
    }
  }

  test("9 the counters are independent: recovery failures never lock login, and TOTP counters lapse instead of clearing") {
    withWorld { world =>
      world.member("bob", true)
      world.tick()
      (1 to 4).foreach(_ => assertEquals(world.recover("bob", world.code(otherSecretText), newPassword), rejected(Unauthorized)))
      assertEquals(world.recover("bob", world.code(otherSecretText), newPassword), Rejected(Unauthorized, Some(FailurePath.Recovery)))
      assertEquals(world.recover("bob", world.code(secretText), newPassword), rejected(RateLimited(Duration.ofMinutes(15))))
      assertEquals(counters(world.row("bob")), (0, 0, 5))
      assert(world.live(completed(world.login("bob", password, Some(world.code(secretText))))))
      (1 to 4).foreach(_ => assertEquals(world.login("bob", password, Some(world.code(otherSecretText))), rejected(Unauthorized)))
      world.tick()
      assert(world.live(completed(world.login("bob", password, Some(world.code(secretText))))))
      assertEquals(counters(world.row("bob")), (0, 4, 5))
      assertEquals(world.login("bob", password, Some(world.code(otherSecretText))), Rejected(Unauthorized, Some(FailurePath.Totp)))
      world.tick()
      assertEquals(world.login("bob", password, Some(world.code(secretText))), rejected(RateLimited(Duration.ofMinutes(15).minusSeconds(Totp.StepSeconds))))
      world.clock.advance(Duration.ofDays(7))
      assertEquals(world.login("bob", password, Some(world.code(otherSecretText))), rejected(Unauthorized))
      assertEquals(world.row("bob").totpFailures, FailureCounter(1, Some(world.now)))
      assert(world.live(completed(world.login("bob", password, Some(world.code(secretText))))))
      world.tick()
      assert(world.live(completed(world.recover("bob", world.code(secretText), newPassword))))
    }
  }

  test("10 enrollment: issue, inspect, redeem once; re-issue replaces; revoke; an expired row does not hold the name") {
    withWorld { world =>
      val erin = completed(world(_.issueInvitation(world.root, "erin")))
      val expires = world.now.plus(Duration.ofHours(24))
      assertEquals(completed(world(_.inspectEnrollment(erin.code))), EnrollmentInfo("erin", EnrollmentKind.Invite, expires))
      assertEquals(completed(world(_.listEnrollments(world.root))), Vector(ListedEnrollment(erin.enrollment.id, "erin", EnrollmentKind.Invite, "root", world.now, expires)))
      assertEquals(world(_.redeemEnrollment(erin.code, None, world.credentials(false), None)), rejected(Invalid))
      val redeemed = completed(world(_.redeemEnrollment(erin.code, Some(world.email("erin")), world.credentials(false), None)))
      val row = world.row("erin")
      assertEquals((row.status, row.createdVia, row.createdBy, world.live(redeemed)), (AccountStatus.Active, CreatedVia.Enrollment, Some("root"), true))
      assertEquals(world.hooks.toVector, Vector("activated:erin"))
      assertEquals(world(_.redeemEnrollment(erin.code, Some(world.email("erin")), world.credentials(false), None)), rejected(NotFound))
      assertEquals(world(_.inspectEnrollment(erin.code)), rejected(NotFound))

      val replaced = completed(world(_.issueInvitation(world.root, "fred")))
      val current = completed(world(_.issueInvitation(world.root, "fred")))
      assertEquals(world(_.inspectEnrollment(replaced.code)), rejected(NotFound))
      assertEquals(completed(world(_.inspectEnrollment(current.code))).username, "fred")
      assertEquals(world(_.revokeEnrollment(world.root, current.enrollment.id)), Completed(()))
      assertEquals(world(_.inspectEnrollment(current.code)), rejected(NotFound))

      val gina = completed(world(_.issueInvitation(world.root, "gina")))
      world.configure(_.copy(enrollment = false))
      assertEquals(world(_.inspectEnrollment(gina.code)), rejected(NotFound))
      assertEquals(world(_.issueInvitation(world.root, "hugo")), rejected(NotFound))
      world.configure(_.copy(enrollment = true))
      world.clock.advance(Duration.ofHours(24).minusSeconds(1))
      val ivan = completed(world(_.issueInvitation(world.root, "ivan")))
      assertEquals(world.signup("gina", false), rejected(UsernameUnavailable))
      world.clock.advance(Duration.ofSeconds(1))
      assert(world.live(world.member("gina", false)))
      assertEquals(world(_.inspectEnrollment(gina.code)), rejected(NotFound))
      world.clock.advance(Duration.ofHours(24))
      def pending: Vector[String] = world.scope(_.users.enrollments.map(_.username))
      assertEquals(pending, Vector("ivan"))
      assertEquals(world(_.redeemEnrollment(ivan.code, Some(world.email("ivan")), world.credentials(false), None)), rejected(NotFound))
      assertEquals(pending, Vector.empty)
    }
  }

  test("11 a reset replaces the credentials, keeps tokens, e-mail and admin flag, and is refused for self, pending and disabled targets") {
    withWorld { world =>
      val alice = world.member("alice", false)
      world.member("bob", false)
      val token = world.scope(_.token(alice.session))
      assertEquals(world(_.setAdmin(world.root, "alice", true, password)), Completed(()))
      world.configure(_.copy(enrollment = false, requireApproval = true))
      assertEquals(world.signup("carol", false), Completed(SignupResult.Pending))
      assertEquals(world(_.setEnabled(world.root, "bob", false)), Completed(()))
      Vector("alice", "carol", "bob").foreach { target =>
        assertEquals(world(_.issueReset(alice.session.credential, target, password)), rejected(Forbidden), target)
      }
      val reset = completed(world(_.issueReset(world.root, "alice", password)))
      assertEquals(completed(world(_.inspectEnrollment(reset.code))).kind, EnrollmentKind.Reset)
      assertEquals(completed(world(_.listEnrollments(world.root))).map(_.id), Vector(reset.enrollment.id))
      assert(world.live(completed(world.login("alice", password, None))))
      assertEquals(world.login("alice", wrongPassword, None), rejected(Unauthorized))
      world.tick()
      val replacement = NewCredentials(newPassword, otherSecretText, world.code(otherSecretText), true)
      assertEquals(world(_.redeemEnrollment(reset.code, Some(world.email("alice")), replacement, None)), rejected(Invalid))
      val redeemed = completed(world(_.redeemEnrollment(reset.code, None, replacement, None)))
      val row = world.row("alice")
      assertEquals((row.email, row.admin, row.totpRequired, counters(row), row.totpLastStep), (world.email("alice"), true, true, (0, 0, 0), world.step))
      assertEquals(Vector(alice, redeemed).map(world.live), Vector(false, true))
      assertEquals(world.sessionCount("alice"), 1)
      assert(world.scope(_.bearer(token)))
      assertEquals(world(_.redeemEnrollment(reset.code, None, replacement, None)), rejected(NotFound))
      assertEquals(world.login("alice", password, None), rejected(Unauthorized))
      world.tick()
      assertEquals(world.login("alice", newPassword, Some(world.code(secretText))), rejected(Unauthorized))
      assert(world.live(completed(world.login("alice", newPassword, Some(world.code(otherSecretText))))))
    }
  }

  test("12 admin rules: imperative targets only, never self, admins only, and the actor's password for flag changes and resets") {
    withWorld { world =>
      val alice = world.member("alice", false).session.credential
      world.member("bob", false)
      val ops = world.scope(_.declaredSession("Ops")).credential
      assertEquals(world(_.listUsers(world.root.copy(browser = false))), rejected(Forbidden))
      assertEquals(completed(world(_.profile(world.root))), AccountProfile(world.declared.users.head, true, None))
      Vector(alice, ops).foreach { actor =>
        assertEquals(world(_.listUsers(actor)), rejected(Forbidden))
        assertEquals(world(_.setAdmin(actor, "bob", true, password)), rejected(Forbidden))
        assertEquals(world(_.setEnabled(actor, "bob", false)), rejected(Forbidden))
      }
      assertEquals(world(_.setAdmin(world.root, "alice", true, wrongPassword)), rejected(ProofRejected))
      assertEquals(world.row("alice").admin, false)
      assertEquals(world(_.setAdmin(world.root, "Ops", true, password)), rejected(Forbidden))
      assertEquals(world(_.setEnabled(world.root, "root", false)), rejected(Forbidden))
      assertEquals(world(_.setAdmin(world.root, "nobody", true, password)), rejected(NotFound))
      assertEquals(world(_.setAdmin(world.root, "alice", true, password)), Completed(()))

      assertEquals(world(_.setAdmin(alice, "bob", true, wrongPassword)), rejected(ProofRejected))
      assertEquals(world(_.issueReset(alice, "bob", wrongPassword)), rejected(ProofRejected))
      assertEquals((counters(world.row("alice")), world.row("bob").admin), ((2, 0, 0), false))
      assertEquals(world(_.setAdmin(alice, "alice", false, password)), rejected(Forbidden))
      assertEquals(world(_.setEnabled(alice, "alice", false)), rejected(Forbidden))
      assertEquals(world(_.setAdmin(alice, "bob", true, password)), Completed(()))
      assertEquals((counters(world.row("alice")), world.row("bob").admin), ((0, 0, 0), true))
      assertEquals(completed(world(_.issueReset(alice, "bob", password))).enrollment.createdBy, "alice")

      val listed = completed(world(_.listUsers(alice))).map(entry => (entry.id, entry.origin, entry.status, entry.admin, entry.imperative.flatMap(_.pendingEnrollment)))
      assertEquals(listed, Vector(
        ("root", AccountOrigin.Declarative, AccountStatus.Active, true, None),
        ("Ops", AccountOrigin.Declarative, AccountStatus.Active, false, None),
        ("robot", AccountOrigin.Declarative, AccountStatus.Active, false, None),
        ("alice", AccountOrigin.Imperative, AccountStatus.Active, true, None),
        ("bob", AccountOrigin.Imperative, AccountStatus.Active, true, Some(EnrollmentKind.Reset))))
    }
  }

  test("13 disabling deletes sessions, revokes tokens and the pending reset and keeps the name; enabling restores login") {
    withWorld { world =>
      val alice = world.member("alice", false)
      val token = world.scope(_.token(alice.session))
      val reset = completed(world(_.issueReset(world.root, "alice", password)))
      assertEquals(world(_.setEnabled(world.root, "alice", false)), Completed(()))
      assertEquals(world.row("alice").status, AccountStatus.Disabled)
      assertEquals((world.live(alice), world.sessionCount("alice"), world.scope(_.bearer(token))), (false, 0, false))
      assert(world.scope(_.rows.tokens("alice")).forall(_.revoked))
      assertEquals(world(_.inspectEnrollment(reset.code)), rejected(NotFound))
      assertEquals(world(_.profile(alice.session.credential)), rejected(Unauthorized))
      assertEquals(world.hooks.last, "updated:alice:false")
      assert(!world.scope(_.core.directory).exists(_.id == "alice"))
      assertEquals(world.login("alice", password, None), rejected(Unauthorized))
      assertEquals(world.login("alice", wrongPassword, None), rejected(Unauthorized))
      assertEquals(counters(world.row("alice")), (0, 0, 0))
      assertEquals(world.signup("alice", false), rejected(UsernameUnavailable))
      assertEquals(world(_.setEnabled(world.root, "alice", true)), Completed(()))
      assertEquals(world.hooks.last, "updated:alice:true")
      assert(world.live(completed(world.login("alice", password, None))))
      assert(!world.scope(_.bearer(token)))
    }
  }

  test("14 self-service: e-mail and password; mandatory TOTP deletes the other sessions and binds the secret to the old authenticator") {
    withWorld { world =>
      val first = world.member("alice", false)
      val session = first.session.credential
      assertEquals(world(_.changeEmail(world.root, world.email("root"))), rejected(Forbidden))
      assertEquals(world(_.changeEmail(session, "not an address")), rejected(Invalid))
      assertEquals(world(_.changeEmail(session, world.email("changed"))), Completed(()))
      assertEquals(world(_.changePassword(session, wrongPassword, newPassword)), rejected(ProofRejected))
      assertEquals(world(_.changePassword(session, password, world.email("CHANGED"))), rejected(WeakPassword))
      assertEquals((world.row("alice").email, counters(world.row("alice")), world.live(first)), (world.email("changed"), (1, 0, 0), true))
      val second = completed(world.login("alice", password, None))
      world.tick()
      val initial = world.code(otherSecretText)
      assertEquals(world(_.replaceTotp(session, wrongPassword, otherSecretText, initial, None)), rejected(ProofRejected))
      assertEquals(world(_.replaceTotp(session, password, otherSecretText, world.code(secretText), None)), rejected(TotpMismatch))
      assertEquals(world(_.replaceTotp(session, password, otherSecretText, initial, None)), Completed(()))
      assertEquals(world(_.setTotpRequired(session, true, world.code(secretText))), rejected(ProofRejected))
      assertEquals(counters(world.row("alice")), (0, 1, 0))
      world.tick()
      assertEquals(world(_.setTotpRequired(session, true, world.code(otherSecretText))), Completed(()))
      assertEquals((world.row("alice").totpRequired, world.live(first), world.live(second)), (true, true, false))

      world.tick()
      val ahead = world.codeAhead(otherSecretText)
      assertEquals(world(_.replaceTotp(session, password, otherSecretText, world.code(otherSecretText), Some(ahead))), Completed(()))
      assertEquals(world.login("alice", password, Some(ahead)), rejected(Unauthorized))
      assertEquals(world.row("alice").totpLastStep, world.step + Totp.WindowSteps)
      world.tick()
      world.tick()
      val replacement = world.code(secretText)
      assertEquals(world(_.replaceTotp(session, password, secretText, replacement, None)), rejected(Invalid))
      assertEquals(world(_.replaceTotp(session, password, secretText, replacement, Some(replacement))), rejected(ProofRejected))
      assertEquals(world(_.replaceTotp(session, password, secretText, replacement, Some(world.code(otherSecretText)))), Completed(()))
      assertEquals(counters(world.row("alice")), (0, 0, 0))
      world.tick()
      assert(world.live(completed(world.login("alice", password, Some(world.code(secretText))))))
      world.tick()
      assertEquals(world(_.setTotpRequired(session, false, world.code(secretText))), Completed(()))
      val third = completed(world.login("alice", password, None))
      val changed = completed(world(_.changePassword(session, password, newPassword)))
      assertEquals(Vector(first, third, changed).map(world.live), Vector(false, false, true))
      assertEquals((world.sessionCount("alice"), world.hooks.last), (1, "updated:alice:true"))
      assertEquals(world(_.changeEmail(session, world.email("late"))), rejected(Unauthorized))
      assertEquals(world.login("alice", password, None), rejected(Unauthorized))
      assert(world.live(completed(world.login("alice", newPassword, None))))
    }
  }

  test("15 a declared name colliding with an active or disabled account fails the directory closed, also with the master off") {
    withWorld { world =>
      world.member("alice", false)
      world.member("bob", false)
      world.configure(_.copy(requireApproval = true))
      assertEquals(world.signup("carol", false), Completed(SignupResult.Pending))
      assertEquals(world(_.setEnabled(world.root, "bob", false)), Completed(()))
      val enabled = world.settings
      val clean = world.declared
      Vector(world.declaredUser("carol", "Carol") -> None, world.declaredUser("second", "Alice") -> Some("config"),
        world.declaredUser("Bob", "third") -> Some("config")).foreach { case (user, fault) =>
        Vector(enabled, None).foreach { master =>
          world.settings = master
          world.declared = clean
          world.declare(user)
          assertEquals(Try(world.scope(_.core.directory)).failed.toOption.collect { case AccountFailure(code) => code }, fault, s"${user.id} $master")
        }
      }
    }
  }

  test("16 the master switch suspends without revoking, and creation flags alone leave existing accounts untouched") {
    withWorld { world =>
      val alice = world.member("alice", false)
      val token = world.scope(_.token(alice.session))
      val invitation = completed(world(_.issueInvitation(world.root, "bob")))
      val root = world.root
      val session = alice.session.credential
      val enabled = world.settings
      val hooks = world.hooks.toVector
      def authority: (Boolean, Boolean) = world.scope(inner => (inner.browser(alice.session.secret), inner.bearer(token)))
      def kept: (Boolean, Vector[Boolean], Int) = world.scope { inner =>
        (inner.rows.session(session.digest).nonEmpty, inner.rows.tokens("alice").map(_.revoked), inner.users.enrollments.size)
      }

      world.settings = None
      val created = world.credentials(false)
      val operations = Vector[ImperativeAccounts => AccountOutcome[Any]](
        _.signup("carol", world.email("carol"), created, None), _.recover("alice", created.totpCode, newPassword, None),
        _.inspectEnrollment(invitation.code), _.redeemEnrollment(invitation.code, Some(world.email("bob")), created, None),
        _.profile(session), _.changeEmail(session, world.email("other")), _.changePassword(session, password, newPassword),
        _.replaceTotp(session, password, secretText, created.totpCode, None), _.setTotpRequired(session, true, created.totpCode),
        _.listUsers(root), _.approve(root, "alice"), _.reject(root, "alice"), _.setEnabled(root, "alice", false),
        _.setAdmin(root, "alice", true, password), _.issueReset(root, "alice", password), _.issueInvitation(root, "carol"),
        _.listEnrollments(root), _.revokeEnrollment(root, invitation.enrollment.id))
      operations.zipWithIndex.foreach { case (operation, index) => assertEquals(world(operation), rejected(NotFound), s"operation $index") }
      assertEquals(world(_.login("alice", password, None, None)), LoginDecision.NotImperative)
      assertEquals(world.scope(_.core.directory), world.declared.users)
      assertEquals((authority, kept, world.hooks.toVector), ((false, false), (true, Vector(false), 1), hooks))

      world.settings = enabled.map(_.copy(signup = false, enrollment = false))
      assertEquals((authority, kept), ((true, true), (true, Vector(false), 1)))
      assertEquals(world.signup("carol", false), rejected(NotFound))
      assertEquals(world(_.issueInvitation(root, "carol")), rejected(NotFound))
      assert(world.live(completed(world.login("alice", password, None))))
      assertEquals(completed(world(_.profile(session))).imperative, Some(ProfileDetails(world.email("alice"), false, TotpState.Ok)))
      assertEquals(completed(world(_.listUsers(root))).map(_.id), Vector("root", "Ops", "robot", "alice"))
    }
  }

  test("17 an undecryptable secret makes TOTP operations unavailable, leaves password login alone, and a reset re-keys") {
    withWorld { world =>
      val alice = world.member("alice", false)
      world.member("bob", true)
      world.configure(_.copy(vault = otherVault))
      world.tick()
      assert(world.live(completed(world.login("alice", password, None))))
      assertEquals(world.login("bob", password, Some(world.code(secretText))), rejected(Unavailable))
      assertEquals(world.recover("alice", world.code(secretText), newPassword), rejected(Unavailable))
      assertEquals(world(_.setTotpRequired(alice.session.credential, true, world.code(secretText))), rejected(Unavailable))
      assertEquals((counters(world.row("alice")), counters(world.row("bob"))), ((0, 0, 0), (0, 0, 0)))
      def states: Vector[Option[TotpState]] = completed(world(_.listUsers(world.root))).map(_.imperative.map(_.totp))
      assertEquals(states, Vector(None, None, None, Some(TotpState.Unavailable), Some(TotpState.Unavailable)))
      val reset = completed(world(_.issueReset(world.root, "bob", password)))
      completed(world(_.redeemEnrollment(reset.code, None, NewCredentials(newPassword, otherSecretText, world.code(otherSecretText), true), None)))
      assertEquals(states, Vector(None, None, None, Some(TotpState.Unavailable), Some(TotpState.Ok)))
      world.tick()
      assert(world.live(completed(world.login("bob", newPassword, Some(world.code(otherSecretText))))))
    }
  }
}
