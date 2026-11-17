package ponygirls.auth

import java.nio.charset.StandardCharsets.UTF_8
import java.security.{MessageDigest, SecureRandom}
import java.time.{Clock, Instant}
import java.util.Base64

/** Handwritten in-memory imperative user store. It depends on nothing else in the test sources. */
final class MemoryImperativeUsers extends ImperativeUserRepository {
  private var userRows = Map.empty[String, StoredImperativeUser]
  private var enrollmentRows = Map.empty[String, StoredEnrollment]

  /** Runs `work` as one transaction: its writes to this store are undone when it throws. */
  def transaction[A](work: => A): A = {
    val (users, enrollments) = (userRows, enrollmentRows)
    try work catch { case failure: Throwable => userRows = users; enrollmentRows = enrollments; throw failure }
  }
  /** The imperative core over this store, for test code outside this package. */
  def accounts(settings: Option[ImperativeSettings], declared: DeclaredDirectory, sessions: AccountSessions, history: IdentityHistory,
    hasher: PasswordHasher, clock: Clock): ImperativeAccounts = new ImperativeAccounts(this, settings, declared, sessions, history, hasher, clock)

  def lockDirectory(): Unit = ()
  def users: Vector[StoredImperativeUser] = userRows.values.toVector
  def user(id: String): Option[StoredImperativeUser] = userRows.get(id)
  def insertUser(row: StoredImperativeUser): Unit = {
    require(!userRows.contains(row.id) && row.id.matches(ImperativePolicy.UsernamePattern) && (row.status != AccountStatus.Pending || !row.admin))
    userRows += row.id -> row
  }
  def updateUser(row: StoredImperativeUser): Unit = {
    require(userRows.contains(row.id) && (row.status != AccountStatus.Pending || !row.admin))
    userRows += row.id -> row
  }
  def deleteUser(id: String): Unit = {
    require(userRows.get(id).exists(_.status == AccountStatus.Pending))
    userRows -= id
  }
  def enrollments: Vector[StoredEnrollment] = enrollmentRows.values.toVector
  def enrollmentByDigest(digest: String): Option[StoredEnrollment] = enrollmentRows.values.find(_.digest == digest)
  def putEnrollment(row: StoredEnrollment): Unit = {
    val kept = enrollmentRows.filterNot(_._2.username == row.username)
    require(!kept.contains(row.id) && !kept.values.exists(_.digest == row.digest))
    enrollmentRows = kept + (row.id -> row)
  }
  def deleteEnrollment(id: String): Unit = enrollmentRows -= id
  def deleteExpiredEnrollments(now: Instant): Unit = enrollmentRows = enrollmentRows.filter(_._2.expiresAt.isAfter(now))
}

/** Test-only hasher: one salted SHA-256 in the `Password` text format, so the stored value passes the
  * directory's hash-shape validation without the PBKDF2 cost. Never a production hasher.
  */
object FastPasswordHasher extends PasswordHasher {
  private val SaltBytes = 16
  private val random = new SecureRandom()
  private def derive(chars: Array[Char], salt: Array[Byte]): Array[Byte] = {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(salt)
    digest.digest(new String(chars).getBytes(UTF_8))
  }
  private def encode(bytes: Array[Byte]): String = Base64.getEncoder.encodeToString(bytes)
  def hash(chars: Array[Char]): String = {
    val salt = new Array[Byte](SaltBytes)
    random.nextBytes(salt)
    s"pbkdf2-sha256$$${Password.iterations}$$${encode(salt)}$$${encode(derive(chars, salt))}"
  }
  def verify(chars: Array[Char], encoded: String): Boolean = encoded.split("\\$", -1) match {
    case Array(_, _, salt, key) => MessageDigest.isEqual(derive(chars, Base64.getDecoder.decode(salt)), Base64.getDecoder.decode(key))
    case _ => false
  }
}
