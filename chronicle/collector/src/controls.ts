import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, basename } from 'node:path';
import { CollectorError, object } from './domain.ts';
import { excludedPath } from './discovery.ts';
export interface Controls { paused: boolean; exclusions: string[] }
export interface AdmissionEvidence { paths: string[]; uncertain?: true }
// Resolve the existing ancestor too: removing an exclusion must work after deletion.
export function pathAliases(path: string): string[] {
  const lexical = resolve(path); let ancestor = lexical; const tail: string[] = [];
  for (;;) {
    try { return [...new Set([lexical, join(realpathSync(ancestor), ...tail)])]; }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new CollectorError('control-path-unavailable');
      const parent = dirname(ancestor); if (parent === ancestor) throw new CollectorError('control-path-unavailable');
      tail.unshift(basename(ancestor)); ancestor = parent;
    }
  }
}
function paths(value: unknown): value is string[] { return Array.isArray(value) && value.every(p => typeof p === 'string' && isAbsolute(p) && resolve(p) === p); }
export function decodeControls(value: unknown): Controls {
  if (!object(value) || Object.keys(value).length !== 2 || typeof value['paused'] !== 'boolean' || !paths(value['exclusions'])) throw new CollectorError('invalid-collector-controls');
  return { paused: value['paused'], exclusions: value['exclusions'] };
}
export function decodeEvidence(value: unknown): AdmissionEvidence {
  if (!object(value) || (Object.keys(value).length !== 1 && !(Object.keys(value).length === 2 && value['uncertain'] === true)) || !paths(value['paths']) || value['paths'].length === 0) throw new CollectorError('invalid-admission-evidence');
  return { paths: value['paths'], ...(value['uncertain'] === true ? { uncertain: true as const } : {}) };
}
export function evidenceFor(bytes: Buffer, path: string): AdmissionEvidence {
  const result = new Set<string>(); let uncertain = false;
  const record = (path: string): void => {
    if (!isAbsolute(path)) { uncertain = true; return; }
    result.add(resolve(path));
    try { for (const alias of pathAliases(path)) result.add(alias); }
    catch { uncertain = true; }
  };
  record(path);
  for (const line of bytes.toString('utf8').split('\n')) {
    let value: unknown; try { value = JSON.parse(line); } catch { continue; }
    if (!object(value)) continue;
    for (const entry of [value, value['payload']]) {
      if (object(entry) && typeof entry['cwd'] === 'string') record(entry['cwd']);
    }
  }
  return { paths: [...result], ...(uncertain ? { uncertain: true as const } : {}) };
}
export function heldByControls(controls: Controls, evidence: AdmissionEvidence | null): boolean {
  return controls.paused || (controls.exclusions.length > 0 && (evidence === null || evidence.uncertain === true || evidence.paths.some(path => excludedPath(path, controls.exclusions))));
}
