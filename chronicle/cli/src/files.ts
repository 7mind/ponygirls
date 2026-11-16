import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CliError } from './errors.js';
import { isObject, parseJson } from './json.js';
export const MAX_BYTES = 8 * 1024 * 1024;
export interface Environment { readonly [key: string]: string | undefined }
export interface Session { origin: string; cookie: string; actor: string; user: { id: string; login: string; displayName: string; actor: string } }
function own(uid: number): boolean { return process.getuid === undefined || uid === process.getuid(); }
function noSymlinks(path: string): void {
  if (!isAbsolute(path)) throw new CliError('state', 'An absolute filesystem path is required.');
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/').filter(Boolean)) { current = join(current, part); try { if (lstatSync(current).isSymbolicLink()) throw new CliError('state', 'Symbolic links are not allowed in credential/state paths.'); } catch (error) { if (isObject(error) && error['code'] === 'ENOENT') return; throw error; } }
}
function ensurePrivateDirectory(path: string): void {
  noSymlinks(path); mkdirSync(path, { recursive: true, mode: 0o700 });
  const st = lstatSync(path); if (!st.isDirectory() || !own(st.uid) || (st.mode & 0o777) !== 0o700) throw new CliError('state', 'State/secret destination directory must be owned by this user with mode 0700.');
}
export function readBounded(path: string, maximum: number, mode: 'input' | 'credential' | 'state'): string {
  const secret = mode !== 'input';
  let fd: number | null = null;
  try {
    const absolute = mode === 'credential' ? realpathSync(resolve(path)) : resolve(path); if (secret) { if (mode === 'state') noSymlinks(absolute); if (absolute === '/nix/store' || absolute.startsWith('/nix/store/')) throw new Error(); }
    fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum) || (secret && (before.mode & 0o077n) !== 0n) || (mode === 'state' && (!own(Number(before.uid)) || (before.mode & 0o777n) !== 0o600n))) throw new Error();
    const buffer = Buffer.alloc(maximum + 1); let bytes = 0;
    for (;;) { const n = readSync(fd, buffer, bytes, buffer.length - bytes, null); bytes += n; if (n === 0 || bytes === buffer.length) break; }
    const after = fstatSync(fd, { bigint: true });
    if (bytes > maximum || before.size !== BigInt(bytes) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error();
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
  } catch { throw new CliError(secret ? 'credentials' : 'invalid', secret ? 'Credential/state file unavailable; require a bounded private regular UTF-8 file and safe state permissions.' : 'Input must be a bounded regular UTF-8 file.'); }
  finally { if (fd !== null) closeSync(fd); }
}
export async function readStdin(maximum: number): Promise<string> {
  if (process.stdin.isTTY) throw new CliError('usage', 'Use an explicit protected file or pipe on stdin, not interactive input.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const value of process.stdin) { const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as string); size += chunk.length; if (size > maximum) throw new CliError('too-large', 'Stdin exceeded the input bound.'); chunks.push(chunk); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { throw new CliError('invalid', 'Stdin must be UTF-8.'); }
}
export function checkSecretDestination(path: string): void {
  try {
    const absolute = resolve(path); noSymlinks(absolute); const parent = lstatSync(dirname(absolute));
    if (!parent.isDirectory() || !own(parent.uid) || (parent.mode & 0o777) !== 0o700) throw new Error();
    try { lstatSync(absolute); } catch (error) { if (isObject(error) && error['code'] === 'ENOENT') return; throw error; }
    throw new Error();
  } catch { throw new CliError('state', 'Secret output must be a new filename in an existing private owned 0700 directory.'); }
}
export function exclusiveSecret(path: string, content: string): void {
  let fd: number | null = null;
  try { noSymlinks(resolve(path)); ensurePrivateDirectory(dirname(resolve(path))); fd = openSync(resolve(path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); writeFileSync(fd, content); fsyncSync(fd); }
  catch (error) { if (error instanceof CliError) throw error; throw new CliError('state', 'Cannot create secret destination; require a new filename in a private 0700 directory.'); }
  finally { if (fd !== null) closeSync(fd); }
}
export class SessionStore {
  readonly directory: string;
  readonly path: string;
  constructor(environment: Environment, readonly origin: string) {
    const home = environment['HOME']; const xdg = environment['XDG_STATE_HOME']; const selected = environment['CHRONICLE_STATE_DIR'];
    if ((selected === undefined || selected === '') && (xdg === undefined || xdg === '') && (home === undefined || home === '')) throw new CliError('state', 'Set CHRONICLE_STATE_DIR or HOME.');
    this.directory = selected !== undefined && selected !== '' ? selected : join(xdg !== undefined && xdg !== '' ? xdg : join(home!, '.local', 'state'), 'chronicle-cli');
    if (!isAbsolute(this.directory)) throw new CliError('state', 'CHRONICLE_STATE_DIR/XDG_STATE_HOME must be absolute.');
    this.path = join(this.directory, `${createHash('sha256').update(origin).digest('hex')}.json`);
  }
  load(): Session {
    try { noSymlinks(this.directory); const st = lstatSync(this.directory); if (!st.isDirectory() || !own(st.uid) || (st.mode & 0o777) !== 0o700) throw new Error(); const value = parseJson(readBounded(this.path, 16384, 'state'));
      if (!isObject(value) || value['origin'] !== this.origin || typeof value['cookie'] !== 'string' || !/^[A-Za-z0-9_-]{16,8192}$/.test(value['cookie']) || typeof value['actor'] !== 'string' || !isObject(value['user'])) throw new Error();
      const user = value['user']; for (const key of ['id', 'login', 'displayName', 'actor']) if (typeof user[key] !== 'string') throw new Error();
      if (user['actor'] !== value['actor']) throw new Error();
      return value as unknown as Session;
    } catch { throw new CliError('credentials', 'No valid private session for this exact origin. Run chronicle login.'); }
  }
  private locked<T>(action: () => T): T {
    const lock = `${this.path}.lock`;
    ensurePrivateDirectory(this.directory);
    try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new CliError('state', 'Session state is locked by another writer or an interrupted operation; inspect it before retrying.'); }
    try { return action(); } finally { try { rmdirSync(lock); } catch { throw new CliError('state', 'Session state lock cleanup failed; inspect the private state directory before retrying.'); } }
  }
  save(session: Session): void {
    if (session.origin !== this.origin) throw new CliError('state', 'Refusing a cross-origin session.');
    this.locked(() => {
      let temp: string | null = null;
      try { try { const st = lstatSync(this.path); if (!st.isFile() || !own(st.uid) || (st.mode & 0o777) !== 0o600) throw new Error(); } catch (error) { if (!isObject(error) || error['code'] !== 'ENOENT') throw error; }
        temp = `${this.path}.${randomUUID()}.tmp`; exclusiveSecret(temp, `${JSON.stringify(session)}\n`); renameSync(temp, this.path); temp = null;
      } catch (error) { if (error instanceof CliError) throw error; throw new CliError('state', 'Cannot write private origin-bound session state.'); }
      finally { if (temp !== null) { try { unlinkSync(temp); } catch { /* Preserve original failure. */ } } }
    });
  }
  remove(expected: Session): void {
    this.locked(() => {
      try { lstatSync(this.path); } catch (error) { if (isObject(error) && error['code'] === 'ENOENT') return; throw new CliError('state', 'Cannot inspect private session state.'); }
      const current = this.load();
      if (current.cookie !== expected.cookie || current.actor !== expected.actor || current.user.id !== expected.user.id) return;
      try { unlinkSync(this.path); } catch { throw new CliError('state', 'Cannot remove private session state.'); }
    });
  }
}
export function bearer(environment: Environment, tokenFile: string | null): string {
  const token = environment['CHRONICLE_TOKEN'] ?? ''; const envFile = environment['CHRONICLE_TOKEN_FILE'] ?? '';
  if ((token !== '' && (envFile !== '' || tokenFile !== null)) || (envFile !== '' && tokenFile !== null)) throw new CliError('credentials', 'Ambiguous bearer credentials; select exactly one token source.');
  const path = tokenFile === null ? envFile : tokenFile;
  const value = (token !== '' ? token : path !== '' ? readBounded(path, 4096, 'credential') : '').trimEnd();
  if (!/^[A-Za-z0-9_+/.=-]{43,1024}$/.test(value)) throw new CliError('credentials', 'Set CHRONICLE_TOKEN or CHRONICLE_TOKEN_FILE to one valid private bearer credential.');
  return value;
}
