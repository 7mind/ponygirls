import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SESSION_SETTING_TYPE, SESSION_THRESHOLDS_TYPE, sessionOverrides } from "../src/session-settings.ts";

function appendEnabled(manager, enabled) {
  return manager.appendCustomEntry(SESSION_SETTING_TYPE, { version: 1, sessionId: manager.getSessionId(), enabled });
}
function appendThresholds(manager, thresholds) {
  return manager.appendCustomEntry(SESSION_THRESHOLDS_TYPE, { version: 1, sessionId: manager.getSessionId(), thresholds });
}
const state = (manager) => sessionOverrides(manager.getEntries(), manager.getSessionId());

// Behavioral-active blackbox/group: append-only session records, no provider or filesystem.
test("session overrides span branches and enablement inheritance preserves threshold overrides", () => {
  const manager = SessionManager.inMemory();
  const root = manager.appendMessage({ role: "user", content: "Branch anchor", timestamp: 1 });
  const pair = { highWatermark: 0.8, lowWatermark: 0.4 };
  assert.deepEqual(state(manager), { enabled: null, thresholds: null });
  const on = appendEnabled(manager, true); appendThresholds(manager, pair);
  manager.branch(root);
  assert.deepEqual(state(manager), { enabled: true, thresholds: pair });
  appendEnabled(manager, false);
  manager.branch(on);
  assert.deepEqual(state(manager), { enabled: false, thresholds: pair });
  appendEnabled(manager, null);
  assert.deepEqual(state(manager), { enabled: null, thresholds: pair });
});

test("latest threshold inheritance terminates older pairs without clearing explicit OFF", () => {
  const manager = SessionManager.inMemory();
  const first = appendThresholds(manager, { highWatermark: 0.8, lowWatermark: 0.4 });
  appendEnabled(manager, false);
  appendThresholds(manager, { highWatermark: 0.6, lowWatermark: 0.2 });
  manager.branch(first);
  assert.deepEqual(state(manager), { enabled: false, thresholds: { highWatermark: 0.6, lowWatermark: 0.2 } });
  appendThresholds(manager, null);
  assert.deepEqual(state(manager), { enabled: false, thresholds: null });
});

test("forked session IDs do not inherit either copied parent override", () => {
  const manager = SessionManager.inMemory();
  appendEnabled(manager, true); appendThresholds(manager, { highWatermark: 0.8, lowWatermark: 0.4 });
  const parentId = manager.getSessionId();
  manager.createBranchedSession(manager.getLeafId());
  assert.notEqual(manager.getSessionId(), parentId);
  assert.ok(manager.getEntries().some((e) => e.type === "custom" && e.customType === SESSION_THRESHOLDS_TYPE));
  assert.deepEqual(state(manager), { enabled: null, thresholds: null });
  appendEnabled(manager, false);
  assert.deepEqual(state(manager), { enabled: false, thresholds: null });
});

test("invalid latest enablement faults instead of reviving older ON; a later record repairs only that setting", () => {
  for (const malformed of [{ version: 2, enabled: true }, { version: 1, enabled: "true" }, { version: 1 }]) {
    const manager = SessionManager.inMemory(); appendEnabled(manager, true);
    const pair = { highWatermark: 0.8, lowWatermark: 0.4 }; appendThresholds(manager, pair);
    manager.appendCustomEntry(SESSION_SETTING_TYPE, { sessionId: manager.getSessionId(), ...malformed });
    assert.throws(() => state(manager), /session setting/);
    appendEnabled(manager, false);
    assert.deepEqual(state(manager), { enabled: false, thresholds: pair });
  }
});

test("threshold pairs are validated atomically and enablement changes cannot hide an invalid pair", () => {
  for (const malformed of [
    { version: 2, thresholds: null }, { version: 1 }, { version: 1, thresholds: true },
    { version: 1, thresholds: { highWatermark: 0.8 } },
    { version: 1, thresholds: { highWatermark: 0.4, lowWatermark: 0.8 } },
    { version: 1, thresholds: { highWatermark: Infinity, lowWatermark: 0.4 } },
  ]) {
    const manager = SessionManager.inMemory(); appendEnabled(manager, true);
    appendThresholds(manager, { highWatermark: 0.8, lowWatermark: 0.4 });
    manager.appendCustomEntry(SESSION_THRESHOLDS_TYPE, { sessionId: manager.getSessionId(), ...malformed });
    assert.throws(() => state(manager), /session setting|watermarks/);
    appendEnabled(manager, false);
    assert.throws(() => state(manager), /session setting|watermarks/);
    appendThresholds(manager, null);
    assert.deepEqual(state(manager), { enabled: false, thresholds: null });
  }
});

test("foreign records are ignored while unbound malformed records fail visibly", () => {
  for (const type of [SESSION_SETTING_TYPE, SESSION_THRESHOLDS_TYPE]) {
    const manager = SessionManager.inMemory(); appendEnabled(manager, true);
    const pair = { highWatermark: 0.8, lowWatermark: 0.4 }; appendThresholds(manager, pair);
    manager.appendCustomEntry(type, { sessionId: "another-session", version: 999 });
    assert.deepEqual(state(manager), { enabled: true, thresholds: pair });
    manager.appendCustomEntry(type, { version: 1 });
    assert.throws(() => state(manager), /missing sessionId/);
  }
});

test("already resolved settings ignore older invalid records while the other setting is still sought", () => {
  const manager = SessionManager.inMemory();
  appendThresholds(manager, { highWatermark: 0.8, lowWatermark: 0.4 });
  manager.appendCustomEntry(SESSION_SETTING_TYPE, { version: 999 });
  appendEnabled(manager, null);
  assert.deepEqual(state(manager), { enabled: null, thresholds: { highWatermark: 0.8, lowWatermark: 0.4 } });
  const other = SessionManager.inMemory();
  appendEnabled(other, false);
  other.appendCustomEntry(SESSION_THRESHOLDS_TYPE, { version: 999 });
  appendThresholds(other, null);
  assert.deepEqual(state(other), { enabled: false, thresholds: null });
});
