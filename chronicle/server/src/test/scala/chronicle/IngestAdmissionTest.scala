package chronicle

import cats.effect.{Deferred,IO,Ref}
import cats.effect.unsafe.implicits.global
import izumi.logstage.api.Log
import scala.concurrent.duration.*

final class IngestAdmissionTest extends munit.FunSuite {
  test("Effectual GoodCommunication: large ingests are admitted one at a time while smaller ones pass") {
    (for {
      waiting <- Deferred[IO,Unit]
      logger=logstage.IzLogger(Log.Level.Info,List(new izumi.logstage.api.logger.LogSink {
        def flush(entry: Log.Entry): Unit = if(entry.message.template.parts.head.startsWith("large ingest waits for admission")) { waiting.complete(()).unsafeRunSync(); () }
      }))
      _ <- IngestAdmission.resource(logger).use { admission => for {
        inside <- Ref.of[IO,Int](0)
        most <- Ref.of[IO,Int](0)
        firstIn <- Deferred[IO,Unit]
        releaseFirst <- Deferred[IO,Unit]
        large=(work: IO[Unit]) => admission.run(IngestAdmission.largeBodyBytes+1)(inside.updateAndGet(_+1).flatMap(n => most.update(_.max(n))) *> work *> inside.update(_-1))
        first <- large(firstIn.complete(()) *> releaseFirst.get).start
        _ <- firstIn.get.timeout(5.seconds)
        secondIn <- Deferred[IO,Unit]
        second <- large(secondIn.complete(()).void).start
        _ <- admission.run(IngestAdmission.largeBodyBytes)(IO.unit).timeout(5.seconds)
        _ <- waiting.get.timeout(5.seconds)
        early <- secondIn.tryGet
        _ <- IO(assertEquals(early,None,"the second large ingest waits while the first is admitted"))
        _ <- releaseFirst.complete(())
        _ <- first.joinWithNever.timeout(5.seconds) *> second.joinWithNever.timeout(5.seconds)
        maximum <- most.get
      } yield assertEquals(maximum,1) }
    } yield ()).unsafeRunSync()
  }
}
