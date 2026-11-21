import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, rawFileHref, readRawManifest, type RawManifestState } from '../src/raw-download.ts';
const SESSION = '00000000-0000-4000-8000-000000000001', DIGEST = 'a'.repeat(64);
const manifest = (revision: number, files: unknown[]) => ({ sessionId: SESSION, revision, files });
const file = (index: number, bytes: string) => ({ index, path: `part-${index}.jsonl`, sha256: DIGEST, bytes });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function state(answer: () => Response | Promise<Response>, revision = 3): Promise<{ state: RawManifestState; requests: [string, RequestInit][] }> {
  const requests: [string, RequestInit][] = [];
  const result = await readRawManifest(async (url, init) => { requests.push([String(url), init ?? {}]); return answer(); }, SESSION, revision, new AbortController().signal);
  return { state: result, requests };
}
test('the manifest of the viewed revision becomes download links; every failure is a short state', async () => {
  const ready = await state(() => json(200, manifest(3, [file(0, '9223372036854775807'), file(1, '0')])));
  assert.deepEqual(ready.requests.map(([url, init]) => [url, init.method ?? 'GET', init.credentials]), [[`/api/raw/${SESSION}/3`, 'GET', 'same-origin']]);
  assert.equal(ready.state.kind, 'ready');
  if (ready.state.kind === 'ready') assert.deepEqual(ready.state.manifest.files.map(item => [item.index, item.bytes, rawFileHref(SESSION, 3, item.index)]), [[0, 9223372036854775807n, `/api/raw/${SESSION}/3/0`], [1, 0n, `/api/raw/${SESSION}/3/1`]]);
  const expected: [() => Response | Promise<Response>, RawManifestState][] = [
    [() => json(404, { code: 'not-found', message: 'no such session' }), { kind: 'not-found' }],
    // A server without the raw API: 404 without a Failure body.
    [() => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }), { kind: 'unsupported' }],
    [() => json(401, { code: 'unauthorized', message: 'Sign in again' }), { kind: 'failed', message: 'Sign in again' }],
    [() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }), { kind: 'failed', message: 'The server answered HTTP 502' }],
    [() => new Response('<html>Sign in</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), { kind: 'failed', message: 'The server returned an invalid raw manifest: HTTP 200 without JSON' }],
    [() => json(200, manifest(2, [file(0, '1')])), { kind: 'failed', message: 'The server returned an invalid raw manifest: revision 2 instead of 3' }],
    [() => json(200, manifest(3, [file(1, '1')])), { kind: 'failed', message: 'The server returned an invalid raw manifest: file 0 has index 1' }],
    [() => json(200, manifest(3, [file(0, '-1')])), { kind: 'failed', message: 'The server returned an invalid raw manifest: file 0 has size -1' }],
    [() => Promise.reject(new TypeError('Failed to fetch')), { kind: 'failed', message: 'Failed to fetch' }],
  ];
  for (const [answer, outcome] of expected) assert.deepEqual((await state(answer)).state, outcome);
});
test('sizes read in binary units: two decimals below 10, one below 100, whole units above; bytes exact', () => {
  assert.deepEqual([0n, 1023n, 1_047_552n, 2961n, 1_100_000_000n, 4n * 1024n ** 3n + 1n, 9223372036854775807n].map(formatBytes), ['0 B', '1,023 B', '1,023 KiB', '2.89 KiB', '1.02 GiB', '4 GiB', '8 EiB']);
});
