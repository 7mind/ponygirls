package ponygirls.auth

import java.nio.file.Files
import java.time.{Duration, Instant}

final class ImperativePolicySuite extends munit.FunSuite {
  private val failedAt = Instant.parse("2026-01-01T00:00:00Z")
  private def counter(failures: Int): FailureCounter = FailureCounter(failures, Some(failedAt))
  private def lock(schedule: LockSchedule, failures: Int): Option[Duration] = schedule.retryAfter(counter(failures), failedAt)

  test("usernames: pattern, reserved names and ASCII folding") {
    Vector("abc", "a-b_c", "a23", "a" * 32).foreach(name => assert(ImperativePolicy.validUsername(name), name))
    Vector("", "ab", "a" * 33, "Abc", "1bc", "-bc", "a.c", "a c", "abc\n", "ábc").foreach(name => assert(!ImperativePolicy.validUsername(name), name))
    assert(Vector("admin", "root", "operator", "self").forall(ImperativePolicy.ReservedUsernames))
    assertEquals(ImperativePolicy.fold("Dora-İ_9"), "dora-İ_9")
  }

  test("e-mail: one @ with both sides, bounded, no whitespace or control characters, otherwise as submitted") {
    Vector("a@b", "First.Last+tag@example.test", "x" * 250 + "@b.c").foreach(email => assert(ImperativePolicy.validEmail(email), email))
    Vector("", "ab", "a@", "@b", "a@b@c", "a b@c", "a@b\n", "a\u0000@b", "a\u00a0@b", "x" * 251 + "@b.c").foreach { email =>
      assert(!ImperativePolicy.validEmail(email), email)
    }
  }

  test("passwords: 12 to 1024 UTF-16 units and never the username or the e-mail, case-insensitively") {
    val username = "long-user-name"
    val email = "user@example.test"
    Vector("x" * 12, "x" * 1024, "only lowercase letters").foreach(value => assert(ImperativePolicy.validPassword(value, username, Some(email)), value.length))
    Vector("x" * 11, "x" * 1025, "LONG-user-name", "USER@example.test").foreach { value =>
      assert(!ImperativePolicy.validPassword(value, username, Some(email)), value.length)
    }
    assert(ImperativePolicy.validPassword("USER@example.test", username, None))
  }

  test("password counter: free below 10 failures, then 1 minute doubling to a 15 minute cap, without a lapse") {
    val schedule = LockSchedule.Password
    assertEquals(Vector(9, 10, 11, 13, 14, 1000).map(lock(schedule, _).map(_.toMinutes)), Vector(None, Some(1L), Some(2L), Some(8L), Some(15L), Some(15L)))
    assertEquals(schedule.lockedUntil(counter(10), failedAt.plusSeconds(59)), Some(failedAt.plusSeconds(60)))
    assertEquals(schedule.lockedUntil(counter(10), failedAt.plusSeconds(60)), None)
    assertEquals(schedule.failed(counter(10), failedAt.plus(Duration.ofDays(365))), FailureCounter(11, Some(failedAt.plus(Duration.ofDays(365)))))
    assertEquals(schedule.retryAfter(FailureCounter.Clear, failedAt), None)
  }

  test("TOTP and recovery counters: free below 5 failures, 15 minutes doubling to 24 hours, lapsing after 7 quiet days") {
    Vector(LockSchedule.Totp, LockSchedule.Recovery, LockSchedule.of(FailurePath.Totp), LockSchedule.of(FailurePath.Recovery)).foreach { schedule =>
      assertEquals(Vector(4, 5, 6, 11, 12, 1000).map(lock(schedule, _).map(_.toMinutes)),
        Vector(None, Some(15L), Some(30L), Some(960L), Some(1440L), Some(1440L)))
      val lapse = failedAt.plus(Duration.ofDays(7))
      assertEquals(schedule.effective(counter(12), lapse.minusSeconds(1)), counter(12))
      assertEquals(schedule.effective(counter(12), lapse), FailureCounter.Clear)
      assertEquals(schedule.failed(counter(12), lapse.minusSeconds(1)), FailureCounter(13, Some(lapse.minusSeconds(1))))
      assertEquals(schedule.failed(counter(12), lapse), FailureCounter(1, Some(lapse)))
    }
    assertEquals(LockSchedule.of(FailurePath.Password), LockSchedule.Password)
  }

  test("settings and the declared directory fail closed on values outside their bounds") {
    val directory = Files.createTempDirectory("imperative-policy-")
    val keyFile = directory.resolve("key")
    try {
      Files.writeString(keyFile, Secrets.generate())
      val valid = ImperativeSettings("contract", true, true, false, 100, Duration.ofSeconds(86400), "Contract (example.test)", Set("payroll"), TotpVault.load(keyFile, "contract"))
      Vector[ImperativeSettings => ImperativeSettings](_.copy(maxUsers = 1), _.copy(maxUsers = 1000), _.copy(enrollmentTtl = Duration.ofSeconds(300)),
        _.copy(enrollmentTtl = Duration.ofSeconds(604800)), _.copy(issuer = "x" * 64)).foreach(change => change(valid))
      Vector[ImperativeSettings => ImperativeSettings](_.copy(service = ""), _.copy(maxUsers = 0), _.copy(maxUsers = 1001),
        _.copy(enrollmentTtl = Duration.ofSeconds(299)), _.copy(enrollmentTtl = Duration.ofSeconds(604801)), _.copy(issuer = ""),
        _.copy(issuer = "x" * 65), _.copy(issuer = "a:b"), _.copy(issuer = "a\nb"), _.copy(reservedUsernames = Set("Not Valid"))).zipWithIndex.foreach {
        case (change, index) => assertEquals(intercept[AccountFailure](change(valid)).code, "config", s"change $index")
      }
    } finally {
      Files.deleteIfExists(keyFile)
      Files.delete(directory)
    }
    def user(id: String, userType: String, login: Option[String], origin: AccountOrigin): AccountUser =
      AccountUser(id, userType, id, login, login.map(_ => Password.dummyHash), true, origin)
    val human = user("Ops", "human", Some("Dora"), AccountOrigin.Declarative)
    val agent = user("robot", "agent", None, AccountOrigin.Declarative)
    val declared = DeclaredDirectory(Vector(human, agent), Set("Ops"))
    assertEquals((declared.claims("ops"), declared.claims("dora"), declared.claims("robot"), declared.claims("other")), (true, true, true, false))
    assertEquals((declared.hasLogin("Dora"), declared.hasLogin("dora"), declared.contains("Ops"), declared.contains("ops")), (true, false, true, false))
    Vector[() => DeclaredDirectory](() => DeclaredDirectory(Vector(human, agent), Set("robot")), () => DeclaredDirectory(Vector(human), Set("missing")),
      () => DeclaredDirectory(Vector(human, human), Set.empty), () => DeclaredDirectory(Vector(user("carol", "human", Some("carol"), AccountOrigin.Imperative)), Set.empty)
    ).zipWithIndex.foreach { case (build, index) => assertEquals(intercept[AccountFailure](build()).code, "config", s"directory $index") }
  }
}
