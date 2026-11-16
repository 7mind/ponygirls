import { createHash } from 'node:crypto';
import type { Evidence, ReceiptMeta, Revision } from './model.ts';

export const CHRONICLE_MAX_ATTEMPTS = 3;
export interface ChronicleBinding { endpoint: string; tokenFile: string; collectorNamespace: string; tokenHash: string }
export interface SummaryEvidence extends Omit<Evidence, 'text'> {}
export interface SummaryDocument {
  version: 1;
  interpretation: 'Historical model interpretation, not verified current state';
  journalId: string;
  project: string;
  episode: Revision;
  generator: { provider: string; model: string; thinking: string; objective: string };
  evidence: SummaryEvidence[];
  coverage: string[];
}
export interface ChroniclePending {
  requestId: string; binding: ChronicleBinding; document: SummaryDocument;
  expectedRevision: number; sessionId: string | null; payload: string | null; attempts: number;
}
export interface ChronicleReceipt { requestId: string; sessionId: string; revision: number; jobId: string }
export interface ChronicleStatus { pending: number; stopped: number; acknowledged: number; otherDestinations: number; error: string | null }
export function chronicleTarget(binding: ChronicleBinding): string {
  return createHash('sha256').update(JSON.stringify([binding.endpoint, binding.collectorNamespace, binding.tokenHash])).digest('hex');
}
export function summaryDocument(journalId: string, project: string, episode: Revision, meta: ReceiptMeta, evidence: Evidence[], coverage: string[]): SummaryDocument {
  return { version: 1, interpretation: 'Historical model interpretation, not verified current state', journalId, project, episode,
    generator: { provider: meta.provider, model: meta.model, thinking: meta.thinking, objective: meta.objective },
    evidence: evidence.map(({ text: _body, ...reference }) => reference), coverage: [...coverage] };
}
export function summaryText(document: SummaryDocument): string {
  const episode = document.episode;
  const lines = [document.interpretation, '', `# ${episode.title}`, '', `Episode ${episode.episodeId}; Historian revision ${episode.revision}; ${episode.kind}; ${episode.status}; recorded ${episode.recordedAt}`, ''];
  for (const claim of episode.claims) lines.push(`## ${claim.section} (${claim.basis})`, '', claim.text, '', `Evidence references: ${claim.evidence.join(', ')}`, '');
  if (document.coverage.length > 0) lines.push('## Coverage', '', ...document.coverage.map(gap => `- ${gap}`));
  return lines.join('\n');
}
