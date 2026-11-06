import type { Usage } from '@earendil-works/pi-ai';

export const FAILURE_MESSAGES = {
  busy: 'Historian provider is busy; previous request has not drained',
  cancelled: 'Historian request cancelled; provider drain is separate',
  deadline: 'Historian request deadline exceeded; provider drain is separate',
  'model-unavailable': 'Historian configured model is unavailable',
  'not-authenticated': 'Historian configured provider is not authenticated',
  'context-capacity': 'Historian batch exceeds configured model context capacity',
  'output-limit': 'Historian streaming response too large',
  'provider-error': 'Historian provider returned an error; response body not retained',
  'incomplete-response': 'Historian response incomplete',
  'tool-call': 'Historian attempted a tool call',
  'invalid-json': 'Historian response is not valid JSON; response body not retained',
  'invalid-proposals': 'Historian response failed proposal validation; response body not retained',
  'runtime-error': 'Historian worker failed; error body not retained',
} as const;
export type FailureCode = keyof typeof FAILURE_MESSAGES;
export interface AttemptUsage { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }
export interface AttemptMetrics { responseChars: number | null; usage: AttemptUsage | null }
export type AttemptOutcome = 'running' | 'validated' | 'failed' | 'cancelled' | 'interrupted';
export interface AttemptFinish extends AttemptMetrics {
  outcome: Exclude<AttemptOutcome, 'running'>;
  endedAt: string;
  durationMs: number | null;
  failure: FailureCode | null;
}
export interface Attempt extends AttemptMetrics {
  id: string; owner: string; batchId: string; contextDigest: string;
  provider: string; model: string; thinking: string; objective: string;
  startedAt: string; endedAt: string | null; durationMs: number | null;
  outcome: AttemptOutcome; failure: FailureCode | null;
}
export interface AttemptSummary {
  total: number; running: number; validated: number; failed: number;
  cancelled: number; interrupted: number; recovered: number;
}
export class WorkerFailure extends Error {
  readonly code: FailureCode;
  readonly metrics: AttemptMetrics;
  constructor(code: FailureCode, metrics: AttemptMetrics) {
    super(FAILURE_MESSAGES[code]); this.name = 'WorkerFailure'; this.code = code;
    this.metrics = { responseChars: metrics.responseChars, usage: metrics.usage };
  }
}
export function attemptUsage(usage: Usage): AttemptUsage {
  const result = { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, totalTokens: usage.totalTokens };
  if (!Object.values(result).every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid Historian token usage');
  return result;
}
