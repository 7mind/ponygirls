package chronicle

import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import izumi.distage.model.definition.Lifecycle
import scala.concurrent.duration.*

/** Large snapshots are decoded one at a time: an ingest of a body over largeBodyBytes, and every indexing claim (it
  * decodes the claimed revision's whole snapshot; a small one takes milliseconds; waiting claims are not logged: idle
  * lanes claim every second). Each costs seconds of CPU and a heap several times the snapshot; two at once doubled the
  * collector's stop-the-world pauses, which stop every request, /api/versions included. Smaller ingests pass. */
final class SnapshotAdmission private (large: Semaphore[IO],logger: logstage.IzLogger,ingestWait: FiniteDuration) {
  def ingest[A](bodyBytes: Int)(ingest: IO[A]): IO[A] =
    if(bodyBytes<=SnapshotAdmission.largeBodyBytes) ingest
    // Bounded below the gateway's response deadline: an abandoned request would otherwise keep its body queued.
    else admitted(IO(logger.info(s"large ingest waits for admission bodyBytes=$bodyBytes")),
      _.timeoutTo(ingestWait,IO.raiseError(DomainError("unavailable","large ingest admission busy; retry later"))))(ingest)
  def claim[A](claim: IO[A]): IO[A] = admitted(IO.unit,identity)(claim)
  /** Ingests and claims waiting for the permit. */
  private[chronicle] def waiting: IO[Long] = large.count.map(count => (-count).max(0L))
  private def admitted[A](waiting: IO[Unit],bounded: IO[Unit] => IO[Unit])(work: IO[A]): IO[A] =
    Resource.makeFull[IO,Unit](poll => large.tryAcquire.flatMap(admitted => if(admitted) IO.unit else waiting *> bounded(poll(large.acquire))))(_ => large.release).use(_ => work)
}
object SnapshotAdmission {
  /** The default request bound of the example configuration: larger ingest bodies are admitted one at a time. */
  val largeBodyBytes: Int = 8*1024*1024
  /** How long a large ingest waits for admission before it is refused as unavailable (the collector retries). */
  val ingestWait: FiniteDuration = 30.seconds
  def resource(logger: logstage.IzLogger,ingestWait: FiniteDuration): Resource[IO,SnapshotAdmission] = Resource.eval(Semaphore[IO](1).map(new SnapshotAdmission(_,logger,ingestWait)))
}
final class SnapshotAdmissionResource(logger: logstage.IzLogger) extends Lifecycle.FromPair[IO,SnapshotAdmission] {
  def acquire: IO[(SnapshotAdmission,IO[Unit])] = SnapshotAdmission.resource(logger,SnapshotAdmission.ingestWait).allocated
}
