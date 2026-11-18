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
}
