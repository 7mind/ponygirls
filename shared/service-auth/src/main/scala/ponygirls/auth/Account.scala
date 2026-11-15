package ponygirls.auth

import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Path
import java.security.{MessageDigest, SecureRandom}
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import ponygirls.runtime.BoundedSecretFile

final case class AccountFailure(code: String) extends RuntimeException(code)

final case class AccountUser(id: String, userType: String, displayName: String,
  login: Option[String], passwordHash: Option[String], enabled: Boolean) {
  override def toString: String = s"AccountUser($id,$userType,<credentials redacted>,$enabled)"
}
final case class AccountCredential(userId: String, userType: String, tokenId: String, digest: String, browser: Boolean)
final case class AccountToken(id: String, name: String, source: String, createdAt: Option[String], revoked: Boolean, scopes: Vector[String])
final case class AccountIssued(token: AccountToken, secret: String) {
  override def toString: String = s"AccountIssued(${token.id},<redacted>)"
}
final case class AccountSession(credential: AccountCredential, secret: String) {
  override def toString: String = s"AccountSession(${credential.tokenId},<redacted>)"
}

final case class AccountLogin(session: AccountSession, replaced: Option[AccountCredential]) {
  override def toString: String = s"AccountLogin(${session.credential.tokenId},<credentials redacted>)"
}

object PersistentCookie {
  // Chromium caps persistent cookies at 400 days. Refreshing the cookie is a
  // browser-retention policy, never a server-side session-expiration policy.
  val maxAgeSeconds: Long = 400L * 24 * 60 * 60
}

object Secrets {
  private val encoder = Base64.getUrlEncoder.withoutPadding()
  def generate(): String = {
    val bytes = new Array[Byte](32)
    new SecureRandom().nextBytes(bytes)
    encoder.encodeToString(bytes)
  }
  def canonical(value: String): Boolean = value.matches("[A-Za-z0-9_-]{43}") && scala.util.Try {
    val bytes = Base64.getUrlDecoder.decode(value)
    bytes.length == 32 && encoder.encodeToString(bytes) == value
  }.getOrElse(false)
  def digest(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.getBytes(UTF_8)).map(b => f"${b & 255}%02x").mkString
  def equal(first: String, second: String): Boolean = MessageDigest.isEqual(first.getBytes(UTF_8), second.getBytes(UTF_8))
}

object Password {
  val iterations = 600000
  private val maximumIterations = 2000000
  private val saltBytes = 16
  private val derivedBytes = 32
  private final case class Encoded(rounds: Int, salt: Array[Byte], hash: Array[Byte])
  private def decode(value: String): Option[Encoded] = scala.util.Try {
    val fields = value.split("\\$", -1)
    if (fields.length != 4 || fields(0) != "pbkdf2-sha256") None
    else {
      val rounds = fields(1).toInt
      val salt = Base64.getDecoder.decode(fields(2))
      val hash = Base64.getDecoder.decode(fields(3))
      if (rounds < iterations || rounds > maximumIterations || fields(1) != rounds.toString || salt.length != saltBytes || hash.length != derivedBytes ||
          Base64.getEncoder.encodeToString(salt) != fields(2) || Base64.getEncoder.encodeToString(hash) != fields(3)) None
      else Some(Encoded(rounds, salt, hash))
    }
  }.toOption.flatten
  private def derive(chars: Array[Char], salt: Array[Byte], rounds: Int): Array[Byte] = {
    val spec = new PBEKeySpec(chars, salt, rounds, derivedBytes * 8)
    try SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded
    finally spec.clearPassword()
  }
  def hash(chars: Array[Char]): String = {
    val salt = new Array[Byte](saltBytes)
    new SecureRandom().nextBytes(salt)
    val encodedSalt = Base64.getEncoder.encodeToString(salt)
    val encodedHash = Base64.getEncoder.encodeToString(derive(chars, salt, iterations))
    s"pbkdf2-sha256$$$iterations$$$encodedSalt$$$encodedHash"
  }
  def verify(chars: Array[Char], encoded: String): Boolean = decode(encoded).exists { parsed =>
    MessageDigest.isEqual(derive(chars, parsed.salt, parsed.rounds), parsed.hash)
  }
  def validHash(value: String): Boolean = value.length <= 256 && decode(value).nonEmpty
  def readHash(path: Path): String = {
    val value = try BoundedSecretFile.read(path, 257).stripSuffix("\n")
      catch { case scala.util.control.NonFatal(_) => throw AccountFailure("config") }
    if (!validHash(value)) throw AccountFailure("config")
    value
  }
  private[auth] val dummyHash = "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
}
