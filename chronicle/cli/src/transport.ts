import { randomUUID } from 'node:crypto';
import { ClientEnvelope } from '../../generated/typescript/chronicle/api/ClientEnvelope.js';
import { Operation_Hello, Operation_Pong, Operation_StartMcpTest, Operation_CancelMcpTest, Operation_ReadMcpTest, type Operation } from '../../generated/typescript/chronicle/api/Operation.js';
import { Result_Error, Result_Hello, Result_Ping, Result_McpTestRun, type Result } from '../../generated/typescript/chronicle/api/Result.js';
import { CliError, RemoteError, remoteFailure, uncertain } from './errors.js';
import { MAX_BYTES, type Session } from './files.js';
import { isObject, parseJson, type Json } from './json.js';
import { decodeWire, encodeWire, schema, sameUuid, validateResponse } from './wire.js';
export function origin(raw: string | null, allowHttp: boolean): string {
  if (raw === null || raw === '') throw new CliError('usage', 'Set --url or CHRONICLE_URL to the exact service origin.');
  let url: URL; try { url = new URL(raw); } catch { throw new CliError('usage', 'URL must be an exact HTTPS origin.'); }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowHttp)) || raw.replace(/\/$/, '') !== url.origin) throw new CliError('usage', 'URL must be a canonical HTTPS origin, without credentials/path/query. HTTP requires --allow-insecure-http.');
  return url.origin;
}
export class Deadline {
  private readonly expires: number;
  constructor(milliseconds: number) { this.expires = performance.now() + milliseconds; }
  remaining(): number { const n = Math.ceil(this.expires - performance.now()); if (n <= 0) throw new CliError('deadline', 'Command deadline exceeded.'); return n; }
}
export interface HttpReply { data: Json; headers: Headers }
interface HttpFault { readonly code: string; readonly definitive: boolean }
const HTTP_FAULT_STATUSES: Readonly<Record<string, readonly number[]>> = {
  invalid: [400], unauthorized: [401], forbidden: [403], 'not-found': [404], conflict: [409], gone: [410], 'too-large': [413], unavailable: [500, 503], 'rate-limited': [400],
};
const ACCOUNT_FAULT_CODES = new Set(['invalid', 'unauthorized', 'forbidden', 'not-found', 'conflict', 'rate-limited', 'too-large', 'unavailable']);
function httpFault(path: string, data: Json, status: number): HttpFault {
  const invalid = (): never => { throw new CliError('protocol-error', 'HTTP failure does not match the current route-specific fault protocol.'); };
  let code: string;
  if (path === '/api/account/v1' || path.startsWith('/api/account/v1/')) {
    if (!isObject(data) || Object.keys(data).join(',') !== 'error') return invalid();
    const failure = data['error'];
    if (!isObject(failure) || Object.keys(failure).sort().join(',') !== 'code,message' || typeof failure['code'] !== 'string' || typeof failure['message'] !== 'string' || !ACCOUNT_FAULT_CODES.has(failure['code'])) return invalid();
    code = failure['code'];
  } else {
    try { code = decodeWire('Failure', data).code; } catch { return invalid(); }
    if (code === 'rate-limited') return invalid();
  }
  if (!Object.hasOwn(HTTP_FAULT_STATUSES, code) || !HTTP_FAULT_STATUSES[code]!.includes(status)) return invalid();
  return { code, definitive: code !== 'unavailable' && code !== 'rate-limited' };
}
export class Http {
  constructor(readonly origin: string, private readonly deadline: Deadline) {}
  async request(path: string, method: 'GET' | 'POST', body: unknown, auth: { token: string } | { session: Session; actor: boolean } | null, mutation: boolean): Promise<HttpReply> {
    const headers: Record<string, string> = { 'Accept': 'application/json, text/event-stream', 'Origin': this.origin };
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    if (auth !== null) { if ('token' in auth) { headers['Authorization'] = `Bearer ${auth.token}`; headers['MCP-Protocol-Version'] = '2025-11-25'; } else { headers['Cookie'] = `chronicle_session=${auth.session.cookie}`; if (auth.actor) headers['X-Account-Actor'] = auth.session.actor; } }
    let sent = false;
    try {
      const text = method === 'POST' ? JSON.stringify(body) : undefined;
      if (text !== undefined && Buffer.byteLength(text) > MAX_BYTES) throw new CliError('too-large', 'Request exceeded 8MiB.');
      const remaining = this.deadline.remaining(); sent = true;
      const response = await fetch(`${this.origin}${path}`, { method, headers, ...(text === undefined ? {} : { body: text }), redirect: 'manual', signal: AbortSignal.timeout(remaining) });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new CliError('protocol-error', 'Credential-bearing redirects are not followed.'); }
      const length = response.headers.get('content-length'); if (length !== null && Number(length) > MAX_BYTES) { await response.body?.cancel(); throw new CliError('too-large', 'Response exceeded 8MiB.'); }
      if (response.body === null) throw new CliError('protocol-error', 'Missing JSON response body.');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > MAX_BYTES) throw new CliError('too-large', 'Response exceeded 8MiB.'); chunks.push(result.value); } } finally { await reader.cancel().catch(() => {}); }
      const contentType = response.headers.get('content-type') ?? ''; if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new CliError('protocol-error', 'Expected a JSON response.');
      const data = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!response.ok) { const failure = httpFault(path, data, response.status); if (mutation && !failure.definitive) throw uncertain(null); throw remoteFailure(failure.code); }
      return { data, headers: response.headers };
    } catch (error) {
      // Only validated route/status rejections are definitive; a fault-shaped body
      // or an availability failure does not establish that a mutation rolled back.
      if (error instanceof RemoteError) throw error;
      if (sent && mutation) throw uncertain(null);
      if (error instanceof CliError) throw error;
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new CliError('deadline', 'Command deadline exceeded.');
      throw new CliError('unavailable', 'Transport failed; no credential or remote diagnostic was printed.');
    }
  }
}
export async function websocket(origin: string, session: Session, operation: Operation, requestId: string, mutation: boolean, deadline: Deadline): Promise<Result> {
  if (session.origin !== origin) throw new CliError('credentials', 'Session belongs to a different origin.');
  const helloId = randomUUID();
  return new Promise<Result>((resolve, reject) => {
    // Node24's WebSocketInit supports headers and uses redirect:error. Native receive
    // limits are 128MiB/131072 fragments; decoded application messages are bounded below.
    const socket = new (WebSocket as unknown as typeof import('undici-types').WebSocket)(`${origin.replace(/^http/, 'ws')}/api/ws`, { headers: { Origin: origin, Cookie: `chronicle_session=${session.cookie}` } });
    let sent = false; let finished = false; let negotiated = false;
    let activeId = requestId; let activeOperation = operation; let poll: NodeJS.Timeout | null = null;
    const events: import('../../generated/typescript/chronicle/api/McpTestEvent.js').McpTestEvent[] = []; let eventBytes = 0; let sequence = 0n;

    const finish = (result: Result | null, error: CliError | null): void => {
      if (finished) return; finished = true; clearTimeout(timer); if (poll !== null) clearTimeout(poll); socket.close();
      if (error !== null) reject(error); else if (result !== null) resolve(result); else reject(new CliError('protocol-error', 'Missing application result.'));
    };
    const failure = (error: CliError): void => {
      if (sent && operation instanceof Operation_StartMcpTest) { finish(null, new CliError('uncertain', `MCP test result incomplete; connection closure cancels and erases its trace. Original provider execution is unknown. instanceId=${operation.instanceId} runId=${operation.runId}; inspect ReadMcpTest explicitly, never restart blindly.`)); return; }
      if (sent && operation instanceof Operation_CancelMcpTest) { finish(null, new CliError('uncertain', `MCP cancellation acknowledgement lost. Inspect ReadMcpTest with instanceId=${operation.instanceId} runId=${operation.runId}; this operation has no durable request-ID receipt.`)); return; }
      finish(null, sent && mutation ? uncertain(requestId) : error);
    };
    const timer = setTimeout(() => failure(new CliError('deadline', 'Command deadline exceeded.')), deadline.remaining());
    const send = (id: string, op: Operation): void => { const text = JSON.stringify(encodeWire('ClientEnvelope', new ClientEnvelope(id, op))); if (Buffer.byteLength(text) > 65536) throw new CliError('too-large', 'WS request exceeded 64KiB.'); socket.send(text); };
    socket.onopen = () => { try { send(helloId, new Operation_Hello([schema.version])); } catch { failure(new CliError('protocol-error', 'Unable to send protocol negotiation.')); } };
    socket.onmessage = event => {
      if (finished) return;
      try {
        if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > MAX_BYTES) throw new CliError('protocol-error', 'Expected a bounded text frame.');
        const envelope = decodeWire('ServerEnvelope', parseJson(event.data)); const result = envelope.result;
        if (result instanceof Result_Ping) { if (!negotiated) throw new CliError('protocol-error', 'Heartbeat before negotiation.'); send(envelope.requestId, new Operation_Pong(result.nonce)); return; }
        if (sameUuid(envelope.requestId, helloId) && !negotiated) {
          if (result instanceof Result_Error) { finish(null, remoteFailure(result.failure.code)); return; }
          if (!(result instanceof Result_Hello) || result.versions.current !== schema.version || result.versions.minimum !== schema.version || result.versions.supported.length !== 1 || result.versions.supported[0] !== schema.version) throw new CliError('version-mismatch', 'Server requires a different application protocol.');
          if (result.user.id !== session.user.id || result.user.login !== session.user.login) throw new CliError('unauthorized', 'Session owner changed; login again.');
          negotiated = true; send(requestId, operation); sent = true; return;
        }
        if (!negotiated || !sameUuid(envelope.requestId, activeId) || result instanceof Result_Hello) throw new CliError('protocol-error', 'Unexpected or uncorrelated application reply.');
        if (result instanceof Result_Error) {
          const error = remoteFailure(result.failure.code);
          const preAdmissionCodes = operation instanceof Operation_StartMcpTest ? ['invalid', 'version-mismatch', 'mcp-approval-required', 'mcp-active-run', 'conflict']
            : operation instanceof Operation_CancelMcpTest ? ['invalid', 'version-mismatch'] : ['invalid', 'conflict', 'not-found', 'forbidden'];
          const definiteRejection = activeOperation === operation && preAdmissionCodes.includes(result.failure.code);
          if (mutation && !definiteRejection) failure(error); else finish(null, error); return;
        }
        validateResponse(activeOperation, result, activeId);
        if (operation instanceof Operation_StartMcpTest && result instanceof Result_McpTestRun) {
          const snapshot = result.result;
          if (snapshot.state === 'AuthorizationLost') { failure(remoteFailure('unauthorized')); return; }
          if (snapshot.state === 'Cancelled' || snapshot.state === 'Expired') { finish(result, null); return; }
          if (!sameUuid(snapshot.instanceId, operation.instanceId) || !sameUuid(snapshot.runId, operation.runId)) throw new CliError('protocol-error', 'MCP test identity changed.');
          for (const event of snapshot.events) {
            if (event.sequence <= sequence) throw new CliError('protocol-error', 'MCP event sequence did not advance.');
            sequence = event.sequence; events.push(event);
          }
          eventBytes += Buffer.byteLength(JSON.stringify(encodeWire('Result', result)));
          if (events.length > 256 || eventBytes > MAX_BYTES) throw new CliError('too-large', 'MCP trace exceeded the bounded accumulation limit.');
          if (snapshot.lastSequence < sequence || (!snapshot.hasMore && snapshot.lastSequence !== sequence) || (snapshot.events.length === 0 && snapshot.hasMore)) throw new CliError('protocol-error', 'Invalid MCP event cursor.');
          if (snapshot.hasMore || snapshot.state === 'Queued' || snapshot.state === 'Running') {
            poll = setTimeout(() => { if (finished) return; try { activeId = randomUUID(); activeOperation = new Operation_ReadMcpTest(operation.instanceId, operation.runId, sequence, 100); send(activeId, activeOperation); } catch { failure(new CliError('unavailable', 'MCP trace polling failed.')); } }, snapshot.hasMore ? 0 : 250);
            return;
          }
          finish(new Result_McpTestRun(snapshot.with({ events })), null); return;
        }
        finish(result, null);
      } catch (error) { failure(error instanceof CliError ? error : new CliError('protocol-error', 'Server response does not match the current application protocol.')); }
    };
    socket.onerror = () => failure(new CliError('unavailable', 'WebSocket transport failed.'));
    socket.onclose = event => {
      if (finished) return;
      const error = event.code === 4401 ? remoteFailure('unauthorized') : event.code === 4406 ? remoteFailure('version-mismatch') : event.code === 4400 ? remoteFailure('protocol-error') : new CliError('unavailable', 'WebSocket closed before acknowledgement.');
      failure(error);
    };
  });
}
