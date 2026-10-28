import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { CollectorError, object, type Format, type DiscoveryRoot } from './domain.ts';
import type { PrivacyRules } from './privacy.ts';
import { validYoloProfileName, type AdmissionPolicy } from './admission.ts';

export interface Redactions extends PrivacyRules { secretFiles: string[] }
export interface Exclusions { roots: string[]; profiles: string[]; projects: string[]; sessions: string[]; paths: string[] }
export interface Config extends AdmissionPolicy {
  enabled: boolean; endpoint: string; tokenFile: string; stateDir: string; trustedHTTP: boolean;
  homeDir: string; yoloDir: string; discoverNative: boolean; discoverYolo: boolean;
  roots: DiscoveryRoot[]; exclusions: Exclusions; redactions: Redactions;
  quietMs: number; pollMs: number; maxDepth: number; maxFiles: number; maxScanBytes: number;
  maxFileBytes: number; maxPayloadBytes: number; maxMessages: number; partialLineQuarantineMs: number;
  uploadTimeoutMs: number; maxAttempts: number; backoffBaseMs: number; backoffCapMs: number;
}
const LIMITS = { quietMs: 60_000, pollMs: 30_000, maxDepth: 16, maxFiles: 10_000, maxScanBytes: 134_217_728, maxFileBytes: 4_194_304, maxPayloadBytes: 8_388_608, maxMessages: 10_000, partialLineQuarantineMs: 86_400_000, uploadTimeoutMs: 15_000, maxAttempts: 8, backoffBaseMs: 1_000, backoffCapMs: 300_000 };
const invalid = (): never => { throw new CollectorError('invalid-config'); };
const strings = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || v.length === 0)) return invalid();
  return value as string[];
};
function keys(value: Record<string, unknown>, allowed: string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function absolute(value: unknown): string { if (typeof value !== 'string' || !isAbsolute(value)) return invalid(); return value; }

export function loadConfig(input: unknown): Config {
  if (!object(input)) return invalid();
  keys(input, ['enabled', 'endpoint', 'tokenFile', 'stateDir', 'trustedHTTP', 'homeDir', 'yoloDir', 'discoverNative', 'discoverYolo', 'excludeDefaultProfile', 'excludedYoloProfiles', 'roots', 'exclusions', 'redactions', ...Object.keys(LIMITS)]);
  const enabled = bool(input['enabled'] ?? false);
  const homeDir = absolute(input['homeDir'] ?? homedir());
  const endpoint = input['endpoint'] ?? '';
  if (typeof endpoint !== 'string' || (enabled && endpoint.length === 0)) return invalid();
  const tokenFile = input['tokenFile'] === undefined && !enabled ? '' : absolute(input['tokenFile']);
  const stateDir = input['stateDir'] === undefined && !enabled ? '' : absolute(input['stateDir']);
  const excludedYoloProfiles = [...new Set(strings(input['excludedYoloProfiles'] === undefined ? [] : input['excludedYoloProfiles']))].sort();
  if (excludedYoloProfiles.some(name => !validYoloProfileName(name))) return invalid();
  const roots: DiscoveryRoot[] = [];
  if (input['roots'] !== undefined) {
    if (!Array.isArray(input['roots'])) return invalid();
    const seen = new Set<string>();
    for (const root of input['roots']) {
      if (!object(root)) return invalid();
      keys(root, ['id', 'format', 'path']);
      if (typeof root['id'] !== 'string' || root['id'].length === 0 || !['pi', 'claude', 'codex'].includes(String(root['format']))) return invalid();
      const format = root['format'] as Format;
      const key = `${root['id']}\0${format}`;
      if (seen.has(key)) return invalid();
      seen.add(key);
      roots.push({ id: root['id'], format, path: absolute(root['path']), profile: null, layout: 'transcripts' });
    }
  }
  const exclusions: Exclusions = { roots: [], profiles: [], projects: [], sessions: [], paths: [] };
  if (input['exclusions'] !== undefined) {
    if (!object(input['exclusions'])) return invalid();
    keys(input['exclusions'], Object.keys(exclusions));
    for (const key of Object.keys(exclusions) as (keyof Exclusions)[]) exclusions[key] = strings(input['exclusions'][key] ?? []);
  }
  const redactions: Redactions = { fieldNames: [], textPatterns: [], secretFiles: [] };
  if (input['redactions'] !== undefined) {
    if (!object(input['redactions'])) return invalid();
    keys(input['redactions'], Object.keys(redactions));
    for (const key of Object.keys(redactions) as (keyof Redactions)[]) redactions[key] = strings(input['redactions'][key] ?? []);
    if (redactions.secretFiles.some(path => !isAbsolute(path))) return invalid();
  }
  const limits = { ...LIMITS };
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const value = input[key] ?? LIMITS[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (key === 'quietMs' ? 0 : 1)) return invalid();
    limits[key] = value;
  }
  if (limits.backoffBaseMs > limits.backoffCapMs || limits.maxDepth > 64) return invalid();
  return { enabled, endpoint, tokenFile, stateDir, homeDir, excludeDefaultProfile: bool(input['excludeDefaultProfile'] === undefined ? false : input['excludeDefaultProfile']), excludedYoloProfiles, yoloDir: absolute(input['yoloDir'] ?? join(homeDir, '.config/yolo')), trustedHTTP: bool(input['trustedHTTP'] ?? false), discoverNative: bool(input['discoverNative'] ?? true), discoverYolo: bool(input['discoverYolo'] ?? true), roots, exclusions, redactions, ...limits };
}
