// BA: query language — grammar, precedence, predicates, diagnostics.
// Normative: haystack/docs/query.md.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lex } from "../src/query/lexer.js";
import { parse, isUtcInstant } from "../src/query/parser.js";
import { InvalidQuery, type AstNode } from "../src/query/ast.js";
import { extractWords, corpusSegments } from "../src/query/text.js";
import { resolvePointer } from "../src/query/pointer.js";
import { parseRaw } from "../src/domain/json.js";

function ast(query: string): AstNode {
  const { tokens, diagnostics } = lex(query);
  assert.equal(diagnostics.length, 0);
  return parse(tokens, { start: 0, end: query.length });
}

function fails(query: string): string {
  const { tokens, diagnostics } = lex(query);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.message).join("; ");
  try {
    parse(tokens, { start: 0, end: query.length });
  } catch (err) {
    assert.ok(err instanceof InvalidQuery);
    return err.message;
  }
  throw new Error(`query unexpectedly parsed: ${query}`);
}

describe("precedence and structure", () => {
  it("NOT binds tighter than AND binds tighter than OR", () => {
    const node = ast("a OR b c NOT d") as { kind: string; children: AstNode[] };
    assert.equal(node.kind, "or");
    const and = node.children[1] as { kind: string; children: AstNode[] };
    assert.equal(and.kind, "and");
    assert.equal(and.children.length, 3);
    assert.equal(and.children[2]!.kind, "not");
  });
  it("juxtaposition is AND; parens group", () => {
    const node = ast("a (b OR c)") as { kind: string; children: AstNode[] };
    assert.equal(node.kind, "and");
    assert.equal((node.children[1] as { kind: string }).kind, "or");
  });
  it("operators are case-insensitive; android is text", () => {
    const node = ast("android AnD robot") as { kind: string };
    assert.equal(node.kind, "and");
  });
  it("minus is negation", () => {
    const node = ast("a -b") as { kind: string; children: AstNode[] };
    assert.equal(node.kind, "and");
    assert.equal(node.children[1]!.kind, "not");
  });
  it("quoted strings are phrases with JSON escapes", () => {
    const node = ast('"repeated pattern" "a \\"b\\""') as { kind: string; children: AstNode[] };
    assert.equal(node.kind, "and");
    assert.deepEqual((node.children[0] as unknown as { kind: 'phrase'; words: string[] }).words, ["repeated", "pattern"]);
  });
});

describe("predicates", () => {
  it("parses the documented examples", () => {
    ast("project:example-project type:todo importance:high human-attention:required");
    ast('(type:github-issue OR type:github-pr) field["/github/state"] = "open"');
    ast('type:skill-draft "repeated pattern" NOT importance:low');
    ast('project:example-project link:["motivated-by","shared-knowledge:fact-mcp-auth"]');
    ast('archived:all field["/observations/count"] >= 3');
    ast('NOT exists["/review"] modified-at >= "2026-10-01T00:00:00Z"');
  });
  it("field comparisons accept numbers, booleans, null, negatives", () => {
    const n = ast('field["/n"] >= -2.5e3') as { kind: string; pred: { kind: string; value: { text: string } } };
    assert.equal(n.pred.value.text, "-2.5e3");
    ast('field["/b"] = true');
    ast('field["/z"] != null');
  });
  it("id and linked targets require quoted qualified keys", () => {
    fails("id:foo");
    fails("linked-to:foo");
    ast('id:"p:i"');
    ast('linked-to:"p:i"');
    ast('linked-from:"s:j"');
  });
  it("time values must be valid UTC instants", () => {
    ast('modified-at >= "2026-10-01T00:00:00Z"');
    ast('created-at:"2026-01-02T03:04:05.123456Z"');
    fails('modified-at >= "2026-13-01T00:00:00Z"');
    fails('modified-at >= "2026-02-30T00:00:00Z"');
    fails('modified-at >= "yesterday"');
    fails("modified-at >= 2026");
  });
});

