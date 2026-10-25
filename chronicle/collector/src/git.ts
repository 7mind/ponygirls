import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { sanitizeRemote } from './privacy.ts';

export interface GitObservation { remote: string | null; diagnostic: string | null }
export interface GitMetadata { read(cwd: string): Promise<GitObservation> }
export class LocalGitMetadata implements GitMetadata {
  private readonly executable: string; private readonly timeoutMs: number; private readonly maxBytes: number;
  constructor(executable: string, timeoutMs: number, maxBytes: number) { this.executable = executable; this.timeoutMs = timeoutMs; this.maxBytes = maxBytes; }
  read(cwd: string): Promise<GitObservation> {
    if (!isAbsolute(cwd) || cwd.includes('\0')) return Promise.resolve({ remote: null, diagnostic: 'git-cwd-invalid' });
    return new Promise(resolve => {
      const child = spawn(this.executable, ['config', '--local', '--no-includes', '--get', 'remote.origin.url'], {
        cwd, stdio: ['ignore', 'pipe', 'ignore'], shell: false,
        env: { PATH: process.env['PATH'] ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
      });
      const chunks: Buffer[] = []; let size = 0; let failure: string | null = null;
      const timer = setTimeout(() => { failure = 'git-metadata-timeout'; child.kill('SIGKILL'); }, this.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.maxBytes) { failure = 'git-metadata-too-large'; child.kill('SIGKILL'); }
        else chunks.push(chunk);
      });
      child.once('error', () => { clearTimeout(timer); resolve({ remote: null, diagnostic: 'git-metadata-unavailable' }); });
      child.once('close', code => {
        clearTimeout(timer);
        if (failure !== null) { resolve({ remote: null, diagnostic: failure }); return; }
        if (code !== 0) { resolve({ remote: null, diagnostic: code === 1 ? null : 'git-metadata-unavailable' }); return; }
        const remote = Buffer.concat(chunks).toString('utf8').trim();
        resolve({ remote: remote.length === 0 ? null : sanitizeRemote(remote), diagnostic: null });
      });
    });
  }
}
