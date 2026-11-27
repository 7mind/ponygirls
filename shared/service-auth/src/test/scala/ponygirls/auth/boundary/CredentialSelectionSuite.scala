package ponygirls.auth.boundary

import java.util.Base64

/** BA specified: the one credential a request presents, at the pure header level. Synthetic secrets only. */
final class CredentialSelectionSuite extends munit.FunSuite {
  private def secret(fill: Int) = Base64.getUrlEncoder.withoutPadding.encodeToString(Array.fill[Byte](32)(fill.toByte))
  private val Alice = secret(1)
  private val Bot = secret(2)
  private val Session = secret(4)
  private val Plain = "http://nb.test:8085"
  private val Secure = "https://ts.test:8445"
  private val Names = SessionCookies("__Host-svc", "svc-dev", CookieValue.Trimmed)
  private val Policy = OriginPolicy.load(Vector("nb.test", "ts.test"), Vector(Plain, Secure), Vector(Plain), true).fold(r => fail(s"refused: $r"), identity)
  private def headers(host: String, authorization: Vector[String] = Vector.empty, cookie: Vector[String] = Vector.empty,
      origin: Vector[String] = Vector.empty, fetchSite: Option[String] = None) = PresentedHeaders(host, authorization, cookie, origin, fetchSite, Vector.empty)
  private def resolve(h: PresentedHeaders, accept: CredentialAccept = CredentialAccept.BearerOrCookie, mutate: Boolean = false): Presented =
    CredentialSelection.resolve(Policy, Names, h, accept, mutate)
  private def refused(expected: Refusal)(body: => Any): Unit = assertEquals(intercept[BoundaryRefused](body).refusal, expected)

  test("a bearer needs no same-origin proof; absent or malformed presentations are invalid credentials") {
    val bearer = headers("ts.test:8445", authorization = Vector("Bearer " + Bot))
    assertEquals(resolve(bearer, mutate = true), Presented(Bot, false, true))
    Vector(Vector.empty, Vector("Basic " + Alice), Vector("bearer " + Alice), Vector("Bearer  " + Alice), Vector("Bearer " + Alice + "\n"),
      Vector("Bearer short"), Vector("Bearer " + "A" * 42 + "B")).foreach { values =>
      refused(Refusal.InvalidCredentials)(resolve(bearer.copy(authorization = values)))
    }
  }
  test("two bearers, or a bearer and the selected cookie, are ambiguous; neither is picked") {
    val base = headers("ts.test:8445", authorization = Vector("Bearer " + Alice))
    refused(Refusal.AmbiguousCredentials)(resolve(base.copy(authorization = Vector("Bearer " + Alice, "Bearer " + Bot))))
    refused(Refusal.AmbiguousCredentials)(resolve(base.copy(cookie = Vector("__Host-svc=" + Bot))))
    refused(Refusal.AmbiguousCredentials)(resolve(base.copy(cookie = Vector("__Host-svc=invalid"))))
  }
  test("only the cookie of the request's security class is taken; the other name is never a fallback") {
    Vector(("nb.test:8085", "svc-dev", false), ("ts.test:8445", "__Host-svc", true)).foreach { (host, name, secure) =>
      val h = headers(host, cookie = Vector(s"other=x; $name=$Session"))
      assertEquals(resolve(h), Presented(Session, true, secure))
      val wrong = if (secure) "svc-dev" else "__Host-svc"
      refused(Refusal.InvalidCredentials)(resolve(h.copy(cookie = Vector(s"$wrong=$Session"))))
      assertEquals(resolve(h.copy(cookie = Vector(s"$name=$Session; $wrong=invalid"))).secret, Session)
    }
    refused(Refusal.InvalidCredentials)(resolve(headers("nb.test:8086", cookie = Vector("svc-dev=" + Session))))
  }
  test("a duplicate session cookie, across headers or within one, is refused") {
    val pair = "__Host-svc=" + Session
    Vector(Vector(pair, pair), Vector(pair + "; " + pair)).foreach { cookies =>
      refused(Refusal.DuplicateSessionCookie)(resolve(headers("ts.test:8445", cookie = cookies)))
    }
  }
  test("a cookie mutation needs the same-origin proof") {
    val base = headers("ts.test:8445", cookie = Vector("__Host-svc=" + Session))
    refused(Refusal.SameOriginProofMissing)(resolve(base, mutate = true))
    refused(Refusal.SameOriginProofMissing)(resolve(base.copy(fetchSite = Some("same-site")), mutate = true))
    refused(Refusal.DisallowedOrigin)(resolve(base.copy(origin = Vector("https://evil.test")), mutate = true))
    refused(Refusal.AmbiguousOrigin)(resolve(base.copy(origin = Vector(Secure, Secure)), mutate = true))
    assert(resolve(base.copy(origin = Vector(Secure)), mutate = true).cookie)
    assert(resolve(base.copy(fetchSite = Some("same-origin")), mutate = true).cookie)
  }
  test("the transport rule applies to bearers and cookies, reads included") {
    Vector("evil.test", "", "ts.test/path", "ts.test@evil.test", "ts.test\n").foreach { host =>
      refused(Refusal.DisallowedHost)(resolve(headers(host, authorization = Vector("Bearer " + Alice))))
    }
    assertEquals(resolve(headers("TS.TEST:8445", authorization = Vector("Bearer " + Alice))).secret, Alice)
    Vector(("nb.test:8085", Secure), ("ts.test:8445", Plain)).foreach { (host, origin) =>
      refused(Refusal.OriginHostMismatch)(resolve(headers(host, origin = Vector(origin), cookie = Vector(s"svc-dev=$Session; __Host-svc=$Session"))))
    }
  }
  test("a bearer-only route takes the bearer and refuses either session cookie") {
    Vector("nb.test:8085", "ts.test:8445").foreach { host =>
      val base = headers(host, authorization = Vector("Bearer " + Alice))
      assertEquals(resolve(base, CredentialAccept.BearerOnly).secret, Alice)
      Vector("svc-dev", "__Host-svc").foreach { name =>
        refused(Refusal.CookieNotAccepted)(resolve(base.copy(cookie = Vector(s"$name=$Alice")), CredentialAccept.BearerOnly))
        refused(Refusal.CookieNotAccepted)(resolve(base.copy(authorization = Vector.empty, cookie = Vector(s"$name=$Alice")), CredentialAccept.BearerOnly))
      }
    }
  }
  test("the presented secret is redacted from its string form") {
    val presented = resolve(headers("ts.test:8445", authorization = Vector("Bearer " + Alice)))
    assert(!presented.toString.contains(Alice))
  }
}
