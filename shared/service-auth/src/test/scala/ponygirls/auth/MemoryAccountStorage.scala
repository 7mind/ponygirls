package ponygirls.auth

import cats.effect.IO
import java.time.Clock

/** Handwritten in-memory `AccountStorage`: the shared `Accounts` and imperative core over in-memory rows, and
  * in-memory indexing preferences, on the given clock. One transaction at a time; a transaction that throws leaves
  * every row as it was. */
final class MemoryAccountStorage(clock: Clock) extends AccountStorage {
  private final class Rows extends AccountRepository {
    var users = Map.empty[String, StoredUser]
    var sessionRows = Map.empty[String, StoredSession]
    var tokenRows = Map.empty[String, StoredToken]
    def lockDirectory(): Unit = ()
    def lockOwner(owner: String): Unit = ()
    def allUsers: Vector[StoredUser] = users.values.toVector
    def user(owner: String): Option[StoredUser] = users.get(owner)
    def putUser(row: StoredUser): Unit = users = users.updated(row.id, row)
    def sessions: Vector[StoredSession] = sessionRows.values.toVector
    def ownerSessions(owner: String): Vector[StoredSession] = sessionRows.values.filter(_.owner == owner).toVector
    def session(digest: String): Option[StoredSession] = sessionRows.get(digest)
    def insertSession(row: StoredSession): Unit = {
      if (sessionRows.contains(row.digest) || sessionRows.values.exists(_.id == row.id)) throw new IllegalStateException("duplicate session")
      sessionRows = sessionRows.updated(row.digest, row)
    }
    def deleteSession(digest: String): Unit = sessionRows = sessionRows.removed(digest)
    def allTokens: Vector[StoredToken] = tokenRows.values.toVector
    def tokenByDigest(digest: String): Option[StoredToken] = tokenRows.values.find(_.digest == digest)
    def token(id: String): Option[StoredToken] = tokenRows.get(id)
    def tokens(owner: String): Vector[StoredToken] = tokenRows.values.filter(_.owner == owner).toVector.sortBy(t => (t.revoked, t.createdAt, t.id))
    def insertToken(row: StoredToken): Unit = {
      if (tokenRows.contains(row.id) || tokenRows.values.exists(_.digest == row.digest)) throw new IllegalStateException("duplicate token")
      tokenRows = tokenRows.updated(row.id, row)
    }
    def revokeToken(id: String): Unit = tokenRows = tokenRows.updated(id, tokenRows(id).copy(revoked = true))
    def deleteToken(id: String): Unit = tokenRows = tokenRows.removed(id)
  }
  private val rows = new Rows
  private val imperativeUsers = new MemoryImperativeUsers
  private var preferences = Map.empty[(IndexingService, String), IndexingPreference]
  private var open = false
  private val accounts = new Accounts(rows, clock)

  def transaction[A](work: AccountStore => A): IO[A] = IO.blocking(synchronized {
    if (open) throw new IllegalStateException("nested transaction")
    open = true
    val (users, sessions, tokens, saved) = (rows.users, rows.sessionRows, rows.tokenRows, preferences)
    try imperativeUsers.transaction(work(store))
    catch {
      case failure: Throwable =>
        rows.users = users; rows.sessionRows = sessions; rows.tokenRows = tokens; preferences = saved
        throw failure
    } finally open = false
  })

  /** `AccountSessions` and `IdentityHistory` over the in-memory rows, with owner keys equal to user ids. */
  private final class Sessions(directory: () => Vector[AccountUser]) extends AccountSessions with IdentityHistory {
    def lockOwners(declarative: Vector[String], imperative: Vector[String]): Unit = accounts.lockOwners(declarative, imperative)
    def sessionOwner(secret: String): Option[String] =
      Some(secret).filter(Secrets.canonical).flatMap(value => rows.session(Secrets.digest(value))).map(_.owner).filter(owner => directory().exists(_.id == owner))
    def live(session: AccountCredential): Boolean = accounts.live(directory(), session.userId, session.tokenId, session.digest)
    def establish(user: AccountUser, replaced: Option[String]): AccountSession =
      accounts.establish(directory().filterNot(_.id == user.id) :+ user, user.id, replaced).session
    def revokeSessions(userId: String, keep: Option[AccountCredential]): Unit = accounts.revokeSessions(userId, keep)
    def revokeTokens(userId: String): Unit = accounts.revokeTokens(userId)
    def activated(user: AccountUser): Unit = ()
    def updated(user: AccountUser): Unit = ()
    def retained(username: String): Boolean = rows.users.keys.exists(id => id == username || id.toLowerCase(java.util.Locale.ROOT) == username)
  }
  private def core(settings: Option[ImperativeSettings], declared: DeclaredDirectory, directory: () => Vector[AccountUser],
      hasher: PasswordHasher, clock: Clock): ImperativeAccounts = {
    val sessions = new Sessions(directory)
    imperativeUsers.accounts(settings, declared, sessions, sessions, hasher, clock)
  }
  private object store extends AccountStore {
    def directory(settings: Option[ImperativeSettings], declared: DeclaredDirectory): Vector[AccountUser] =
      core(settings, declared, () => Vector.empty, PasswordHasher.Pbkdf2, clock).directory
    def installDeclared(declared: DeclaredDirectory, users: Vector[AccountUser]): Unit = {
      rows.lockDirectory()
      directory(None, declared)
      accounts.reconcile(users)
    }
    def activeImperativeUsers(): Int = imperativeUsers.users.count(_.status == AccountStatus.Active)
    def browser(users: Vector[AccountUser], secret: String): Option[AccountCredential] = accounts.browser(users, secret)
    def bearer(users: Vector[AccountUser], secret: String): Option[AccountCredential] = accounts.bearer(users, secret)
    def loginReplacing(users: Vector[AccountUser], login: String, password: String, previous: Option[String]): AccountLogin =
      accounts.loginReplacing(users, login, password, previous)
    def logout(users: Vector[AccountUser], secret: String): Unit = accounts.logout(users, secret)
    def tokens(owner: String): Vector[AccountToken] = accounts.tokens(owner)
    def issue(users: Vector[AccountUser], session: AccountCredential, name: String): AccountIssued = accounts.issue(users, session, name)
    def revoke(users: Vector[AccountUser], session: AccountCredential, id: String): Unit = accounts.revoke(users, session, id)
    def imperative(settings: Option[ImperativeSettings], declared: DeclaredDirectory, directory: () => Vector[AccountUser],
        hasher: PasswordHasher, clock: Clock): ImperativeAccounts = core(settings, declared, directory, hasher, clock)
    def indexing(service: IndexingService, policy: IndexingPolicy): IndexingPreferences = new IndexingPreferences {
      def lock(owner: String): Unit = ()
      def get(owner: String): IndexingPreference = preferences.getOrElse(service -> owner, IndexingPreference.inherited)
      private def save(owner: String, wanted: IndexingPreference): IndexingPreference = {
        val before = get(owner)
        if (before == wanted) before
        else {
          val next = wanted.copy(epoch = if (before.enabled(policy) == wanted.enabled(policy)) before.epoch else before.epoch + 1)
          preferences = preferences.updated(service -> owner, next)
          next
        }
      }
      def setChoice(owner: String, choice: IndexingChoice): IndexingPreference = save(owner, get(owner).copy(choice = choice))
      def setOverride(owner: String, overrideChoice: IndexingChoice): IndexingPreference = save(owner, get(owner).copy(overrideChoice = overrideChoice))
    }
  }
}
