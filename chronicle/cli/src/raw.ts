import { createHash, randomUUID, type Hash } from 'node:crypto';
import { close, constants, closeSync, fsync, fsyncSync, linkSync, lstatSync, openSync, statSync, unlinkSync, write } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { RawFileInfo } from '../../generated/typescript/chronicle/api/RawFileInfo.js';
import type { RawManifest } from '../../generated/typescript/chronicle/api/RawManifest.js';
import { CliError, RemoteError, remoteFailure } from './errors.js';
import { integer, option, type Arguments } from './commands.js';
import { MAX_BYTES, type Session } from './files.js';
import { isObject, parseJson } from './json.js';
import { httpFault, JSON_CONTENT_TYPE, type Http } from './transport.js';
import { decodeWire, sameUuid, uuid } from './wire.js';
/** Bytes per range request of a download: at 2 MB/s one request ends well inside a 60 s gateway deadline. */
export const RAW_RANGE_BYTES = 64 * 1024 * 1024;
/** A range answered 503 (all of the server's downloads in use) with a Retry-After is requested again, after that many seconds
  * capped at RAW_RETRY_WAIT_MAX_MS, up to RAW_RANGE_ATTEMPTS requests in all; then the download fails. */
export const RAW_RANGE_ATTEMPTS = 5;
const RAW_RETRY_WAIT_MAX_MS = 30_000;
/** How a download waits before a retry and announces it (one stderr line); tests inject the wait. */
export interface Pause { wait(milliseconds: number): Promise<void>; notify(line: string): Promise<void> }
export function realPause(notify: (line: string) => Promise<void>): Pause { return { wait: milliseconds => new Promise(done => { setTimeout(done, milliseconds); }), notify }; }
const STDOUT = '-';
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Node frees the buffers of received chunks only when V8 collects their wrappers, and V8 schedules that by its own measure
  * of external memory: tens of MiB of garbage, a peak RSS of 166 MB for a 1.1 GB download. A download collects the young
  * generation (where the wrappers die; about a millisecond) after every RAW_COLLECT_BYTES instead: 105-110 MB measured. */
