import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";
import { expandedCallText, expandedResultText, noticeLine, parseNotices, renderNotice, renderSpawnCall, renderSpawnResult, spawnLine, spawnOutcome, type RenderTheme, type SpawnRenderState } from "../src/render.ts";

const PLAIN: RenderTheme = { fg: (_c, t) => t, bg: (_c, t) => t, bold: (t) => t };
/** Zero-width OSC markers around styled spans; `tags()` makes them readable. */
const mark = (tag: string, text: string): string => `\x1b]777;${tag}\x07${text}\x1b]777;/\x07`;
const TAG: RenderTheme = { fg: (c, t) => mark(c, t), bg: (c, t) => mark(`bg:${c}`, t), bold: (t) => mark("bold", t) };
const tags = (line: string): string => line.replace(/\x1b\]777;([^\x07]*)\x07/g, "<$1>");

const ENDED = "/root/audit-colors task c29d199f-8d01-4ece-bf8f-7540705480a1 ended succeeded";

test("one ended notice collapses to the agent, its coloured outcome, and where to look", () => {
  assert.equal(noticeLine(PLAIN, `[subagents]\n${ENDED}`), "◈ agent /root/audit-colors ✓ succeeded · /agents");
  const styled = tags(noticeLine(TAG, `[subagents]\n${ENDED}`));
  assert.match(styled, /<customMessageLabel>◈ agent<\/>/);
  assert.match(styled, /<success>✓ succeeded<\/>/);
  assert.equal(noticeLine(PLAIN, "[subagents]\n/root/x task t1 ended failed: worker exited 3"), "◈ agent /root/x ✖ failed · worker exited 3 · /agents");
  assert.match(tags(noticeLine(TAG, "[subagents]\n/root/x task t1 ended interrupted")), /<warning>⚠ interrupted<\/>/);
});

test("several notices are summarised on one line; message text continues across lines", () => {
  const text = [
    "[subagents]",
    "/root/a task t1 ended succeeded",
    "/root/b task t2 ended failed: boom",
    "question m1 from /root/c (c-id): which file?",
    "second line of the question",
    "controller failure: disk full",
  ].join("\n");
  const notices = parseNotices(text);
  assert.equal(notices.length, 4);
  assert.deepEqual(notices[2], { kind: "message", path: "/root/c", question: true, text: "which file?\nsecond line of the question" });
  assert.equal(noticeLine(PLAIN, text), "◈ subagents · 4 notices · /root/a ✓ succeeded · /root/b ✖ failed · /root/c ? question · ✖ controller failure · /agents");
  assert.equal(noticeLine(PLAIN, "[subagents]\nmessage from /root/c (c-id): done\nfor now"), "◈ agent /root/c message · done for now · /agents");
  assert.equal(noticeLine(PLAIN, "[subagents]\n/root/q quarantined: lost worker"), "◈ agent /root/q ✖ quarantined · lost worker · /agents");
});

test("the collapsed notice is one line within the width; expanded leaves pi's default rendering", () => {
  const message = { content: [{ type: "text", text: `[subagents]\n${ENDED}\n/root/b task t2 ended failed` }] };
  assert.equal(renderNotice(message, { expanded: true, outputPad: 1 }, PLAIN), undefined);
  const component = renderNotice(message, { expanded: false, outputPad: 1 }, PLAIN)!;
  for (const width of [120, 40]) {
    const lines = component.render(width);
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.ok(visibleWidth(lines[0]!) <= width);
  }
  assert.ok(component.render(120)[0]!.includes("◈ subagents · 2 notices"));
});

const SPAWN_ARGS = { task_name: "audit-colors", message: "Audit theme colours", profile: "reader", isolation: "none" };
const spawnResult = (value: unknown): { content: Array<{ type: "text"; text: string }> } => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const STARTED = spawnResult({ agentId: "953405df", path: "/root/audit-colors", taskRunId: "c29d199f", generation: 1, profile: "reader", isolation: "none", workdir: "/w", status: "running" });

