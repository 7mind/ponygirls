package haystack.auth

import haystack.domain.Fault

/** BA, specified-origin: URI parsing alone is not canonical browser-origin or
  * HTTP Host validation. No DNS or network is involved.
  */
class OriginTest extends munit.FunSuite {
  Vector("http://example.test", "https://example.test", "http://example.test:8080", "https://example.test:8443",
    "http://127.0.0.1:1", "http://example.test:0", "https://example.test:65535").foreach { origin =>
    test("canonical origin accepted exactly: " + origin) {
      assertEquals(Origin.canonical(origin).toString, origin)
    }
  }
  Vector("null", "", "ftp://example.test", "HTTPS://example.test", "https://EXAMPLE.test", "http://example.test:80",
    "https://example.test:443", "https://user:pass@example.test", "https://example.test/", "https://example.test/path",
    "https://example.test?q=1", "https://example.test#fragment", "https://example.test:65536", "http://example.test:70000",
    "http://example.test:-1", "https://example.test\\evil", "https://example.test\n").zipWithIndex.foreach { case (origin, i) =>
    test(s"noncanonical/malformed origin $i rejected before startup") {
      assertEquals(intercept[Fault](Origin.canonical(origin)).code, "config")
    }
  }
  test("effective ports are protocol defaults or exact explicit values") {
    assertEquals(Origin.port(Origin.canonical("https://example.test")), 443)
    assertEquals(Origin.port(Origin.canonical("http://example.test")), 80)
    assertEquals(Origin.authority(Origin.canonical("http://example.test:443")), "example.test:443")
    assertEquals(Origin.authority(Origin.requestAuthority("EXAMPLE.test:8085")), "example.test:8085")
  }
  Vector("example.test:65536", "example.test:70000", "example.test:-1", "example.test\u0000", "example.test:443/path",
    "example.test@other.test", "example.test\\path", "example.test?query", "example.test#fragment", "example.test\r\n").zipWithIndex.foreach { case (host, i) =>
    test(s"malformed request Host $i never reaches credential selection") {
      assertEquals(intercept[Fault](Origin.requestAuthority(host)).code, "forbidden")
    }
  }
}
