package ponygirls.auth

import java.sql.{Connection, PreparedStatement, ResultSet, SQLException, Types}
import java.time.{Clock, Instant, OffsetDateTime, ZoneOffset}
import scala.util.Using

/** Connection-level facade of imperative accounts for the service adapters. The caller owns the transaction,
  * commits whatever an operation returns (design D27) and rolls back on a thrown fault.
  */
object ImperativeAccountSql {
  private val SchemaVersion = 1
  /** The key `AccountSql.initialize` locks: the two initializers serialise with each other. */
  private val InitializationLock = 71393723

  /** Idempotent and additive; `ponygirls_account_schema` is not touched, so older binaries keep starting (design D15). */
  def initialize(c: Connection): Unit = {
    ImperativeStatements.update(c, "SELECT pg_advisory_xact_lock(?)", SqlValue.Integer(InitializationLock))
    ImperativeStatements.update(c, "CREATE TABLE IF NOT EXISTS ponygirls_imperative_schema(version integer PRIMARY KEY CHECK(version>0))")
    val versions = ImperativeStatements.query(c, "SELECT version FROM ponygirls_imperative_schema ORDER BY version")(_.getInt(1))
    if (versions.nonEmpty && versions != Vector(SchemaVersion)) throw AccountFailure("config")
    ImperativeStatements.update(c, """CREATE TABLE IF NOT EXISTS ponygirls_imperative_users(
      id text PRIMARY KEY CHECK(id ~ '^[a-z][a-z0-9_-]{2,31}$'),
      status text NOT NULL CHECK(status IN ('pending','active','disabled')),
      email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
      password_hash text NOT NULL,
      totp_key_id text NOT NULL, totp_nonce bytea NOT NULL, totp_secret bytea NOT NULL,
      totp_last_step bigint NOT NULL, totp_required boolean NOT NULL, admin boolean NOT NULL,
      password_failures integer NOT NULL CHECK(password_failures>=0), password_failed_at timestamptz,
      totp_failures integer NOT NULL CHECK(totp_failures>=0), totp_failed_at timestamptz,
      recovery_failures integer NOT NULL CHECK(recovery_failures>=0), recovery_failed_at timestamptz,
      created_at timestamptz NOT NULL, created_via text NOT NULL CHECK(created_via IN ('signup','enrollment')), created_by text,
      approved_by text, approved_at timestamptz, credentials_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
      CHECK(status<>'pending' OR NOT admin))""")
    ImperativeStatements.update(c, """CREATE TABLE IF NOT EXISTS ponygirls_imperative_enrollments(
      id text PRIMARY KEY, digest text NOT NULL UNIQUE CHECK(digest ~ '^[0-9a-f]{64}$'), username text NOT NULL UNIQUE,
      kind text NOT NULL CHECK(kind IN ('invite','reset')), created_by text NOT NULL, created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL)""")
    ImperativeStatements.update(c, "INSERT INTO ponygirls_imperative_schema(version) VALUES(?) ON CONFLICT DO NOTHING", SqlValue.Integer(SchemaVersion))
  }

  /** The imperative core over this connection. `sessions` and `history` are the service's ports in the same transaction. */
  def accounts(c: Connection, settings: Option[ImperativeSettings], declared: DeclaredDirectory, sessions: AccountSessions,
    history: IdentityHistory, hasher: PasswordHasher, clock: Clock): ImperativeAccounts =
    new ImperativeAccounts(new PostgresImperativeUsers(c), settings, declared, sessions, history, hasher, clock)

  /** The declared users plus, while the master switch is on, the active imperative users; raises the collision
    * fault of design §4.1.3 with the switch on or off. One query, no lock.
    */
  def directory(c: Connection, settings: Option[ImperativeSettings], declared: DeclaredDirectory): Vector[AccountUser] =
    accounts(c, settings, declared, DirectoryRead, DirectoryRead, DirectoryRead, Clock.systemUTC()).directory

  /** Startup and reload (design §4.8.5): under the directory lock, the imperative ids read after acquiring it are
    * checked against the declared ids and logins, then `reconcile` installs the declarative directory. A collision
    * is `AccountFailure("config")` before anything is written.
    */
  def installDeclared(c: Connection, declared: DeclaredDirectory)(reconcile: => Unit): Unit = {
    new PostgresAccounts(c).lockDirectory()
    directory(c, None, declared)
    reconcile
  }

