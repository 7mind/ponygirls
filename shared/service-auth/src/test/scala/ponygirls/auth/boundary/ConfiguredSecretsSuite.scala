package ponygirls.auth.boundary

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.util.Base64
import ponygirls.auth.Secrets
import scala.jdk.CollectionConverters.*

/** BA and Effectual-GoodCommunication: whether a secret is configured at all, apart from whether it authenticates. Synthetic
  * credentials in temporary directories. */
final class ConfiguredSecretsSuite extends munit.FunSuite {
  private def secret(fill: Int) = Base64.getUrlEncoder.withoutPadding.encodeToString(Array.fill[Byte](32)(fill.toByte))
  private val Alice = secret(11)
  private val Bob = secret(12)
  private val directory = FunFixture[Path](_ => Files.createTempDirectory("configured-secrets-"), dir => {
    val paths = Files.walk(dir)
    try paths.iterator.asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)) finally paths.close()
  })
  private def write(dir: Path, name: String, value: String): String = {
    val path = dir.resolve(name)
    Files.writeString(path, value, StandardCharsets.UTF_8)
    path.toString
  }
  private def users(dir: Path, bobEnabled: Boolean): Vector[DeclaredUserConfig] = Vector(
    DeclaredUserConfig("alice", "human", "Alice", Vector(DeclaredTokenConfig("laptop", write(dir, "alice.sha", Secrets.digest(Alice)))), None, None, true, false),
    DeclaredUserConfig("bob", "agent", "Bob", Vector(DeclaredTokenConfig("worker", write(dir, "bob.sha", Secrets.digest(Bob)))), None, None, bobEnabled, false))
  private def loaded(users: Vector[DeclaredUserConfig], read: DigestRead): ConfiguredTokens =
    DeclaredUsers.load(users, DeclaredIdRules.Haystack, read, DigestReader.Stream).fold(r => fail(s"refused: $r"), _.tokens)

  Vector(DigestRead.Snapshot, DigestRead.PerCheck).foreach { read =>
    directory.test(s"a disabled owner's digest is configured though it authenticates nobody ($read)") { dir =>
      val tokens = loaded(users(dir, bobEnabled = false), read)
      assertEquals(tokens.authenticate(Bob), None)
      assert(tokens.configures(Bob), "a disabled owner's token is not configured")
      assert(tokens.configures(Alice), "an enabled owner's token is not configured")
      assert(!tokens.configures(secret(13)), "an unknown secret is configured")
      assert(!tokens.configures("not-a-canonical-secret"), "a non-canonical value is configured")
    }
  }
  directory.test("a digest that two tokens share after the load authenticates neither and is configured (per check)") { dir =>
    val tokens = loaded(users(dir, bobEnabled = true), DigestRead.PerCheck)
    assertEquals(tokens.authenticate(Bob).map(_.userId), Some("bob"))
    write(dir, "bob.sha", Secrets.digest(Alice))
    assertEquals(tokens.authenticate(Alice), None)
    assert(tokens.configures(Alice), "a shared digest is not configured")
    assert(!tokens.configures(Bob), "a rewritten digest is still configured")
  }
}
