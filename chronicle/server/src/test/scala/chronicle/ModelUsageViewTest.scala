package chronicle

import cats.effect.{IO,Ref}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import chronicle.api.*
import io.circe.Json
import java.time.Instant

final class ModelUsageViewTest extends munit.FunSuite {
  private val started=Instant.parse("2026-01-01T00:00:00Z")
  private val settings=IndexingSettings(4,8,16)
  private def identity(owner: String): Identity = Identity(UserInfo(owner,"synthetic",List(Scope.Read)),true,"synthetic-hash")
  private def usage(input: Long,output: Long,reasoning: Long,purpose: ModelWorkload): ProviderUsage = ProviderUsage.parse(Json.obj("usage"->Json.obj(
    "prompt_tokens"->Json.fromLong(input),"completion_tokens"->Json.fromLong(output),
    "completion_tokens_details"->Json.obj("reasoning_tokens"->Json.fromLong(reasoning)))),purpose)
  private def fixture(f: (Ref[IO,Long],ModelTelemetry,ModelUsageView) => IO[Unit]): Unit = (for {
    millis <- Ref.of[IO,Long](0L)
    clock=new ModelTelemetryClock { def read: IO[ModelTelemetryTime] = millis.get.map(value => ModelTelemetryTime(value*1000000L,started.plusMillis(value))) }
    telemetry <- ModelTelemetry.make(clock,Set("","a","b"))
    _ <- f(millis,telemetry,new ModelUsageView(telemetry,settings))
  } yield ()).unsafeRunSync()

  test("BG specified: API keeps four purposes, provider counters, window bounds and reasoning subset distinct") {
    fixture { (time,telemetry,view) => for {
      _ <- ModelWorkload.values.toList.traverse_ { purpose =>
        telemetry.begin(ModelCallContext("a",purpose)).flatMap(ticket => telemetry.finish(ticket,ModelCallOutcome.Complete,usage(100L,60L,40L,purpose)))
      }
      _ <- time.set(1000L)
      result <- view.read(identity("a"))
      _ <- IO {
        assertEquals(result.basis,ModelRateBasis.ProviderReportedCompletedCalls)
        assertEquals(result.settings,settings)
        assertEquals(result.observedAt,started.plusSeconds(1).toString)
        assertEquals(result.processStartedAt,started.toString)
        assertEquals(result.windowStartAt,started.toString)
        assertEquals(result.windowEndAt,result.observedAt)
        assertEquals(result.coveredMillis,1000)
        assertEquals(result.samples.map(_.purpose),List(ModelPurpose.Annotation,ModelPurpose.DocumentEmbedding,ModelPurpose.QueryEmbedding,ModelPurpose.McpTest))
        result.samples.foreach { sample =>
          assertEquals(sample.input,TokenRateWindow(100L,1L,0L,Some(100.0),Some(1000L)))
          assertEquals(sample.finishedCalls,1L)
          if(sample.purpose==ModelPurpose.Annotation || sample.purpose==ModelPurpose.McpTest) {
            assertEquals(sample.output,Some(TokenRateWindow(60L,1L,0L,Some(60.0),Some(1000L))))
            assertEquals(sample.reasoningSubset,Some(TokenRateWindow(40L,1L,0L,Some(40.0),Some(1000L))))
          } else { assertEquals(sample.output,None); assertEquals(sample.reasoningSubset,None) }
        }
      }
    } yield () }
  }
  test("BG specified: caller identity alone selects usage, including an admitted empty opaque owner") {
    fixture { (time,telemetry,view) => for {
      a <- telemetry.begin(ModelCallContext("a",ModelWorkload.IndexAnnotation))
      _ <- telemetry.finish(a,ModelCallOutcome.Complete,usage(9007199254740993L,0L,0L,ModelWorkload.IndexAnnotation))
      empty <- telemetry.begin(ModelCallContext("",ModelWorkload.QueryEmbedding))
      _ <- telemetry.finish(empty,ModelCallOutcome.Complete,usage(7L,0L,0L,ModelWorkload.QueryEmbedding))
      _ <- time.set(100L)
      first <- view.read(identity("a"))
      other <- view.read(identity("b"))
      opaque <- view.read(identity(""))
      _ <- IO {
        assertEquals(first.samples.head.input.knownTokens,9007199254740993L)
        assert(other.samples.forall(sample => sample.finishedCalls==0L && sample.input.tokensPerSecond.isEmpty))
        assertEquals(opaque.samples(2).input.knownTokens,7L)
        val encoded=Wire.encode(ModelUsageResult.codecJson,first)
        assertEquals(Wire.decode(ModelUsageResult.codecJson,encoded),first)
        assert(!encoded.asObject.get.contains("ownerId"))
      }
    } yield () }
  }
  test("BG specified: unknown, reported zero, in-flight and embedding non-applicability remain separate") {
    fixture { (time,telemetry,view) => for {
      active <- telemetry.begin(ModelCallContext("a",ModelWorkload.McpTest))
      missing <- telemetry.begin(ModelCallContext("a",ModelWorkload.IndexAnnotation))
      _ <- telemetry.finish(missing,ModelCallOutcome.Failed,ProviderUsage.unknown)
      zero <- telemetry.begin(ModelCallContext("a",ModelWorkload.IndexEmbedding))
      _ <- telemetry.finish(zero,ModelCallOutcome.Complete,usage(0L,0L,0L,ModelWorkload.IndexEmbedding))
      _ <- time.set(1000L)
      result <- view.read(identity("a"))
      _ <- IO {
        assertEquals(result.samples.head.failedCalls,1L)
        assertEquals(result.samples.head.input.unknownCalls,1L)
        assertEquals(result.samples.head.input.tokensPerSecond,None)
        assertEquals(result.samples(1).input.tokensPerSecond,Some(0.0))
        assertEquals(result.samples(1).output,None)
        assertEquals(result.samples.last.inFlight,1)
        assertEquals(result.samples.last.input.tokensPerSecond,None)
      }
      _ <- telemetry.finish(active,ModelCallOutcome.Cancelled,ProviderUsage.unknown)
    } yield () }
  }
  test("BG specified: required Read scope fails without consulting or disclosing snapshots") {
    fixture { (_,_,view) => view.read(identity("a").copy(user=UserInfo("a","synthetic",List(Scope.Ingest)))).attempt.map {
      case Left(error: DomainError) => assertEquals(error.code,"forbidden")
      case other => fail(s"expected forbidden, got $other")
    }}
  }
}
