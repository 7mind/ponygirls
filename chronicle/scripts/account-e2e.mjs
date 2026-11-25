// The shared accounts flow (shared/account-web/tests/e2e/flow.mjs) against a real Chronicle server: the selected
// executable in `serve-standby` mode (API, account plane and dashboard; no indexing workers), an owned PostgreSQL
// database, the built dashboard, and a generated configuration with `accounts` enabled (sign-up whose approval
// setting is omitted: the default, approval required, is what the scenario expects; invitations), one configured
// admin and a generated TOTP key file.
// Inputs (all required): CHRONICLE_SERVER (absolute executable), CHRONICLE_WEB_ROOT (built dashboard),
// PONYGIRLS_TEST_DATABASE_CHRONICLE (owned database descriptor of nix/tests/with-owned-postgres.py),
// PLAYWRIGHT_BROWSERS_PATH (pinned Chromium). Optional: ACCOUNT_E2E_EVIDENCE_DIR (absolute; step screenshots).
// Run: with-service-postgres node chronicle/scripts/account-e2e.mjs (playwright-core from chronicle/web, npm ci).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { access, appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { runAccountFlow } from '../../shared/account-web/tests/e2e/flow.mjs';

const ADMIN = 'operator';
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const DERIVED_BYTES = 32;
const ACCOUNT_KEY_BYTES = 32;
const STARTUP_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 15_000;
const POLL_MS = 100;
// Unused model endpoints: serve-standby runs no indexing worker, so nothing is ever sent there.
const UNUSED_MODEL_ENDPOINT = 'http://127.0.0.1:9/unused';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium } = require('playwright-core');

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}
async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}
function passwordHash(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, DERIVED_BYTES, 'sha256');
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function secretFile(file, content) { await writeFile(file, `${content}\n`, { mode: 0o600 }); }

async function startServer(executable, webRoot, configFile, base, logFile) {
  const child = spawn(executable, ['serve-standby', configFile], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CHRONICLE_WEB_ROOT: webRoot } });
  let log = Promise.resolve();
  const record = chunk => { log = log.then(() => appendFile(logFile, chunk)); };
  child.stdout.on('data', record); child.stderr.on('data', record);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try { if ((await fetch(`${base}/api/versions`, { signal: AbortSignal.timeout(1000) })).ok) return child; } catch {}
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  await stopServer(child); await log;
  throw new Error(`Chronicle did not become ready:\n${(await readFile(logFile, 'utf8').catch(() => '')).slice(-4000)}`);
}
async function stopServer(child) {
  if (child === null || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  const kill = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
  child.kill('SIGTERM'); await exited; clearTimeout(kill);
}

const executable = required('CHRONICLE_SERVER');
const webRoot = required('CHRONICLE_WEB_ROOT');
const database = JSON.parse(required('PONYGIRLS_TEST_DATABASE_CHRONICLE'));
required('PLAYWRIGHT_BROWSERS_PATH');
if (!path.isAbsolute(executable) || !path.isAbsolute(webRoot)) throw new Error('CHRONICLE_SERVER and CHRONICLE_WEB_ROOT must be absolute');
await access(executable, constants.X_OK);
await access(path.join(webRoot, 'index.html'));
const evidence = process.env.ACCOUNT_E2E_EVIDENCE_DIR ?? null;

const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-accounts-'));
let server = null;
const cleanup = async () => { await stopServer(server); await rm(dir, { recursive: true, force: true }); };
process.once('SIGTERM', () => { void cleanup().finally(() => process.exit(143)); });
try {
  const password = randomBytes(24).toString('base64url');
  await secretFile(path.join(dir, 'admin.password'), passwordHash(password));
  await secretFile(path.join(dir, 'accounts.key'), randomBytes(ACCOUNT_KEY_BYTES).toString('base64url'));
  await secretFile(path.join(dir, 'model-credential'), 'unused');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const configFile = path.join(dir, 'config.json');
  await writeFile(configFile, JSON.stringify({
    listenHost: '127.0.0.1', listenPort: port, allowedOrigin: base, secureCookies: false,
    jdbcUrl: database.jdbcUrl, databaseUser: database.user, databasePasswordFile: database.passwordFile, databaseLimits: database.limits,
    users: [{ id: ADMIN, login: ADMIN, passwordHashFile: path.join(dir, 'admin.password'), enabled: true, admin: true }],
    indexing: { allowOptOut: true },
    accounts: { enabled: true, keyFile: path.join(dir, 'accounts.key'), signup: { enabled: true }, enrollment: { enabled: true }, issuer: 'Chronicle (127.0.0.1)' },
    maxBodyBytes: 8388608, maxFiles: 16, maxFileBytes: 4194304, maxMessages: 10000, sessionTtlSeconds: 2592000,
    annotation: { requestPolicy: 'strict-json-schema', endpoint: UNUSED_MODEL_ENDPOINT, model: 'unused', revision: 'unused', credentialFile: path.join(dir, 'model-credential'), timeoutSeconds: 60, maxResponseBytes: 65536 },
    embedding: { endpoint: UNUSED_MODEL_ENDPOINT, model: 'unused', revision: 'unused', credentialFile: path.join(dir, 'model-credential'), timeoutSeconds: 60, maxResponseBytes: 1048576, dimensions: 1024, queryPrefix: 'query: ', documentPrefix: 'passage: ' }
  }), { mode: 0o600 });
  server = await startServer(executable, webRoot, configFile, base, path.join(dir, 'server.log'));
  const result = await runAccountFlow({
    baseUrl: base, service: 'chronicle', admin: { login: ADMIN, password },
    browserType: chromium, launchOptions: { headless: true }, evidenceDir: evidence === null ? null : path.resolve(evidence)
  });
  for (const wait of result.waits) console.log(`# waited ${wait.ms} ms for the next TOTP time step (${wait.purpose}) in step ${wait.step}`);
  console.log(`ok - accounts end to end against the real Chronicle server (${result.durationMs} ms)`);
} catch (error) {
  console.log('not ok - accounts end to end against the real Chronicle server');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
