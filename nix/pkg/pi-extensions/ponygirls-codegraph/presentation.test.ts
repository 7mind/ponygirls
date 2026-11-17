import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PLAIN_THEME, borderBadge, borderBadgeCompact, type UiTheme } from "@ponygirls/pi-ui";
import { CodegraphStatusPane, codegraphBadge, stateNotice } from "./presentation.ts";
import type { State } from "./runtime.ts";
import { reportText, type ScopeStatus, type StatusSnapshot } from "./workspace.ts";

const theme: UiTheme = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
  bg: (color, text) => `[${color}]${text}[/${color}]`,
  bold: (text) => text,
};

test("state notices: empty is info, errors are one line without Error: prefixes or JSON, others are silent", () => {
  assert.deepEqual(stateNotice({ phase: "empty", detail: "/r: no indexable files (0 files, 0 symbols)" }),
    { text: "Codegraph: nothing indexed in this checkout yet · /cg status for details", level: "info" });
  assert.deepEqual(stateNotice({ phase: "error", detail: "Error: Index not ready at /r\n{\"fileCount\":3}" }),
    { text: "Codegraph: Index not ready at /r · /cg status for details", level: "error" });
  assert.deepEqual(stateNotice({ phase: "error", detail: "Error: Error: codegraph init exited 1: \nstdout text\n" }),
    { text: "Codegraph: codegraph init exited 1 · /cg status for details", level: "error" });
  assert.deepEqual(stateNotice({ phase: "error", detail: "\n" }),
    { text: "Codegraph: failed · /cg status for details", level: "error" });
  for (const phase of ["idle", "working", "ready", "skipped", "cancelled"] as const) {
    assert.equal(stateNotice({ phase, detail: "x" }), null, phase);
  }
});

test("badge: quiet when the index needs nothing; a word for work, chosen states and failure; querying outranks the phase", () => {
  const cases: [State["phase"], number, string, string][] = [
    ["ready", 0, " 🕸️ ", "🕸️"],
    ["idle", 0, " 🕸️ ", "🕸️"],
    ["working", 0, " 🕸️ <accent>indexing</accent> ", "🕸️<accent>▸</accent>"],
    ["ready", 1, " 🕸️ <accent>querying</accent> ", "🕸️<accent>▸</accent>"],
    ["skipped", 2, " 🕸️ <accent>querying 2</accent> ", "🕸️<accent>▸</accent>"],
    ["error", 0, " 🕸️ <error>error</error> ", "🕸️<error>✖</error>"],
    ["cancelled", 0, " 🕸️ <warning>cancelled</warning> ", "🕸️<warning>!</warning>"],
    ["empty", 0, " 🕸️ <muted>empty</muted> ", "🕸️"],
    ["skipped", 0, " 🕸️ <muted>off</muted> ", "🕸️"],
  ];
  for (const [phase, queries, full, compact] of cases) {
    const badge = codegraphBadge(phase, queries);
    assert.equal(borderBadge(theme, badge, 80), full, `${phase}/${queries}`);
    assert.equal(borderBadgeCompact(theme, badge, 80), compact, `${phase}/${queries} compact`);
  }
});

// ---- /cg status pane ---------------------------------------------------------

const HOME = "/home/u";
const NOW = Date.parse("2026-11-17T21:00:50.000Z");
const WIDTHS = [60, 80, 100, 120, 170] as const;
const LOCK_REFUSAL = "Error: codegraph sync exited 1: ✗ Failed to sync: Sync could not acquire the file lock; retry when the index is available. " +
  "CodeGraph database is locked by another process (kernel flock)\n";
const FAILURE = "Error: codegraph sync exited 3: database is locked\nsecond line with the complete CLI output, which is long enough to wrap in a narrow pane\n";

