package ponygirls.runtime

import munit.FunSuite

final class StartFailureSuite extends FunSuite {
  private val none: StartFailure.Known = PartialFunction.empty
  test("a bind failure kept only as a suppressed exception of a wrapper without cause says address in use and the port") {
    val wrapper = new IllegalStateException("provisioning failed")
    wrapper.addSuppressed(new java.net.BindException("Address already in use"))
    assertEquals(StartFailure.line("svc", "bind", StartFailure.classify(wrapper, none), Some(47328)),
      """svc failure stage=bind code=address-in-use error=BindException message="address in use" port=47328""")
  }
  test("a sanitized JDBC failure names its SQLSTATE and its fixed code") {
    assertEquals(StartFailure.classify(new RuntimeException(JdbcFailure("database-unavailable", Some("57P03"))), none),
      StartFailure("jdbc-57P03", "JdbcFailure", "database-unavailable"))
  }
  test("an unknown failure prints its class only, never its message") {
    val secret = "synthetic-secret-4f1c jdbc:postgresql://db.invalid:5432/chronicle?password=synthetic"
    val line = StartFailure.line("svc", "migrate", StartFailure.classify(new IllegalStateException(secret, new java.sql.SQLException(secret)), none), None)
    assertEquals(line, """svc failure stage=migrate code=internal error=IllegalStateException message="unexpected failure"""")
  }
}
