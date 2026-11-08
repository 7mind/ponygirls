package rites

import baboon.runtime.shared.{BaboonCodecContext, BaboonJsonCodec}
import io.circe.{Decoder, Json}
import java.nio.ByteBuffer
import java.nio.charset.{CodingErrorAction, StandardCharsets}
import java.nio.file.{Files, Path}
import java.security.{MessageDigest, SecureRandom}
import java.time.{DayOfWeek, Instant, ZoneOffset, ZonedDateTime}
import java.util.{Base64, UUID}
import javax.crypto.{Cipher, SecretKeyFactory}
import javax.crypto.spec.{GCMParameterSpec, PBEKeySpec, SecretKeySpec}
import ponygirls.runtime.BoundedSecretFile
import scala.util.Using

final case class DomainError(code: String, detail: String = "") extends RuntimeException(code)
object Check {
  def apply(ok: Boolean, code: String, detail: String = ""): Unit = if (!ok) throw DomainError(code, detail)
}
object Valid {
  private def validUnicode(value: String): Boolean = {
    var index = 0
    while (index < value.length) {
      val char = value.charAt(index)
      if (Character.isHighSurrogate(char)) { if (index + 1 >= value.length || !Character.isLowSurrogate(value.charAt(index + 1))) return false; index += 2 }
      else { if (Character.isLowSurrogate(char)) return false; index += 1 }
    }
    true
  }
  def text(value: String, maximum: Int): Boolean = value.nonEmpty && value.length <= maximum && validUnicode(value) && !value.exists(_.isControl)
  def id(value: String): Boolean = value != null && value.matches("[a-z][a-z0-9-]{0,62}")
  def repository(value: String): Boolean = id(value)
  def rite(value: String): Boolean = id(value)
  def host(value: String): Boolean = value != null && value.length <= 253 && value.matches("[A-Za-z0-9.-]+") && !value.startsWith(".") && !value.endsWith(".") && !value.contains("..")
  def project(value: String): Boolean = value != null && value.length <= 512 && !value.startsWith("/") && !value.endsWith("/") && value.split('/').forall(p => p.nonEmpty && p != "." && p != ".." && !p.exists(c => c.isControl || c == '\\' || c == '?' || c == '#'))
  def branch(value: String): Boolean = value != null && value.length <= 255 && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".") && !value.contains("..") && !value.contains("@{") && !value.contains("//") && !value.exists(c => c.isControl || c.isWhitespace || "~^:?*[\\".contains(c))
  def prompt(value: String): Boolean = value != null && value.toLowerCase(java.util.Locale.ROOT).endsWith(".md") && value.length <= 512 && !value.startsWith("/") && value.split('/').forall(p => p.nonEmpty && p != "." && p != ".." && p != ".git") && !value.contains('\\') && !value.contains('\u0000')
}
object JsonSupport {
  val context: BaboonCodecContext = BaboonCodecContext.Default
  def encode[A](codec: BaboonJsonCodec[A], value: A): Json = codec.encode(context, value)
  def decode[A](codec: BaboonJsonCodec[A], json: Json): A = codec.decode(context, json).fold(_ => throw DomainError("invalid", "invalid payload"), identity)
  def parse(raw: String): Json = io.circe.parser.parse(raw).fold(_ => throw DomainError("invalid", "invalid JSON"), identity)
  def decodeFile[A: Decoder](path: Path, bound: Int): A = {
    Check(path.isAbsolute, "config", "configuration paths must be absolute")
    val bytes = try Files.readAllBytes(path) catch { case scala.util.control.NonFatal(_) => throw DomainError("config", "configuration file unavailable") }
    Check(bytes.length <= bound, "config", "configuration file too large")
    val text = try StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString catch { case scala.util.control.NonFatal(_) => throw DomainError("config", "configuration must be UTF-8") }
    parse(text).as[A].fold(_ => throw DomainError("config", "invalid configuration"), identity)
  }
}
object Hash {
  def hex(bytes: Array[Byte]): String = bytes.map(b => f"${b & 255}%02x").mkString
  def sha256(bytes: Array[Byte]): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
  def sha256(value: String): String = sha256(value.getBytes(StandardCharsets.UTF_8))
  def secret(): String = { val bytes = new Array[Byte](32); new SecureRandom().nextBytes(bytes); Base64.getUrlEncoder.withoutPadding.encodeToString(bytes) }
}
object Password {
  val iterations = 600000
  private def derive(chars: Array[Char], salt: Array[Byte], rounds: Int): Array[Byte] = {
    val spec = new PBEKeySpec(chars, salt, rounds, 256)
    try SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded finally spec.clearPassword()
  }
  def hash(chars: Array[Char]): String = {
    val salt = new Array[Byte](16); new SecureRandom().nextBytes(salt)
    s"pbkdf2-sha256$$$iterations$$${Base64.getEncoder.encodeToString(salt)}$$${Base64.getEncoder.encodeToString(derive(chars, salt, iterations))}"
  }
  def verify(chars: Array[Char], encoded: String): Boolean = scala.util.Try {
    val p = encoded.split("\\$"); val n = p(1).toInt
    p.length == 4 && p(0) == "pbkdf2-sha256" && n >= 600000 && n <= 2000000 && p(2).nonEmpty && p(3).nonEmpty && MessageDigest.isEqual(derive(chars, Base64.getDecoder.decode(p(2)), n), Base64.getDecoder.decode(p(3)))
  }.getOrElse(false)
}
/** AES-256-GCM with credential id+owner+immutable forge identity as associated data. */
final class Vault(key: SecretKeySpec, val keyId: String) {
  private val random = new SecureRandom()
  def encrypt(owner: String, id: UUID, forge: String, host: String, plaintext: String): VaultCiphertext = encryptPurpose(owner, id, forge, host, plaintext, "access")
  def encryptRefresh(owner: String, id: UUID, forge: String, host: String, plaintext: String): VaultCiphertext = encryptPurpose(owner, id, forge, host, plaintext, "refresh")
  private def encryptPurpose(owner: String, id: UUID, forge: String, host: String, plaintext: String, purpose: String): VaultCiphertext = {
    Check(plaintext.nonEmpty && plaintext.length <= 16384 && !plaintext.exists(c => c == '\n' || c == '\r' || c == '\u0000'), "invalid", "invalid credential")
    val nonce = new Array[Byte](12); random.nextBytes(nonce)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce))
    cipher.updateAAD((aad(owner, id, forge, host) :+ 0.toByte) ++ purpose.getBytes(StandardCharsets.UTF_8))
    VaultCiphertext(keyId, nonce, cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8)))
  }
  def decrypt(owner: String, id: UUID, forge: String, host: String, stored: VaultCiphertext): String = decryptPurpose(owner, id, forge, host, stored, "access")
  def decryptRefresh(owner: String, id: UUID, forge: String, host: String, stored: VaultCiphertext): String = decryptPurpose(owner, id, forge, host, stored, "refresh")
  private def decryptPurpose(owner: String, id: UUID, forge: String, host: String, stored: VaultCiphertext, purpose: String): String = {
    Check(stored.keyId == keyId && stored.nonce.length == 12 && stored.data.length >= 16 && stored.data.length <= 16400, "credential-unavailable", "credential cannot be decrypted")
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, stored.nonce))
      cipher.updateAAD((aad(owner, id, forge, host) :+ 0.toByte) ++ purpose.getBytes(StandardCharsets.UTF_8))
      new String(cipher.doFinal(stored.data), StandardCharsets.UTF_8)
    } catch { case scala.util.control.NonFatal(_) => throw DomainError("credential-unavailable", "credential cannot be decrypted") }
  }
  private def aad(owner: String, id: UUID, forge: String, host: String): Array[Byte] = s"rites-v1\u0000$owner\u0000$id\u0000$forge\u0000$host".getBytes(StandardCharsets.UTF_8)
}
final case class VaultCiphertext(keyId: String, nonce: Array[Byte], data: Array[Byte])
object Vault {
  def load(path: Path): Vault = {
    val encoded = BoundedSecretFile.read(path, 4096).stripSuffix("\n").stripSuffix("\r")
    val bytes = try Base64.getUrlDecoder.decode(encoded) catch { case _: IllegalArgumentException => throw DomainError("config", "vault key must be base64url") }
    Check(bytes.length == 32, "config", "vault key must contain 32 bytes")
    new Vault(new SecretKeySpec(bytes, "AES"), Hash.sha256(bytes).take(16))
  }
}
/** Strict five-field UTC cron. Supports numbers, *, ranges, lists and /steps. */
final case class Cron(expression: String) {
  private val fields = expression.trim.split(" ").toList
  Check(fields.size == 5 && expression.length <= 128 && !expression.exists(c => c.isWhitespace && c != ' '), "invalid", "cron must have five space-separated fields")
  private val minutes = Cron.field(fields(0), 0, 59)
  private val hours = Cron.field(fields(1), 0, 23)
  private val days = Cron.field(fields(2), 1, 31)
  private val months = Cron.field(fields(3), 1, 12)
  private val weekdays = Cron.field(fields(4), 0, 7)
  private val domRestricted = !fields(2).contains("*")
  private val dowRestricted = !fields(4).contains("*")
  private val minuteOfDay: Vector[Int] = for { hour <- hours.toVector.sorted; minute <- minutes.toVector.sorted } yield hour * 60 + minute
  private def matches(time: ZonedDateTime): Boolean = {
    val dom = days(time.getDayOfMonth); val dowValue = time.getDayOfWeek.getValue % 7
    val dow = weekdays(dowValue) || (dowValue == 0 && weekdays(7))
    val dayMatches = if (domRestricted && dowRestricted) dom || dow else dom && dow
    months(time.getMonthValue) && dayMatches
  }
  def next(after: Instant): Instant = {
    val start = after.atZone(ZoneOffset.UTC).plusMinutes(1).withSecond(0).withNano(0); val firstDate = start.toLocalDate
    var offset = 0
    while (offset <= 146097) {
      val date = firstDate.plusDays(offset.toLong)
      if (matches(date.atStartOfDay(ZoneOffset.UTC))) {
        val minimum = if (offset == 0) start.getHour * 60 + start.getMinute else 0
        minuteOfDay.find(_ >= minimum) match { case Some(selected) => return date.atTime(selected / 60, selected % 60).atZone(ZoneOffset.UTC).toInstant; case None => () }
      }
      offset += 1
    }
    throw DomainError("invalid", "cron has no occurrence in Gregorian cycle")
  }
  def previousOrCurrent(value: Instant): Instant = {
    val start = value.atZone(ZoneOffset.UTC).withSecond(0).withNano(0); val firstDate = start.toLocalDate
    var offset = 0
    while (offset <= 146097) {
      val date = firstDate.minusDays(offset.toLong)
      if (matches(date.atStartOfDay(ZoneOffset.UTC))) {
        val maximum = if (offset == 0) start.getHour * 60 + start.getMinute else 1439
        minuteOfDay.reverse.find(_ <= maximum) match { case Some(selected) => return date.atTime(selected / 60, selected % 60).atZone(ZoneOffset.UTC).toInstant; case None => () }
      }
      offset += 1
    }
    throw DomainError("invalid", "cron has no occurrence in Gregorian cycle")
  }
  val _ = next(Instant.EPOCH)
}
object Cron {
  private def field(raw: String, minimum: Int, maximum: Int): Set[Int] = {
    Check(raw.nonEmpty, "invalid", "empty cron field")
    raw.split(",", -1).toList.flatMap { part =>
      Check(part.nonEmpty, "invalid", "empty cron list item")
      val pieces = part.split("/", -1)
      Check(pieces.length >= 1 && pieces.length <= 2, "invalid", "invalid cron step")
      val base = pieces(0); val stepText = pieces.drop(1)
      val step = if (stepText.isEmpty) 1 else stepText.head.toIntOption.getOrElse(0)
      Check(step >= 1 && step <= maximum - minimum + 1, "invalid", "invalid cron step")
      val bounds = base.split("-", -1).toList.map(_.toIntOption.getOrElse(-1))
      val (first, last) = if (base == "*") (minimum, maximum) else if (bounds.size == 1) { val one = bounds(0); if (stepText.nonEmpty) (one, maximum) else (one, one) }
        else if (bounds.size == 2) (bounds(0), bounds(1)) else (-1, -1)
      Check(first >= minimum && last >= first && last <= maximum, "invalid", "cron value outside range")
      (first to last by step).toList
    }.toSet
  }
}
object Times { def now: String = Instant.now().toString; def instant(value: java.sql.Timestamp): Instant = value.toInstant }
