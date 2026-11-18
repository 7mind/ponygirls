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
  def establish(user: AccountUser, replaced: Option[String]): AccountSession = {
    val session = AccountSql.establish(c, keyed(directory().filterNot(_.id == user.id) :+ user), ownerKey(user.id), replaced).session
    session.copy(credential = session.credential.copy(userId = user.id))
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
