// Behavioral-Active-Blackbox-Atomic; regression: UUIDv7 must carry Unix time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { uuidv7 } from "../src/api.ts";

test("UUIDv7 carries its creation timestamp, version, and variant", () => {
  const before = Date.now();
  const id = uuidv7();
  const after = Date.now();
  const timestamp = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
  assert.ok(timestamp >= before && timestamp <= after, `timestamp ${timestamp} is outside ${before}..${after}`);
  assert.equal(id[14], "7");
  assert.match(id[19]!, /[89ab]/);
});
