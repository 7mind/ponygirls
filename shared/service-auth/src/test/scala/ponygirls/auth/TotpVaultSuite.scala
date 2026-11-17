package ponygirls.auth

import java.nio.file.{Files, Path}

final class TotpVaultSuite extends munit.FunSuite {
  private val secret = "12345678901234567890".getBytes("UTF-8")
  private val directory = FunFixture[Path](_ => Files.createTempDirectory("totp-vault-"), dir => {
    Files.list(dir).forEach(Files.delete(_)); Files.delete(dir)
  })

  private def keyFile(dir: Path, name: String, content: String): Path = {
    val file = dir.resolve(name)
    Files.writeString(file, content)
    file
  }
  private def assertUnavailable(body: => Any): Unit = assertEquals(intercept[AccountFailure](body).code, "unavailable")

  directory.test("round trip; wrong key, service, user and tampering fail closed") { dir =>
    val keyText = Secrets.generate()
    val vault = TotpVault.load(keyFile(dir, "key", keyText + "\n"), "haystack")
    val stored = vault.seal("alice", secret)
    assertEquals(stored.keyId, vault.keyId)
    assertEquals(stored.nonce.length, 12)
    assertEquals(stored.data.length, 36)
    assertEquals(vault.open("alice", stored).toSeq, secret.toSeq)
    assert(!vault.seal("alice", secret).nonce.sameElements(stored.nonce))

    val otherService = TotpVault.load(keyFile(dir, "same-key", keyText), "manure")
    assertEquals(otherService.keyId, vault.keyId)
    assertUnavailable(otherService.open("alice", stored))
    assertUnavailable(vault.open("bob", stored))
    assertUnavailable(TotpVault.load(keyFile(dir, "other-key", Secrets.generate()), "haystack").open("alice", stored))
    val flipped = stored.data.clone(); flipped(0) = (flipped(0) ^ 1).toByte
    assertUnavailable(vault.open("alice", stored.copy(data = flipped)))
    assertUnavailable(vault.open("alice", stored.copy(data = stored.data.dropRight(1))))
    assertUnavailable(vault.open("alice", stored.copy(nonce = stored.nonce.drop(1))))
    assertUnavailable(vault.open("alice", stored.copy(keyId = "0" * 16)))
  }

  directory.test("key file must be one canonical 32-byte base64url key") { dir =>
    val good = Secrets.generate()
    Seq("short" -> good.dropRight(4), "long" -> (good + "AAAA"), "padded" -> (good + "="),
      "empty" -> "", "two-lines" -> (good + "\n" + good)).foreach { case (name, content) =>
      assertEquals(intercept[AccountFailure](TotpVault.load(keyFile(dir, name, content), "haystack")).code, "config", name)
    }
    assertEquals(intercept[AccountFailure](TotpVault.load(dir.resolve("missing"), "haystack")).code, "config")
  }
}
