// Node tests of the DOM-free account client (shared/account-web/account-client.js); fake fetch, no network, no timers.
// Run: nix develop .#chronicle --command node --test shared/account-web/tests/account-client.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  AccountApiError, AccountOwnerChangedError, AccountResponseError, actionStart, base32Decode, base32Encode,
  captureEnrollmentFragment, createAccountClient, enrollmentLink, generateTotpSecret, indexingControls, loadEnrollment,
  loadSignup, loginInitial, otpauthUri, qrMatrix, recoveryInitial, runAction, submitEnrollment,
  submitLogin, submitRecovery, submitSignup
} from '../account-client.js';

const OWNER = { id: 'alice', login: 'alice', displayName: 'alice', actor: 'actor-alice' };
const POLICY = { signup: true, approval: true, enrollment: true, reset: true, issuer: 'Haystack (memory.example.net)', username: { pattern: '^[a-z][a-z0-9_-]{2,31}$' }, password: { minLength: 12, maxLength: 1024 }, totp: { algorithm: 'SHA1', digits: 6, period: 30, secretBytes: 20 } };
const PROFILE = { user: OWNER, source: 'imperative', admin: true, email: 'alice@example.net', totp: { required: false, state: 'ok' }, manage: { email: true, password: true, totp: true, users: true, enrollment: true, reset: true } };
const SECRET_BYTES = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
const FIXED_CRYPTO = { getRandomValues: array => { array.set(SECRET_BYTES.subarray(0, array.length)); return array; } };
const SECRET = 'AEBAGBAFAYDQQCIKBMGA2DQPCAIREEYU';

