package chronicle

import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import scala.concurrent.duration.*

final class BrowserControlAdmission private (gate: Semaphore[IO]) {
  def run[A](action: IO[A]): IO[A] = gate.permit.use(_ => action)
    .timeoutTo(BrowserControlAdmission.deadline,IO.raiseError(DomainError("unavailable","browser control deadline exceeded")))
}

object BrowserControlAdmission {
  val maximumConcurrent = 4L
  val socketQueueCapacity = 8
  val socketWorkers = 2
  val deadline = 20.seconds
  def resource: Resource[IO,BrowserControlAdmission] = Resource.eval(Semaphore[IO](maximumConcurrent).map(new BrowserControlAdmission(_)))
}
