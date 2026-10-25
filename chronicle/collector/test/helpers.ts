import type { GitMetadata } from '../src/git.ts';
export const noGit: GitMetadata = { async read(_cwd) { return { remote: null, diagnostic: null }; } };
