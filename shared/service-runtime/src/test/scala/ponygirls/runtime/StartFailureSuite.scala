package ponygirls.runtime

import cats.effect.{Deferred, ExitCode, IO}
import cats.effect.unsafe.implicits.global
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
  test("the walk visits a bounded number of throwables and edges and then reports internal") {
    val internal = StartFailure("internal", "IllegalStateException", "unexpected failure")
    val wide = new IllegalStateException("wide")
    (1 until StartFailure.MaxCauses).foreach(_ => wide.addSuppressed(new IllegalStateException("unknown")))
    wide.addSuppressed(new BindException("Address already in use"))
    assertEquals(StartFailure.classify(wide, none), internal)
    val repeated = new IllegalStateException("repeated"); val same = new IllegalStateException("unknown")
    (1 to StartFailure.MaxEdges).foreach(_ => repeated.addSuppressed(same))
    repeated.addSuppressed(new BindException("Address already in use"))
    assertEquals(StartFailure.classify(repeated, none), internal)
  }
  test("a report held when the command is canceled before it settles is printed once") {
    val printed = new java.util.concurrent.ConcurrentLinkedQueue[Throwable]()
    val unobserved = new StartFailure.Unobserved(error => { printed.add(error); () })
    val cleanup = new java.io.IOException("synthetic cleanup failure")
    val outcome = (for {
      started <- Deferred[IO, Unit]
      // A finalizer failing while the start is canceled reaches the runtime's report, here as `report`.
      command = (started.complete(()) *> IO.never[ExitCode]).onCancel(IO(unobserved.report(cleanup)))
      fiber <- unobserved.around(command)(_ => IO.pure(ExitCode.Error)).start
      _ <- started.get *> fiber.cancel
      outcome <- fiber.join
    } yield outcome).unsafeRunSync()
    assert(outcome.isCanceled)
    assertEquals(printed.toArray.toList, List(cleanup))
  }
}
