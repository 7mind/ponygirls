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
  private def loaded(users: Vector[DeclaredUserConfig]): Declared = DeclaredUsers.load(users, DeclaredIdRules.Haystack, DigestRead.Snapshot, DigestReader.Stream).fold(r => fail(s"refused: $r"), identity)
  private def refusal(users: Vector[DeclaredUserConfig]): ConfigRefusal = DeclaredUsers.load(users, DeclaredIdRules.Haystack, DigestRead.Snapshot, DigestReader.Stream).fold(identity, _ => fail("loaded"))

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
    assertEquals(intercept[AccountFailure](DeclaredUsers.load(Vector(users(dir).head.copy(admin = true)), DeclaredIdRules.Haystack, DigestRead.Snapshot, DigestReader.Stream)).code, "config")
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
    assertEquals(DigestReader.Stream.read(write(dir, "exact", good)), Right(good))
    assertEquals(DigestReader.Stream.read(write(dir, "lf", good + "\n")), Right(good))
    Vector("", "abc", "A" * 64, "g" * 64, good + "\n\n", good + "\r\n", good + " ", good + "\u0000", good + "x" * (2 * 1024 * 1024)).zipWithIndex.foreach { (raw, i) =>
      assertEquals(DigestReader.Stream.read(write(dir, s"bad$i", raw)), Left(ConfigRefusal.MalformedCredentialFile))
    }
    val alias = good.getBytes(StandardCharsets.US_ASCII); alias(0) = 0xe1.toByte
    val path = dir.resolve("alias"); Files.write(path, alias)
    assertEquals(DigestReader.Stream.read(path.toString), Left(ConfigRefusal.MalformedCredentialFile))
    assertEquals(DigestReader.Stream.read(dir.resolve("missing").toString), Left(ConfigRefusal.UnreadableCredentialFile))
  }
  directory.test("exact credential files take the exact length and pattern and refuse controls and high bytes") { dir =>
    assertEquals(ExactCredentialFile.read(write(dir, "token", AliceToken + "\n"), 43, "[A-Za-z0-9_-]{43}"), Right(AliceToken))
    Vector(0xc1, 0x80, 0x01, 0x7f, 0x00, 0x0d).foreach { byte =>
      val bytes = AliceToken.getBytes(StandardCharsets.US_ASCII); bytes(5) = byte.toByte
      val path = dir.resolve(s"token-$byte"); Files.write(path, bytes)
      assertEquals(ExactCredentialFile.read(path.toString, 43, "[A-Za-z0-9_-]{43}"), Left(ConfigRefusal.MalformedCredentialFile))
    }
  }

  private def load(users: Vector[DeclaredUserConfig], rules: DeclaredIdRules, read: DigestRead, reader: DigestReader): Either[ConfigRefusal, Declared] =
    DeclaredUsers.load(users, rules, read, reader)
  private def manure(users: Vector[DeclaredUserConfig]): Either[ConfigRefusal, Declared] = load(users, DeclaredIdRules.Manure, DigestRead.Snapshot, DigestReader.Stream)

  directory.test("Manure's ids are any non-empty text; an administrator's id holds no NUL; logins keep surrounding spaces") { dir =>
    val c = users(dir)
    val token = c.head.tokens.head
    Vector("alice other", "alice:other", "x" * 500, "al\u0000ice", "\u00e9l\u00e8ve", " alice ").foreach { id =>
      assert(manure(Vector(c.head.copy(id = id))).isRight, id)
    }
    Vector("tok en", "a:b", "x" * 100, "\u0000").foreach { id =>
      assert(manure(Vector(c.head.copy(tokens = Vector(token.copy(id = id))))).isRight, id)
    }
    assertEquals(manure(Vector(c.head.copy(id = ""))).map(_ => ()), Left(ConfigRefusal.InvalidUser))
    assertEquals(manure(Vector(c.head.copy(tokens = Vector(token.copy(id = ""))))).map(_ => ()), Left(ConfigRefusal.InvalidTokenId))
    val admin = withPassword(dir, c.head).copy(admin = true)
    assert(manure(Vector(admin)).isRight)
    assertEquals(manure(Vector(admin.copy(id = "al\u0000ice"))).map(_ => ()), Left(ConfigRefusal.InvalidUser))
    assert(manure(Vector(admin.copy(login = Some(" alice ")))).isRight)
    Vector("", "x" * 129, "al\u0007ice").foreach { login =>
      assertEquals(manure(Vector(admin.copy(login = Some(login)))).map(_ => ()), Left(ConfigRefusal.InvalidLogin), login)
    }
    Vector("alice other", "alice:other", "x" * 129).foreach { id =>
      assertEquals(load(Vector(c.head.copy(id = id)), DeclaredIdRules.Haystack, DigestRead.Snapshot, DigestReader.Stream).map(_ => ()), Left(ConfigRefusal.InvalidUser), id)
    }
  }
  directory.test("a snapshot keeps the digests of its load; a rewritten or removed file takes effect on the next load") { dir =>
    val c = users(dir)
    val declared = load(c, DeclaredIdRules.Haystack, DigestRead.Snapshot, DigestReader.Stream).fold(r => fail(s"refused: $r"), identity)
    write(dir, "alice.sha", Secrets.digest(RotationToken))
    Files.delete(dir.resolve("bot.sha"))
    assertEquals(declared.tokens.authenticate(AliceToken), Some(ConfiguredToken("alice", "human", "browser")))
    assertEquals(declared.tokens.authenticate(BotToken), Some(ConfiguredToken("bot", "agent", "worker")))
    assertEquals(declared.tokens.authenticate(RotationToken), None)
    assert(declared.tokens.live("alice", "browser", Secrets.digest(AliceToken)))
    assert(!declared.tokens.live("bot", "worker", Secrets.digest(AliceToken)))
  }
  directory.test("read per check: a rewritten file takes effect at once, a removed or malformed one fails closed alone, a shared digest matches nobody") { dir =>
    val c = users(dir)
    val declared = load(c, DeclaredIdRules.Haystack, DigestRead.PerCheck, DigestReader.Stream).fold(r => fail(s"refused: $r"), identity)
    val alice = ConfiguredToken("alice", "human", "browser")
    assertEquals(declared.tokens.authenticate(AliceToken), Some(alice))
    write(dir, "alice.sha", Secrets.digest(RotationToken))
    assertEquals(declared.tokens.authenticate(RotationToken), Some(alice))
    assertEquals(declared.tokens.authenticate(AliceToken), None)
    assert(declared.tokens.live("alice", "browser", Secrets.digest(RotationToken)))
    assert(!declared.tokens.live("alice", "browser", Secrets.digest(AliceToken)))
    Files.delete(dir.resolve("bot.sha"))
    assertEquals(declared.tokens.authenticate(BotToken), None)
    assertEquals(declared.tokens.authenticate(RotationToken), Some(alice))
    write(dir, "bot.sha", "not-a-digest")
    assertEquals(declared.tokens.authenticate(RotationToken), Some(alice))
    write(dir, "bot.sha", Secrets.digest(RotationToken))
    assertEquals(declared.tokens.authenticate(RotationToken), None)
    assert(!declared.tokens.live("alice", "browser", Secrets.digest(RotationToken)))
    assertEquals(declared.tokens.authenticate("A" * 42 + "B"), None)
  }
  directory.test("read per check: a disabled user's tokens never authenticate and stay listed; the load still refuses a shared digest") { dir =>
    val c = users(dir)
    val declared = load(c.updated(1, c(1).copy(enabled = false)), DeclaredIdRules.Haystack, DigestRead.PerCheck, DigestReader.Stream).fold(r => fail(s"refused: $r"), identity)
    assertEquals(declared.tokens.authenticate(BotToken), None)
    assert(!declared.tokens.live("bot", "worker", Secrets.digest(BotToken)))
    assertEquals(declared.tokens.listed("bot").map(_.id), Vector("worker"))
    val shared = c.updated(1, c(1).copy(tokens = Vector(c.head.tokens.head.copy(id = "other"))))
    assertEquals(load(shared, DeclaredIdRules.Haystack, DigestRead.PerCheck, DigestReader.Stream).map(_ => ()), Left(ConfigRefusal.DigestAssignedTwice))
  }
  directory.test("the bounded reader takes regular files, also through a symbolic link or a relative path, and refuses special files and oversize unread") { dir =>
    val good = "a" * 64
    val target = write(dir, "digest", good + "\n")
    val link = dir.resolve("link"); Files.createSymbolicLink(link, Path.of(target))
    assertEquals(DigestReader.Bounded.read(target), Right(good))
    assertEquals(DigestReader.Bounded.read(link.toString), Right(good))
    assertEquals(DigestReader.Bounded.read(Path.of("").toAbsolutePath.relativize(Path.of(target)).toString), Right(good))
    assertEquals(DigestReader.Bounded.read("/dev/null"), Left(ConfigRefusal.UnreadableCredentialFile))
    assertEquals(DigestReader.Stream.read("/dev/null"), Left(ConfigRefusal.MalformedCredentialFile))
    Vector(good + "\nx", good + "\r\n", good + "x" * (2 * 1024 * 1024)).zipWithIndex.foreach { (raw, i) =>
      assertEquals(DigestReader.Bounded.read(write(dir, s"long$i", raw)), Left(ConfigRefusal.UnreadableCredentialFile))
      assertEquals(DigestReader.Stream.read(dir.resolve(s"long$i").toString), Left(ConfigRefusal.MalformedCredentialFile))
    }
    Vector("", "abc", "A" * 64, "g" * 64, good.dropRight(1) + "\n\n", " " + good.drop(1), good.dropRight(1) + "\u0000").zipWithIndex.foreach { (raw, i) =>
      assertEquals(DigestReader.Bounded.read(write(dir, s"bad$i", raw)), Left(ConfigRefusal.MalformedCredentialFile), raw)
    }
    val alias = good.getBytes(StandardCharsets.US_ASCII); alias(0) = 0xe1.toByte
    val aliasPath = dir.resolve("alias"); Files.write(aliasPath, alias)
    assertEquals(DigestReader.Bounded.read(aliasPath.toString), Left(ConfigRefusal.UnreadableCredentialFile))
    assertEquals(DigestReader.Bounded.read(dir.resolve("missing").toString), Left(ConfigRefusal.UnreadableCredentialFile))
    val declared = load(users(dir), DeclaredIdRules.Haystack, DigestRead.PerCheck, DigestReader.Bounded).fold(r => fail(s"refused: $r"), identity)
    assertEquals(declared.tokens.authenticate(AliceToken), Some(ConfiguredToken("alice", "human", "browser")))
  }

  private def accounts(keyFile: Option[String]) = ImperativeAccountsConfig(true, keyFile, false, true, 100, false, 86400L, Some("Service (svc.test)"), Vector.empty)
  directory.test("imperative accounts: the switch needs a runtime key file, an issuer and an enabled declarative admin") { dir =>
    val admin = withPassword(dir, users(dir).head).copy(admin = true)
    val declared = loaded(Vector(admin)).directory
    val key = write(dir, "totp.key", Secrets.generate() + "\n")
    assertEquals(ImperativeConfig.settings("svc", None, declared, KeyFilePolicy.LiteralStorePrefix), Right(None))
    assertEquals(ImperativeConfig.settings("svc", Some(accounts(Some(key)).copy(enabled = false)), declared, KeyFilePolicy.LiteralStorePrefix), Right(None))
    Vector(accounts(Some(key)).copy(enabled = false, signupEnabled = true), accounts(Some(key)).copy(enabled = false, enrollmentEnabled = true)).foreach { a =>
      assertEquals(ImperativeConfig.settings("svc", Some(a), declared, KeyFilePolicy.LiteralStorePrefix), Left(ConfigRefusal.AccountsFlagsWithoutSwitch))
    }
    Vector(None, Some("relative/key"), Some("/nix/store/abc-key")).foreach { keyFile =>
      assertEquals(ImperativeConfig.settings("svc", Some(accounts(keyFile)), declared, KeyFilePolicy.LiteralStorePrefix), Left(ConfigRefusal.AccountsKeyFile))
    }
    assertEquals(ImperativeConfig.settings("svc", Some(accounts(Some(key)).copy(issuer = None)), declared, KeyFilePolicy.LiteralStorePrefix), Left(ConfigRefusal.AccountsIssuer))
    val disabled = loaded(Vector(admin.copy(enabled = false))).directory
    assertEquals(ImperativeConfig.settings("svc", Some(accounts(Some(key))), disabled, KeyFilePolicy.LiteralStorePrefix), Left(ConfigRefusal.AccountsAdmin))
    val settings = ImperativeConfig.settings("svc", Some(accounts(Some(key))), declared, KeyFilePolicy.LiteralStorePrefix).fold(r => fail(s"refused: $r"), identity).getOrElse(fail("switch off"))
    assertEquals((settings.service, settings.issuer, settings.maxUsers, settings.signup, settings.requireApproval), ("svc", "Service (svc.test)", 100, false, true))
    assertEquals(intercept[AccountFailure](ImperativeConfig.settings("svc", Some(accounts(Some(dir.resolve("absent").toString))), declared, KeyFilePolicy.LiteralStorePrefix)).code, "config")
  }

  directory.test("a persisted grant is live by user id, token id and digest only while exactly one enabled token has the digest") { dir =>
    val c = users(dir)
    val declared = load(c.updated(1, c(1).copy(enabled = false)) :+ c(1).copy(id = "carol", userType = "human", tokens = Vector(DeclaredTokenConfig("worker", write(dir, "carol.sha", Secrets.digest(RotationToken))))),
      DeclaredIdRules.Manure, DigestRead.PerCheck, DigestReader.Bounded).fold(r => fail(s"refused: $r"), identity)
    val alice = Secrets.digest(AliceToken)
    assert(declared.tokens.live("alice", "browser", alice))
    assert(!declared.tokens.live("alice", "other", alice))
    assert(!declared.tokens.live("carol", "browser", alice))
    assert(!declared.tokens.live("bot", "worker", Secrets.digest(BotToken)))
    assert(declared.tokens.live("carol", "worker", Secrets.digest(RotationToken)))
    write(dir, "alice.sha", Secrets.digest(RotationToken))
    assert(!declared.tokens.live("carol", "worker", Secrets.digest(RotationToken)))
    assert(!declared.tokens.live("alice", "browser", Secrets.digest(RotationToken)))
    assert(!declared.tokens.live("alice", "browser", alice))
    Files.delete(dir.resolve("alice.sha"))
    assert(declared.tokens.live("carol", "worker", Secrets.digest(RotationToken)))
    assert(!declared.tokens.live("alice", "browser", Secrets.digest(RotationToken)))
  }
  directory.test("a fresh load sees a rotated digest and refuses an unreadable one") { dir =>
    val c = users(dir)
    val before = loaded(c)
    write(dir, "alice.sha", Secrets.digest(RotationToken))
    val after = loaded(c)
    assertEquals(after.tokens.authenticate(RotationToken), Some(ConfiguredToken("alice", "human", "browser")))
    assertEquals(after.tokens.authenticate(AliceToken), None)
    assertEquals(before.tokens.authenticate(AliceToken), Some(ConfiguredToken("alice", "human", "browser")))
    Files.delete(dir.resolve("bot.sha"))
    DigestRead.values.foreach { read =>
      assertEquals(load(c, DeclaredIdRules.Haystack, read, DigestReader.Stream).map(_ => ()), Left(ConfigRefusal.UnreadableCredentialFile))
    }
  }
  directory.test("a digest shared with a disabled user's token is refused at load in both read modes") { dir =>
    val c = users(dir)
    val shared = c.updated(1, c(1).copy(enabled = false, tokens = Vector(c.head.tokens.head.copy(id = "other"))))
    DigestRead.values.foreach { read =>
      assertEquals(load(shared, DeclaredIdRules.Haystack, read, DigestReader.Stream).map(_ => ()), Left(ConfigRefusal.DigestAssignedTwice))
    }
  }
  directory.test("no loaded value prints a password hash, a digest or a configured secret") { dir =>
    val alice = withPassword(dir, users(dir).head).copy(admin = true)
    val declared = loaded(Vector(alice, users(dir)(1)))
    val hash = declared.users.head.passwordHash.getOrElse(fail("no hash"))
    val printed = Vector(declared.toString, declared.users.toString, declared.directory.toString, declared.tokens.toString,
      declared.tokens.authenticate(AliceToken).toString)
    printed.foreach { text =>
      Vector(hash, Secrets.digest(AliceToken), Secrets.digest(BotToken), AliceToken, BotToken).foreach(secret => assert(!text.contains(secret), text))
    }
  }
  test("key-file policies: Haystack's literal store prefix and Manure's normalised path differ on the store and on `..`") {
    import KeyFilePolicy.*
    Vector("/run/keys/totp", "/nix/storex/key", "/var/lib/svc/totp.key").foreach { path =>
      assert(LiteralStorePrefix.admits(path), path); assert(NormalizedPath.admits(path), path)
    }
    Vector("relative/key", "", "/nix/store/abc-key", "/nix/store/").foreach { path =>
      assert(!LiteralStorePrefix.admits(path), path); assert(!NormalizedPath.admits(path), path)
    }
    assert(LiteralStorePrefix.admits("/nix/store")); assert(!NormalizedPath.admits("/nix/store"))
    assert(!LiteralStorePrefix.admits("/nix/store/../etc/key")); assert(NormalizedPath.admits("/nix/store/../etc/key"))
    assert(LiteralStorePrefix.admits("/etc/../nix/store/abc-key")); assert(!NormalizedPath.admits("/etc/../nix/store/abc-key"))
    assert(LiteralStorePrefix.admits("/run/\u0000key")); assert(!NormalizedPath.admits("/run/\u0000key"))
  }
  directory.test("the imperative settings apply the key-file policy they are given") { dir =>
    val declared = loaded(Vector(withPassword(dir, users(dir).head).copy(admin = true))).directory
    assertEquals(ImperativeConfig.settings("svc", Some(accounts(Some("/etc/../nix/store/abc-key"))), declared, KeyFilePolicy.NormalizedPath), Left(ConfigRefusal.AccountsKeyFile))
    assertEquals(ImperativeConfig.settings("svc", Some(accounts(Some("/nix/store"))), declared, KeyFilePolicy.NormalizedPath), Left(ConfigRefusal.AccountsKeyFile))
    assertEquals(intercept[AccountFailure](ImperativeConfig.settings("svc", Some(accounts(Some("/etc/../nix/store/abc-key"))), declared, KeyFilePolicy.LiteralStorePrefix)).code, "config")
  }
}