const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const failure = (status, code, headers = {}) => reply(status, { error: { code, message: 'sanitized' } }, headers);
// A fake fetch answering from a queue; every request is recorded with its parsed body.
function fakeFetch(...responses) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, method: options.method, actor: options.headers['X-Account-Actor'] ?? null, body: options.body === undefined ? null : JSON.parse(options.body) });
    const next = responses.shift();
    if (next === undefined) throw new Error(`unexpected request ${options.method} ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, client: createAccountClient({ fetch, requestTimeoutMs: 1000, signal: null }) };
}
const recorder = () => { const states = []; return { states, emit: state => states.push(state) }; };
const phases = states => states.map(state => state.phase);

const OWN_INDEXING = { userId: 'alice', admin: false, defaultEnabled: true, allowOptIn: false, allowOptOut: true, enabled: true, choice: 'inherit', override: 'inherit' };
const MANAGED_INDEXING = { userId: 'collector-bot', displayName: 'Collector', defaultEnabled: true, enabled: true, choice: 'inherit', override: 'inherit' };

test('indexing permits only the available direction, and reset clears a choice even without that direction flag', () => {
  const disabled = { ...OWN_INDEXING, choice: 'disabled', enabled: false };
  assert.deepEqual(indexingControls(OWN_INDEXING), { toggle: 'disabled', reset: false });
  assert.deepEqual(indexingControls(disabled), { toggle: null, reset: true });
  assert.deepEqual(indexingControls({ ...disabled, allowOptOut: false }), { toggle: null, reset: true });
  assert.deepEqual(indexingControls({ ...OWN_INDEXING, enabled: false, defaultEnabled: false, allowOptIn: true, allowOptOut: false }), { toggle: 'enabled', reset: false });
  assert.deepEqual(indexingControls({ ...disabled, allowOptIn: true, override: 'enabled', enabled: true }), { toggle: null, reset: false });
});

test('indexing reads validate their independent API shapes, check the owner, and keep legacy 404 distinguishable', async () => {
  const { client, calls } = fakeFetch(reply(200, OWN_INDEXING), reply(200, { users: [MANAGED_INDEXING] }), reply(200, { ...OWN_INDEXING, userId: 'erin' }),
    reply(200, { ...OWN_INDEXING, allowOptOut: 'true' }), reply(200, { users: [{ ...MANAGED_INDEXING, override: 'force-on' }] }), failure(404, 'not-found'));
  assert.deepEqual(await client.indexing('alice'), OWN_INDEXING);
  assert.deepEqual(await client.adminIndexing(), [MANAGED_INDEXING]);
  await assert.rejects(client.indexing('alice'), AccountOwnerChangedError);
  await assert.rejects(client.indexing('alice'), AccountResponseError);
  await assert.rejects(client.adminIndexing(), AccountResponseError);
  await assert.rejects(client.indexing('alice'), error => error instanceof AccountApiError && error.status === 404);
  assert.deepEqual(calls.slice(0, 2), ['/indexing', '/admin/indexing'].map(path => ({ url: `/api/account/v1${path}`, method: 'GET', actor: null, body: null })));
});

test('indexing writes use the supplied fresh actor without /profile, preserve proof failures and reject an owner mismatch', async () => {
  const { client, calls } = fakeFetch(reply(200, { ...OWN_INDEXING, enabled: false, choice: 'disabled' }),
    failure(403, 'proof-rejected'), reply(200, { ok: true }), reply(200, { ...OWN_INDEXING, userId: 'erin' }));
  const run = (name, target, input, actor) => runAction(client, actionStart(name, target), OWNER.id, input, () => {}, actor);
  await assert.rejects(client.setIndexing(OWNER.id, undefined, { choice: 'disabled' }), AccountResponseError);
  assert.equal((await run('set-indexing', null, { choice: 'disabled', currentPassword: 'ignored' }, 'fresh-alice')).phase, 'done');
  const rejected = await run('set-indexing-override', 'collector-bot', { override: 'enabled', currentPassword: 'wrong' }, 'fresh-alice');
  assert.equal(rejected.phase, 'proof');
  assert.equal(rejected.error.code, 'proof-rejected');
  assert.equal((await run('set-indexing-override', 'collector-bot', { override: 'inherit', currentPassword: 'correct' }, 'fresh-alice')).phase, 'done');
  assert.equal((await run('set-indexing', null, { choice: 'inherit' }, 'fresh-alice')).phase, 'owner-changed');
  assert.deepEqual(calls.map(({ url, method, actor, body }) => [url, method, actor, body]), [
    ['/indexing', { choice: 'disabled' }], ['/admin/indexing', { userId: 'collector-bot', override: 'enabled', currentPassword: 'wrong' }],
    ['/admin/indexing', { userId: 'collector-bot', override: 'inherit', currentPassword: 'correct' }], ['/indexing', { choice: 'inherit' }]
  ].map(([path, body]) => [`/api/account/v1${path}`, 'POST', 'fresh-alice', body]));
});

test('base32 matches the RFC 4648 vectors without padding and rejects non-canonical text', () => {
  const vectors = [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']];
  for (const [plain, encoded] of vectors) {
    const bytes = new TextEncoder().encode(plain);
    assert.equal(base32Encode(bytes), encoded);
    assert.deepEqual(base32Decode(encoded), bytes);
  }
  for (const bad of ['MY======', 'my', 'M', 'MZ', '1', 'MZXW6YTBO']) assert.throws(() => base32Decode(bad), bad);
});

test('TOTP secret generation uses 20 injected random bytes in a 32-character base32 form', () => {
  const secret = generateTotpSecret(FIXED_CRYPTO);
  assert.equal(secret, SECRET);
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.deepEqual(base32Decode(secret), SECRET_BYTES);
});

test('otpauth URI follows the design format and escapes issuer and username', () => {
  assert.equal(otpauthUri({ issuer: 'Haystack (memory.example.net)', username: 'alice', secret: SECRET }),
    `otpauth://totp/Haystack%20%28memory.example.net%29:alice?secret=${SECRET}&issuer=Haystack%20%28memory.example.net%29&algorithm=SHA1&digits=6&period=30`);
  assert.equal(otpauthUri({ issuer: 'A&B: ü/#', username: 'a?b', secret: SECRET }),
    `otpauth://totp/A%26B%3A%20%C3%BC%2F%23:a%3Fb?secret=${SECRET}&issuer=A%26B%3A%20%C3%BC%2F%23&algorithm=SHA1&digits=6&period=30`);
  assert.throws(() => otpauthUri({ issuer: 'x', username: 'y', secret: 'MZXW6YTB' }));
});

