import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatAmount, formatResets, formatUsedLimit, retryQualifier, usageBar, usedPercent, windowState } from "../src/format.ts";
import { quotaWindow, type QuotaWindow } from "../src/quota.ts";
import { toolReport } from "../src/report.ts";
import type { QueryResult } from "../src/service.ts";
import { buildTable, PLAIN_TABLE_STYLE, type TableStyle } from "../src/table.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const win = (name: string, used: number | null, limit: number | null, unit: string, resetsAt: Date | null = null): QuotaWindow => quotaWindow(name, used, limit, unit, resetsAt);

function result(provider: string, windows: QuotaWindow[], over: Partial<QueryResult> = {}, identity: string | null = null): QueryResult {
  return {
    target: { provider, origin: "auth.json", label: "~/.pi/agent/auth.json", credential: null, note: null },
    snapshot: { plan: "lite", identity, windows, note: null },
    error: null,
    fetchedAt: NOW,
    rateLimited: false,
    retryAt: null,
    ...over,
  };
}

test("amounts, used/limit, bars, and resets read like tokemon's", () => {
  assert.deepEqual([formatAmount(12500000, "tokens"), formatAmount(3.5, "USD"), formatAmount(42.25, "%"), formatAmount(12.9, "requests"), formatAmount(null, "USD")], ["12.5M", "$3.50", "42.3%", "12", "—"]);
  assert.deepEqual([formatUsedLimit(win("w", 12.4, 100, "%")), formatUsedLimit(win("w", 3.5, 25, "USD")), formatUsedLimit(win("w", null, 10, "USD")), formatUsedLimit({ ...win("w", null, null, "requests"), unlimited: true })], ["12%", "$3.50 / $25.00", "$10.00", "unlimited"]);
  assert.deepEqual([usageBar(win("w", 50, 100, "%")), usageBar(win("w", 150, 100, "%")), usageBar(win("w", -5, 100, "%")), usageBar(win("w", null, 100, "%"))], ["█████░░░░░", "██████████", "░░░░░░░░░░", "—"]);
  const inHours = new Date(NOW.getTime() + (2 * 3600 + 5 * 60) * 1000);
  const inDays = new Date(NOW.getTime() + (3 * 86400 + 4 * 3600) * 1000);
  assert.deepEqual([formatResets(win("w", 1, 2, "%", inHours), NOW), formatResets(win("w", 1, 2, "%", inDays), NOW), formatResets(win("w", 1, 2, "%", NOW), NOW)], ["2h 05m", "3d 4h", "reset due"]);
  assert.deepEqual([windowState(win("w", 95, 100, "%")), windowState(win("w", 100, 100, "%")), windowState(win("w", 10, 100, "%")), windowState({ ...win("w", null, null, "%"), unlimited: true })], ["low", "EXHAUSTED", "ok", "unlimited"]);
});

test("the table stacks windows per account, sorts by provider, and hides rows without quota data", () => {
  const results = [
    result("zai", [win("tokens (5h)", 12, 100, "%"), win("MCP (1mo)", 10, 100, "calls")]),
    result("kimi-coding", [win("weekly", 37, 100, "units")], {}, "me@example.test"),
    result("xiaomi", [], { snapshot: { plan: null, identity: null, windows: [], note: "no quota endpoint" } }),
    result("minimax", [], { snapshot: null, error: "QuotaFetchError: HTTP 500" }),
  ];
  const table = buildTable(results, NOW, { showInvalid: false, width: null }, PLAIN_TABLE_STYLE);
  const text = table.lines.join("\n");
  assert.ok(text.indexOf("kimi-coding") < text.indexOf("zai") && !text.includes("xiaomi") && !text.includes("minimax"), text);
  assert.ok(text.includes("tokens (5h)") && text.includes("MCP (1mo)") && text.includes("me@example.test"));
  assert.equal(table.caption, "2 rows hidden: 1 error, 1 without quota data");
  const all = buildTable(results, NOW, { showInvalid: true, width: null }, PLAIN_TABLE_STYLE);
  assert.ok(all.lines.join("\n").includes("QuotaFetchError: HTTP 500") && all.caption === null);
});

