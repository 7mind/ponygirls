package rites

import java.time.Instant

final class CoreTest extends munit.FunSuite {
  test("wildcard-step DOM does not turn day-of-week into daily OR") {
    val monday = Instant.parse("2026-11-09T00:00:00Z")
    assertEquals(Cron("0 0 */1 * 1").next(monday), Instant.parse("2026-11-16T00:00:00Z"))
  }
  test("wildcard-step DOW remains unrestricted for conventional DOM OR") {
    val monday = Instant.parse("2026-11-09T00:00:00Z")
    assertEquals(Cron("0 0 11 * */2").next(monday), Instant.parse("2027-02-11T00:00:00Z"))
  }
  test("cron rejects trailing list separator") {
    intercept[DomainError](Cron("1, * * * *"))
  }
  test("valid supplementary Unicode is allowlisted while lone surrogates fail") {
    assert(Valid.text("Maintenance 🐎", 128))
    assert(!Valid.text("bad\ud800", 128))
  }
  test("vault bounds UTF8 bytes symmetrically and roundtrips exact supplementary Unicode") {
    val key = new Vault(new javax.crypto.spec.SecretKeySpec(Array.fill[Byte](32)(11), "AES"), "fixture"); val id = java.util.UUID.randomUUID()
    val accents = "é" * 8192; val horses = "🐎" * 4096
    val access = key.encrypt("owner", id, "Gitlab", "git.example.invalid", accents)
    val refresh = key.encryptRefresh("owner", id, "Gitlab", "git.example.invalid", horses)
    assertEquals(key.decrypt("owner", id, "Gitlab", "git.example.invalid", access), accents)
    assertEquals(key.decryptRefresh("owner", id, "Gitlab", "git.example.invalid", refresh), horses)
    intercept[DomainError](key.encrypt("owner", id, "Gitlab", "git.example.invalid", "é" * 8193))
    intercept[DomainError](key.encryptRefresh("owner", id, "Gitlab", "git.example.invalid", "🐎" * 4097))
  }
  test("unschedulable Gregorian calendar is rejected at configuration boundary") {
    intercept[DomainError](Cron("0 0 31 2 *"))
  }
  test("vault binds plaintext to owner, identity and purpose and emits no plaintext") {
    val key = new Vault(new javax.crypto.spec.SecretKeySpec(Array.fill[Byte](32)(7), "AES"), "fixture")
    val id = java.util.UUID.randomUUID()
    val encrypted = key.encrypt("one", id, "Gitlab", "git.example.invalid", "fixture-secret")
    val refresh = key.encryptRefresh("one", id, "Gitlab", "git.example.invalid", "fixture-refresh")
    assertEquals(key.decrypt("one", id, "Gitlab", "git.example.invalid", encrypted), "fixture-secret")
    assertEquals(key.decryptRefresh("one", id, "Gitlab", "git.example.invalid", refresh), "fixture-refresh")
    intercept[DomainError](key.decrypt("two", id, "Gitlab", "git.example.invalid", encrypted))
    intercept[DomainError](key.decrypt("one", id, "Gitlab", "git.example.invalid", refresh))
    assert(!java.util.Base64.getEncoder.encodeToString(encrypted.data).contains("fixture-secret"))
  }
}
