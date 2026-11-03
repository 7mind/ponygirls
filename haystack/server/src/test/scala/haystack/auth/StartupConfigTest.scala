package haystack.auth

import cats.effect.ExitCode
import cats.effect.unsafe.implicits.global
import haystack.{Config, Main}
import io.circe.Json
import java.nio.file.{Files, Path}
import scala.concurrent.duration.*

/** BA/BG + owned filesystem: characterize the actual configuration/startup
  * rejection path. Subprocess/SIGTERM is transport-owned.
  */
class StartupConfigTest extends munit.FunSuite {
  override val munitTimeout = 30.seconds
  import AuthFixtures.*
  private def valid(dir: Path): Json = {
    val auth = config(dir)
    Json.obj(
      "listenHost" -> Json.fromString("127.0.0.1"), "listenPort" -> Json.fromInt(8765), "webRoot" -> Json.Null, "authReloadMs" -> Json.fromInt(1000),
      "auth" -> Json.obj(
        "activityProjectId" -> Json.fromString(auth.activityProjectId), "users" -> Json.arr(auth.users.map { user => Json.obj(
          "id" -> Json.fromString(user.id), "type" -> Json.fromString(user.userType), "displayName" -> Json.fromString(user.displayName),
          "tokens" -> Json.arr(user.tokens.map(token => Json.obj("id" -> Json.fromString(token.id), "hashFile" -> Json.fromString(token.hashFile)))*)) }*),
        "cookieSecure" -> Json.True, "allowedHosts" -> Json.arr(Json.fromString("nb.test"), Json.fromString("ts.test")),
        "allowedOrigins" -> Json.arr(Json.fromString(Plain), Json.fromString(Secure)), "insecureHttpOrigins" -> Json.arr(Json.fromString(Plain)), "rateLimit" -> Json.Null),
      // Deliberately unreachable: valid check-config must never contact a DB;
      // invalid auth must fail before serve/migrate acquires DB resources.
      "database" -> Json.obj("jdbcUrl" -> Json.fromString("jdbc:postgresql://127.0.0.1:1/haystack_synthetic_test"), "user" -> Json.fromString("synthetic"),
        "passwordFile" -> Json.fromString(write(dir, "database.password", "synthetic-not-a-secret")), "limits" -> Json.obj(
          "maxConnections" -> Json.fromInt(4), "maxQueued" -> Json.fromInt(4), "queueTimeoutMs" -> Json.fromInt(1000), "connectTimeoutMs" -> Json.fromInt(1000),
          "statementTimeoutMs" -> Json.fromInt(3000), "lockTimeoutMs" -> Json.fromInt(1000), "idleTransactionTimeoutMs" -> Json.fromInt(3000), "socketTimeoutMs" -> Json.fromInt(5000))),
      "retrieval" -> Json.obj("policy" -> Json.fromString("synthetic-approved"), "includeMetadata" -> Json.True, "approvedFieldPrefixes" -> Json.arr(Json.fromString("/public")),
        "maxChunkBytes" -> Json.fromInt(4096), "embedding" -> Json.Null, "maxConcurrent" -> Json.fromInt(2), "maxQueued" -> Json.fromInt(2), "batchSize" -> Json.fromInt(16)))
  }
  private def set(json: Json, path: String, value: Json): Json = {
    def update(current: Json, parts: List[String]): Json = parts match {
      case key :: Nil => current.mapObject(_.add(key, value))
      case key :: rest => current.mapObject(obj => obj.add(key, update(obj(key).get, rest)))
      case Nil => value
    }
    update(json, path.split('/').toList)
  }
  private def file(dir: Path, json: Json): Path = {
    val path = dir.resolve("service.json"); Files.writeString(path, json.noSpaces); path
  }
  test("complete current config loads exactly and check-config validates auth without DB access") { directory { dir =>
    val path = file(dir, valid(dir)); val loaded = Config.load(path)
    assertEquals(loaded.listenHost, "127.0.0.1"); assertEquals(loaded.listenPort, 8765)
    assertEquals(loaded.authReloadMs, 1000); assertEquals(loaded.auth.users.map(_.userType), Vector("human", "agent"))
    assertEquals(loaded.retrieval.embedding, None); assertEquals(loaded.retrieval.policy.approvedFieldPrefixes, Vector("/public"))
    assertEquals(Auth.load(loaded.auth).authenticate(AliceToken).map(_.userId), Some("alice"))
    assertEquals(Main.run(List("check-config", path.toString)).unsafeRunSync(), ExitCode.Success)
  } }
  Vector(
    "listenPort" -> Json.fromInt(0), "listenPort" -> Json.fromInt(65536), "listenHost" -> Json.fromString(""), "authReloadMs" -> Json.fromInt(99),
    "authReloadMs" -> Json.fromInt(60001), "database/jdbcUrl" -> Json.fromString("jdbc:postgresql://secret:password@localhost/test"),
    "database/jdbcUrl" -> Json.fromString("jdbc:postgresql://localhost/test?password=secret"), "database/passwordFile" -> Json.fromString("relative-secret"),
    "database/limits/maxConnections" -> Json.fromInt(0), "database/limits/maxQueued" -> Json.fromInt(-1),
    "database/limits/queueTimeoutMs" -> Json.fromInt(0), "database/limits/socketTimeoutMs" -> Json.fromInt(3600001),
    "retrieval/approvedFieldPrefixes" -> Json.arr(Json.fromString("not-a-pointer")), "retrieval/approvedFieldPrefixes" -> Json.arr(Json.fromString("/bad~2")),
    "retrieval/approvedFieldPrefixes" -> Json.arr(Json.fromString("/a"), Json.fromString("/a")), "retrieval/maxChunkBytes" -> Json.fromInt(3),
    "retrieval/maxConcurrent" -> Json.fromInt(0), "retrieval/maxConcurrent" -> Json.fromInt(33), "retrieval/maxQueued" -> Json.fromInt(1025),
    "retrieval/batchSize" -> Json.fromInt(0), "retrieval/batchSize" -> Json.fromInt(1025), "listenPort" -> Json.fromString("8765")
  ).zipWithIndex.foreach { case ((path, value), i) =>
    test(s"invalid current configuration $i fails startup, not fallback/default coercion") { directory { dir =>
      val pathToConfig = file(dir, set(valid(dir), path, value))
      intercept[Exception](Config.load(pathToConfig))
      assertEquals(Main.run(List("check-config", pathToConfig.toString)).unsafeRunSync(), ExitCode.Error)
    } }
  }
  Vector("empty-users", "duplicate-users", "unknown-user-type", "missing-hash-file", "malformed-hash", "wrong-namespace", "wrong-insecure-origin").foreach { kind =>
    test("Main rejects startup auth: " + kind) { directory { dir =>
      val base = valid(dir)
      val users = base.hcursor.downField("auth").get[Vector[Json]]("users").toOption.get
      val json = kind match {
        case "empty-users" => set(base, "auth/users", Json.arr())
        case "duplicate-users" => set(base, "auth/users", Json.arr((users :+ users.head)*))
        case "unknown-user-type" => set(base, "auth/users", Json.arr(users.head.mapObject(_.add("type", Json.fromString("robot")))))
        case "missing-hash-file" =>
          Files.delete(dir.resolve("alice.sha")); base
        case "malformed-hash" =>
          Files.writeString(dir.resolve("alice.sha"), "INVALID-SYNTHETIC-DIGEST"); base
        case "wrong-namespace" => set(base, "auth/activityProjectId", Json.fromString(""))
        case _ => set(base, "auth/insecureHttpOrigins", Json.arr(Json.fromString("http://other.test:8085")))
      }
      val path = file(dir, json)
      Vector("check-config", "migrate", "serve").foreach { command =>
        assertEquals(Main.run(List(command, path.toString)).unsafeRunSync(), ExitCode.Error)
      }
    } }
  }
  test("missing, malformed and duplicate-key config inputs fail closed") { directory { dir =>
    assertEquals(Main.run(List("check-config", dir.resolve("missing.json").toString)).unsafeRunSync(), ExitCode.Error)
    Vector("{", "{\"listenPort\":1,\"listenPort\":2}", "{\"x\":\"\\uD800\"}").zipWithIndex.foreach { case (raw, i) =>
      val path = dir.resolve(s"bad$i.json"); Files.writeString(path, raw)
      assertEquals(Main.run(List("check-config", path.toString)).unsafeRunSync(), ExitCode.Error)
    }
    assertEquals(Main.run(List("unknown-command", "ignored")).unsafeRunSync(), ExitCode.Error)
  } }
}
