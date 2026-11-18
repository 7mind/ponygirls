package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import distage.*
import scala.concurrent.duration.*

// Tests shorten these intervals through constructor parameters; the values the service is wired with stay pinned here.
class TimingDefaultsTest extends munit.FunSuite {
  private def wired[A: Tag]: A = {
    val production: Module=_root_.chronicle.plugins.ChroniclePlugin
    ChronicleInjector().produceGet[A](production).use(IO.pure).unsafeRunSync()
  }
  test("the service is wired with a 10 s Hello wait, a Ping every 20 s answered within 10 s, and a session recheck every second") {
    assertEquals(wired[Http.SocketLiveness],Http.SocketLiveness(10.seconds,20.seconds,10.seconds,1.second))
  }
  test("a Ping is eligible only during the one-second window that starts at each 20 s after the connection opened") {
    val window=Http.SocketLiveness.production.pingWindow
    assertEquals(List(1,19,19.999,20,20.9,21,39,40,40.5,41).map(seconds => window((seconds*1000).millis)),List(false,false,false,true,true,false,false,true,true,false))
  }
  test("the service is wired with a 2 s worker back-off after a failed job") {
    assertEquals(wired[Worker.FailureBackoff],Worker.FailureBackoff(2.seconds))
  }
}
