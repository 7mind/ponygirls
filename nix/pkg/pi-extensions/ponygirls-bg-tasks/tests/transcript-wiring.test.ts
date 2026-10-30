/** Extension wiring of the transcript renderers: collapsed one-liners, expanded text unchanged. */
import assert from "node:assert/strict";
import test from "node:test";
import type { Component } from "@earendil-works/pi-tui";
import { COMPLETION_CUSTOM_TYPE, STATUS_CUSTOM_TYPE } from "../src/protocol.ts";
import { expandedCall } from "../src/transcript.ts";
import { renderCompletion } from "../src/ui.ts";

type MessageRenderer = (message: { content: unknown; details: unknown }, options: { expanded: boolean; outputPad: number }, theme: unknown) => Component | undefined;
interface RenderContext { args: unknown; expanded: boolean; isPartial: boolean; isError: boolean }
interface RegisteredTool {
  renderCall(args: unknown, theme: unknown, context: RenderContext): Component;
  renderResult(result: { content: unknown[]; details: unknown }, options: { expanded: boolean; isPartial: boolean }, theme: unknown, context: RenderContext): Component;
}

const THEME = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };
const WIDTH = 100;

async function load(): Promise<{ renderers: Map<string, MessageRenderer>; tool: RegisteredTool }> {
  const renderers = new Map<string, MessageRenderer>();
  let tool: RegisteredTool | null = null;
  const pi = {
    registerTool: (definition: RegisteredTool) => { tool = definition; },
    registerCommand: () => {},
    registerMessageRenderer: (type: string, renderer: MessageRenderer) => { renderers.set(type, renderer); },
    on: () => {},
    sendMessage: () => {},
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  assert.ok(tool);
  return { renderers, tool };
}

const COMPLETION = {
  content: [{ type: "text", text: "[bg-task] A background task finished:\n- bgt-c7c6d1bd1bd981f9 (tests) failed: exit 3 (exit_nonzero). …" }],
  details: { schemaVersion: 1, sessionId: "s", events: [{ taskId: "bgt-c7c6d1bd1bd981f9", eventId: "e", state: "failed", reason: "exit_nonzero", logPath: "/s.bg-tasks/tasks/bgt-c7c6d1bd1bd981f9/terminal.log" }] },
};

test("completion notice: one line collapsed, today's full text expanded", async () => {
  const { renderers } = await load();
  const render = renderers.get(COMPLETION_CUSTOM_TYPE)!;
  const collapsed = render(COMPLETION, { expanded: false, outputPad: 1 }, THEME)!.render(WIDTH);
  assert.deepEqual(collapsed, [" ⚙ bg c7c6… ✖ failed · exit_nonzero · /bg to inspect"]);
  const expanded = render(COMPLETION, { expanded: true, outputPad: 1 }, THEME)!.render(200).map((line) => line.trimEnd());
  const today = renderCompletion(COMPLETION.details as never, "", THEME).map((line) => ` ${line}`);
  assert.deepEqual(expanded, today);
  assert.match(expanded.join("\n"), /log \/s\.bg-tasks\/tasks\/bgt-c7c6d1bd1bd981f9\/terminal\.log \(until cleared\)/);
});

test("status notice: one line collapsed; expanded and unknown details keep pi's default rendering", async () => {
  const { renderers } = await load();
  const render = renderers.get(STATUS_CUSTOM_TYPE)!;
  const message = { content: "bg-tasks: status backend reachable again.", details: { status: "recovered" } };
  assert.deepEqual(render(message, { expanded: false, outputPad: 1 }, THEME)!.render(WIDTH), [" ⚙ bg status backend reachable again."]);
  assert.equal(render(message, { expanded: true, outputPad: 1 }, THEME), undefined);
  assert.equal(render({ ...message, details: { status: "other" } }, { expanded: false, outputPad: 1 }, THEME), undefined);
});

test("bg_task: the call line until the result, then one combined line; expanded is pi's generic text", async () => {
  const { tool } = await load();
  const args = { action: "spawn", label: "tests", command: "make check", cwd: "/w", notify: true };
  const context = (expanded: boolean, isPartial: boolean): RenderContext => ({ args, expanded, isPartial, isError: false });
  assert.deepEqual(tool.renderCall(args, THEME, context(false, true)).render(WIDTH), ["bg_task spawn tests · make check"]);
  assert.deepEqual(tool.renderCall(args, THEME, context(false, false)).render(WIDTH), []);
  const result = { content: [{ type: "text", text: "Started bgt-c7c6d1bd1bd981f9 (tests): running. Log: /l. A completion notice will arrive." }], details: { action: "spawn", task: { id: "bgt-c7c6d1bd1bd981f9", notify: true }, logPath: "/l" } };
  assert.deepEqual(tool.renderResult(result, { expanded: false, isPartial: false }, THEME, context(false, false)).render(WIDTH), ["bg_task spawn tests · make check → started c7c6… (notice on)"]);
  const call = tool.renderCall(args, THEME, context(true, false)).render(WIDTH).map((line) => line.trimEnd());
  assert.deepEqual(call, expandedCall(args, THEME).split("\n"));
  const output = tool.renderResult(result, { expanded: true, isPartial: false }, THEME, context(true, false)).render(200).map((line) => line.trimEnd());
  assert.deepEqual(output, [result.content[0]!.text]);
});