function scope(root: string, overrides: Partial<ScopeStatus>): ScopeStatus {
  return {
    root, kind: "checkout", commonDir: `${root}/.git`, isDefault: false, phase: "ready", busyElsewhere: null,
    lastCheck: { at: "2026-11-17T20:58:47.541Z", state: { phase: "ready", detail: `${root}: 2808 files, 106105 symbols` } },
    lastFailure: null, counts: { files: 2808, symbols: 106105 },
    size: { ok: true, value: { databaseBytes: 321822720, totalBytes: 321855717, partial: false, detail: null } },
    ...overrides,
  };
}
const never = { lastCheck: null, counts: null } as const;
const PONYGIRLS = scope("/home/u/work/flakes/ponygirls", { isDefault: true });
const ONE: StatusSnapshot = { discoveryError: null, lastBatch: [], scopes: [PONYGIRLS] };
const MANY: StatusSnapshot = {
  discoveryError: null,
  lastBatch: ["/home/u/work/other: error"],
  scopes: [
    scope("/home/u/work/other", { phase: "error", counts: null,
      lastCheck: { at: "2026-11-17T20:40:00.000Z", state: { phase: "error", detail: FAILURE } },
      lastFailure: { at: "2026-11-17T20:40:00.000Z", detail: FAILURE },
      size: { ok: true, value: { databaseBytes: 0, totalBytes: 0, partial: false, detail: null } } }),
    PONYGIRLS,
    scope("/home/u/work/flakes/ponygirls/.worktrees/wt-ponygirls-ux-review", { phase: "working",
      lastCheck: { at: "2026-11-17T17:55:00.000Z", state: { phase: "ready", detail: "x: 2790 files, 105900 symbols" } },
      counts: { files: 2790, symbols: 105900 },
      size: { ok: true, value: { databaseBytes: 12 * 1024 * 1024, totalBytes: 12 * 1024 * 1024, partial: true, detail: "codegraph.db-wal: Error: EACCES" } } }),
    scope("/srv/data/corpus", { kind: "workspace", commonDir: null, phase: "idle", ...never, size: { ok: false, error: "Error: unreadable index directory" } }),
    scope("/home/u/work/lib", { phase: "cancelled", counts: null,
      lastCheck: { at: "2026-11-17T20:59:30.000Z", state: { phase: "cancelled", detail: "Error: Codegraph operation cancelled" } },
      lastFailure: { at: "2026-11-17T20:40:00.000Z", detail: "Error: earlier failure" } }),
    scope("/home/u/work/empty", { phase: "empty", counts: { files: 0, symbols: 0 },
      lastCheck: { at: "2026-11-17T20:58:47.541Z", state: { phase: "empty", detail: "/home/u/work/empty: no indexable files (0 files, 0 symbols)" } } }),
    scope("/home/u/work/busy", { phase: "idle", ...never, busyElsewhere: { at: "2026-11-17T20:58:47.541Z", detail: LOCK_REFUSAL } }),
    scope("/home/u/work/off", { phase: "skipped", counts: null,
      lastCheck: { at: "2026-11-17T20:58:47.541Z", state: { phase: "skipped", detail: "no local index: /home/u/work/off" } } }),
  ],
};

/** Zero-width, distinguishable SGR per token, so styled lines keep their real widths. */
const PALETTE = ["text", "muted", "dim", "accent", "border", "success", "warning", "error", "selectedBg", "toolPendingBg"];
function paint(color: string, text: string): string {
  assert.ok(PALETTE.includes(color), color);
  return `\x1b[38;5;${PALETTE.indexOf(color) + 1}m${text}\x1b[39m`;
}
const SGR: UiTheme = {
  fg: paint,
  bg: (color, text) => `\x1b[48;5;${PALETTE.indexOf(color) + 1}m${text}\x1b[49m`,
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
};

interface Opened {
  pane: CodegraphStatusPane;
  closed(): number;
  lines(width: number): string[];
}
function open(status: StatusSnapshot, paneTheme: UiTheme, rows: number): Opened {
  let closed = 0;
  const pane = new CodegraphStatusPane({
    status, home: HOME, theme: paneTheme, keys: { matches: (data, action) => data === "\u001b" && action === "tui.select.cancel" },
    now: () => NOW, rows: () => rows, requestRender() {}, close: () => { closed++; },
  });
  return { pane, closed: () => closed, lines: (width) => pane.render(width).map((line) => line.trimEnd()) };
}
const UP = "\u001b[A";
const DOWN = "\u001b[B";
const PAGE_DOWN = "\u001b[6~";
const END = "\u001b[F";