// References were produced by libqrencode 4.1.1 (independent implementation, GPL; used only to generate data):
//   printf %s "$payload" | qrencode -8 -l M -m 0 -t ASCII -o -      (ASCII: two characters per module)
// and reduced to SHA-256 over rows of '1'/'0' joined by '\n'; the version 1 matrix is kept in full for inspection.
// The same encoder was also swept against qrencode over 746 payloads of all 40 versions and decoded with
// zxing-cpp 3.1.1 (see the unit report); only the fixed cases below are kept as tests.
const QR_V1_HELLO = [
  '111111100110001111111', '100000100110001000001', '101110100100101011101', '101110100011001011101', '101110100110101011101', '100000101001101000001',
  '111111101010101111111', '000000000001100000000', '100101101100010100000', '001011000010001000011', '000110111100110001101', '111011001001000001011',
  '011010110010101010000', '000000001101000110101', '111111100010010101110', '100000101011110110000', '101110100001001110001', '101110101101000101111',
  '101110100110100010101', '100000100110011000000', '111111101111100101010'
];
const sha256 = text => createHash('sha256').update(text).digest('hex');
const matrixText = matrix => matrix.map(row => row.map(module => (module ? '1' : '0')).join('')).join('\n');
const LONGEST_USERNAME = 'abcdefghijklmnopqrstuvwxyz012345';
const QR_REFERENCES = [
  { name: 'version 3: a payload whose mask choice depends on libqrencode\'s rounded dark-module balance', payload: 'uWvX.EglR"GQPFUr/YZc`749*PqdX2L]R\'^A`,C', bytes: 39, size: 29, sha256: '5cd15afb8b0c948aae6967bb9f05c6face1ac575b8beb4b1dc6711b2d19ac4e8' },
  { name: 'version 10: default issuer, 32-character username (worst case of design 4.2.1)', payload: otpauthUri({ issuer: 'Haystack (memory.example.net)', username: LONGEST_USERNAME, secret: SECRET }), bytes: 200, size: 57, sha256: '09cf7f2c4602bc36db856d9202706c8f547205c6df7c0158f76aa4d72cf74c64' },
  { name: 'version 13: long configured issuer', payload: otpauthUri({ issuer: 'Haystack: Memory Service (very-long-hostname-for-the-memory.example.net)', username: LONGEST_USERNAME, secret: SECRET }), bytes: 298, size: 69, sha256: '0b6cc1a727a7e28fa73c610f0298368c7a2bb42bc14892fd67f66e418c0d80e5' }
];

test('QR matrices equal the libqrencode 4.1.1 output (byte mode, level M; versions 1, 3, 10 and 13)', () => {
  assert.equal(matrixText(qrMatrix('hello')), QR_V1_HELLO.join('\n'));
  for (const { name, payload, bytes, size, sha256: digest } of QR_REFERENCES) {
    const matrix = qrMatrix(payload);
    assert.equal(new TextEncoder().encode(payload).length, bytes, name);
    assert.equal(matrix.length, size, name);
    assert.equal(sha256(matrixText(matrix)), digest, name);
  }
  assert.throws(() => qrMatrix('x'.repeat(2332)));
});

