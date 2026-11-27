package haystack.auth

import haystack.domain.Fault
import java.util.Base64

/** BA, specified-origin regression: the `Sessions` checks over an `AuthConfig` that never went through `Auth.load`
  * run in their original order and parse a configured origin only where a check needs it, so a request refusal
  * wins over an unrelated invalid configured origin. Synthetic `.test` names only. */
class SessionsConfigOrderTest extends munit.FunSuite {
  private val Token = Base64.getUrlEncoder.withoutPadding.encodeToString(Array.fill[Byte](32)(1))
  private val Plain = "http://nb.test:8085"
  private val Secure = "https://ts.test:8445"
  private val NonCanonical = "HTTPS://bad.test"
  private val Unparsable = "https://bad.test\\x"
  private def config(origins: Vector[String], insecure: Vector[String] = Vector.empty, cookieSecure: Boolean = true): AuthConfig =
    AuthConfig("agent-activity", Vector.empty, cookieSecure, Vector("ts.test", "nb.test"), origins, insecure)
  private def fault(body: => Any): (String, String) = { val f = intercept[Fault](body); (f.code, f.message) }

  test("an invalid or disallowed Host wins over an unrelated invalid configured origin") {
    Vector(NonCanonical, Unparsable).foreach { bad =>
      Vector("", "evil.test", "ts.test/path").foreach { host =>
        assertEquals(fault(Sessions.validateTransport(config(Vector(bad)), RequestHeaders(host))), ("forbidden", "disallowed host"))
        assertEquals(fault(Sessions.validateTransport(config(Vector(bad)), RequestHeaders(host, origin = Vector(bad)))), ("forbidden", "disallowed host"))
        assertEquals(fault(Sessions.resolve(config(Vector(bad)), RequestHeaders(host, authorization = Vector("Bearer " + Token)))), ("forbidden", "disallowed host"))
        // Cookie security parses the Host but does not consult the allowed host names.
        if (host != "evil.test") assertEquals(fault(Sessions.secure(config(Vector(bad), Vector(bad)), RequestHeaders(host))), ("forbidden", "disallowed host"))
        assertEquals(fault(Sessions.accountTransport(config(Vector(bad)), RequestHeaders(host), safeRead = true)), ("forbidden", "disallowed host"))
      }
    }
  }
  test("same-origin proof by fetch metadata or by an exact allowed Origin parses no configured origin") {
    val cfg = config(Vector(Secure, NonCanonical))
    Sessions.csrf(cfg, RequestHeaders("ts.test:8445", fetchSite = Some("same-origin")))
    Sessions.csrf(cfg, RequestHeaders("ts.test:8445", origin = Vector(Secure)))
    assertEquals(fault(Sessions.csrf(cfg, RequestHeaders("ts.test:8445", origin = Vector("https://evil.test")))), ("forbidden", "missing or invalid origin"))
  }
  test("transport and bearer selection without an Origin parse no configured origin") {
    val cfg = config(Vector(Secure, NonCanonical))
    Sessions.validateTransport(cfg, RequestHeaders("ts.test:8445"))
    Sessions.validateTransport(cfg, RequestHeaders("ts.test:8445", origin = Vector(Secure)))
    assertEquals(Sessions.resolve(cfg, RequestHeaders("ts.test:8445", authorization = Vector("Bearer " + Token))).token, Token)
    assert(Sessions.secure(cfg, RequestHeaders("ts.test:8445")))
  }
  test("cookie security parses opted-in origins only while cookieSecure is on and only up to the first match") {
    assert(!Sessions.secure(config(Vector(NonCanonical), Vector(NonCanonical), cookieSecure = false), RequestHeaders("ts.test:8445")))
    assert(!Sessions.secure(config(Vector(Plain, NonCanonical), Vector(Plain, NonCanonical)), RequestHeaders("nb.test:8085")))
    assertEquals(fault(Sessions.secure(config(Vector(Plain, NonCanonical), Vector(NonCanonical, Plain)), RequestHeaders("nb.test:8085"))), ("config", "invalid canonical origin"))
    assertEquals(fault(Sessions.secure(config(Vector(Plain), Vector(Unparsable)), RequestHeaders("nb.test:8085"))), ("config", "invalid origin"))
  }
  test("the account authority check parses allowed origins in order up to the first match") {
    val write = RequestHeaders("ts.test:8445", origin = Vector(Secure), cookie = Vector("__Host-haystack=" + Token))
    Sessions.accountTransport(config(Vector(Secure, NonCanonical)), write, safeRead = false)
    assertEquals(fault(Sessions.accountTransport(config(Vector(NonCanonical, Secure)), write, safeRead = false)), ("config", "invalid canonical origin"))
    assertEquals(fault(Sessions.accountTransport(config(Vector(Unparsable, Secure)), write, safeRead = false)), ("config", "invalid origin"))
  }
  test("the origin policy is compiled once per configuration value; a changed value has its own") {
    AuthFixtures.directory { dir =>
      val cfg = AuthFixtures.config(dir)
      val auth = Auth.load(cfg)
      assert(auth.config.originPolicy eq cfg.originPolicy)
      assert(cfg.originPolicy eq cfg.originPolicy)
      val narrowed = cfg.copy(allowedHosts = Vector("nb.test"))
      assert(!(narrowed.originPolicy eq cfg.originPolicy))
      Sessions.validateTransport(cfg, RequestHeaders("ts.test:8445"))
      assertEquals(fault(Sessions.validateTransport(narrowed, RequestHeaders("ts.test:8445"))), ("forbidden", "disallowed host"))
      Sessions.validateTransport(Auth.load(narrowed).config, RequestHeaders("nb.test:8085"))
    }
  }
}
