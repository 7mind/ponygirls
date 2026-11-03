import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { FileTogglePreferenceStore, parseToggleCommand, sessionEnabled, sessionEnabledData, TOGGLE_ARGUMENTS, type ToggleDefaults, type TogglePreferenceStore } from "../src/index.ts";

class MemoryTogglePreferences implements TogglePreferenceStore {
  readonly path = "memory:toggle";
  private defaults: ToggleDefaults;
  constructor(defaultEnabled: boolean) { this.defaults = { enabled: defaultEnabled }; }
  read(): ToggleDefaults { return { ...this.defaults }; }
  write(defaults: ToggleDefaults): void {
    if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults) || typeof defaults.enabled !== "boolean") {
      throw new Error("Expected enabled:boolean");
    }
    this.defaults = { enabled: defaults.enabled };
  }
}

// Specified behavioral contract: blackbox/atomic dummy and real-filesystem communication legs.
for (const backend of ["memory", "filesystem"]) {
  for (const defaultEnabled of [false, true]) {
    test(`${backend}: default ${defaultEnabled}; explicit values persist without mutable read aliases`, (t) => {
      const dir = mkdtempSync(join(tmpdir(), "pi-settings-"));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const store: TogglePreferenceStore = backend === "memory" ? new MemoryTogglePreferences(defaultEnabled)
        : new FileTogglePreferenceStore(join(dir, "nested", "toggle.json"), defaultEnabled);
      assert.deepEqual(store.read(), { enabled: defaultEnabled });
      for (const enabled of [true, false, true]) {
        store.write({ enabled });
        const reader = backend === "memory" ? store : new FileTogglePreferenceStore(store.path, !defaultEnabled);
        assert.deepEqual(reader.read(), { enabled });
        reader.read().enabled = !enabled;
        assert.deepEqual(reader.read(), { enabled });
      }
    });
  }

  test(`${backend}: invalid writes cannot replace valid state`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "pi-settings-invalid-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const store = backend === "memory" ? new MemoryTogglePreferences(false) : new FileTogglePreferenceStore(join(dir, "toggle.json"), false);
    store.write({ enabled: true });
    for (const invalid of [null, [], {}, { enabled: "false" }, { enabled: 0 }, { enabled: null }]) {
      // @ts-expect-error Invalid runtime input is deliberately exercised at the persistence boundary.
      assert.throws(() => store.write(invalid), /enabled:boolean/);
      assert.deepEqual(store.read(), { enabled: true });
    }
  });
}

// Effectual/controllable communication: exact JSON format, permissions and failure cleanup.
test("filesystem: version 1 JSON and 0600 replacement leave no temporary files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-settings-format-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "toggle.json");
  const store = new FileTogglePreferenceStore(path, false);
  writeFileSync(path, '{"version":1,"enabled":false}', { mode: 0o644 });
  store.write({ enabled: true });
  assert.equal(readFileSync(path, "utf8"), '{"version":1,"enabled":true}\n');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ["toggle.json"]);
  const directory = join(dir, "directory"); mkdirSync(directory);
  assert.throws(() => new FileTogglePreferenceStore(directory, false).write({ enabled: false }));
  assert.deepEqual(readdirSync(dir).sort(), ["directory", "toggle.json"]);
  assert.deepEqual(store.read(), { enabled: true });
});

test("filesystem: only absence inherits; malformed, future-version and inaccessible files fail", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-settings-read-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "toggle.json");
  const store = new FileTogglePreferenceStore(path, true);
  for (const text of ["{", "null", "[]", "true", "{}", '{"enabled":true}', '{"version":0,"enabled":true}', '{"version":2,"enabled":false}', '{"version":1}', '{"version":1,"enabled":"true"}', '{"version":1,"enabled":null}']) {
    writeFileSync(path, text);
    assert.throws(() => store.read(), /Invalid toggle defaults/);
    assert.equal(readFileSync(path, "utf8"), text, "reads never repair or rewrite malformed data");
  }
  const original = '{"version":1,"enabled":false}'; writeFileSync(path, original);
  assert.deepEqual(store.read(), { enabled: false });
  assert.equal(readFileSync(path, "utf8"), original);
  assert.throws(() => new FileTogglePreferenceStore(dir, true).read());
});

