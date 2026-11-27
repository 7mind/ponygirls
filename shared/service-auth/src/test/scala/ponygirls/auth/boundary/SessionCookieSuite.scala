package ponygirls.auth.boundary

/** BA specified: session cookie serialisation and selection, with the attribute order and value reading of the
  * services that use them (Haystack: `Secure` last, values trimmed; Manure: `Secure` before `Max-Age`, values exact,
  * three names). */
final class SessionCookieSuite extends munit.FunSuite {
  private val Session = "c2Vzc2lvbi1zZWNyZXQtc3ludGhldGljLW5vdC1yZWFs"
  private def refused(expected: Refusal)(body: => Any): Unit = assertEquals(intercept[BoundaryRefused](body).refusal, expected)

  test("login and renewal cookies carry exact attributes and the persistent lifetime; logout clears (Secure last)") {
    Vector(("__Host-svc", true), ("svc-dev", false)).foreach { (name, secure) =>
      assert((SessionCookie.serialize(name, Some(Session), secure, SecureAttribute.Last)) == (s"$name=$Session; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000" + (if (secure) "; Secure" else "")), "the cookie differs")
      assert((SessionCookie.serialize(name, None, secure, SecureAttribute.Last)) == (s"$name=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + (if (secure) "; Secure" else "")), "the cookie differs")
    }
  }
  test("Secure before Max-Age, for each of Manure's three session cookie names") {
    Vector(("__Host-manure", true), ("manure-http", false), ("manure-dev", false)).foreach { (name, secure) =>
      assert((SessionCookie.serialize(name, Some(Session), secure, SecureAttribute.BeforeMaxAge)) == (s"$name=$Session; Path=/; HttpOnly; SameSite=Strict" + (if (secure) "; Secure" else "") + "; Max-Age=34560000"), "the cookie differs")
      assert((SessionCookie.serialize(name, None, secure, SecureAttribute.BeforeMaxAge)) == (s"$name=; Path=/; HttpOnly; SameSite=Strict" + (if (secure) "; Secure" else "") + "; Max-Age=0"), "the cookie differs")
    }
  }
  test("the session cookies of a service select their name by security class") {
    val cookies = SessionCookies("__Host-svc", "svc-dev", CookieValue.Trimmed)
    assertEquals(cookies.name(true), "__Host-svc")
    assertEquals(cookies.name(false), "svc-dev")
  }
  test("selection finds the named cookie in any header; Trimmed trims the name and the value") {
    assert((SessionCookie.select(Vector("a=1", " other=x ;  __Host-svc= value "), "__Host-svc", CookieValue.Trimmed)) == (Some("value")), "the cookie differs")
    assert((SessionCookie.select(Vector("a=1; b"), "__Host-svc", CookieValue.Trimmed)) == (None), "the cookie differs")
    assert((SessionCookie.select(Vector.empty, "__Host-svc", CookieValue.Trimmed)) == (None), "the cookie differs")
    assert((SessionCookie.select(Vector("__Host-svc="), "__Host-svc", CookieValue.Trimmed)) == (Some("")), "the cookie differs")
  }
  test("Exact trims the name only and keeps the value byte for byte, for each of Manure's names") {
    Vector("__Host-manure", "manure-http", "manure-dev").foreach { name =>
      assert((SessionCookie.select(Vector(s"other=x;  $name= value "), name, CookieValue.Exact)) == (Some(" value ")), "the cookie differs")
      assert((SessionCookie.select(Vector(s"$name=value"), name, CookieValue.Exact)) == (Some("value")), "the cookie differs")
      assert((SessionCookie.select(Vector(s"$name=\"quoted\""), name, CookieValue.Exact)) == (Some("\"quoted\"")), "the cookie differs")
      assert((SessionCookie.select(Vector("other=x"), name, CookieValue.Exact)) == (None), "the cookie differs")
    }
  }
  test("two values of the named cookie are refused, never chosen between") {
    CookieValue.values.foreach { value =>
      refused(Refusal.DuplicateSessionCookie)(SessionCookie.select(Vector("__Host-svc=a", "__Host-svc=b"), "__Host-svc", value))
      refused(Refusal.DuplicateSessionCookie)(SessionCookie.select(Vector("__Host-svc=a; __Host-svc=a"), "__Host-svc", value))
    }
  }
}