describe("diagnostics, never silent fallback", () => {
  it("rejects unknown attributes, bare ids, empty atoms, bad syntax", () => {
    fails("bogus:1");
    fails("p:i");
    fails('""');
    fails('"!!!"');
    fails("!!!");
    fails("(a");
    fails("a OR");
    fails("field[");
    fails('field["/x"]');
    fails('field["/x"] == 1');
    fails("archived:sometimes");
    fails('link:["only-one"]');
  });
  it("empty query parses to nothing (browse)", () => {
    const { tokens, diagnostics } = lex("   ");
    assert.equal(diagnostics.length, 0);
    assert.equal(tokens.length, 0);
  });
  it("diagnostics carry half-open UTF-16 spans", () => {
    try {
      ast("bogus:1");
      assert.fail("should throw");
    } catch (err) {
      assert.ok(err instanceof InvalidQuery);
      assert.ok(err.diagnostics.length > 0);
      for (const d of err.diagnostics) assert.ok(d.span.start < d.span.end && d.span.end <= "bogus:1".length);
    }
  });
  it("enforces size bounds", () => {
    fails("a ".repeat(3000));
    fails("(".repeat(20) + "a" + ")".repeat(20));
  });
});

describe("instants", () => {
  it("accepts valid, rejects impossible and non-UTC", () => {
    assert.ok(isUtcInstant("2026-10-01T00:00:00Z"));
    assert.ok(isUtcInstant("2026-01-02T03:04:05.123456Z"));
    assert.ok(!isUtcInstant("2026-13-01T00:00:00Z"));
    assert.ok(!isUtcInstant("2026-02-30T00:00:00Z"));
    assert.ok(!isUtcInstant("2026-10-01T00:00:00+02:00"));
    assert.ok(!isUtcInstant("2026-10-01"));
  });
});

describe("text normalization", () => {
  it("extracts words case-insensitively with Unicode", () => {
    assert.deepEqual(extractWords("Hello, WORLD!"), ["hello", "world"]);
    assert.deepEqual(extractWords("café 🐎 123"), ["café", "123"]);
    assert.deepEqual(extractWords("!!!"), []);
  });
  it("keeps segment boundaries for phrases", () => {
    const segs = corpusSegments("Title words", "desc here", { a: ["x y", 42, true], b: "z w" });
    assert.deepEqual(segs, [["title", "words"], ["desc", "here"], ["x", "y"], ["z", "w"]]);
  });
});

describe("JSON pointer", () => {
  const fields = parseRaw('{"github":{"state":"open"},"n":3,"a":[{"b":1},2],"": "empty-key","~":"tilde","weird/key":1}');
  it("resolves objects, arrays, empty pointer", () => {
    assert.deepEqual(resolvePointer(fields, ""), { found: true, value: fields });
    assert.equal(resolvePointer(fields, "/github/state").value, "open");
    assert.equal(String(resolvePointer(fields, "/a/0/b").value), "1");
    assert.equal(String(resolvePointer(fields, "/a/1").value), "2");
  });
  it("decodes escapes once; missing differs from null", () => {
    assert.deepEqual(resolvePointer(fields, "/~/"), { found: false });
    assert.deepEqual(resolvePointer(fields, "/"), { found: true, value: "empty-key" });
    assert.equal(resolvePointer(fields, "/~0").value, "tilde");
    assert.equal(String(resolvePointer(fields, "/weird~1key").value), "1");
    assert.deepEqual(resolvePointer(fields, "/absent"), { found: false });
    assert.deepEqual(resolvePointer(parseRaw('{"z":null}'), "/z"), { found: true, value: null });
  });
  it("rejects negative, padded, and dash array indexes", () => {
    assert.deepEqual(resolvePointer(fields, "/a/-1"), { found: false });
    assert.deepEqual(resolvePointer(fields, "/a/-"), { found: false });
    assert.deepEqual(resolvePointer(fields, "/a/01"), { found: false });
    assert.deepEqual(resolvePointer(fields, "/a/9"), { found: false });
    assert.deepEqual(resolvePointer(fields, "/n/0"), { found: false });
  });
});
