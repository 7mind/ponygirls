// Synthetic Rites API fixture (ABI 0.2.0) for browser tests.
//
// This is NOT the real Rites backend. It implements the documented REST
// contract (paths, methods, cookies, revisions, failure codes, roles) against
// a fully synthetic in-memory dataset so that the compiled web UI can be
// exercised with a real Chromium. No external systems, no real forge, no real
// credentials. Test files drive it in-process through the exported `fixture`
// object (revision bumps, role changes, session drops, status failure modes).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url)); // rites/web
const BROWSER_ROOT = path.join(WEB_ROOT, '..', 'target', 'browser'); // rites/target/browser

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);

function nowIso() {
  return new Date().toISOString();
}

function seedFixture() {
  const alice = { id: 'user-alice', login: 'alice' };
  const bob = { id: 'user-bob', login: 'bob' };
  const carol = { id: 'user-carol', login: 'carol' };
  const models = [
    { id: 'model-polish', provider: 'synthetic', model: 'polish-x', thinkingLevel: 'high' },
    { id: 'model-quick', provider: 'synthetic', model: 'quick-x', thinkingLevel: '' },
  ];
  const oauthClients = [
    { id: 'oauth-client-gitlab-main', forge: 'Gitlab', host: 'gitlab.example', label: 'Operations GitLab client', expiryLeadSeconds: 600 },
  ];
  const aliceCredId = randomUUID();
  const aliceOauthId = randomUUID();
  const bobCredId = randomUUID();
  const credentials = new Map([
    [aliceCredId, {
      id: aliceCredId, name: 'alice-github', forge: 'Github', host: 'github.com',
      revision: 1, createdAt: '2026-11-01T09:00:00Z', updatedAt: '2026-11-01T09:00:00Z',
      owner: 'user-alice', secret: 'seed-alice-secret', mode: 'Token',
      oauthClientId: null, refreshToken: null, expiresAt: null, refreshHealth: null,
    }],
    [aliceOauthId, {
      id: aliceOauthId, name: 'alice-gitlab-oauth', forge: 'Gitlab', host: 'gitlab.example',
      revision: 1, createdAt: '2026-11-01T09:02:00Z', updatedAt: '2026-11-01T09:02:00Z',
      owner: 'user-alice', secret: 'seed-alice-oauth-access', mode: 'Oauth',
      oauthClientId: 'oauth-client-gitlab-main', refreshToken: 'seed-alice-oauth-refresh',
      expiresAt: '2026-12-01T00:00:00Z', refreshHealth: 'Healthy',
    }],
    [bobCredId, {
      id: bobCredId, name: 'bob-gitlab', forge: 'Gitlab', host: 'gitlab.example',
      revision: 1, createdAt: '2026-11-01T09:05:00Z', updatedAt: '2026-11-01T09:05:00Z',
      owner: 'user-bob', secret: 'seed-bob-access', mode: 'Oauth',
      oauthClientId: 'oauth-client-gitlab-main', refreshToken: 'seed-bob-refresh',
      expiresAt: '2026-11-05T00:00:00Z', refreshHealth: 'Uncertain',
    }],
  ]);
  const repositories = new Map([
    ['pony/core', {
      id: 'pony/core', owner: 'user-alice', forge: 'Github', host: 'github.com',
      project: 'pony/core', baseBranch: 'main', credentialId: aliceCredId, revision: 1,
      grants: [
        { userId: 'user-alice', login: 'alice', role: 'Owner' },
        { userId: 'user-bob', login: 'bob', role: 'Editor' },
        { userId: 'user-carol', login: 'carol', role: 'Viewer' },
      ],
    }],
    ['internal/ops', {
      id: 'internal/ops', owner: 'user-bob', forge: 'Gitlab', host: 'gitlab.example',
      project: 'internal/ops', baseBranch: 'trunk', credentialId: bobCredId, revision: 1,
      grants: [
        { userId: 'user-bob', login: 'bob', role: 'Owner' },
        { userId: 'user-alice', login: 'alice', role: 'Editor' },
      ],
    }],
  ]);
  const rites = new Map([
    ['pony/core', [
      { repositoryId: 'pony/core', id: 'nightly-polish', schedule: '0 2 * * *', promptPath: 'prompts/polish.txt', modelId: 'model-polish', enabled: true, revision: 1 },
      { repositoryId: 'pony/core', id: 'weekly-report', schedule: '30 6 * * 1', promptPath: 'prompts/report.txt', modelId: 'model-quick', enabled: false, revision: 1 },
      // Server-provided markup must be rendered as text by the UI.
      { repositoryId: 'pony/core', id: 'xss<img src=x onerror="window.__xss=1">', schedule: '0 3 * * *', promptPath: 'prompts/polish.txt', modelId: 'model-quick', enabled: true, revision: 1 },
    ]],
    ['internal/ops', [
      { repositoryId: 'internal/ops', id: 'ops-check', schedule: '*/15 * * * *', promptPath: 'prompts/ops.txt', modelId: 'model-quick', enabled: true, revision: 1 },
    ]],
  ]);
  const runs = new Map([
    ['pony/core/nightly-polish', [
      {
        id: randomUUID(), repositoryId: 'pony/core', riteId: 'nightly-polish', trigger: 'Schedule',
        scheduledFor: '2026-11-08T02:00:00Z', createdAt: '2026-11-08T02:00:01Z', startedAt: '2026-11-08T02:00:02Z',
        finishedAt: '2026-11-08T02:11:00Z', state: 'Published', failureCode: null,
        baseRevision: '9f2a1c4', promptDigest: 'digest-7b3c', branch: 'rites/nightly-polish-20261108',
        proposalUrl: 'https://github.example/pony/core/pull/9',
      },
      {
        id: randomUUID(), repositoryId: 'pony/core', riteId: 'nightly-polish', trigger: 'Manual',
        scheduledFor: '2026-11-07T15:04:00Z', createdAt: '2026-11-07T15:04:00Z', startedAt: '2026-11-07T15:04:01Z',
        finishedAt: '2026-11-07T15:05:10Z', state: 'Failed', failureCode: 'forge-error',
        baseRevision: '4d8e0aa', promptDigest: 'digest-1f09', branch: null,
        proposalUrl: 'javascript:alert(1)',
      },
      {
        id: randomUUID(), repositoryId: 'pony/core', riteId: 'nightly-polish', trigger: 'Schedule',
        scheduledFor: '2026-11-07T02:00:00Z', createdAt: '2026-11-07T02:00:01Z', startedAt: '2026-11-07T02:00:02Z',
        finishedAt: '2026-11-07T02:08:00Z', state: 'NoChange', failureCode: null,
        baseRevision: '4d8e0aa', promptDigest: 'digest-1f09', branch: null,
        proposalUrl: 'data:text/html,<script>alert(2)</script>',
      },
      {
        id: randomUUID(), repositoryId: 'pony/core', riteId: 'nightly-polish', trigger: 'Schedule',
        scheduledFor: '2026-11-08T02:00:00Z', createdAt: '2026-11-08T02:00:01Z', startedAt: null,
        finishedAt: null, state: 'Queued', failureCode: null,
        baseRevision: null, promptDigest: null, branch: null, proposalUrl: null,
      },
    ]],
  ]);
  return {
    users: [alice, bob, carol],
    passwords: { alice: 'pw-alice', bob: 'pw-bob', carol: 'pw-carol' },
    models,
    oauthClients,
    credentials,
    repositories,
    rites,
    runs,
    sessions: new Map(), // token -> userId
    runIdempotency: new Map(), // requestId -> run
    calls: [],
    runRequests: [],
    dropRunResponses: 0,
    statusMode: 'ok',
    runDelayMs: 0,
    holds: [], // { fragment, promise, release }
    contractViolations: [], // UI-side contract breaches observed on mutations
    identityMismatches: [], // refused mutations where X-Rites-User != cookie user
  };
}

