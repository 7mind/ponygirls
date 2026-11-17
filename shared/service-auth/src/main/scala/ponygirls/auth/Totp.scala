package ponygirls.auth

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.time.Instant
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** RFC 6238 TOTP: HMAC-SHA1, 6 digits, 30 s steps, T0 = 0. Pure; the caller supplies the clock and persists the accepted step. */
object Totp {
  val SecretBytes = 20
  val SecretTextLength = 32
  val StepSeconds = 30L
  val Digits = 6
  val WindowSteps = 1L

  private val Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  private val BitsPerChar = 5
  private val ByteBits = 8
  private val TruncationOffsetMask = 0x0f
  private val TruncationValueMask = 0x7fffffff
  private val Modulus = Math.pow(10, Digits.toDouble).toInt
  private val Algorithm = "HmacSHA1"

  enum Verdict {
    case Accepted(step: Long)
    case Rejected
  }

  def stepAt(now: Instant): Long = Math.floorDiv(now.getEpochSecond, StepSeconds)

  /** Canonical form only: exactly 32 characters of the upper-case RFC 4648 alphabet, no padding, no whitespace.
    * 32 characters carry exactly 160 bits, so every such string has one decoding and one text form. */
  def decodeSecret(text: String): Option[Array[Byte]] =
    if (text.length != SecretTextLength || !text.forall(c => Alphabet.indexOf(c) >= 0)) None
    else {
      val out = new Array[Byte](SecretBytes)
      var buffer = 0
      var bits = 0
      var index = 0
      text.foreach { c =>
        buffer = (buffer << BitsPerChar) | Alphabet.indexOf(c)
        bits += BitsPerChar
        if (bits >= ByteBits) {
          bits -= ByteBits
          out(index) = ((buffer >> bits) & 0xff).toByte
          index += 1
          buffer &= (1 << bits) - 1
        }
      }
      Some(out)
    }

  def code(secret: Array[Byte], step: Long): String = {
    require(secret.length == SecretBytes, "TOTP secret must be 20 bytes")
    val mac = Mac.getInstance(Algorithm)
    mac.init(new SecretKeySpec(secret, Algorithm))
    val hash = mac.doFinal(ByteBuffer.allocate(java.lang.Long.BYTES).putLong(step).array())
    val offset = hash(hash.length - 1) & TruncationOffsetMask
    val truncated = ByteBuffer.wrap(hash, offset, Integer.BYTES).getInt & TruncationValueMask
    s"%0${Digits}d".format(truncated % Modulus)
  }

  /** Accepts a code for a step in {T-1, T, T+1} that is greater than `lastStep`. All three candidates are compared
    * without early exit. When several steps produce the same code the highest wins, so the accepted step always
    * exceeds every step the same code could still match. */
  def verify(secret: Array[Byte], offered: String, now: Instant, lastStep: Long): Verdict = {
    val offeredBytes = offered.getBytes(UTF_8)
    val current = stepAt(now)
    val matching = (current - WindowSteps to current + WindowSteps).map { step =>
      val equal = MessageDigest.isEqual(code(secret, step).getBytes(UTF_8), offeredBytes)
      (step, equal & step > lastStep & step >= 0)
    }.filter(_._2).map(_._1)
    if (matching.isEmpty) Verdict.Rejected else Verdict.Accepted(matching.max)
  }
}
