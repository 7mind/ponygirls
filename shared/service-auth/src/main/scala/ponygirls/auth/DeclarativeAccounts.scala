package ponygirls.auth

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.circe.Json
import java.sql.Connection
import java.time.Clock
import java.util.concurrent.atomic.AtomicReference
import ponygirls.auth.boundary.{ConfiguredTokens, Presented}
import scala.util.Using

/** Long-lived parts of imperative accounts: the shared dispatcher with its in-memory windows and credential
  * gate, and the clock and password hasher of the imperative core. */
final class ImperativeRuntime private (val api: ImperativeAccountApi, val clock: Clock, val hasher: PasswordHasher)
object ImperativeRuntime {
  def resource(clock: Clock, hasher: PasswordHasher): Resource[IO, ImperativeRuntime] =
    CredentialGate.resource.map(gate => new ImperativeRuntime(new ImperativeAccountApi(new AttemptLimiter(AttemptLimiter.Capacity, clock), gate), clock, hasher))
}

/** The configuration one account decision uses. A service reads it from its own supplier, which a reload replaces. */
trait AccountSnapshot[S] {
  /** The declared users, reconciled into the shared tables at install. */
  def users: Vector[AccountUser]
  def declared: DeclaredDirectory
  /** Present exactly while the master switch of imperative accounts is on. */
  def imperative: Option[ImperativeSettings]
  def configured: ConfiguredTokens
  /** Whether a decision admitted under this snapshot still holds under `current`, a later one. */
  def unchangedIn(current: S): Boolean
}

/** The scopes of tokens on the shared tables: issued and configured tokens carry the owner's whole API authority. The
  * shared store and the services' authorisation represent nothing narrower. */
object AccountScopes {
  val Api: Vector[String] = Vector("api")
}

/** Who a credential authenticates: the user and the token (configured, issued or session) it presents. */
final case class Authority(userId: String, userType: String, tokenId: String)
/** A credential the boundary selected and the authority it resolved to. */
final case class Captured(authority: Authority, presented: Presented)
final case class AccountView(user: AccountUser, tokens: Vector[AccountToken])
/** A credential's authority with what a service's own routes need of its account, read with it: the display name of
  * its directory entry and whether it acts as an administrator. `administrator` is the account's effective
  * administrator flag (declared, or of an active imperative account while the master switch is on) on a browser
  * session, and never true for a bearer token. */
final case class Identified(captured: Captured, displayName: String, administrator: Boolean)

/** Why the account service refused. Each service maps a refusal to its own failure. */
enum AccountRefusal {
  case InvalidCredentials, BrowserSessionRequired, AuthorityChanged, InvalidTokenScopes, ConfiguredTokenImmutable
}
final case class AccountRefused(refusal: AccountRefusal) extends RuntimeException(refusal.toString)

/** Why a service's own route refused an authenticated caller. Each service maps a refusal to its own failure. */
enum CallerRefusal {
  /** The route serves the other kind of credential (bearer token or browser session). */
  case CredentialKindNotServed
  /** A browser-session request without exactly one well-formed `X-Account-Actor`. */
  case ActorRequired
  /** A browser-session request whose `X-Account-Actor` names another account. */
  case ActorMismatch
}
final case class CallerRefused(refusal: CallerRefusal) extends RuntimeException(refusal.toString)

/** Whether a password that is a bearer secret signs in: the secret of a configured token or of a live issued token.
  * There is no default: each service states its choice. */
enum BearerSecretPasswords {
  /** It signs in like any other password that verifies. */
  case Accepted
  /** It is refused exactly as a wrong password is, after the same verification: on a declared user's login, and on
    * every verification of the imperative core (an imperative login, a password proof). */
  case Refused
}

/** What a service learns of a caller of its own routes beyond the credential. Each value names the reads it costs; there
  * is no default. */
