import { ModelPurpose, ModelRateBasis, type ModelUsageResult } from './api.ts';
const purposes = [ModelPurpose.Annotation, ModelPurpose.DocumentEmbedding, ModelPurpose.QueryEmbedding, ModelPurpose.McpTest] as const;
export function validateModelUsage(result: ModelUsageResult): ModelUsageResult {
  if (result.basis !== ModelRateBasis.ProviderReportedCompletedCalls || !Number.isInteger(result.coveredMillis) || result.coveredMillis < 0 || result.coveredMillis > 10_000 || result.samples.length !== purposes.length || new Set(result.samples.map(sample => sample.purpose)).size !== purposes.length || purposes.some(purpose => !result.samples.some(sample => sample.purpose === purpose))) throw new Error('Invalid completed-call usage snapshot.');
  for (const sample of result.samples) {
    const embedding = sample.purpose === ModelPurpose.DocumentEmbedding || sample.purpose === ModelPurpose.QueryEmbedding;
    if (embedding !== (sample.output === undefined) || embedding !== (sample.reasoningSubset === undefined)) throw new Error('Invalid usage output/reasoning applicability.');
    if (!Number.isInteger(sample.inFlight) || sample.inFlight < 0 || [sample.finishedCalls, sample.failedCalls, sample.cancelledCalls, sample.invalidUsageCalls].some(count => count < 0n)) throw new Error('Invalid usage counts.');
    for (const window of [sample.input, sample.output, sample.reasoningSubset]) if (window !== undefined) {
      if ([window.knownTokens, window.reportedCalls, window.unknownCalls].some(count => count < 0n) || (window.sampleAgeMillis !== undefined && window.sampleAgeMillis < 0n) || (window.tokensPerSecond !== undefined && (!Number.isFinite(window.tokensPerSecond) || window.tokensPerSecond < 0 || window.unknownCalls !== 0n || result.coveredMillis === 0))) throw new Error('Invalid usage rate.');
    }
  }
  return result;
}
