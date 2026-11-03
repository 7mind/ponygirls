package ponygirls.runtime

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import distage.*
import izumi.distage.model.definition.{Id, Lifecycle}
import izumi.functional.quasi.{QuasiIO, QuasiAsync}
import java.util.concurrent.atomic.AtomicInteger
import munit.FunSuite

final class LifecycleProbe {
  val acquired = new AtomicInteger()
  val released = new AtomicInteger()
}
final class ManagedLease(val probe: LifecycleProbe)
final class ManagedLeaseResource(probe: LifecycleProbe) extends Lifecycle.FromPair[IO, ManagedLease] {
  def acquire: IO[(ManagedLease, IO[Unit])] = IO {
    probe.acquired.incrementAndGet()
    (new ManagedLease(probe), IO(probe.released.incrementAndGet()).void)
  }
}
final class WiringGraph(val lease: ManagedLease, val quasi: QuasiIO[IO], val async: QuasiAsync[IO], @Id("label") val label: String)
final class FailedLease
final class FailedLeaseResource(lease: ManagedLease) extends Lifecycle.FromPair[IO, FailedLease] {
  def acquire: IO[(FailedLease, IO[Unit])] = IO.raiseError(new IllegalStateException("fixture acquisition rejected"))
}

// Behavioral/Active/Blackbox/Group: actual planner, pinned higher-kind/Id tags and lifecycle.
final class CatsIOInjectorSuite extends FunSuite {
  test("shared pinned Cats ABI injector plans tagged IO graph and releases managed resource") {
    val probe = new LifecycleProbe
    val module = new ModuleDef {
      make[LifecycleProbe].fromValue(probe)
      make[ManagedLease].fromResource[ManagedLeaseResource]
      make[String].named("label").fromValue("selected")
      make[WiringGraph]
    }
    CatsIOInjector().produceGet[WiringGraph](module).use { graph => for {
      sequential <- graph.quasi.traverse(List(1,2,3))(i => IO(i + 1))
      parallel <- graph.async.parTraverseN(2)(List(1,2,3))(i => IO(i * 2))
      async <- graph.async.async[Int](callback => callback(Right(7)))
      _ <- graph.quasi.traverse_(List(1,2))(_ => IO.unit)
      _ <- graph.async.parTraverse_(List(1,2))(_ => IO.unit)
      _ <- graph.async.parTraverseN_(2)(List(1,2))(_ => IO.unit)
      _ <- IO {
        assertEquals(sequential, List(2,3,4)); assertEquals(parallel, List(2,4,6)); assertEquals(async, 7)
        assertEquals(graph.label, "selected"); assertEquals(probe.acquired.get(), 1); assertEquals(probe.released.get(), 0)
      }
    } yield () }.unsafeRunSync()
    assertEquals(probe.released.get(), 1)
  }
  test("failed dependent acquisition releases already-acquired resources") {
    val probe = new LifecycleProbe
    val module = new ModuleDef {
      make[LifecycleProbe].fromValue(probe)
      make[ManagedLease].fromResource[ManagedLeaseResource]
      make[FailedLease].fromResource[FailedLeaseResource]
    }
    val result = CatsIOInjector().produceGet[FailedLease](module).use(_ => IO.unit).attempt.unsafeRunSync()
    assert(result.isLeft)
    assertEquals(probe.acquired.get(), 1)
    assertEquals(probe.released.get(), 1)
  }
}
