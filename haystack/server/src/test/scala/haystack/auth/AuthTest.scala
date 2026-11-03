package haystack.auth

import haystack.domain.{Fault, Principal}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.security.MessageDigest
import java.util.Base64
import scala.jdk.CollectionConverters.*

private[haystack] object AuthFixtures {
  val AliceToken: String = Base64.getUrlEncoder.withoutPadding.encodeToString(Array.fill[Byte](32)(1))
  val BotToken: String = Base64.getUrlEncoder.withoutPadding.encodeToString(Array.fill[Byte](32)(2))
  val RotationToken: String = Base64.getUrlEncoder.withoutPadding.encodeToString(Array.fill[Byte](32)(3))
  val Plain = "http://nb.test:8085"
  val Secure = "https://ts.test:8445"
  def directory[A](body: Path => A): A = {
    val dir = Files.createTempDirectory("haystack-auth-synthetic-")
    try body(dir) finally {
      val paths = Files.walk(dir)
      try paths.iterator.asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)) finally paths.close()
    }
  }
  def write(dir: Path, name: String, value: String): String = {
    val path = dir.resolve(name)
    Files.writeString(path, value, StandardCharsets.UTF_8)
    path.toString
  }
  def config(dir: Path): AuthConfig = {
    val alice = write(dir, "alice.sha", Tokens.hash(AliceToken) + "\n")
    val bot = write(dir, "bot.sha", Tokens.hash(BotToken))
    AuthConfig("agent-activity", Vector(UserConfig("alice", "human", "Alice", Vector(TokenConfig("browser", alice))),
      UserConfig("bot", "agent", "Bot", Vector(TokenConfig("worker", bot)))), cookieSecure = true,
      allowedHosts = Vector("nb.test", "ts.test"), allowedOrigins = Vector(Plain, Secure), insecureHttpOrigins = Vector(Plain))
  }
}

/** BA for token math; Effectual-GoodCommunication for strict credential-file
  * bytes. All fixtures are synthetic, no external auth/secret dependencies.
  */
