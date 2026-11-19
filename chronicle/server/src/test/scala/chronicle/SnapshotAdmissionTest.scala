package chronicle

import cats.effect.{Deferred,IO,Ref}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import izumi.logstage.api.Log
import scala.concurrent.duration.*

final class SnapshotAdmissionTest extends munit.FunSuite {
  test("Effectual GoodCommunication: large ingests and indexing claims decode one snapshot at a time while smaller ingests pass") {
    (for {
      ingestWaits <- Deferred[IO,Unit]
      claimWaits <- Deferred[IO,Unit]
      logger=logstage.IzLogger(Log.Level.Debug,List(new izumi.logstage.api.logger.LogSink {
        def flush(entry: Log.Entry): Unit = {
          val text=entry.message.template.parts.head
          if(text.startsWith("large ingest waits for admission")) ingestWaits.complete(()).unsafeRunSync()
          if(text.startsWith("indexing claim waits for snapshot admission")) claimWaits.complete(()).unsafeRunSync()
        }
      }))
      _ <- SnapshotAdmission.resource(logger).use { admission => for {
        inside <- Ref.of[IO,Int](0)
        most <- Ref.of[IO,Int](0)
        tracked=(work: IO[Unit]) => inside.updateAndGet(_+1).flatMap(n => most.update(_.max(n))) *> work *> inside.update(_-1)
        firstIn <- Deferred[IO,Unit]
        releaseFirst <- Deferred[IO,Unit]
        first <- admission.ingest(SnapshotAdmission.largeBodyBytes+1)(tracked(firstIn.complete(()) *> releaseFirst.get)).start
        _ <- firstIn.get.timeout(5.seconds)
        secondIn <- Deferred[IO,Unit]
        second <- admission.ingest(SnapshotAdmission.largeBodyBytes+1)(tracked(secondIn.complete(()).void)).start
        claimIn <- Deferred[IO,Unit]
        claim <- admission.claim(tracked(claimIn.complete(()).void)).start
        _ <- admission.ingest(SnapshotAdmission.largeBodyBytes)(IO.unit).timeout(5.seconds)
        _ <- ingestWaits.get.timeout(5.seconds) *> claimWaits.get.timeout(5.seconds)
        early <- (secondIn.tryGet,claimIn.tryGet).tupled
        _ <- IO(assertEquals(early,(None,None),"the second large ingest and the claim wait while the first is admitted"))
        _ <- releaseFirst.complete(())
        _ <- first.joinWithNever.timeout(5.seconds) *> second.joinWithNever.timeout(5.seconds) *> claim.joinWithNever.timeout(5.seconds)
        maximum <- most.get
      } yield assertEquals(maximum,1) }
    } yield ()).unsafeRunSync()
  }
}
