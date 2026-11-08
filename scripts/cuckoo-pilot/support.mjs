import { isDeepStrictEqual } from 'node:util';

export function recordResponses(result, assistants, checkpointIds, phase) {
  for (const entry of assistants) {
    const message = entry.message; const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    const usageKnown = message.stopReason === 'stop' || message.usage.totalTokens > 0;
    result.responses.push({ entryId: entry.id, phase, checkpoint: checkpointIds.has(entry.id), text, usage: message.usage, usageKnown, stopReason: message.stopReason });
    for (const key of Object.keys(result.usage)) result.usage[key] += message.usage[key];
  }
  if (assistants.length === 0) result.responses.push({ phase, checkpoint: false, text: '', usage: null, usageKnown: false, stopReason: 'unavailable' });
  if (assistants.length === 0 || assistants.some(entry => entry.message.stopReason !== 'stop')) throw new Error('Provider response failed or was interrupted');
}
export function feasibilityMatches(feasibility, config, sourceHashes, model) {
  const identity = { provider: model.provider, id: model.id, api: model.api, contextWindow: model.contextWindow };
  return feasibility.valid && isDeepStrictEqual(feasibility.config, config) && isDeepStrictEqual(feasibility.sourceHashes, sourceHashes) && isDeepStrictEqual(feasibility.model, identity);
}
export function exposure(result) {
  const prefinalCheckpoints = result.phases.filter(phase => phase.phase < 3).reduce((n, phase) => Math.max(n, phase.checkpointCount), 0);
  if (!result.enabled || result.length === 'short') return { valid: result.reports.length === 0, prefinalCheckpoints, reason: result.reports.length === 0 ? null : 'control-triggered' };
  const valid = prefinalCheckpoints > 0 && result.reports.every(report => report.error === null);
  return { valid, prefinalCheckpoints, reason: valid ? null : 'missing-or-invalid-prefinal-checkpoint' };
}
