/**
 * Transcript parsing (active branch of a pi session file) and rendering.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PLAIN_STYLE } from "../src/display.ts";
import { parseTranscript, renderTranscript } from "../src/transcript.ts";

type Entry = Record<string, unknown>;
let seq = 0;
function entry(parentId: string | null, body: Entry, id = `e${++seq}`): Entry {
  return { id, parentId, timestamp: "2026-10-06T00:00:00.000Z", ...body };
}
const msg = (message: Entry): Entry => ({ type: "message", message });
const jsonl = (entries: Entry[]): string => entries.map((e) => JSON.stringify(e)).join("\n");

test("only the active branch is shown, and an entry still being written is skipped", () => {
  const header = { type: "session", version: 3, id: "s", timestamp: "t", cwd: "/w" };
  const a = entry(null, msg({ role: "user", content: "the task" }), "a");
  const b = entry("a", msg({ role: "assistant", content: [{ type: "text", text: "first attempt" }] }), "b");
  const c = entry("b", msg({ role: "assistant", content: [{ type: "text", text: "abandoned branch" }] }), "c");
  const d = entry("b", msg({ role: "assistant", content: [{ type: "text", text: "restored branch" }] }), "d");
  const text = `${JSON.stringify(header)}\n${jsonl([a, b, c, d])}\n{"type":"message","id":"x","par`;
  assert.deepEqual(parseTranscript(text).map((i) => ("text" in i ? i.text : i.kind)), ["the task", "first attempt", "restored branch"]);
});

test("messages, tools, delivered notes, compaction, and failures become items", () => {
  const items = parseTranscript(jsonl([
    entry(null, msg({ role: "system", content: "", sections: { preamble: "secret prompt" } }), "s"),
    entry("s", msg({ role: "user", content: [{ type: "text", text: "do it" }] }), "u"),
    entry("u", msg({ role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "on it" }, { type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls -la" } }] }), "a1"),
    entry("a1", msg({ role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false }), "r1"),
    entry("r1", { type: "custom_message", customType: "pi-subagents-steer", content: [{ type: "text", text: "faster" }], display: false, details: { messageId: "m1" } }, "n1"),
    entry("n1", { type: "compaction", summary: "earlier work", firstKeptEntryId: "n1", tokensBefore: 10 }, "k1"),
    entry("k1", msg({ role: "assistant", content: [], stopReason: "error", errorMessage: "overloaded" }), "a2"),
  ]));
  assert.deepEqual(items.map(({ at: _at, ...content }) => content), [
    { kind: "task", text: "do it" },
    { kind: "thinking", text: "hmm" },
    { kind: "assistant", text: "on it" },
    { kind: "tool_call", id: "c1", name: "bash", summary: "ls -la", verdict: null },
    { kind: "tool_result", callId: "c1", name: "bash", text: "out", isError: false },
    { kind: "message", mode: "steer", messageId: "m1", text: "faster" },
    { kind: "compaction", summary: "earlier work" },
    { kind: "error", text: "overloaded" },
  ]);
});

test("parallel tool results sit under their own calls; messages name their sender", () => {
  const items = parseTranscript(jsonl([
    entry(null, msg({ role: "assistant", content: [
      { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } },
      { type: "toolCall", id: "c2", name: "send_message", arguments: { target: "parent", message: "which one?", request_reply: true } },
    ] }), "a"),
    entry("a", msg({ role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "A-CONTENT" }] }), "r1"),
    entry("r1", msg({ role: "toolResult", toolCallId: "c2", toolName: "send_message", content: [{ type: "text", text: "QUEUED" }] }), "r2"),
    entry("r2", { type: "custom_message", customType: "pi-subagents-note", content: "the second", details: { messageId: "m9" } }, "n"),
  ]));
  const lines = renderTranscript(items, 80, PLAIN_STYLE, new Map([["m9", { from: "governor", reply: true }]]));
  const at = (needle: string): number => lines.findIndex((l) => l.includes(needle));
  assert.ok(at("read a.ts") < at("A-CONTENT") && at("A-CONTENT") < at("send_message") && at("send_message") < at("QUEUED"), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("→ parent (asks): which one?")));
  assert.ok(lines.some((l) => l.includes("✉ reply from governor")));
});

test("rendering sanitizes child content and fits the width; tool output wraps by column", () => {
  const items = parseTranscript(jsonl([
    entry(null, msg({ role: "assistant", content: [{ type: "text", text: "evil\x1b]0;title\x07\x1b[31m red" }, { type: "toolCall", id: "c", name: "bash", arguments: { command: "x" } }] }), "a"),
    entry("a", msg({ role: "toolResult", toolCallId: "c", toolName: "bash", content: [{ type: "text", text: `{"k":"${"v".repeat(150)}"}` }] }), "r"),
    entry("r", msg({ role: "assistant", content: [{ type: "thinking", thinking: "line\n".repeat(10) }] }), "t"),
  ]));
  const lines = renderTranscript(items, 60, PLAIN_STYLE, new Map());
  assert.ok(lines.every((l) => !l.includes("\x1b") && visibleWidth(l) <= 60), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("evil red")));
  assert.ok(lines.filter((l) => l.startsWith("    ")).length >= 3, "the JSON was hard-wrapped");
  assert.ok(lines.some((l) => l.includes("more lines")), "long thinking is cut");
});
