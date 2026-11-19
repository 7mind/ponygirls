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

const URL_ENRICHED = `${URL_USAGE}?cedar_ember=1`;
const URL_PROFILE = "https://api.anthropic.com/api/oauth/profile";
const resetAt = "2026-11-01T00:00:00Z";
const limits = [
  { kind: "session", percent: 28, resets_at: resetAt },
  { kind: "weekly_all", percent: 60, resets_at: resetAt, scope: null },
  { kind: "weekly_scoped", percent: 24, resets_at: resetAt, scope: { model: { id: null, display_name: "Fable" }, surface: null } },
  { kind: "weekly_scoped", percent: 43, resets_at: resetAt, scope: { model: { display_name: "Opus" } } },
  { kind: "weekly_scoped", percent: 17, resets_at: resetAt, scope: { surface: "Fable" } },
];
const grant = (props: Record<string, unknown> = {}) => ({
  id: "private-grant-id", label: "private-grant-label", token: "private-redemption-token", type: "full",
  resets_left: 2, gives_back_weekly: false, clears: ["five_hour", "seven_day", "seven_day_overage_included"], paused: false,
  starts_at: "2026-10-25T10:00:00Z", ends_at: "2026-10-27T00:00:00Z", ...props,
});
const inventory = (...grants: unknown[]) => ({ eligible: true, grants });
const reportOptions = { models: null, context: null, quotas: true };
const auth = { apiKey: async () => "test-token" };
const claudeTarget = {
  credential: { kind: "oauth" as const, secret: "test-token", refreshToken: null, accountId: null }, note: null,
};
const piTarget = { ...claudeTarget, provider: "anthropic", label: "auth", origin: "auth.json" as const };
const cliTarget = { ...claudeTarget, provider: "claude-code", label: "CLI", origin: "Claude Code" as const };
const cliAuth = { ...auth, claudeCodeTarget: async () => cliTarget };

const grantSample = inventory(
  grant(), grant({ resets_left: 1, ends_at: "2026-10-26T12:02:00Z" }),
  grant({ resets_left: 4, gives_back_weekly: true, clears: ["five_hour", "seven_day_overage_included"] }),
  grant({ resets_left: 20, clears: ["five_hour"] }),
  grant({ resets_left: 30, paused: true }),
  grant({ resets_left: 40, ends_at: NOW.toISOString() }),
  grant({ resets_left: 50, starts_at: "2026-10-26T13:00:00Z" }),
);

test("only the Claude Code OAuth GET requests grants and shows their counts in existing rows", async (t) => {
  const calls: Array<[string, string, Record<string, string>, string | null]> = [];
  const requests = { request: async (method: string, url: string, headers: Record<string, string>, body: string | null) => {
    calls.push([method, url, headers, body]);
    if (url === URL_ENRICHED || url === URL_USAGE) return ok({ limits, cedar_ember: grantSample });
    assert.equal(url, URL_PROFILE);
    return ok({ account: { email: "test@example.test" } });
  } };
  const check = async (cli: boolean) => {
    const path = temp(t);
    const service = new QuotaService({ discover: () => cli ? [] : [{ ...piTarget, credential: { ...piTarget.credential, secret: "old-token" } }], http: new PacedHttp(requests, path, () => NOW), now: () => NOW });
    const report = await service.report({ ...auth, claudeCodeTarget: async () => cli ? cliTarget : null }, 0);
    const output = toolReport(report, NOW, reportOptions).providers[0]!;
    assert.equal(output.provider, cli ? "claude-code" : "anthropic");
    assert.deepEqual(output.windows.map((w) => [w.name, w.resetsAvailable, w.resetsAt]), [
      ["session (5h)", undefined, "2026-11-01T00:00:00.000Z"],
      ["weekly (7d)", cli ? 3 : undefined, "2026-11-01T00:00:00.000Z"],
      ["weekly (7d) Fable", cli ? 4 : undefined, "2026-11-01T00:00:00.000Z"],
      ["weekly (7d) Opus", undefined, "2026-11-01T00:00:00.000Z"],
      ["weekly (7d) Fable", undefined, "2026-11-01T00:00:00.000Z"],
    ]);
    for (const width of [null, 138, 80]) {
      const table = buildTable(report.results, NOW, { showInvalid: false, width }, PLAIN_TABLE_STYLE);
      assert.equal(table.lines.length, limits.length + 1);
      if (width !== 80) assert.match(table.lines[0]!, /Resets +Status/);
      assert.deepEqual(table.lines.filter((line) => line.includes("resets:")).map((line) => line.trim().split(/ {2,}/).at(-1)), cli ? ["ok 60% · resets: 3", "ok 24% · resets: 4"] : []);
      assert.doesNotMatch(table.lines.join("\n"), /private-|cedar_ember|seven_day_overage_included/);
    }
    assert.doesNotMatch(JSON.stringify(output), /private-|cedar_ember|seven_day_overage_included/);
    assert.doesNotMatch(quotaLine(output.provider, report.results, NOW)!(PLAIN_TABLE_STYLE), /resets:/);
    const db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare("SELECT endpoint, body FROM endpoint_queries ORDER BY endpoint").all();
    db.close();
    assert.deepEqual(rows.map((row) => row.endpoint), [URL_PROFILE, URL_USAGE]);
    const cached = Buffer.from(rows[1]!.body as Uint8Array).toString();
    assert.doesNotMatch(cached, /private-|cedar_ember|seven_day_overage_included|gives_back_weekly|starts_at|paused|ends_at/);
  };
  await check(false);
  await check(true);
  assert.deepEqual(calls.map(([method, url, headers, body]) => [method, url, headers.Authorization, body]), [
    ["GET", URL_USAGE, HEADERS.Authorization, null], ["GET", URL_PROFILE, HEADERS.Authorization, null],
    ["GET", URL_ENRICHED, HEADERS.Authorization, null], ["GET", URL_PROFILE, HEADERS.Authorization, null],
  ]);
  assert.deepEqual(calls[0]![2], HEADERS);
  assert.deepEqual(calls[2]![2], {
    ...HEADERS, "User-Agent": "claude-cli/2.1.322 (external, cli)", "anthropic-beta": "oauth-2025-04-20",
    Accept: "application/json", "Content-Type": "application/json",
  });
});

