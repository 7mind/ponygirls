package rites

import cats.effect.IO
import cats.syntax.all.*
import fs2.Stream
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.duration.*

final class Scheduler(store: RitesStore, config: Config, coordinator: RunCoordinator, publication: PublicationService, logger: logstage.IzLogger) {
  /** Constructor-scoped execution ownership. Reservation is atomic before every
    * original execution/reconciliation and released only after all metadata/failure
    * handling, including cancellation cleanup. It is not an ad-hoc state check.
    */
  private val inFlight = new ConcurrentHashMap[UUID, java.lang.Boolean]()
  private def withReservation(id: UUID)(operation: IO[Unit]): IO[Unit] = IO(inFlight.putIfAbsent(id, java.lang.Boolean.TRUE) == null).flatMap { acquired =>
    if (!acquired) IO.unit else operation.guarantee(IO(inFlight.remove(id)).void)
  }
  def initialize(): IO[Unit] = IO.blocking(store.recoverInterrupted())
  private[rites] def reconcilePendingOnce(): IO[Unit] = IO.blocking(store.pendingPublication(config.scheduler.queueBound)).flatMap { ids =>
    ids.traverse_ { id => withReservation(id) {
      IO.blocking(publication.reconcile(id, None)).handleErrorWith { error =>
        IO.blocking(publication.reconciliationFailure(id, error)) *> IO(logger.error(s"publication reconciliation pending run=$id"))
      }
    } }
  }
  private def due(): IO[Unit] = IO.blocking(store.admitScheduled(Instant.now(), config.scheduler.queueBound)).void.handleErrorWith(_ => IO(logger.error("schedule admission unavailable")))
  private def loop(): IO[Unit] = IO.blocking(store.claimNext(Instant.now())).flatMap {
    case Some(authority) => withReservation(authority.run.id)(IO.blocking(coordinator.execute(authority)) *> IO(logger.info(s"run observed state=finished id=${authority.run.id}")))
    case None => IO.sleep(config.scheduler.poll)
  }
  def run: IO[Unit] = {
    val workers = Stream.emits(List.fill(config.scheduler.concurrency)(())).covary[IO].evalMap(_ => loop().foreverM).parJoin(config.scheduler.concurrency)
    val ticks = Stream.awakeEvery[IO](config.scheduler.poll).evalMap(_ => due() *> reconcilePendingOnce())
    (workers merge ticks).compile.drain
  }
}
