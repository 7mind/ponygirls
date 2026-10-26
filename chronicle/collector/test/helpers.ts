import type { GitMetadata } from '../src/git.ts';
export const noGit: GitMetadata = { async read(_cwd) { return { remote: null, diagnostic: null }; } };

import type { ProgressReporter } from '../src/progress.ts';
import { CollectorProgressAck } from '../../generated/typescript/chronicle/api/CollectorProgressAck.js';
export const acceptingProgress: ProgressReporter = { async report(update) { return new CollectorProgressAck(update.sequence, true); } };

import type { SecretReader } from '../src/runtime-privacy.ts';
export const syntheticSecrets: SecretReader = { read(_path) { return 'synthetic-default-credential'; } };
