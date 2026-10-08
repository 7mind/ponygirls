// BA: replay digest — canonical envelope, stable across key order,
// sensitive to every operation element.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalOperationBytes, operationDigest } from "../src/domain/digest.js";
import { canonicalizeRaw } from "../src/domain/json.js";

const DOC = canonicalizeRaw(
  '{"human-attention":"required","importance":"high","status":"actual","type":"fact","description":"d","fields":{"n":9007199254740993},"title":"t","links":[]}',
);

describe("operation digest", () => {
  it("builds the documented envelope", () => {
    assert.equal(
      canonicalOperationBytes("p:i", 0, DOC),
      `["haystack-op-v1","v1","p:i",0,${DOC}]`,
    );
  });
  it("digest is sha256 of the envelope", () => {
    const bytes = canonicalOperationBytes("p:i", 0, DOC);
    assert.equal(operationDigest("p:i", 0, DOC), createHash("sha256").update(bytes).digest("hex"));
  });
  it("pins a golden vector (upgrade-stable replay semantics)", () => {
    // If this value ever changes, old write_requests digests would be
    // reinterpreted: that requires a reviewed migration, never a silent fix.
    const canon = canonicalizeRaw(
      '{"description":"d","fields":{},"human-attention":"cleared","importance":"low","links":[],"status":"actual","title":"t","type":"fact"}',
    );
    assert.equal(
      operationDigest("p:golden", 0, canon),
      "d0e23981acee5a7904c0214df58ba41c8bd68a38b080186281b594e1cf109d12",
    );
  });
  it("ignores document key order, notices content changes", () => {
    const reordered = canonicalizeRaw('{"title":"t","type":"fact","status":"actual","importance":"high","human-attention":"required","description":"d","fields":{"n":9007199254740993},"links":[]}');
    assert.equal(operationDigest("p:i", 0, reordered), operationDigest("p:i", 0, DOC));
    assert.notEqual(operationDigest("p:i", 0, DOC), operationDigest("p:i", 1, DOC));
    assert.notEqual(operationDigest("p:i", 0, DOC), operationDigest("p:j", 0, DOC));
  });
});
