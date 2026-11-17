package ponygirls.auth

import io.circe.Json
import java.nio.file.Files
import java.util.Base64

final class AccountBoundarySuite extends munit.FunSuite {
  test("BA specified: password format is compatible with Chronicle PBKDF2 SHA256") {
    val expected = "pbkdf2-sha256$600000$MDEyMzQ1Njc4OWFiY2RlZg==$3ArOiyG6CqntzRIDHJINBA8mwW84bEFOne2AFV1f+7Q="
    assert(Password.validHash(expected))
    assert(Password.verify("synthetic-password".toCharArray, expected))
    assert(!Password.verify("wrong".toCharArray, expected))
    val generated = Password.hash("synthetic-new-password".toCharArray)
    assert(Password.validHash(generated))
    assert(Password.verify("synthetic-new-password".toCharArray, generated))
  }
  test("BA specified: malformed password hashes are rejected without exposing input") {
    // A token digest (SHA-256 hex, 64 chars) is a different codec from the
    // PBKDF2 password hash and must never validate as one.
    Vector("", "pbkdf2-sha256", "pbkdf2-sha256$1$AA==$AA==", "pbkdf2-sha256$2147483647$AA==$AA==", "a" * 64,
      "0e6b8f4bbf1c118b7f2a92a12bb4a38b2b6c3f58b5b7cc0d34b7ee228b7f0e21", "x" * 1000).foreach { value =>
      assert(!Password.validHash(value))
      assert(!Password.verify("synthetic".toCharArray, value))
    }
  }
  test("Effectual GoodCommunication specified: runtime password files accept one LF and managed symlinks only") {
    val directory = Files.createTempDirectory("account-password-")
    val file = directory.resolve("password.pbkdf2")
    val reference = directory.resolve("managed")
    try {
      val encoded = Password.hash("synthetic".toCharArray)
      Files.writeString(file, encoded + "\n")
      Files.createSymbolicLink(reference, file)
      assertEquals(Password.readHash(reference), encoded)
      Files.writeString(file, encoded + "\r\n")
      assertEquals(intercept[AccountFailure](Password.readHash(reference)).code, "config")
      Files.writeString(file, "x" * 500)
      assertEquals(intercept[AccountFailure](Password.readHash(reference)).code, "config")
    } finally {
      Files.deleteIfExists(reference); Files.deleteIfExists(file); Files.deleteIfExists(directory)
    }
  }
  test("BA specified: account requests have exact shapes and bounded required fields") {
    val login = Json.obj("login" -> Json.fromString("alice"), "password" -> Json.fromString("synthetic"))
    assertEquals(AccountJson.decodeLogin(login), ("alice", "synthetic"))
    val issue = Json.obj("name" -> Json.fromString("client"), "scopes" -> Json.arr(Json.fromString("api")))
    assertEquals(AccountJson.decodeIssue(issue), ("client", Vector("api")))
    Vector(login.deepMerge(Json.obj("token" -> Json.fromString("secret"))), Json.Null, Json.obj("login" -> Json.fromString("alice"))).foreach(value =>
      assertEquals(intercept[AccountFailure](AccountJson.decodeLogin(value)).code, "invalid"))
    Vector(issue.deepMerge(Json.obj("scopes" -> Json.arr(Json.fromString("api"), Json.fromString("api")))), issue.deepMerge(Json.obj("name" -> Json.fromString("")))).foreach(value =>
      assertEquals(intercept[AccountFailure](AccountJson.decodeIssue(value)).code, "invalid"))
    assertEquals(AccountJson.failure("private SQL or secret").hcursor.downField("error").get[String]("code"), Right("unavailable"))
  }
  test("BA specified: account mutations bind the intended owner independently of cookie changes") {
    val alice = AccountUser("alice", "human", "Alice", Some("alice"), None, true, AccountOrigin.Declarative)
    val actor = AccountJson.user(alice).hcursor.get[String]("actor").toOption.get
    AccountJson.requireActor(Vector(actor), "alice")
    assertEquals(intercept[AccountFailure](AccountJson.requireActor(Vector(actor), "bob")).code, "conflict")
    Vector(Vector.empty, Vector(actor, actor), Vector("not-an-actor")).foreach { offered =>
      assertEquals(intercept[AccountFailure](AccountJson.requireActor(offered, "alice")).code, "invalid")
    }
    assertEquals(AccountJson.actor("alice"), actor)
    assertNotEquals(AccountJson.actor("bob"), actor)
  }
  test("BA specified: raw account JSON rejects duplicate fields malformed Unicode and excess bounds") {
    assertEquals(AccountJson.decodeLogin(AccountJson.parse("{\"login\":\"alice\",\"password\":\"synthetic\"}")), ("alice", "synthetic"))
    Vector("{\"login\":\"alice\",\"login\":\"bob\",\"password\":\"synthetic\"}", "{\"login\":\"alice\",\"password\":\"first\",\"password\":\"second\"}", "[" * 10 + "0" + "]" * 10, " " * (AccountJson.maxBodyBytes + 1)).foreach { raw =>
      assertEquals(intercept[AccountFailure](AccountJson.parse(raw)).code, "invalid")
    }
    assertEquals(intercept[AccountFailure](AccountJson.parseUtf8(Array(0xc3.toByte, 0x28.toByte))).code, "invalid")
  }
  test("BA specified: generated secrets are canonical and cookie retention is not a server TTL") {
    val secret = Secrets.generate()
    assert(Secrets.canonical(secret))
    assertEquals(Secrets.digest(secret).length, 64)
    assert(!Secrets.canonical("not-a-token"))
    assertEquals(PersistentCookie.maxAgeSeconds, 34560000L)
  }
}
