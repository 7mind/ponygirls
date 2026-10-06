/** Step 7: the /bg inspector component against the real supervisor. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { TaskBackend } from "../src/backend.ts";
import type { SignalName, TaskId } from "../src/protocol.ts";
import { BgInspector, VIEW_WINDOW_BYTES, type ViewerDeps } from "../src/ui.ts";
import { defer, eventually, startRealBackend } from "./fixtures.ts";

const PLAIN = { accent: (s: string) => s, dim: (s: string) => s, error: (s: string) => s, warning: (s: string) => s, success: (s: string) => s, bold: (s: string) => s, selected: (s: string) => `>${s}` };
const SGR = { accent: (s: string) => `\x1b[36m${s}\x1b[39m`, dim: (s: string) => `\x1b[2m${s}\x1b[22m`, error: (s: string) => `\x1b[31m${s}\x1b[39m`, warning: (s: string) => `\x1b[33m${s}\x1b[39m`, success: (s: string) => `\x1b[32m${s}\x1b[39m`, bold: (s: string) => `\x1b[1m${s}\x1b[22m`, selected: (s: string) => `\x1b[7m${s}\x1b[27m` };
const ENTER = "\r";
const ESC = "\x1b";
const UP = "\x1b[A";
const PAGE_UP = "\x1b[5~";

interface Harness {
  view: BgInspector;
  backend: TaskBackend;
  closed: () => boolean;
  confirms: string[];
  screen: (width?: number) => string;
  settle: () => Promise<void>;
}

async function open(t: TestContext, backend: TaskBackend, options: { style?: typeof PLAIN; confirm?: boolean; signal?: SignalName } = {}): Promise<Harness> {
  let closed = false;
  const confirms: string[] = [];
  const forgotten: string[] = [];
  const deps: ViewerDeps = {
    backend: async () => backend,
    noticeState: () => null,
    noticeForgotten: (task) => { forgotten.push(task.id); },
    confirm: async (title, message) => { confirms.push(`${title}\n${message}`); return options.confirm ?? true; },
    selectSignal: async () => options.signal,
    requestRender: () => {},
    rows: () => 30,
    close: () => { closed = true; },
    style: options.style ?? PLAIN,
    now: () => Date.now(),
  };
  const view = new BgInspector(deps);
  defer(t, () => view.dispose());
  const settle = async () => { await view.idle(); };
  await settle();
  return { view, backend, closed: () => closed, confirms, screen: (width = 120) => view.render(width).join("\n"), settle };
}

async function press(h: Harness, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    h.view.handleInput(key);
    await h.settle();
  }
}

async function finished(b: TaskBackend, id: string) {
  return eventually(async () => {
    const t = await b.get(id as TaskId);
    return t.state !== "running" ? t : null;
  }, `${id} to finish`);
}

test("live progress output: follow, scroll, resume follow, completion, close and reopen", async (t) => {
  const { backend } = await startRealBackend(t, "ui-live");
  const task = await backend.spawn({ label: "progress", command: "for i in $(seq 1 60); do echo line-$i; printf 'pct %d%%\\r' $i; sleep 0.03; done; echo all-done", cwd: "/", notify: false });
  const h = await open(t, backend);
  assert.match(h.screen(), /progress/);
  assert.match(h.screen(), /running/);
  await press(h, ENTER);
  await eventually(async () => { await h.view.refresh(); return /line-1\d/.test(h.screen()); }, "live lines");
  assert.match(h.screen(), /follow/i);
  await press(h, PAGE_UP);
  assert.match(h.screen(), /paused|scroll/i);
  const pausedAt = h.screen();
  await new Promise((r) => setTimeout(r, 200));
  await h.view.refresh();
  assert.equal(h.screen().split("\n").filter((l) => l.startsWith("line-")).join(","), pausedAt.split("\n").filter((l) => l.startsWith("line-")).join(","), "a paused view does not move");
  await press(h, "f");
  await finished(backend, task.id);
  await h.view.refresh();
  const screen = h.screen();
  assert.match(screen, /all-done/);
  assert.match(screen, /completed/);
  assert.doesNotMatch(screen, /pct \d+%\s*\n.*pct/, "carriage-return progress is collapsed");
  await press(h, ESC);
  assert.match(h.screen(), /progress/);
  await press(h, "q");
  assert.equal(h.closed(), true);
  const again = await open(t, backend);
  await press(again, ENTER);
  assert.match(again.screen(), /all-done/);
});

test("closing the viewer never changes task lifetime or retention", async (t) => {
  const { backend } = await startRealBackend(t, "ui-lifetime");
  const task = await backend.spawn({ label: "long", command: "echo hi; sleep 30", cwd: "/", notify: false });
  const h = await open(t, backend);
  await press(h, ENTER, ESC, "q");
  h.view.dispose();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await backend.get(task.id)).state, "running");
});

test("control-sequence fixtures cannot reach Pi's terminal", async (t) => {
  const { backend } = await startRealBackend(t, "ui-escapes");
  const evil = [
    "\\033]0;evil-title\\007", "\\033]52;c;ZXZpbA==\\007", "\\033]8;;https://evil.invalid\\033\\\\link\\033]8;;\\033\\\\",
    "\\033[?1049h", "\\033[2J\\033[H", "\\033[10;10H", "\\033Pq#evil\\033\\\\", "\\033[31mred\\033[0m", "plain-tail",
  ].join("");
  const task = await backend.spawn({ label: "evil \x1b]0;label-title\x07", command: `printf '${evil}\\n'`, cwd: "/", notify: false });
  await finished(backend, task.id);
  const h = await open(t, backend, { style: SGR });
  await press(h, ENTER);
  const screen = h.screen();
  assert.match(screen, /plain-tail/);
  assert.match(screen, /link/);
  assert.match(screen, /red/);
  assert.doesNotMatch(screen, /evil-title|ZXZpbA|evil\.invalid/);
  assert.match(screen, /evil \\x1b\]0;label-title\\x07/, "stored labels are shown escaped, never executed");
  assert.doesNotMatch(screen, /\x1b\]|\x1bP|\x1b\[\?|\x1b\[[0-9;]*[ABCDHJKfsu]/, "only SGR styling may remain");
  assert.ok([...screen.matchAll(/\x1b\[[0-9;]*([A-Za-z])/g)].every((m) => m[1] === "m"));
});

test("large logs are viewed through a bounded window", async (t) => {
  const { backend } = await startRealBackend(t, "ui-large");
  const task = await backend.spawn({ label: "big", command: "for i in $(seq 1 200000); do echo row-$i; done", cwd: "/", notify: false });
  await finished(backend, task.id, );
  assert.ok((await backend.get(task.id)).logBytes > 2_000_000);
  const h = await open(t, backend);
  await press(h, ENTER);
  assert.match(h.screen(), /row-200000/);
  assert.ok(h.view.loadedBytes <= VIEW_WINDOW_BYTES, `loaded ${h.view.loadedBytes}`);
  for (let i = 0; i < 60; i++) await press(h, PAGE_UP);
  assert.ok(h.view.loadedBytes <= VIEW_WINDOW_BYTES, `loaded ${h.view.loadedBytes} after scrolling back`);
  assert.doesNotMatch(h.screen(), /row-200000\b/);
});

test("dead tasks are labeled as interrupted; missing artifacts differ from empty output", async (t) => {
  const r = await startRealBackend(t, "ui-dead");
  const quiet = await r.backend.spawn({ label: "silent", command: "true", cwd: "/", notify: false });
  await finished(r.backend, quiet.id);
  const h = await open(t, r.backend);
  await press(h, ENTER);
  assert.match(h.screen(), /no output/i);
  await press(h, ESC);
  const { rmSync } = await import("node:fs");
  rmSync(`${r.sidecar}/tasks/${quiet.id}/terminal.log`);
  await press(h, ENTER);
  assert.match(h.screen(), /missing/i);
  // A dead record (supervisor_lost) after restart.
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  await r.backend.shutdown("quit");
  const reg = JSON.parse(readFileSync(`${r.sidecar}/tasks.json`, "utf8"));
  const stale = { ...reg.tasks[0], id: "bgt-stale", seq: reg.nextSeq, state: "running", phase: "running", reason: null, reasonDetail: null, event: null, endedAt: null, exit: null, logPath: "tasks/bgt-stale/terminal.log" };
  reg.nextSeq += 1;
  reg.tasks.push(stale);
  mkdirSync(`${r.sidecar}/tasks/bgt-stale`);
  writeFileSync(`${r.sidecar}/tasks/bgt-stale/terminal.log`, "partial\n");
  writeFileSync(`${r.sidecar}/tasks.json`, JSON.stringify(reg));
  const { SupervisorBackend } = await import("../src/backend.ts");
  const { PYTHON, SHELL, SUPERVISOR_SCRIPT } = await import("./fixtures.ts");
  const restarted = await SupervisorBackend.start({ python: PYTHON, script: SUPERVISOR_SCRIPT, shell: SHELL, sidecar: r.sidecar, sessionId: "ui-dead", handoffWaitMs: 0 });
  defer(t, () => restarted.shutdown("quit"));
  const h2 = await open(t, restarted);
  assert.match(h2.screen(), /dead/);
  await press(h2, ENTER);
  assert.match(h2.screen(), /interrupted/i);
  assert.match(h2.screen(), /partial/);
});

test("keyboard actions use the same task operations: signal, mute, terminate, clear finalized only", async (t) => {
  const { backend } = await startRealBackend(t, "ui-actions");
  const task = await backend.spawn({ label: "victim", command: "trap 'echo got-int; exit 5' INT; echo ready; while :; do sleep 0.05; done", cwd: "/", notify: true });
  await eventually(async () => new TextDecoder().decode((await backend.read(task.id, 0, 1000)).bytes).includes("ready"), "ready");
  const h = await open(t, backend, { signal: "SIGINT" });
  await press(h, "c");
  assert.match(h.screen(), /finished task|terminate it first|unfinished/i);
  assert.equal(h.confirms.length, 0);
  await press(h, "m");
  assert.equal((await backend.get(task.id)).notify, false);
  await press(h, "s");
  const done = await finished(backend, task.id);
  assert.deepEqual(done.exit, { kind: "code", code: 5 });
  await h.view.refresh();
  await press(h, "c");
  assert.equal(h.confirms.length, 1);
  assert.match(h.confirms[0]!, new RegExp(task.id));
  assert.match(h.confirms[0]!, /\d+ B/);
  await eventually(async () => (await backend.list(null, null, 10)).items.length === 0, "cleared");
  const other = await backend.spawn({ label: "t", command: "sleep 30", cwd: "/", notify: false });
  await h.view.refresh();
  await press(h, "t");
  assert.equal((await finished(backend, other.id)).reason, "terminated");
});
