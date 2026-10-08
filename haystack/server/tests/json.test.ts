// BA: lossless JSON codec — no silent rounding, canonical forms, exact compare.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRaw,
  canonicalize,
  canonicalizeRaw,
  compareNumbers,
  isLosslessNumber,
  BadEnvelope,
} from "../src/domain/json.js";
import { LosslessNumber } from "lossless-json";

const n = (s: string) => new LosslessNumber(s);

describe("lossless numbers", () => {
  it("preserves integers beyond 2^53", () => {
    const v = parseRaw('{"n":9007199254740993}');
    assert.ok(isLosslessNumber((v as Record<string, unknown>)["n"]));
    assert.equal(canonicalize(v), '{"n":9007199254740993}');
  });
  it("does not normalize decimals", () => {
    assert.equal(canonicalizeRaw('{"d":0.10}'), '{"d":0.10}');
    assert.equal(canonicalizeRaw('{"d":1e2}'), '{"d":1e2}');
  });
  it("sorts object keys, keeps array order", () => {
    assert.equal(canonicalizeRaw('{"b":1,"a":[3,2,1]}'), '{"a":[3,2,1],"b":1}');
  });
  it("rejects trailing commas, duplicate keys, garbage", () => {
    for (const bad of ['{"a":1,}', '{"a":1,"a":2}', '{"a":}', "nope", ""]) {
      assert.throws(() => parseRaw(bad), BadEnvelope, bad);
    }
  });
  it("rejects absurd exponents (disclosed bound, not rounding)", () => {
    assert.throws(() => parseRaw('{"n":1e1000000}'), BadEnvelope);
  });
  it("round-trips unicode, null, nesting", () => {
    const raw = '{"o":{"x":[true,false]},"s":"café 🐎","z":null}';
    assert.equal(canonicalize(parseRaw(raw)), raw);
  });
});

describe("compareNumbers", () => {
  const cases: Array<[string, string, number]> = [
    ["1", "2", -1],
    ["2", "2", 0],
    ["9007199254740993", "9007199254740992", 1],
    ["0.1", "0.10", 0],
    ["1e2", "100", 0],
    ["-0", "0", 0],
    ["-5", "-4", -1],
    ["1.5", "1.25", 1],
    ["0.1", "0.2", -1],
    ["123456789012345678901234567890", "123456789012345678901234567891", -1],
  ];
  for (const [a, b, want] of cases) {
    it(`${a} vs ${b} = ${want}`, () => {
      assert.equal(compareNumbers(n(a), n(b)), want);
      assert.equal(compareNumbers(n(b), n(a)), want === 0 ? 0 : -want);
    });
  }
});
