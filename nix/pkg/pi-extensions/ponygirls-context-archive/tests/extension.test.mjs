import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { registerContextArchive, BADGE_KEY } from "../index.ts";
import { DEFAULT_PREFERENCES, FilePreferenceStore } from "../src/preferences.ts";
import { SESSION_SETTING_TYPE, SESSION_THRESHOLDS_TYPE, sessionOverrides } from "../src/session-settings.ts";
import { ARCHIVE_TYPE, RECALL_TOOL } from "../src/archive.ts";
import { apply, MemoryPreferences, productionHistory } from "./fixtures.mjs";

function fixture(t, backend) {
  const dir = mkdtempSync(join(tmpdir(), "archive-controller-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preferences = backend === "filesystem" ? new FilePreferenceStore(join(dir, "context-archive.json")) : new MemoryPreferences();
  return { dir, ...controller(preferences, SessionManager.inMemory()) };
}

function controller(preferences, manager) {
  const handlers = new Map(); const commands = new Map(); const tools = new Map();
  const widgets = []; const notifications = [];
  let active = ["bash"]; let aborts = 0;
  const pi = {
    on: (name, fn) => handlers.set(name, fn), registerCommand: (name, value) => commands.set(name, value),
    appendEntry: (type, data) => manager.appendCustomEntry(type, data),
    registerTool: (tool) => tools.set(tool.name, tool), getActiveTools: () => active, setActiveTools: (tools) => { active = tools; },
  };
  const ctx = { sessionManager: manager, mode: "rpc", model: { contextWindow: 80000 }, signal: undefined,
    getContextUsage: () => undefined,
    abort: () => { aborts++; }, ui: { notify: (message, level) => notifications.push({ message, level }), setWidget: (...args) => widgets.push(args) } };
  registerContextArchive(pi, preferences);
  const command = (args) => commands.get("context-archive").handler(args, ctx);
  const start = () => handlers.get("session_start")({}, ctx);
  const boundary = (overrides = {}) => handlers.get("turn_end")({ entries: [], outcome: "completed", context: { contextEntries: manager.buildSessionProjection().entries }, ...overrides }, ctx);
  return { pi, preferences, manager, handlers, commands, tools, widgets, notifications, ctx, command, start, boundary, active: () => active, setActive: (tools) => { active = tools; }, aborts: () => aborts };
}

// Controller behavior is identical against the in-memory preference port and real FS adapter.
for (const backend of ["memory", "filesystem"]) {
  test(`${backend}: default-off inert, persistent controls, bounded badge and no implicit inference`, async (t) => {
    const f = fixture(t, backend); productionHistory(f.manager); f.start();
    assert.equal(f.tools.get(RECALL_TOOL).exposure, "hidden");
    assert.equal(f.widgets.at(-1)[1], undefined);
    assert.equal(f.boundary(), undefined);
    assert.equal(f.manager.getBranch().some((e) => e.type === "context_edit"), false);
    await f.command("invalid"); assert.match(f.notifications.at(-1).message, /Usage/);
    await f.command("on"); assert.equal(f.preferences.read().enabled, false);
    assert.equal(f.tools.get(RECALL_TOOL).exposure, "direct");
    assert.ok(f.active().includes(RECALL_TOOL));
    const [key, factory, placement] = f.widgets.at(-1);
    assert.equal(key, BADGE_KEY); assert.equal(placement.placement, "borderBottomLeft");
    const component = factory(null, { fg: (_token, text) => text });
    assert.equal(component.render(80)[0], " 🗃️ ");
    assert.equal(component.renderCompact(80), " 🗃️ ");
    for (const width of [0, 1, 2, 3, 4, 12]) {
      assert.ok(visibleWidth(component.render(width)[0]) <= width);
      assert.ok(visibleWidth(component.renderCompact(width)) <= width);
    }
    f.start(); assert.equal(f.preferences.read().enabled, false, "session ON never changes the global default");
    const result = f.boundary(); assert.ok(result.entries.length > 0); assert.equal(result.continue, undefined);
    apply(f.manager, result.entries);
    await f.command("off"); assert.equal(f.preferences.read().enabled, false); assert.equal(f.widgets.at(-1)[1], undefined);
    assert.equal(f.tools.get(RECALL_TOOL).exposure, "direct", "existing archives still recoverable while off");
    const messages = f.manager.buildSessionProjection().messages;
    const original = structuredClone(messages);
    const restored = f.handlers.get("context")({ messages }, f.ctx).messages;
    assert.match(JSON.stringify(restored), /Historical invocation/);
    assert.deepEqual(messages, original, "no in-place provider/transcript mutation");
    const restoration = f.boundary(); assert.ok(restoration.entries.every((e) => e.type === "context_edit"));
    apply(f.manager, restoration.entries);
    assert.equal(f.boundary(), undefined);
    assert.equal(f.aborts(), 0);
    f.handlers.get("session_shutdown")({}, f.ctx); assert.equal(f.widgets.at(-1)[1], undefined);
  });
}

for (const backend of ["memory", "filesystem"]) {
  test(`${backend}: ON/OFF are session overrides, not global writes`, async (t) => {
    const f = fixture(t, backend); f.start();
    const globalBefore = structuredClone(f.preferences.read());
    await f.command("on");
    assert.deepEqual(f.preferences.read(), globalBefore, "session ON must not change the global default");
    assert.ok(f.active().includes(RECALL_TOOL));
    await f.command("off");
    assert.deepEqual(f.preferences.read(), globalBefore, "session OFF must not change the global default");
    assert.ok(!f.active().includes(RECALL_TOOL));
  });

  test(`${backend}: sessions inherit fresh defaults independently and explicit overrides win`, async (t) => {
    const f = fixture(t, backend); f.start();
    const reader = backend === "filesystem" ? new FilePreferenceStore(f.preferences.path) : f.preferences;
    const other = controller(reader, SessionManager.inMemory()); other.start();
    await f.command("on");
    await other.command("status"); assert.match(other.notifications.at(-1).message, /OFF \(inherited global default\)/);
    await other.command("default on");
    await f.command("off");
    await f.command("status"); assert.match(f.notifications.at(-1).message, /OFF \(session override; global default ON\)/);
    other.handlers.get("context")({ messages: [] }, other.ctx);
    assert.ok(other.active().includes(RECALL_TOOL));
    await other.command("default off");
    await f.command("on");
    await f.command("status"); assert.match(f.notifications.at(-1).message, /ON \(session override; global default OFF\)/);
    await f.command("inherit");
    assert.ok(!f.active().includes(RECALL_TOOL));
    await f.command("default on");
    other.handlers.get("context")({ messages: [] }, other.ctx);
    assert.ok(other.active().includes(RECALL_TOOL), "inherited session sees another controller's default change");
    await other.command("status"); assert.match(other.notifications.at(-1).message, /ON \(inherited global default\)/);
  });

  test(`${backend}: threshold commands are session-local and do not modify global defaults`, async (t) => {
    const f = fixture(t, backend); f.start();
    const before = structuredClone(f.preferences.read());
    await f.command("thresholds 80 55");
    assert.deepEqual(f.preferences.read(), before);
    await f.command("status");
    assert.match(f.notifications.at(-1).message, /archive trigger 64000 \(80%\).*44000 \(55%\)/);
  });

  test(`${backend}: global thresholds change real selection while session override stays ON`, async (t) => {
    const f = fixture(t, backend); productionHistory(f.manager); f.start(); await f.command("on");
    await f.command("default thresholds 100 90");
    assert.equal(f.preferences.read().enabled, false);
    assert.equal(f.boundary(), undefined, "higher trigger suppresses this otherwise eligible history");
    await f.command("default thresholds 60 40");
    assert.ok(f.boundary().entries.length > 0);
    assert.deepEqual(f.preferences.read(), { enabled: false, highWatermark: 0.6, lowWatermark: 0.4 });
    f.ctx.getContextUsage = () => ({ tokens: 71000, contextWindow: 80000, percent: 88.75 });
    await f.command("status");
    assert.match(f.notifications.at(-1).message, /48000 \(60%\).*32000 \(40%\)/);
    assert.match(f.notifications.at(-1).message, /ON \(session override/);
    await f.command("default thresholds 70 60");
    assert.equal(f.boundary().entries.filter((e) => e.type === "context_edit").length, 1);
    await f.command("default thresholds 70 40");
    assert.equal(f.boundary().entries.filter((e) => e.type === "context_edit").length, 2);
  });

  test(`${backend}: invalid command arity and threshold values cannot mutate settings`, async (t) => {
    const f = fixture(t, backend); f.start();
    const before = structuredClone(f.preferences.read());
    const invalidPairs = ["thresholds 70", "thresholds 70 50 extra", "thresholds 101 50", "thresholds 50 50", "thresholds 0 0", "thresholds 70 -1", "thresholds NaN 20", "thresholds Infinity 20", "thresholds 70x 20", "thresholds 0x46 20"];
    for (const args of ["on extra", "off extra", "inherit extra", "status extra", "default", "default yes", "default on extra", "thresholds inherit extra", "default thresholds", "default thresholds inherit", ...invalidPairs.flatMap((value) => [value, `default ${value}`])]) {
      await f.command(args);
      assert.deepEqual(f.preferences.read(), before, args);
      assert.equal(f.manager.getEntries().length, 0, args);
      assert.ok(["warning", "error"].includes(f.notifications.at(-1).level), args);
    }
    await f.command("thresholds 75.5 0");
    assert.deepEqual(f.preferences.read(), before);
    assert.deepEqual(sessionOverrides(f.manager.getEntries(), f.manager.getSessionId()).thresholds, { highWatermark: 0.755, lowWatermark: 0 });
    await f.command("thresholds 57 25");
    assert.match(f.notifications.at(-1).message, /\(57%\).*\(25%\)/);
  });
}

for (const backend of ["memory", "filesystem"]) {
  test(`${backend}: enablement and threshold layers inherit independently across sessions`, async (t) => {
    const f = fixture(t, backend); productionHistory(f.manager); f.start();
    const other = controller(backend === "filesystem" ? new FilePreferenceStore(f.preferences.path) : f.preferences, SessionManager.inMemory()); other.start();
    await f.command("on"); await f.command("thresholds 100 90");
    await other.command("default on"); await other.command("default thresholds 60 40");
    assert.equal(f.boundary(), undefined, "session pair wins over new global defaults");
    await f.command("status");
    assert.match(f.notifications.at(-1).message, /Threshold source: session override; global defaults 60% \/ 40%/);
    await other.command("status");
    assert.match(other.notifications.at(-1).message, /48000 \(60%\).*32000 \(40%\)/);
    assert.match(other.notifications.at(-1).message, /Threshold source: inherited global defaults/);
    await f.command("inherit");
    assert.equal(f.boundary(), undefined, "enablement inheritance leaves the session pair intact");
    await other.command("default off"); await f.command("on");
    await f.command("thresholds inherit");
    assert.ok(f.boundary().entries.length > 0, "threshold inheritance leaves explicit ON intact");
    await other.command("default thresholds 70 50");
    await f.command("status");
    assert.match(f.notifications.at(-1).message, /ON \(session override; global default OFF\)/);
    assert.match(f.notifications.at(-1).message, /56000 \(70%\).*40000 \(50%\)/);
    assert.match(f.notifications.at(-1).message, /Threshold source: inherited global defaults/);
  });

  test(`${backend}: effective session pair controls both watermarks across branch navigation and reload`, async (t) => {
    const f = fixture(t, backend); productionHistory(f.manager); const anchor = f.manager.getLeafId(); f.start();
    await f.command("on"); await f.command("default thresholds 100 90");
    assert.equal(f.boundary(), undefined);
    f.ctx.getContextUsage = () => ({ tokens: 71000, contextWindow: 80000, percent: 88.75 });
    await f.command("thresholds 70 60");
    assert.equal(f.boundary().entries.filter((e) => e.type === "context_edit").length, 1);
    await f.command("thresholds 70 40");
    assert.equal(f.boundary().entries.filter((e) => e.type === "context_edit").length, 2);
    f.manager.branch(anchor); f.handlers.get("session_tree")({}, f.ctx);
    const reloaded = controller(f.preferences, f.manager); reloaded.start();
    assert.equal(reloaded.boundary().entries.filter((e) => e.type === "context_edit").length, 2);
    await f.command("thresholds inherit");
    assert.equal(reloaded.boundary(), undefined);
    assert.deepEqual(f.preferences.read(), { enabled: false, highWatermark: 1, lowWatermark: 0.9 });
  });
}

test("session toggles leave legacy global defaults byte-identical and inherit uses their value", async (t) => {
  const f = fixture(t, "filesystem");
  const legacy = '{"version":1,"enabled":true}\n'; writeFileSync(f.preferences.path, legacy);
  f.start(); await f.command("off");
  assert.equal(readFileSync(f.preferences.path, "utf8"), legacy);
  await f.command("inherit");
  await f.command("thresholds 80 55"); await f.command("thresholds inherit");
  assert.ok(f.active().includes(RECALL_TOOL));
  assert.equal(readFileSync(f.preferences.path, "utf8"), legacy);
});

test("failed session append or global write cannot report a successful settings mutation", async (t) => {
  const f = fixture(t, "memory"); f.start();
  f.pi.appendEntry = () => { throw new Error("append denied"); };
  for (const command of ["on", "thresholds 80 55", "thresholds inherit"]) {
    await f.command(command);
    assert.equal(f.manager.getEntries().length, 0);
    assert.equal(f.notifications.at(-1).level, "error");
    assert.match(f.notifications.at(-1).message, /append denied/);
  }
  f.preferences.write = () => { throw new Error("write denied"); };
  for (const command of ["default on", "default thresholds 80 55"]) {
    await f.command(command);
    assert.deepEqual(f.preferences.read(), DEFAULT_PREFERENCES);
    assert.equal(f.notifications.at(-1).level, "error");
    assert.match(f.notifications.at(-1).message, /write denied/);
  }
});

test("tree tool-loadout restoration and explicit ON reconcile recall without overriding a manual inactive tool on ordinary requests", async (t) => {
  const f = fixture(t, "memory"); f.start(); await f.command("on");
  f.setActive(["bash"]);
  f.handlers.get("session_tree")({}, f.ctx);
  assert.ok(f.active().includes(RECALL_TOOL), "branch navigation must not silently inhibit automatic archival");
  f.setActive(["bash"]);
  await f.command("status");
  f.handlers.get("context")({ messages: [] }, f.ctx);
  assert.ok(!f.active().includes(RECALL_TOOL), "status and ordinary requests are not activation intents");
  await f.command("on");
  assert.ok(f.active().includes(RECALL_TOOL), "explicit ON must repair an inactive recovery loadout");
  await f.command("off");
  f.setActive(["bash", RECALL_TOOL]);
  f.handlers.get("session_tree")({}, f.ctx);
  assert.ok(!f.active().includes(RECALL_TOOL), "OFF also wins over a restored branch loadout without archives");
});

test("provider-aware usage drives both archive selection and numeric status", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start(); await f.command("on");
  f.ctx.model = { contextWindow: 1000000 };
  f.ctx.getContextUsage = () => ({ tokens: 806884, contextWindow: 1000000, percent: 80.6884 });
  assert.ok(f.boundary().entries.length > 0);
  await f.command("status");
  assert.match(f.notifications.at(-1).message, /806884.*1000000/);
  assert.match(f.notifications.at(-1).message, /700000/);
});

test("unknown usage falls back to the projection; resolved usage capacity wins over selected model capacity", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start(); await f.command("on");
  f.ctx.getContextUsage = () => ({ tokens: null, contextWindow: 80000, percent: null });
  assert.ok(f.boundary().entries.length > 0);
  f.ctx.getContextUsage = () => ({ tokens: 80000, contextWindow: 1000000, percent: 8 });
  assert.equal(f.boundary(), undefined, "do not compare resolved usage against another model's smaller capacity");
  await f.command("status"); assert.match(f.notifications.at(-1).message, /80000 \/ 1000000/);
});

test("pending edits and compaction invalidate provider usage before publication", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start(); await f.command("on");
  f.ctx.getContextUsage = () => ({ tokens: 806884, contextWindow: 1000000, percent: 80.6884 });
  const user = f.manager.getBranch().find((e) => e.type === "message" && e.message.role === "user");
  for (const draft of [
    { type: "context_edit", targetId: user.id, replacement: { content: "Small replacement" } },
    { type: "compaction", summary: "Small checkpoint", firstKeptEntryId: null },
  ]) assert.equal(f.boundary({ entries: [draft] }), undefined);
});

