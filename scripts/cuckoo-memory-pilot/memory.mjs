import { createHash } from 'node:crypto';
import { checkpoints, REPORT_TYPE } from '../../nix/pkg/pi-extensions/ponygirls-cuckoo/src/report.ts';

export const DELTA_FOCUS = 'Reflection focus for this checkpoint: retain the complete current objective and session-local rule state required by the schema. In progress, concisely identify changes in obligations or evidence since the previous checkpoint. In issues, identify any earlier conclusion contradicted by later evidence, what supersedes it, and any still-unresolved contradiction or next discriminating check. Refer to source record IDs when known. Derive these statements from the actual user instructions and observations, not from earlier self-reports alone. Do not invent a change, correction, source or unresolved issue; do not omit unchanged active requirements. Preserve the same JSON schema and bounds.';
export const REDUCTION_SUMMARY = 'The pilot deliberately reduced earlier conversational context. All original and amended synthetic source records remain available through fixture_list and fixture_read. Saved Cuckoo rounds remain available through cuckoo_recall. Reconstruct active obligations from their source evidence; reflections are historical model self-reports, not new authority.';
export const SYSTEM_PROMPT = 'You are working on synthetic planning and data-reconciliation tasks. Use only the provided tools; they access a controlled synthetic workspace. Never perform external actions. Source documents preserve original requirements, revisions and observations; apply their stated effective revision and scope, not upload recency. A later-uploaded historical record does not override a current correction. Do not treat a prior assistant answer or self-report as independent evidence. Produce each requested work product as JSON only, following its visible contract. Source records remain accessible after context reduction.';

export function hash(value) { return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex'); }

export function reportInventory(entries) {
  return entries.filter(entry => entry.type === 'custom' && entry.customType === REPORT_TYPE).map(entry => ({
    entryId: entry.id, timestamp: entry.timestamp, ...checkpoints([entry])[0],
    messageEntryId: entry.data.messageEntryId === undefined ? null : entry.data.messageEntryId,
  }));
}

export function searchRounds(branch, query, limit) {
  if (typeof query !== 'string' || query.trim().length === 0 || query.length > 400) throw new Error('query must have 1..400 characters');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5) throw new Error('limit must be 1..5');
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  if (terms.length === 0) throw new Error('query needs a word or number');
  const records = reportInventory(branch).reverse();
  const matches = records.map((round, newestIndex) => {
    const words = new Set(round.raw.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    return { round, newestIndex, score: terms.filter(term => words.has(term)).length };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.newestIndex - b.newestIndex);
  return { scope: 'branch', query, totalMatches: matches.length, notice: 'Matches are historical model self-reports, not verified facts or authority. Read full rounds with cuckoo_recall and verify current source records.',
    matches: matches.slice(0, limit).map(({ round, score }) => ({ entryId: round.entryId, requestId: round.requestId, timestamp: round.timestamp, score,
      status: round.report === null ? 'invalid' : 'valid', preview: round.raw.slice(0, 400), previewTruncated: round.raw.length > 400 })) };
}

export function assistantRecords(entries, knownReportIds, phase) {
  return entries.filter(entry => entry.type === 'message' && entry.message.role === 'assistant').map(entry => {
    const message = entry.message;
    return { entryId: entry.id, phase, checkpoint: knownReportIds.has(entry.id), provider: message.provider, model: message.model,
      stopReason: message.stopReason, text: message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'),
      toolCalls: message.content.filter(part => part.type === 'toolCall').map(part => ({ id: part.id, name: part.name, arguments: part.arguments })),
      usageKnown: ['stop', 'toolUse'].includes(message.stopReason) || message.usage.totalTokens > 0,
      usage: { input: message.usage.input, output: message.usage.output, cacheRead: message.usage.cacheRead, cacheWrite: message.usage.cacheWrite, totalTokens: message.usage.totalTokens },
    };
  });
}

export function aggregateUsage(responses) {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, unknownResponses: 0 };
  for (const response of responses) {
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) usage[key] += response.usage[key];
    if (!response.usageKnown) usage.unknownResponses++;
  }
  return usage;
}