const db = seedFixture();

// Direct in-process controls for tests (never exposed over HTTP).
export const fixture = {
  reset() {
    Object.assign(db, seedFixture());
  },
  bumpCredential(id) {
    const cred = db.credentials.get(id);
    if (cred) { cred.revision += 1; cred.updatedAt = nowIso(); }
  },
  bumpRepository(id) {
    const repo = db.repositories.get(id);
    if (repo) repo.revision += 1;
  },
  bumpRite(repositoryId, riteId) {
    const list = db.rites.get(repositoryId);
    const rite = list?.find(r => r.id === riteId);
    if (rite) rite.revision += 1;
  },
  dropSession(userId) {
    for (const [token, uid] of Array.from(db.sessions)) {
      if (uid === userId) db.sessions.delete(token);
    }
  },
  dropNextRunResponses(n) {
    db.dropRunResponses = n;
  },
  // Holds every request whose path contains `fragment` until releaseHeld().
  holdNext(fragment) {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    db.holds.push({ fragment, promise, release });
  },
  releaseHeld() {
    for (const hold of db.holds.splice(0)) hold.release();
  },
  // Transfers repository ownership server-side without a revision bump, so a
  // stale owner's UI can be refused by the backend mid-flight.
  setOwner(repositoryId, userId) {
    const repo = db.repositories.get(repositoryId);
    if (!repo) throw new Error('no such repo');
    const oldOwnerId = repo.owner;
    repo.owner = userId;
    repo.grants = repo.grants.filter(g => g.userId !== userId);
    const login = db.users.find(u => u.id === userId)?.login ?? userId;
    repo.grants = [...repo.grants, { userId, login, role: 'Owner' }];
    const oldGrant = repo.grants.find(g => g.userId === oldOwnerId);
    if (oldGrant) oldGrant.role = 'Viewer';
  },
  // keepRevision=true mutates grants without bumping the revision, so tests can
  // produce server-side permission changes the UI cannot predict.
  setRole(repositoryId, userId, role, keepRevision = false) {
    const repo = db.repositories.get(repositoryId);
    if (!repo) throw new Error('no such repo');
    const grant = repo.grants.find(g => g.userId === userId);
    if (role === null) {
      repo.grants = repo.grants.filter(g => g.userId !== userId);
    } else if (grant) {
      grant.role = role;
    } else {
      repo.grants = [...repo.grants, { userId, login: db.users.find(u => u.id === userId)?.login ?? userId, role }];
    }
    if (!keepRevision) repo.revision += 1;
  },
  removeCredential(id) {
    db.credentials.delete(id);
  },
  setStatusMode(mode) {
    db.statusMode = mode;
  },
  setRunDelay(ms) {
    db.runDelayMs = ms;
  },
  lastCredentialSave() {
    const saves = db.calls.filter(c => c.method === 'PUT' && c.path === '/api/credentials');
    return saves.at(-1) ?? null;
  },
  db,
};

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body);
}