test("pending custom messages add estimated tokens to valid provider pressure", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start(); await f.command("on");
  f.ctx.getContextUsage = () => ({ tokens: 699000, contextWindow: 1000000, percent: 69.9 });
  assert.equal(f.boundary(), undefined);
  const draft = { type: "custom_message", customType: "foreign", content: "n".repeat(8000), display: false };
  const planned = f.boundary({ entries: [draft] });
  assert.deepEqual(planned.entries[0], draft);
  assert.ok(planned.entries.some((e) => e.type === "context_edit"));
});

test("foreign-edited content still counts toward fallback pressure and remains protected", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start(); await f.command("on");
  f.ctx.model = { contextWindow: 1000000 };
  const user = f.manager.getBranch().find((e) => e.type === "message" && e.message.role === "user");
  const draft = { type: "context_edit", targetId: user.id, replacement: { content: "n".repeat(2800000) } };
  const preview = SessionManager.inMemory("/fixture", undefined, [f.manager.getHeader(), ...f.manager.getEntries()]);
  apply(preview, [draft]);
  const planned = f.boundary({ entries: [draft], context: { contextEntries: preview.buildSessionProjection().entries } });
  assert.deepEqual(planned.entries[0], draft);
  assert.ok(planned.entries.slice(1).some((e) => e.type === "context_edit"));
  assert.ok(!planned.entries.slice(1).some((e) => e.type === "context_edit" && e.targetId === user.id));
});

