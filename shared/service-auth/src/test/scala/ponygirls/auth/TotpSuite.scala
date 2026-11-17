package ponygirls.auth

import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant

final class TotpSuite extends munit.FunSuite {
  // RFC 6238 Appendix B shared secret "12345678901234567890" (SHA-1 column), in canonical base32.
  private val rfcSecretText = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  private val secret = "12345678901234567890".getBytes(UTF_8)
  private def at(seconds: Long): Instant = Instant.ofEpochSecond(seconds)

  test("RFC 6238 vectors truncated to six digits") {
    assertEquals(Totp.code(secret, Totp.stepAt(at(59))), "287082")
    assertEquals(Totp.code(secret, Totp.stepAt(at(1111111109L))), "081804")
  }

  test("window accepts T-1, T, T+1 and rejects T-2, T+2") {
    val now = at(1111111109L)
    val step = Totp.stepAt(now)
    Seq(-1L, 0L, 1L).foreach { shift =>
      assertEquals(Totp.verify(secret, Totp.code(secret, step + shift), now, 0L), Totp.Verdict.Accepted(step + shift))
    }
    Seq(-2L, 2L).foreach { shift =>
      assertEquals(Totp.verify(secret, Totp.code(secret, step + shift), now, 0L), Totp.Verdict.Rejected)
    }
  }

  test("each step is single use: replay and older steps are rejected, later steps still pass") {
    val now = at(1111111109L)
    val step = Totp.stepAt(now)
    val accepted = Totp.verify(secret, Totp.code(secret, step), now, step - 1)
    assertEquals(accepted, Totp.Verdict.Accepted(step))
    assertEquals(Totp.verify(secret, Totp.code(secret, step), now, step), Totp.Verdict.Rejected)
    assertEquals(Totp.verify(secret, Totp.code(secret, step - 1), now, step), Totp.Verdict.Rejected)
    assertEquals(Totp.verify(secret, Totp.code(secret, step + 1), now, step), Totp.Verdict.Accepted(step + 1))
  }

  test("malformed codes are rejected") {
    val now = at(59)
    Seq("", "28708", "2870820", " 287082", "28708a").foreach { offered =>
      assertEquals(Totp.verify(secret, offered, now, 0L), Totp.Verdict.Rejected)
    }
  }

  test("secret text is accepted only in canonical form") {
    assertEquals(Totp.decodeSecret(rfcSecretText).map(_.toSeq), Some(secret.toSeq))
    Seq(
      rfcSecretText.toLowerCase, rfcSecretText.dropRight(1), rfcSecretText + "A", rfcSecretText.dropRight(4) + "====",
      rfcSecretText + "====", rfcSecretText.dropRight(1) + "1", rfcSecretText.dropRight(1) + " ", rfcSecretText.dropRight(1) + "\n", ""
    ).foreach(text => assertEquals(Totp.decodeSecret(text), None, text))
  }
}
