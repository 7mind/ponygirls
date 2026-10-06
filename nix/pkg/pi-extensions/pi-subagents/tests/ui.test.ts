import assert from "node:assert/strict";
import test from "node:test";
import { AgentInspector, countTree, renderHeadless, sanitizeDisplay, widgetLine } from "../src/ui.ts";
import type { AgentView } from "../src/supervisor.ts";

function view(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: "a-1",
    path: "/root/a",
    parentId: null,
    depth: 1,
    profile: "reader",
    isolation: "none",
    workdir: "/proj",
    model: "p/m",
    observed: "running",
    pendingIntent: "running",
    currentTaskRunId: null,
    generation: 1,
    taskOutcome: null,
    usage: { inputTokens: 1, outputTokens: 2, cost: null, unknown: false },
    lastActivityAt: "2026-10-05T00:00:00.000Z",
    managedGateFor: null,
    openQuestion: null,
    ...overrides,
  };
}

test("hostile ANSI/OSC output is sanitized", () => {
  const evil = "]0;pwned\x07hello[31mred\x1b[0m\x00\x1f";
  const clean = sanitizeDisplay(evil);
  assert.ok(!clean.includes(""));
  assert.ok(!clean.includes("\x00"));
  assert.ok(clean.includes("hello"));
  assert.ok(clean.includes("red"));
});

test("widget line summarizes counts without a transcript", () => {
  const views = [view(), view({ id: "a-2", path: "/root/b", observed: "queued", pendingIntent: "queued" })];
  const line = widgetLine(views);
  assert.ok(line.includes("running 1"));
  assert.ok(line.includes("queued 1"));
  assert.deepEqual(countTree(views), { running: 1, queued: 1, parked: 0, questions: 0 });
});

test("headless output contains no terminal escapes", () => {
  const out = renderHeadless([view({ path: "/root/[31mevil" })]);
  assert.ok(!out.includes(""));
  assert.ok(out.includes("/root/evil"));
  assert.equal(renderHeadless([]), "No subagents.");
});

test("inspector navigates, opens detail, and dismisses on escape", () => {
  let closed = false;
  const actions: string[] = [];
  const inspector = new AgentInspector([view(), view({ id: "a-2", path: "/root/b" })], {
    refresh: () => [view()],
    onClose: () => { closed = true; },
    onAction: (a) => { actions.push(a.kind); },
    requestRender: () => {},
  });
  const lines = inspector.render(80);
  assert.ok(lines.some((l) => l.includes("/root/a")));
  inspector.handleInput("j");
  inspector.handleInput("\r");
  const detail = inspector.render(80).join("\n");
  assert.ok(detail.includes("a-2"));
  inspector.handleInput("i");
  assert.deepEqual(actions, ["interrupt"]);
  inspector.handleInput("");
  assert.equal(closed, true);
});
