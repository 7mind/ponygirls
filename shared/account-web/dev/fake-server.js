// Fake account HTTP v1 for the harness: answers the injected `fetch` of account.js from an in-memory
// fixture. Development and test scaffolding only; never served by a dashboard.
const API = '/api/account/v1';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const FAKE_PASSWORD = 'correct horse battery';
export const FAKE_WRONG_CODE = '000000';
export const FAKE_TAKEN_USERNAME = 'taken';
export const FAKE_ENROLLMENT_CODE = 'Zk3vQ9hT2mXa7LrN5pWcB8sDyE1uG4jH6oKtVfIqRzM';
export const FAKE_TOKEN_SECRET = 'chrpat-Zk3vQ9hT2mXa7LrN5pWcB8sDyE1uG4jH6oKt9f2c';
const MIN_PASSWORD = 12;
const RATE_LIMIT_SECONDS = 840;

const iso = offsetMs => new Date(Date.now() + offsetMs).toISOString();
const tokenId = n => `00000000-0000-4000-8000-${String(300000 + n).padStart(12, '0')}`;

export function baseFixture(app) {
  const scopes = app === 'chronicle' ? ['Ingest', 'Read', 'Raw'] : ['api'];
  const scope = (chronicle, other) => (app === 'chronicle' ? chronicle : other);
  const user = { id: 'alice', login: 'alice', displayName: 'alice', actor: 'actor-alice' };
  const token = (n, name, source, granted, daysAgo, revoked) => ({ id: tokenId(n), name, source, createdAt: source === 'configured' ? null : iso(-daysAgo * DAY_MS), revoked, scopes: granted });
  const managed = (id, fields) => ({ id, login: id, displayName: id, type: 'user', source: 'imperative', status: 'active', admin: false, email: `${id}@example.org`, createdAt: iso(-30 * DAY_MS), createdVia: 'signup', createdBy: null, approvedBy: 'dmitri', totpRequired: true, totpState: 'ok', locked: false, pendingEnrollment: null, ...fields });
  return {
    app, signedIn: true, user, scopes,
    policy: { signup: true, approval: true, enrollment: true, reset: true, issuer: `${app.charAt(0).toUpperCase()}${app.slice(1)} (${app}.example.org)`, username: { pattern: '^[a-z][a-z0-9_-]{2,31}$' }, password: { minLength: MIN_PASSWORD, maxLength: 1024 }, totp: { algorithm: 'SHA1', digits: 6, period: 30, secretBytes: 20 } },
    profile: { user, source: 'imperative', admin: true, email: 'alice@example.org', totp: { required: false, state: 'ok' }, manage: { email: true, password: true, totp: true, users: true, enrollment: true, reset: true } },
    tokens: [
      token(1, 'collector-static', 'configured', scope(['Ingest'], ['api']), 0, false),
      token(2, 'readonly-dashboard-bot', 'configured', scope(['Read'], ['api']), 0, false),
      token(11, 'devbox-collector', 'issued', scope(['Ingest'], ['api']), 64, false),
      token(14, 'ci-collector-02', 'issued', scope(['Ingest'], ['api']), 45, false),
      token(19, 'search-cli', 'issued', scope(['Read', 'Raw'], ['api']), 28, false),
      token(23, 'mcp-agent', 'issued', scope(['Read'], ['api']), 15, false),
      token(7, 'old-laptop', 'issued', scope(['Ingest'], ['api']), 90, true)
    ],
    users: [
      managed('bob', { status: 'pending', createdAt: iso(-0.5 * HOUR_MS), approvedBy: null, totpRequired: false }),
      managed('frank', { status: 'pending', createdAt: iso(-3 * HOUR_MS), approvedBy: null }),
      managed('alice', { admin: true, createdAt: iso(-76 * DAY_MS) }),
      { ...managed('dmitri', {}), source: 'declarative', displayName: 'Dmitri K.', email: null, admin: true, createdAt: null, createdVia: null, approvedBy: null, totpRequired: null, totpState: 'none' },
      managed('erin', { createdVia: 'enrollment', createdBy: 'dmitri', approvedBy: null, createdAt: iso(-36 * DAY_MS) }),
      managed('grace', { locked: true, totpRequired: false, createdAt: iso(-18 * DAY_MS) }),
      managed('heidi', { status: 'disabled', createdAt: iso(-58 * DAY_MS) }),
      managed('ivan', { createdVia: 'enrollment', createdBy: 'alice', pendingEnrollment: 'reset', createdAt: iso(-69 * DAY_MS) }),
      managed('judy', { admin: true, createdAt: iso(-73 * DAY_MS) }),
      { ...managed('collector-bot', {}), source: 'declarative', displayName: 'service account', email: null, createdAt: null, createdVia: null, approvedBy: null, totpRequired: null, totpState: 'none' },
      managed('mallory', { totpRequired: false, createdAt: iso(-14 * DAY_MS) }),
      managed('niaj', { createdAt: iso(-9 * DAY_MS) }),
      managed('olivia', { createdVia: 'enrollment', createdBy: 'dmitri', approvedBy: null, createdAt: iso(-6 * DAY_MS) })
    ],
    enrollments: [
      { id: 'enrollment-0001', username: 'carol', kind: 'invite', createdBy: 'alice', createdAt: iso(-1 * HOUR_MS), expiresAt: iso(23 * HOUR_MS) },
      { id: 'enrollment-0002', username: 'ivan', kind: 'reset', createdBy: 'alice', createdAt: iso(-19 * HOUR_MS), expiresAt: iso(5 * HOUR_MS) }
    ],
    // Behaviour switches used by scenarios: login 'ok' | 'totp' | 'pending' | 'rejected' | 'rate-limited';
    // recover 'ok' | 'rejected' | 'weak' | 'rate-limited'; account 'ok' | 'loading' | 'error' | 'down' (network
    // failure of GET /); mint 'ok' | 'lost'; logout 'ok' | 'fail'.
    // hold: '<METHOD> <path>': matching requests wait in `pending` (oldest first) until release() / releaseAt(i);
    // each reply is computed when it is released (or when it arrives, with snapshot: true). The hold is cleared
    // when the last pending request is released.
    login: 'ok', recover: 'ok', account: 'ok', mint: 'ok', logout: 'ok', hold: null, snapshot: false, pending: [],
    enrollment: { code: FAKE_ENROLLMENT_CODE, username: 'carol', kind: 'invite', expiresAt: iso(23 * HOUR_MS) },
    nextToken: 31
  };
}

