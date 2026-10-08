// BA: qualified-ID codec — TypeScript port of the frozen Step 0 vectors
// (debug/20261007-2215-qid-codec.py). Both must stay in sync.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeComponent, decodeComponent, encodeKey, decodeKey, InvalidId } from "../src/domain/qid.js";

describe("qid round-trips", () => {
  const cases: Array<[string, string, string]> = [
    ["example-project", "fact-mcp-auth", "example-project:fact-mcp-auth"],
    ["a:b", "i%d", "a%3Ab:i%25d"],
    ["proj", "sp ace/x?", "proj:sp%20ace%2Fx%3F"],
    ["uni", "café 🐎", "uni:caf%C3%A9%20%F0%9F%90%8E"],
    ["a", "B", "a:B"],
    ["~tilde", ".dot-dash_under", "~tilde:.dot-dash_under"],
  ];
  for (const [project, item, external] of cases) {
    it(`round-trips ${external}`, () => {
      assert.equal(encodeKey({ project, item }), external);
      assert.deepEqual(decodeKey(external), { project, item });
    });
  }
  it("decodes %25-then-colon as data, not double encoding", () => {
    assert.deepEqual(decodeKey("a%253Ab:x"), { project: "a%3Ab", item: "x" });
  });
});

describe("qid rejections", () => {
  const badKeys = ["a:b:c", "a%3ab:x", "a%2Dx:y", "p:ab%", "p:a%ZZ", "p:%E2%82", "p:a%00", "p:a+b"];
  for (const bad of badKeys) {
    it(`rejects ${bad}`, () => {
      assert.throws(() => decodeKey(bad), InvalidId);
    });
  }
  it("rejects ids without a colon", () => {
    assert.throws(() => decodeKey("abc"), InvalidId);
  });
  it("rejects empty components", () => {
    assert.throws(() => encodeKey({ project: "", item: "x" }), InvalidId);
    assert.throws(() => encodeKey({ project: "p", item: "" }), InvalidId);
    assert.throws(() => decodeKey(":x"), InvalidId);
  });
  it("rejects literal colons inside components", () => {
    assert.throws(() => decodeComponent("a:b"), InvalidId);
  });
});