function failure(res, status, code, echoUser = null) {
  const headers = echoUser === null ? {} : { 'X-Rites-User': echoUser };
  sendJson(res, status, { code }, headers);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 65536) {
        reject(Object.assign(new Error('too large'), { status: 413, code: 'too-large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function currentUser(req) {
  const cookie = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)rites_session=([0-9a-f-]+)/.exec(cookie);
  if (!match) return null;
  return db.sessions.get(match[1]) ?? null;
}

function grantOf(repo, userId) {
  return repo.grants.find(g => g.userId === userId) ?? null;
}

function roleOf(repo, userId) {
  if (repo.owner === userId) return 'Owner';
  return grantOf(repo, userId)?.role ?? null;
}

// CredentialInfo shape: secrets and the write-only refresh token are never
// included in responses.
function publicCredential(cred) {
  return {
    id: cred.id,
    name: cred.name,
    forge: cred.forge,
    host: cred.host,
    revision: cred.revision,
    createdAt: cred.createdAt,
    updatedAt: cred.updatedAt,
    mode: cred.mode,
    oauthClientId: cred.oauthClientId,
    expiresAt: cred.expiresAt,
    refreshHealth: cred.refreshHealth,
  };
}

function publicRepo(repo) {
  return { ...repo, grants: repo.grants.map(g => ({ ...g })) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CRON_RE = /^[\d*,/-]+(\s+[\d*,/-]+){4}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function validateCredentialSave(body) {
  const { name, forge, host, secret, mode, oauthClientId, refreshToken, expiresAt } = body ?? {};
  if (!name || !host || !secret) return 'invalid-field';
  if (forge !== 'Github' && forge !== 'Gitlab') return 'invalid-field';
  if (mode !== 'Token' && mode !== 'Oauth') return 'invalid-mode';
  if (mode === 'Oauth') {
    if (forge !== 'Gitlab') return 'oauth-requires-gitlab';
    if (!db.oauthClients.some(c => c.id === oauthClientId)) return 'unknown-oauth-client';
    if (!refreshToken) return 'refresh-token-required';
    if (expiresAt != null && !ISO_RE.test(expiresAt)) return 'invalid-expiry';
  } else if (oauthClientId != null || refreshToken != null || expiresAt != null) {
    return 'token-mode-extra';
  }
  return null;
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';

  // Mutations must be same-origin with JSON bodies, like the real backend.
  if (hasBody) {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== url.origin) {
      return failure(res, 403, 'bad-origin');
    }
  }

  let body = null;
  if (hasBody) {
    const contentType = String(req.headers['content-type'] ?? '');
    let raw;
    try {
      raw = await readBody(req);
    } catch (error) {
      return failure(res, error.status ?? 500, error.code ?? 'network');
    }
    if (contentType !== 'application/json') {
      db.contractViolations.push({ method, path: pathname, reason: `bad Content-Type on mutation: ${contentType || '(none)'}` });
      return failure(res, 400, 'bad-content-type');
    }
    if (raw !== '') {
      try {
        body = JSON.parse(raw);
      } catch {
        return failure(res, 400, 'malformed');
      }
    }
    db.calls.push({ method, path: pathname, body, xRitesUser: req.headers['x-rites-user'] ?? null, contentType });
  } else {
    db.calls.push({ method, path: pathname, body: null, xRitesUser: req.headers['x-rites-user'] ?? null, contentType: null });
  }

  // Held-response tests: every request matching a pending hold fragment is
  // parked until releaseHeld(); the response then reflects the request's own
  // cookie (evaluated at reply time).
  const matchingHolds = db.holds.filter(hold => pathname.includes(hold.fragment));
  if (matchingHolds.length > 0) {
    await Promise.all(matchingHolds.map(hold => hold.promise));
  }

  if (pathname === '/api/version' && method === 'GET') {
    return sendJson(res, 200, { current: '0.2.0', minimum: '0.2.0', supported: ['0.2.0'] });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const user = db.users.find(u => u.login === body?.login);
    if (!user || db.passwords[user.login] !== body?.password) {
      return failure(res, 401, 'invalid-credentials');
    }
    const token = randomUUID();
    db.sessions.set(token, user.id);
    return sendJson(res, 200, {
      user: { id: user.id, login: user.login },
      versions: { current: '0.2.0', minimum: '0.2.0', supported: ['0.2.0'] },
      sessionTtlSeconds: '3600',
    }, {
      'Set-Cookie': `rites_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
      'X-Rites-User': user.id,
    });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const cookieUserId = currentUser(req);
    // Logout is a mutation: the UI's expected identity must match the cookie
    // before any session is destroyed.
    const expected = req.headers['x-rites-user'];
    if (expected !== undefined && expected !== cookieUserId) {
      return failure(res, 403, 'identity-mismatch', cookieUserId);
    }
    const match = /(?:^|;\s*)rites_session=([0-9a-f-]+)/.exec(cookie);
    if (match) db.sessions.delete(match[1]);
    return sendJson(res, 200, { ok: true }, cookieUserId === null ? {} : { 'X-Rites-User': cookieUserId });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const userId = currentUser(req);
    if (!userId) return failure(res, 401, 'unauthenticated');
    const user = db.users.find(u => u.id === userId);
    return sendJson(res, 200, { id: user.id, login: user.login });
  }

  // Everything below requires a session.
  const userId = currentUser(req);
  if (!userId) return failure(res, 401, 'unauthenticated');
  const user = db.users.find(u => u.id === userId);

  // Authenticated responses echo the actual user of the request (evaluated at
  // reply time, so held responses reflect the request's own cookie).
  const reply = (status, value) => {
    sendJson(res, status, value, { 'X-Rites-User': currentUser(req) ?? userId });
  };
  const fail = (status, code) => reply(status, { code });

  // Mutation identity contract, mirroring the backend: the UI must send
  // X-Rites-User equal to the cookie user, verified BEFORE any effect.
  if (hasBody) {
    const expectedHeader = req.headers['x-rites-user'];
    if (expectedHeader === undefined || expectedHeader === null || expectedHeader === '') {
      db.contractViolations.push({ method, path: pathname, reason: 'missing X-Rites-User on mutation' });
      return fail(403, 'identity-mismatch');
    }
    if (expectedHeader !== userId) {
      db.identityMismatches.push({ method, path: pathname, expected: expectedHeader, actual: userId });
      return fail(403, 'identity-mismatch');
    }
  }

  if (pathname === '/api/credentials') {
    if (method === 'GET') {
      const mine = [...db.credentials.values()].filter(c => c.owner === userId).map(publicCredential);
      return reply(200, { items: mine });
    }
    if (method === 'PUT') {
      const validationCode = validateCredentialSave(body);
      if (validationCode !== null) return fail(400, validationCode);
      const { id, name, forge, host, secret, mode, oauthClientId, refreshToken, expiresAt, expectedRevision } = body ?? {};
      if (id === undefined || id === null) {
        if (expectedRevision !== 0) return fail(409, 'revision-conflict');
        const credId = randomUUID();
        db.credentials.set(credId, {
          id: credId, name, forge, host, revision: 1,
          createdAt: nowIso(), updatedAt: nowIso(), owner: userId, secret,
          mode, oauthClientId: mode === 'Oauth' ? oauthClientId : null,
          refreshToken: mode === 'Oauth' ? refreshToken : null,
          expiresAt: mode === 'Oauth' ? expiresAt ?? null : null,
          refreshHealth: mode === 'Oauth' ? 'Healthy' : null,
        });
        return reply(200, { credential: publicCredential(db.credentials.get(credId)) });
      }
      const cred = db.credentials.get(id);
      if (!cred) return fail(404, 'not-found');
      if (cred.owner !== userId) return fail(403, 'forbidden');
      if (expectedRevision !== cred.revision) return fail(409, 'revision-conflict');
      cred.name = name;
      cred.forge = forge;
      cred.host = host;
      cred.secret = secret;
      cred.mode = mode;
      cred.oauthClientId = mode === 'Oauth' ? oauthClientId : null;
      cred.refreshToken = mode === 'Oauth' ? refreshToken : null;
      cred.expiresAt = mode === 'Oauth' ? expiresAt ?? null : null;
      if (cred.refreshHealth !== 'Uncertain') cred.refreshHealth = mode === 'Oauth' ? 'Healthy' : null;
      cred.revision += 1;
      cred.updatedAt = nowIso();
      return reply(200, { credential: publicCredential(cred) });
    }
  }

  if (pathname === '/api/credentials/delete' && method === 'POST') {
    const { id, expectedRevision } = body ?? {};
    const cred = db.credentials.get(id);
    if (!cred) return fail(404, 'not-found');
    if (cred.owner !== userId) return fail(403, 'forbidden');
    if (expectedRevision !== cred.revision) return fail(409, 'revision-conflict');
    db.credentials.delete(id);
    return reply(200, { ok: true });
  }

  if (pathname === '/api/oauth-clients' && method === 'GET') {
    return reply(200, { items: db.oauthClients });
  }

  if (pathname === '/api/repositories') {
    if (method === 'GET') {
      return reply(200, { items: [...db.repositories.values()].map(publicRepo) });
    }
    if (method === 'PUT') {
      const { id, forge, host, project, baseBranch, credentialId, expectedRevision } = body ?? {};
      if (!id || !host || !project || !baseBranch) return fail(400, 'invalid-field');
      if (forge !== 'Github' && forge !== 'Gitlab') return fail(400, 'invalid-field');
      const cred = db.credentials.get(credentialId);
      if (!cred || cred.owner !== userId) return fail(403, 'credential-not-yours');
      const existing = db.repositories.get(id);
      if (existing) {
        if (roleOf(existing, userId) !== 'Owner') return fail(403, 'forbidden');
        if (expectedRevision !== existing.revision) return fail(409, 'revision-conflict');
        Object.assign(existing, { forge, host, project, baseBranch, credentialId });
        existing.revision += 1;
        return reply(200, { repository: publicRepo(existing) });
      }
      if (expectedRevision !== 0) return fail(409, 'revision-conflict');
      const repo = {
        id, owner: userId, forge, host, project, baseBranch, credentialId, revision: 1,
        grants: [{ userId, login: user.login, role: 'Owner' }],
      };
      db.repositories.set(id, repo);
      db.rites.set(id, []);
      return reply(200, { repository: publicRepo(repo) });
    }
  }

  if (pathname === '/api/repositories/delete' && method === 'POST') {
    const { id, expectedRevision } = body ?? {};
    const repo = db.repositories.get(id);
    if (!repo) return fail(404, 'not-found');
    if (roleOf(repo, userId) !== 'Owner') return fail(403, 'forbidden');
    if (expectedRevision !== repo.revision) return fail(409, 'revision-conflict');
    db.repositories.delete(id);
    db.rites.delete(id);
    return reply(200, { ok: true });
  }

  if (pathname === '/api/grants' && method === 'POST') {
    const { repositoryId, userId: targetUser, role, expectedRevision } = body ?? {};
    const repo = db.repositories.get(repositoryId);
    if (!repo) return fail(404, 'not-found');
    if (roleOf(repo, userId) !== 'Owner') return fail(403, 'forbidden');
    if (expectedRevision !== repo.revision) return fail(409, 'revision-conflict');
    if (role === 'Owner' || (targetUser === repo.owner && role !== undefined && role !== null && role !== 'Owner')) {
      return fail(400, 'owner-immutable');
    }
    const grant = grantOf(repo, targetUser);
    if (role === undefined || role === null) {
      if (!grant) return fail(404, 'grant-not-found');
      if (grant.role === 'Owner') return fail(400, 'owner-immutable');
      repo.grants = repo.grants.filter(g => g.userId !== targetUser);
    } else if (grant) {
      grant.role = role;
    } else {
      const target = db.users.find(u => u.id === targetUser);
      if (!target) return fail(404, 'user-not-found');
      repo.grants = [...repo.grants, { userId: targetUser, login: target.login, role }];
    }
    repo.revision += 1;
    return reply(200, { repository: publicRepo(repo) });
  }

  let match = /^\/api\/repositories\/([^/]+)\/rites$/.exec(pathname);
  if (match && method === 'GET') {
    const repositoryId = decodeURIComponent(match[1]);
    if (!db.repositories.has(repositoryId)) return fail(404, 'not-found');
    return reply(200, { items: (db.rites.get(repositoryId) ?? []).map(r => ({ ...r })) });
  }

  match = /^\/api\/repositories\/([^/]+)\/rites\/([^/]+)\/runs$/.exec(pathname);
  if (match && method === 'GET') {
    const repositoryId = decodeURIComponent(match[1]);
    const riteId = decodeURIComponent(match[2]);
    if (!db.repositories.has(repositoryId)) return fail(404, 'not-found');
    const runs = db.runs.get(`${repositoryId}/${riteId}`) ?? [];
    return reply(200, { items: runs.slice(0, 100).map(r => ({ ...r })) });
  }

  if (pathname === '/api/rites') {
    if (method === 'PUT') {
      const { repositoryId, id, schedule, promptPath, modelId, enabled, expectedRevision } = body ?? {};
      const repo = db.repositories.get(repositoryId);
      if (!repo) return fail(404, 'not-found');
      const role = roleOf(repo, userId);
      if (role !== 'Owner' && role !== 'Editor') return fail(403, 'forbidden');
      if (!id || !promptPath) return fail(400, 'invalid-field');
      if (!CRON_RE.test(schedule ?? '')) return fail(400, 'invalid-schedule');
      if (!db.models.some(m => m.id === modelId)) return fail(400, 'unknown-model');
      const list = db.rites.get(repositoryId) ?? [];
      const existing = list.find(r => r.id === id);
      if (existing) {
        if (expectedRevision !== existing.revision) return fail(409, 'revision-conflict');
        Object.assign(existing, { schedule, promptPath, modelId, enabled });
        existing.revision += 1;
        return reply(200, { rite: { ...existing } });
      }
      if (expectedRevision !== 0) return fail(409, 'revision-conflict');
      const rite = { repositoryId, id, schedule, promptPath, modelId, enabled, revision: 1 };
      list.push(rite);
      db.rites.set(repositoryId, list);
      return reply(200, { rite: { ...rite } });
    }
  }

  if (pathname === '/api/rites/delete' && method === 'POST') {
    const { repositoryId, id, expectedRevision } = body ?? {};
    const repo = db.repositories.get(repositoryId);
    if (!repo) return fail(404, 'not-found');
    const role = roleOf(repo, userId);
    if (role !== 'Owner' && role !== 'Editor') return fail(403, 'forbidden');
    const list = db.rites.get(repositoryId) ?? [];
    const existing = list.find(r => r.id === id);
    if (!existing) return fail(404, 'not-found');
    if (expectedRevision !== existing.revision) return fail(409, 'revision-conflict');
    db.rites.set(repositoryId, list.filter(r => r.id !== id));
    return reply(200, { ok: true });
  }

  if (pathname === '/api/runs' && method === 'POST') {
    const { repositoryId, riteId, requestId } = body ?? {};
    const repo = db.repositories.get(repositoryId);
    if (!repo) return fail(404, 'not-found');
    const role = roleOf(repo, userId);
    if (role !== 'Owner' && role !== 'Editor') return fail(403, 'forbidden');
    if (!UUID_RE.test(requestId ?? '')) return fail(400, 'invalid-request-id');
    const rite = (db.rites.get(repositoryId) ?? []).find(r => r.id === riteId);
    if (!rite) return fail(404, 'not-found');
    const known = db.runIdempotency.get(requestId);
    if (known) {
      // Idempotent replay: same key, no second run, still logged for tests.
      db.runRequests.push({ repositoryId, riteId, requestId, userId, replay: true });
      return reply(200, { run: { ...known } });
    }
    const run = {
      id: randomUUID(), repositoryId, riteId, trigger: 'Manual',
      scheduledFor: nowIso(), createdAt: nowIso(), startedAt: null, finishedAt: null,
      state: 'Queued', failureCode: null, baseRevision: 'seed-rev', promptDigest: 'digest-new', branch: null, proposalUrl: null,
    };
    db.runIdempotency.set(requestId, run);
    db.runRequests.push({ repositoryId, riteId, requestId, userId, replay: false });
    const key = `${repositoryId}/${riteId}`;
    db.runs.set(key, [run, ...(db.runs.get(key) ?? [])]);
    const delay = db.runDelayMs;
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    if (db.dropRunResponses > 0) {
      // The run was accepted and recorded, but the response is truncated: a
      // clean socket destroy before any byte lets the browser retry silently,
      // so the fixture sends a partial body instead. The client can neither
      // retry nor know the outcome and must reuse the same idempotency key.
      db.dropRunResponses -= 1;
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Rites-User': currentUser(req) ?? userId });
      res.write('{"run": {"id": "');
      res.end();
      return undefined;
    }
    return reply(200, { run: { ...run } });
  }

  match = /^\/api\/runs\/([^/]+)$/.exec(pathname);
  if (match && method === 'GET') {
    const runId = decodeURIComponent(match[1]);
    for (const list of db.runs.values()) {
      const run = list.find(r => r.id === runId);
      if (run) return reply(200, { run: { ...run } });
    }
    return fail(404, 'not-found');
  }

  if (pathname === '/api/models' && method === 'GET') {
    return reply(200, { items: db.models });
  }
  if (pathname === '/api/users' && method === 'GET') {
    return reply(200, { items: db.users.map(u => ({ id: u.id, login: u.login })) });
  }
  if (pathname === '/api/status' && method === 'GET') {
    if (db.statusMode === 'fail') return fail(503, 'status-unavailable');
    if (db.statusMode === 'chunked-stall') {
      // 200 headers plus a partial JSON body, then the stream stalls forever:
      // the client must keep the deadline armed through body consumption.
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Rites-User': userId });
      res.write('{"queuedRuns": "2", "activeRu');
      return undefined;
    }
    if (db.statusMode === 'huge') {
      // A fast but oversized body: the client must cap streamed bytes.
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Rites-User': userId });
      let sent = 0;
      while (sent < 2 * 1024 * 1024) {
        const chunk = 'x'.repeat(64 * 1024);
        res.write(`"${chunk}"`);
        sent += chunk.length + 3;
      }
      res.end();
      return undefined;
    }
    return reply(200, { queuedRuns: '2', activeRuns: '1', schedulerEnabled: true });
  }

  return fail(404, 'not-found');
}

// Static layout mirrors the parent's packaging: index.html at the web root,
// web/app.js and generated/typescript/ next to it.
const STATIC_FILES = new Map([
  ['/', [path.join(WEB_ROOT, 'index.html'), 'text/html; charset=utf-8']],
  ['/index.html', [path.join(WEB_ROOT, 'index.html'), 'text/html; charset=utf-8']],
  ['/web/app.js', [path.join(BROWSER_ROOT, 'web', 'app.js'), 'text/javascript; charset=utf-8']],
  ['/web/styles.css', [path.join(WEB_ROOT, 'styles.css'), 'text/css; charset=utf-8']],
]);

export async function startServer() {
  const server = http.createServer(async (req, res) => {
    // A client that aborts mid-body (deadline, byte cap) closes the socket;
    // writes after that must not crash the fixture process.
    res.on('error', () => {});
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      const entry = STATIC_FILES.get(url.pathname);
      if (entry) {
        const data = await readFile(entry[0]);
        res.writeHead(200, { 'Content-Type': entry[1] });
        res.end(data);
        return;
      }
      if (url.pathname.startsWith('/generated/')) {
        const relative = url.pathname.slice(1); // generated/...
        const data = await readFile(path.join(BROWSER_ROOT, relative));
        res.writeHead(200, { 'Content-Type': MIME.get(path.extname(url.pathname)) ?? 'application/octet-stream' });
        res.end(data);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end(String(error?.stack ?? error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return { server, origin };
}
