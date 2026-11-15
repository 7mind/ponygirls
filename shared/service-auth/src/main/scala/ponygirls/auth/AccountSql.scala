package ponygirls.auth

import java.sql.{Connection, PreparedStatement, ResultSet}
import java.time.Clock
import scala.util.Using

/** Connection-level account persistence. The caller owns admission, transaction,
  * commit/rollback and lifecycle; authentication never opens a nested connection.
  */
object AccountSql {
  private val schemaVersion = 2
  def initialize(c: Connection): Unit = {
    Sql.exec(c, "SELECT pg_advisory_xact_lock(71393723)")
    Sql.exec(c, "CREATE TABLE IF NOT EXISTS ponygirls_account_schema(version integer PRIMARY KEY CHECK(version>0))")
    val versions = Sql.rows(c, "SELECT version FROM ponygirls_account_schema ORDER BY version")(_.getInt(1))
    if (versions.nonEmpty && versions != Vector(1) && versions != Vector(schemaVersion)) throw AccountFailure("config")
    Sql.exec(c, """CREATE TABLE IF NOT EXISTS ponygirls_account_users(
      id text PRIMARY KEY, identity text NOT NULL CHECK(identity ~ '^[0-9a-f]{64}$'), enabled boolean NOT NULL)""")
    Sql.exec(c, """CREATE TABLE IF NOT EXISTS ponygirls_account_sessions(
      id text NOT NULL UNIQUE, owner text NOT NULL, digest text PRIMARY KEY CHECK(digest ~ '^[0-9a-f]{64}$'),
      password_identity text NOT NULL CHECK(password_identity ~ '^[0-9a-f]{64}$'))""")
    Sql.exec(c, "CREATE INDEX IF NOT EXISTS ponygirls_account_session_owner ON ponygirls_account_sessions(owner)")
    Sql.exec(c, """CREATE TABLE IF NOT EXISTS ponygirls_account_tokens(
      id text PRIMARY KEY, owner text NOT NULL, digest text NOT NULL UNIQUE CHECK(digest ~ '^[0-9a-f]{64}$'),
      name text NOT NULL, created_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false)""")
    Sql.exec(c, "CREATE INDEX IF NOT EXISTS ponygirls_account_token_owner ON ponygirls_account_tokens(owner)")
    if (versions == Vector(1)) Sql.exec(c, "UPDATE ponygirls_account_schema SET version=? WHERE version=1", schemaVersion)
    else Sql.exec(c, "INSERT INTO ponygirls_account_schema(version) VALUES(?) ON CONFLICT DO NOTHING", schemaVersion)
  }
  private def accounts(c: Connection): Accounts = new Accounts(new PostgresAccounts(c), Clock.systemUTC())
  def reconcile(c: Connection, users: Vector[AccountUser]): Unit = accounts(c).reconcile(users)
  def login(c: Connection, users: Vector[AccountUser], login: String, password: String): AccountSession = accounts(c).login(users, login, password)
  def loginReplacing(c: Connection, users: Vector[AccountUser], login: String, password: String, previous: Option[String]): AccountLogin =
    accounts(c).loginReplacing(users, login, password, previous)
  def browser(c: Connection, users: Vector[AccountUser], secret: String): Option[AccountCredential] = accounts(c).browser(users, secret)
  def bearer(c: Connection, users: Vector[AccountUser], secret: String): Option[AccountCredential] = accounts(c).bearer(users, secret)
  def live(c: Connection, users: Vector[AccountUser], userId: String, tokenId: String, digest: String): Boolean = accounts(c).live(users, userId, tokenId, digest)
  def logout(c: Connection, users: Vector[AccountUser], secret: String): Unit = accounts(c).logout(users, secret)
  def tokens(c: Connection, owner: String): Vector[AccountToken] = accounts(c).tokens(owner)
  def issue(c: Connection, users: Vector[AccountUser], session: AccountCredential, name: String): AccountIssued = accounts(c).issue(users, session, name)
  def revoke(c: Connection, users: Vector[AccountUser], session: AccountCredential, id: String): Unit = accounts(c).revoke(users, session, id)
}

