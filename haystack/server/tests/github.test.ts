// BA: GitHub accounting identity — deterministic vectors, URL handling,
// record shape, collision faults. Fixtures only; no live GitHub.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accountingDocument,
  accountingKey,
  canonicalUrl,
  checkStoredIdentity,
  digestFor,
  itemComponent,
  kindFromTypename,
} from "../src/github/identity.js";
import { InvalidDocument } from "../src/domain/document.js";
import { validateDocument } from "../src/domain/document.js";
import { parseRaw } from "../src/domain/json.js";

describe("deterministic keys", () => {
  it("pins the frozen digest vectors", () => {
    assert.equal(digestFor("issue", "I_example123"), "0f0471cc3cbdb2a4495cf96e0a8289679a161dc9efbb07865a85f4f21683821b");
    assert.equal(digestFor("pr", "PR_example456"), "9b2b3a5640113ffd8e8bbee2a33dc270fe0870d2cc17d0633916eb3dd179f098");
  });
  it("derives complete keys in the activity namespace", () => {
    const key = accountingKey("agent-activity", "issue", "I_example123");
    assert.ok(key.startsWith("agent-activity:github-issue-0f0471cc"));
    assert.equal(key.length, "agent-activity:".length + "github-issue-".length + 64);
  });
  it("never confuses kinds, hosts, or versions", () => {
    assert.notEqual(digestFor("issue", "X"), digestFor("pr", "X"));
    assert.notEqual(itemComponent("issue", "X"), itemComponent("issue", "X "));
    assert.throws(() => digestFor("issue", ""), InvalidDocument);
  });
  it("maps __typename strictly", () => {
    assert.equal(kindFromTypename("Issue"), "issue");
    assert.equal(kindFromTypename("PullRequest"), "pr");
    assert.throws(() => kindFromTypename("Repository"), InvalidDocument);
  });
});

describe("provenance URLs", () => {
  it("canonicalizes display URLs without touching identity", () => {
    assert.equal(
      canonicalUrl("https://github.com/o/r/issues/1?utm=x#frag"),
      "https://github.com/o/r/issues/1",
    );
    assert.equal(canonicalUrl("https://github.com/o/r/pull/2/"), "https://github.com/o/r/pull/2");
  });
  it("rejects untrusted hosts and non-artifact paths", () => {
    for (const bad of [
      "http://github.com/o/r/issues/1",
      "https://evil.com/o/r/issues/1",
      "https://github.com/o/r",
      "https://github.com/o/r/issues",
      "not a url",
    ]) {
      assert.throws(() => canonicalUrl(bad), InvalidDocument, bad);
    }
  });
});

describe("accounting records", () => {
  const rec = {
    kind: "issue" as const,
    nodeId: "I_example123",
    url: "https://github.com/o/r/issues/1",
    title: "Example defect",
    summary: "Sanitized summary.",
  };
  it("builds valid versioned documents", () => {
    const doc = accountingDocument(rec, "high");
    validateDocument(parseRaw(JSON.stringify(doc)));
    assert.equal((doc as { type: string }).type, "github-issue");
    assert.equal((doc as { fields: { github: { identity_format: string } } }).fields.github.identity_format, "github-artifact-v1");
  });
  it("requires titles and canonical URLs", () => {
    assert.throws(() => accountingDocument({ ...rec, title: "" }, "low"), InvalidDocument);
    assert.throws(() => accountingDocument({ ...rec, url: "https://evil.com/x" }, "low"), InvalidDocument);
  });
  it("detects identity collisions before CAS", () => {
    const stored = { type: "github-issue", fields: { github: { kind: "issue", node_id: "I_example123" } } };
    checkStoredIdentity(stored, "issue", "I_example123");
    assert.throws(() => checkStoredIdentity(stored, "pr", "I_example123"), InvalidDocument);
    assert.throws(() => checkStoredIdentity(stored, "issue", "I_other"), InvalidDocument);
    assert.throws(() => checkStoredIdentity({ type: "github-issue", fields: {} }, "issue", "I_example123"), InvalidDocument);
  });
});
