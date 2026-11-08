package rites

import cats.effect.{IO, unsafe}
import cats.effect.std.Semaphore
import fs2.Stream
import java.nio.file.Files
import org.http4s.{Headers, Method, Request, RequestCookie, Response, Status, Uri}
import org.http4s.headers.{Cookie, Origin as _}
import org.typelevel.ci.CIString
import rites.api.*

final class HttpApiTest extends munit.FunSuite {
  private implicit val runtime: unsafe.IORuntime = unsafe.implicits.global
  private def fixture(secure: Boolean = false): (RitesStore, Config, HttpApi, Semaphore[IO]) = {
    val root = Files.createTempDirectory("rites-http"); val config = StoreFixture.config(root).copy(secureCookies = secure, allowedOrigin = if (secure) "https://rites.example.invalid" else "http://127.0.0.1:18448")
    val store = new MemoryStore(config, () => java.time.Instant.now()); store.initialize()
    val control = new ControlService(store, config, StoreFixture.vault, RuntimeModels(Nil), new CredentialLocks)
    (store, config, new HttpApi(config, control, store, logstage.IzLogger()), Semaphore[IO](2).unsafeRunSync())
  }
  private def request(method: Method, path: String, config: Config, body: Option[String], cookie: Option[String] = None, user: Option[String] = None, origin: Option[String] = None): Request[IO] = {
    val headers = List("Origin" -> origin.getOrElse(config.allowedOrigin), "Content-Type" -> "application/json") ++ user.map("X-Rites-User" -> _)
    val req = Request[IO](method, Uri.unsafeFromString(path), headers = Headers(headers.map((k, v) => org.http4s.Header.Raw(CIString(k), v))))
    val withCookie = cookie.fold(req)(secret => req.addCookie(RequestCookie(if (config.secureCookies) "__Host-rites_session" else "rites_session", secret)))
    body.fold(withCookie)(text => withCookie.withEntity(text).putHeaders(org.http4s.Header.Raw(CIString("Content-Type"), "application/json")))
  }
  private def login(api: HttpApi, gate: Semaphore[IO], config: Config, staleCookie: Option[String] = None): Response[IO] = {
    val text = JsonSupport.encode(LoginRequest.codecJson, LoginRequest("owner", StoreFixture.plaintext)).noSpaces
    val req = request(Method.POST, "/api/login", config, Some(text), staleCookie)
    api.routes(gate).orNotFound.run(req).unsafeRunSync()
  }
  test("success response and cookie converge UI with actual cookie principal") {
    val (store, config, api, gate) = fixture(); try {
      val cookie = login(api, gate, config).cookies.find(_.name == "rites_session").get.content
      val me = api.routes(gate).orNotFound.run(request(Method.GET, "/api/me", config, None, Some(cookie))).unsafeRunSync()
      assertEquals(me.status, Status.Ok); assertEquals(me.headers.get(CIString("X-Rites-User")).map(_.head.value), Some("owner"))
    } finally store.close()
  }
  test("secure cookies use host-only prefix") {
    val (store, config, api, gate) = fixture(true); try {
      val result = login(api, gate, config); assert(result.cookies.exists(cookie => cookie.name == "__Host-rites_session" && cookie.secure && cookie.httpOnly && cookie.path.contains("/")))
    } finally store.close()
  }
  test("stale cookie does not prevent password login recovery or logout clearing") {
    val (store, config, api, gate) = fixture(); try {
      val recovered = login(api, gate, config, Some("expired-cookie")); assertEquals(recovered.status, Status.Ok)
      val cleared = api.routes(gate).orNotFound.run(request(Method.POST, "/api/logout", config, None, Some("expired-cookie"))).unsafeRunSync()
      assertEquals(cleared.status, Status.Ok); assert(cleared.cookies.exists(_.maxAge.contains(0)))
    } finally store.close()
  }
  test("mutation requires expected principal and no secret is stored on late account switch") {
    val (store, config, api, gate) = fixture(); try {
      val cookie = login(api, gate, config).cookies.find(_.name == "rites_session").get.content
      val text = JsonSupport.encode(SaveCredentialRequest.codecJson, SaveCredentialRequest(None, "late fixture", ForgeKind.Gitlab, "git.example.invalid", "never-store", 0, CredentialMode.Token, None, None, None)).noSpaces
      val response = api.routes(gate).orNotFound.run(request(Method.PUT, "/api/credentials", config, Some(text), Some(cookie), Some("another-user"))).unsafeRunSync()
      assertEquals(response.status, Status.Forbidden)
      assert(!JsonSupport.encode(CredentialsResult.codecJson, CredentialsResult(store.credentials(store.login("owner", StoreFixture.plaintext, 3600)._1))).noSpaces.contains("never-store"))
    } finally store.close()
  }
  test("bad origin and invalid cookie preflight reject before consuming request body") {
    val (store, config, api, gate) = fixture(); try {
      val base = request(Method.POST, "/api/runs", config, None, Some("expired-cookie"), Some("owner"), Some("http://attacker.example.invalid"))
      val requestWithPoisonBody = base.withBodyStream(Stream.raiseError[IO](DomainError("body-consumed")))
      val response = api.routes(gate).orNotFound.run(requestWithPoisonBody).unsafeRunSync()
      assertEquals(response.status, Status.Forbidden)
    } finally store.close()
  }
}
