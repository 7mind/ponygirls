package rites

import cats.effect.IO
import cats.syntax.all.*
import fs2.Stream
import java.time.Instant
import scala.concurrent.duration.*

final class Scheduler(store: RitesStore, config: Config, coordinator: RunCoordinator, publication: PublicationService, logger: logstage.IzLogger) {
  def initialize(): IO[Unit] = IO.blocking(store.recoverInterrupted())
  private def reconcile(): IO[Unit] = IO.blocking(store.pendingPublication(config.scheduler.queueBound)).flatMap { ids =>
    ids.traverse_ { id => IO.blocking(publication.reconcile(id, None)).handleErrorWith { error =>
      val code = error match { case d: DomainError if d.code == "authorization-revoked" => d.code; case _ => "publication-reconciliation-required" }
      IO.blocking(if (store.publicationStage(id) == "Created") store.markSupersessionPending(id) else store.markUncertain(id, code)) *> IO(logger.error(s"publication reconciliation pending run=$id"))
    } }
  }
  private def due(): IO[Unit] = IO.blocking(store.admitScheduled(Instant.now(), config.scheduler.queueBound)).void.handleErrorWith(_ => IO(logger.error("schedule admission unavailable")))
  private def loop(): IO[Unit] = IO.blocking(store.claimNext(Instant.now())).flatMap {
    case Some(authority) => IO.blocking(coordinator.execute(authority)) *> IO(logger.info(s"run observed state=finished id=${authority.run.id}"))
    case None => IO.sleep(config.scheduler.poll)
  }
  def run: IO[Unit] = {
    val workers = Stream.emits(List.fill(config.scheduler.concurrency)(())).covary[IO].evalMap(_ => loop().foreverM).parJoin(config.scheduler.concurrency)
    val ticks = Stream.awakeEvery[IO](config.scheduler.poll).evalMap(_ => due() *> reconcile())
    (workers merge ticks).compile.drain
  }
}
