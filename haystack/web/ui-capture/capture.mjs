// Haystack dashboard screenshot harness (see README.md). Not a test: it asserts
// only what it needs to capture a state, and fails loudly on a blank capture.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { writePasswordHash } from "../tests-browser/credentials.mjs";
import { ownedDatabase, configFor, atomicConfig, startServer, stopServer, publicClient, freePort } from "../tests-browser/native.mjs";
import { startEmbeddingStub, stubEmbeddingConfig } from "../tests-browser/embedding-stub.mjs";
import { Recorder } from "./lib.mjs";
import { buildCorpus, ACTIVITY_PROJECT, AUTHORS } from "./seed.mjs";
import { scenarios } from "./scenarios.mjs";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: capture.mjs OUT_DIR");
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const ONLY = (process.env.HAYSTACK_CAPTURE_ONLY ?? "").split(",").filter(Boolean);
const digestOf = (t) => createHash("sha256").update(t, "ascii").digest("hex");
const uuidv7 = (() => { let n = 0; return () => {
  const ms = BigInt(Date.now()).toString(16).padStart(12, "0"); const r = randomBytes(10).toString("hex");
  return `${ms.slice(0, 8)}-${ms.slice(8)}-7${r.slice(0, 3)}-8${r.slice(3, 6)}-${r.slice(6, 18).padEnd(12, "0")}`.slice(0, 36);
}; })();

const rec = new Recorder(OUT);
await rec.init();
const started = Date.now();
let database, backend, browser, dir, stub;
const cleanup = async () => {
  if (browser) await browser.close().catch(() => {});
  if (backend) await stopServer(backend);
  if (database) await database.close();
  if (stub) await stub.close();
  if (dir) await rm(dir, { recursive: true, force: true });
};
process.once("SIGTERM", () => { void cleanup().finally(() => process.exit(143)); });
try {
  dir = await mkdtemp(path.join(os.tmpdir(), "haystack-capture-"));
  database = await ownedDatabase({ connectionString: process.env.HAYSTACK_TEST_PG, dir });
  const secrets = {};
  const tokenFile = async (name) => { const t = randomBytes(32).toString("base64url"); await writeFile(path.join(dir, name + ".sha"), digestOf(t) + "\n"); return t; };
  const passwords = { op: randomBytes(24).toString("base64url"), alice: randomBytes(24).toString("base64url") };
  for (const id of ["op", "alice"]) await writePasswordHash(path.join(dir, id + ".password"), passwords[id]);
  secrets.op = await tokenFile("op-browser");
  await tokenFile("op-ci"); await tokenFile("op-laptop");
  secrets.alice = await tokenFile("alice-cli");
  secrets["claude-agent"] = await tokenFile("claude");
  secrets["codex-agent"] = await tokenFile("codex");
  const hash = (n) => path.join(dir, n + ".sha");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const auth = {
    activityProjectId: ACTIVITY_PROJECT,
    users: [
      { id: "op", type: "human", displayName: "Op", enabled: true, login: "op", passwordHashFile: path.join(dir, "op.password"),
        tokens: [{ id: "browser", hashFile: hash("op-browser") }, { id: "ci-rotation-2026-10-" + "long-configured-id-".repeat(2), hashFile: hash("op-ci") }, { id: "laptop-cli", hashFile: hash("op-laptop") }] },
      { id: "alice", type: "human", displayName: "Alice", enabled: true, login: "alice", passwordHashFile: path.join(dir, "alice.password"), tokens: [{ id: "cli", hashFile: hash("alice-cli") }] },
      { id: "claude-agent", type: "agent", displayName: "Claude agent", tokens: [{ id: "default", hashFile: hash("claude") }] },
      { id: "codex-agent", type: "agent", displayName: "Codex agent", tokens: [{ id: "default", hashFile: hash("codex") }] },
    ],
    cookieSecure: true, allowedHosts: ["127.0.0.1", "localhost"], allowedOrigins: [base], insecureHttpOrigins: [base],
    rateLimit: { windowMs: 60000, max: 100000 },
  };
  const configFile = path.join(dir, "config.json");
  // Retrieval runs with the controlled loopback stub embedding (the `retrieve` scenario stops and holds it).
  stub = await startEmbeddingStub();
  const config = await configFor({ database: database.runtime, port, webRoot: path.join(webRoot, "dist"), auth });
  config.retrieval.embedding = await stubEmbeddingConfig(stub, dir);
  await atomicConfig(configFile, config);
  backend = await startServer(configFile, port, path.join(dir, "server.log"));
  console.log(`# server ready on ${base}`);

  // ---- seed through the authenticated public API --------------------------------
  const clients = Object.fromEntries(AUTHORS.map((a) => [a, publicClient(base, secrets[a])]));
  const corpus = buildCorpus();
  const seedStart = Date.now();
  let puts = 0;
  for (const doc of corpus) {
    const client = clients[doc.author];
    let revision = 0;
    for (let r = 1; r <= doc.revisions; r++) {
      const body = r === 1 ? doc.document : { ...doc.document, description: `${doc.document.description}\n\n(revision ${r}: clarified wording)`, importance: r % 2 ? "high" : "low" };
      const result = await client.put({ key: doc.key, documentJson: JSON.stringify(body), expectedRevision: revision, requestId: uuidv7() });
      revision = result.revision; puts++;
    }
  }
  console.log(`# seeded ${corpus.length} records / ${puts} puts in ${Date.now() - seedStart} ms`);

  browser = await chromium.launch({ executablePath: process.env.HAYSTACK_CHROMIUM, args: ["--no-sandbox", "--no-proxy-server"] });
  const env = { base, port, rec, browser, corpus, clients, passwords, secrets, uuidv7, startedAt: started, dir, stub };
  for (const scenario of scenarios) {
    if (ONLY.length > 0 && !ONLY.includes(scenario.name)) continue;
    console.log(`# scenario ${scenario.name}`);
    rec.section(scenario.title);
    try { await scenario.run(env); }
    catch (error) { console.error(`SCENARIO FAILED ${scenario.name}:`, error); rec.note(`SCENARIO ${scenario.name} FAILED: ${String(error.message).split("\n")[0]}`); process.exitCode = 1; }
  }
  const load = os.loadavg()[0].toFixed(1);
  await rec.writeIndex(`Generated by haystack/web/ui-capture (source working tree, server ${process.env.HAYSTACK_SERVER_COMMAND}). Corpus: ${corpus.length} synthetic records, ${puts} revisions, 5 projects. Wall time ${Math.round((Date.now() - started) / 1000)} s, load average at end ${load}.`);
} finally { await cleanup(); }