test("aborted/error boundaries and aborted signals cannot archive or restore", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start(); await f.command("on");
  for (const outcome of ["aborted", "error"]) assert.equal(f.boundary({ outcome }), undefined);
  f.ctx.signal = AbortSignal.abort(); assert.equal(f.boundary(), undefined);
});

test("missing/unknown model capacity inhibits archival without aborting valid work", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start(); await f.command("on");
  for (const model of [undefined, { contextWindow: 0 }, { contextWindow: Number.NaN }]) {
    f.ctx.model = model;
    assert.equal(f.boundary(), undefined);
    assert.equal(f.aborts(), 0);
  }
  await f.command("thresholds 88 44");
  assert.match(f.notifications.at(-1).message, /trigger 88%, release toward 44%; model context capacity unknown/);
});

test("a prior handler's draft remains intact and its target cannot be overwritten", async (t) => {
  const f = fixture(t, "memory"); const ids = productionHistory(f.manager); f.start(); await f.command("on");
  const earlier = { type: "context_edit", targetId: ids.output, replacement: { content: [{ type: "text", text: "foreign replacement" }] } };
  const result = f.boundary({ entries: [earlier] });
  assert.equal(result, undefined, "excluding the result also protects its input group");
  // When unrelated prior entries exist, concatenate them, don't replace them.
  const custom = { type: "custom", customType: "foreign", data: { value: 1 } };
  const combined = f.boundary({ entries: [custom] }); assert.deepEqual(combined.entries[0], custom);
});

