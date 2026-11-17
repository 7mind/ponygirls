package ponygirls.auth

import java.time.{Clock, Instant}
import java.time.temporal.ChronoUnit
import java.util.UUID

private[auth] final case class StoredUser(id: String, identity: String, enabled: Boolean)
private[auth] final case class StoredSession(id: String, owner: String, digest: String, passwordIdentity: String)
private[auth] final case class StoredToken(id: String, owner: String, digest: String, name: String, createdAt: Instant, revoked: Boolean)

private[auth] trait AccountRepository {
  /** Level 1 of the lock order (design D22); every fingerprint write happens under it. */
  def lockDirectory(): Unit
  def lockOwner(owner: String): Unit
  def allUsers: Vector[StoredUser]
  def user(owner: String): Option[StoredUser]
  def putUser(row: StoredUser): Unit
  def sessions: Vector[StoredSession]
  def ownerSessions(owner: String): Vector[StoredSession]
  def session(digest: String): Option[StoredSession]
  def insertSession(row: StoredSession): Unit
  def deleteSession(digest: String): Unit
  def allTokens: Vector[StoredToken]
  def tokenByDigest(digest: String): Option[StoredToken]
  def token(id: String): Option[StoredToken]
  def tokens(owner: String): Vector[StoredToken]
  def insertToken(row: StoredToken): Unit
  def revokeToken(id: String): Unit
  def deleteToken(id: String): Unit
}

