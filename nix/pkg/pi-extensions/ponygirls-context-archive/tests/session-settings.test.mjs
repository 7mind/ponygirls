import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SESSION_SETTING_TYPE, sessionOverride } from "../src/session-settings.ts";

function append(manager, enabled) {
  return manager.appendCustomEntry(SESSION_SETTING_TYPE, { version: 1, sessionId: manager.getSessionId(), enabled });
}

// Behavioral-active blackbox/group: append-only session records, no provider or filesystem.
test("session overrides span branches and the latest explicit inherit stops older overrides", () => {
  const manager = SessionManager.inMemory();
  const root = manager.appendMessage({ role: "user", content: "Branch anchor", timestamp: 1 });
  assert.equal(sessionOverride(manager.getEntries(), manager.getSessionId()), null);
  const on = append(manager, true);
  manager.branch(root);
  assert.equal(sessionOverride(manager.getEntries(), manager.getSessionId()), true);
  append(manager, false);
  manager.branch(on);
  assert.equal(sessionOverride(manager.getEntries(), manager.getSessionId()), false);
  append(manager, null);
  assert.equal(sessionOverride(manager.getEntries(), manager.getSessionId()), null);
});

test("forked session IDs do not inherit copied parent overrides", () => {
  const manager = SessionManager.inMemory();
  append(manager, true); const parentId = manager.getSessionId();
  manager.createBranchedSession(manager.getLeafId());
  assert.notEqual(manager.getSessionId(), parentId);
  assert.ok(manager.getEntries().some((e) => e.type === "custom" && e.customType === SESSION_SETTING_TYPE));
  assert.equal(sessionOverride(manager.getEntries(), manager.getSessionId()), null);
  append(manager, false);
  assert.equal(sessionOverride(manager.getEntries(), manager.getSessionId()), false);
});

test("invalid latest session state faults instead of reviving an older ON; explicit later state repairs it", () => {
  for (const malformed of [{ version: 2, enabled: true }, { version: 1, enabled: "true" }, { version: 1 }]) {
    const manager = SessionManager.inMemory(); append(manager, true);
    manager.appendCustomEntry(SESSION_SETTING_TYPE, { sessionId: manager.getSessionId(), ...malformed });
    assert.throws(() => sessionOverride(manager.getEntries(), manager.getSessionId()), /session setting/);
    append(manager, false);
    assert.equal(sessionOverride(manager.getEntries(), manager.getSessionId()), false);
  }
});

test("foreign session records are ignored while unbound malformed records fail visibly", () => {
  const manager = SessionManager.inMemory(); append(manager, true);
  manager.appendCustomEntry(SESSION_SETTING_TYPE, { sessionId: "another-session", version: 999, enabled: "invalid foreign data" });
  assert.equal(sessionOverride(manager.getEntries(), manager.getSessionId()), true);
  manager.appendCustomEntry(SESSION_SETTING_TYPE, { version: 1, enabled: false });
  assert.throws(() => sessionOverride(manager.getEntries(), manager.getSessionId()), /missing sessionId/);
});
