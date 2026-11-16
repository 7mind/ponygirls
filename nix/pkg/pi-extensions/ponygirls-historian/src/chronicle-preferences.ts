import { readJsonPreferences, writeJsonPreferences } from '@ponygirls/pi-settings';
import { isIP } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { exactObject, text } from './model.ts';
import { acquireSessionLock } from './store.ts';

export interface ChroniclePreferencesValue {
  enabled: boolean;
  endpoint: string;
  tokenFile: string;
  collectorNamespace: string;
  tokenHash: string | null;
}

const MAX_ENDPOINT_CHARS = 4096;
const MAX_TOKEN_PATH_CHARS = 4096;
const MAX_NAMESPACE_CHARS = 256;
const DESTINATION_FIELDS = ['endpoint', 'tokenFile', 'collectorNamespace'] as const;
const VALUE_FIELDS = ['enabled', ...DESTINATION_FIELDS, 'tokenHash'] as const;

export function normalizeChronicleEndpoint(value: string): string {
  if (typeof value !== 'string' || value.length > MAX_ENDPOINT_CHARS || /[\x00-\x20\x7f\\]/.test(value)) throw new Error('Invalid Chronicle endpoint');
  const parts = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(value);
  if (parts === null || parts[2].includes('@') || (parts[3] !== undefined && parts[3] !== '/' && parts[3] !== '/api/ingest')) throw new Error('Chronicle endpoint must be an origin or /api/ingest URL without credentials, query or fragment');
  let endpoint: URL;
  try { endpoint = new URL(value); }
  catch { throw new Error('Invalid Chronicle endpoint'); }
  const loopback = endpoint.hostname === 'localhost' || endpoint.hostname === '[::1]' || (isIP(endpoint.hostname) === 4 && endpoint.hostname.startsWith('127.'));
  if (endpoint.protocol !== 'https:' && (endpoint.protocol !== 'http:' || !loopback)) throw new Error('Chronicle endpoint requires HTTPS or loopback HTTP');
  return `${endpoint.origin}/api/ingest`;
}

function checkedString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Chronicle ${name} must be a string`);
  return value;
}
function checkedValue(raw: unknown): ChroniclePreferencesValue {
  const value = exactObject(raw, VALUE_FIELDS);
  if (typeof value.enabled !== 'boolean') throw new Error('Chronicle enabled must be a boolean');
  const rawEndpoint = checkedString(value.endpoint, 'endpoint');
  const endpoint = rawEndpoint === '' ? '' : normalizeChronicleEndpoint(rawEndpoint);
  const tokenFile = checkedString(value.tokenFile, 'token file');
  if (tokenFile !== '') {
    text(tokenFile, 'Chronicle token file', MAX_TOKEN_PATH_CHARS);
    if (!isAbsolute(tokenFile)) throw new Error('Chronicle token file must be absolute');
    const normalized = resolve(tokenFile);
    if (normalized === '/nix/store' || normalized.startsWith('/nix/store/')) throw new Error('Chronicle token file must be outside /nix/store');
  }
  const collectorNamespace = checkedString(value.collectorNamespace, 'collector namespace');
  if (collectorNamespace !== '') text(collectorNamespace, 'Chronicle collector namespace', MAX_NAMESPACE_CHARS);
  if (!collectorNamespace.isWellFormed()) throw new Error('Chronicle collector namespace must contain Unicode scalar values');
  const tokenHash = value.tokenHash;
  if (tokenHash !== null && (typeof tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(tokenHash))) throw new Error('Chronicle token hash must be null or a lowercase SHA-256 digest');
  if (value.enabled && (endpoint === '' || tokenFile === '' || collectorNamespace === '' || tokenHash === null)) throw new Error('Chronicle ON requires a complete destination and an explicitly approved bearer hash');
  return { enabled: value.enabled, endpoint, tokenFile, collectorNamespace, tokenHash };
}
function checkedLocal(raw: unknown): ChroniclePreferencesValue {
  const value = exactObject(raw, ['version', ...VALUE_FIELDS]);
  if (value.version !== 1) throw new Error('Invalid Chronicle preferences version');
  const { version: _version, ...preferences } = value;
  return checkedValue(preferences);
}
function checkedManaged(raw: unknown): ChroniclePreferencesValue {
  const value = exactObject(raw, ['version', ...DESTINATION_FIELDS]);
  if (value.version !== 1) throw new Error('Invalid Chronicle managed defaults version');
  const { version: _version, ...destination } = value;
  const preferences = checkedValue({ enabled: false, ...destination, tokenHash: null });
  if (DESTINATION_FIELDS.some(field => preferences[field] === '')) throw new Error('Chronicle managed defaults require a complete destination');
  return preferences;
}
function synchronousResult<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && 'then' in value && typeof value.then === 'function') {
    void Promise.resolve(value).catch(() => undefined);
    throw new Error('Chronicle preference transactions require synchronous callbacks; any completed side effects are not rolled back');
  }
  return value;
}

export class ChroniclePreferences {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): ChroniclePreferencesValue {
    const local = readJsonPreferences<ChroniclePreferencesValue | null>(this.path, () => null, checkedLocal, 'Historian Chronicle preferences');
    if (local !== null) return local;
    return readJsonPreferences(join(dirname(this.path), 'historian-chronicle-defaults.json'),
      () => ({ enabled: false, endpoint: '', tokenFile: '', collectorNamespace: '', tokenHash: null }), checkedManaged, 'Historian Chronicle managed defaults');
  }
  withSnapshot<T>(use: (current: ChroniclePreferencesValue) => T): T {
    const release = acquireSessionLock(join(dirname(this.path), 'historian'), 'chronicle-preferences');
    try { return synchronousResult(use(this.read())); }
    finally { release(); }
  }
  update(change: (current: ChroniclePreferencesValue) => ChroniclePreferencesValue): void {
    this.withSnapshot(current => {
      const next = checkedValue(synchronousResult(change(current)));
      writeJsonPreferences(this.path, { version: 1, ...next });
    });
  }
}