test('login: password step, then second factor, holds credentials only in memory states', async () => {
  const { calls, client } = fakeFetch(failure(401, 'totp-required'), failure(401, 'unauthorized'), failure(429, 'rate-limited', { 'Retry-After': '90' }), reply(200, { user: OWNER }));
  const { states, emit } = recorder();
  let state = await submitLogin(client, loginInitial(), { login: 'alice', password: 'correct horse battery' }, emit);
  assert.deepEqual(state, { phase: 'second-factor', credentials: { login: 'alice', password: 'correct horse battery' }, error: null });
  state = await submitLogin(client, state, { totp: '000000' }, emit);
  assert.deepEqual([state.phase, state.error], ['second-factor', { code: 'rejected', retryAfter: null }]);
  state = await submitLogin(client, state, { totp: '111111' }, emit);
  assert.deepEqual(state.error, { code: 'rate-limited', retryAfter: 90 });
  state = await submitLogin(client, state, { totp: '222222' }, emit);
  assert.deepEqual(state, { phase: 'done', user: OWNER });
  assert.deepEqual(calls.map(call => call.body), [
    { login: 'alice', password: 'correct horse battery' },
    { login: 'alice', password: 'correct horse battery', totp: '000000' },
    { login: 'alice', password: 'correct horse battery', totp: '111111' },
    { login: 'alice', password: 'correct horse battery', totp: '222222' }
  ]);
  assert.ok(calls.every(call => call.url === '/api/account/v1/login' && call.method === 'POST' && call.actor === null));
  assert.deepEqual(phases(states), ['submitting', 'second-factor', 'submitting', 'second-factor', 'submitting', 'second-factor', 'submitting', 'done']);
});

test('login: a correct password of a pending account yields pending-approval without a session', async () => {
  const { client } = fakeFetch(failure(403, 'pending-approval'));
  const state = await submitLogin(client, loginInitial(), { login: 'bob', password: 'correct horse battery' }, () => {});
  assert.deepEqual(state, { phase: 'pending-approval' });
});

test('signup: approval mode ends in pending-approval without a user (202) and keeps the secret meanwhile', async () => {
  const { calls, client } = fakeFetch(reply(200, POLICY), reply(202, { status: 'pending' }));
  const { states, emit } = recorder();
  let state = await loadSignup(client, FIXED_CRYPTO, emit);
  assert.deepEqual([state.phase, state.secret, state.policy.approval], ['form', SECRET, true]);
  const values = { username: 'bob', email: 'bob@example.net', password: 'correct horse battery', totpCode: '123456', requireTotp: false };
  state = await submitSignup(client, state, values, emit);
  assert.deepEqual(state, { phase: 'pending-approval' });
  assert.deepEqual(phases(states), ['loading-policy', 'form', 'submitting', 'pending-approval']);
  assert.deepEqual(calls.map(call => [call.method, call.url, call.body]), [
    ['GET', '/api/account/v1/policy', null],
    ['POST', '/api/account/v1/signup', { username: 'bob', email: 'bob@example.net', password: 'correct horse battery', totpSecret: SECRET, totpCode: '123456', requireTotp: false }]
  ]);
  for (const stored of states) assert.ok(!JSON.stringify(stored).includes('correct horse'));
});

test('signup: field errors keep the form and secret; 403 closes; a contradictory body is unavailable', async () => {
  const values = { username: 'bob', email: 'bob@example.net', password: 'correct horse battery', totpCode: '123456', requireTotp: true };
  const { client } = fakeFetch(reply(200, POLICY), failure(409, 'username-unavailable'), failure(400, 'weak-password'), failure(400, 'totp-mismatch'), failure(429, 'rate-limited', { 'Retry-After': '30' }),
    reply(200, { status: 'pending' }), failure(403, 'forbidden'));
  let state = await loadSignup(client, FIXED_CRYPTO, () => {});
  const codes = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    state = await submitSignup(client, state, values, () => {});
    assert.equal(state.phase, 'form');
    assert.equal(state.secret, SECRET);
    codes.push(state.error);
  }
  assert.deepEqual(codes, [
    { code: 'username-unavailable', retryAfter: null }, { code: 'weak-password', retryAfter: null }, { code: 'totp-mismatch', retryAfter: null },
    { code: 'rate-limited', retryAfter: 30 }, { code: 'unavailable', retryAfter: null }
  ]);
  assert.equal((await submitSignup(client, state, values, () => {})).phase, 'closed');
});