sealed trait CallerReads[C] {
  def read[S <: AccountSnapshot[S]](service: DeclarativeAccountService[S], select: S => Presented): IO[C]
  def captured(caller: C): Captured
}
object CallerReads {
  /** The credential's authority: exactly the reads of `DeclarativeAccountService.resolve`, nothing more. */
  case object CredentialOnly extends CallerReads[Captured] {
    def read[S <: AccountSnapshot[S]](service: DeclarativeAccountService[S], select: S => Presented): IO[Captured] = service.resolve(select)
    def captured(caller: Captured): Captured = caller
  }
  /** `DeclarativeAccountService.identify`: the authority, the display name and, for a browser session, the administrator
    * flag (for an imperative account one more read of its row, in the same transaction). */
  case object WithAdministrator extends CallerReads[Identified] {
    def read[S <: AccountSnapshot[S]](service: DeclarativeAccountService[S], select: S => Presented): IO[Identified] = service.identify(select)
    def captured(caller: Identified): Captured = caller.captured
  }
}

/** What the account service tells its consumer, after a commit and never after a rollback, with identifiers that are
  * not secrets. There is no default: each service states its choice. */
enum AccountLifecycle {
  /** Nothing is told, and nothing is read to tell it. */
  case Unobserved
  /** `credentialEnded`: a browser session (`session-<uuid>`) ended by sign-out or by a sign-in that replaced it, or an
    * issued token (`issued-<uuid>`) revoked. `accountChanged`: an account whose rights ended or changed (disabled or
    * enabled, its administrator role changed, its password changed or recovered with its sessions revoked, its TOTP
    * requirement changed, its declared entry changed or removed by a reload, its imperative accounts suspended by the
    * master switch); every session of it the change revoked is announced this way, not one by one. */
  case Observed(credentialEnded: String => IO[Unit], accountChanged: String => IO[Unit])
}

/** How startup and every reload install the declared directory. There is no default: each service states its choice. */
sealed trait DeclaredInstallation[-S]
object DeclaredInstallation {
  /** The shared check against imperative accounts and the reconciliation, in one transaction of the account storage. */
  case object Reconciled extends DeclaredInstallation[Any]
  /** The service's own installation. It must make the shared check and the reconciliation in the transaction of its own
    * rule: `SharedAccountStorage.checked` does so over the shared tables. */
  final case class Own[S](install: S => IO[Unit]) extends DeclaredInstallation[S]
}

/** One transaction's account storage: the shared tables of sessions, issued tokens, declared-directory fingerprints
  * and imperative users, and the indexing preferences. Every method runs in the caller's transaction. */
trait AccountStore {
  /** The declared users plus, while the master switch is on, the active imperative users. */
  def directory(settings: Option[ImperativeSettings], declared: DeclaredDirectory): Vector[AccountUser]
  /** Under the directory lock: refuses a declared id or login of an existing imperative account, then reconciles `users`. */
  def installDeclared(declared: DeclaredDirectory, users: Vector[AccountUser]): Unit
  def activeImperativeUsers(): Int
  def browser(users: Vector[AccountUser], secret: String): Option[AccountCredential]
  def bearer(users: Vector[AccountUser], secret: String): Option[AccountCredential]
  def loginReplacing(users: Vector[AccountUser], login: String, password: String, previous: Option[String]): AccountLogin
  def logout(users: Vector[AccountUser], secret: String): Unit
  def tokens(owner: String): Vector[AccountToken]
  def issue(users: Vector[AccountUser], session: AccountCredential, name: String): AccountIssued
  def revoke(users: Vector[AccountUser], session: AccountCredential, id: String): Unit
  /** The imperative core in this transaction; `directory` reads the merged directory again on every call. */
  def imperative(settings: Option[ImperativeSettings], declared: DeclaredDirectory, directory: () => Vector[AccountUser],
    hasher: PasswordHasher, clock: Clock): ImperativeAccounts
  def indexing(service: IndexingService, policy: IndexingPolicy): IndexingPreferences
}
/** One transaction per call: committed when `work` returns, rolled back when it throws. */
trait AccountStorage {
  def transaction[A](work: AccountStore => A): IO[A]
}

