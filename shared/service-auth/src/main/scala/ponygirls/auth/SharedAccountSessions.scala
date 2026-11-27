package ponygirls.auth

import java.sql.Connection

/** `AccountSessions` over the shared account tables of `AccountSql` (Haystack, Manure), and the shared part of
  * `IdentityHistory`. `ownerKey` maps a public user id to its owner key in those tables (Haystack: the identity;
  * Manure: its digest mapping). `directory` reads the merged directory (`ImperativeAccountSql.directory`) on the
  * same connection; it is read again on every call, because an operation changes it within its transaction.
  * Owner locks keep their existing keys, so imperative and declarative operations of one owner serialise.
  */
final class SharedAccountSessions(c: Connection, ownerKey: String => String, directory: () => Vector[AccountUser])
  extends AccountSessions with IdentityHistory {
  import ImperativeStatements.{query, text}

  private def keyed(users: Vector[AccountUser]): Vector[AccountUser] = users.map(user => user.copy(id = ownerKey(user.id)))
  private def keyed(credential: AccountCredential): AccountCredential = credential.copy(userId = ownerKey(credential.userId))

  def lockOwners(declarative: Vector[String], imperative: Vector[String]): Unit =
    AccountSql.lockOwners(c, declarative.map(ownerKey), imperative.map(ownerKey))
  /** Resolved through the directory: the owner of a session outside it cannot be validated by `establish` either. */
  def sessionOwner(secret: String): Option[String] =
    if (!Secrets.canonical(secret)) None
    else query(c, "SELECT owner FROM ponygirls_account_sessions WHERE digest=?", text(Secrets.digest(secret)))(_.getString(1)).headOption
      .flatMap(owner => directory().find(user => ownerKey(user.id) == owner).map(_.id))
  def live(session: AccountCredential): Boolean =
    AccountSql.live(c, keyed(directory()), ownerKey(session.userId), session.tokenId, session.digest)
  def establish(user: AccountUser, replaced: Option[String]): AccountSession = establishing(user, replaced).session
  /** `establish` with the session it replaced. */
  def establishing(user: AccountUser, replaced: Option[String]): AccountLogin = {
    val login = AccountSql.establish(c, keyed(directory().filterNot(_.id == user.id) :+ user), ownerKey(user.id), replaced)
    AccountLogin(login.session.copy(credential = login.session.credential.copy(userId = user.id)), login.replaced)
  }
  def revokeSessions(userId: String, keep: Option[AccountCredential]): Unit = AccountSql.revokeSessions(c, ownerKey(userId), keep.map(keyed))
  def revokeTokens(userId: String): Unit = AccountSql.revokeTokens(c, ownerKey(userId))
  def activated(user: AccountUser): Unit = ()
  def updated(user: AccountUser): Unit = ()
  /** A fingerprint row, live or tombstoned, under the name's owner key or, ASCII case-insensitively, under the name itself. */
  def retained(username: String): Boolean = query(c,
    "SELECT EXISTS(SELECT 1 FROM ponygirls_account_users WHERE id=? OR translate(id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=?)",
    text(ownerKey(username)), text(username))(_.getBoolean(1)).head
}

/** What one transaction ended or changed, for the account service's lifecycle notifications: the credentials it ended
  * (by id) and the accounts whose rights it ended or changed, each in order. Filled inside the transaction; told only
  * once it committed. */
final class LifecycleRecord private[auth] () {
  private val endedIds = Vector.newBuilder[String]
  private val changedIds = Vector.newBuilder[String]
  private[auth] def ended(credentialId: String): Unit = synchronized { endedIds += credentialId; () }
  private[auth] def changed(accountId: String): Unit = synchronized { changedIds += accountId; () }
  private[auth] def credentials: Vector[String] = synchronized(endedIds.result().distinct)
  private[auth] def accounts: Vector[String] = synchronized(changedIds.result().distinct)
}

/** The imperative core's sessions over the shared tables, recording for the lifecycle what they end and change: the
  * session a sign-in replaced (carried out of `establishing`), and the account whose sessions or tokens are revoked,
  * that becomes active, whose password, enabled state or administrator flag changed. */
private[auth] final class RecordingSessions(shared: SharedAccountSessions, record: LifecycleRecord) extends AccountSessions {
  def lockOwners(declarative: Vector[String], imperative: Vector[String]): Unit = shared.lockOwners(declarative, imperative)
  def sessionOwner(secret: String): Option[String] = shared.sessionOwner(secret)
  def live(session: AccountCredential): Boolean = shared.live(session)
  def establish(user: AccountUser, replaced: Option[String]): AccountSession = {
    val login = shared.establishing(user, replaced)
    login.replaced.foreach(previous => record.ended(previous.tokenId))
    login.session
  }
  def revokeSessions(userId: String, keep: Option[AccountCredential]): Unit = { shared.revokeSessions(userId, keep); record.changed(userId) }
  def revokeTokens(userId: String): Unit = { shared.revokeTokens(userId); record.changed(userId) }
  def activated(user: AccountUser): Unit = { shared.activated(user); record.changed(user.id) }
  def updated(user: AccountUser): Unit = { shared.updated(user); record.changed(user.id) }
  override def adminChanged(userId: String): Unit = { shared.adminChanged(userId); record.changed(userId) }
}