/** Zero-width SGR tags, so padding and truncation see the same widths as the real theme. */
const sgr = (open: number, close: number) => (s: string): string => `\x1b[${open}m${s}\x1b[${close}m`;
const SGR_STYLE: TableStyle = { provider: (_p, s) => sgr(35, 39)(s), bold: sgr(1, 22), dim: sgr(2, 22), success: sgr(32, 39), warning: sgr(33, 39), error: sgr(31, 39) };
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const plainTable = (results: QueryResult[], width: number | null, showInvalid = false): { lines: string[]; caption: string | null } => {
  const table = buildTable(results, NOW, { showInvalid, width }, PLAIN_TABLE_STYLE);
  return { lines: table.lines.map(strip), caption: table.caption };
};
/** The cells of a table line; cells are at least two spaces apart and hold no double space themselves. */
const cells = (line: string): string[] => line.trim().split(/\s{2,}/);
const hiddenColumns = (caption: string | null): string => /hidden at this width: ([A-Za-z, /]+)/.exec(caption ?? "")?.[1] ?? "";

const RETRY_AT = new Date(NOW.getTime() + (55 * 60 + 28) * 1000);
/** The two rows of the captured /tokemon pane: a rate-limited login and an unlimited enterprise one. */
function captured(): QueryResult[] {
  return [
    result("anthropic", [], { snapshot: null, error: "rate limited (HTTP 429) by https://api.anthropic.com/api/oauth/usage", rateLimited: true, retryAt: RETRY_AT }),
    result("openai-codex", [], { snapshot: { plan: "ent26", identity: "someone@example.com", windows: [{ ...win("credits", null, null, "credits"), unlimited: true }], note: "resets: 0" } }),
  ];
}

/** Accounts with several windows, money, a reset countdown, and a long provider note. */
function fleet(): QueryResult[] {
  const soon = new Date(NOW.getTime() + (2 * 3600 + 5 * 60) * 1000);
  return [
    result("anthropic", [], { snapshot: { plan: "max", identity: "someone@example.com", windows: [win("5h", 12, 100, "%", soon), win("7d", 93, 100, "%", soon), win("extra usage", 1961.1, 2000, "USD")], note: null } }),
    result("xai", [], { snapshot: { plan: "lite", identity: null, windows: [win("primary", 10, 100, "%")], note: "team seat: usage bills the team's credits (see the management key)" } }),
    result("zai", [win("tokens (5h)", 100, 100, "%", soon)]),
  ];
}

test("money reads with thousands separators", () => {
  assert.deepEqual([formatAmount(1204.5, "USD"), formatAmount(1234567.891, "EUR"), formatAmount(999.999, "GBP"), formatAmount(-1500, "USD")], ["$1,204.50", "€1,234,567.89", "£1,000.00", "$-1,500.00"]);
  assert.equal(formatUsedLimit(win("extra usage", 1961.1, 2000, "USD")), "$1,961.10 / $2,000.00");
  assert.equal(formatAmount(62500.4, "credits"), "62500", "a credit balance is a count, not money");
});

test("the 80-column pane table keeps Provider and Status and names the hidden columns", () => {
  const table = plainTable(captured(), 80);
  assert.deepEqual(table.lines, [
    "Provider      Window   Used / limit  Usage  Resets  Status",
    "anthropic     —                   —  —           —  rate limited · retry 55m",
    "openai-codex  credits     unlimited  —           —  unlimited · resets: 0",
  ]);
  assert.equal(table.caption, "hidden at this width: Src, Login, Plan");
});

test("at 120 columns every column fits and the rate-limit status stays on its row", () => {
  const table = plainTable(captured(), 120);
  assert.deepEqual(table.lines, [
    "Provider      Src        Login                Plan   Window   Used / limit  Usage  Resets  Status",
    "anthropic     auth.json                              —                   —  —           —  rate limited · retry 55m",
    "openai-codex  auth.json  someone@example.com  ent26  credits     unlimited  —           —  unlimited · resets: 0",
  ]);
  assert.equal(table.caption, null);
});