/** The service's transaction owner over the database of the shared tables. */
trait ConnectionTransactions {
  def transaction[A](work: Connection => A): IO[A]
}

/** `AccountStore` over the shared tables (`AccountSql`, `ImperativeAccountSql`, `IndexingPreferenceSql`). Owner keys
  * are the user ids. `history` adds the service's own retained identities to the fingerprint rows. */
final class SharedAccountStorage(transactions: ConnectionTransactions, history: (Connection, IdentityHistory) => IdentityHistory) extends AccountStorage {
  def transaction[A](work: AccountStore => A): IO[A] = transactions.transaction(c => work(store(c)))
  /** The installation of a declared directory with the service's own rule on its declared ids. In one transaction, under
    * the directory lock: the shared check against imperative accounts, then `check` on the same connection with the
    * configuration being installed, then the reconciliation. An error `check` raises refuses the installation, and
    * nothing of it is written. */
  def checked[S <: AccountSnapshot[S]](check: (Connection, S) => Unit): DeclaredInstallation[S] = DeclaredInstallation.Own(s =>
    transactions.transaction(c => ImperativeAccountSql.installDeclared(c, s.declared) {
      check(c, s)
      AccountSql.reconcile(c, s.users)
    }))
  private def store(c: Connection): AccountStore = new AccountStore {
    def directory(settings: Option[ImperativeSettings], declared: DeclaredDirectory): Vector[AccountUser] = ImperativeAccountSql.directory(c, settings, declared)
    def installDeclared(declared: DeclaredDirectory, users: Vector[AccountUser]): Unit = ImperativeAccountSql.installDeclared(c, declared)(AccountSql.reconcile(c, users))
    def activeImperativeUsers(): Int = Using.resource(c.prepareStatement("SELECT count(*) FROM ponygirls_imperative_users WHERE status='active'")) { statement =>
      Using.resource(statement.executeQuery()) { result => result.next(); result.getInt(1) }
    }
    def browser(users: Vector[AccountUser], secret: String): Option[AccountCredential] = AccountSql.browser(c, users, secret)
    def bearer(users: Vector[AccountUser], secret: String): Option[AccountCredential] = AccountSql.bearer(c, users, secret)
    def loginReplacing(users: Vector[AccountUser], login: String, password: String, previous: Option[String]): AccountLogin =
      AccountSql.loginReplacing(c, users, login, password, previous)
    def logout(users: Vector[AccountUser], secret: String): Unit = AccountSql.logout(c, users, secret)
    def tokens(owner: String): Vector[AccountToken] = AccountSql.tokens(c, owner)
    def issue(users: Vector[AccountUser], session: AccountCredential, name: String): AccountIssued = AccountSql.issue(c, users, session, name)
    def revoke(users: Vector[AccountUser], session: AccountCredential, id: String): Unit = AccountSql.revoke(c, users, session, id)
    def imperative(settings: Option[ImperativeSettings], declared: DeclaredDirectory, directory: () => Vector[AccountUser],
        hasher: PasswordHasher, clock: Clock): ImperativeAccounts = {
      val sessions = new SharedAccountSessions(c, identity, directory)
      ImperativeAccountSql.accounts(c, settings, declared, sessions, history(c, sessions), hasher, clock)
    }
    def indexing(service: IndexingService, policy: IndexingPolicy): IndexingPreferences = IndexingPreferenceSql.store(c, service, policy)
  }
}

/** The declared users' accounts over the shared tables: credential resolution (configured tokens first, then issued
  * tokens; browser sessions), password login, the five account endpoints' operations and the imperative and indexing
  * dispatch. Every account decision reads the configuration once through `current` (in the transaction where the
  * operation has one), so a reload published meanwhile decides it; every decision uses the merged directory. SQL
  * callbacks never acquire another connection or run an effect synchronously. Issued tokens carry `AccountScopes.Api`.
  */
