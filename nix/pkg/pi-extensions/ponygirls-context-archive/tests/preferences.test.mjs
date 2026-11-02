import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePreferenceStore } from "../src/preferences.ts";

export class MemoryPreferences {
  path = "memory:context-archive";
  enabled = false;
  failure = null;
  read() { if (this.failure) throw new Error(this.failure); return this.enabled; }
  write(enabled) { if (this.failure) throw new Error(this.failure); this.enabled = enabled; }
}

// Same behavioral storage contract, atomic dummy and real-filesystem communication legs.
for (const backend of ["memory", "filesystem"]) {
  test(`${backend}: missing defaults off; explicit settings survive independent readers`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "archive-preference-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const store = backend === "memory" ? new MemoryPreferences() : new FilePreferenceStore(join(dir, "nested", "context-archive.json"));
    assert.equal(store.read(), false);
    for (const enabled of [true, false, true, false]) {
      store.write(enabled);
      const reader = backend === "memory" ? store : new FilePreferenceStore(store.path);
      assert.equal(reader.read(), enabled);
    }
    if (backend === "filesystem") {
      assert.deepEqual(JSON.parse(readFileSync(store.path, "utf8")), { version: 1, enabled: false });
      assert.equal(statSync(store.path).mode & 0o777, 0o600);
      assert.deepEqual(readdirSync(join(dir, "nested")), ["context-archive.json"]);
    }
  });
}

test("malformed, wrong-version and inaccessible preferences do not silently become a valid off setting", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "archive-preference-errors-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "context-archive.json");
  const store = new FilePreferenceStore(path);
  for (const value of ["{", "null", "[]", '{"enabled":true}', '{"version":2,"enabled":true}', '{"version":1,"enabled":"false"}']) {
    writeFileSync(path, value);
    assert.throws(() => store.read());
  }
  store.write(false);
  assert.equal(store.read(), false, "explicit command can repair bad data");
  const directory = join(dir, "directory"); mkdirSync(directory);
  assert.throws(() => new FilePreferenceStore(directory).write(true));
  assert.equal(store.read(), false);
  assert.ok(readdirSync(dir).every((f) => !f.endsWith(".tmp")));
});