test("a wide table shows the locations and the full status text; no rule separates rows", () => {
  for (const width of [170, null]) {
    const table = plainTable(captured(), width);
    assert.deepEqual(table.lines.map((line) => cells(line)), [
      ["Provider", "Src", "Login", "Plan", "Window", "Used / limit", "Usage", "Resets", "Status"],
      ["anthropic", "auth.json", "—", "—", "—", "—", "rate limited (429) · retry in 55m 28s"],
      ["~/.pi/agent/auth.json"],
      ["openai-codex", "auth.json", "someone@example.com", "ent26", "credits", "unlimited", "—", "—", "unlimited · resets: 0"],
      ["~/.pi/agent/auth.json"],
    ], String(width));
    assert.equal(table.caption, null);
  }
});

test("columns hide in the order Src, Plan, Login, Resets, Usage; Provider, Window, Used / limit and Status never do", () => {
  for (const results of [captured(), fleet()]) {
    const natural = Math.max(...plainTable(results, null).lines.map(visibleWidth));
    const steps: string[] = [];
    for (let width = natural; width >= 40; width--) {
      const table = plainTable(results, width);
      const headers = cells(table.lines[0]!);
      for (const kept of ["Provider", "Window", "Used / limit", "Status"]) assert.ok(headers.includes(kept), `${width}: ${table.lines[0]}`);
      assert.ok(table.lines.every((line) => visibleWidth(line) <= width), `${width}:\n${table.lines.join("\n")}`);
      const hidden = hiddenColumns(table.caption);
      // The note lists what is missing from the header, in the order the columns are displayed.
      assert.deepEqual(["Src", "Login", "Plan", "Usage", "Resets"].filter((name) => !headers.includes(name)).join(", "), hidden, `${width}: ${table.lines[0]}`);
      if (steps.at(-1) !== hidden) steps.push(hidden);
    }
    assert.deepEqual(steps, ["", "Src", "Src, Plan", "Src, Login, Plan", "Src, Login, Plan, Resets", "Src, Login, Plan, Usage, Resets"]);
  }
});

test("locations are the first thing hidden, before any column", () => {
  const natural = Math.max(...plainTable(captured(), null).lines.map(visibleWidth));
  const compact = plainTable(captured(), natural - 1);
  assert.ok(!compact.lines.some((line) => line.includes("~/.pi/agent/auth.json")), compact.lines.join("\n"));
  assert.deepEqual(cells(compact.lines[0]!), ["Provider", "Src", "Login", "Plan", "Window", "Used / limit", "Usage", "Resets", "Status"]);
  assert.equal(compact.caption, null);
});

test("every row is one line: the status never wraps, at any width", () => {
  const rows = (results: QueryResult[]): number => results.reduce((sum, r) => sum + Math.max(1, r.snapshot?.windows.length ?? 0), 0);
  for (const results of [captured(), fleet()]) {
    for (const width of [60, 80, 100, 120]) {
      const table = plainTable(results, width);
      assert.equal(table.lines.length, 1 + rows(results), `${width}:\n${table.lines.join("\n")}`);
      assert.ok(table.lines.every((line) => !/^─+$/.test(line)), "no rules");
    }
  }
});

test("a status is its state, then at most one qualifier that fits; the rest is dropped, never wrapped", () => {
  assert.deepEqual([retryQualifier(RETRY_AT, NOW), retryQualifier(new Date(NOW.getTime() + 28_000), NOW), retryQualifier(new Date(NOW.getTime() + 65 * 60_000), NOW), retryQualifier(NOW, NOW), retryQualifier(null, NOW)], ["retry 55m", "retry 28s", "retry 1h05m", "retry due", null]);
  const statusAt = (results: QueryResult[], width: number, row: number): string => cells(plainTable(results, width).lines[row]!).at(-1)!;
  // Rate limited: the full text when the row is wide enough, then the short qualifier, then the bare state.
  assert.equal(statusAt(captured(), 130, 1), "rate limited (429) · retry in 55m 28s");
  assert.equal(statusAt(captured(), 80, 1), "rate limited · retry 55m");
  assert.equal(statusAt(captured(), 60, 1), "rate limited");
  // A long provider note shows only where it fits whole.
  const xai = fleet().filter((r) => r.target.provider === "xai");
  assert.equal(statusAt(xai, 170, 1), "ok 10% · team seat: usage bills the team's credits (see the management key)");
  for (const width of [120, 100, 80, 60]) assert.equal(statusAt(xai, width, 1), "ok 10%", String(width));
  assert.deepEqual(cells(plainTable(xai, 120).lines[0]!), ["Provider", "Src", "Login", "Plan", "Window", "Used / limit", "Usage", "Resets", "Status"], "a long note hides no column");
});

