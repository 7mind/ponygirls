import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { PacedHttp, QueryLedger, stateDbPath, CLAUDE_MIN_QUERY_MS } from "../src/pacing.ts";
import { TransportError, type HttpResponse } from "../src/http.ts";
import { QuotaService } from "../src/service.ts";
import { quotaLine } from "../src/status.ts";
import { toolReport } from "../src/report.ts";
import { buildTable, PLAIN_TABLE_STYLE } from "../src/table.ts";

const URL_USAGE = "https://api.anthropic.com/api/oauth/usage";
const NOW = new Date("2026-10-26T12:00:00Z");
const HEADERS = { Authorization: "Bearer test-token" };
const KEY = createHash("sha256").update(HEADERS.Authorization).digest("hex");
const ok = (body: object): HttpResponse => ({ status: 200, body: JSON.stringify(body), retryAfter: null });

function temp(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "tokemon-pacing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "cache", "state.sqlite");
}

test("cache path matches the dashboard on Linux, macOS and XDG", () => {
  assert.equal(stateDbPath("/home/u", "linux", {}), "/home/u/.cache/tokemon/state.sqlite");
  assert.equal(stateDbPath("/Users/u", "darwin", {}), "/Users/u/Library/Caches/tokemon/state.sqlite");
  assert.equal(stateDbPath("/home/u", "linux", { XDG_CACHE_HOME: "/cache" }), "/cache/tokemon/state.sqlite");
});

for (const failure of [429, 500, "transport"] as const) {
  test(`independent instances keep successful values and timestamp after ${failure}`, async (t) => {
    const path = temp(t);
    let now = NOW;
    let calls = 0;
    const inner = { request: async () => {
      calls++;
      if (calls === 1) return ok({ value: 42 });
      if (failure === "transport") throw new TransportError("offline");
      return { status: failure, body: "error", retryAfter: "0" };
    } };
    const first = new PacedHttp(inner, path, () => now);
    const second = new PacedHttp(inner, path, () => now);
    const response = await first.request("GET", URL_USAGE, HEADERS, null);
    assert.equal((await second.request("GET", URL_USAGE, HEADERS, null)).body, response.body);
    assert.equal(calls, 1);
    now = new Date(NOW.getTime() + CLAUDE_MIN_QUERY_MS);
    const old = await second.request("GET", URL_USAGE, HEADERS, null);
    assert.equal(old.body, response.body);
    assert.deepEqual(old.quotaCache!.fetchedAt, NOW);
    const held = await first.request("GET", URL_USAGE, HEADERS, null);
    assert.equal(held.body, response.body);
    assert.equal(calls, 2);
    const delay = failure === 429 ? 1_800_000 : CLAUDE_MIN_QUERY_MS;
    assert.equal(held.quotaCache!.retryAt.getTime(), now.getTime() + delay);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(path, "..")).mode & 0o777, 0o700);
  });
}

test("cold contention returns an observable retry; expired reservations recover and late writers are fenced", async (t) => {
  const path = temp(t);
  const ledger = new QueryLedger(path);
  assert.equal(ledger.claim(URL_USAGE, KEY, NOW).proceed, true);
  const noNetwork = new PacedHttp({ request: async () => { throw new Error("must not query"); } }, path, () => NOW);
  const held = await noNetwork.request("GET", URL_USAGE, HEADERS, null);
  assert.equal(held.status, 429);
  assert.equal(held.retryAfter, "300");
  const later = new Date(NOW.getTime() + CLAUDE_MIN_QUERY_MS);
  assert.equal(ledger.claim(URL_USAGE, KEY, later).proceed, true);
  ledger.record(URL_USAGE, KEY, later, ok({ value: "new" }), new Date(later.getTime() + CLAUDE_MIN_QUERY_MS));
  ledger.record(URL_USAGE, KEY, NOW, ok({ value: "old" }), later);
  assert.equal(ledger.claim(URL_USAGE, KEY, later).body, '{"value":"new"}');
});

test("legacy cache migration does not fabricate a success timestamp", (t) => {
  const path = temp(t);
  // Create the previous schema through the public ledger, then remove only the new column.
  const ledger = new QueryLedger(path);
  ledger.claim(URL_USAGE, KEY, NOW);
  const db = new DatabaseSync(path);
  db.exec("ALTER TABLE endpoint_queries DROP COLUMN fetched_at");
  db.prepare("UPDATE endpoint_queries SET body = ?").run(Buffer.from('{"old":true}'));
  db.close();
  const held = ledger.claim(URL_USAGE, KEY, NOW);
  assert.equal(held.body, '{"old":true}');
  assert.equal(held.fetchedAt, null);
});

