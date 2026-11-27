package ponygirls.auth.boundary

import java.util.Base64

/** BA specified: Host, Origin and same-origin proof over configured host names and canonical origins. Synthetic
  * `.test` names only; no DNS or network. */
final class OriginPolicySuite extends munit.FunSuite {
  private val Session = Base64.getUrlEncoder.withoutPadding.encodeToString(Array.fill[Byte](32)(4))
  private val Plain = "http://nb.test:8085"
  private val Secure = "https://ts.test:8445"
  private val Names = SessionCookies("__Host-svc", "svc-dev", CookieValue.Trimmed)
  private def policy(hosts: Vector[String] = Vector("nb.test", "ts.test"), origins: Vector[String] = Vector(Plain, Secure),
      insecure: Vector[String] = Vector(Plain), cookieSecure: Boolean = true): OriginPolicy =
    OriginPolicy.load(hosts, origins, insecure, cookieSecure).fold(r => fail(s"refused: $r"), identity)
  private def headers(host: String, cookie: Vector[String] = Vector.empty, origin: Vector[String] = Vector.empty,
      fetchSite: Option[String] = None, accountRequest: Vector[String] = Vector.empty, authorization: Vector[String] = Vector.empty) =
    PresentedHeaders(host, authorization, cookie, origin, fetchSite, accountRequest)
  private def refused(expected: Refusal)(body: => Any): Unit = assertEquals(intercept[BoundaryRefused](body).refusal, expected)