private[auth] final class Accounts(repository: AccountRepository, clock: Clock) {
  def this(repository: AccountRepository) = this(repository, Clock.systemUTC())
  private def check(ok: Boolean, code: String): Unit = if (!ok) throw AccountFailure(code)
  private def directory(users: Vector[AccountUser]): Map[String, AccountUser] = {
    check(users.map(_.id).distinct.size == users.size, "config")
    val logins = users.flatMap(_.login)
    check(logins.distinct.size == logins.size, "config")
    users.foreach { user =>
      check(user.id.nonEmpty && user.id.length <= 128 && !user.id.contains('\u0000') && Set("human", "agent").contains(user.userType), "config")
      check(user.login.isDefined == user.passwordHash.isDefined && (user.login.isEmpty || user.userType == "human"), "config")
      user.login.foreach(value => check(value.nonEmpty && value.length <= 128 && !value.exists(_.isControl), "config"))
      user.passwordHash.foreach(value => check(Password.validHash(value), "config"))
    }
    users.map(user => user.id -> user).toMap
  }
  private def eligible(user: AccountUser): Boolean = user.enabled && user.userType == "human"
  private def stored(user: AccountUser): StoredUser = StoredUser(user.id, Secrets.digest(Vector(user.id, user.userType,
    user.login.getOrElse(""), user.passwordHash.map(Secrets.digest).getOrElse(""), user.enabled.toString).mkString("\u0000")), user.enabled)
  // An imperative entry's authority is the live row its caller read in the same transaction.
  private def current(user: AccountUser): Boolean = user.origin match {
    case AccountOrigin.Declarative => repository.user(user.id).contains(stored(user))
    case AccountOrigin.Imperative => true
  }
  private def sessionLive(row: StoredSession, users: Map[String, AccountUser]): Boolean = users.get(row.owner).exists { user =>
    eligible(user) && current(user) && user.passwordHash.exists(hash => Secrets.equal(Secrets.digest(hash), row.passwordIdentity))
  }
  private def credential(user: AccountUser, id: String, digest: String, browser: Boolean): AccountCredential =
    AccountCredential(user.id, user.userType, id, digest, browser)
  private def listed(row: StoredToken): AccountToken = AccountToken(row.id, row.name, "issued", Some(row.createdAt.toString), row.revoked, Vector("api"))
  private def pruneRevoked(owner: String): Unit =
    repository.tokens(owner).filter(_.revoked).sortBy(row => (row.createdAt, row.id)).dropRight(Accounts.maximumRetainedRevoked)
      .foreach(old => repository.deleteToken(old.id))
  private def sessionAuthority(users: Vector[AccountUser], session: AccountCredential): AccountUser = {
    check(session.browser, "forbidden")
    val all = directory(users)
    repository.lockOwner(session.userId)
    val valid = repository.session(session.digest).exists(row => row.id == session.tokenId && row.owner == session.userId && sessionLive(row, all))
    check(valid && session.userType == "human", "unauthorized")
    all(session.userId)
  }
  /** Reconciles the declarative directory. Its scope is the declared owners and the owners with a
    * fingerprint row; imperative owners have none and are never touched. When every declared user's
    * fingerprint is current and every other fingerprint is disabled, it returns without locks or writes.
    * Otherwise it takes the directory lock before reading its scope: fingerprint rows are written only
    * under that lock, so the scope cannot grow before its owner locks are acquired.
    */
  def reconcile(users: Vector[AccountUser]): Unit = {
    val all = directory(users)
    check(users.forall(_.origin == AccountOrigin.Declarative), "config")
    def unchanged(rows: Vector[StoredUser]): Boolean = {
      val fingerprints = rows.map(row => row.id -> row).toMap
      users.forall(user => fingerprints.get(user.id).contains(stored(user))) && rows.forall(row => all.contains(row.id) || !row.enabled)
    }
    if (!unchanged(repository.allUsers)) {
      repository.lockDirectory()
      val rows = repository.allUsers
      if (!unchanged(rows)) {
        val scope = (all.keySet ++ rows.map(_.id)).toVector
        lockOwners(scope, Vector.empty)
        rows.filterNot(row => all.contains(row.id)).foreach(row => repository.putUser(row.copy(enabled = false)))
        users.foreach(user => repository.putUser(stored(user)))
        val inScope = scope.toSet
        repository.sessions.filter(row => inScope(row.owner) && !sessionLive(row, all)).foreach(row => repository.deleteSession(row.digest))
        repository.allTokens.filter(row => inScope(row.owner) && !row.revoked && !all.get(row.owner).exists(eligible)).foreach(row => repository.revokeToken(row.id))
        scope.foreach(pruneRevoked)
      }
    }
  }
  /** Lock order of design D22: declarative-scope owners sorted, then imperative owners sorted.
    * A transaction acquires its complete owner set through one call, after any directory lock.
    */
  def lockOwners(declarative: Vector[String], imperative: Vector[String]): Unit = {
    check(declarative.intersect(imperative).isEmpty, "config")
    (declarative.distinct.sorted ++ imperative.distinct.sorted).foreach(repository.lockOwner)
  }
  private def lockUsers(users: Vector[AccountUser]): Unit = {
    val (declarative, imperative) = users.partition(_.origin == AccountOrigin.Declarative)
    lockOwners(declarative.map(_.id), imperative.map(_.id))
  }
  private def verifiedLogin(users: Vector[AccountUser], login: String, password: String): AccountUser = {
    check(login.nonEmpty && login.length <= 128 && password.nonEmpty && password.length <= 1024, "invalid")
    val all = directory(users)
    val selected = all.values.find(user => user.origin == AccountOrigin.Declarative && eligible(user) && user.login.contains(login))
    val chars = password.toCharArray
    val verified = try Password.verify(chars, selected.flatMap(_.passwordHash).getOrElse(Password.dummyHash))
      finally java.util.Arrays.fill(chars, '\u0000')
    check(selected.nonEmpty && verified, "unauthorized")
    selected.get
  }
  def login(users: Vector[AccountUser], login: String, password: String): AccountSession =
    establish(users, verifiedLogin(users, login, password).id, None).session
  def loginReplacing(users: Vector[AccountUser], loginName: String, password: String, previous: Option[String]): AccountLogin =
    establish(users, verifiedLogin(users, loginName, password).id, previous)
  /** Creates a browser session for a user whose credentials the caller has already verified and,
    * atomically, revokes the presented previous session when it is valid.
    */
  def establish(users: Vector[AccountUser], userId: String, previous: Option[String]): AccountLogin = {
    val all = directory(users)
    val user = all.get(userId).filter(user => eligible(user) && user.passwordHash.nonEmpty).getOrElse(throw AccountFailure("unauthorized"))
    // The previous session's owner is locked whether or not that session is valid yet: it can become
    // valid before the locks are held, and its owner must never be acquired after the target.
    val priorOwner = previous.filter(Secrets.canonical).flatMap(secret => repository.session(Secrets.digest(secret))).flatMap(row => all.get(row.owner))
    lockUsers((Vector(user) ++ priorOwner).distinct)
    check(current(user), "unauthorized")
    val secret = Secrets.generate()
    val digest = Secrets.digest(secret)
    val id = "session-" + UUID.randomUUID().toString
    repository.insertSession(StoredSession(id, user.id, digest, Secrets.digest(user.passwordHash.get)))
    val replaced = previous.flatMap(secret => browser(users, secret))
    check(replaced.forall(prior => priorOwner.exists(_.id == prior.userId)), "unavailable")
    replaced.foreach(prior => repository.deleteSession(prior.digest))
    AccountLogin(AccountSession(credential(user, id, digest, true), secret), replaced)
  }
  /** Deletes the owner's browser sessions except `keep`, under that owner's lock. */
  def revokeSessions(owner: String, keep: Option[AccountCredential]): Unit = {
    repository.lockOwner(owner)
    repository.ownerSessions(owner).filterNot(row => keep.exists(kept => kept.userId == owner && kept.digest == row.digest))
      .foreach(row => repository.deleteSession(row.digest))
  }
  /** Marks every issued token of the owner revoked, under that owner's lock. */
  def revokeTokens(owner: String): Unit = {
    repository.lockOwner(owner)
    repository.tokens(owner).filterNot(_.revoked).foreach(row => repository.revokeToken(row.id))
    pruneRevoked(owner)
  }
  def browser(users: Vector[AccountUser], secret: String): Option[AccountCredential] = {
    val all = directory(users)
    if (!Secrets.canonical(secret)) None
    else repository.session(Secrets.digest(secret)).filter(sessionLive(_, all)).map(row => credential(all(row.owner), row.id, row.digest, true))
  }
  def bearer(users: Vector[AccountUser], secret: String): Option[AccountCredential] = {
    val all = directory(users)
    if (!Secrets.canonical(secret)) None
    else repository.tokenByDigest(Secrets.digest(secret)).filter(row => !row.revoked && all.get(row.owner).exists(user => eligible(user) && current(user)))
      .map(row => credential(all(row.owner), row.id, row.digest, false))
  }
  def live(users: Vector[AccountUser], owner: String, id: String, digest: String): Boolean = {
    val all = directory(users)
    repository.session(digest).exists(row => row.owner == owner && row.id == id && sessionLive(row, all)) ||
      repository.tokenByDigest(digest).exists(row => row.owner == owner && row.id == id && !row.revoked && all.get(row.owner).exists(user => eligible(user) && current(user)))
  }
  def logout(users: Vector[AccountUser], secret: String): Unit = {
    val current = browser(users, secret).getOrElse(throw AccountFailure("unauthorized"))
    sessionAuthority(users, current)
    repository.deleteSession(current.digest)
  }
  def tokens(owner: String): Vector[AccountToken] = repository.tokens(owner).map(listed)
  def issue(users: Vector[AccountUser], session: AccountCredential, name: String): AccountIssued = {
    check(name.nonEmpty && name.length <= 128 && !name.exists(_.isControl), "invalid")
    val user = sessionAuthority(users, session)
    check(repository.tokens(user.id).count(!_.revoked) < Accounts.maximumActiveTokens, "invalid")
    val secret = Secrets.generate()
    val row = StoredToken("issued-" + UUID.randomUUID().toString, user.id, Secrets.digest(secret), name,
      clock.instant().truncatedTo(ChronoUnit.MICROS), false)
    repository.insertToken(row)
    AccountIssued(listed(row), secret)
  }
  def revoke(users: Vector[AccountUser], session: AccountCredential, id: String): Unit = {
    val user = sessionAuthority(users, session)
    val row = repository.token(id).filter(_.owner == user.id).getOrElse(throw AccountFailure("not-found"))
    repository.revokeToken(row.id)
    pruneRevoked(user.id)
  }
}
private[auth] object Accounts {
  val maximumActiveTokens = 100
  val maximumRetainedRevoked = 100
}