const RAW_COLLECT_BYTES = 2 * 1024 * 1024;
type Collect = (options: { type: 'minor' }) => void;
/** V8's `gc` function, which Node exposes only with --expose-gc: set here, it holds for contexts created afterwards. */
function collector(): Collect { setFlagsFromString('--expose-gc'); return runInNewContext('gc') as Collect; }
/** Signals that end a download in file mode: the partial file is removed before the signal's default action. */
const INTERRUPTS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
export interface RawDownload { readonly sessionId: string; readonly revision: number | null; readonly file: number | null; readonly output: string }
/** `raw --output`: the selection, validated before any credential or network use; a file destination must not exist. */
export function rawDownload(args: Arguments): RawDownload {
  const revision = option(args, 'revision') === null ? null : integer(args, 'revision', 1, 1, 2147483647);
  const file = option(args, 'file') === null ? null : integer(args, 'file', 0, 0, 2147483647);
  const output = option(args, 'output')!;
  const request = { sessionId: uuid(args.words[1]!), revision, file, output: output === STDOUT ? STDOUT : resolve(output) };
  if (request.output === STDOUT) { if (process.stdout.isTTY) throw new CliError('usage', '--output - writes raw bytes to stdout, which is a terminal here; redirect or pipe it.'); }
  else absent(request.output);
  return request;
}
function absent(target: string): void {
  try { lstatSync(target); } catch (error) {
    if (!isObject(error) || error['code'] !== 'ENOENT') throw new CliError('state', `Cannot inspect the output path ${target}.`);
    let parent; try { parent = statSync(dirname(target)); } catch { parent = null; }
    if (parent === null || !parent.isDirectory()) throw new CliError('state', `The output directory ${dirname(target)} does not exist.`);
    return;
  }
  throw new CliError('state', `${target} exists; a download never replaces a file. Choose a new path.`);
}
async function manifest(http: Http, session: Session, request: RawDownload): Promise<RawManifest> {
  const missingRoute = new CliError('version-mismatch', `The server at ${http.origin} has no raw download API (it predates it): upgrade the server; \`chronicle raw\` without --output still returns revisions up to the server's raw read bound.`);
  const { data } = await http.request(`/api/raw/${request.sessionId}${request.revision === null ? '' : `/${request.revision}`}`, 'GET', null, { session, actor: false }, false, { missingRoute });
  const invalid = (): never => { throw new CliError('protocol-error', 'The raw manifest does not match the requested session and revision or the current API.'); };
  let value: RawManifest; try { value = decodeWire('RawManifest', data); } catch { return invalid(); }
  if (!sameUuid(request.sessionId, value.sessionId) || value.revision < 1 || (request.revision !== null && value.revision !== request.revision) || value.files.length === 0) invalid();
  value.files.forEach((file, index) => { if (file.index !== index || !SHA256_HEX.test(file.sha256) || file.bytes < 0n || file.bytes > BigInt(Number.MAX_SAFE_INTEGER)) invalid(); });
  return value;
}
function selected(value: RawManifest, file: number | null): RawFileInfo {
  const listing = (): string => value.files.map(f => `  ${f.index} ${JSON.stringify(f.path)} (${f.bytes} bytes)`).join('\n');
  if (file === null && value.files.length > 1) throw new CliError('usage', `Revision ${value.revision} has ${value.files.length} files; select one with --file INDEX:\n${listing()}`);
  const index = file ?? 0; if (index >= value.files.length) throw new CliError('usage', `--file ${index}: revision ${value.revision} has ${value.files.length} file(s):\n${listing()}`);
  return value.files[index]!;
}
/** The error with one more sentence; the server's text that may end the message has no final stop of its own. */
export function withSentence(error: CliError, sentence: string): CliError {
  if (sentence === '') return error;
  const message = `${error.message}${/[.!?…]$/.test(error.message) ? '' : '.'} ${sentence}`;
  return error instanceof RemoteError ? new RemoteError(error.code, message, error.remoteCode) : new CliError(error.code, message);
}
interface Sink { write(chunk: Uint8Array): Promise<void>; abandon(): Promise<void>; readonly failure: (received: number, total: number) => string }
class FileSink implements Sink {
  private fd: number | null = null;
  private readonly interrupted = (signal: NodeJS.Signals): void => { this.release(); try { unlinkSync(this.partial); } catch { /* Not created or already gone. */ } process.kill(process.pid, signal); };
  private constructor(private readonly target: string, private readonly partial: string) {}
  /** The signal handlers are installed before the partial file is created, and both happen in one synchronous step: a signal
    * before it takes its default action while no file exists; any later one runs `interrupted`, which removes the file. */
  static create(target: string): FileSink {
    const sink = new FileSink(target, join(dirname(target), `.${basename(target)}.${randomUUID()}.partial`));
    for (const signal of INTERRUPTS) process.once(signal, sink.interrupted);
    try { sink.fd = openSync(sink.partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch { sink.release(); throw new CliError('state', `Cannot create the partial file ${sink.partial}; nothing was written.`); }
    return sink;
  }
  readonly failure = (received: number, total: number): string => `${received} of ${total} bytes were received; the partial file was removed.`;
  async write(chunk: Uint8Array): Promise<void> {
    const fd = this.fd!;
    for (let at = 0; at < chunk.length;) at += await new Promise<number>((done, reject) => { write(fd, chunk, at, chunk.length - at, null, (error, written) => { if (error === null) done(written); else reject(error); }); });
  }
  private release(): void { for (const signal of INTERRUPTS) process.removeListener(signal, this.interrupted); }
  private async closed(): Promise<void> { const fd = this.fd; this.fd = null; if (fd !== null) await new Promise<void>((done, reject) => { close(fd, error => { if (error === null) done(); else reject(error); }); }); }
  async abandon(): Promise<void> {
    await this.closed().catch(() => {}); this.release();
    try { unlinkSync(this.partial); } catch { /* Already gone. */ }
  }
  /** The verified bytes become `target` without replacing anything: fsync, link (fails if `target` exists), unlink, directory fsync.
    * The signal handlers stay until the link, so an interruption before it still removes the partial file. */
  async commit(): Promise<void> {
    try { const fd = this.fd!; await new Promise<void>((done, reject) => { fsync(fd, error => { if (error === null) done(); else reject(error); }); }); await this.closed(); linkSync(this.partial, this.target); }
    catch (error) {
      await this.abandon();
      throw new CliError('state', isObject(error) && error['code'] === 'EEXIST' ? `${this.target} appeared during the download and was not replaced; the partial file was removed.` : `Cannot save ${this.target}; the partial file was removed.`);
    }
    this.release();
    try { unlinkSync(this.partial); const directory = openSync(dirname(this.target), constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(directory); } finally { closeSync(directory); } }
    catch { throw new CliError('state', `${this.target} was saved complete, but ${this.partial} could not be removed or the directory not synced.`); }
  }
}
class StdoutSink implements Sink {
  constructor() { process.stdout.on('error', () => { /* Reported by the write callback. */ }); }
  readonly failure = (received: number, total: number): string => `${received} of ${total} bytes were written to stdout: discard them.`;
  write(chunk: Uint8Array): Promise<void> {
    return new Promise((done, reject) => { process.stdout.write(chunk, error => { if (error === null || error === undefined) done(); else reject(new CliError('state', 'Stdout was closed during the download.')); }); });
  }
  async abandon(): Promise<void> {}
}
/** A 503 with a Retry-After in seconds: the range may be requested again after them. */
class Busy extends RemoteError { constructor(error: RemoteError, readonly seconds: number) { super(error.code, error.message, error.remoteCode); } }
/** `work`, or the signal's reason once it aborts: a sink that stops taking bytes (a stdout consumer that keeps the pipe open
  * but stops reading) cannot hold a range beyond its deadline. */
function within<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((done, reject) => {
    const aborted = (): void => { reject(signal.reason as Error); };
    signal.addEventListener('abort', aborted, { once: true });
    work.then(value => { signal.removeEventListener('abort', aborted); done(value); }, (error: unknown) => { signal.removeEventListener('abort', aborted); reject(error as Error); });
  });
}
/** One range request: its bytes go to `digest` and `sink` as they arrive; it must answer 206 with exactly the range and ETag. */
async function range(http: Http, session: Session, path: string, first: number, last: number, total: number, etag: string, timeoutMs: number, digest: Hash, sink: Sink, received: { bytes: number }, collect: Collect): Promise<void> {
  const requested = `${first}-${last}`; const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try { response = await fetch(`${http.origin}${path}`, { headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', Origin: http.origin, Cookie: `chronicle_session=${session.cookie}`, Range: `bytes=${requested}`, 'If-Range': etag }, redirect: 'manual', signal }); }
  catch (error) { throw transportFailure(error, requested, timeoutMs, false); }
  if (response.status !== 206) throw await rejection(response, path, session, requested);
  const length = last - first + 1;
  if (response.headers.get('content-range') !== `bytes ${requested}/${total}` || response.headers.get('etag') !== etag || response.headers.get('content-length') !== String(length) || response.body === null) {
    await response.body?.cancel().catch(() => {}); throw new CliError('protocol-error', `The answer to range ${requested} does not carry exactly that range of the manifest's file (Content-Range, ETag, Content-Length).`);
  }
  const reader = response.body.getReader(); let read = 0; let uncollected = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      read += chunk.value.length; if (read > length) throw new CliError('protocol-error', `The answer to range ${requested} carries more bytes than the range.`);
      digest.update(chunk.value); await within(sink.write(chunk.value), signal); received.bytes += chunk.value.length;
      uncollected += chunk.value.length; if (uncollected >= RAW_COLLECT_BYTES) { uncollected = 0; collect({ type: 'minor' }); }
    }
  } catch (error) { throw error instanceof CliError ? error : transportFailure(error, requested, timeoutMs, true); }
  finally { await reader.cancel().catch(() => {}); }
  if (read !== length) throw new CliError('unavailable', ENDED_EARLY);
}
/** A body that ends before its Content-Length is the server's failure signal after the first byte (it never sends other bytes). */
const ENDED_EARLY = 'The server ended the download early (lost access, a purge or a server failure).';
function transportFailure(error: unknown, requested: string, timeoutMs: number, answered: boolean): CliError {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return new CliError('deadline', `Range ${requested} was not received and written within --timeout-ms (${timeoutMs} ms per range request).`);
  return new CliError('unavailable', answered ? ENDED_EARLY : 'Transport failed; no credential or remote diagnostic was printed.');
}
async function rejection(response: Response, path: string, session: Session, requested: string): Promise<CliError> {
  const discarded = async (error: CliError): Promise<CliError> => { await response.body?.cancel().catch(() => {}); return error; };
  if (response.status >= 300 && response.status < 400) return discarded(new CliError('protocol-error', 'Credential-bearing redirects are not followed.'));
  if (response.status === 200) return discarded(new CliError('protocol-error', `The server answered the whole file instead of range ${requested}: the file no longer has the manifest's ETag.`));
  if (response.status === 416) return discarded(new CliError('protocol-error', `The server found range ${requested} beyond the file: the file is shorter than its manifest.`));
  const mismatch = new CliError('protocol-error', 'HTTP failure does not match the current route-specific fault protocol.');
  const text = JSON_CONTENT_TYPE.test(response.headers.get('content-type') ?? '') ? await failureText(response) : null;
  if (text === null) return discarded(mismatch);
  let fault: { code: string; message: string };
  try { fault = httpFault(path, parseJson(text), response.status); } catch { return mismatch; }
  const failure = remoteFailure(fault.code, { message: fault.message, secrets: [session.cookie] }); const retryAfter = response.headers.get('retry-after');
  return response.status === 503 && failure instanceof RemoteError && retryAfter !== null && /^\d{1,9}$/.test(retryAfter) ? new Busy(failure, Number(retryAfter)) : failure;
}
/** The body of an error answer, at most MAX_BYTES of UTF-8, else null. */
async function failureText(response: Response): Promise<string | null> {
  if (response.body === null) return null;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > MAX_BYTES) return null; chunks.push(chunk.value); } }
  catch { return null; }
  finally { await reader.cancel().catch(() => {}); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)); } catch { return null; }
}
export interface RawResult { sessionId: string; revision: number; file: number; path: string; bytes: string; sha256: string }
/** Spec §1.5: the manifest pins the revision; the file arrives in RAW_RANGE_BYTES range requests (each bounded by
  * `timeoutMs`), hashed incrementally and written as it arrives; a file is saved only complete and verified, and any failure
  * removes its partial file. On stdout the digest can only be checked after the last byte: a mismatch fails after them. */