  /** The ports a directory read never uses. */
  private object DirectoryRead extends AccountSessions with IdentityHistory with PasswordHasher {
    private def unused: Nothing = throw new IllegalStateException("a directory read used an imperative-account port")
    def lockOwners(declarative: Vector[String], imperative: Vector[String]): Unit = unused
    def sessionOwner(secret: String): Option[String] = unused
    def live(session: AccountCredential): Boolean = unused
    def establish(user: AccountUser, replaced: Option[String]): AccountSession = unused
    def revokeSessions(userId: String, keep: Option[AccountCredential]): Unit = unused
    def revokeTokens(userId: String): Unit = unused
    def activated(user: AccountUser): Unit = unused
    def updated(user: AccountUser): Unit = unused
    def retained(username: String): Boolean = unused
    def hash(chars: Array[Char]): String = unused
    def verify(chars: Array[Char], encoded: String): Boolean = unused
  }
}

private[auth] enum SqlValue {
  case Text(value: Option[String])
  case Integer(value: Int)
  case BigInt(value: Long)
  case Flag(value: Boolean)
  case Bytes(value: Array[Byte])
  case Time(value: Option[Instant])
}

private[auth] object ImperativeStatements {
  private def bind(statement: PreparedStatement, values: Seq[SqlValue]): Unit = values.zipWithIndex.foreach { case (value, offset) =>
    val index = offset + 1
    value match {
      case SqlValue.Text(Some(text)) => statement.setString(index, text)
      case SqlValue.Text(None) => statement.setNull(index, Types.VARCHAR)
      case SqlValue.Integer(number) => statement.setInt(index, number)
      case SqlValue.BigInt(number) => statement.setLong(index, number)
      case SqlValue.Flag(flag) => statement.setBoolean(index, flag)
      case SqlValue.Bytes(bytes) => statement.setBytes(index, bytes)
      case SqlValue.Time(Some(at)) => statement.setObject(index, OffsetDateTime.ofInstant(at, ZoneOffset.UTC))
      case SqlValue.Time(None) => statement.setNull(index, Types.TIMESTAMP_WITH_TIMEZONE)
    }
  }
  /** Executes one statement and answers its update count (zero for a query). */
  def update(c: Connection, sql: String, values: SqlValue*): Int = Using.resource(c.prepareStatement(sql)) { statement =>
    bind(statement, values)
    if (statement.execute()) 0 else statement.getUpdateCount
  }
  def query[A](c: Connection, sql: String, values: SqlValue*)(read: ResultSet => A): Vector[A] = Using.resource(c.prepareStatement(sql)) { statement =>
    bind(statement, values)
    Using.resource(statement.executeQuery()) { result =>
      val rows = Vector.newBuilder[A]
      while (result.next()) rows += read(result)
      rows.result()
    }
  }
  def text(value: String): SqlValue = SqlValue.Text(Some(value))
  def time(value: Instant): SqlValue = SqlValue.Time(Some(value))
  def instant(r: ResultSet, column: String): Option[Instant] = Option(r.getObject(column, classOf[OffsetDateTime])).map(_.toInstant)
}