const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const failure = (status, code, headers) => json(status, { error: { code, message: 'sanitized' } }, headers);
const ok = () => json(200, { ok: true }, {});
const rateLimited = () => failure(429, 'rate-limited', { 'Retry-After': String(RATE_LIMIT_SECONDS) });

// Returns { fetch, calls }. `onCall` receives every recorded request (the browser checks expose one across reloads).
export function createFakeAccountServer(fixture, onCall) {
  const calls = [];
  const state = fixture;
  const signedIn = () => state.signedIn;
  const actorOk = call => call.actor === state.user.actor;
  const issued = (kind, username) => {
    const enrollment = { id: `enrollment-${String(state.nextToken++).padStart(4, '0')}`, username, kind, createdBy: state.user.id, createdAt: iso(0), expiresAt: iso(DAY_MS) };
    state.enrollments = state.enrollments.filter(entry => entry.username !== username).concat(enrollment);
    return json(200, { enrollment, code: FAKE_ENROLLMENT_CODE }, {});
  };

  function handle(call) {
    const { method, path, body } = call;
    if (path === '/login' && method === 'POST') {
      if (state.login === 'rejected' || body.password !== FAKE_PASSWORD) return failure(401, 'unauthorized', {});
      if (state.login === 'pending') return failure(403, 'pending-approval', {});
      if (state.login === 'rate-limited') return rateLimited();
      if (state.login === 'totp' && body.totp === undefined) return failure(401, 'totp-required', {});
      if (state.login === 'totp' && body.totp === FAKE_WRONG_CODE) return failure(401, 'unauthorized', {});
      return json(200, { user: state.user }, {});
    }
    if (path === '/policy' && method === 'GET') return state.policy === null ? failure(404, 'not-found', {}) : json(200, state.policy, {});
    if (path === '/signup' && method === 'POST') {
      if (state.policy === null || !state.policy.signup) return failure(404, 'not-found', {});
      if (body.username === FAKE_TAKEN_USERNAME) return failure(409, 'username-unavailable', {});
      if (body.password.length < MIN_PASSWORD) return failure(400, 'weak-password', {});
      if (body.totpCode === FAKE_WRONG_CODE) return failure(400, 'totp-mismatch', {});
      return state.policy.approval ? json(202, { status: 'pending' }, {}) : json(200, { status: 'active', user: state.user }, {});
    }
    if (path === '/enrollments/inspect' && method === 'POST') {
      if (state.policy === null || body.code !== state.enrollment.code) return failure(404, 'not-found', {});
      const { username, kind, expiresAt } = state.enrollment;
      return json(200, { username, kind, expiresAt }, {});
    }
    if (path === '/enrollments/redeem' && method === 'POST') {
      if (body.code !== state.enrollment.code) return failure(404, 'not-found', {});
      if (body.totpCode === FAKE_WRONG_CODE) return failure(400, 'totp-mismatch', {});
      return json(200, { user: { ...state.user, id: state.enrollment.username, login: state.enrollment.username } }, {});
    }
    if (path === '/recover' && method === 'POST') {
      if (state.policy === null) return failure(404, 'not-found', {});
      if (state.recover === 'weak') return failure(400, 'weak-password', {});
      if (state.recover === 'rate-limited') return rateLimited();
      if (state.recover === 'rejected' || body.totp === FAKE_WRONG_CODE) return failure(401, 'unauthorized', {});
      return json(200, { user: state.user }, {});
    }
    if (!signedIn()) return failure(401, 'unauthorized', {});
    if (path === '' && method === 'GET') {
      if (state.account === 'loading') return new Promise(() => {});
      if (state.account === 'down') throw new TypeError('Failed to fetch');
      if (state.account === 'error') return failure(500, 'unavailable', {});
      return json(200, { user: state.user, tokens: state.tokens, scopes: state.scopes }, {});
    }
    if (path === '/profile' && method === 'GET') return state.profile === null ? failure(404, 'not-found', {}) : json(200, state.profile, {});
    if (method === 'GET' && path === '/admin/users') return state.profile === null || !state.profile.admin ? failure(404, 'not-found', {}) : json(200, { users: state.users }, {});
    if (method === 'GET' && path === '/admin/enrollments') return state.profile === null ? failure(404, 'not-found', {}) : json(200, { enrollments: state.enrollments }, {});
    if (method !== 'POST') return failure(404, 'not-found', {});
    if (!actorOk(call)) return failure(409, 'conflict', {});
    if (path === '/logout') { if (state.logout === 'fail') return failure(500, 'unavailable', {}); state.signedIn = false; return ok(); }
    if (path === '/tokens') {
      if (state.mint === 'lost') { state.tokens.push({ id: tokenId(state.nextToken++), name: body.name, source: 'issued', createdAt: iso(0), revoked: false, scopes: body.scopes }); throw new TypeError('Failed to fetch'); }
      const token = { id: tokenId(state.nextToken++), name: body.name, source: 'issued', createdAt: iso(0), revoked: false, scopes: body.scopes };
      state.tokens.push(token);
      return json(200, { token, secret: FAKE_TOKEN_SECRET }, {});
    }
    const revoke = /^\/tokens\/([^/]+)\/revoke$/.exec(path);
    if (revoke !== null) { state.tokens.find(token => token.id === decodeURIComponent(revoke[1])).revoked = true; return ok(); }
    if (path === '/profile/email') { state.profile.email = body.email; return ok(); }
    if (path === '/profile/password') return body.currentPassword === FAKE_PASSWORD ? ok() : failure(403, 'proof-rejected', {});
    if (path === '/profile/totp') return body.currentPassword !== FAKE_PASSWORD ? failure(403, 'proof-rejected', {}) : body.totpCode === FAKE_WRONG_CODE ? failure(400, 'totp-mismatch', {}) : ok();
    if (path === '/profile/totp-required') { if (body.totp === FAKE_WRONG_CODE) return failure(403, 'proof-rejected', {}); state.profile.totp.required = body.required; return ok(); }
    if (path === '/admin/enrollments') return body.username === FAKE_TAKEN_USERNAME ? failure(409, 'username-unavailable', {}) : issued('invite', body.username);
    const enrollmentRevoke = /^\/admin\/enrollments\/([^/]+)\/revoke$/.exec(path);
    if (enrollmentRevoke !== null) {
      const revoked = state.enrollments.find(entry => entry.id === decodeURIComponent(enrollmentRevoke[1]));
      if (revoked === undefined) return failure(404, 'not-found', {});
      state.enrollments = state.enrollments.filter(entry => entry !== revoked);
      if (revoked.kind === 'reset') state.users.find(user => user.id === revoked.username).pendingEnrollment = null;
      return ok();
    }
    const admin = /^\/admin\/users\/([^/]+)\/([a-z]+)$/.exec(path);
    if (admin !== null) {
      const id = decodeURIComponent(admin[1]), target = state.users.find(user => user.id === id);
      if (target === undefined) return failure(404, 'not-found', {});
      switch (admin[2]) {
        case 'approve': target.status = 'active'; target.approvedBy = state.user.id; return ok();
        case 'reject': state.users = state.users.filter(user => user !== target); return ok();
        case 'enabled': target.status = body.enabled ? 'active' : 'disabled'; return ok();
        case 'admin': if (body.currentPassword !== FAKE_PASSWORD) return failure(403, 'proof-rejected', {}); target.admin = body.admin; return ok();
        case 'reset': if (body.currentPassword !== FAKE_PASSWORD) return failure(403, 'proof-rejected', {}); target.pendingEnrollment = 'reset'; return issued('reset', id);
        default: return failure(404, 'not-found', {});
      }
    }
    return failure(404, 'not-found', {});
  }

  function releaseAt(index) {
    const [entry] = state.pending.splice(index, 1);
    if (state.pending.length === 0) state.hold = null;
    entry.resolve(entry.early === null ? Promise.resolve().then(() => handle(entry.call)) : entry.early);
  }
  state.releaseAt = releaseAt;
  state.release = () => releaseAt(0);
  async function fetch(resource, options) {
    const url = new URL(String(resource), 'http://harness');
    if (!url.pathname.startsWith(API)) throw new Error(`The account harness only answers ${API}: ${url.pathname}`);
    const call = { method: options.method, path: url.pathname.slice(API.length), body: options.body === undefined ? null : JSON.parse(options.body), actor: options.headers['X-Account-Actor'] ?? null };
    calls.push(call); onCall(call);
    if (state.hold !== null && `${call.method} ${call.path}` === state.hold) {
      const early = state.snapshot ? Promise.resolve().then(() => handle(call)) : null;
      return new Promise(resolve => { state.pending.push({ call, resolve, early }); });
    }
    return handle(call);
  }
  return { fetch, calls, state };
}
