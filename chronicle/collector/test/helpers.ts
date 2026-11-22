import type { GitMetadata } from '../src/git.ts';
export const noGit: GitMetadata = { async read(_cwd) { return { remote: null, diagnostic: null }; } };

import type { ProgressReporter } from '../src/progress.ts';
import { CollectorProgressAck } from '../../generated/typescript/chronicle/api/CollectorProgressAck.js';
export const acceptingProgress: ProgressReporter = { async report(update) { return new CollectorProgressAck(update.sequence, true); } };

import type { SecretReader } from '../src/runtime-privacy.ts';
export const syntheticSecrets: SecretReader = { read(_path) { return 'synthetic-default-credential'; } };

/** A wall clock long after every file change: no stat is racy, so a settled file is not read again. */
export const lateWall = (): number => Number.MAX_SAFE_INTEGER;

import { fileStatus } from '../src/discovery.ts';
/** Runs `body` while every stat of a source file reports ctime `ctimeNs()`: the kernel's coarse ctime tick, as the test
 * decides it (a change within one tick keeps the ctime). */
export async function withCtime<T>(ctimeNs: () => bigint, body: () => Promise<T>): Promise<T> {
  const { lstat, fstat } = fileStatus;
  fileStatus.lstat = path => Object.assign(lstat(path), { ctimeNs: ctimeNs() });
  fileStatus.fstat = descriptor => Object.assign(fstat(descriptor), { ctimeNs: ctimeNs() });
  try { return await body(); } finally { fileStatus.lstat = lstat; fileStatus.fstat = fstat; }
}
