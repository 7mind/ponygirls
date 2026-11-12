import { createHash } from 'node:crypto';
import {
  CaptureContext, CaptureMetadata, ContextRecordInput, EventOrigin, IngestRequest,
  LineageStatus, Observation_None, OriginContextInput_ReportedNative, SourceRepresentation,
} from '../../generated/typescript/ontology/api/index.js';

export function captureSourceId(namespace: string, eventId: string): string {
  const bytes = createHash('md5').update('capture:' + namespace + ':' + eventId.toLowerCase()).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x30;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export interface NativeEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly type: string;
  readonly message: unknown;
}
export interface NativeAttachment {
  readonly sessionId: string;
  readonly branch: string;
  readonly epoch: string;
}
export interface CaptureIds { readonly requestId: string; readonly eventId: string }
export interface CaptureLimits { readonly maxTextBytes: number }

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>> : null;
}
export function reportedContext(attachment: NativeAttachment): ContextRecordInput {
  return new ContextRecordInput(new OriginContextInput_ReportedNative(new CaptureContext(
    attachment.sessionId, undefined, undefined, LineageStatus.Unknown, attachment.branch, attachment.epoch,
  )), []);
}
export function captureEntry(scope: string, attachment: NativeAttachment, entry: NativeEntry,
  ids: CaptureIds, exposedDeliveries: readonly string[], limits: CaptureLimits): IngestRequest | null {
  if (!Number.isSafeInteger(limits.maxTextBytes) || limits.maxTextBytes <= 0) throw new Error('invalid-capture-limit');
  if (entry.type !== 'message') return null;
  const message = object(entry.message);
  if (message === null) throw new Error('invalid-native-message');
  const role = message.role;
  const origin = role === 'user' ? EventOrigin.UserMessage : role === 'assistant' ? EventOrigin.WorkerMessage
    : role === 'toolResult' ? EventOrigin.ToolOutput : null;
  if (origin === null) return null;
  if (role === 'assistant' && message.stopReason === 'pending') throw new Error('unfinished-native-message');
  const omissions = new Set<string>(['native-metadata-not-authenticated', 'nontext-content-not-captured']);
  const content: string | { type: 'text'; text: string }[] = typeof message.content === 'string' ? message.content : (() => {
    if (!Array.isArray(message.content)) throw new Error('invalid-native-content');
    return message.content.flatMap((value: unknown) => {
      const block = object(value);
      if (block === null || typeof block.type !== 'string') throw new Error('invalid-native-block');
      if (block.type !== 'text') { omissions.add('omitted-block:' + block.type); return []; }
      if (typeof block.text !== 'string') throw new Error('invalid-native-text');
      return [{ type: 'text' as const, text: block.text }];
    });
  })();
  let outcome: { stopReason: string } | { isError: boolean } | undefined;
  if (role === 'assistant') {
    if (typeof message.stopReason !== 'string' || !['stop', 'length', 'toolUse', 'error', 'aborted', 'deferred'].includes(message.stopReason)) throw new Error('invalid-native-outcome');
    outcome = { stopReason: message.stopReason };
  }
  if (role === 'toolResult') {
    if (typeof message.isError !== 'boolean') throw new Error('invalid-native-outcome');
    outcome = { isError: message.isError };
  }
  const text = JSON.stringify({ role, content, ...(outcome === undefined ? {} : { outcome }) });
  if (Buffer.byteLength(text, 'utf8') > limits.maxTextBytes) throw new Error('capture-capacity');
  if (entry.id.length === 0 || attachment.sessionId.length === 0) throw new Error('invalid-native-identity');
  const metadata = new CaptureMetadata(entry.id, entry.parentId === null ? undefined : entry.parentId,
    undefined, SourceRepresentation.PiTranscript, [...omissions].sort(), [...exposedDeliveries]);
  return new IngestRequest(scope, ids.requestId, ids.eventId, reportedContext(attachment), undefined,
    origin, metadata, text, new Observation_None());
}
