/** Extension wiring of the transcript renderers: collapsed one-liners, expanded text unchanged. */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
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

async function load(): Promise<{ renderers: Map<string, MessageRenderer>; tool: RegisteredTool; commands: Map<string, string> }> {
  const renderers = new Map<string, MessageRenderer>();
  const commands = new Map<string, string>();
  let tool: RegisteredTool | null = null;
  const pi = {
    registerTool: (definition: RegisteredTool) => { tool = definition; },
    registerCommand: (name: string, command: { description: string }) => { commands.set(name, command.description); },
    registerMessageRenderer: (type: string, renderer: MessageRenderer) => { renderers.set(type, renderer); },
    on: () => {},
    sendMessage: () => {},
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  assert.ok(tool);
  return { renderers, tool, commands };
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
  assert.deepEqual(render(message, { expanded: false, outputPad: 1 }, THEME)!.render(WIDTH), [" ⚙ background task status is back"]);
  assert.equal(render(message, { expanded: true, outputPad: 1 }, THEME), undefined);
  assert.equal(render({ ...message, details: { status: "other" } }, { expanded: false, outputPad: 1 }, THEME), undefined);
});

// Defect B: at 120 columns the collapsed line was cut as `…(not --no-se...`.
test("status notice: the no-session line is whole at 120 columns and narrows between words", async () => {
  const { renderers } = await load();
  const render = renderers.get(STATUS_CUSTOM_TYPE)!;
  const message = {
    content: "bg-tasks: status backend unreachable (NO_PERSISTENT_SESSION: background tasks need a persistent session file (not --no-session)); the badge keeps its last state.",
    details: { status: "unavailable" },
  };
  const collapsed = render(message, { expanded: false, outputPad: 1 }, THEME)!;
  assert.deepEqual(collapsed.render(120), [" ⚙ background tasks are off: this session is not saved (--no-session)"]);
  assert.deepEqual(collapsed.render(40), [" ⚙ background tasks are off: this…"]);
  for (const width of [60, 80, 100, 120, 170]) {
    const lines = collapsed.render(width);
    assert.equal(lines.length, 1);
    assert.ok(visibleWidth(lines[0]!) <= width, `${width}: ${lines[0]}`);
    assert.doesNotMatch(lines[0]!, /\.\.\./);
  }
  // Expanded, pi renders the content itself: the complete original text with the error code.
  assert.equal(render(message, { expanded: true, outputPad: 1 }, THEME), undefined);
});

test("/bg describes itself in a few words", async () => {
  const { commands } = await load();
  assert.equal(commands.get("bg"), "Background tasks: output, terminate, signal");
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