  Vector("http://example.test", "https://example.test", "http://example.test:8080", "https://example.test:8443",
    "http://127.0.0.1:1", "http://example.test:0", "https://example.test:65535").foreach { origin =>
    test("canonical origin accepted exactly: " + origin) {
      assertEquals(CanonicalOrigin.parse(origin).map(_.toString), Right(origin))
    }
  }
  test("noncanonical origins are refused; unparsable ones as malformed") {
    Vector("null", "", "ftp://example.test", "HTTPS://example.test", "https://EXAMPLE.test", "http://example.test:80",
      "https://example.test:443", "https://user:pass@example.test", "https://example.test/", "https://example.test/path",
      "https://example.test?q=1", "https://example.test#fragment", "https://example.test:65536", "http://example.test:70000",
      "http://example.test:-1").foreach { origin =>
      assertEquals(CanonicalOrigin.parse(origin), Left(ConfigRefusal.NonCanonicalOrigin), origin)
    }
    Vector("https://example.test\\evil", "https://example.test\n").foreach { origin =>
      assertEquals(CanonicalOrigin.parse(origin), Left(ConfigRefusal.MalformedOrigin), origin)
    }
  }
  test("effective ports are protocol defaults or exact explicit values") {
    def parsed(raw: String) = CanonicalOrigin.parse(raw).fold(r => fail(s"refused: $r"), identity)
    assertEquals(CanonicalOrigin.port(parsed("https://example.test")), 443)
    assertEquals(CanonicalOrigin.port(parsed("http://example.test")), 80)
    assertEquals(CanonicalOrigin.authority(parsed("http://example.test:443")), "example.test:443")
    assertEquals(CanonicalOrigin.authority(RequestAuthority.parse("EXAMPLE.test:8085")), "example.test:8085")
  }
  test("malformed request Host is a disallowed host") {
    Vector("", "example.test:65536", "example.test:70000", "example.test:-1", "example.test\u0000", "example.test:443/path",
      "example.test@other.test", "example.test\\path", "example.test?query", "example.test#fragment", "example.test\r\n").foreach { host =>
      refused(Refusal.DisallowedHost)(RequestAuthority.parse(host))
    }
  }
  test("an insecure origin must be an allowed http origin of an allowed host on an authority and port of its own") {
    Vector("https://nb.test:8085", Plain + "/", "http://u:p@nb.test:8085", "http://other.test:8085").foreach { origin =>
      assert(OriginPolicy.load(Vector("nb.test", "ts.test"), Vector(Plain, Secure), Vector(origin), true).isLeft, origin)
    }
    Vector((Vector("ts.test"), Vector(Plain, Secure), Vector(Plain)), (Vector("nb.test", "ts.test"), Vector(Secure), Vector(Plain)),
      (Vector("nb.test", "ts.test"), Vector(Plain, Secure, "https://nb.test:8085"), Vector(Plain)),
      (Vector("nb.test"), Vector("http://nb.test:443", "https://nb.test"), Vector("http://nb.test:443"))).foreach { (hosts, origins, insecure) =>
      assertEquals(OriginPolicy.load(hosts, origins, insecure, true).map(_ => ()), Left(ConfigRefusal.InsecureOriginNotDedicated))
    }
    assertEquals(OriginPolicy.load(Vector("nb.test"), Vector("https://nb.test", "ftp://nb.test"), Vector.empty, true).map(_ => ()), Left(ConfigRefusal.NonCanonicalOrigin))
    assert(OriginPolicy.load(Vector("nb.test", "ts.test"), Vector(Plain, "https://nb.test:8445"), Vector(Plain), true).isRight)
  }
  test("the plain cookie applies only on the opted-in authority and never with cookieSecure off downgraded elsewhere") {
    assert(!policy().secureCookie(headers("nb.test:8085")))
    assert(policy().secureCookie(headers("nb.test:8086")))
    assert(policy().secureCookie(headers("ts.test:8445")))
    assert(policy(insecure = Vector.empty).secureCookie(headers("nb.test:8085")))
    assert(!policy(insecure = Vector.empty, cookieSecure = false).secureCookie(headers("ts.test:8445")))
    refused(Refusal.DisallowedHost)(policy().secureCookie(headers("ts.test/path")))
  }
  test("transport: Host name allowed on any port, at most one allowed Origin of the request's security class") {
    val p = policy()
    p.validateTransport(headers("TS.TEST:9999"))
    refused(Refusal.DisallowedHost)(p.validateTransport(headers("evil.test")))
    refused(Refusal.AmbiguousOrigin)(p.validateTransport(headers("ts.test:8445", origin = Vector(Secure, Secure))))
    refused(Refusal.DisallowedOrigin)(p.validateTransport(headers("ts.test:8445", origin = Vector("https://evil.test"))))
    refused(Refusal.OriginHostMismatch)(p.validateTransport(headers("nb.test:8085", origin = Vector(Secure))))
    refused(Refusal.OriginHostMismatch)(p.validateTransport(headers("ts.test:8445", origin = Vector(Plain))))
    p.validateTransport(headers("nb.test:8085", origin = Vector(Plain)))
  }
  test("a cookie write proves same origin with one allowed Origin, or with no Origin and Sec-Fetch-Site same-origin") {
    val p = policy()
    p.csrf(headers("ts.test:8445", origin = Vector(Secure)))
    p.csrf(headers("ts.test:8445", fetchSite = Some("same-origin")))
    Vector(headers("ts.test:8445"), headers("ts.test:8445", fetchSite = Some("same-site")), headers("ts.test:8445", origin = Vector("https://evil.test")),
      headers("ts.test:8445", origin = Vector(Secure, Secure)), headers("ts.test:8445", origin = Vector("https://evil.test"), fetchSite = Some("same-origin"))).foreach { h =>
      refused(Refusal.SameOriginProofMissing)(p.csrf(h))
    }
  }
  test("account reads on an insecure-HTTP origin prove same origin with the account request header, writes do not") {
    val p = policy()
    val read = headers("nb.test:8085", cookie = Vector("svc-dev=" + Session), accountRequest = Vector(OriginPolicy.AccountRequestValue))
    p.accountTransport(read, safeRead = true, Names)
    refused(Refusal.SameOriginProofMissing)(p.accountTransport(read.copy(accountRequest = Vector.empty), safeRead = true, Names))
    refused(Refusal.SameOriginProofMissing)(p.accountTransport(read.copy(accountRequest = Vector("1", "1")), safeRead = true, Names))
    refused(Refusal.SameOriginProofMissing)(p.accountTransport(read.copy(fetchSite = Some("cross-site")), safeRead = true, Names))
    refused(Refusal.SameOriginProofMissing)(p.accountTransport(read, safeRead = false, Names))
    refused(Refusal.SameOriginProofMissing)(p.accountTransport(headers("ts.test:8445", cookie = Vector("__Host-svc=" + Session), accountRequest = Vector("1")), safeRead = true, Names))
    p.accountTransport(read.copy(origin = Vector(Plain)), safeRead = false, Names)
    assertEquals(OriginPolicy.AccountRequestHeader, "X-Account-Request")
  }
  test("the account plane wants the request's exact authority, no bearer and no duplicate cookie of either name") {
    val p = policy()
    val write = headers("ts.test:8445", origin = Vector(Secure), cookie = Vector("__Host-svc=" + Session))
    p.accountTransport(write, safeRead = false, Names)
    refused(Refusal.OriginHostMismatch)(p.accountTransport(write.copy(host = "ts.test:9999"), safeRead = false, Names))
    refused(Refusal.OriginHostMismatch)(p.accountTransport(write.copy(host = "ts.test", origin = Vector.empty, fetchSite = Some("same-origin")), safeRead = false, Names))
    refused(Refusal.BrowserSessionRequired)(p.accountTransport(write.copy(authorization = Vector("Bearer " + Session)), safeRead = false, Names))
    Vector("__Host-svc", "svc-dev").foreach { name =>
      refused(Refusal.DuplicateSessionCookie)(p.accountTransport(write.copy(cookie = Vector(s"$name=a; $name=b")), safeRead = false, Names))
    }
  }
  test("the account plane refuses an Origin of another allowed authority than the one the Host names") {
    val p = OriginPolicy.load(Vector("ts.test", "other.test"), Vector(Secure, "https://ts.test:9445", "https://other.test"), Vector.empty, true)
      .fold(r => fail(s"refused: $r"), identity)
    val write = headers("ts.test:8445", origin = Vector(Secure), cookie = Vector("__Host-svc=" + Session))
    p.accountTransport(write, safeRead = false, Names)
    Vector("https://ts.test:9445", "https://other.test").foreach { other =>
      refused(Refusal.OriginHostMismatch)(p.accountTransport(write.copy(origin = Vector(other)), safeRead = false, Names))
    }
  }
  test("a deferred policy parses a configured origin only when a check needs it and refuses an invalid one then") {
    val bad = "HTTPS://bad.test"
    val p = OriginPolicy.deferred(Vector("ts.test", "nb.test"), Vector(Secure, bad), Vector.empty, true)
    refused(Refusal.DisallowedHost)(p.validateTransport(headers("evil.test", origin = Vector(bad))))
    p.validateTransport(headers("ts.test:8445"))
    p.csrf(headers("ts.test:8445", fetchSite = Some("same-origin")))
    assert(p.secureCookie(headers("ts.test:8445")))
    p.accountTransport(headers("ts.test:8445", origin = Vector(Secure)), safeRead = false, Names)
    val first = OriginPolicy.deferred(Vector("ts.test"), Vector(bad, Secure), Vector.empty, true)
    Vector(1, 2).foreach { _ =>
      assertEquals(intercept[ConfigRefused](first.accountTransport(headers("ts.test:8445", origin = Vector(Secure)), safeRead = false, Names)).refusal,
        ConfigRefusal.NonCanonicalOrigin)
    }
    assertEquals(first.checked.map(_ => ()), Left(ConfigRefusal.NonCanonicalOrigin))
    assertEquals(OriginPolicy.deferred(Vector("nb.test"), Vector(Plain), Vector("https://bad.test\\x"), true).checked.map(_ => ()), Left(ConfigRefusal.MalformedOrigin))
    assert(policy().checked.isRight)
  }
  test("the request headers never print a bearer token or a cookie value") {
    val printed = headers("ts.test:8445", cookie = Vector("__Host-svc=" + Session), authorization = Vector("Bearer " + Session + "x")).toString
    assert(!printed.contains(Session), "the request headers print a credential")
    assert(printed.contains("ts.test:8445"), "the request headers do not print the host")
  }
}
