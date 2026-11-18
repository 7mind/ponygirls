package ponygirls.auth

import java.time.{Clock, Duration, Instant, ZoneId, ZoneOffset}

final class AttemptLimiterSuite extends munit.FunSuite {
  import AttemptLimiter.*

  private final class MovableClock(var now: Instant) extends Clock {
    def getZone: ZoneId = ZoneOffset.UTC
    override def withZone(zone: ZoneId): Clock = this
    def instant(): Instant = now
    def advance(by: Duration): Unit = now = now.plus(by)
  }
  private val start = Instant.parse("2026-01-01T00:00:00Z")

  test("request windows per address and endpoint class reopen after their window; a full map refuses new keys until windows expire") {
    val clock = new MovableClock(start)
    val limiter = new AttemptLimiter(2, clock)
    (1 to RequestsPerAddress).foreach(_ => assertEquals(limiter.request("192.0.2.1", CredentialEndpoint.Login), None))
    clock.advance(Duration.ofSeconds(20))
    assertEquals(limiter.request("192.0.2.1", CredentialEndpoint.Login), Some(Duration.ofSeconds(40)))
    assertEquals(limiter.request("192.0.2.1", CredentialEndpoint.Recover), None)
    assertEquals(limiter.request("192.0.2.2", CredentialEndpoint.Login), Some(RequestWindow))
    clock.advance(Duration.ofSeconds(40))
    assertEquals(limiter.request("192.0.2.2", CredentialEndpoint.Login), None)
    assertEquals(limiter.request("192.0.2.1", CredentialEndpoint.Login), Some(RequestWindow))
  }

  test("successful signups are bounded per address and globally; a refunded reservation frees its slot") {
    val clock = new MovableClock(start)
    val limiter = new AttemptLimiter(Capacity, clock)
    val first = (1 to SignupsPerAddress).map(_ => limiter.reserveSignup("192.0.2.1"))
    assert(first.forall(_.isRight))
    assertEquals(limiter.reserveSignup("192.0.2.1").left.toOption, Some(AddressSignupWindow))
    limiter.refund(first.head.toOption.get)
    assert(limiter.reserveSignup("192.0.2.1").isRight)
    (2 to SignupsGlobal / SignupsPerAddress).foreach(n => (1 to SignupsPerAddress).foreach(_ => assert(limiter.reserveSignup(s"192.0.2.1$n").isRight)))
    clock.advance(Duration.ofMinutes(15))
    assertEquals(limiter.reserveSignup("198.51.100.1").left.toOption, Some(GlobalSignupWindow.minusMinutes(15)))
    clock.advance(GlobalSignupWindow)
    assert(limiter.reserveSignup("198.51.100.1").isRight)
    assert(limiter.reserveSignup("192.0.2.1").isLeft)
  }

  test("client address: the right-most forwarded element only behind a trusted peer, otherwise the socket peer") {
    val loopback = Set("127.0.0.1", "::1")
    for ((peer, forwarded, expected) <- Vector(
        ("203.0.113.9", Vector("198.51.100.7"), "203.0.113.9"),
        ("127.0.0.1", Vector.empty, "127.0.0.1"),
        ("127.0.0.1", Vector("203.0.113.1, 198.51.100.7"), "198.51.100.7"),
        ("127.0.0.1", Vector("203.0.113.1", "198.51.100.7 , 198.51.100.8"), "198.51.100.8"),
        ("::1", Vector("2001:db8::1"), "2001:db8:0:0:0:0:0:1"),
        ("127.0.0.1", Vector("198.51.100.7, "), "127.0.0.1"),
        ("127.0.0.1", Vector("unknown"), "127.0.0.1"),
        ("127.0.0.1", Vector("example.test"), "127.0.0.1")))
      assertEquals(ClientAddress.resolve(peer, forwarded, loopback), expected, s"$peer $forwarded")
  }
}
