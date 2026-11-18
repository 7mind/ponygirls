// Specified Behavioral-Active / Blackbox-Group: the status pane is rendered through the shared facts view.
import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PLAIN_THEME, homeRelative } from "@ponygirls/pi-ui";
import { BADGE_KEY, archiveStatusView, registerContextArchive } from "../index.ts";
import { ARCHIVE_TYPE } from "../src/archive.ts";
import { apply, MemoryPreferences, productionHistory } from "./fixtures.mjs";

const HOME = "/home/u";
const WIDTHS = [60, 80, 100, 120, 170];
/** The status text captured before this view existed; it stays available behind `d`. */
const OBSERVED = `Context archive: ON (inherited global default)
0 archived entries on this branch. Last boundary: no boundary evaluated.
Pi context usage: 0 / 500000 tokens; archive trigger 350000 (70%), release toward 250000 (50%).
Threshold source: inherited global defaults; global defaults 70% / 50%.
Automatic selection begins at a completed-turn boundary; no summarizer calls.
Global defaults: /home/u/.pi/agent/context-archive.json
Effective sources: enabled=global; thresholds=default.
Project settings: /home/u/work/flakes/ponygirls/.pi/context-archive.json`;
const ready = Object.freeze({
  kind: "ready", enabled: true, enabledSource: "global", thresholds: { highWatermark: 0.7, lowWatermark: 0.5 }, thresholdsSource: "default",
  archived: 0, tokens: 0, contextWindow: 500000, globalPath: "/home/u/.pi/agent/context-archive.json",
  cwd: "/home/u/work/flakes/ponygirls", projectPath: "/home/u/work/flakes/ponygirls/.pi/context-archive.json", projectTrusted: true,
});
const fault = Object.freeze({ kind: "fault", message: "Error: Expected enabled:boolean in context archive defaults", globalPath: "/home/u/.pi/agent/context-archive.json" });
/** Zero-width, distinguishable SGR codes per token, so widths stay real. */
const CODES = { text: 1, muted: 2, dim: 3, accent: 4, border: 5, success: 6, warning: 7, error: 8 };
const colored = (color, text) => `\x1b[38;5;${CODES[color]}m${text}\x1b[39m`;
const COLORS = { fg: colored, bg: (_color, text) => text, bold: (text) => text };
const view = (status, theme) => archiveStatusView({ status, text: OBSERVED, home: HOME },
  { theme, keys: { matches: () => false }, rows: () => 400, requestRender() {}, close() {} });
const plain = (status, width) => view(status, PLAIN_THEME).render(width);
/** The value of one labelled fact, unwrapped. */
const fact = (status, label) => {
  const row = plain(status, 400).map((line) => new RegExp(`^ {2}${label} {2,}(.*)$`).exec(line)).find((match) => match !== null);
  return row === undefined ? null : row[1];
};

test("the inherited ON status reads state first, as the specified 120-column pane", () => {
  assert.deepEqual(plain(ready, 120), [
    `── Context archive ${"─".repeat(78)} on · global default ──`,
    "  State       on (global default) · nothing archived on this branch yet",
    "  Context     0 / 500k tokens",
    "  Thresholds  archive at 70% (350k) → release to 50% (250k) · defaults",
    "  Settings    ~/.pi/agent/context-archive.json · project .pi/context-archive.json",
    "─".repeat(120),
    "↑↓ scroll  d details  esc close",
  ]);
});