test("a provider's note never hides a column; a stale marker does", () => {
  const snapshot = { plan: "ent26", identity: "someone@example.com", windows: [win("weekly credits", 1961.1, 2000, "USD")], note: "resets: 0" };
  const all = ["Provider", "Src", "Login", "Plan", "Window", "Used / limit", "Usage", "Resets", "Status"];
  // 119 columns hold every column with the bare state; the note needs 12 more.
  const noted = [result("openai-codex", [], { snapshot })];
  assert.deepEqual(plainTable(noted, 119).lines.map(cells), [all, ["openai-codex", "auth.json", "someone@example.com", "ent26", "weekly credits", "$1,961.10 / $2,000.00", "██████████", "—", "low 98%"]]);
  assert.equal(cells(plainTable(noted, 131).lines[1]!).at(-1), "low 98% · resets: 0");
  const stale = [result("openai-codex", [], { snapshot, quotaCache: { fetchedAt: new Date(NOW.getTime() - 10 * 60_000), retryAt: NOW } })];
  // The same row, stale: one column goes so that the marker stays.
  const table = plainTable(stale, 120);
  assert.equal(cells(table.lines[1]!).at(-1), "low 98% · stale 10m");
  assert.equal(table.caption, "hidden at this width: Src");
});

test("the view of invalid rows hides columns to keep each status whole", () => {
  const error = "QuotaFetchError: meta session expired (HTTP 401) — run /login meta";
  const results = [...captured(), result("minimax", [], { snapshot: null, error })];
  const statuses = (width: number, showInvalid: boolean): Array<string | undefined> => plainTable(results, width, showInvalid).lines.slice(1).map((line) => cells(line).at(-1));
  assert.deepEqual(statuses(120, true), ["rate limited (429) · retry in 55m 28s", error, "unlimited · resets: 0"]);
  assert.equal(plainTable(results, 120, true).caption, "hidden at this width: Src, Login, Plan");
  assert.deepEqual(statuses(120, false), ["rate limited · retry 55m", "unlimited · resets: 0"]);
  assert.equal(plainTable(results, 120, false).caption, "1 row hidden: 1 error");
  // Too narrow for the whole error even with every optional column hidden: it is cut, on its own line.
  const narrow = plainTable(results, 80, true);
  assert.equal(hiddenColumns(narrow.caption), "Src, Login, Plan, Usage, Resets");
  assert.deepEqual(narrow.lines.slice(1).map((line) => cells(line).at(-1)), ["rate limited (429) · retry in 55m 28s", "QuotaFetchError: meta session expired (HTT…", "unlimited · resets: 0"]);
});

test("with nothing left to hide, a quota's details are cut before who it is and how it is doing", () => {
  const table = plainTable([...captured(), ...fleet()], 60);
  assert.ok(table.lines.every((line) => visibleWidth(line) <= 60), table.lines.join("\n"));
  assert.equal(hiddenColumns(table.caption), "Src, Login, Plan, Usage, Resets");
  assert.deepEqual(table.lines.filter((line) => line.includes("…")).map(cells), [["extra usage", "$1,961.10 / $2,000…", "low 98%"]]);
  assert.deepEqual(table.lines.map((line) => cells(line)[0]), ["Provider", "anthropic", "anthropic", "7d", "extra usage", "openai-codex", "xai", "zai"]);
  assert.equal(cells(table.lines[1]!).at(-1), "rate limited");
});