final class DeclarativeAccountService[S <: AccountSnapshot[S]](storage: AccountStorage, current: () => S, runtime: ImperativeRuntime,
    indexing: IndexingService, indexingPolicy: IndexingPolicy, passwords: BearerSecretPasswords, installation: DeclaredInstallation[S],
    lifecycle: AccountLifecycle) {
  /** The configuration last installed; a reload's announcements compare against it. */
  private val installed = new AtomicReference[Option[S]](None)
  private def ended(credentialId: String): IO[Unit] = lifecycle match {
    case AccountLifecycle.Unobserved => IO.unit
    case AccountLifecycle.Observed(credentialEnded, _) => credentialEnded(credentialId)
  }
  private def changed(accountIds: Vector[String]): IO[Unit] = lifecycle match {
    case AccountLifecycle.Unobserved => IO.unit
    case AccountLifecycle.Observed(_, accountChanged) => accountIds.distinct.traverse_(accountChanged)
  }
  private def refuse(refusal: AccountRefusal): Nothing = throw AccountRefused(refusal)
  private def directory(store: AccountStore, s: S): Vector[AccountUser] = store.directory(s.imperative, s.declared)
  /** Startup and every reload (design §4.8.5): under the directory lock, a declared id or login equal to an
    * active or disabled imperative account fails closed before the declared directory is reconciled; an `Own`
    * installation adds the service's rule in the same transaction. */
  def install(s: S): IO[Unit] = (installation match {
    case DeclaredInstallation.Reconciled => storage.transaction(store => store.installDeclared(s.declared, s.users))
    case DeclaredInstallation.Own(own) => own(s)
  }) *> IO(installed.set(Some(s)))
  /** One reload: the next configuration is published only once installed, otherwise its failure is published
    * and every request fails closed until the configuration is repaired. Once installed, the accounts it changed
    * against the configuration installed before are announced. */
  def reloaded(next: IO[S]): IO[Either[Throwable, S]] =
    next.flatTap(s => IO(installed.get).flatMap(before => install(s) *> before.traverse_(announce(_, s)))).attempt
  /** The declared accounts whose entry or administrator flag differ, and, when the master switch went off, the
    * imperative accounts it suspends (one more read, only when observed). */
  private def announce(before: S, after: S): IO[Unit] = lifecycle match {
    case AccountLifecycle.Unobserved => IO.unit
    case AccountLifecycle.Observed(_, _) =>
      val ids = (before.users ++ after.users).map(_.id).distinct
      val declared = ids.filter(id => before.users.find(_.id == id) != after.users.find(_.id == id) || before.declared.admins(id) != after.declared.admins(id))
      val suspended = if (before.imperative.nonEmpty && after.imperative.isEmpty)
        storage.transaction(store => store.directory(before.imperative, before.declared).filter(_.origin == AccountOrigin.Imperative).map(_.id))
      else IO.pure(Vector.empty)
      suspended.flatMap(imperative => changed(declared ++ imperative))
  }
  /** Active imperative accounts that the master switch being off suspends. */
  def suspended(s: S): IO[Int] = if (s.imperative.nonEmpty) IO.pure(0) else storage.transaction(_.activeImperativeUsers())
  private def authority(c: AccountCredential): Authority = Authority(c.userId, c.userType, c.tokenId)
  private def user(users: Vector[AccountUser], id: String): AccountUser = users.find(u => u.id == id && u.enabled).getOrElse(refuse(AccountRefusal.InvalidCredentials))
  private def authenticate(s: S, secret: String, cookie: Boolean): IO[Option[Authority]] = {
    if (cookie) storage.transaction(store => store.browser(directory(store, s), secret).map(authority))
    else s.configured.authenticate(secret) match {
      case Some(token) => IO.pure(Some(Authority(token.userId, token.userType, token.tokenId)))
      case None => storage.transaction(store => store.bearer(directory(store, s), secret).map(authority))
    }
  }
  /** `select` chooses the presented credential under the configuration this decision reads. */
  def resolve(select: S => Presented): IO[Captured] = IO.defer {
    val s = current(); val selected = select(s)
    authenticate(s, selected.secret, selected.cookie).map(value => Captured(value.getOrElse(refuse(AccountRefusal.InvalidCredentials)), selected))
  }
  def live(captured: Captured): IO[Boolean] = IO.defer {
    authenticate(current(), captured.presented.secret, captured.presented.cookie).map(_.contains(captured.authority))
  }
  /** `authenticate` with the display name and, for a browser session, the administrator flag. A credential looked up in a
    * transaction is judged against the configuration current when the transaction's callback runs, not the one
    * `selected` was chosen under: a reload published while the check waited for a connection decides it. */
  private def identified(selected: S, presented: Presented): IO[Option[Identified]] = {
    def found(store: AccountStore, s: S, users: Vector[AccountUser], c: AccountCredential): Identified =
      Identified(Captured(authority(c), presented), user(users, c.userId).displayName,
        presented.cookie && accountCore(store, s, () => users).administrator(c.userId))
    def looked(lookup: (AccountStore, Vector[AccountUser]) => Option[AccountCredential]): IO[Option[Identified]] = storage.transaction { store =>
      val s = current()
      val users = directory(store, s)
      lookup(store, users).map(found(store, s, users, _))
    }
    if (presented.cookie) looked((store, users) => store.browser(users, presented.secret))
    else selected.configured.authenticate(presented.secret) match {
      case Some(token) => IO.pure(Some(Identified(Captured(Authority(token.userId, token.userType, token.tokenId), presented),
        user(selected.users, token.userId).displayName, administrator = false)))
      case None => looked((store, users) => store.bearer(users, presented.secret))
    }
  }
  /** `resolve` for a service's own routes: the credential `select` chooses under the configuration this decision reads,
    * with its display name and administrator flag. */
  def identify(select: S => Presented): IO[Identified] = IO.defer {
    val s = current(); val selected = select(s)
    identified(s, selected).map(_.getOrElse(refuse(AccountRefusal.InvalidCredentials)))
  }
  /** The captured credential under the current configuration: empty once it no longer authenticates the same authority,
    * otherwise with the display name and administrator flag read now. */
  def standing(captured: Captured): IO[Option[Identified]] = IO.defer {
    identified(current(), captured.presented).map(_.filter(_.captured.authority == captured.authority))
  }
  /** Whether `passwords` keeps `password` from being a password: with `Refused`, the secret of any configured token
    * (enabled owner or not, shared digest or not) or of a live issued token. Every canonical candidate is looked up,
    * whatever the outcome, so that the lookup does not tell a refused password from a wrong one. */
  private def bearerSecret(store: AccountStore, s: S, users: => Vector[AccountUser], password: String): Boolean =
    passwords == BearerSecretPasswords.Refused && Secrets.canonical(password) &&
      (s.configured.configures(password) | store.bearer(users, password).nonEmpty)
  /** The password to verify: a refused one is replaced by a fresh 256-bit random secret, which no stored hash verifies
    * (except with probability 2^-256), so that it fails on the path and with the failure of a wrong password, before any
    * session work. */
  private def verifiable(refused: Boolean, password: String): String = if (refused) Secrets.generate() else password
  private def browser(store: AccountStore, s: S, captured: Captured): AccountCredential = {
    if (!captured.presented.cookie) refuse(AccountRefusal.BrowserSessionRequired)
    val found = store.browser(directory(store, s), captured.presented.secret).getOrElse(refuse(AccountRefusal.InvalidCredentials))
    if (authority(found) != captured.authority) refuse(AccountRefusal.AuthorityChanged)
    found
  }
  /** The declarative password login, with the session it replaced; a refusal is raised, because it persists nothing
    * (design D27). */
  private def signIn(login: String, password: String, previous: Option[String]): IO[(SignedIn, Option[AccountCredential])] = storage.transaction { store =>
    val s = current()
    val users = directory(store, s)
    val result = store.loginReplacing(users, login, verifiable(bearerSecret(store, s, users, password), password), previous)
    (SignedIn(user(users, result.session.credential.userId), result.session), result.replaced)
  }
  /** For the imperative dispatcher's declared logins: it announces a replaced session from its reply. */
  private val declarativeLogin: DeclarativeLogin = (login, password, previous) => signIn(login, password, previous).map(_._1)
  def login(login: String, password: String, previous: Option[String]): IO[SignedIn] =
    signIn(login, password, previous).flatTap((_, replaced) => replaced.traverse_(c => ended(c.tokenId))).map(_._1)
  /** One database transaction per imperative operation; it commits whatever the operation returns, so rejections
    * keep their failure counters (design D27). The configuration is read inside the transaction, never taken from
    * the request: a reload published while the request waited (for its body or the credential gate) decides it —
    * suspension, creation flags and admin flags take effect, and a failed reload fails it closed. */
  private val transactions: ImperativeTransactions = new ImperativeTransactions {
    def run[A](work: ImperativeAccounts => A): IO[A] = storage.transaction { store =>
      val s = current()
      work(accountCore(store, s, () => directory(store, s)))
    }
  }
  private def accountCore(store: AccountStore, s: S, liveDirectory: () => Vector[AccountUser]): ImperativeAccounts =
    store.imperative(s.imperative, s.declared, liveDirectory, hasher(store, s, liveDirectory), runtime.clock)
  /** The runtime's hasher. With bearer secrets refused, a bearer secret verifies as a wrong password does, and one
    * offered as a new password is `weak-password` before it is hashed: the operation's transaction then rolls back,
    * so nothing is stored, no session replaced and nobody signed in. */
  private def hasher(store: AccountStore, s: S, liveDirectory: () => Vector[AccountUser]): PasswordHasher = passwords match {
    case BearerSecretPasswords.Accepted => runtime.hasher
    case BearerSecretPasswords.Refused => new PasswordHasher {
      def hash(chars: Array[Char]): String =
        if (bearerSecret(store, s, liveDirectory(), new String(chars))) throw AccountFailure(DeclarativeAccountService.WeakPassword)
        else runtime.hasher.hash(chars)
      def verify(chars: Array[Char], encoded: String): Boolean = {
        val refused = bearerSecret(store, s, liveDirectory(), new String(chars))
        runtime.hasher.verify(if (refused) verifiable(refused, "").toCharArray else chars, encoded)
      }
    }
  }
  /** `POST /login` while the master switch is on: declared logins take `declarativeLogin`, every other login
    * the imperative decision; the reply is decided after commit. `s` is the snapshot taken after the body
    * was read; it routes the request, and each transaction rereads the configuration. */
  def imperativeLogin(s: S, settings: ImperativeSettings, body: Json, presented: Option[String], clientAddress: String): IO[AccountReply] = {
    // Observed only: which session a sign-in replaces, one more lookup of the presented cookie.
    val prior = lifecycle match {
      case AccountLifecycle.Unobserved => IO.pure(None)
      case AccountLifecycle.Observed(_, _) => presentedSession(s, presented)
    }
    prior.flatMap(replaced => runtime.api.login(settings, s.declared, transactions, declarativeLogin,
      AccountRequest(AccountEndpoint.Post, DeclarativeAccountService.LoginPath, Some(body), Vector.empty, None, presented, clientAddress))
      .flatTap(announced(_, replaced)))
  }
  /** After a dispatcher reply, whose transaction committed: the presented session a new cookie replaced, and the accounts
    * whose rights its events changed. */
  private def announced(reply: AccountReply, presented: Option[AccountCredential]): IO[Unit] = {
    val replaced = reply.cookie match {
      case CookieEffect.Set(_) => presented.traverse_(c => ended(c.tokenId))
      case CookieEffect.Keep => IO.unit
    }
    replaced *> changed(reply.events.filter(e => DeclarativeAccountService.RightsChanging(e.kind)).flatMap(_.target))
  }
  /** Every account path other than the five existing endpoints. The presented cookie is resolved under the
    * merged directory; the dispatcher revalidates it under its owner's lock before any effect. */
  def imperativeRequest(s: S, settings: ImperativeSettings, method: String, path: String, body: Option[Json], actor: Vector[String],
      presented: Option[String], clientAddress: String): IO[AccountReply] =
    presentedSession(s, presented).flatMap { found =>
      runtime.api.handle(Some(settings), s.declared, transactions, AccountRequest(method, path, body, actor, found, presented, clientAddress))
        .flatTap(announced(_, found))
    }
  def indexingRequest(s: S, method: String, path: String, body: Option[Json], actor: Vector[String], presented: Option[String],
      clientAddress: String): IO[AccountReply] = {
    val transactions = new IndexingAccountTransactions {
      def run[A](work: (ImperativeAccounts, IndexingPreferences) => A): IO[A] = storage.transaction { store =>
        // Called with the account owner locks held, after any wait for a proof slot or those locks. A
        // role-only reload need not change a session fingerprint, so check the admitted snapshot too.
        def liveDirectory(): Vector[AccountUser] = {
          val now = current()
          if (!s.unchangedIn(now)) throw AccountFailure("conflict")
          directory(store, now)
        }
        work(accountCore(store, s, () => liveDirectory()), store.indexing(indexing, indexingPolicy))
      }
    }
    presentedSession(s, presented).flatMap(found =>
      runtime.api.handleIndexing(indexingPolicy, s.declared, transactions, AccountRequest(method, path, body, actor, found, presented, clientAddress)))
  }
  /** The presented cookie's session under the merged directory. */
  private def presentedSession(s: S, presented: Option[String]): IO[Option[AccountCredential]] = presented.filter(Secrets.canonical) match {
    case None => IO.pure(None)
    case Some(secret) => storage.transaction(store => store.browser(directory(store, s), secret))
  }
  /** `actor` is the `X-Account-Actor` values of the request; `None` for a logout without the account protocol. */
  def logout(captured: Captured, actor: Option[Vector[String]]): IO[Unit] = IO.defer {
    val s = current()
    storage.transaction { store =>
      val session = browser(store, s, captured)
      actor.foreach(AccountJson.requireActor(_, session.userId))
      store.logout(directory(store, s), captured.presented.secret)
    } *> ended(captured.authority.tokenId)
  }
  def account(captured: Captured): IO[AccountView] = IO.defer {
    val s = current()
    storage.transaction { store =>
      val session = browser(store, s, captured)
      AccountView(user(directory(store, s), session.userId), s.configured.listed(session.userId) ++ store.tokens(session.userId))
    }
  }
  def issue(captured: Captured, name: String, requested: Vector[String], actor: Vector[String]): IO[AccountIssued] = IO.defer {
    val s = current()
    storage.transaction { store =>
      // Before the scopes: after the request body this is the only lookup of the session, and one that ended is refused as such.
      val session = browser(store, s, captured)
      if (requested != AccountScopes.Api) refuse(AccountRefusal.InvalidTokenScopes)
      AccountJson.requireActor(actor, session.userId)
      store.issue(directory(store, s), session, name)
    }
  }
  def revoke(captured: Captured, id: String, actor: Vector[String]): IO[Unit] = IO.defer {
    val s = current()
    storage.transaction { store =>
      val session = browser(store, s, captured)
      AccountJson.requireActor(actor, session.userId)
      if (s.configured.listed(session.userId).exists(_.id == id)) refuse(AccountRefusal.ConfiguredTokenImmutable)
      store.revoke(directory(store, s), session, id)
    } *> ended(id)
  }
}
object DeclarativeAccountService {
  /** `POST /login` relative to `/api/account/v1`. */
  private val LoginPath = "/login"
  /** The account protocol's failure for an unacceptable new password. */
  private val WeakPassword = "weak-password"
  /** The dispatcher's events of committed changes that end or change the target account's rights. */
  private val RightsChanging: Set[AccountEventKind] = Set(AccountEventKind.Disabled, AccountEventKind.Enabled, AccountEventKind.AdminGranted,
    AccountEventKind.AdminRevoked, AccountEventKind.PasswordChanged, AccountEventKind.RecoverySucceeded, AccountEventKind.ResetRedeemed,
    AccountEventKind.TotpRequiredChanged)
}