private[auth] final class PostgresAccounts(c: Connection) extends AccountRepository {
  private def readSession(r: ResultSet): StoredSession = StoredSession(r.getString("id"), r.getString("owner"), r.getString("digest"), r.getString("password_identity"))
  private def readToken(r: ResultSet): StoredToken = StoredToken(r.getString("id"), r.getString("owner"), r.getString("digest"), r.getString("name"), r.getTimestamp("created_at").toInstant, r.getBoolean("revoked"))
  def lockOwner(owner: String): Unit = Sql.exec(c, "SELECT pg_advisory_xact_lock(hashtextextended(?,71393723))", "ponygirls-account:" + owner)
  private def readUser(r: ResultSet): StoredUser = StoredUser(r.getString("id"), r.getString("identity"), r.getBoolean("enabled"))
  def allUsers: Vector[StoredUser] = Sql.rows(c, "SELECT * FROM ponygirls_account_users")(readUser)
  def user(owner: String): Option[StoredUser] = Sql.rows(c, "SELECT * FROM ponygirls_account_users WHERE id=?", owner)(readUser).headOption
  def putUser(row: StoredUser): Unit = Sql.exec(c, "INSERT INTO ponygirls_account_users(id,identity,enabled) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET identity=excluded.identity,enabled=excluded.enabled", row.id, row.identity, row.enabled)
  def sessions: Vector[StoredSession] = Sql.rows(c, "SELECT * FROM ponygirls_account_sessions")(readSession)
  def session(digest: String): Option[StoredSession] = Sql.rows(c, "SELECT * FROM ponygirls_account_sessions WHERE digest=?", digest)(readSession).headOption
  def insertSession(row: StoredSession): Unit = Sql.exec(c, "INSERT INTO ponygirls_account_sessions(id,owner,digest,password_identity) VALUES(?,?,?,?)", row.id, row.owner, row.digest, row.passwordIdentity)
  def deleteSession(digest: String): Unit = Sql.exec(c, "DELETE FROM ponygirls_account_sessions WHERE digest=?", digest)
  def allTokens: Vector[StoredToken] = Sql.rows(c, "SELECT * FROM ponygirls_account_tokens")(readToken)
  def tokenByDigest(digest: String): Option[StoredToken] = Sql.rows(c, "SELECT * FROM ponygirls_account_tokens WHERE digest=?", digest)(readToken).headOption
  def token(id: String): Option[StoredToken] = Sql.rows(c, "SELECT * FROM ponygirls_account_tokens WHERE id=?", id)(readToken).headOption
  def tokens(owner: String): Vector[StoredToken] = Sql.rows(c, "SELECT * FROM ponygirls_account_tokens WHERE owner=? ORDER BY revoked,created_at,id", owner)(readToken)
  def insertToken(row: StoredToken): Unit = Sql.exec(c, "INSERT INTO ponygirls_account_tokens(id,owner,digest,name,created_at,revoked) VALUES(?,?,?,?,?::timestamptz,?)", row.id, row.owner, row.digest, row.name, row.createdAt.toString, row.revoked)
  def revokeToken(id: String): Unit = Sql.exec(c, "UPDATE ponygirls_account_tokens SET revoked=true WHERE id=?", id)
  def deleteToken(id: String): Unit = Sql.exec(c, "DELETE FROM ponygirls_account_tokens WHERE id=?", id)
}

private object Sql {
  type Param = String | Int | Boolean
  private def bind(p: PreparedStatement, args: Seq[Param]): Unit = args.zipWithIndex.foreach { case (value, index) => value match {
    case text: String => p.setString(index + 1, text)
    case number: Int => p.setInt(index + 1, number)
    case flag: Boolean => p.setBoolean(index + 1, flag)
  }}
  def exec(c: Connection, sql: String, args: Param*): Unit = Using.resource(c.prepareStatement(sql)) { statement =>
    bind(statement, args)
    statement.execute()
    ()
  }
  def rows[A](c: Connection, sql: String, args: Param*)(read: ResultSet => A): Vector[A] = Using.resource(c.prepareStatement(sql)) { statement =>
    bind(statement, args)
    Using.resource(statement.executeQuery()) { result =>
      val rows = Vector.newBuilder[A]
      while (result.next()) rows += read(result)
      rows.result()
    }
  }
}
