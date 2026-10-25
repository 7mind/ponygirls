import { createHash } from 'node:crypto';

export type Format = 'pi' | 'claude' | 'codex';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface JsonObject { [key: string]: Json }
export interface ParsedRecord { value: JsonObject; id: string | null; parentId: string | null; index: number }
export interface ParsedMessage { id: string; parentId: string | null; role: string; text: string; timestamp: string | null; recordIndex: number }
export interface ParsedMetadata {
  title: string; project: string | null; workdir: string | null;
  gitRemote: string | null; gitBranch: string | null; gitCommit: string | null;
  model: string | null; startedAt: string | null; gitRemoteObserved: boolean;
}
export interface ParsedTranscript {
  producerId: string; subagentId: string | null; parentId: string | null;
  raw: string; redacted: boolean; records: ParsedRecord[]; messages: ParsedMessage[]; metadata: ParsedMetadata;
}
export interface DiscoveryRoot { id: string; format: Format; path: string; layout: 'transcripts' | 'pi-subagents'; profile: string | null }
export interface Diagnostic { rootId: string; pathId: string; code: string }
export interface Counters {
  enabled: boolean; discovered: number; scanned: number; scannedBytes: number; waiting: number;
  excluded: number; unchanged: number; enqueued: number; uploaded: number; uploadFailures: number;
  quarantined: number; pending: number; stopped: number; conflicts: number;
}
export interface RootCoverage { rootId: string; pathId: string; format: Format; discovered: number; scanned: number; bytes: number; waiting: number; excluded: number; quarantined: number }
export interface CollectorReport { at: number; counters: Counters; roots: RootCoverage[] }
export class CollectorError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CollectorError'; }
}
export const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const object = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
export const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
export const timestamp = (value: unknown): string | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