test('enrollment: invalid link on 404; invitation redeem sends the e-mail, a reset omits it; fragment is captured once', async () => {
  const gone = fakeFetch(failure(404, 'not-found'));
  assert.equal((await loadEnrollment(gone.client, FIXED_CRYPTO, 'stale-code', () => {})).phase, 'invalid-link');

  const expiresAt = '2026-11-18T00:00:00Z';
  const redeem = fakeFetch(reply(200, { username: 'carol', kind: 'invite', expiresAt }), reply(200, { user: OWNER }), reply(200, { username: 'carol', kind: 'reset', expiresAt }), reply(200, { user: OWNER }));
  let state = await loadEnrollment(redeem.client, FIXED_CRYPTO, 'the-code', () => {});
  assert.deepEqual([state.phase, state.username, state.kind, state.secret], ['form', 'carol', 'invite', SECRET]);
  await assert.rejects(submitEnrollment(redeem.client, state, { email: null, password: 'correct horse battery', totpCode: '123456', requireTotp: false }, () => {}));
  assert.equal((await submitEnrollment(redeem.client, state, { email: 'c@example.net', password: 'correct horse battery', totpCode: '123456', requireTotp: false }, () => {})).phase, 'done');
  state = await loadEnrollment(redeem.client, FIXED_CRYPTO, 'the-code', () => {});
  await submitEnrollment(redeem.client, state, { email: null, password: 'correct horse battery', totpCode: '123456', requireTotp: true }, () => {});
  assert.deepEqual(redeem.calls.filter(call => call.url.endsWith('/redeem')).map(call => call.body), [
    { code: 'the-code', password: 'correct horse battery', totpSecret: SECRET, totpCode: '123456', requireTotp: false, email: 'c@example.net' },
    { code: 'the-code', password: 'correct horse battery', totpSecret: SECRET, totpCode: '123456', requireTotp: true }
  ]);

  const replaced = [];
  const location = { hash: '#account-enroll=abc_DEF-123', pathname: '/app/', search: '?x=1' };
  assert.equal(captureEnrollmentFragment({ location, history: { replaceState: (...args) => replaced.push(args) } }), 'abc_DEF-123');
  assert.deepEqual(replaced, [[null, '', '/app/?x=1']]);
  assert.equal(captureEnrollmentFragment({ location: { ...location, hash: '#/browse' }, history: { replaceState: () => assert.fail('must not rewrite') } }), null);
  assert.equal(enrollmentLink('https://h.example.net', 'abc'), 'https://h.example.net/#account-enroll=abc');
});

test('recovery: any rejection is one generic state; weak password, rate limit and success are distinct', async () => {
  const { calls, client } = fakeFetch(failure(401, 'unauthorized'), failure(400, 'weak-password'), failure(429, 'rate-limited', { 'Retry-After': '900' }), reply(200, { user: OWNER }));
  const values = { username: 'alice', totp: '123456', password: 'correct horse battery' };
  const errors = [];
  let state = recoveryInitial();
  for (let attempt = 0; attempt < 3; attempt++) { state = await submitRecovery(client, state, values, () => {}); errors.push(state.error); }
  assert.deepEqual(errors, [{ code: 'rejected', retryAfter: null }, { code: 'weak-password', retryAfter: null }, { code: 'rate-limited', retryAfter: 900 }]);
  assert.deepEqual(await submitRecovery(client, state, values, () => {}), { phase: 'done', user: OWNER });
  assert.ok(calls.every(call => call.url === '/api/account/v1/recover' && call.body.username === 'alice'));
});