test("status pane: one index at 120 columns is a table row, its detail and the keys", () => {
  assert.deepEqual(open(ONE, PLAIN_THEME, 40).lines(120), [
    `── Codegraph ${"─".repeat(96)} 1 index ──`,
    "  CHECKOUT                 STATE  FILES  SYMBOLS     SIZE  CHECKED",
    "▌ ~/work/flakes/ponygirls  ready  2,808  106,105  307 MiB  2m ago",
    "─".repeat(120),
    "last check ready · 2026-11-17 20:58 UTC · database 307 MiB, total 307 MiB",
    "common dir ~/work/flakes/ponygirls/.git",
    "─".repeat(120),
    "↑↓ select  d details  esc close",
  ]);
});

test("status pane: every line fits the terminal at 60 to 170 columns, in both views and both themes", () => {
  for (const status of [ONE, MANY, { ...MANY, discoveryError: `Error: ${"discovery could not read a directory ".repeat(8)}` }, { ...ONE, scopes: [] }]) {
    for (const paneTheme of [PLAIN_THEME, SGR]) {
      for (const width of [...WIDTHS, 30, 12]) {
        const view = open(status, paneTheme, 40);
        for (const key of ["", DOWN, DOWN, "d", PAGE_DOWN, "d", UP]) {
          if (key !== "") view.pane.handleInput(key);
          const lines = view.pane.render(width);
          assert.ok(lines.length > 0);
          for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${JSON.stringify(line)} is ${visibleWidth(line)} wide`);
        }
      }
    }
  }
});

test("status pane: narrowing hides Symbols, Files, Size, then Checked; checkout and state stay whole", () => {
  const optional = ["SYMBOLS", "FILES", "SIZE", "CHECKED"];
  const name = (header: string) => `${header.slice(0, 1)}${header.slice(1).toLowerCase()}`;
  let previous = -1;
  for (let width = 170; width >= 44; width--) {
    const lines = open(MANY, PLAIN_THEME, 60).lines(width);
    const header = lines[1]!;
    assert.match(header, /^  CHECKOUT +STATE/, `${width}: identity and state stay`);
    const hidden = optional.filter((column) => !header.includes(column));
    assert.deepEqual(hidden, optional.slice(0, hidden.length), `${width}: hidden in the specified order`);
    assert.ok(hidden.length >= previous, `${width}: a narrower pane never shows more`);
    previous = hidden.length;
    // The note names the hidden columns in table order, wrapped between words under the row gutter.
    const noteStart = lines.findIndex((line) => line.includes("hidden at this width"));
    const note = noteStart === -1 ? undefined : lines.slice(noteStart, lines.findIndex((line) => /^─+$/.test(line))).map((line) => line.trim()).join(" ");
    const named = ["FILES", "SYMBOLS", "SIZE", "CHECKED"].filter((column) => hidden.includes(column)).map(name);
    assert.equal(note, hidden.length === 0 ? undefined : `hidden at this width: ${named.join(", ")}`, `${width}`);
    for (const state of ["error", "ready · default", "indexing", "idle", "cancelled", "empty", "busy elsewhere", "skipped"]) {
      assert.ok(lines.some((line) => line.includes(`  ${state}`)), `${width}: state ${state} is shown whole`);
    }
    assert.ok(lines.every((line) => !/[A-Za-z0-9]…$/.test(line) || line.includes("/")), `${width}: no cell is clipped`);
  }
  assert.equal(previous, optional.length, "the narrowest pane keeps only checkout and state");
  const wide = open(MANY, PLAIN_THEME, 60).lines(170);
  assert.ok(wide.some((line) => line.includes("~/work/flakes/ponygirls/.worktrees/wt-ponygirls-ux-review  indexing")), "a path that fits is shown whole");
  assert.doesNotMatch(wide.join("\n"), /hidden at this width/);
});

test("status pane: an over-long path is shortened in the middle before columns are hidden for it", () => {
  const long = "/home/u/.pi/agent/subagents/01a1eb45-0e75-7445-876e-7978edd60dc1/worktrees/wt-ponygirls-3b753fc68cdd-1794954281718";
  const status: StatusSnapshot = { ...ONE, scopes: [scope(long, { isDefault: true })] };
  const at120 = open(status, PLAIN_THEME, 40).lines(120);
  assert.match(at120[1]!, /CHECKOUT +STATE +FILES +SYMBOLS +SIZE +CHECKED$/, "all columns stay at 120");
  assert.match(at120[2]!, /^▌ ~\/\.pi\/agent\/\S*…\S*-3b753fc68cdd-1794954281718  ready  2,808  106,105  307 MiB  2m ago$/);
  assert.equal(visibleWidth(at120[1]!), 120, "the path takes exactly the room the other columns leave");
  const at60 = open(status, PLAIN_THEME, 40).lines(60);
  assert.match(at60[2]!, /^▌ ~\/\S*…\S*1794954281718  ready /, "start and end of the path survive");
  const at30 = open(status, PLAIN_THEME, 40).lines(30);
  assert.match(at30[1]!, /^  CHECKOUT +STATE$/);
  assert.match(at30[2]!, /^▌ ~\/\S*…\S*281718  ready$/);
  assert.deepEqual(at30.slice(3, 5), ["  hidden at this width: Files,", "  Symbols, Size, Checked"], "the note wraps under the gutter");
});

test("status pane: numbers, sizes, ages and paths use the shared formats; zeros and unknowns stay quiet", () => {
  const lines = open(MANY, PLAIN_THEME, 60).lines(170);
  const row = (path: string) => lines.find((line) => line.slice(2).startsWith(`${path} `))!;
  assert.match(row("~/work/flakes/ponygirls"), /ready · default +2,808 +106,105 +307 MiB  2m ago$/);
  assert.match(row("~/work/flakes/ponygirls/.worktrees/wt-ponygirls-ux-review"), /indexing +2,790 +105,900 +12 MiB  3h 5m ago$/);
  assert.match(row("~/work/other"), /error +— +— +·  20m ago$/, "unknown counts are a dash, an absent index a dot");
  assert.match(row("/srv/data/corpus"), /idle +— +— +—  never$/, "a path outside home stays absolute; never checked says so");
  assert.match(row("~/work/empty"), /empty +· +· +307 MiB  2m ago$/, "zero is a quiet dot");
  assert.match(row("~/work/busy"), /busy elsewhere +— +— +307 MiB  never$/);
});

test("status pane: state colours follow the shared palette and the default scope starts selected", () => {
  const lines = open(MANY, SGR, 60).pane.render(170);
  const row = (path: string) => lines.find((line) => line.includes(`${path}\x1b[39m `))!;
  assert.ok(row("~/work/flakes/ponygirls").includes(`${paint("success", "ready")}${paint("muted", " · default")}`));
  assert.ok(row("wt-ponygirls-ux-review").includes(paint("accent", "indexing")));
  assert.ok(row("~/work/other").includes(paint("error", "error")));
  assert.ok(row("~/work/lib").includes(paint("warning", "cancelled")));
  for (const [path, state] of [["/srv/data/corpus", "idle"], ["~/work/empty", "empty"], ["~/work/busy", "busy elsewhere"], ["~/work/off", "skipped"]] as const) {
    assert.ok(row(path).includes(paint("muted", state)), state);
  }
  const band = SGR.bg("selectedBg", "").slice(0, -"\x1b[49m".length);
  const selected = lines.filter((line) => line.startsWith(band));
  assert.equal(selected.length, 1);
  assert.ok(selected[0]!.includes("~/work/flakes/ponygirls\x1b[39m "), "today's `*` scope is the initial selection");
  assert.ok(selected[0]!.includes(paint("muted", "2m ago")) && !selected[0]!.includes(paint("dim", "")), "no dim text on the selection band");
  assert.ok(row("~/work/other").includes(paint("dim", "—")), "unknown values are dim off the selection");
  assert.doesNotMatch(open(ONE, PLAIN_THEME, 40).lines(120).join("\n"), /default/, "a single scope needs no default tag");
  assert.ok(lines[0]!.includes([paint("error", "1 error"), paint("warning", "1 cancelled"), paint("accent", "1 indexing")].join(paint("dim", " · "))));
});

test("status pane: the title counts indexes, or names what is not ready", () => {
  const right = (status: StatusSnapshot) => /─ ([^─]+) ──$/.exec(open(status, PLAIN_THEME, 40).lines(170)[0]!)?.[1];
  const ready = (n: number) => scope(`/home/u/r${n}`, {});
  assert.equal(right(ONE), "1 index");
  assert.equal(right({ ...ONE, scopes: [ready(1), ready(2), ready(3)] }), "3 indexes");
  assert.equal(right({ ...ONE, scopes: [ready(1), scope("/home/u/w", { phase: "working" })] }), "1 indexing");
  assert.equal(right({ ...ONE, scopes: [ready(1), scope("/home/u/e", { phase: "error" })] }), "1 error");
  assert.equal(right(MANY), "1 error · 1 cancelled · 1 indexing · 1 busy elsewhere · 1 empty · 1 skipped · 1 idle");
  assert.equal(right({ ...ONE, discoveryError: "Error: no such directory" }), "discovery failed");
  assert.equal(open({ ...ONE, scopes: [] }, PLAIN_THEME, 40).lines(80)[0], `── Codegraph ${"─".repeat(67)}`);
});

test("status pane: the detail follows the selection and shows the complete failure, wrapped, in the error colour", () => {
  const view = open(MANY, PLAIN_THEME, 60);
  const detail = (width: number): string[] => {
    const lines = view.lines(width);
    const rules = lines.flatMap((line, index) => (/^─+$/.test(line) ? [index] : []));
    return lines.slice(rules[0]! + 1, rules[1]!);
  };
  assert.deepEqual(detail(120), [
    "last check ready · 2026-11-17 20:58 UTC · database 307 MiB, total 307 MiB",
    "common dir ~/work/flakes/ponygirls/.git",
  ]);
  view.pane.handleInput(UP);
  assert.deepEqual(detail(120), [
    "last check error · 2026-11-17 20:40 UTC · database 0 B, total 0 B",
    "common dir ~/work/other/.git",
    "codegraph sync exited 3: database is locked",
    "second line with the complete CLI output, which is long enough to wrap in a narrow pane",
  ]);
  assert.deepEqual(detail(60).slice(-3), [
    "codegraph sync exited 3: database is locked",
    "second line with the complete CLI output, which is long",
    "enough to wrap in a narrow pane",
  ], "long lines wrap between words and nothing of the failure is lost");
  view.pane.handleInput(UP);
  assert.deepEqual(detail(120)[0], "last check error · 2026-11-17 20:40 UTC · database 0 B, total 0 B", "selection stops at the first row");
  for (let n = 0; n < 2; n++) view.pane.handleInput(DOWN);
  assert.deepEqual(detail(120), [
    "last check ready · 2026-11-17 17:55 UTC · database 12 MiB, total 12 MiB",
    "common dir ~/work/flakes/ponygirls/.worktrees/wt-ponygirls-ux-review/.git",
    "size is partial: codegraph.db-wal: Error: EACCES",
  ]);
  view.pane.handleInput(DOWN);
  assert.deepEqual(detail(120), [
    "last check never · size unavailable: unreadable index directory",
    "workspace index, not a Git checkout",
  ]);
  view.pane.handleInput(DOWN);
  assert.deepEqual(detail(120), [
    "last check cancelled · 2026-11-17 20:59 UTC · database 307 MiB, total 307 MiB",
    "common dir ~/work/lib/.git",
    "last failure 2026-11-17 20:40 UTC",
    "earlier failure",
  ]);
  for (let n = 0; n < 2; n++) view.pane.handleInput(DOWN);
  assert.deepEqual(detail(170), [
    "last check never · database 307 MiB, total 307 MiB",
    "common dir ~/work/busy/.git",
    "busy elsewhere · 2026-11-17 20:58 UTC · another process held the index lock; the next query or /cg sync tries again",
  ]);
  for (let n = 0; n < 5; n++) view.pane.handleInput(DOWN);
  assert.match(detail(120)[1]!, /^common dir ~\/work\/off\/\.git$/, "selection stops at the last row");

  const styled = open(MANY, SGR, 60);
  styled.pane.handleInput(UP);
  const failure = styled.pane.render(120).filter((line) => line.startsWith(paint("error", "").slice(0, -"\x1b[39m".length)));
  assert.deepEqual(failure, [paint("error", "codegraph sync exited 3: database is locked"),
    paint("error", "second line with the complete CLI output, which is long enough to wrap in a narrow pane")]);
});

test("status pane: a refused sync of a verified index stays ready and says the last check stands", () => {
  const refused: StatusSnapshot = { ...ONE, scopes: [{ ...PONYGIRLS, busyElsewhere: { at: "2026-11-17T21:00:10.000Z", detail: LOCK_REFUSAL } }] };
  assert.deepEqual(open(refused, PLAIN_THEME, 40).lines(120).slice(0, 7), [
    `── Codegraph ${"─".repeat(96)} 1 index ──`,
    "  CHECKOUT                 STATE  FILES  SYMBOLS     SIZE  CHECKED",
    "▌ ~/work/flakes/ponygirls  ready  2,808  106,105  307 MiB  2m ago",
    "─".repeat(120),
    "last check ready · 2026-11-17 20:58 UTC · database 307 MiB, total 307 MiB",
    "common dir ~/work/flakes/ponygirls/.git",
    "busy elsewhere · 2026-11-17 21:00 UTC · another process held the index lock; the last check stands; /cg sync tries again",
  ]);
});

test("status pane: d shows the complete text report and d returns; esc and q close from both views", () => {
  const view = open(MANY, PLAIN_THEME, 200);
  const table = view.lines(120);
  assert.equal(table.at(-1), "↑↓ select  d details  esc close");
  view.pane.handleInput("d");
  const details = view.lines(120);
  const notReady = "1 error · 1 cancelled · 1 indexing · 1 busy elsewhere · 1 empty · 1 skipped · 1 idle";
  assert.equal(details[0], `── Codegraph · details ${"─".repeat(120 - "── Codegraph · details ".length - notReady.length - "  ──".length)} ${notReady} ──`);
  assert.equal(details.at(-1), "↑↓ scroll  PgUp/PgDn page  d table  esc close");
  const body = details.slice(1, -2).join("\n");
  assert.equal(body.replace(/\s+/g, ""), reportText(MANY).replace(/\s+/g, ""), "the report is complete and unchanged but for wrapping");
  assert.match(body, /Codegraph inventory — last checks, not live watcher health; logical bytes \(WAL\/SHM included\):/);
  assert.match(body, /"\/home\/u\/work\/busy" \[checkout\] busy elsewhere/);
  assert.match(body, /Aggregate total \d+ bytes \(partial\); 8 scopes/);
  view.pane.handleInput("d");
  assert.deepEqual(view.lines(120), table, "d returns to the table with its selection");
  assert.equal(view.closed(), 0);
  view.pane.handleInput("\u001b");
  view.pane.handleInput("d");
  view.pane.handleInput("q");
  view.pane.handleInput("\u001b");
  assert.equal(view.closed(), 3);
});

test("status pane: a short terminal windows the list around the selection and scrolls what does not fit", () => {
  const scopes = Array.from({ length: 40 }, (_, n) => scope(`/home/u/work/checkout-${String(n).padStart(2, "0")}`, { isDefault: n === 20 }));
  const view = open({ discoveryError: null, lastBatch: [], scopes }, PLAIN_THEME, 24);
  const lines = view.lines(100);
  assert.ok(lines.length <= 24, `${lines.length} lines on a 24-row terminal`);
  assert.match(lines[0]!, /^── Codegraph · 17–24 of 40 ─+ 40 indexes ──$/);
  assert.equal(lines.filter((line) => line.includes("checkout-")).length, 8 + 1, "eight rows and the selected row's common dir");
  assert.ok(lines.some((line) => line.startsWith("▌ ~/work/checkout-20 ")));
  for (let n = 0; n < 30; n++) view.pane.handleInput(DOWN);
  const end = view.lines(100);
  assert.match(end[0]!, /· 33–40 of 40 /);
  assert.ok(end.some((line) => line.startsWith("▌ ~/work/checkout-39 ")));

  const long = Array.from({ length: 60 }, (_, n) => `failure line ${n}`).join("\n");
  const failed = open({ ...ONE, scopes: [scope("/home/u/work/failed", { phase: "error", counts: null,
    lastCheck: { at: "2026-11-17T20:40:00.000Z", state: { phase: "error", detail: long } }, lastFailure: { at: "2026-11-17T20:40:00.000Z", detail: long } })] }, PLAIN_THEME, 24);
  const first = failed.lines(100);
  assert.ok(first.length <= 24);
  assert.match(first.join("\n"), /failure line 0\n/);
  assert.doesNotMatch(first.join("\n"), /failure line 59/);
  assert.equal(first.at(-1), "↑↓ select  PgUp/PgDn page  d details  esc close", "paging is offered only when the detail does not fit");
  failed.pane.handleInput(PAGE_DOWN);
  assert.doesNotMatch(failed.lines(100).join("\n"), /failure line 0\n/);
  failed.pane.handleInput(END);
  assert.match(failed.lines(100).join("\n"), /failure line 59/, "the complete failure is reachable");
  failed.pane.handleMouse({ type: "wheel", wheelDelta: -1000, button: "none", x: 0, y: 0, screenX: 0, screenY: 0, width: 100, height: 24, shift: false, alt: false, ctrl: false });
  assert.match(failed.lines(100).join("\n"), /failure line 0\n/, "the wheel scrolls the detail");
});

test("status pane: no scopes is one sentence that says how to get an index; a discovery failure is shown in full", () => {
  const empty = open({ discoveryError: null, lastBatch: [], scopes: [] }, PLAIN_THEME, 40);
  assert.deepEqual(empty.lines(120), [
    `── Codegraph ${"─".repeat(107)}`,
    "No checkouts listed. /cg discover PATH finds them; /cg init --workspace PATH indexes a directory without Git.",
    "─".repeat(120),
    "d details  esc close",
  ]);
  const failed = open({ discoveryError: "Error: EACCES: permission denied, scandir '/srv'", lastBatch: [], scopes: [] }, SGR, 40).pane.render(100);
  assert.ok(failed.includes(paint("error", "discovery failed: EACCES: permission denied, scandir '/srv'")));
  assert.ok(failed[0]!.includes(` ${paint("error", "discovery failed")} `), "the title names the failure in the error colour");
});

test("status pane: an allocated layout keeps the keys visible and gives the detail the remaining rows", async () => {
  const { VStack, Text } = await import("@earendil-works/pi-tui");
  const { renderLayoutFrame } = await import("@earendil-works/pi-tui/dist/layout.js");
  const long = Array.from({ length: 60 }, (_, n) => `failure line ${n}`).join("\n");
  const view = open({ ...ONE, scopes: [scope("/home/u/work/failed", { phase: "error", counts: null,
    lastCheck: { at: "2026-11-17T20:40:00.000Z", state: { phase: "error", detail: long } }, lastFailure: { at: "2026-11-17T20:40:00.000Z", detail: long } })] }, PLAIN_THEME, 30);
  const root = new VStack([
    { component: new Text("transcript", 0, 0), basis: 0, grow: 1, shrink: 1 },
    { component: view.pane, grow: 0, shrink: 1 },
    { component: new Text("badges\nPi status", 0, 0), shrink: 0 },
  ]);
  const frame = (): string[] => {
    renderLayoutFrame(root, 80, 18, () => {});
    return renderLayoutFrame(root, 80, 18, () => {}).lines.map((line: string) => line.trimEnd());
  };
  const first = frame();
  assert.equal(first.length, 18);
  assert.equal(first.at(-1), "Pi status");
  assert.equal(first.at(-3), "↑↓ select  PgUp/PgDn page  d details  esc close");
  assert.ok(first.includes("failure line 0"));
  view.pane.handleInput(END);
  const last = frame();
  assert.ok(last.includes("failure line 59"), "End reaches the last line of the failure in the allocated body");
  assert.equal(last.at(-3), "↑↓ select  PgUp/PgDn page  d details  esc close");
});

test("status pane: check times that are not timestamps are refused when the pane opens", () => {
  assert.throws(() => open({ ...ONE, scopes: [scope("/home/u/x", { lastCheck: { at: "fixture-time", state: { phase: "ready", detail: "/home/u/x: 1 files, 1 symbols" } } })] }, PLAIN_THEME, 40),
    /Invalid Codegraph check time: fixture-time/);
});
