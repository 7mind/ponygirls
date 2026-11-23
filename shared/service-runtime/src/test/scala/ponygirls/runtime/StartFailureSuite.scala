package ponygirls.runtime

import java.net.BindException
import munit.FunSuite

final class StartFailureSuite extends FunSuite {
  private val none: StartFailure.Known = PartialFunction.empty
  private def bindLine(error: Throwable): String = StartFailure.line("svc", "bind", StartFailure.classify(error, none), Some(47328))
  test("a bind failure kept only as a suppressed exception of a wrapper without cause says address in use and the port") {
    val wrapper = new IllegalStateException("provisioning failed")
    wrapper.addSuppressed(new BindException("Address already in use"))
    assertEquals(bindLine(wrapper), """svc failure stage=bind code=address-in-use error=BindException message="address in use" port=47328""")
    assertEquals(bindLine(new BindException("ADDRESS IN USE")), """svc failure stage=bind code=address-in-use error=BindException message="address in use" port=47328""")
    Vector(new BindException(), new BindException("Cannot assign requested address")).foreach { other =>
      assertEquals(bindLine(other), """svc failure stage=bind code=bind error=BindException message="bind failed" port=47328""")
    }
  }
  test("a sanitized JDBC failure names its SQLSTATE and its fixed code, and no port") {
    val failure = StartFailure.classify(new RuntimeException(JdbcFailure("database-unavailable", Some("57P03"))), none)
    assertEquals(StartFailure.line("svc", "bind", failure, Some(47328)), """svc failure stage=bind code=jdbc-57P03 error=JdbcFailure message="database-unavailable"""")
  }
  test("an unknown failure prints its class only, never its message") {
    val secret = "synthetic-secret-4f1c jdbc:postgresql://db.invalid:5432/chronicle?password=synthetic"
    val line = StartFailure.line("svc", "migrate", StartFailure.classify(new IllegalStateException(secret, new java.sql.SQLException(secret)), none), None)
    assertEquals(line, """svc failure stage=migrate code=internal error=IllegalStateException message="unexpected failure"""")
  }
  test("the walk visits a bounded number of throwables and then reports internal") {
    val wrapper = new IllegalStateException("wide")
    (1 until StartFailure.MaxCauses).foreach(_ => wrapper.addSuppressed(new IllegalStateException("unknown")))
    wrapper.addSuppressed(new BindException("Address already in use"))
    assertEquals(StartFailure.classify(wrapper, none), StartFailure("internal", "IllegalStateException", "unexpected failure"))
  }
}