test("facts and details fit every supported width in ready, overridden and fault states", () => {
  const overridden = { ...ready, enabled: false, enabledSource: "session", thresholdsSource: "project", thresholds: { highWatermark: 0.825, lowWatermark: 0.3 },
    archived: 1234, tokens: 806884, contextWindow: 1000000, projectTrusted: false };
  for (const [name, status] of Object.entries({ ready, overridden, fault })) for (const theme of [PLAIN_THEME, COLORS]) for (const width of WIDTHS) {
    const pane = view(status, theme);
    const facts = pane.render(width);
    assert.equal(visibleWidth(facts[0]), width, `${name} title at ${width}`);
    assert.ok(facts.every((line) => visibleWidth(line) <= width), `${name} facts at ${width}`);
    assert.match(facts[0].replace(/\x1b\[[0-9;]*m/g, ""), /^── Context archive ─/, `${name} keeps its name at ${width}`);
    pane.handleInput("d");
    const details = pane.render(width);
    assert.ok(details.every((line) => visibleWidth(line) <= width), `${name} details at ${width}`);
  }
});

test("details are the complete earlier status text, verbatim, under the same title", () => {
  const pane = view(ready, PLAIN_THEME);
  pane.handleInput("d");
  const details = pane.render(400);
  assert.match(details[0], /^── Context archive ─+ on · global default ──$/);
  assert.deepEqual(details.slice(1, -2).map((line) => line.trimEnd()), OBSERVED.split("\n"));
  assert.equal(details.at(-1), "↑↓ scroll  d facts  esc close");
});

test("amounts are compact, counts carry their number, and sources name the deciding scope", () => {
  const busy = { ...ready, archived: 1234, tokens: 806884, contextWindow: 1000000 };
  assert.equal(fact(busy, "State"), "on (global default) · 1,234 archived entries on this branch");
  assert.equal(fact({ ...busy, archived: 1 }, "State"), "on (global default) · 1 archived entry on this branch");
  assert.equal(fact(busy, "Context"), "807k / 1M tokens");
  assert.equal(fact(busy, "Thresholds"), "archive at 70% (700k) → release to 50% (500k) · defaults");
  assert.equal(fact({ ...busy, tokens: null }, "Context"), "unknown / 1M tokens");
  const session = { ...ready, enabled: false, enabledSource: "session", thresholdsSource: "session", thresholds: { highWatermark: 0.825, lowWatermark: 0.3 } };
  assert.equal(fact(session, "State"), "off (session override) · nothing archived on this branch");
  assert.equal(fact(session, "Thresholds"), "archive at 82.5% (413k) → release to 30% (150k) · session override");
  assert.match(plain(session, 120)[0], / off · session override ──$/);
  const project = { ...ready, enabledSource: "project", thresholdsSource: "project" };
  assert.equal(fact(project, "State"), "on (project override) · nothing archived on this branch yet");
  assert.equal(fact(project, "Thresholds"), "archive at 70% (350k) → release to 50% (250k) · project override");
  assert.match(plain(project, 120)[0], / on · project override ──$/);
  for (const origin of ["default", "managed", "global"]) {
    assert.equal(fact({ ...ready, enabledSource: origin, thresholdsSource: origin }, "State"), "on (global default) · nothing archived on this branch yet", origin);
    assert.equal(fact({ ...ready, enabledSource: origin, thresholdsSource: origin }, "Thresholds"), "archive at 70% (350k) → release to 50% (250k) · defaults", origin);
  }
  const unknown = { ...ready, tokens: null, contextWindow: null };
  assert.equal(fact(unknown, "Context"), "model context capacity unknown");
  assert.equal(fact(unknown, "Thresholds"), "archive at 70% → release to 50% · defaults");
});

test("paths are home-relative and the project file is relative to its project", () => {
  assert.equal(fact(ready, "Settings"), "~/.pi/agent/context-archive.json · project .pi/context-archive.json");
  assert.equal(fact({ ...ready, projectTrusted: false }, "Settings"), "~/.pi/agent/context-archive.json · project .pi/context-archive.json (ignored: untrusted)");
  const elsewhere = { ...ready, globalPath: "/etc/pi/context-archive.json", projectPath: "/home/u/shared/context-archive.json" };
  assert.equal(fact(elsewhere, "Settings"), "/etc/pi/context-archive.json · project ~/shared/context-archive.json");
});

test("state colours: on is ok, off is settled, and a fault asks for attention with its reason", () => {
  const on = view(ready, COLORS).render(400);
  assert.ok(on[0].includes(colored("success", "on · global default")));
  assert.ok(on[1].includes(colored("success", "on (global default)")));
  assert.doesNotMatch(on.join("\n"), /\x1b\[38;5;[78]m/, "no attention or error colour while healthy");
  const off = view({ ...ready, enabled: false }, COLORS).render(400);
  assert.ok(off[0].includes(colored("muted", "off · global default")));
  assert.ok(off[1].includes(colored("muted", "off (global default)")));
  const broken = view(fault, COLORS).render(400);
  assert.ok(broken[0].includes(colored("warning", "attention")));
  assert.ok(broken[1].includes(colored("warning", "archival stopped")));
  assert.ok(broken[1].includes(colored("warning", "Error: Expected enabled:boolean in context archive defaults")));
  assert.deepEqual(plain(fault, 120).slice(1, -2), [
    "  State     archival stopped · Error: Expected enabled:boolean in context archive defaults",
    "  Settings  ~/.pi/agent/context-archive.json",
  ]);
});

function controller() {
  const preferences = new MemoryPreferences(), manager = SessionManager.inMemory();
  const handlers = new Map(), commands = new Map(), widgets = new Map(), notifications = [], views = [];
  let active = ["bash"];
  const pi = {
    on: (name, fn) => handlers.set(name, fn), registerCommand: (name, value) => commands.set(name, value),
    appendEntry: (type, data) => manager.appendCustomEntry(type, data),
    registerTool() {}, getActiveTools: () => active, setActiveTools: (tools) => { active = tools; },
  };
  const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
  const ctx = { cwd: "/fixture", isProjectTrusted: () => false, hasUI: true, sessionManager: manager, mode: "tui", model: { contextWindow: 80000 }, signal: undefined,
    getContextUsage: () => undefined, abort() {},
    ui: {
      notify: (message, level) => notifications.push({ message, level }), setWidget: (key, factory) => widgets.set(key, factory),
      custom: (factory, options) => new Promise((resolve) => {
        const record = { closed: false, options };
        views.push(record);
        record.component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme,
          { matches: (data, action) => data === "\u001b" && action === "tui.select.cancel" }, () => { record.closed = true; resolve(); });
      }),
    } };
  registerContextArchive(pi, preferences);
  const command = (args, context = ctx) => commands.get("context-archive").handler(args, context);
  handlers.get("session_start")({}, ctx);
  const boundary = () => handlers.get("turn_end")({ entries: [], outcome: "completed", context: { contextEntries: manager.buildSessionProjection().entries } }, ctx);
  return { ctx, manager, preferences, handlers, notifications, views, command, boundary, badge: () => widgets.get(BADGE_KEY)(null, theme) };
}

test("bare /context-archive and /context-archive status open the facts pane in the TUI instead of a notification", async () => {
  const f = controller();
  for (const args of ["", "status", "  STATUS "]) {
    const opened = f.views.length;
    const showing = f.command(args);
    await new Promise(setImmediate);
    assert.equal(f.views.length, opened + 1, `"/context-archive ${args}" opens a pane`);
    assert.deepEqual(f.notifications, [], "the TUI shows the pane instead of printing the status");
    assert.equal(f.views.at(-1).options.retainEditorBorders, true);
    const pane = f.views.at(-1).component;
    for (const width of WIDTHS) assert.ok(pane.render(width).every((line) => visibleWidth(line) <= width), `width ${width}`);
    assert.deepEqual(pane.render(100), [
      `── Context archive ${"─".repeat(57)} off · global default ──`,
      "  State       off (global default) · nothing archived on this branch",
      "  Context     unknown / 80k tokens",
      "  Thresholds  archive at 70% (56k) → release to 50% (40k) · defaults",
      `  Settings    ${homeRelative("memory:context-archive", homedir())} · project .pi/context-archive.json (ignored: untrusted)`,
      "─".repeat(100),
      "↑↓ scroll  d details  esc close",
    ]);
    pane.handleInput("d");
    const details = pane.render(400).slice(1, -2).map((line) => line.trimEnd());
    // The same builder feeds print/RPC mode, so nothing shown before this pane existed is lost.
    await f.command(args, { ...f.ctx, mode: "rpc" });
    assert.deepEqual(details, f.notifications.pop().message.split("\n"));
    assert.equal(details[0], "Context archive: OFF (inherited global default)");
    assert.equal(details[1], "0 archived entries on this branch. Last boundary: no boundary evaluated.");
    assert.ok(details.includes("Effective sources: enabled=default; thresholds=default."));
    pane.handleInput("\u001b");
    await showing;
    assert.equal(f.views.at(-1).closed, true);
  }
});

test("outside the TUI the status stays a notification with the complete text", async () => {
  const f = controller();
  for (const context of [{ ...f.ctx, mode: "rpc" }, { ...f.ctx, mode: "print" }, { ...f.ctx, hasUI: false }]) for (const args of ["", "status"]) {
    await f.command(args, context);
    const notice = f.notifications.pop();
    assert.equal(notice.level, "info");
    assert.match(notice.message, /^Context archive: OFF \(inherited global default\)\n0 archived entries on this branch\. Last boundary: no boundary evaluated\.\n/);
    assert.match(notice.message, /\nPi context usage: unknown \/ 80000 tokens; archive trigger 56000 \(70%\), release toward 40000 \(50%\)\.\n/);
  }
  assert.equal(f.views.length, 0);
});

test("the command and the badge show the same pane; archived entries and the last boundary are reported", async () => {
  const f = controller(); productionHistory(f.manager);
  await f.command("on");
  f.notifications.length = 0;
  apply(f.manager, f.boundary().entries);
  const archived = f.manager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === ARCHIVE_TYPE).length;
  assert.ok(archived > 0);
  f.badge().handleMouse({ type: "click", button: "left", x: 0, y: 0 });
  await new Promise(setImmediate);
  const fromBadge = f.views[0].component.render(120);
  assert.match(fromBadge[0], /^── Context archive ─+ on · session override ──$/);
  assert.match(fromBadge[1], /^ {2}State {7}on \(session override\) · \d+ archived entr(?:y|ies) on this branch$/);
  f.views[0].component.handleInput("d");
  assert.match(f.views[0].component.render(400).join("\n"), /archived entries on this branch\. Last boundary: (?!no boundary evaluated)/);
  f.views[0].component.handleInput("\u001b");
  await new Promise(setImmediate);
  assert.equal(f.views[0].closed, true);
  const showing = f.command("status");
  await new Promise(setImmediate);
  assert.equal(f.views.length, 2);
  assert.deepEqual(f.views[1].component.render(120), fromBadge);
  f.views[1].component.handleInput("\u001b");
  await showing;
  assert.deepEqual(f.notifications, []);
});

test("a settings fault opens the pane in the attention state with the reason", async () => {
  const f = controller();
  f.preferences.failure = "invalid global defaults";
  f.handlers.get("context")({ messages: [] }, f.ctx);
  f.notifications.length = 0;
  const showing = f.command("status");
  await new Promise(setImmediate);
  const pane = f.views[0].component;
  const facts = pane.render(100);
  assert.match(facts[0], /^── Context archive ─+ attention ──$/);
  assert.equal(facts[1], "  State     archival stopped · Error: invalid global defaults");
  assert.equal(facts[2], `  Settings  ${homeRelative("memory:context-archive", homedir())}`);
  pane.handleInput("d");
  assert.match(pane.render(100).join("\n"), /Context archive: ERROR \(settings error\)/);
  pane.handleInput("\u001b");
  await showing;
});