test("cross-instance preference changes are observed before the next request; invalid data is visible", async (t) => {
  const f = fixture(t, "filesystem"); productionHistory(f.manager); f.start(); await f.command("default on"); apply(f.manager, f.boundary().entries);
  new FilePreferenceStore(f.preferences.path).write({ ...DEFAULT_PREFERENCES, enabled: false });
  const restored = f.handlers.get("context")({ messages: f.manager.buildSessionProjection().messages }, f.ctx);
  assert.match(JSON.stringify(restored.messages), /Historical invocation/);
  writeFileSync(f.preferences.path, "invalid JSON");
  f.start(); f.start();
  assert.equal(f.notifications.filter((n) => n.level === "error").length, 1, "one visible warning per outage");
  assert.ok(f.widgets.at(-1)[1], "fault isn't displayed as a valid OFF state");
  new FilePreferenceStore(f.preferences.path).write({ ...DEFAULT_PREFERENCES });
  await f.command("off"); assert.equal(f.preferences.read().enabled, false);
});

test("invalid session settings stop selection visibly and a later explicit override repairs them", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start(); await f.command("on");
  f.manager.appendCustomEntry(SESSION_SETTING_TYPE, { version: 1, sessionId: f.manager.getSessionId(), enabled: "invalid" });
  assert.equal(f.boundary(), undefined);
  assert.match(f.notifications.at(-1).message, /session setting/);
  const badge = f.widgets.at(-1)[1](null, { fg: (_token, text) => text });
  assert.equal(badge.render(80)[0], " 🗃️ ! ");
  assert.equal(badge.renderCompact(80), " 🗃️ ! ");
  await f.command("status");
  assert.match(f.notifications.at(-1).message, /Threshold status unavailable due to settings error/);
  await f.command("on");
  assert.ok(f.boundary().entries.length > 0);
  assert.equal(f.aborts(), 0);
});