test("the status carries the used percentage, so the number survives without the Usage bar", () => {
  assert.deepEqual([usedPercent(win("w", 1961.1, 2000, "USD")), usedPercent(win("w", 1204.5, 2000, "USD")), usedPercent(win("w", 89.99, 100, "%")), usedPercent(win("w", 12.6, 100, "%")), usedPercent(win("w", 57, 100, "%")), usedPercent(win("w", 150, 100, "%")), usedPercent(win("w", -5, 100, "%")), usedPercent(win("w", null, 100, "%")), usedPercent(win("w", 5, null, "USD")), usedPercent({ ...win("w", null, null, "requests"), unlimited: true })], [98, 60, 90, 13, 57, 150, 0, null, null, null]);
  // The number agrees with the Used / limit cell beside it.
  assert.deepEqual([formatUsedLimit(win("w", 12.6, 100, "%")), formatUsedLimit(win("w", 89.99, 100, "%"))], ["13%", "90%"]);
  const table = plainTable(fleet(), 64);
  assert.equal(hiddenColumns(table.caption), "Src, Login, Plan, Usage, Resets");
  assert.deepEqual(table.lines.slice(1).map((line) => cells(line).at(-1)), ["ok 12%", "low 93%", "low 98%", "ok 10%", "EXHAUSTED 100%"]);
  // Continuation rows of one account keep blank first cells.
  assert.deepEqual(table.lines.slice(1, 4).map((line) => cells(line)[0]), ["anthropic", "7d", "extra usage"]);
  // With no column left to hide, a percentage goes before any cell is cut.
  const tight = plainTable(fleet(), 60);
  assert.deepEqual(tight.lines.slice(1).map((line) => cells(line).at(-1)), ["ok 12%", "low 93%", "low 98%", "ok 10%", "EXHAUSTED"]);
  assert.ok(tight.lines.every((line) => !line.includes("…")), tight.lines.join("\n"));
});

test("the stale marker is the preferred qualifier; a dropped one is counted under the table", () => {
  const cache = { fetchedAt: new Date(NOW.getTime() - 10 * 60_000), retryAt: NOW };
  const stale = [result("anthropic", [], { quotaCache: cache, snapshot: { plan: "max", identity: "someone@example.com", windows: [win("5h", 12, 100, "%"), win("7d", 93, 100, "%")], note: "a provider note" } })];
  const wide = plainTable(stale, null);
  assert.deepEqual(wide.lines.filter((line) => /5h|7d/.test(line)).map((line) => cells(line).at(-1)), ["ok 12% · a provider note · stale 10m", "low 93%"]);
  const narrow = plainTable(stale, 80);
  assert.equal(cells(narrow.lines[1]!).at(-1), "ok 12% · stale 10m");
  assert.equal(narrow.caption, "hidden at this width: Src, Login, Plan");
  const tiny = plainTable(stale, 40);
  assert.equal(cells(tiny.lines[1]!).at(-1), "ok 12%");
  assert.match(tiny.caption ?? "", /^⚠ 1 stale quota row\(s\) · hidden at this width: /);
});

test("when the kept columns still do not fit, cells are truncated with an ellipsis, never emptied", () => {
  const results = [
    result("vercel-ai-gateway", [win("monthly credits", 1204.5, 2000, "USD")]),
    result("minimax", [], { snapshot: null, error: "QuotaFetchError: meta session expired (HTTP 401) — run /login meta" }),
  ];
  for (const width of [60, 50, 40]) {
    const table = plainTable(results, width, true);
    assert.ok(table.lines.every((line) => visibleWidth(line) <= width), `${width}:\n${table.lines.join("\n")}`);
    assert.equal(hiddenColumns(table.caption), "Src, Login, Plan, Usage, Resets");
    const [header, minimax, vercel] = table.lines.map(cells);
    assert.equal(header!.length, 4, `${width}: ${table.lines[0]}`);
    assert.deepEqual([minimax!.length, vercel!.length], [4, 4], `${width}:\n${table.lines.join("\n")}`);
    assert.match(minimax!.at(-1)!, /^Quota.*…$/, "an error too long for its cell is cut, not dropped");
    assert.match(vercel!.at(-1)!, /^ok/);
    assert.match(vercel![0]!, /^vercel/);
  }
  // Down to 60 columns no column is narrower than its header.
  assert.deepEqual(cells(plainTable(results, 60, true).lines[0]!), ["Provider", "Window", "Used / limit", "Status"]);
  assert.ok(plainTable(results, 60, true).lines[2]!.includes("…"));
});