class TokensTest extends munit.FunSuite {
  import AuthFixtures.*
  test("generated tokens are independent canonical 32-byte base64url and stable SHA256") {
    val tokens = Vector.fill(50)(Tokens.generate())
    assertEquals(tokens.distinct.size, 50)
    tokens.foreach { token =>
      assert(Tokens.canonical(token)); assertEquals(token.length, 43)
      assertEquals(Base64.getUrlDecoder.decode(token).length, 32)
      val expected = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII)).map(b => f"${b & 255}%02x").mkString
      assertEquals(Tokens.hash(token), expected)
    }
  }
  test("all alternate pad-bit aliases are rejected, canonical zero token remains valid") {
    val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    assert(Tokens.canonical("A" * 43))
    Vector('B', 'C', 'D').foreach { last =>
      val alias = "A" * 42 + last
      assertEquals(Base64.getUrlDecoder.decode(alias).toVector, Vector.fill[Byte](32)(0))
      assert(!Tokens.canonical(alias))
      val failure = intercept[Fault](Tokens.hash(alias))
      assertEquals(failure.code, "unauthorized"); assert(!failure.message.contains(alias))
    }
  }
  Vector("", "short", AliceToken + "\n", AliceToken + " ", AliceToken + "=", "A" * 42 + "Á", "A" * 42 + "+", "A" * 42 + "/").zipWithIndex.foreach { case (token, i) =>
    test(s"malformed direct token presentation $i never hashes") {
      assert(!Tokens.canonical(token)); assertEquals(intercept[Fault](Tokens.hash(token)).code, "unauthorized")
    }
  }
  test("token files accept only exact ASCII token or one terminal LF") { directory { dir =>
    Vector("", "\n").zipWithIndex.foreach { case (suffix, i) => assertEquals(Tokens.readToken(write(dir, s"ok$i", AliceToken + suffix)), AliceToken) }
    Vector("", AliceToken.take(42), AliceToken + "\n\n", AliceToken + "\r\n", AliceToken + " ", " " + AliceToken,
      "x\n" + AliceToken, AliceToken.take(10) + "\n" + AliceToken.drop(10), AliceToken + "\u0000", "A" * 42 + "B").zipWithIndex.foreach { case (raw, i) =>
      assertEquals(intercept[Fault](Tokens.readToken(write(dir, s"bad$i", raw))).code, "config")
    }
    assertEquals(intercept[Fault](Tokens.readToken(dir.resolve("missing").toString)).code, "config")
  } }
  test("raw high-bit aliases, controls and DEL never become ASCII credentials") { directory { dir =>
    Vector(0xc1, 0xe6, 0x80, 0x01, 0x7f, 0x00, 0x0a, 0x0d).foreach { byte =>
      Vector(0, 5, 42).foreach { position =>
        val bytes = AliceToken.getBytes(StandardCharsets.US_ASCII); bytes(position) = byte.toByte
        val path = dir.resolve(s"token-$byte-$position"); Files.write(path, bytes)
        assertEquals(intercept[Fault](Tokens.readToken(path.toString)).code, "config")
      }
    }
  } }
  test("oversized credential files reject trailing payload instead of admitting a valid prefix") { directory { dir =>
    val suffix = "x" * (2 * 1024 * 1024)
    Vector(AliceToken, AliceToken + "\n").zipWithIndex.foreach { case (prefix, i) =>
      assertEquals(intercept[Fault](Tokens.readToken(write(dir, s"large-token-$i", prefix + suffix))).code, "config")
    }
    Vector("a" * 64, "a" * 64 + "\n").zipWithIndex.foreach { case (prefix, i) =>
      assertEquals(intercept[Fault](Tokens.readDigest(write(dir, s"large-digest-$i", prefix + suffix))).code, "config")
    }
  } }
  test("digest files strictly accept lowercase hex ASCII with at most final LF") { directory { dir =>
    val good = "a" * 64
    assertEquals(Tokens.readDigest(write(dir, "exact", good)), good)
    assertEquals(Tokens.readDigest(write(dir, "lf", good + "\n")), good)
    Vector("", "abc", "A" * 64, "g" * 64, good + "\n\n", good + "\r\n", good + " ", good + "\u0000").zipWithIndex.foreach { case (raw, i) =>
      assertEquals(intercept[Fault](Tokens.readDigest(write(dir, s"bad$i", raw))).code, "config")
    }
    val alias = good.getBytes(StandardCharsets.US_ASCII); alias(0) = 0xe1.toByte
    Vector(Array.emptyByteArray, Array(10.toByte)).zipWithIndex.foreach { case (suffix, i) =>
      val path = dir.resolve(s"alias$i"); Files.write(path, alias ++ suffix)
      assertEquals(intercept[Fault](Tokens.readDigest(path.toString)).code, "config")
    }
    assertEquals(intercept[Fault](Tokens.readDigest(dir.resolve("missing").toString)).code, "config")
  } }
}

