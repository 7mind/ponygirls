import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { registerContextArchive, BADGE_KEY } from "../index.ts";
import { FilePreferenceStore } from "../src/preferences.ts";
import { ARCHIVE_TYPE, RECALL_TOOL } from "../src/archive.ts";
import { apply, productionHistory } from "./fixtures.mjs";

function fixture(t, backend) {
  const dir = mkdtempSync(join(tmpdir(), "archive-controller-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preferences = backend === "filesystem" ? new FilePreferenceStore(join(dir, "context-archive.json")) : { path: "memory", enabled: false, read() { return this.enabled; }, write(enabled) { this.enabled = enabled; } };
  const manager = SessionManager.inMemory();
  const handlers = new Map(); const commands = new Map(); const tools = new Map();
  const widgets = []; const notifications = [];
  let active = ["bash"]; let aborts = 0;
  const pi = {
    on: (name, fn) => handlers.set(name, fn), registerCommand: (name, value) => commands.set(name, value),
    registerTool: (tool) => tools.set(tool.name, tool), getActiveTools: () => active, setActiveTools: (tools) => { active = tools; },
  };
  const ctx = { sessionManager: manager, mode: "rpc", model: { contextWindow: 80000 }, signal: undefined,
    abort: () => { aborts++; }, ui: { notify: (message, level) => notifications.push({ message, level }), setWidget: (...args) => widgets.push(args) } };
  registerContextArchive(pi, preferences);
  const command = (args) => commands.get("context-archive").handler(args, ctx);
  const start = () => handlers.get("session_start")({}, ctx);
  const boundary = (overrides = {}) => handlers.get("turn_end")({ entries: [], outcome: "completed", context: { contextEntries: manager.buildSessionProjection().entries }, ...overrides }, ctx);
  return { dir, preferences, manager, handlers, commands, tools, widgets, notifications, ctx, command, start, boundary, active: () => active, setActive: (tools) => { active = tools; }, aborts: () => aborts };
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
    await f.command("on"); assert.equal(f.preferences.read(), true);
    assert.equal(f.tools.get(RECALL_TOOL).exposure, "direct");
    assert.ok(f.active().includes(RECALL_TOOL));
    const [key, factory, placement] = f.widgets.at(-1);
    assert.equal(key, BADGE_KEY); assert.equal(placement.placement, "borderBottomLeft");
    const component = factory(null, { fg: (_token, text) => text });
    assert.equal(component.render(80)[0], " CTX archive ");
    assert.ok(visibleWidth(component.render(4)[0]) <= 4);
    f.start(); assert.equal(f.preferences.read(), true, "session replacement retains preference");
    const result = f.boundary(); assert.ok(result.entries.length > 0); assert.equal(result.continue, undefined);
    apply(f.manager, result.entries);
    await f.command("off"); assert.equal(f.preferences.read(), false); assert.equal(f.widgets.at(-1)[1], undefined);
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
  const f = fixture(t, "filesystem"); productionHistory(f.manager); f.start(); await f.command("on"); apply(f.manager, f.boundary().entries);
  new FilePreferenceStore(f.preferences.path).write(false);
  const restored = f.handlers.get("context")({ messages: f.manager.buildSessionProjection().messages }, f.ctx);
  assert.match(JSON.stringify(restored.messages), /Historical invocation/);
  writeFileSync(f.preferences.path, "invalid JSON");
  f.start(); f.start();
  assert.equal(f.notifications.filter((n) => n.level === "error").length, 1, "one visible warning per outage");
  assert.ok(f.widgets.at(-1)[1], "fault isn't displayed as a valid OFF state");
  await f.command("off"); assert.equal(f.preferences.read(), false);
});

test("unverifiable archive aborts the operation, never silently invents a replacement", async (t) => {
  const f = fixture(t, "memory"); productionHistory(f.manager); f.start();
  f.manager.appendCustomEntry(ARCHIVE_TYPE, { version: 999 });
  assert.throws(() => f.handlers.get("context")({ messages: f.manager.buildSessionProjection().messages }, f.ctx), /manifest/);
  assert.equal(f.aborts(), 1); assert.match(f.notifications.at(-1).message, /operation aborted/);
});
