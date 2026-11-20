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
/** fetch on a connection of its own, closed after the answer (`Connection: close`). Every request of the collector to
 * the server goes this way, so no idle keep-alive connection is ever pooled for reuse: the race of a server closing an
 * idle connection just as the next request leaves on it (fetch never resends a POST) cannot occur. A dropped connection
 * stays an ordinary failure. Costs one TCP (and TLS) handshake per request; parts are up to 8 MiB each. */
export function fetchOnNewConnection(url: URL, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers); headers.set('Connection', 'close');
  return fetch(url, { ...init, headers });
}
