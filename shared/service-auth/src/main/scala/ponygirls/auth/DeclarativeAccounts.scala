package ponygirls.auth

import cats.effect.{IO, Resource}
import io.circe.Json
import java.sql.Connection
import java.time.Clock
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

/** Why the account service refused. Each service maps a refusal to its own failure. */
enum AccountRefusal {
  case InvalidCredentials, BrowserSessionRequired, AuthorityChanged, InvalidTokenScopes, ConfiguredTokenImmutable
}
final case class AccountRefused(refusal: AccountRefusal) extends RuntimeException(refusal.toString)

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
    indexing: IndexingService, indexingPolicy: IndexingPolicy) {
  private def refuse(refusal: AccountRefusal): Nothing = throw AccountRefused(refusal)
  private def directory(store: AccountStore, s: S): Vector[AccountUser] = store.directory(s.imperative, s.declared)
  /** Startup and every reload (design §4.8.5): under the directory lock, a declared id or login equal to an
    * active or disabled imperative account fails closed before the declared directory is reconciled. */
  def install(s: S): IO[Unit] = storage.transaction(store => store.installDeclared(s.declared, s.users))
  /** One reload: the next configuration is published only once installed, otherwise its failure is published
    * and every request fails closed until the configuration is repaired. */
  def reloaded(next: IO[S]): IO[Either[Throwable, S]] = next.flatTap(install).attempt
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
  private def browser(store: AccountStore, s: S, captured: Captured): AccountCredential = {
    if (!captured.presented.cookie) refuse(AccountRefusal.BrowserSessionRequired)
    val found = store.browser(directory(store, s), captured.presented.secret).getOrElse(refuse(AccountRefusal.InvalidCredentials))
    if (authority(found) != captured.authority) refuse(AccountRefusal.AuthorityChanged)
    found
  }
  /** The declarative password login; a refusal is raised, because it persists nothing (design D27). */
  private val declarativeLogin: DeclarativeLogin = (login, password, previous) => storage.transaction { store =>
    val users = directory(store, current())
    val result = store.loginReplacing(users, login, password, previous)
    SignedIn(user(users, result.session.credential.userId), result.session)
  }
  def login(login: String, password: String, previous: Option[String]): IO[SignedIn] = declarativeLogin.login(login, password, previous)
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
    store.imperative(s.imperative, s.declared, liveDirectory, runtime.hasher, runtime.clock)
  /** `POST /login` while the master switch is on: declared logins take `declarativeLogin`, every other login
    * the imperative decision; the reply is decided after commit. `s` is the snapshot taken after the body
    * was read; it routes the request, and each transaction rereads the configuration. */
  def imperativeLogin(s: S, settings: ImperativeSettings, body: Json, presented: Option[String], clientAddress: String): IO[AccountReply] =
    runtime.api.login(settings, s.declared, transactions, declarativeLogin,
      AccountRequest(AccountEndpoint.Post, DeclarativeAccountService.LoginPath, Some(body), Vector.empty, None, presented, clientAddress))
  /** Every account path other than the five existing endpoints. The presented cookie is resolved under the
    * merged directory; the dispatcher revalidates it under its owner's lock before any effect. */
  def imperativeRequest(s: S, settings: ImperativeSettings, method: String, path: String, body: Option[Json], actor: Vector[String],
      presented: Option[String], clientAddress: String): IO[AccountReply] =
    accountRequest(s, method, path, body, actor, presented, clientAddress).flatMap(runtime.api.handle(Some(settings), s.declared, transactions, _))
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
    accountRequest(s, method, path, body, actor, presented, clientAddress).flatMap(runtime.api.handleIndexing(indexingPolicy, s.declared, transactions, _))
  }
  private def accountRequest(s: S, method: String, path: String, body: Option[Json], actor: Vector[String], presented: Option[String],
      clientAddress: String): IO[AccountRequest] = {
    val session = presented.filter(Secrets.canonical) match {
      case None => IO.pure(None)
      case Some(secret) => storage.transaction(store => store.browser(directory(store, s), secret))
    }
    session.map(found => AccountRequest(method, path, body, actor, found, presented, clientAddress))
  }
  /** `actor` is the `X-Account-Actor` values of the request; `None` for a logout without the account protocol. */
  def logout(captured: Captured, actor: Option[Vector[String]]): IO[Unit] = IO.defer {
    val s = current()
    storage.transaction { store =>
      val session = browser(store, s, captured)
      actor.foreach(AccountJson.requireActor(_, session.userId))
      store.logout(directory(store, s), captured.presented.secret)
    }
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
    }
  }
}
object DeclarativeAccountService {
  /** `POST /login` relative to `/api/account/v1`. */
  private val LoginPath = "/login"
}
