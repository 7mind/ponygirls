package chronicle

import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import izumi.distage.model.definition.Lifecycle

/** Large snapshots are ingested one at a time. Decoding, validating and projecting one costs seconds of CPU and a heap
  * several times its size; two at once doubled the collector's stop-the-world pauses, which stop every request,
  * /api/versions included. Smaller snapshots are not held up. */
final class IngestAdmission private (large: Semaphore[IO],logger: logstage.IzLogger) {
  def run[A](bodyBytes: Int)(ingest: IO[A]): IO[A] =
    if(bodyBytes<=IngestAdmission.largeBodyBytes) ingest
    else Resource.makeFull[IO,Unit](poll => large.tryAcquire.flatMap { admitted =>
      if(admitted) IO.unit else IO(logger.info(s"large ingest waits for admission bodyBytes=$bodyBytes")) *> poll(large.acquire)
    })(_ => large.release).use(_ => ingest)
}
object IngestAdmission {
  /** The default request bound of the example configuration: larger bodies are admitted one at a time. */
  val largeBodyBytes: Int = 8*1024*1024
  def resource(logger: logstage.IzLogger): Resource[IO,IngestAdmission] = Resource.eval(Semaphore[IO](1).map(new IngestAdmission(_,logger)))
}
final class IngestAdmissionResource(logger: logstage.IzLogger) extends Lifecycle.FromPair[IO,IngestAdmission] {
  def acquire: IO[(IngestAdmission,IO[Unit])] = IngestAdmission.resource(logger).allocated
}
