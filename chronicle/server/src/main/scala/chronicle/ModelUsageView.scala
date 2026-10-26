package chronicle

import cats.effect.IO
import chronicle.api.*

final class ModelUsageView(telemetry: ModelTelemetry,settings: IndexingSettings) {
  def read(identity: Identity): IO[ModelUsageResult] = IO.defer {
    identity.requireScope(Scope.Read)
    telemetry.snapshot(identity.user.id).map { snapshot =>
      val purposes=ModelWorkload.values.toList
      Check(snapshot.samples.map(_.purpose)==purposes,"model-telemetry-invariant","usage purposes are incomplete or unordered")
      Check(snapshot.coveredMillis>=0L && snapshot.coveredMillis<=ModelTelemetry.bucketMillis*ModelTelemetry.bucketCount,"model-telemetry-invariant","invalid usage window")
      def counter(value: ModelTokenWindow): TokenRateWindow =
        TokenRateWindow(value.knownTokens,value.reportedCalls,value.unknownCalls,value.tokensPerSecond,value.sampleAgeMillis)
      val samples=snapshot.samples.map { sample =>
        Check(sample.output.isDefined==sample.purpose.hasOutput && sample.reasoningSubset.isDefined==sample.purpose.hasOutput,"model-telemetry-invariant","invalid usage applicability")
        val purpose=sample.purpose match {
          case ModelWorkload.IndexAnnotation => ModelPurpose.Annotation
          case ModelWorkload.IndexEmbedding => ModelPurpose.DocumentEmbedding
          case ModelWorkload.QueryEmbedding => ModelPurpose.QueryEmbedding
          case ModelWorkload.McpTest => ModelPurpose.McpTest
        }
        ModelUsageSlice(purpose,sample.inFlight,sample.finishedCalls,sample.failedCalls,sample.cancelledCalls,sample.invalidUsageCalls,counter(sample.input),sample.output.map(counter),sample.reasoningSubset.map(counter))
      }
      ModelUsageResult(snapshot.observedAt.toString,snapshot.processStartedAt.toString,snapshot.windowStartAt.toString,snapshot.windowEndAt.toString,snapshot.coveredMillis.toInt,ModelRateBasis.ProviderReportedCompletedCalls,settings,samples)
    }
  }
}