export async function download(http: Http, session: Session, request: RawDownload, timeoutMs: number, pause: Pause): Promise<RawResult | null> {
  const value = await manifest(http, session, request); const file = selected(value, request.file);
  const total = Number(file.bytes); const etag = `"sha256:${file.sha256}"`; const path = `/api/raw/${request.sessionId}/${value.revision}/${file.index}`;
  const digest = createHash('sha256'); const received = { bytes: 0 }; const collect = collector();
  // Nothing may fail between the creation of the partial file and the scope that removes it on failure.
  const sink = request.output === STDOUT ? new StdoutSink() : FileSink.create(request.output);
  try {
    for (let first = 0; first < total; first += RAW_RANGE_BYTES) {
      const last = Math.min(first + RAW_RANGE_BYTES, total) - 1;
      for (let attempt = 1; ; attempt++) {
        try { await range(http, session, path, first, last, total, etag, timeoutMs, digest, sink, received, collect); break; }
        catch (error) {
          if (!(error instanceof Busy)) throw error;
          if (attempt === RAW_RANGE_ATTEMPTS) throw withSentence(error, `Retry-After: ${error.seconds} s; range ${first}-${last} was requested ${RAW_RANGE_ATTEMPTS} times.`);
          const milliseconds = Math.min(error.seconds * 1000, RAW_RETRY_WAIT_MAX_MS);
          await pause.notify(`chronicle: the server's downloads are all in use (503); range ${first}-${last} again in ${milliseconds / 1000} s (attempt ${attempt + 1} of ${RAW_RANGE_ATTEMPTS})\n`);
          await pause.wait(milliseconds);
        }
      }
    }
    if (received.bytes !== total || digest.digest('hex') !== file.sha256) throw new CliError('protocol-error', "The bytes received do not match the manifest's size and SHA-256.");
  } catch (error) {
    await sink.abandon();
    throw withSentence(error instanceof CliError ? error : new CliError('unavailable', 'The download failed.'), sink.failure(received.bytes, total));
  }
  if (sink instanceof FileSink) await sink.commit(); else return null;
  return { sessionId: value.sessionId, revision: value.revision, file: file.index, path: request.output, bytes: String(total), sha256: file.sha256 };
}