test("every table line fits 60, 80, 100, 120 and 170 columns, with and without invalid rows", () => {
  const results = [...captured(), ...fleet(), result("minimax", [], { snapshot: null, error: "QuotaFetchError: meta session expired (HTTP 401) — run /login meta" }), result("xiaomi", [], { snapshot: { plan: null, identity: null, windows: [], note: "no quota endpoint" } })];
  for (const showInvalid of [false, true]) {
    for (const width of [60, 80, 100, 120, 170]) {
      for (const style of [PLAIN_TABLE_STYLE, SGR_STYLE]) {
        const table = buildTable(results, NOW, { showInvalid, width }, style);
        assert.ok(table.lines.every((line) => visibleWidth(line) <= width), `${width}:\n${table.lines.join("\n")}`);
        const headers = cells(strip(table.lines[0]!));
        assert.ok(headers.includes("Provider") && headers.includes("Status") && headers.every((header) => !header.includes("…")), `${width}: ${table.lines[0]}`);
      }
    }
  }
});

test("the tool report lists every provider with window states, errors, and optional models", () => {
  const reset = new Date(NOW.getTime() + 3600_000);
  const report = toolReport(
    { refreshedAt: NOW, results: [result("zai", [win("tokens (5h)", 95, 100, "%", reset)]), result("meta", [], { snapshot: null, rateLimited: true, retryAt: new Date(NOW.getTime() + 90_000), error: "rate limited" })] },
    NOW,
    { models: new Map([["zai", [{ id: "glm-5.3", efforts: ["off"] }, { id: "glm-4.6", efforts: ["low", "high"] }]]]), quotas: true, context: null },
  );
  assert.deepEqual(report.providers.map((p) => [p.provider, p.windows.map((w) => [w.name, w.state, w.resetsIn]), p.error, p.rateLimited]), [
    ["meta", [], "rate limited (429) · retry in 1m 30s", true],
    ["zai", [["tokens (5h)", "low", "1h 00m"]], null, false],
  ]);
  assert.deepEqual(report.models, { zai: [{ id: "glm-4.6", efforts: ["low", "high"] }, { id: "glm-5.3", efforts: ["off"] }] });
  assert.equal(toolReport({ refreshedAt: NOW, results: [] }, NOW, { models: null, quotas: true, context: null }).models, undefined);
});

const [SUCCESS, WARNING, ERROR, DIM] = ["32", "33", "31", "2"].map((code) => (text: string) => `\x1b[${code}m${text}\x1b[${code === "2" ? "22" : "39"}m`);

test("usage bars take the Status thresholds' colours; layout and text stay the same", () => {
  const results = [result("zai", [win("a (5h)", 38, 100, "%"), win("b (7d)", 93, 100, "%"), win("c (1mo)", 100, 100, "%"), { ...win("d", null, null, "requests"), unlimited: true }])];
  const plain = buildTable(results, NOW, { showInvalid: false, width: null }, PLAIN_TABLE_STYLE);
  const styled = buildTable(results, NOW, { showInvalid: false, width: null }, SGR_STYLE);
  assert.ok(plain.lines.every((l) => !l.includes("\x1b")), "headless output carries no escapes");
  // Styled cells keep trailing padding inside their escapes; visible text is otherwise identical.
  assert.deepEqual(styled.lines.map((l) => strip(l).trimEnd()), plain.lines);
  const row = (name: string): string => styled.lines.find((l) => strip(l).includes(name))!;
  assert.ok(row("a (5h)").includes(SUCCESS("████") + DIM("░░░░░░")), JSON.stringify(row("a (5h)")));
  assert.ok(row("b (7d)").includes(WARNING("█████████") + DIM("░")), JSON.stringify(row("b (7d)")));
  assert.ok(row("c (1mo)").includes(ERROR("██████████")) && !row("c (1mo)").includes("░"));
  assert.ok(!row("unlimited").includes("█") && !row("unlimited").includes(DIM("—")), JSON.stringify(row("unlimited")));
});
