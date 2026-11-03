package ponygirls.runtime

import cats.effect.{Deferred, IO, Ref, Resource}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import scala.concurrent.duration.*

final case class AdmissionConfig(maxActive: Int, maxQueued: Int, queueTimeout: FiniteDuration) {
  def validate(): Unit = {
    require(maxActive > 0 && maxActive <= 1024, "invalid active capacity")
    require(maxQueued >= 0 && maxQueued <= 65536, "invalid queue capacity")
    require(queueTimeout > Duration.Zero && queueTimeout <= 10.minutes, "invalid queue timeout")
  }
}

/** Public messages/codes are safe to return; never includes a driver cause or SQL. */
final case class RuntimeFailure(code: String) extends RuntimeException(code)

/** Finite admission, including waiters. Closing rejects new work and drains admitted work.
  * Resource users must not leak a running child fiber outside `run`.
  */
final class Admission private (
  config: AdmissionConfig,
  state: Ref[IO, (Boolean, Int)],
  permits: Semaphore[IO],
  drained: Deferred[IO, Unit]
) {
  private val reserve = state.modify { case (closed, count) =>
    if (closed) ((closed, count), Left(RuntimeFailure("runtime-closed")))
    else if (count >= config.maxActive + config.maxQueued) ((closed, count), Left(RuntimeFailure("admission-full")))
    else ((closed, count + 1), Right(()))
  }.flatMap(IO.fromEither)

  private val release = state.modify { case (closed, count) =>
    ((closed, count - 1), closed && count == 1)
  }.flatMap(done => if (done) drained.complete(()).void else IO.unit)

  def run[A](work: IO[A]): IO[A] = Resource.make(reserve)(_ => release).use { _ =>
    // Resource acquisition is cancelable: a canceled/timed-out waiter cannot retain a permit.
    Resource.makeFull[IO, Unit](poll => poll(permits.acquire).timeoutTo(config.queueTimeout,
      IO.raiseError(RuntimeFailure("admission-timeout"))))(_ => permits.release).use { _ =>
      state.get.flatMap { case (closed, _) =>
        if (closed) IO.raiseError(RuntimeFailure("runtime-closed")) else work
      }
    }
  }

  private[runtime] def close: IO[Unit] = state.modify { case (_, count) =>
    ((true, count), count == 0)
  }.flatMap(empty => if (empty) IO.unit else drained.get)
}
object Admission {
  def resource(config: AdmissionConfig): Resource[IO, Admission] = Resource.make(for {
    _ <- IO(config.validate())
    state <- Ref.of[IO, (Boolean, Int)]((false, 0))
    permits <- Semaphore[IO](config.maxActive.toLong)
    drained <- Deferred[IO, Unit]
  } yield new Admission(config, state, permits, drained))(_.close)
}