test("invalid threshold state cannot be repaired by ON and valid overrides cannot bypass corrupt defaults", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start(); await f.command("on");
  f.manager.appendCustomEntry(SESSION_THRESHOLDS_TYPE, { version: 1, sessionId: f.manager.getSessionId(), thresholds: { highWatermark: 0.4, lowWatermark: 0.8 } });
  assert.equal(f.boundary(), undefined);
  await f.command("on"); assert.equal(f.boundary(), undefined);
  await f.command("thresholds inherit"); assert.ok(f.boundary().entries.length > 0);
  await f.command("thresholds 70 50");
  f.preferences.failure = "invalid global defaults";
  assert.equal(f.boundary(), undefined);
  assert.match(f.notifications.at(-1).message, /invalid global defaults/);
  assert.equal(f.aborts(), 0);
});

test("unverifiable archive aborts the operation, never silently invents a replacement", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start();
  f.manager.appendCustomEntry(ARCHIVE_TYPE, { version: 999 });
  assert.throws(() => f.handlers.get("context")({ messages: f.manager.buildSessionProjection().messages }, f.ctx), /manifest/);
  assert.equal(f.aborts(), 1); assert.match(f.notifications.at(-1).message, /operation aborted/);
});

// Specified Behavioral-Active / Blackbox-Group: badge actions use the public UI boundary.
test("badge toggles a read-only status view, supports keyboard close, and closes on shutdown", async (t) => {
  const f = fixture(t, "memory"); f.ctx.mode = "tui"; f.ctx.hasUI = true;
  f.start(); await f.command("on");
  const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
  const views = [];
  f.ctx.ui.custom = (factory, options) => new Promise((resolve) => {
    const view = { closed: false, options };
    views.push(view);
    view.component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme,
      { matches: (data, action) => data === "\u001b" && action === "tui.select.cancel" }, () => { view.closed = true; resolve(); });
  });
  const badge = () => f.widgets.at(-1)[1](null, theme);
  assert.equal(typeof badge().handleMouse, "function", "archive badge must expose mouse actions");
  const click = { type: "click", button: "left", x: 0, y: 0 };
  const before = f.manager.getEntries().length;
  const defaults = structuredClone(f.preferences.read());
  assert.equal(badge().handleMouse({ ...click, button: "right" }), undefined);
  assert.equal(badge().handleMouse({ ...click, type: "release" }), undefined);
  assert.equal(views.length, 0);
  assert.equal(badge().handleMouse(click).handled, true);
  await new Promise(setImmediate);
  assert.equal(views.length, 1);
  assert.equal(views[0].options.retainEditorBorders, true);
  assert.match(views[0].component.render(100).join("\n"), /Context archive: ON/);
  assert.match(views[0].component.render(100).join("\n"), /archived entries on this branch/);
  assert.equal(badge().handleMouse(click).handled, true);
  await new Promise(setImmediate);
  assert.equal(views[0].closed, true);
  badge().handleMouse(click); await new Promise(setImmediate);
  views[1].component.handleInput("\u001b"); await new Promise(setImmediate);
  assert.equal(views[1].closed, true);
  badge().handleMouse(click); await new Promise(setImmediate);
  const oldBadge = badge();
  f.handlers.get("session_shutdown")({}, f.ctx); await new Promise(setImmediate);
  assert.equal(views[2].closed, true);
  f.start(); oldBadge.handleMouse(click); await new Promise(setImmediate);
  assert.equal(views.length, 3, "old-session badge callbacks remain revoked after restart");
  assert.equal(f.manager.getEntries().length, before, "view cannot write session preferences or archives");
  assert.deepEqual(f.preferences.read(), defaults);
});

// BG regression: complete one grammar token and never insert arbitrary thresholds.
test('argument completion handles nested defaults and whitespace without numeric presets', (t) => {
  const f = fixture(t, 'memory');
  const values = prefix => f.commands.get('context-archive').getArgumentCompletions(prefix)?.map(item => item.value) ?? null;
  assert.deepEqual(values('thr'), ['thresholds ']);
  assert.deepEqual(values('  DEFAULT\tth'), ['  DEFAULT\tthresholds ']);
  assert.deepEqual(values('default '), ['default on', 'default off', 'default thresholds ']);
  assert.deepEqual(values('thresholds '), ['thresholds inherit']);
  for (const prefix of ['default thresholds ', 'thresholds 85 ', 'thresholds 85 40 ', 'status ', 'bogus ']) assert.equal(values(prefix), null, prefix);
});
