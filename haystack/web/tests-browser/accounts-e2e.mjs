// The shared accounts flow (shared/account-web/tests/e2e/flow.mjs) against the real Haystack server selected by
// HAYSTACK_SERVER_COMMAND, an owned PostgreSQL database and the built web/dist, with auth.accounts enabled:
// sign-up whose approval setting is omitted (the default, approval required, is what the scenario expects),
// invitations, one configured admin and a generated TOTP key file.
// Runs alone after `npm run build`: node --import ../scripts/register-generated.mjs tests-browser/accounts-e2e.mjs
// ACCOUNT_E2E_EVIDENCE_DIR=/absolute/dir saves the screenshots of each step there.
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { prerequisites } from "./prerequisites.mjs";
import { writePasswordHash } from "./credentials.mjs";
import { ownedDatabase, configFor, atomicConfig, startServer, stopServer, freePort } from "./native.mjs";
import { runAccountFlow } from "../../../shared/account-web/tests/e2e/flow.mjs";

const ADMIN = "operator";
const ACCOUNT_KEY_BYTES = 32;
const here = path.dirname(fileURLToPath(import.meta.url));
await prerequisites("main");

let database; let dir; let backend;
const cleanup = async () => {
  await stopServer(backend);
  if (database) await database.close();
  if (dir) await rm(dir, { recursive: true, force: true });
};
process.once("SIGTERM", () => { void cleanup().finally(() => process.exit(143)); });
try {
  dir = await mkdtemp(path.join(os.tmpdir(), "haystack-accounts-"));
  database = await ownedDatabase({ connectionString: process.env.HAYSTACK_TEST_PG, dir });
  const password = randomBytes(24).toString("base64url");
  await writePasswordHash(path.join(dir, "admin.password"), password);
  await writeFile(path.join(dir, "accounts.key"), randomBytes(ACCOUNT_KEY_BYTES).toString("base64url"), { mode: 0o600 });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const auth = {
    activityProjectId: "agent-activity",
    users: [{ id: ADMIN, type: "human", displayName: "Operator", enabled: true, login: ADMIN, passwordHashFile: path.join(dir, "admin.password"), tokens: [], admin: true }],
    accounts: { enabled: true, keyFile: path.join(dir, "accounts.key"), signup: { enabled: true }, enrollment: { enabled: true }, issuer: "Haystack (127.0.0.1)" },
    cookieSecure: true, allowedHosts: ["127.0.0.1"], allowedOrigins: [base], insecureHttpOrigins: [base], rateLimit: { windowMs: 60000, max: 600 },
  };
  const configFile = path.join(dir, "config.json");
  const config = await configFor({ database: database.runtime, port, webRoot: path.resolve(here, "../dist"), auth });
  await atomicConfig(configFile, { ...config, indexing: { allowOptOut: true } });
  backend = await startServer(configFile, port, path.join(dir, "server.log"));
  const evidence = process.env.ACCOUNT_E2E_EVIDENCE_DIR ?? null;
  const result = await runAccountFlow({
    baseUrl: base, service: "haystack", admin: { login: ADMIN, password },
    browserType: chromium, launchOptions: { executablePath: process.env.HAYSTACK_CHROMIUM, args: ["--no-sandbox"] },
    evidenceDir: evidence === null ? null : path.resolve(evidence),
  });
  for (const wait of result.waits) console.log(`# waited ${wait.ms} ms for the next TOTP time step (${wait.purpose}) in step ${wait.step}`);
  console.log(`ok - accounts end to end against the real Haystack server (${result.durationMs} ms)`);
} catch (error) {
  console.log("not ok - accounts end to end against the real Haystack server");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
