package ponygirls.runtime

import java.nio.file.{Files, Path}
import munit.FunSuite
import scala.concurrent.duration.*

// Behavioral/Active/Blackbox/Atomic; credentials use an owned filesystem (Effectual/Good).
final class ConfigSuite extends FunSuite {
  private val limits = JdbcLimits(2, 3, 1.second, 2.seconds, 3.seconds, 1.second, 3.seconds, 5.seconds)
  test("configuration is explicit and credential-bearing URLs cannot override bounds") {
    val valid = JdbcConfig("jdbc:postgresql://127.0.0.1:5432/test", "service", Path.of("/run/credentials/db"), limits)
    valid.validate()
    assertEquals(valid.toString, "JdbcConfig(<redacted>)")
    List("jdbc:postgresql://user:secret@localhost/db", "jdbc:postgresql://localhost/db?socketTimeout=0", "jdbc:postgresql:db", "jdbc:postgresql://localhost/db#secret").foreach { url =>
      intercept[IllegalArgumentException](valid.copy(jdbcUrl = url).validate())
    }
    intercept[IllegalArgumentException](valid.copy(passwordFile = Path.of("relative")).validate())
    intercept[IllegalArgumentException](valid.copy(limits = limits.copy(statementTimeout = Duration.Zero)).validate())
  }
  test("credential file is strict bounded UTF8, strips one newline, resolves trusted operator symlinks") {
    val directory = Files.createTempDirectory("runtime-credential-")
    val file = directory.resolve("password")
    val link = directory.resolve("link")
    try {
      List("secret", "secret\n", "secret\r\n", " secret \n").foreach { content =>
        Files.writeString(file, content)
        assertEquals(CredentialFile.read(file), content.stripSuffix("\n").stripSuffix("\r"))
      }
      List("", "secret\n\n", "secret\nextra", "secret\u0000", "x" * 16385).foreach { content =>
        Files.writeString(file, content)
        assertEquals(intercept[RuntimeFailure](CredentialFile.read(file)).code, "credential-file")
      }
      Files.write(file, Array[Byte](0xc3.toByte, 0x28.toByte))
      intercept[RuntimeFailure](CredentialFile.read(file))
      Files.writeString(file, "secret")
      Files.createSymbolicLink(link, file)
      assertEquals(CredentialFile.read(link), "secret")
      intercept[RuntimeFailure](CredentialFile.read(directory.resolve("absent")))
    } finally {
      Files.deleteIfExists(link); Files.deleteIfExists(file); Files.delete(directory)
    }
  }
  test("migration versions and namespace are strictly validated") {
    val one = Migration(1, "first", "SELECT 1")
    Migration.validate("test.scope", List(one, Migration(2, "second", "SELECT 2")))
    List(List(one, one), List(one.copy(version = 0)), List(one.copy(sql = "")), List(one.copy(version = 2), one)).foreach(ms =>
      intercept[IllegalArgumentException](Migration.validate("test", ms)))
    intercept[IllegalArgumentException](Migration.validate("untrusted; DROP", List(one)))
    assertEquals(one.checksum, "e004ebd5b5532a4b85984a62f8ad48a81aa3460c1ca07701f386135d72cdecf5")
  }
}
