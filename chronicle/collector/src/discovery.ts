import { constants, closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, type Dirent } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CollectorError, hash, type Diagnostic, type DiscoveryRoot } from './domain.ts';
import type { Config } from './config.ts';
import { validYoloProfileName, type CollectionOrigin } from './admission.ts';

export interface DiscoveredRoot extends DiscoveryRoot { origin: CollectionOrigin }
export interface SourceFile { root: DiscoveredRoot; path: string; relativePath: string }
export interface Scan { files: SourceFile[]; diagnostics: Diagnostic[]; visited: number }
export interface Snapshot { bytes: Buffer; digest: string; mtimeMs: number }
export const pathWithin = (path: string, prefix: string): boolean => path === prefix || path.startsWith(prefix.endsWith(sep) ? prefix : prefix + sep);
export const excludedPath = (path: string, prefixes: string[]): boolean => prefixes.some(prefix => pathWithin(resolve(path), resolve(prefix)));
const code = (error: unknown): string | undefined => typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;

export function rejectSymlinks(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (lstatSync(current).isSymbolicLink()) throw new CollectorError('symlink-rejected');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function discoverRoots(config: Config, platform: string): DiscoveredRoot[] {
  if (!config.enabled) return [];
  const roots: DiscoveredRoot[] = config.roots.map(root => ({ ...root, origin: { kind: 'explicit' } }));
  const add = (id: string, profile: string | null, claude: string, codex: string, pi: string, origin: CollectionOrigin): void => {
    roots.push({ id, profile, origin, format: 'claude', path: join(claude, 'projects'), layout: 'transcripts' },
      { id, profile, origin, format: 'codex', path: join(codex, 'sessions'), layout: 'transcripts' },
      { id, profile, origin, format: 'codex', path: join(codex, 'archived_sessions'), layout: 'transcripts' },
      { id, profile, origin, format: 'pi', path: join(pi, 'sessions'), layout: 'transcripts' },
      { id, profile, origin, format: 'pi', path: join(pi, 'subagents'), layout: 'pi-subagents' });
  };
  if (config.discoverNative) add('native', null, join(config.homeDir, '.claude'), join(config.homeDir, '.codex'), join(config.homeDir, '.pi/agent'), { kind: 'native' });
  if (config.discoverYolo) {
    try {
      rejectSymlinks(config.yoloDir);
      const profiles: Dirent[] = [];
      const directory = opendirSync(config.yoloDir);
      try {
        for (;;) {
          const profile = directory.readSync(); if (profile === null) break;
          if (profiles.length >= config.maxFiles) throw new CollectorError('profile-scan-limit');
          profiles.push(profile);
        }
      } finally { directory.closeSync(); }
      for (const profile of profiles.sort((a, b) => a.name.localeCompare(b.name))) {
        if ((!profile.isDirectory() && !profile.isSymbolicLink()) || config.exclusions.profiles.includes(profile.name)) continue;
        const root = join(config.yoloDir, profile.name);
        const origin: CollectionOrigin = profile.isDirectory() && validYoloProfileName(profile.name) ? { kind: 'named-yolo', name: profile.name } : { kind: 'unknown' };
        if (platform === 'darwin') add(`yolo:${profile.name}`, profile.name, join(root, 'claude'), join(root, 'codex'), join(root, 'pi'), origin);
        else add(`yolo:${profile.name}`, profile.name, join(root, 'claude/home'), join(root, 'codex/home'), join(root, 'pi/home/agent'), origin);
      }
    } catch (error) { if (code(error) !== 'ENOENT') throw error instanceof CollectorError ? error : new CollectorError('profile-discovery-failed'); }
  }
  return roots.filter(root => !config.exclusions.roots.includes(root.id) && (root.profile === null || !config.exclusions.profiles.includes(root.profile)));
}

function transcriptPath(root: DiscoveryRoot, path: string): boolean {
  const parts = path.split(sep);
  if (!path.endsWith('.jsonl')) return false;
  if (root.layout === 'pi-subagents') return parts.length === 4 && parts[1] === 'sessions';
  if (root.format === 'claude') {
    if (parts.some(p => ['memory', 'file-history', 'fileHistory', 'config'].includes(p))) return false;
    if (parts.length <= 2) return true;
    return parts[2] === 'subagents' && (parts.at(-1) as string).startsWith('agent-');
  }
  if (root.format === 'pi') return parts.length <= 2;
  return !parts.some(p => ['memory', 'config', 'file-history'].includes(p));
}

export function scanRoots(roots: DiscoveredRoot[], config: Config): Scan {
  const result: Scan = { files: [], diagnostics: [], visited: 0 };
  let stopped = false;
  const diagnostic = (root: DiscoveryRoot, path: string, value: string): void => { result.diagnostics.push({ rootId: root.id, pathId: hash(path), code: value }); };
  for (const root of roots) {
    if (stopped) break;
    if (!isAbsolute(root.path)) throw new CollectorError('invalid-root');
    if (excludedPath(root.path, config.exclusions.paths)) continue;
    try { rejectSymlinks(root.path); }
    catch (error) { diagnostic(root, root.path, code(error) === 'ENOENT' ? 'root-missing' : error instanceof CollectorError ? error.code : 'root-unreadable'); continue; }
    const walk = (directory: string, depth: number): void => {
      let handle;
      try { handle = opendirSync(directory); }
      catch { diagnostic(root, directory, 'directory-unreadable'); return; }
      try {
      for (;;) {
        if (stopped) return;
        const entry = handle.readSync(); if (entry === null) break;
        const path = join(directory, entry.name);
        if (excludedPath(path, config.exclusions.paths)) continue;
        // Native Pi subagents contain harness worktrees and attachments as well as
        // transcripts. Only enter <root>/sessions/<agent>/<transcript>.jsonl;
        // irrelevant entries must not consume the transcript scan budget or emit
        // diagnostics (including symlinks we will never follow).
        if (root.layout === 'pi-subagents') {
          const directoryCandidate = entry.isDirectory() || entry.isSymbolicLink();
          if (depth === 0 && !directoryCandidate) continue;
          if (depth === 1 && entry.name !== 'sessions') continue;
          if (depth === 2 && !directoryCandidate) continue;
          if (depth === 3 && (!entry.name.endsWith('.jsonl') || entry.isDirectory())) continue;
          if (depth > 3) continue;
        }
        if (++result.visited > config.maxFiles) { diagnostic(root, path, 'scan-entry-limit'); stopped = true; return; }
        if (entry.isSymbolicLink()) { diagnostic(root, path, 'symlink-rejected'); continue; }
        if (entry.isDirectory()) {
          if (root.layout !== 'pi-subagents' && ['memory', 'file-history', 'fileHistory', 'config', '.git'].includes(entry.name)) continue;
          if (depth >= config.maxDepth) { diagnostic(root, path, 'scan-depth-limit'); continue; }
          walk(path, depth + 1);
        } else if (entry.isFile()) {
          const relativePath = relative(root.path, path);
          if (transcriptPath(root, relativePath)) result.files.push({ root, path, relativePath });
        } else if (entry.name.endsWith('.jsonl')) diagnostic(root, path, 'not-regular-file');
      }
      } catch { diagnostic(root, directory, 'directory-read-failed'); }
      finally { handle.closeSync(); }
    };
    walk(root.path, 0);
  }
  return result;
}

export function readSnapshot(file: SourceFile, maxBytes: number): Snapshot {
  let descriptor: number | null = null;
  try {
    rejectSymlinks(file.path);
    const canonicalRoot = realpathSync(file.root.path);
    if (!pathWithin(realpathSync(file.path), canonicalRoot)) throw new CollectorError('symlink-escape');
    descriptor = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new CollectorError('not-regular-file');
    if (before.size > BigInt(maxBytes)) throw new CollectorError('snapshot-too-large');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, size, buffer.length - size, null);
      size += count;
      if (count === 0 || size === buffer.length) break;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathStat = lstatSync(file.path, { bigint: true });
    rejectSymlinks(file.path);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || after.ino !== pathStat.ino || after.dev !== pathStat.dev || size !== Number(after.size)) throw new CollectorError('source-changed-during-read');
    const bytes = buffer.subarray(0, size);
    return { bytes, digest: hash(bytes), mtimeMs: Number(after.mtimeNs / 1_000_000n) };
  } catch (error) { throw error instanceof CollectorError ? error : new CollectorError('snapshot-read-failed'); }
  finally { if (descriptor !== null) closeSync(descriptor); }
}