test("spawn_agent collapses call and result into one line", () => {
  assert.equal(spawnLine(PLAIN, SPAWN_ARGS, undefined), "spawn_agent audit-colors · reader · none");
  assert.equal(spawnLine(PLAIN, SPAWN_ARGS, spawnOutcome(STARTED, false)), "spawn_agent audit-colors · reader · none → started /root/audit-colors (gen 1)");
  const queued = spawnResult({ agentId: "x", path: "/root/q", taskRunId: "t", generation: 1, profile: "writer", isolation: "worktree", workdir: "/w", status: "queued" });
  assert.equal(spawnLine(PLAIN, { task_name: "q", profile: "writer" }, spawnOutcome(queued, false)), "spawn_agent q · writer · worktree → queued /root/q (gen 1)");
  const failed = { content: [{ type: "text", text: "POLICY_DENIED: model not allowed\nsecond line" }] };
  assert.equal(spawnLine(PLAIN, SPAWN_ARGS, spawnOutcome(failed, true)), "spawn_agent audit-colors · reader · none → ✖ POLICY_DENIED: model not allowed second line");
  assert.match(tags(spawnLine(TAG, SPAWN_ARGS, spawnOutcome(failed, true))), /<error>✖ POLICY_DENIED/);
});

test("collapsed spawn_agent renders the call line with the result and no result block", () => {
  const state: SpawnRenderState = {};
  const call = renderSpawnCall(SPAWN_ARGS, PLAIN, { state, isError: false, expanded: false });
  assert.deepEqual(call.render(200), ["spawn_agent audit-colors · reader · none"], "pending: no result yet");
  const result = renderSpawnResult(STARTED, { expanded: false }, PLAIN, { state, isError: false });
  assert.deepEqual(result.render(200), []);
  assert.deepEqual(call.render(200), ["spawn_agent audit-colors · reader · none → started /root/audit-colors (gen 1)"]);
  assert.ok(visibleWidth(call.render(30)[0]!) <= 30);
});

test("expanded spawn_agent shows pi's default call and result text", () => {
  const state: SpawnRenderState = {};
  const call = renderSpawnCall(SPAWN_ARGS, PLAIN, { state, isError: false, expanded: true }).render(200).map((l) => l.trimEnd());
  assert.deepEqual(call, ["spawn_agent", "  task_name: audit-colors", "  message: Audit theme colours", "  profile: reader", "  isolation: none"]);
  const result = renderSpawnResult(STARTED, { expanded: true }, PLAIN, { state, isError: false }).render(400).map((l) => l.trimEnd());
  assert.deepEqual(result, [STARTED.content[0]!.text]);
});

test("the expanded mirrors match pi's own fallback text functions", async () => {
  const root = process.env["PI_SUBAGENTS_SDK_ROOT"];
  assert.ok(root, "PI_SUBAGENTS_SDK_ROOT must name the pi SDK the extension runs on");
  const pi = (await import(pathToFileURL(join(root, "dist", "core", "tools", "render-utils.js")).href)) as {
    formatToolCallWithArgs(title: string, args: unknown, theme: RenderTheme, expanded: boolean): string;
    getTextOutput(result: { content: Array<{ type: string; text?: string }> }, showImages: boolean): string;
  };
  const argsCases: unknown[] = [
    SPAWN_ARGS,
    { task_name: "t", message: "line 1\n\tline 2\r\nline 3", gate: { reviewers: [{ model: "a" }], max_rounds: 2 }, skills: ["x"], result_limit: 100 },
    {},
    null,
    "raw",
  ];
  for (const args of argsCases) {
    assert.equal(expandedCallText(TAG, "spawn_agent", args), pi.formatToolCallWithArgs("spawn_agent", args, TAG, true), JSON.stringify(args));
  }
  const texts = [
    STARTED.content[0]!.text,
    "INVALID: bad \x1b[31mred\x1b[0m \x1b]8;;http://x\x07link\x1b]8;;\x07 \x07bell\r\nnext\x00 \uFFFA",
    "",
  ];
  for (const text of texts) {
    const result = { content: [{ type: "text", text }] };
    assert.equal(expandedResultText(result), pi.getTextOutput(result, false), JSON.stringify(text));
  }
});
