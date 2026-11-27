package ponygirls.auth.boundary

/** BA specified: session cookie serialisation and selection. */
final class SessionCookieSuite extends munit.FunSuite {
  private val Session = "c2Vzc2lvbi1zZWNyZXQtc3ludGhldGljLW5vdC1yZWFs"
  private def refused(expected: Refusal)(body: => Any): Unit = assertEquals(intercept[BoundaryRefused](body).refusal, expected)

  test("login and renewal cookies carry exact attributes and the persistent lifetime; logout clears") {
    Vector(("__Host-svc", true), ("svc-dev", false)).foreach { (name, secure) =>
      assertEquals(SessionCookie.serialize(name, Some(Session), secure),
        s"$name=$Session; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000" + (if (secure) "; Secure" else ""))
      assertEquals(SessionCookie.serialize(name, None, secure),
        s"$name=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + (if (secure) "; Secure" else ""))
    }
  }
  test("the cookie names of a service select by security class") {
    val names = CookieNames("__Host-svc", "svc-dev")
    assertEquals(names.name(true), "__Host-svc")
    assertEquals(names.name(false), "svc-dev")
  }
  test("selection finds the named cookie in any header and trims the name and the value") {
    assertEquals(SessionCookie.select(Vector("a=1", " other=x ;  __Host-svc= value "), "__Host-svc"), Some("value"))
    assertEquals(SessionCookie.select(Vector("a=1; b"), "__Host-svc"), None)
    assertEquals(SessionCookie.select(Vector.empty, "__Host-svc"), None)
    assertEquals(SessionCookie.select(Vector("__Host-svc="), "__Host-svc"), Some(""))
  }
  test("two values of the named cookie are refused, never chosen between") {
    refused(Refusal.DuplicateSessionCookie)(SessionCookie.select(Vector("__Host-svc=a", "__Host-svc=b"), "__Host-svc"))
    refused(Refusal.DuplicateSessionCookie)(SessionCookie.select(Vector("__Host-svc=a; __Host-svc=a"), "__Host-svc"))
  }
}
