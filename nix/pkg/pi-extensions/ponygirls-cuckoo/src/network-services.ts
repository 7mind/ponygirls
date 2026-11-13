import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { readJsonPreferences } from '@ponygirls/pi-settings';
import type { FetchFunction } from '@earendil-works/pi-ai';
import { textDigest } from './memory-core.ts';
import { encoderIdentityKey, MAX_VECTOR_DIMENSIONS, type EncoderIdentity } from './experiments/vector-memory.ts';
import type { CriticClockPort, CriticIdPort } from './experiments/reflection-critic.ts';
import type { EmbeddingTransportPolicy } from './embedding-transport.ts';
import type { TaskModelBinding } from './task-consent.ts';

export const MAX_ENCODER_PROFILES = 32;
export const EMBEDDING_MAX_INPUT_CHARS = 100000;
export const EMBEDDING_MAX_REQUEST_BYTES = 1000000;
export const EMBEDDING_MAX_RESPONSE_BYTES = 4000000;

export interface EncoderProfile {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly normalization: 'unit' | 'raw';
  readonly credentialEnv: string;
}
export interface EncoderProfileStore {
  readonly path: string;
  read(): readonly EncoderProfile[];
}
export interface CuckooNetworkServices {
  readonly encoderProfiles: EncoderProfileStore;
  readonly embeddingTransportPolicy: EmbeddingTransportPolicy;
  readonly credential: (name: string) => string | undefined;
  readonly fetch: FetchFunction;
  readonly clock: CriticClockPort;
  readonly ids: CriticIdPort;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid encoder profile object');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid encoder profile fields');
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid encoder profile text');
  return value;
}

function profile(value: unknown): EncoderProfile {
  const data = object(value);
  exact(data, ['id', 'label', 'url', 'model', 'version', 'dimensions', 'normalization', 'credentialEnv']);
  const url = new URL(text(data.url, 4096));
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') throw new Error('Encoder profile requires credential-free HTTPS URL');
  const dimensions = data.dimensions;
  if (typeof dimensions !== 'number' || !Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > MAX_VECTOR_DIMENSIONS) throw new Error('Encoder dimensions are out of bounds');
  const normalization = data.normalization;
  if (normalization !== 'unit' && normalization !== 'raw') throw new Error('Invalid encoder normalization');
  const credentialEnv = text(data.credentialEnv, 128);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(credentialEnv)) throw new Error('Encoder credential must name one environment variable, not a value or command');
  return Object.freeze({ id: text(data.id, 128), label: text(data.label, 256), url: url.href,
    model: text(data.model, 256), version: text(data.version, 128), dimensions, normalization, credentialEnv });
}

export function decodeEncoderProfiles(value: unknown): readonly EncoderProfile[] {
  const data = object(value); exact(data, ['version', 'encoders']);
  if (data.version !== 1 || !Array.isArray(data.encoders) || data.encoders.length > MAX_ENCODER_PROFILES) throw new Error('Invalid encoder profile version or count');
  const profiles = data.encoders.map(profile);
  if (new Set(profiles.map(item => item.id)).size !== profiles.length) throw new Error('Duplicate encoder profile identity');
  return Object.freeze(profiles);
}

export class FileEncoderProfiles implements EncoderProfileStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): readonly EncoderProfile[] { return readJsonPreferences(this.path, () => [], decodeEncoderProfiles, 'Cuckoo encoder profiles'); }
}

function embeddingImplementationDigest(): string {
  const digest = (url: URL): string => createHash('sha256').update(readFileSync(url)).digest('hex');
  return `sha256:${createHash('sha256').update(JSON.stringify([
    digest(new URL('./embedding-transport.ts', import.meta.url)),
    digest(new URL('./experiments/vector-memory.ts', import.meta.url)),
    process.version, process.versions.v8,
  ])).digest('hex')}`;
}

export function encoderIdentity(profile: EncoderProfile, transportPolicy: EmbeddingTransportPolicy): EncoderIdentity {
  const configDigest = textDigest(JSON.stringify([
    'cuckoo-encoder-profile-v1', profile.id, profile.label, new URL(profile.url).href,
    profile.model, profile.version, profile.dimensions, profile.normalization,
    profile.credentialEnv, transportPolicy, EMBEDDING_MAX_INPUT_CHARS,
    EMBEDDING_MAX_REQUEST_BYTES, EMBEDDING_MAX_RESPONSE_BYTES,
  ]));
  const result: EncoderIdentity = Object.freeze({ identifier: profile.id, model: profile.model,
    version: profile.version, dimensions: profile.dimensions, normalization: profile.normalization,
    implementationDigest: embeddingImplementationDigest(), configDigest });
  encoderIdentityKey(result);
  return result;
}

export function encoderBinding(profile: EncoderProfile, transportPolicy: EmbeddingTransportPolicy): TaskModelBinding {
  const identity = encoderIdentity(profile, transportPolicy);
  return Object.freeze({ id: profile.id, label: profile.label, destination: new URL(profile.url).href,
    digest: textDigest(JSON.stringify(['cuckoo-encoder-binding-v1', encoderIdentityKey(identity), profile.label])) });
}

export function nativeNetworkServices(agentDir: string): CuckooNetworkServices {
  return {
    encoderProfiles: new FileEncoderProfiles(join(agentDir, 'cuckoo-encoders.json')),
    embeddingTransportPolicy: 'https',
    credential: name => process.env[name],
    fetch: globalThis.fetch,
    clock: {
      civilNowMs: () => Date.now(), monotonicNowMs: () => performance.now(),
      schedule(delayMs, callback) { const timer = setTimeout(callback, delayMs); return () => clearTimeout(timer); },
    },
    ids: { nextId: () => randomUUID() },
  };
}
