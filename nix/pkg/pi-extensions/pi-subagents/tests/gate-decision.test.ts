import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGateSpec, validateGateDecision, DEFAULT_GATE_MAX_ROUNDS } from "../src/gate.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";

function policy() {
  const p = defaultSupervisorPolicy();
  p.allowedModels = [{ provider: "p", id: "m" }];
  return p;
}

test("default round semantics: maxRounds 3; null needs authority", () => {
  assert.equal(DEFAULT_GATE_MAX_ROUNDS, 3);
  const ok = normalizeGateSpec({ model: { provider: "p", id: "m" }, thinkingLevel: "high", prompt: "rubric" }, policy());
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.spec.maxRounds, 3);
  const unlimited = normalizeGateSpec({ model: { provider: "p", id: "m" }, thinkingLevel: "high", prompt: "rubric", maxRounds: null }, policy());
  assert.equal(unlimited.ok, false); // ceiling 3 forbids disabling
  const p2 = policy();
  p2.gateMaxRoundsCeiling = null;
  const unlimited2 = normalizeGateSpec({ model: { provider: "p", id: "m" }, thinkingLevel: "high", prompt: "rubric", maxRounds: null }, p2);
  assert.ok(unlimited2.ok);
  if (unlimited2.ok) assert.equal(unlimited2.spec.maxRounds, null);
  const zero = normalizeGateSpec({ model: { provider: "p", id: "m" }, thinkingLevel: "high", prompt: "rubric", maxRounds: 0 }, p2);
  assert.equal(zero.ok, false);
});

test("gate model outside the allowlist is rejected (no silent clamp)", () => {
  const res = normalizeGateSpec({ model: { provider: "evil", id: "x" }, thinkingLevel: "high", prompt: "r" }, policy());
  assert.equal(res.ok, false);
});

test("approve/revise/blocked validate strictly; malformed output is distinct", () => {
  const paths = new Set(["src/a.ts"]);
  const checks = new Set(["check-1"]);
  const approve = validateGateDecision({ schemaVersion: 1, candidateId: "c-1", decision: "approve", advisories: [] }, "c-1", paths, checks);
  assert.ok(approve.ok);
  const approveWithBlockers = validateGateDecision(
    { schemaVersion: 1, candidateId: "c-1", decision: "approve", blockers: [{ id: "F", target: "t", problem: "p", requiredChange: "c", evidenceRefs: ["c-1:src/a.ts"] }], advisories: [] },
    "c-1",
    paths,
    checks,
  );
  assert.equal(approveWithBlockers.ok, false);
  const reviseEmpty = validateGateDecision({ schemaVersion: 1, candidateId: "c-1", decision: "revise", blockers: [], advisories: [] }, "c-1", paths, checks);
  assert.equal(reviseEmpty.ok, false);
  const revise = validateGateDecision(
    {
      schemaVersion: 1,
      candidateId: "c-1",
      decision: "revise",
      blockers: [{ id: "F1", target: "src/a.ts:1", problem: "empty input", requiredChange: "handle it", evidenceRefs: ["c-1:src/a.ts", "check-1:output"] }],
      advisories: [],
    },
    "c-1",
    paths,
    checks,
  );
  assert.ok(revise.ok);
  const wrongCandidate = validateGateDecision({ schemaVersion: 1, candidateId: "c-2", decision: "approve", advisories: [] }, "c-1", paths, checks);
  assert.equal(wrongCandidate.ok, false);
  const unknownKey = validateGateDecision({ schemaVersion: 1, candidateId: "c-1", decision: "approve", advisories: [], extra: 1 }, "c-1", paths, checks);
  assert.equal(unknownKey.ok, false);
  const badRef = validateGateDecision(
    {
      schemaVersion: 1,
      candidateId: "c-1",
      decision: "revise",
      blockers: [{ id: "F1", target: "t", problem: "p", requiredChange: "c", evidenceRefs: ["c-9:elsewhere"] }],
      advisories: [],
    },
    "c-1",
    paths,
    checks,
  );
  assert.equal(badRef.ok, false);
  const blocked = validateGateDecision(
    { schemaVersion: 1, candidateId: "c-1", decision: "blocked", reason: "no data", missingPrerequisites: ["dataset"] },
    "c-1",
    paths,
    checks,
  );
  assert.ok(blocked.ok);
});
