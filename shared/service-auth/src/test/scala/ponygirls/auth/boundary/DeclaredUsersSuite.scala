package ponygirls.auth.boundary

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.util.Base64
import ponygirls.auth.{AccountFailure, AccountToken, Password, Secrets}
import scala.jdk.CollectionConverters.*

/** BA for the user and token rules; Effectual-GoodCommunication for the runtime credential files. Synthetic
  * credentials in temporary directories only. */
final class DeclaredUsersSuite extends munit.FunSuite {
  private def secret(fill: Int) = Base64.getUrlEncoder.withoutPadding.encodeToString(Array.fill[Byte](32)(fill.toByte))
  private val AliceToken = secret(1)
  private val BotToken = secret(2)
  private val RotationToken = secret(3)
  private val AlicePassword = "synthetic-account-password-not-a-secret"
  private val directory = FunFixture[Path](_ => Files.createTempDirectory("declared-users-"), dir => {
    val paths = Files.walk(dir)
    try paths.iterator.asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)) finally paths.close()
  })
  private def write(dir: Path, name: String, value: String): String = {
    val path = dir.resolve(name)
    Files.writeString(path, value, StandardCharsets.UTF_8)
    path.toString
  }
  private def users(dir: Path): Vector[DeclaredUserConfig] = Vector(
    DeclaredUserConfig("alice", "human", "Alice", Vector(DeclaredTokenConfig("browser", write(dir, "alice.sha", Secrets.digest(AliceToken) + "\n"))),
      None, None, true, false),
    DeclaredUserConfig("bot", "agent", "Bot", Vector(DeclaredTokenConfig("worker", write(dir, "bot.sha", Secrets.digest(BotToken)))),
      None, None, true, false))
  private def withPassword(dir: Path, user: DeclaredUserConfig): DeclaredUserConfig =
    user.copy(login = Some(user.id), passwordHashFile = Some(write(dir, user.id + ".password", Password.hash(AlicePassword.toCharArray))))
  private def loaded(users: Vector[DeclaredUserConfig]): Declared = DeclaredUsers.load(users).fold(r => fail(s"refused: $r"), identity)
  private def refusal(users: Vector[DeclaredUserConfig]): ConfigRefusal = DeclaredUsers.load(users).fold(identity, _ => fail("loaded"))

  directory.test("configured tokens authenticate their user and token; anything else, non-canonical included, does not") { dir =>
    val base = users(dir)
    val rotation = DeclaredTokenConfig("rotation", write(dir, "rotation.sha", Secrets.digest(RotationToken)))
    val declared = loaded(base.updated(0, base.head.copy(tokens = base.head.tokens :+ rotation)))
    assertEquals(declared.tokens.authenticate(AliceToken), Some(ConfiguredToken("alice", "human", "browser")))
    assertEquals(declared.tokens.authenticate(RotationToken), Some(ConfiguredToken("alice", "human", "rotation")))
    assertEquals(declared.tokens.authenticate(BotToken), Some(ConfiguredToken("bot", "agent", "worker")))
    Vector("short", "", "A" * 42 + "B", AliceToken + "\n", AliceToken + " ", Secrets.generate()).foreach { raw =>
      assertEquals(declared.tokens.authenticate(raw), None)
    }
    assertEquals(declared.users.map(_.id), Vector("alice", "bot"))
    assertEquals(declared.directory.admins, Set.empty[String])
  }
  directory.test("a disabled user's tokens do not authenticate but stay listed; listing is configured metadata with scope api") { dir =>
    val base = users(dir)
    val declared = loaded(base.updated(0, base.head.copy(enabled = false)))
    assertEquals(declared.tokens.authenticate(AliceToken), None)
    assertEquals(declared.tokens.listed("alice"), Vector(AccountToken("browser", "browser", "configured", None, false, Vector("api"))))
    assertEquals(declared.tokens.listed("nobody"), Vector.empty)
  }
  directory.test("password users are humans with a login and a readable hash; admins are declared") { dir =>
    val alice = withPassword(dir, users(dir).head).copy(tokens = Vector.empty, admin = true)
    val declared = loaded(Vector(alice))
    assertEquals(declared.users.head.login, Some("alice"))
    assert(declared.users.head.passwordHash.isDefined)
    assertEquals(declared.directory.admins, Set("alice"))
    assertEquals(refusal(Vector(alice.copy(login = None))), ConfigRefusal.InvalidPasswordCredentials)
    assertEquals(refusal(Vector(alice.copy(passwordHashFile = None))), ConfigRefusal.InvalidPasswordCredentials)
    assertEquals(refusal(Vector(alice.copy(userType = "agent", admin = false))), ConfigRefusal.InvalidPasswordCredentials)
    assertEquals(refusal(Vector(alice.copy(passwordHashFile = Some(write(dir, "bad.password", "not-a-hash"))))), ConfigRefusal.InvalidPasswordFile)
    Vector("", " alice", "alice ", "x" * 129, "al\u0000ice").foreach { login =>
      assertEquals(refusal(Vector(alice.copy(login = Some(login)))), ConfigRefusal.InvalidLogin, login)
    }
  }
  directory.test("an admin without a login is refused by the declared directory") { dir =>
    assertEquals(intercept[AccountFailure](DeclaredUsers.load(Vector(users(dir).head.copy(admin = true)))).code, "config")
  }
  directory.test("user ids, token ids, types and credentials fail closed with their refusal") { dir =>
    val c = users(dir)
    val token = c.head.tokens.head
    Vector[(Vector[DeclaredUserConfig], ConfigRefusal)](
      Vector.empty -> ConfigRefusal.NoUsers,
      (c :+ c.head) -> ConfigRefusal.DuplicateUserId,
      Vector(withPassword(dir, c.head), withPassword(dir, c(1).copy(userType = "human")).copy(login = Some("alice"))) -> ConfigRefusal.DuplicateLogin,
      Vector(c.head.copy(tokens = c.head.tokens ++ c.head.tokens)) -> ConfigRefusal.DuplicateTokenId,
      c.updated(1, c(1).copy(tokens = Vector(token.copy(id = "other")))) -> ConfigRefusal.DigestAssignedTwice,
      Vector(c.head.copy(tokens = c.head.tokens :+ token.copy(id = "other"))) -> ConfigRefusal.DigestAssignedTwice,
      Vector(c.head.copy(userType = "robot")) -> ConfigRefusal.InvalidUser,
      Vector(c.head.copy(tokens = Vector.empty)) -> ConfigRefusal.NoCredentials,
      Vector(c.head.copy(id = "")) -> ConfigRefusal.InvalidUser,
      Vector(c.head.copy(id = "alice:other")) -> ConfigRefusal.InvalidUser,
      Vector(c.head.copy(id = "x" * 129)) -> ConfigRefusal.InvalidUser,
      Vector(c.head.copy(tokens = Vector(token.copy(id = "")))) -> ConfigRefusal.InvalidTokenId,
      Vector(c.head.copy(tokens = Vector(token.copy(id = "a:b")))) -> ConfigRefusal.InvalidTokenId,
      Vector(c.head.copy(tokens = Vector(token.copy(id = "x" * 65)))) -> ConfigRefusal.InvalidTokenId,
      Vector(c.head.copy(tokens = Vector(token.copy(hashFile = dir.resolve("absent").toString)))) -> ConfigRefusal.UnreadableCredentialFile,
      Vector(c.head.copy(tokens = Vector(token.copy(hashFile = write(dir, "bad.sha", "not-a-digest"))))) -> ConfigRefusal.MalformedCredentialFile
    ).foreach { (config, expected) => assertEquals(refusal(config), expected) }
    assert(loaded(Vector(c.head.copy(id = "x" * 128, tokens = Vector(token.copy(id = "y" * 64))))).users.nonEmpty)
    assertEquals(DeclaredUsers.identities(Vector.empty), Left(ConfigRefusal.NoUsers))
    assertEquals(DeclaredUsers.identities(c :+ c.head), Left(ConfigRefusal.DuplicateUserId))
    assertEquals(DeclaredUsers.identities(c), Right(()))
  }
  directory.test("Unicode and ASCII whitespace cannot split or hide user and token ids") { dir =>
    val c = users(dir)
    Vector('\u00a0', '\u2003', '\u2028', '\u2029', '\ufeff', '\t', '\n', '\u000b', '\u1680', '\u202f', '\u205f', '\u3000', ' ').foreach { space =>
      assertEquals(refusal(Vector(c.head.copy(id = "alice" + space + "alias"))), ConfigRefusal.InvalidUser)
      assertEquals(refusal(Vector(c.head.copy(tokens = Vector(c.head.tokens.head.copy(id = "browser" + space + "alias"))))), ConfigRefusal.InvalidTokenId)
    }
  }
  directory.test("a token id check precedes reading its digest file") { dir =>
    val c = users(dir)
    assertEquals(refusal(Vector(c.head.copy(tokens = Vector(DeclaredTokenConfig("a:b", dir.resolve("absent").toString))))), ConfigRefusal.InvalidTokenId)
  }
  directory.test("digest files accept exactly 64 lower-case hex ASCII with at most one final LF") { dir =>
    val good = "a" * 64
    assertEquals(DigestFile.read(write(dir, "exact", good)), Right(good))
    assertEquals(DigestFile.read(write(dir, "lf", good + "\n")), Right(good))
    Vector("", "abc", "A" * 64, "g" * 64, good + "\n\n", good + "\r\n", good + " ", good + "\u0000", good + "x" * (2 * 1024 * 1024)).zipWithIndex.foreach { (raw, i) =>
      assertEquals(DigestFile.read(write(dir, s"bad$i", raw)), Left(ConfigRefusal.MalformedCredentialFile))
    }
    val alias = good.getBytes(StandardCharsets.US_ASCII); alias(0) = 0xe1.toByte
    val path = dir.resolve("alias"); Files.write(path, alias)
    assertEquals(DigestFile.read(path.toString), Left(ConfigRefusal.MalformedCredentialFile))
    assertEquals(DigestFile.read(dir.resolve("missing").toString), Left(ConfigRefusal.UnreadableCredentialFile))
  }
  directory.test("exact credential files take the exact length and pattern and refuse controls and high bytes") { dir =>
    assertEquals(ExactCredentialFile.read(write(dir, "token", AliceToken + "\n"), 43, "[A-Za-z0-9_-]{43}"), Right(AliceToken))
    Vector(0xc1, 0x80, 0x01, 0x7f, 0x00, 0x0d).foreach { byte =>
      val bytes = AliceToken.getBytes(StandardCharsets.US_ASCII); bytes(5) = byte.toByte
      val path = dir.resolve(s"token-$byte"); Files.write(path, bytes)
      assertEquals(ExactCredentialFile.read(path.toString, 43, "[A-Za-z0-9_-]{43}"), Left(ConfigRefusal.MalformedCredentialFile))
    }
  }

  private def accounts(keyFile: Option[String]) = ImperativeAccountsConfig(true, keyFile, false, true, 100, false, 86400L, Some("Service (svc.test)"), Vector.empty)
  directory.test("imperative accounts: the switch needs a runtime key file, an issuer and an enabled declarative admin") { dir =>
    val admin = withPassword(dir, users(dir).head).copy(admin = true)
    val declared = loaded(Vector(admin)).directory
    val key = write(dir, "totp.key", Secrets.generate() + "\n")
    assertEquals(ImperativeConfig.settings("svc", None, declared), Right(None))
    assertEquals(ImperativeConfig.settings("svc", Some(accounts(Some(key)).copy(enabled = false)), declared), Right(None))
    Vector(accounts(Some(key)).copy(enabled = false, signupEnabled = true), accounts(Some(key)).copy(enabled = false, enrollmentEnabled = true)).foreach { a =>
      assertEquals(ImperativeConfig.settings("svc", Some(a), declared), Left(ConfigRefusal.AccountsFlagsWithoutSwitch))
    }
    Vector(None, Some("relative/key"), Some("/nix/store/abc-key")).foreach { keyFile =>
      assertEquals(ImperativeConfig.settings("svc", Some(accounts(keyFile)), declared), Left(ConfigRefusal.AccountsKeyFile))
    }
    assertEquals(ImperativeConfig.settings("svc", Some(accounts(Some(key)).copy(issuer = None)), declared), Left(ConfigRefusal.AccountsIssuer))
    val disabled = loaded(Vector(admin.copy(enabled = false))).directory
    assertEquals(ImperativeConfig.settings("svc", Some(accounts(Some(key))), disabled), Left(ConfigRefusal.AccountsAdmin))
    val settings = ImperativeConfig.settings("svc", Some(accounts(Some(key))), declared).fold(r => fail(s"refused: $r"), identity).getOrElse(fail("switch off"))
    assertEquals((settings.service, settings.issuer, settings.maxUsers, settings.signup, settings.requireApproval), ("svc", "Service (svc.test)", 100, false, true))
    assertEquals(intercept[AccountFailure](ImperativeConfig.settings("svc", Some(accounts(Some(dir.resolve("absent").toString))), declared)).code, "config")
  }
}
