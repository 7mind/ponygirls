package chronicle

import cats.effect.{Deferred,IO,Ref}
import cats.effect.kernel.Outcome
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.time.{Clock as JavaClock,Instant,ZoneOffset}
import scala.concurrent.duration.*

class ModelTelemetryTest extends munit.FunSuite {
  private val anchor=Instant.parse("2026-01-01T00:00:00Z")
  private val alice=ModelCallContext("alice",ModelWorkload.IndexAnnotation)
  private final class ManualClock(time: Ref[IO,ModelTelemetryTime]) extends ModelTelemetryClock {
    def read: IO[ModelTelemetryTime] = time.get
    def set(millis: Long): IO[Unit] = time.set(ModelTelemetryTime(Math.multiplyExact(millis,1000000L),anchor.plusMillis(millis)))
    def setTime(value: ModelTelemetryTime): IO[Unit] = time.set(value)
  }
  private def clock(): IO[ManualClock] = Ref.of[IO,ModelTelemetryTime](ModelTelemetryTime(0L,anchor)).map(new ManualClock(_))
  private def fixture(): IO[(ManualClock,ModelTelemetry)] = for {
    manual <- clock()
    telemetry <- ModelTelemetry.make(manual,Set("alice","bob"))
  } yield (manual,telemetry)
  private def parsed(text: String,purpose: ModelWorkload): ProviderUsage = ProviderUsage.parse(io.circe.parser.parse(text).fold(error => throw error,identity),purpose)
  private def reported(input: Long,output: Long,reasoning: Long): ProviderUsage = ProviderUsage.parse(Json.obj("usage"->Json.obj("prompt_tokens"->Json.fromLong(input),"completion_tokens"->Json.fromLong(output),"completion_tokens_details"->Json.obj("reasoning_tokens"->Json.fromLong(reasoning)))),ModelWorkload.IndexAnnotation)
  private def record(telemetry: ModelTelemetry,context: ModelCallContext,outcome: ModelCallOutcome,usage: ProviderUsage): IO[Unit] = telemetry.begin(context).flatMap(ticket => telemetry.finish(ticket,outcome,usage))
  private def slice(snapshot: ModelUsageSnapshot,purpose: ModelWorkload): ModelWorkloadUsage = snapshot.samples.find(_.purpose==purpose).get
  private def invariant(result: Either[Throwable,Unit]): Unit = result match {
    case Left(error: DomainError) => assertEquals(error.code,"model-telemetry-invariant")
    case other => fail(s"expected telemetry invariant failure, got $other")
  }