class AuthConfigTest extends munit.FunSuite {
  import AuthFixtures.*
  test("valid static configuration authenticates every identity/token without type authorization") { directory { dir =>
    val cfg = config(dir)
    val rotation = TokenConfig("rotation", write(dir, "rotation.sha", Tokens.hash(RotationToken)))
    val auth = Auth.load(cfg.copy(users = cfg.users.updated(0, cfg.users.head.copy(tokens = cfg.users.head.tokens :+ rotation))))
    assertEquals(auth.config.activityProjectId, "agent-activity")
    assertEquals(auth.authenticate(AliceToken), Some(Principal("alice", "human", "browser")))
    assertEquals(auth.authenticate(RotationToken), Some(Principal("alice", "human", "rotation")))
    assertEquals(auth.authenticate(BotToken), Some(Principal("bot", "agent", "worker")))
    Vector("short", "", "A" * 42 + "B", AliceToken + "\n", AliceToken + " ", "A" * 42 + "Á", Tokens.generate()).foreach { raw => assertEquals(auth.authenticate(raw), None) }
  } }
  val inconsistencies: Vector[(String, AuthConfig => AuthConfig)] = Vector(
    "duplicate users" -> (c => c.copy(users = c.users :+ c.users.head)),
    "duplicate token IDs" -> (c => c.copy(users = Vector(c.users.head.copy(tokens = c.users.head.tokens ++ c.users.head.tokens)))),
    "duplicate digest across users" -> (c => c.copy(users = c.users.updated(1, c.users(1).copy(tokens = Vector(c.users.head.tokens.head.copy(id = "other")))))),
    "duplicate digest within user" -> (c => c.copy(users = Vector(c.users.head.copy(tokens = c.users.head.tokens :+ c.users.head.tokens.head.copy(id = "other"))))),
    "invalid attribution type" -> (c => c.copy(users = Vector(c.users.head.copy(userType = "robot")))),
    "empty token list" -> (c => c.copy(users = Vector(c.users.head.copy(tokens = Vector.empty)))),
    "empty users" -> (c => c.copy(users = Vector.empty)),
    "empty user ID" -> (c => c.copy(users = Vector(c.users.head.copy(id = "")))),
    "colon user ID" -> (c => c.copy(users = Vector(c.users.head.copy(id = "alice:other")))),
    "whitespace user ID" -> (c => c.copy(users = Vector(c.users.head.copy(id = "alice other")))),
    "overlong user ID" -> (c => c.copy(users = Vector(c.users.head.copy(id = "x" * 129)))),
    "empty token ID" -> (c => c.copy(users = Vector(c.users.head.copy(tokens = Vector(c.users.head.tokens.head.copy(id = "")))))),
    "colon token ID" -> (c => c.copy(users = Vector(c.users.head.copy(tokens = Vector(c.users.head.tokens.head.copy(id = "a:b")))))),
    "overlong token ID" -> (c => c.copy(users = Vector(c.users.head.copy(tokens = Vector(c.users.head.tokens.head.copy(id = "x" * 65))))))
  )
  inconsistencies.foreach { case (name, change) => test("fails closed: " + name) { directory { dir =>
    val fault = intercept[Fault](Auth.load(change(config(dir))))
    assertEquals(fault.code, "config"); assert(!fault.message.contains(AliceToken)); assert(!fault.message.contains(BotToken))
  } } }
  Vector('\u00a0', '\u2003', '\u2028', '\u2029', '\ufeff', '\t', '\n').zipWithIndex.foreach { case (space, i) =>
    test(s"Unicode/ASCII whitespace $i cannot split or hide user/token attribution IDs") { directory { dir =>
      val cfg = config(dir)
      val badUser = cfg.users.head.copy(id = "alice" + space + "alias")
      assertEquals(intercept[Fault](Auth.load(cfg.copy(users = Vector(badUser)))).code, "config")
      val badToken = cfg.users.head.copy(tokens = Vector(cfg.users.head.tokens.head.copy(id = "browser" + space + "alias")))
      assertEquals(intercept[Fault](Auth.load(cfg.copy(users = Vector(badToken)))).code, "config")
    } }
  }
  test("invalid namespace or unreadable/malformed credential never starts auth") { directory { dir =>
    val cfg = config(dir)
    assertEquals(intercept[Fault](Auth.load(cfg.copy(activityProjectId = ""))).code, "invalid-id")
    assertEquals(intercept[Fault](Auth.load(cfg.copy(activityProjectId = "bad\u0000"))).code, "invalid-id")
    val missing = cfg.users.head.copy(tokens = Vector(TokenConfig("browser", dir.resolve("absent").toString)))
    assertEquals(intercept[Fault](Auth.load(cfg.copy(users = Vector(missing)))).code, "config")
    Files.writeString(Path.of(cfg.users.head.tokens.head.hashFile), "not-a-digest")
    assertEquals(intercept[Fault](Auth.load(cfg)).code, "config")
  } }
  test("reload revokes removed token/user while exact retained cookie survives restart") { directory { dir =>
    val cfg = config(dir); val before = Auth.load(cfg); val afterRestart = Auth.load(cfg)
    val headers = RequestHeaders("ts.test:8445", cookie = Vector(s"__Host-haystack=$AliceToken"))
    assertEquals(Sessions.resolve(before, headers).principal, Sessions.resolve(afterRestart, headers).principal)
    val revoked = Auth.load(cfg.copy(users = Vector(cfg.users.head)))
    assertEquals(revoked.authenticate(BotToken), None)
    assertEquals(revoked.authenticate(AliceToken), Some(Principal("alice", "human", "browser")))
    val replacedHash = write(dir, "replacement.sha", Tokens.hash(RotationToken))
    val rotated = Auth.load(cfg.copy(users = Vector(cfg.users.head.copy(tokens = Vector(TokenConfig("browser", replacedHash))))))
    assertEquals(rotated.authenticate(AliceToken), None)
    assertEquals(rotated.authenticate(RotationToken), Some(Principal("alice", "human", "browser")))
    assertEquals(intercept[Fault](Sessions.resolve(rotated, headers)).code, "unauthorized")
  } }
  Vector("https://nb.test:8085", Plain + "/", Plain + "/path", Plain + "?q=1", "http://u:p@nb.test:8085", "null", "http://other.test:8085").zipWithIndex.foreach { case (origin, i) =>
    test(s"insecure opt-in rejects malformed or non-dedicated origin $i") { directory { dir =>
      assertEquals(intercept[Fault](Auth.load(config(dir).copy(insecureHttpOrigins = Vector(origin)))).code, "config")
    } }
  }
  test("insecure opt-in requires matching allowed host/origin and exclusive effective port") { directory { dir =>
    val cfg = config(dir)
    Vector(cfg.copy(allowedHosts = Vector("ts.test")), cfg.copy(allowedOrigins = Vector(Secure)),
      cfg.copy(allowedOrigins = cfg.allowedOrigins :+ "https://nb.test:8085"),
      cfg.copy(allowedOrigins = Vector("http://nb.test:443", "https://nb.test"), insecureHttpOrigins = Vector("http://nb.test:443"))).foreach { bad =>
      assertEquals(intercept[Fault](Auth.load(bad)).code, "config")
    }
    Auth.load(cfg.copy(allowedOrigins = Vector(Plain, "https://nb.test:8445")))
  } }
}

