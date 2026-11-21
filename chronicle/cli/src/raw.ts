import { createHash, randomUUID, type Hash } from 'node:crypto';
import { constants, closeSync, fsyncSync, linkSync, lstatSync, openSync, statSync, unlinkSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
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
const STDOUT = '-';
const SHA256_HEX = /^[0-9a-f]{64}$/;
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
  private closed = false;
  private readonly interrupted = (signal: NodeJS.Signals): void => { this.release(); try { unlinkSync(this.partial); } catch { /* Already gone. */ } process.kill(process.pid, signal); };
  private constructor(private readonly target: string, private readonly partial: string, private readonly handle: FileHandle) { for (const signal of INTERRUPTS) process.once(signal, this.interrupted); }
  static async create(target: string): Promise<FileSink> {
    const partial = join(dirname(target), `.${basename(target)}.${randomUUID()}.partial`);
    try { return new FileSink(target, partial, await open(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)); }
    catch { throw new CliError('state', `Cannot create the partial file ${partial}; nothing was written.`); }
  }
  readonly failure = (received: number, total: number): string => `${received} of ${total} bytes were received; the partial file was removed.`;
  async write(chunk: Uint8Array): Promise<void> {
    for (let at = 0; at < chunk.length;) at += (await this.handle.write(chunk, at, chunk.length - at)).bytesWritten;
  }
  private release(): void { for (const signal of INTERRUPTS) process.removeListener(signal, this.interrupted); }
  async abandon(): Promise<void> {
    this.release(); if (!this.closed) { this.closed = true; await this.handle.close().catch(() => {}); }
    try { unlinkSync(this.partial); } catch { /* Already gone. */ }
  }
  /** The verified bytes become `target` without replacing anything: fsync, link (fails if `target` exists), unlink, directory fsync. */
  async commit(): Promise<void> {
    try { await this.handle.sync(); this.closed = true; await this.handle.close(); linkSync(this.partial, this.target); }
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
function retryAfter(headers: Headers): string { const value = headers.get('retry-after'); return value !== null && /^\d{1,9}$/.test(value) ? `Retry-After: ${value} s (all of the server's downloads are in use); no automatic retry was attempted.` : ''; }
/** One range request: its bytes go to `digest` and `sink` as they arrive; it must answer 206 with exactly the range and ETag. */
async function range(http: Http, session: Session, path: string, first: number, last: number, total: number, etag: string, timeoutMs: number, digest: Hash, sink: Sink, received: { bytes: number }): Promise<void> {
  const requested = `${first}-${last}`;
  let response: Response;
  try { response = await fetch(`${http.origin}${path}`, { headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', Origin: http.origin, Cookie: `chronicle_session=${session.cookie}`, Range: `bytes=${requested}`, 'If-Range': etag }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw transportFailure(error, requested, timeoutMs, false); }
  if (response.status !== 206) throw await rejection(response, path, session, requested);
  const length = last - first + 1;
  if (response.headers.get('content-range') !== `bytes ${requested}/${total}` || response.headers.get('etag') !== etag || response.headers.get('content-length') !== String(length) || response.body === null) {
    await response.body?.cancel().catch(() => {}); throw new CliError('protocol-error', `The answer to range ${requested} does not carry exactly that range of the manifest's file (Content-Range, ETag, Content-Length).`);
  }
  const reader = response.body.getReader(); let read = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      read += chunk.value.length; if (read > length) throw new CliError('protocol-error', `The answer to range ${requested} carries more bytes than the range.`);
      digest.update(chunk.value); await sink.write(chunk.value); received.bytes += chunk.value.length;
    }
  } catch (error) { throw error instanceof CliError ? error : transportFailure(error, requested, timeoutMs, true); }
  finally { await reader.cancel().catch(() => {}); }
  if (read !== length) throw new CliError('unavailable', ENDED_EARLY);
}
/** A body that ends before its Content-Length is the server's failure signal after the first byte (it never sends other bytes). */
const ENDED_EARLY = 'The server ended the download early (lost access, a purge or a server failure).';
function transportFailure(error: unknown, requested: string, timeoutMs: number, answered: boolean): CliError {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return new CliError('deadline', `Range ${requested} was not received within --timeout-ms (${timeoutMs} ms per range request).`);
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
  return withSentence(remoteFailure(fault.code, { message: fault.message, secrets: [session.cookie] }), response.status === 503 ? retryAfter(response.headers) : '');
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
export async function download(http: Http, session: Session, request: RawDownload, timeoutMs: number): Promise<RawResult | null> {
  const value = await manifest(http, session, request); const file = selected(value, request.file);
  const total = Number(file.bytes); const etag = `"sha256:${file.sha256}"`; const path = `/api/raw/${request.sessionId}/${value.revision}/${file.index}`;
  const sink = request.output === STDOUT ? new StdoutSink() : await FileSink.create(request.output);
  const digest = createHash('sha256'); const received = { bytes: 0 };
  try {
    for (let first = 0; first < total; first += RAW_RANGE_BYTES) await range(http, session, path, first, Math.min(first + RAW_RANGE_BYTES, total) - 1, total, etag, timeoutMs, digest, sink, received);
    if (received.bytes !== total || digest.digest('hex') !== file.sha256) throw new CliError('protocol-error', "The bytes received do not match the manifest's size and SHA-256.");
  } catch (error) {
    await sink.abandon();
    throw withSentence(error instanceof CliError ? error : new CliError('unavailable', 'The download failed.'), sink.failure(received.bytes, total));
  }
  if (sink instanceof FileSink) await sink.commit(); else return null;
  return { sessionId: value.sessionId, revision: value.revision, file: file.index, path: request.output, bytes: String(total), sha256: file.sha256 };
}
