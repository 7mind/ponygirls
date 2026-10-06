import assert from "node:assert/strict";
import test from "node:test";
import { secretOf } from "../src/pi-auth.ts";

test("the secret is pi's apiKey, else the bearer token of a header-only OAuth auth", () => {
  assert.equal(secretOf({ apiKey: "key", headers: { Authorization: "Bearer other" } }), "key");
  assert.equal(secretOf({ headers: { Authorization: "Bearer tok-1" } }), "tok-1");
  assert.equal(secretOf({ headers: { "x-extra": "1", authorization: "bearer  tok-2 " } }), "tok-2");
  assert.equal(secretOf({ headers: { Authorization: "Basic abc" } }), null);
  assert.equal(secretOf({ headers: { Authorization: null } }), null);
  assert.equal(secretOf({}), null);
});