test('require-TOTP toggle: confirm, fresh profile read supplies the actor, owner change stops before the POST', async () => {
  const { calls, client } = fakeFetch(reply(200, PROFILE), reply(200, { ok: true }), reply(200, { ...PROFILE, user: { ...OWNER, id: 'mallory', actor: 'actor-mallory' } }));
  const { states, emit } = recorder();
  const start = actionStart('set-totp-required', null);
  assert.equal(start.phase, 'confirm');
  const done = await runAction(client, start, 'alice', { required: true, totp: '123456' }, emit);
  assert.deepEqual(done, { phase: 'done', action: 'set-totp-required', target: null, result: { ok: true } });
  assert.deepEqual(calls.map(call => [call.method, call.url, call.actor, call.body]), [
    ['GET', '/api/account/v1/profile', null, null],
    ['POST', '/api/account/v1/profile/totp-required', 'actor-alice', { required: true, totp: '123456' }]
  ]);
  assert.deepEqual(phases(states), ['saving', 'done']);
  assert.deepEqual(await runAction(client, start, 'alice', { required: true, totp: '123456' }, () => {}), { phase: 'owner-changed' });
  assert.equal(calls.length, 3);
});

test('admin list: approve reports a claimed name, reject deletes, both use the fresh actor', async () => {
  const { calls, client } = fakeFetch(reply(200, PROFILE), failure(409, 'username-unavailable'), reply(200, PROFILE), reply(200, { ok: true }));
  const approve = await runAction(client, actionStart('approve-user', 'bob'), 'alice', null, () => {});
  assert.deepEqual(approve, { phase: 'confirm', action: 'approve-user', target: 'bob', error: { code: 'username-unavailable', retryAfter: null } });
  const reject = await runAction(client, actionStart('reject-user', 'bob'), 'alice', null, () => {});
  assert.equal(reject.phase, 'done');
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => [call.url, call.actor, call.body]), [
    ['/api/account/v1/admin/users/bob/approve', 'actor-alice', {}],
    ['/api/account/v1/admin/users/bob/reject', 'actor-alice', {}]
  ]);
});

test('admin flag change and reset prompt for the current password, which is never kept in a state', async () => {
  const enrollment = { id: 'enrollment-1', username: 'bob', kind: 'reset', createdBy: 'alice', createdAt: '2026-11-17T00:00:00Z', expiresAt: '2026-11-18T00:00:00Z' };
  const { calls, client } = fakeFetch(reply(200, PROFILE), failure(403, 'proof-rejected'), reply(200, PROFILE), failure(429, 'rate-limited', { 'Retry-After': '60' }), reply(200, PROFILE), reply(200, { enrollment, code: 'the-code' }));
  const { states, emit } = recorder();
  let state = actionStart('set-user-admin', 'bob');
  assert.equal(state.phase, 'proof');
  state = await runAction(client, state, 'alice', { admin: true, currentPassword: 'wrong password!' }, emit);
  assert.deepEqual(state, { phase: 'proof', action: 'set-user-admin', target: 'bob', error: { code: 'proof-rejected', retryAfter: null } });
  state = await runAction(client, state, 'alice', { admin: true, currentPassword: 'wrong password!' }, emit);
  assert.deepEqual(state.error, { code: 'rate-limited', retryAfter: 60 });
  const reset = await runAction(client, actionStart('reset-user', 'bob'), 'alice', { currentPassword: 'right password!!' }, emit);
  assert.deepEqual(reset.result, { enrollment, code: 'the-code' });
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => [call.url, call.body]), [
    ['/api/account/v1/admin/users/bob/admin', { admin: true, currentPassword: 'wrong password!' }],
    ['/api/account/v1/admin/users/bob/admin', { admin: true, currentPassword: 'wrong password!' }],
    ['/api/account/v1/admin/users/bob/reset', { currentPassword: 'right password!!' }]
  ]);
  for (const stored of states) assert.ok(!JSON.stringify(stored).includes('password!'));
});