test("usage freshness reaches the tool, table and badge without changing the displayed quota", async (t) => {
  const path = temp(t);
  let now = NOW;
  let requests = 0;
  const http = new PacedHttp({ request: async (_method, url) => {
    requests++;
    if (now !== NOW) return { status: 429, body: "", retryAfter: "0" };
    return ok(url.endsWith("/usage") ? { five_hour: { utilization: 42 } } : { account: { email: "test@example.test" } });
  } }, path, () => now);
  const service = new QuotaService({ discover: () => [{ provider: "anthropic", origin: "auth.json", label: "auth", note: null, credential: { kind: "oauth", secret: "test-token", refreshToken: null, accountId: null } }], http, now: () => now });
  const auth = { apiKey: async () => "test-token" };
  await service.report(auth, 0);
  now = new Date(NOW.getTime() + 600_000);
  const report = await service.report(auth, 0);
  const row = toolReport(report, now, { models: null, context: null, quotas: true }).providers[0]!;
  assert.equal(row.windows[0]!.used, 42);
  assert.equal(row.fetchedAt, NOW.toISOString());
  assert.equal(row.ageSeconds, 600);
  assert.equal(row.stale, true);
  assert.match(quotaLine("anthropic", report.results, now)!(PLAIN_TABLE_STYLE), /42%.*stale 10m/);
  assert.match(buildTable(report.results, now, { showInvalid: false, width: null }, PLAIN_TABLE_STYLE).lines.join("\n"), /stale 10m/);
  assert.match(buildTable(report.results, now, { showInvalid: false, width: 40 }, PLAIN_TABLE_STYLE).caption!, /1 stale quota row/);
  assert.equal(requests, 4);
});

test("a reader displays cached usage while the sole writer is fetching profile metadata", async (t) => {
  const path = temp(t);
  let releaseProfile!: () => void;
  let profileStarted!: () => void;
  const started = new Promise<void>((resolve) => { profileStarted = resolve; });
  const gate = new Promise<void>((resolve) => { releaseProfile = resolve; });
  const http = new PacedHttp({ request: async (_method, url) => {
    if (url.endsWith("/usage")) return ok({ five_hour: { utilization: 42 } });
    profileStarted();
    await gate;
    return ok({ account: { email: "test@example.test" } });
  } }, path, () => NOW);
  const service = () => new QuotaService({ discover: () => [{ provider: "anthropic", origin: "auth.json", label: "auth", note: null, credential: { kind: "oauth", secret: "test-token", refreshToken: null, accountId: null } }], http, now: () => NOW });
  const auth = { apiKey: async () => "test-token" };
  const writer = service().report(auth, 0);
  await started;
  try {
    const reader = await service().report(auth, 0);
    assert.equal(reader.results[0]!.snapshot?.windows[0]!.used, 42);
    assert.match(reader.results[0]!.snapshot!.note!, /profile unavailable/);
  } finally {
    releaseProfile();
    await writer;
  }
});

test("distinct credentials do not reuse another account's quota", async (t) => {
  let calls = 0;
  const http = new PacedHttp({ request: async () => ok({ value: ++calls }) }, temp(t), () => NOW);
  await http.request("GET", URL_USAGE, HEADERS, null);
  const other = await http.request("GET", URL_USAGE, { Authorization: "Bearer other" }, null);
  assert.equal(JSON.parse(other.body).value, 2);
});

test("separate Node processes elect only one requester", async (t) => {
  const path = temp(t);
  const source = `import { QueryLedger } from ${JSON.stringify(new URL("../src/pacing.ts", import.meta.url).href)};
    const claim = new QueryLedger(process.argv[1]).claim(${JSON.stringify(URL_USAGE)}, ${JSON.stringify(KEY)}, new Date(${JSON.stringify(NOW)}));
    process.stdout.write(claim.proceed ? "true" : "false");`;
  const run = () => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, path]);
    let out = "";
    let errors = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { errors += data; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(out.trim()) : reject(new Error(errors)));
  });
  const results = await Promise.all([run(), run(), run(), run()]);
  assert.ok(results.every((value) => value === "true" || value === "false"), JSON.stringify(results));
  assert.equal(results.filter((value) => value === "true").length, 1);
});

test("the real Python ledger and Node ledger share reservations, bodies and timestamps", { skip: !process.env.TOKEMON_PYTHON_SOURCE && "set TOKEMON_PYTHON_SOURCE for the cross-language contract" }, (t) => {
  const path = temp(t);
  const runPython = (code: string) => execFileSync("python3", ["-c", `from tokemon.state import QueryLedger\nfrom datetime import datetime, timedelta, timezone\nfrom pathlib import Path\nledger = QueryLedger(Path(${JSON.stringify(path)}), timedelta(minutes=5))\nnow = datetime.fromtimestamp(${NOW.getTime() / 1000}, timezone.utc)\n${code}`], { env: { ...process.env, PYTHONPATH: process.env.TOKEMON_PYTHON_SOURCE } }).toString().trim();
  const ledger = new QueryLedger(path);
  ledger.claim(URL_USAGE, KEY, NOW);
  assert.equal(runPython(`print(ledger.try_claim(${JSON.stringify(URL_USAGE)}, ${JSON.stringify(KEY)}, now).proceed)`), "False");
  runPython(`ledger.record(${JSON.stringify(URL_USAGE)}, ${JSON.stringify(KEY)}, 200, b'{"python":true}', now + timedelta(minutes=5), now)`);
  const held = ledger.claim(URL_USAGE, KEY, NOW);
  assert.equal(held.body, '{"python":true}');
  assert.deepEqual(held.fetchedAt, NOW);
  const later = new Date(NOW.getTime() + CLAUDE_MIN_QUERY_MS);
  ledger.claim(URL_USAGE, KEY, later);
  ledger.record(URL_USAGE, KEY, later, ok({ node: true }), new Date(later.getTime() + CLAUDE_MIN_QUERY_MS));
  assert.equal(runPython(`claim = ledger.try_claim(${JSON.stringify(URL_USAGE)}, ${JSON.stringify(KEY)}, now + timedelta(minutes=5))\nprint(claim.body.decode())`), '{"node":true}');
});