// Behavioral-active blackbox/group: real session manager, branches, copied records, no inference.
const SETTING = "fixture.toggle.setting";
const state = (manager: SessionManager) => sessionEnabled(manager.getEntries(), manager.getSessionId(), SETTING);
const append = (manager: SessionManager, enabled: boolean | null) => manager.appendCustomEntry(SETTING, sessionEnabledData(manager.getSessionId(), enabled));

test("session toggles are session-wide across branches; latest null terminates older overrides", () => {
  const manager = SessionManager.inMemory();
  assert.equal(state(manager), null);
  const root = manager.appendMessage({ role: "user", content: "anchor", timestamp: 1 });
  const on = append(manager, true);
  manager.branch(root);
  assert.equal(state(manager), true);
  append(manager, false);
  manager.branch(on);
  assert.equal(state(manager), false);
  append(manager, null);
  assert.equal(state(manager), null);
  const original = manager.getEntries();
  assert.equal(sessionEnabled(Object.freeze(original), manager.getSessionId(), SETTING), null);
  assert.deepEqual(manager.getEntries(), original);
});

test("foreign sessions and unrelated custom types cannot supply an override", () => {
  const manager = SessionManager.inMemory(); append(manager, true);
  const parentId = manager.getSessionId();
  manager.createBranchedSession(manager.getLeafId()!);
  assert.notEqual(manager.getSessionId(), parentId);
  assert.ok(manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === SETTING));
  assert.equal(state(manager), null);
  append(manager, false);
  manager.appendCustomEntry(SETTING, { sessionId: parentId, version: 999, enabled: "bad" });
  manager.appendCustomEntry("another.type", { version: 999 });
  assert.equal(state(manager), false);
});

test("latest malformed matching records fail; newer valid records repair without reviving older values", () => {
  for (const data of [null, [], {}, { sessionId: 123 }, { sessionId: "self", version: 2, enabled: true }, { sessionId: "self", version: 1 }, { sessionId: "self", version: 1, enabled: "true" }]) {
    const manager = SessionManager.inMemory(); append(manager, true);
    const value = typeof data === "object" && data !== null && "sessionId" in data && data.sessionId === "self"
      ? { ...data, sessionId: manager.getSessionId() } : data;
    manager.appendCustomEntry(SETTING, value);
    assert.throws(() => state(manager), /session setting/);
    append(manager, null);
    assert.equal(state(manager), null);
  }
});

test("sessionEnabledData preserves the version 1 bound record format", () => {
  for (const enabled of [true, false, null]) assert.deepEqual(sessionEnabledData("session-id", enabled), { version: 1, sessionId: "session-id", enabled });
});

// Behavioral-active blackbox/atomic: strict command grammar with no mutation or UI.
test("toggle command grammar trims and ignores case, but requires exact arity", () => {
  const expected = [
    { kind: "session", enabled: true }, { kind: "session", enabled: false }, { kind: "session", enabled: null },
    { kind: "default", enabled: true }, { kind: "default", enabled: false }, { kind: "status" },
  ];
  assert.deepEqual(TOGGLE_ARGUMENTS, ["on", "off", "inherit", "default on", "default off", "status"]);
  for (const [i, argument] of TOGGLE_ARGUMENTS.entries()) {
    assert.deepEqual(parseToggleCommand(argument), expected[i]);
    assert.deepEqual(parseToggleCommand(` \t${argument.toUpperCase().replaceAll(" ", "\t ")} \n`), expected[i]);
    assert.equal(parseToggleCommand(`${argument} extra`), null);
  }
  for (const argument of ["", " \n\t"]) assert.deepEqual(parseToggleCommand(argument), { kind: "status" });
  for (const argument of ["default", "default inherit", "on off", "status now", "enable", "thresholds 70 50", "default thresholds 70 50", "on\noff"]) {
    assert.equal(parseToggleCommand(argument), null, argument);
  }
});
