/** Why a request failed, as a bounded class taken from local error names and codes only — never response text, URLs
 * or tokens: `timeout:<ms>`, `connection-reset`, `connection-refused`, `network:<CODE>` or `network`. */
export function requestFailure(error: unknown, timeoutMs: number): string {
  if (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'TimeoutError') return `timeout:${timeoutMs}`;
  const cause = typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined;
  const code = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') return 'connection-reset';
  if (code === 'ECONNREFUSED') return 'connection-refused';
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? `network:${code}` : 'network';
}
/** fetch, sent once more on a new connection when the pooled connection closed under the request before any answer:
 * a server closes an idle keep-alive connection just as a request leaves, and fetch never resends a POST itself. Only
 * for requests the server answers idempotently (progress reports by sequence, uploads by request id and ordinal).
 * `init` is called per attempt, so that each has its own timeout signal. */
export async function fetchResending(url: URL, init: () => RequestInit, timeoutMs: number): Promise<{ response: Response; resent: boolean }> {
  try { return { response: await fetch(url, init()), resent: false }; }
  catch (error) { if (requestFailure(error, timeoutMs) !== 'connection-reset') throw error; }
  return { response: await fetch(url, init()), resent: true };
}
