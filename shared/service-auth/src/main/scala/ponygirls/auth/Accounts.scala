package ponygirls.auth

import java.time.{Clock, Instant}
import java.time.temporal.ChronoUnit
import java.util.UUID

private[auth] final case class StoredSession(id: String, owner: String, digest: String, passwordIdentity: String)
private[auth] final case class StoredToken(id: String, owner: String, digest: String, name: String, createdAt: Instant, revoked: Boolean)

private[auth] trait AccountRepository {
  def lockOwner(owner: String): Unit
  def sessions: Vector[StoredSession]
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
  private def sessionLive(row: StoredSession, users: Map[String, AccountUser]): Boolean = users.get(row.owner).exists { user =>
    eligible(user) && user.passwordHash.exists(hash => Secrets.equal(Secrets.digest(hash), row.passwordIdentity))
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
  def reconcile(users: Vector[AccountUser]): Unit = {
    val all = directory(users)
    val owners = (all.keySet ++ repository.sessions.map(_.owner) ++ repository.allTokens.map(_.owner)).toVector.sorted
    owners.foreach(repository.lockOwner)
    repository.sessions.filterNot(sessionLive(_, all)).foreach(row => repository.deleteSession(row.digest))
    repository.allTokens.filter(row => !all.get(row.owner).exists(eligible)).foreach(row => repository.revokeToken(row.id))
    owners.foreach(pruneRevoked)
  }
  def login(users: Vector[AccountUser], login: String, password: String): AccountSession = {
    check(login.nonEmpty && login.length <= 128 && password.nonEmpty && password.length <= 1024, "invalid")
    val all = directory(users)
    val selected = all.values.find(user => eligible(user) && user.login.contains(login))
    val chars = password.toCharArray
    val verified = try Password.verify(chars, selected.flatMap(_.passwordHash).getOrElse(Password.dummyHash))
      finally java.util.Arrays.fill(chars, '\u0000')
    check(selected.nonEmpty && verified, "unauthorized")
    val user = selected.get
    repository.lockOwner(user.id)
    val secret = Secrets.generate()
    val digest = Secrets.digest(secret)
    val id = "session-" + UUID.randomUUID().toString
    repository.insertSession(StoredSession(id, user.id, digest, Secrets.digest(user.passwordHash.get)))
    AccountSession(credential(user, id, digest, true), secret)
  }
  def browser(users: Vector[AccountUser], secret: String): Option[AccountCredential] = {
    val all = directory(users)
    if (!Secrets.canonical(secret)) None
    else repository.session(Secrets.digest(secret)).filter(sessionLive(_, all)).map(row => credential(all(row.owner), row.id, row.digest, true))
  }
  def bearer(users: Vector[AccountUser], secret: String): Option[AccountCredential] = {
    val all = directory(users)
    if (!Secrets.canonical(secret)) None
    else repository.tokenByDigest(Secrets.digest(secret)).filter(row => !row.revoked && all.get(row.owner).exists(eligible))
      .map(row => credential(all(row.owner), row.id, row.digest, false))
  }
  def live(users: Vector[AccountUser], owner: String, id: String, digest: String): Boolean = {
    val all = directory(users)
    repository.session(digest).exists(row => row.owner == owner && row.id == id && sessionLive(row, all)) ||
      repository.tokenByDigest(digest).exists(row => row.owner == owner && row.id == id && !row.revoked && all.get(row.owner).exists(eligible))
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