/** BA, specified-origin security characterization at the same pure header
  * resolver used by HTTP/MCP. Transport/network behavior is tested separately.
  */
class SessionsTest extends munit.FunSuite {
  import AuthFixtures.*
  def withAuth(body: Auth => Unit): Unit = directory(dir => body(Auth.load(config(dir))))
  def unauthorized(body: => Any, code: String = "unauthorized"): Unit = assertEquals(intercept[Fault](body).code, code)

  test("serialize login/renewal/logout cookies with exact security flags and lifetime") {
    Vector(false, true).foreach { secure =>
      val cookie = Sessions.serialize(Some(AliceToken), secure)
      assert(cookie.startsWith(Sessions.name(secure) + "=" + AliceToken + ";"))
      assert(cookie.contains("Path=/; HttpOnly; SameSite=Strict; Max-Age=15552000"))
      assertEquals(cookie.contains("; Secure"), secure)
      assert(!cookie.contains("Domain=")); assert(!cookie.contains("Expires="))
      val logout = Sessions.serialize(None, secure)
      assert(logout.startsWith(Sessions.name(secure) + "=;")); assert(logout.contains("Max-Age=0")); assertEquals(logout.contains("; Secure"), secure)
    }
  }
  test("bearer resolves exact principal without mutation CSRF and rejects absent/unknown/malformed") { withAuth { auth =>
    val headers = RequestHeaders("ts.test:8445", authorization = Vector("Bearer " + BotToken))
    val got = Sessions.resolve(auth, headers, mutate = true)
    assertEquals(got.principal, Principal("bot", "agent", "worker")); assert(!got.cookie); assert(got.secureCookie)
    Vector(Vector.empty, Vector("Basic " + AliceToken), Vector("bearer " + AliceToken), Vector("Bearer  " + AliceToken),
      Vector("Bearer " + AliceToken + "\n"), Vector("Bearer short"), Vector("Bearer " + Tokens.generate())).foreach { values =>
      unauthorized(Sessions.resolve(auth, headers.copy(authorization = values)))
    }
  } }
  test("duplicate bearer and bearer-plus-selected-cookie are ambiguous; never pick one") { withAuth { auth =>
    val base = RequestHeaders("ts.test:8445", authorization = Vector("Bearer " + AliceToken))
    unauthorized(Sessions.resolve(auth, base.copy(authorization = Vector("Bearer " + AliceToken, "Bearer " + BotToken))), "ambiguous-credentials")
    unauthorized(Sessions.resolve(auth, base.copy(cookie = Vector("__Host-haystack=" + BotToken))), "ambiguous-credentials")
    unauthorized(Sessions.resolve(auth, base.copy(cookie = Vector("__Host-haystack=invalid"))), "ambiguous-credentials")
  } }
  test("only authority-selected cookie authenticates; other cookie is never fallback") { withAuth { auth =>
    Vector(("nb.test:8085", "haystack-dev", false), ("ts.test:8445", "__Host-haystack", true)).foreach { case (host, name, secure) =>
      val headers = RequestHeaders(host, cookie = Vector(s"other=x; $name=$AliceToken"))
      val got = Sessions.resolve(auth, headers)
      assertEquals(got.principal.userId, "alice"); assert(got.cookie); assertEquals(got.secureCookie, secure)
      val wrongName = if (secure) "haystack-dev" else "__Host-haystack"
      unauthorized(Sessions.resolve(auth, headers.copy(cookie = Vector(s"$wrongName=$AliceToken"))))
      assertEquals(Sessions.resolve(auth, headers.copy(cookie = Vector(s"$name=$AliceToken; $wrongName=invalid"))).principal.userId, "alice")
    }
  } }
  test("duplicate session cookie across headers or inside one header is ambiguous") { withAuth { auth =>
    val pair = s"__Host-haystack=$AliceToken"
    Vector(Vector(pair, pair), Vector(pair + "; " + pair)).foreach { cookies =>
      unauthorized(Sessions.resolve(auth, RequestHeaders("ts.test:8445", cookie = cookies)), "ambiguous-credentials")
    }
  } }
  test("cookie mutations require allowed Origin or exact same-origin fetch metadata") { withAuth { auth =>
    val base = RequestHeaders("ts.test:8445", cookie = Vector("__Host-haystack=" + AliceToken))
    unauthorized(Sessions.resolve(auth, base, mutate = true), "forbidden")
    unauthorized(Sessions.resolve(auth, base.copy(fetchSite = Some("same-site")), mutate = true), "forbidden")
    unauthorized(Sessions.resolve(auth, base.copy(origin = Vector("https://evil.test")), mutate = true), "forbidden")
    unauthorized(Sessions.resolve(auth, base.copy(origin = Vector(Secure, Secure)), mutate = true), "forbidden")
    assert(Sessions.resolve(auth, base.copy(origin = Vector(Secure)), mutate = true).cookie)
    assert(Sessions.resolve(auth, base.copy(fetchSite = Some("same-origin")), mutate = true).cookie)
    unauthorized(Sessions.csrf(auth.config, base.copy(origin = Vector("https://evil.test"), fetchSite = Some("same-origin"))), "forbidden")
  } }
  test("disallowed/malformed Host fails for bearer and cookie, not only mutations") { withAuth { auth =>
    Vector("evil.test", "", "ts.test/path", "ts.test@evil.test", "ts.test?x", "ts.test#x", "ts.test\\evil", "ts.test\n").foreach { host =>
      unauthorized(Sessions.resolve(auth, RequestHeaders(host, authorization = Vector("Bearer " + AliceToken))), "forbidden")
    }
    assertEquals(Sessions.resolve(auth, RequestHeaders("TS.TEST:8445", authorization = Vector("Bearer " + AliceToken))).principal.userId, "alice")
  } }
  test("mixed Host/allowed-Origin spoofing fails even on cookie reads") { withAuth { auth =>
    Vector(("nb.test:8085", Secure), ("ts.test:8445", Plain)).foreach { case (host, origin) =>
      unauthorized(Sessions.resolve(auth, RequestHeaders(host, origin = Vector(origin), cookie = Vector(s"haystack-dev=$AliceToken; __Host-haystack=$AliceToken"))), "forbidden")
    }
  } }
  test("plain-cookie opt-in never downgrades other ports or absent/empty configuration") { withAuth { auth =>
    assert(Sessions.secure(auth.config, RequestHeaders("nb.test:8086")))
    assert(Sessions.secure(auth.config.copy(insecureHttpOrigins = Vector.empty), RequestHeaders("nb.test:8085")))
    assert(!Sessions.secure(auth.config.copy(cookieSecure = false, insecureHttpOrigins = Vector.empty), RequestHeaders("ts.test:8445")))
    unauthorized(Sessions.resolve(auth, RequestHeaders("nb.test:8086", cookie = Vector("haystack-dev=" + AliceToken))))
  } }
  test("MCP accepts only bearer and rejects either browser cookie alongside bearer") { withAuth { auth =>
    Vector("nb.test:8085", "ts.test:8445").foreach { host =>
      val base = RequestHeaders(host, authorization = Vector("Bearer " + AliceToken))
      assertEquals(Sessions.resolve(auth, base, mcp = true).principal.userId, "alice")
      Vector("haystack-dev", "__Host-haystack").foreach { name =>
        unauthorized(Sessions.resolve(auth, base.copy(cookie = Vector(s"$name=$AliceToken")), mcp = true))
        unauthorized(Sessions.resolve(auth, base.copy(authorization = Vector.empty, cookie = Vector(s"$name=$AliceToken")), mcp = true))
      }
    }
  } }
}