test("unknown or malformed inventory does not look like zero; a disclosed empty inventory does", async () => {
  const cases: Array<[unknown, number | undefined]> = [
    [undefined, undefined], [null, undefined], [{ eligible: false, grants: [] }, undefined],
    [{ eligible: "true", grants: [] }, undefined], [{ eligible: true }, undefined],
    [inventory(grant(), grant({ resets_left: -1 })), undefined],
    [inventory(grant({ resets_left: "3" })), undefined], [inventory(grant({ resets_left: 1.5 })), undefined],
    [inventory(grant({ gives_back_weekly: "true" })), undefined], [inventory(grant({ clears: "seven_day" })), undefined],
    [inventory(grant({ clears: ["future_bucket"] })), undefined],
    [inventory(grant({ clears: ["five_hour", "seven_day_overage_included"] })), undefined],
    [inventory(grant({ gives_back_weekly: true, clears: ["five_hour", "seven_day"] })), undefined],
    [inventory(grant({ ends_at: "0" })), undefined], [inventory(grant({ starts_at: "", ends_at: null })), undefined],
    [inventory(grant({ ends_at: "2026-02-30T00:00:00Z" })), undefined], [inventory(grant({ paused: null })), undefined],
    [inventory(), 0], [inventory(grant({ resets_left: 0 })), 0],
    [inventory(grant({ paused: true }), grant({ ends_at: NOW.toISOString() })), 0],
  ];
  for (const [cedar_ember, expected] of cases) {
    const service = new QuotaService({ discover: () => [], now: () => NOW, http: { request: async (_method, url) => {
      if (url === URL_ENRICHED) return ok({ limits, cedar_ember });
      assert.equal(url, URL_PROFILE);
      return ok({});
    } } });
    const report = await service.report(cliAuth, 0);
    const output = toolReport(report, NOW, reportOptions).providers[0]!;
    assert.deepEqual(output.windows.map((w) => w.resetsAvailable), [undefined, expected, expected, undefined, undefined], JSON.stringify(cedar_ember));
    const table = buildTable(report.results, NOW, { showInvalid: false, width: null }, PLAIN_TABLE_STYLE).lines.join("\n");
    if (expected === 0) assert.match(table, /ok 60% · resets: 0/);
    else assert.doesNotMatch(table, /resets:/);
  }
});

