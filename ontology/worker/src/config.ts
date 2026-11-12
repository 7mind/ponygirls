import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parseJson } from '../../web/src/json.js';
import { WorkerFailure, validateHttp, type Credentials, type HttpSettings } from './http.js';
import type { CoordinatorSettings } from './coordinator.js';

export interface WorkerConfig {
  readonly version: 1;
  readonly captureAuthorization: 'current-session-from-attachment';
  readonly http: HttpSettings;
  readonly coordinator: CoordinatorSettings;
  readonly workerTokenFile: string;
  readonly collectorTokenFile: string;
}
const MAX_CONFIG_BYTES = 65_536;
const MAX_TOKEN_BYTES = 257;
function invalid(): never { throw new WorkerFailure('invalid-worker-config', 'not-sent'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || !keys.every(key => Object.hasOwn(result, key))) return invalid();
  return result;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4096) return invalid();
  return value;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid();
  return value;
}
export function decodeConfig(source: string): WorkerConfig {
  const root = record(parseJson(source), ['version', 'captureAuthorization', 'http', 'coordinator', 'workerTokenFile', 'collectorTokenFile']);
  if (root.version !== 1 || root.captureAuthorization !== 'current-session-from-attachment') return invalid();
  const h = record(root.http, ['origin', 'deadlineMs', 'maxRequestBytes', 'maxResponseBytes']);
  const http: HttpSettings = { origin: text(h.origin), deadlineMs: positive(h.deadlineMs), maxRequestBytes: positive(h.maxRequestBytes), maxResponseBytes: positive(h.maxResponseBytes) };
  validateHttp(http);
  const c = record(root.coordinator, ['scope', 'workContext', 'workerActorId', 'collectorActorId', 'collectorNamespace',
    'boundaryDeadlineMs', 'pollEveryMs', 'maxNewEntries', 'maxTrackedEntries', 'maxCaptureTextBytes', 'maxCapsuleBytes']);
  const coordinator: CoordinatorSettings = {
    scope: text(c.scope), workContext: text(c.workContext), workerActorId: text(c.workerActorId),
    collectorActorId: text(c.collectorActorId), collectorNamespace: text(c.collectorNamespace),
    boundaryDeadlineMs: positive(c.boundaryDeadlineMs), pollEveryMs: positive(c.pollEveryMs),
    maxNewEntries: positive(c.maxNewEntries), maxTrackedEntries: positive(c.maxTrackedEntries),
    maxCaptureTextBytes: positive(c.maxCaptureTextBytes), maxCapsuleBytes: positive(c.maxCapsuleBytes),
  };
  if (coordinator.boundaryDeadlineMs > 60_000 || coordinator.pollEveryMs >= coordinator.boundaryDeadlineMs ||
      coordinator.maxNewEntries > coordinator.maxTrackedEntries || coordinator.maxTrackedEntries > 100_000 ||
      coordinator.maxCaptureTextBytes > http.maxRequestBytes || coordinator.maxCapsuleBytes > http.maxResponseBytes) return invalid();
  const workerTokenFile = text(root.workerTokenFile);
  const collectorTokenFile = text(root.collectorTokenFile);
  if (!isAbsolute(workerTokenFile) || !isAbsolute(collectorTokenFile)) return invalid();
  return { version: 1, captureAuthorization: 'current-session-from-attachment', http, coordinator, workerTokenFile, collectorTokenFile };
}
async function readBounded(path: string, limit: number, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!isAbsolute(path)) throw new WorkerFailure('absolute-config-path-required', 'not-sent');
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOCTTY);
  try {
    signal.throwIfAborted();
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new WorkerFailure('file-capacity', 'not-sent');
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const result = await file.read(bytes, size, bytes.length - size, null);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
      if (size > limit) throw new WorkerFailure('file-capacity', 'not-sent');
    }
    signal.throwIfAborted();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } finally { await file.close(); }
}
export async function loadConfig(path: string, signal: AbortSignal): Promise<WorkerConfig> {
  try { return decodeConfig(await readBounded(path, MAX_CONFIG_BYTES, signal)); }
  catch { throw new WorkerFailure('configuration-unavailable', 'not-sent'); }
}
export class FileCredentials implements Credentials {
  constructor(private readonly path: string) {}
  async token(signal: AbortSignal): Promise<string> {
    try {
      const value = await readBounded(this.path, MAX_TOKEN_BYTES, signal);
      if (!/^[A-Za-z0-9_-]{32,256}\n?$/.test(value)) throw new Error('invalid credential encoding');
      return value.endsWith('\n') ? value.slice(0, -1) : value;
    } catch { throw new WorkerFailure('credential-unavailable', 'not-sent'); }
  }
}
