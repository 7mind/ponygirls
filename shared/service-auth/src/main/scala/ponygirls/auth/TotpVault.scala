package ponygirls.auth

import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Path
import java.security.{MessageDigest, SecureRandom}
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.{GCMParameterSpec, SecretKeySpec}
import ponygirls.runtime.BoundedSecretFile

/** Row-shaped encrypted TOTP secret: `keyId`, 12-byte `nonce`, and ciphertext with the 16-byte GCM tag. */
final case class SealedTotp(keyId: String, nonce: Array[Byte], data: Array[Byte])

/** AES-256-GCM for TOTP secrets at rest, bound to one service and user through the associated data.
  * Every decryption failure is `AccountFailure("unavailable")`; nothing about the cause is exposed. */
final class TotpVault private (key: SecretKeySpec, val keyId: String, service: String) {
  import TotpVault._
  private val random = new SecureRandom()

  def seal(userId: String, secret: Array[Byte]): SealedTotp = {
    require(secret.length == Totp.SecretBytes, "TOTP secret must be 20 bytes")
    val nonce = new Array[Byte](NonceBytes)
    random.nextBytes(nonce)
    SealedTotp(keyId, nonce, cipher(Cipher.ENCRYPT_MODE, nonce, userId).doFinal(secret))
  }

  def open(userId: String, stored: SealedTotp): Array[Byte] = {
    if (stored.keyId != keyId || stored.nonce.length != NonceBytes || stored.data.length != Totp.SecretBytes + TagBytes)
      throw AccountFailure("unavailable")
    try cipher(Cipher.DECRYPT_MODE, stored.nonce, userId).doFinal(stored.data)
    catch { case scala.util.control.NonFatal(_) => throw AccountFailure("unavailable") }
  }

  private def cipher(mode: Int, nonce: Array[Byte], userId: String): Cipher = {
    val instance = Cipher.getInstance("AES/GCM/NoPadding")
    instance.init(mode, key, new GCMParameterSpec(TagBytes * 8, nonce))
    instance.updateAAD(s"$AadPrefix\u0000$service\u0000$userId".getBytes(UTF_8))
    instance
  }
}

object TotpVault {
  private val AadPrefix = "ponygirls-totp-v1"
  private val NonceBytes = 12
  private val TagBytes = 16
  private val KeyBytes = 32
  private val KeyIdChars = 16
  private val KeyFileMaxBytes = 256

  /** `keyFile` holds the key as canonical unpadded base64url (43 characters) and one optional terminal LF or CRLF. */
  def load(keyFile: Path, service: String): TotpVault = {
    val text = try BoundedSecretFile.read(keyFile, KeyFileMaxBytes).replaceFirst("\\r?\\n\\z", "")
      catch { case scala.util.control.NonFatal(_) => throw AccountFailure("config") }
    if (!Secrets.canonical(text)) throw AccountFailure("config")
    val bytes = Base64.getUrlDecoder.decode(text)
    assert(bytes.length == KeyBytes)
    val keyId = MessageDigest.getInstance("SHA-256").digest(bytes).map(b => f"${b & 255}%02x").mkString.take(KeyIdChars)
    new TotpVault(new SecretKeySpec(bytes, "AES"), keyId, service)
  }
}
