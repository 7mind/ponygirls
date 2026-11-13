import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PREFERENCES, FilePreferenceStore } from "../src/preferences.ts";
import { MemoryPreferences } from "./fixtures.mjs";

// Same behavioral storage contract, atomic dummy and real-filesystem communication legs.
for (const backend of ["memory", "filesystem"]) {
  test(`${backend}: missing defaults off; explicit settings survive independent readers`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "archive-preference-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const store = backend === "memory" ? new MemoryPreferences() : new FilePreferenceStore(join(dir, "nested", "context-archive.json"));
    assert.deepEqual(store.read(), DEFAULT_PREFERENCES);
    for (const enabled of [true, false, true, false]) {
      const defaults = { enabled, highWatermark: 0.8, lowWatermark: 0.35 };
      store.write(defaults);
      const reader = backend === "memory" ? store : new FilePreferenceStore(store.path);
      assert.deepEqual(reader.read(), defaults);
      reader.read().enabled = !enabled;
      assert.deepEqual(reader.read(), defaults, "readers cannot mutate stored defaults");
    }
    if (backend === "filesystem") {
      assert.deepEqual(JSON.parse(readFileSync(store.path, "utf8")), { version: 2, enabled: false, highWatermark: 0.8, lowWatermark: 0.35 });
      assert.equal(statSync(store.path).mode & 0o777, 0o600);
      assert.deepEqual(readdirSync(join(dir, "nested")), ["context-archive.json"]);
    }
  });

  test(`${backend}: invalid defaults are rejected before replacing valid state`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "archive-preference-validation-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const store = backend === "memory" ? new MemoryPreferences() : new FilePreferenceStore(join(dir, "context-archive.json"));
    store.write({ ...DEFAULT_PREFERENCES });
    for (const invalid of [
      { ...DEFAULT_PREFERENCES, enabled: "true" },
      { ...DEFAULT_PREFERENCES, highWatermark: 0 },
      { ...DEFAULT_PREFERENCES, highWatermark: 1.01 },
      { ...DEFAULT_PREFERENCES, highWatermark: NaN },
      { ...DEFAULT_PREFERENCES, lowWatermark: -0.01 },
      { ...DEFAULT_PREFERENCES, lowWatermark: Infinity },
      { ...DEFAULT_PREFERENCES, lowWatermark: 0.7 },
      { enabled: true, highWatermark: 0.8 },
    ]) {
      assert.throws(() => store.write(invalid), /enabled:boolean|watermarks/);
      assert.deepEqual(store.read(), DEFAULT_PREFERENCES);
    }
    store.write({ enabled: true, highWatermark: 1, lowWatermark: 0 });
    assert.deepEqual(store.read(), { enabled: true, highWatermark: 1, lowWatermark: 0 });
  });
}

test("legacy v1 enablement becomes a default without rewriting until an explicit write", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "archive-preference-legacy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "context-archive.json"); const store = new FilePreferenceStore(path);
  for (const enabled of [false, true]) {
    const original = JSON.stringify({ version: 1, enabled });
    writeFileSync(path, original);
    assert.deepEqual(store.read(), { ...DEFAULT_PREFERENCES, enabled });
    assert.equal(readFileSync(path, "utf8"), original);
    store.write(store.read());
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { version: 2, ...DEFAULT_PREFERENCES, enabled });
  }
});

test("malformed, wrong-version and inaccessible preferences do not silently become a valid off setting", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "archive-preference-errors-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "context-archive.json");
  const store = new FilePreferenceStore(path);
  for (const value of ["{", "null", "[]", '{"enabled":true}', '{"version":4,"enabled":true}', '{"version":1,"enabled":"false"}', '{"version":2,"enabled":true}', '{"version":2,"enabled":true,"highWatermark":0.5,"lowWatermark":0.6}']) {
    writeFileSync(path, value);
    assert.throws(() => store.read());
  }
  store.write({ ...DEFAULT_PREFERENCES });
  assert.deepEqual(store.read(), DEFAULT_PREFERENCES, "an explicit complete write can repair bad data");
  const directory = join(dir, "directory"); mkdirSync(directory);
  assert.throws(() => new FilePreferenceStore(directory).write({ ...DEFAULT_PREFERENCES, enabled: true }));
  assert.deepEqual(store.read(), DEFAULT_PREFERENCES);
  assert.ok(readdirSync(dir).every((f) => !f.endsWith(".tmp")));
});