  test("BA specified: snapshots always expose four isolated owner/purpose rows without fabricated samples") {
    (for {
      (manual,telemetry) <- fixture()
      initial <- telemetry.snapshot("alice")
      _ <- IO {
        assertEquals(initial.samples.map(_.purpose),ModelWorkload.values.toList)
        initial.samples.foreach { value =>
          assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,0L); assertEquals(value.input,ModelTokenWindow(0L,0L,0L,None,None))
          val optional=if(value.purpose.hasOutput) Some(ModelTokenWindow(0L,0L,0L,None,None)) else None
          assertEquals(value.output,optional); assertEquals(value.reasoningSubset,optional)
        }
      }
      _ <- List("alice"->3L,"bob"->7L).traverse_ { case (owner,tokens) => ModelWorkload.values.toList.traverse_ { purpose =>
        val usage=parsed(s"""{"usage":{"prompt_tokens":$tokens,"completion_tokens":2,"completion_tokens_details":{"reasoning_tokens":1}}}""",purpose)
        record(telemetry,ModelCallContext(owner,purpose),ModelCallOutcome.Complete,usage)
      }}
      _ <- manual.set(100L)
      a <- telemetry.snapshot("alice")
      b <- telemetry.snapshot("bob")
      _ <- IO {
        a.samples.foreach(value => { assertEquals(value.finishedCalls,1L); assertEquals(value.input.knownTokens,3L); assertEquals(value.input.tokensPerSecond,Some(30.0)) })
        b.samples.foreach(value => { assertEquals(value.finishedCalls,1L); assertEquals(value.input.knownTokens,7L); assertEquals(value.input.tokensPerSecond,Some(70.0)) })
        a.samples.filterNot(_.purpose.hasOutput).foreach(value => { assertEquals(value.output,None); assertEquals(value.reasoningSubset,None) })
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: overlapping requests are only local in-flight gauges; unknown outcomes stay unknown") {
    (for {
      (manual,telemetry) <- fixture()
      first <- telemetry.begin(alice)
      second <- telemetry.begin(alice)
      embedding <- telemetry.begin(ModelCallContext("alice",ModelWorkload.QueryEmbedding))
      other <- telemetry.begin(ModelCallContext("bob",ModelWorkload.IndexAnnotation))
      running <- telemetry.snapshot("alice")
      _ <- IO {
        assertEquals(slice(running,ModelWorkload.IndexAnnotation).inFlight,2)
        assertEquals(slice(running,ModelWorkload.QueryEmbedding).inFlight,1)
        assertEquals(slice(running,ModelWorkload.IndexAnnotation).input.tokensPerSecond,None)
        assertEquals(slice(running,ModelWorkload.IndexAnnotation).input.unknownCalls,0L)
      }
      _ <- telemetry.finish(first,ModelCallOutcome.Complete,reported(0L,0L,0L))
      afterFirst <- telemetry.snapshot("alice")
      _ <- IO(assertEquals(slice(afterFirst,ModelWorkload.IndexAnnotation).inFlight,1))
      _ <- telemetry.finish(second,ModelCallOutcome.Failed,ProviderUsage.unknown)
      _ <- telemetry.finish(embedding,ModelCallOutcome.Cancelled,ProviderUsage.unknown)
      _ <- telemetry.finish(other,ModelCallOutcome.Cancelled,ProviderUsage.unknown)
      _ <- manual.set(500L)
      done <- telemetry.snapshot("alice")
      late <- telemetry.finish(embedding,ModelCallOutcome.Complete,reported(9L,1L,0L)).attempt
      _ <- IO {
        val annotation=slice(done,ModelWorkload.IndexAnnotation)
        assertEquals(annotation.inFlight,0); assertEquals(annotation.finishedCalls,2L); assertEquals(annotation.failedCalls,1L); assertEquals(annotation.cancelledCalls,0L)
        assertEquals(annotation.input.knownTokens,0L); assertEquals(annotation.input.reportedCalls,1L); assertEquals(annotation.input.unknownCalls,1L); assertEquals(annotation.input.tokensPerSecond,None)
        val query=slice(done,ModelWorkload.QueryEmbedding)
        assertEquals(query.inFlight,0); assertEquals(query.finishedCalls,1L); assertEquals(query.cancelledCalls,1L); assertEquals(query.input.unknownCalls,1L)
        invariant(late)
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: bracketed request cancellation commits one terminal and rejects late provider usage") {
    (for {
      (_,telemetry) <- fixture()
      started <- Deferred[IO,ModelCallTicket]
      fiber <- telemetry.begin(alice).bracketCase(ticket => started.complete(ticket) *> IO.never[Unit]) { (ticket,outcome) =>
        val terminal=outcome match {
          case Outcome.Canceled() => ModelCallOutcome.Cancelled
          case Outcome.Errored(_) => ModelCallOutcome.Failed
          case Outcome.Succeeded(_) => ModelCallOutcome.Complete
        }
        telemetry.finish(ticket,terminal,ProviderUsage.unknown)
      }.start
      ticket <- started.get
      running <- telemetry.snapshot("alice")
      _ <- fiber.cancel
      cancelled <- telemetry.snapshot("alice")
      late <- telemetry.finish(ticket,ModelCallOutcome.Complete,reported(3L,1L,0L)).attempt
      _ <- IO {
        assertEquals(slice(running,alice.purpose).inFlight,1)
        val value=slice(cancelled,alice.purpose)
        assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,1L); assertEquals(value.cancelledCalls,1L); assertEquals(value.input.unknownCalls,1L); invariant(late)
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: finish is exactly once, including concurrent terminals and foreign-store tickets") {
    (for {
      (manual,telemetry) <- fixture()
      foreign <- ModelTelemetry.make(manual,Set("alice"))
      ticket <- telemetry.begin(alice)
      wrong <- foreign.finish(ticket,ModelCallOutcome.Complete,reported(3L,1L,0L)).attempt
      terminals <- List.fill(2)(telemetry.finish(ticket,ModelCallOutcome.Complete,reported(3L,1L,0L)).attempt).parSequence
      snapshot <- telemetry.snapshot("alice")
      _ <- IO {
        invariant(wrong); assertEquals(terminals.count(_.isRight),1); assertEquals(terminals.count(_.isLeft),1)
        terminals.filter(_.isLeft).foreach(invariant)
        val value=slice(snapshot,ModelWorkload.IndexAnnotation)
        assertEquals(value.finishedCalls,1L); assertEquals(value.inFlight,0); assertEquals(value.input.knownTokens,3L)
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: partial usage preserves independently known rates, invalid counts and per-counter sample ages") {
    (for {
      (manual,telemetry) <- fixture()
      _ <- manual.set(100L)
      _ <- record(telemetry,alice,ModelCallOutcome.Complete,reported(10L,5L,2L))
      _ <- manual.set(200L)
      _ <- record(telemetry,alice,ModelCallOutcome.Failed,parsed("""{"usage":{"prompt_tokens":"malformed","completion_tokens":7}}""",alice.purpose))
      _ <- manual.set(500L)
      snapshot <- telemetry.snapshot("alice")
      _ <- IO {
        val value=slice(snapshot,alice.purpose)
        assertEquals(value.finishedCalls,2L); assertEquals(value.failedCalls,1L); assertEquals(value.invalidUsageCalls,1L)
        assertEquals(value.input,ModelTokenWindow(10L,1L,1L,None,Some(400L)))
        assertEquals(value.output,Some(ModelTokenWindow(12L,2L,0L,Some(24.0),Some(300L))))
        assertEquals(value.reasoningSubset,Some(ModelTokenWindow(2L,1L,1L,None,Some(400L))))
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: cancellation retains actual usage already seen, with no reasoning double count") {
    (for {
      (manual,telemetry) <- fixture()
      _ <- record(telemetry,alice,ModelCallOutcome.Cancelled,reported(11L,7L,5L))
      _ <- manual.set(1000L)
      snapshot <- telemetry.snapshot("alice")
      _ <- IO {
        val value=slice(snapshot,alice.purpose)
        assertEquals(value.finishedCalls,1L); assertEquals(value.cancelledCalls,1L); assertEquals(value.input.knownTokens,11L)
        assertEquals(value.output.get.knownTokens,7L); assertEquals(value.output.get.tokensPerSecond,Some(7.0)); assertEquals(value.reasoningSubset.get.knownTokens,5L)
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: startup coverage is actual elapsed time and explicit zero differs from no samples") {
    (for {
      (manual,telemetry) <- fixture()
      _ <- record(telemetry,alice,ModelCallOutcome.Complete,reported(0L,0L,0L))
      zeroElapsed <- telemetry.snapshot("alice")
      _ <- manual.set(50L)
      positive <- telemetry.snapshot("alice")
      _ <- IO {
        assertEquals(zeroElapsed.coveredMillis,0L); assertEquals(slice(zeroElapsed,alice.purpose).input.tokensPerSecond,None)
        assertEquals(positive.processStartedAt,anchor); assertEquals(positive.windowStartAt,anchor); assertEquals(positive.windowEndAt,anchor.plusMillis(50L)); assertEquals(positive.observedAt,positive.windowEndAt)
        assertEquals(positive.coveredMillis,50L); assertEquals(positive.bucketMillis,100L)
        assertEquals(slice(positive,alice.purpose).input.tokensPerSecond,Some(0.0)); assertEquals(slice(positive,ModelWorkload.McpTest).input.tokensPerSecond,None)
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: exact bucket boundaries disclose the included 9.9 to 10 second interval and expiry") {
    (for {
      (manual,telemetry) <- fixture()
      _ <- record(telemetry,alice,ModelCallOutcome.Complete,reported(1L,0L,0L))
      _ <- manual.set(99L)
      _ <- record(telemetry,alice,ModelCallOutcome.Complete,reported(2L,0L,0L))
      _ <- manual.set(100L)
      _ <- record(telemetry,alice,ModelCallOutcome.Complete,reported(4L,0L,0L))
      _ <- manual.set(9999L)
      before <- telemetry.snapshot("alice")
      _ <- manual.set(10000L)
      boundary <- telemetry.snapshot("alice")
      _ <- manual.set(10099L)
      partial <- telemetry.snapshot("alice")
      _ <- manual.set(10100L)
      expired <- telemetry.snapshot("alice")
      _ <- IO {
        assertEquals(before.coveredMillis,9999L); assertEquals(slice(before,alice.purpose).input.knownTokens,7L)
        assertEquals(boundary.windowStartAt,anchor.plusMillis(100L)); assertEquals(boundary.coveredMillis,9900L); assertEquals(slice(boundary,alice.purpose).finishedCalls,1L); assertEquals(slice(boundary,alice.purpose).input.knownTokens,4L)
        assertEquals(partial.coveredMillis,9999L); assertEquals(slice(partial,alice.purpose).finishedCalls,1L)
        assertEquals(expired.windowStartAt,anchor.plusMillis(200L)); assertEquals(slice(expired,alice.purpose).finishedCalls,0L)
        assertEquals(slice(expired,alice.purpose).input,ModelTokenWindow(0L,0L,0L,None,Some(10000L)))
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: no valid calls are lost within a dense bucket or across all included buckets") {
    (for {
      (manual,telemetry) <- fixture()
      _ <- manual.set(90L)
      _ <- List.fill(5000)(()).traverse_(_ => record(telemetry,alice,ModelCallOutcome.Complete,reported(1L,0L,0L)))
      dense <- telemetry.snapshot("alice")
      _ <- (1L to 101L).toList.traverse_ { index => manual.set(index*100L) *> record(telemetry,alice,ModelCallOutcome.Complete,reported(1L,0L,0L)) }
      rolling <- telemetry.snapshot("alice")
      _ <- IO {
        assertEquals(slice(dense,alice.purpose).finishedCalls,5000L); assertEquals(slice(dense,alice.purpose).input.reportedCalls,5000L); assertEquals(slice(dense,alice.purpose).input.knownTokens,5000L)
        assertEquals(rolling.windowStartAt,anchor.plusMillis(200L)); assertEquals(slice(rolling,alice.purpose).finishedCalls,100L); assertEquals(slice(rolling,alice.purpose).input.knownTokens,100L)
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: out-of-order observations never replace newer per-counter samples or regress time") {
    (for {
      (manual,telemetry) <- fixture()
      first <- telemetry.begin(alice)
      second <- telemetry.begin(alice)
      _ <- manual.set(300L)
      _ <- telemetry.finish(second,ModelCallOutcome.Complete,reported(7L,5L,2L))
      _ <- manual.set(100L)
      _ <- telemetry.finish(first,ModelCallOutcome.Complete,reported(3L,2L,1L))
      _ <- manual.set(400L)
      _ <- record(telemetry,alice,ModelCallOutcome.Failed,ProviderUsage.unknown)
      _ <- manual.set(500L)
      latest <- telemetry.snapshot("alice")
      _ <- manual.set(-100L)
      backwards <- telemetry.snapshot("alice")
      _ <- IO {
        val value=slice(latest,alice.purpose)
        assertEquals(value.finishedCalls,3L); assertEquals(value.input.knownTokens,10L); assertEquals(value.input.sampleAgeMillis,Some(200L)); assertEquals(value.output.get.sampleAgeMillis,Some(200L)); assertEquals(value.reasoningSubset.get.sampleAgeMillis,Some(200L))
        assertEquals(value.input.tokensPerSecond,None); assertEquals(backwards,latest)
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: delayed completion outside the disclosed window is terminal but cannot resurrect expired buckets") {
    (for {
      (manual,telemetry) <- fixture()
      old <- telemetry.begin(alice)
      current <- telemetry.begin(alice)
      _ <- manual.set(20000L)
      _ <- telemetry.finish(current,ModelCallOutcome.Complete,reported(2L,1L,0L))
      _ <- manual.set(100L)
      _ <- telemetry.finish(old,ModelCallOutcome.Complete,reported(9L,1L,0L))
      duplicate <- telemetry.finish(old,ModelCallOutcome.Complete,reported(9L,1L,0L)).attempt
      _ <- manual.set(20050L)
      snapshot <- telemetry.snapshot("alice")
      _ <- IO {
        val value=slice(snapshot,alice.purpose)
        assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,1L); assertEquals(value.input.knownTokens,2L); assertEquals(value.input.sampleAgeMillis,Some(50L)); invariant(duplicate)
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: clock regressions clamp completion to local admission and wall-clock changes cannot distort rates") {
    (for {
      (manual,telemetry) <- fixture()
      _ <- manual.set(100L)
      ticket <- telemetry.begin(alice)
      _ <- manual.set(-20L)
      _ <- telemetry.finish(ticket,ModelCallOutcome.Complete,reported(4L,0L,0L))
      _ <- manual.setTime(ModelTelemetryTime(200000000L,anchor.plusSeconds(1000000L)))
      snapshot <- telemetry.snapshot("alice")
      _ <- IO {
        assertEquals(snapshot.windowEndAt,anchor.plusMillis(200L)); assertEquals(snapshot.coveredMillis,200L)
        val value=slice(snapshot,alice.purpose)
        assertEquals(value.input.tokensPerSecond,Some(20.0)); assertEquals(value.input.sampleAgeMillis,Some(100L))
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: concurrent accounting is atomic and has no lost terminals or in-flight gauge leaks") {
    (for {
      (manual,telemetry) <- fixture()
      _ <- (1 to 1000).toList.parTraverse_(_ => record(telemetry,alice,ModelCallOutcome.Complete,reported(1L,0L,0L)))
      _ <- manual.set(1000L)
      snapshot <- telemetry.snapshot("alice")
      _ <- IO {
        val value=slice(snapshot,alice.purpose)
        assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,1000L); assertEquals(value.input.knownTokens,1000L); assertEquals(value.input.reportedCalls,1000L)
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: Long precision survives aggregation above 2^53") {
    (for {
      (manual,telemetry) <- fixture()
      _ <- record(telemetry,alice,ModelCallOutcome.Complete,reported(9007199254740993L,0L,0L))
      _ <- manual.set(100L)
      _ <- record(telemetry,alice,ModelCallOutcome.Complete,reported(1L,0L,0L))
      snapshot <- telemetry.snapshot("alice")
      _ <- IO(assertEquals(slice(snapshot,alice.purpose).input.knownTokens,9007199254740994L))
    } yield ()).unsafeRunSync()
  }
  test("BA specified: overflow within or across buckets fails before committing a partial terminal") {
    List(0L,100L).foreach { secondAt =>
      (for {
        (manual,telemetry) <- fixture()
        _ <- record(telemetry,alice,ModelCallOutcome.Complete,reported(Long.MaxValue,0L,0L))
        _ <- manual.set(secondAt)
        ticket <- telemetry.begin(alice)
        failed <- telemetry.finish(ticket,ModelCallOutcome.Complete,reported(1L,0L,0L)).attempt
        unchanged <- telemetry.snapshot("alice")
        _ <- telemetry.finish(ticket,ModelCallOutcome.Failed,ProviderUsage.unknown)
        terminal <- telemetry.snapshot("alice")
        _ <- IO {
          invariant(failed)
          assertEquals(slice(unchanged,alice.purpose).input.knownTokens,Long.MaxValue); assertEquals(slice(unchanged,alice.purpose).finishedCalls,1L); assertEquals(slice(unchanged,alice.purpose).inFlight,1)
          assertEquals(slice(terminal,alice.purpose).finishedCalls,2L); assertEquals(slice(terminal,alice.purpose).inFlight,0); assertEquals(slice(terminal,alice.purpose).input.unknownCalls,1L)
        }
      } yield ()).unsafeRunSync()
    }
  }
  test("BA specified: configured owners bound the state; invalid contexts fail without allocating an active call") {
    (for {
      (_,telemetry) <- fixture()
      begin <- telemetry.begin(ModelCallContext("unconfigured",alice.purpose)).attempt
      read <- telemetry.snapshot("unconfigured").attempt
      snapshot <- telemetry.snapshot("alice")
      _ <- IO {
        assert(begin.left.exists { case error: DomainError => error.code=="model-telemetry-invariant"; case _ => false })
        assert(read.left.exists { case error: DomainError => error.code=="model-telemetry-invariant"; case _ => false })
        assert(snapshot.samples.forall(_.inFlight==0))
      }
    } yield ()).unsafeRunSync()
  }
  test("BA specified: negative monotonic origins are valid, while interval overflow fails explicitly") {
    (for {
      manual <- clock()
      _ <- manual.setTime(ModelTelemetryTime(-1000000000L,anchor))
      telemetry <- ModelTelemetry.make(manual,Set("alice"))
      _ <- manual.setTime(ModelTelemetryTime(-950000000L,anchor.plusMillis(50L)))
      snapshot <- telemetry.snapshot("alice")
      _ <- IO(assertEquals(snapshot.coveredMillis,50L))
      _ <- manual.setTime(ModelTelemetryTime(Long.MinValue,anchor))
      overflowing <- ModelTelemetry.make(manual,Set("alice"))
      _ <- manual.setTime(ModelTelemetryTime(Long.MaxValue,anchor))
      invalid <- overflowing.snapshot("alice").attempt
      _ <- IO(assert(invalid.left.exists { case error: DomainError => error.code=="model-telemetry-invariant"; case _ => false }))
    } yield ()).unsafeRunSync()
  }
  private def clockContract(clock: ModelTelemetryClock): IO[Unit] = for {
    first <- clock.read
    second <- clock.read
    telemetry <- ModelTelemetry.make(clock,Set("alice"))
    _ <- record(telemetry,alice,ModelCallOutcome.Complete,reported(1L,0L,0L))
    snapshot <- telemetry.snapshot("alice")
    _ <- IO {
      assert(second.monotonicNanos>=first.monotonicNanos); assertEquals(first.wallClock,anchor); assertEquals(second.wallClock,anchor)
      assert(snapshot.coveredMillis>=0L); assertEquals(slice(snapshot,alice.purpose).finishedCalls,1L); assertEquals(slice(snapshot,alice.purpose).inFlight,0)
    }
  } yield ()
  test("BA specified: shared clock/store contract runs against manual and production Java clocks") {
    (for {
      manual <- clock()
      _ <- clockContract(manual)
      production=new JavaModelTelemetryClock(JavaClock.fixed(anchor,ZoneOffset.UTC),cats.effect.Clock[IO])
      _ <- clockContract(production)
      telemetry <- ModelTelemetry.make(production,Set("alice"))
      _ <- IO.sleep(20.millis)
      snapshot <- telemetry.snapshot("alice")
      _ <- IO { assert(snapshot.coveredMillis>0L); assertEquals(snapshot.windowEndAt,anchor.plusMillis(snapshot.coveredMillis)) }
    } yield ()).unsafeRunSync()
  }
}