/** The imperative user store on PostgreSQL, in the caller's transaction. */
private[auth] final class PostgresImperativeUsers(c: Connection) extends ImperativeUserRepository {
  import ImperativeStatements.{instant, query, text, time, update}
  private val UniqueViolation = "23505"
  private val userColumns = Vector("status", "email", "password_hash", "totp_key_id", "totp_nonce", "totp_secret", "totp_last_step",
    "totp_required", "admin", "password_failures", "password_failed_at", "totp_failures", "totp_failed_at", "recovery_failures",
    "recovery_failed_at", "created_at", "created_via", "created_by", "approved_by", "approved_at", "credentials_at", "updated_at")
  private val placeholders = userColumns.map(_ => "?").mkString(",")
  private def counterValues(counter: FailureCounter): Vector[SqlValue] = Vector(SqlValue.Integer(counter.failures), SqlValue.Time(counter.failedAt))
  /** The values of `userColumns`, in that order. */
  private def userValues(row: StoredImperativeUser): Vector[SqlValue] =
    Vector(text(row.status.text), text(row.email), text(row.passwordHash), text(row.totp.keyId), SqlValue.Bytes(row.totp.nonce),
      SqlValue.Bytes(row.totp.data), SqlValue.BigInt(row.totpLastStep), SqlValue.Flag(row.totpRequired), SqlValue.Flag(row.admin)) ++
      counterValues(row.passwordFailures) ++ counterValues(row.totpFailures) ++ counterValues(row.recoveryFailures) ++
      Vector(time(row.createdAt), text(row.createdVia.text), SqlValue.Text(row.createdBy), SqlValue.Text(row.approvedBy), SqlValue.Time(row.approvedAt),
        time(row.credentialsAt), time(row.updatedAt))
  private def required(r: ResultSet, column: String): Instant = instant(r, column).getOrElse(throw AccountFailure("unavailable"))
  private def decoded[A](values: Array[A], label: A => String, stored: String): A =
    values.find(label(_) == stored).getOrElse(throw AccountFailure("unavailable"))
  private def counter(r: ResultSet, path: FailurePath): FailureCounter =
    FailureCounter(r.getInt(s"${path.text}_failures"), instant(r, s"${path.text}_failed_at"))
  private def readUser(r: ResultSet): StoredImperativeUser = StoredImperativeUser(r.getString("id"),
    decoded(AccountStatus.values, _.text, r.getString("status")), r.getString("email"), r.getString("password_hash"),
    SealedTotp(r.getString("totp_key_id"), r.getBytes("totp_nonce"), r.getBytes("totp_secret")), r.getLong("totp_last_step"),
    r.getBoolean("totp_required"), r.getBoolean("admin"), counter(r, FailurePath.Password), counter(r, FailurePath.Totp),
    counter(r, FailurePath.Recovery), required(r, "created_at"), decoded(CreatedVia.values, _.text, r.getString("created_via")),
    Option(r.getString("created_by")), Option(r.getString("approved_by")), instant(r, "approved_at"), required(r, "credentials_at"),
    required(r, "updated_at"))
  private def readEnrollment(r: ResultSet): StoredEnrollment = StoredEnrollment(r.getString("id"), r.getString("digest"), r.getString("username"),
    decoded(EnrollmentKind.values, _.text, r.getString("kind")), r.getString("created_by"), required(r, "created_at"), required(r, "expires_at"))
  private def exactlyOne(count: Int): Unit = if (count != 1) throw AccountFailure("unavailable")

  def lockDirectory(): Unit = new PostgresAccounts(c).lockDirectory()
  def users: Vector[StoredImperativeUser] = query(c, "SELECT * FROM ponygirls_imperative_users ORDER BY id")(readUser)
  def user(id: String): Option[StoredImperativeUser] = query(c, "SELECT * FROM ponygirls_imperative_users WHERE id=?", text(id))(readUser).headOption
  /** A duplicate id aborts the transaction as `username-unavailable`; nothing is ever adopted. */
  def insertUser(row: StoredImperativeUser): Unit =
    try update(c, s"INSERT INTO ponygirls_imperative_users(id,${userColumns.mkString(",")}) VALUES(?,$placeholders)", (text(row.id) +: userValues(row))*)
    catch { case failure: SQLException if failure.getSQLState == UniqueViolation => throw AccountFailure("username-unavailable") }
  def updateUser(row: StoredImperativeUser): Unit =
    exactlyOne(update(c, s"UPDATE ponygirls_imperative_users SET (${userColumns.mkString(",")})=($placeholders) WHERE id=?", (userValues(row) :+ text(row.id))*))
  def deleteUser(id: String): Unit = exactlyOne(update(c, "DELETE FROM ponygirls_imperative_users WHERE id=? AND status='pending'", text(id)))
  def enrollments: Vector[StoredEnrollment] = query(c, "SELECT * FROM ponygirls_imperative_enrollments ORDER BY created_at,id")(readEnrollment)
  def enrollmentByDigest(digest: String): Option[StoredEnrollment] =
    query(c, "SELECT * FROM ponygirls_imperative_enrollments WHERE digest=?", text(digest))(readEnrollment).headOption
  def putEnrollment(row: StoredEnrollment): Unit = {
    update(c, "DELETE FROM ponygirls_imperative_enrollments WHERE username=?", text(row.username))
    update(c, "INSERT INTO ponygirls_imperative_enrollments(id,digest,username,kind,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
      text(row.id), text(row.digest), text(row.username), text(row.kind.text), text(row.createdBy), time(row.createdAt), time(row.expiresAt))
  }
  def deleteEnrollment(id: String): Unit = update(c, "DELETE FROM ponygirls_imperative_enrollments WHERE id=?", text(id))
  def deleteExpiredEnrollments(now: Instant): Unit = update(c, "DELETE FROM ponygirls_imperative_enrollments WHERE expires_at<=?", time(now))
}