test("plain and enriched usage share a ledger; cached grants start and expire on time", async (t) => {
  const path = temp(t);
  let now = NOW;
  const calls: string[] = [];
  const inner = { request: async (_method: string, url: string) => {
    calls.push(url);
    if (url === URL_PROFILE) return ok({});
    if (url === URL_USAGE && now === NOW) return ok({ seven_day: { utilization: 62 } });
    if (url === URL_ENRICHED && now.getTime() - NOW.getTime() === CLAUDE_MIN_QUERY_MS) {
      return ok({ seven_day: { utilization: 60 }, cedar_ember: inventory(
        grant({ resets_left: 1, ends_at: "2026-10-26T12:07:00Z" }),
        grant({ ends_at: "2026-10-26T12:13:00Z" }),
        grant({ starts_at: undefined, ends_at: null, resets_left: 1 }),
        grant({ starts_at: "2026-10-26T12:08:00Z", ends_at: "2026-10-26T12:12:00Z", resets_left: 5 }),
      ) });
    }
    return { status: 429, body: "", retryAfter: "0" };
  } };
  const http = () => new PacedHttp(inner, path, () => now);
  const service = () => new QuotaService({ discover: () => [], http: http(), now: () => now });
  await http().request("GET", URL_USAGE, HEADERS, null);
  const plain = toolReport(await service().report(cliAuth, 0), now, reportOptions).providers[0]!;
  assert.deepEqual(plain.windows.map((w) => [w.used, w.resetsAvailable]), [[62, undefined]]);
  assert.deepEqual(calls, [URL_USAGE, URL_PROFILE]);

  const longLived = service();
  const then = (minutes: number) => { now = new Date(NOW.getTime() + minutes * 60_000); };
  then(5);
  const fresh = await longLived.report(cliAuth, 0);
  const result = (report: typeof fresh) => toolReport(report, now, reportOptions).providers[0]!;
  assert.equal(result(fresh).windows[0]!.resetsAvailable, 4);
  assert.equal(result(fresh).stale, false);
  assert.deepEqual(calls, [URL_USAGE, URL_PROFILE, URL_ENRICHED, URL_PROFILE]);
  const plainReader = await http().request("GET", URL_USAGE, HEADERS, null);
  assert.equal(plainReader.quotaCache?.fetchedAt?.toISOString(), now.toISOString());
  assert.equal(JSON.parse(plainReader.body).seven_day.utilization, 60);
  assert.equal(calls.length, 4);

  then(7);
  assert.equal(result(await longLived.report(cliAuth, 300_000)).windows[0]!.resetsAvailable, 3);
  assert.equal(result(await service().report(cliAuth, 0)).windows[0]!.resetsAvailable, 3);
  assert.equal(calls.length, 4);

  then(8);
  assert.equal(result(await longLived.report(cliAuth, 300_000)).windows[0]!.resetsAvailable, 8);
  assert.equal(result(await service().report(cliAuth, 0)).windows[0]!.resetsAvailable, 8);
  assert.equal(calls.length, 4);

  then(10);
  const stale = await service().report(cliAuth, 0);
  assert.deepEqual([result(stale).windows[0]!.resetsAvailable, result(stale).ageSeconds, result(stale).stale], [8, 300, true]);
  assert.match(buildTable(stale.results, now, { showInvalid: false, width: null }, PLAIN_TABLE_STYLE).lines[1]!, /ok 60% · resets: 8 · stale 5m/);
  const narrow = buildTable(stale.results, now, { showInvalid: false, width: 60 }, PLAIN_TABLE_STYLE).lines[1]!;
  assert.match(narrow, /stale 5m/);
  assert.doesNotMatch(narrow, /resets:/);
  assert.match(buildTable(stale.results, now, { showInvalid: false, width: 52 }, PLAIN_TABLE_STYLE).caption!, /1 stale quota row/);

  then(13);
  const expired = await service().report(cliAuth, 0);
  assert.deepEqual([result(expired).windows[0]!.resetsAvailable, result(expired).ageSeconds, result(expired).stale], [1, 480, true]);
  assert.equal(calls.length, 6);
});

test("when both logins use the same credential, Claude Code owns usage refresh and Pi ignores cached counts", async (t) => {
  const calls: string[] = [];
  const inner = { request: async (_method: string, url: string) => {
    calls.push(url);
    if (url === URL_ENRICHED) return ok({ seven_day: { utilization: 60 }, cedar_ember: grantSample });
    if (url === URL_USAGE) return ok({ seven_day: { utilization: 30 } });
    assert.equal(url, URL_PROFILE);
    return ok({});
  } };
  const http = new PacedHttp(inner, temp(t), () => NOW);
  const queued = Array.from({ length: 7 }, (_, i) => ({ ...piTarget, label: `other-${i}` }));
  const service = new QuotaService({ discover: () => [piTarget, ...queued], http, now: () => NOW });
  const results = (await service.report(cliAuth, 0)).results;
  assert.equal(results.length, 9);
  const cli = results.find((r) => r.target.provider === "claude-code")!;
  assert.equal(cli.snapshot?.windows[0]?.used, 60);
  const report = await service.report(cliAuth, 0);
  const output = toolReport(report, NOW, reportOptions).providers.filter((p) => !p.location.startsWith("other-"));
  assert.deepEqual(output.map((p) => [p.provider, p.windows[0]!.used, p.windows[0]!.resetsAvailable]), [
    ["anthropic", 60, undefined], ["claude-code", 60, 3],
  ]);
  assert.deepEqual(calls, [URL_ENRICHED, URL_PROFILE]);
});

test("grants never create quota windows; both null and omitted time bounds are open", async (t) => {
  const http = new PacedHttp({ request: async (_method, url) => url === URL_ENRICHED ? ok({
    limits: [limits[0], limits[2]],
    cedar_ember: inventory(grant(), grant({ resets_left: 5, gives_back_weekly: true, clears: ["five_hour", "seven_day_overage_included"], starts_at: null, ends_at: undefined })),
  }) : ok({}), }, temp(t), () => NOW);
  const service = new QuotaService({ discover: () => [], http, now: () => NOW });
  const output = toolReport(await service.report(cliAuth, 0), NOW, reportOptions).providers[0]!;
  assert.deepEqual(output.windows.map((w) => [w.name, w.resetsAvailable]), [["session (5h)", undefined], ["weekly (7d) Fable", 5]]);
});
