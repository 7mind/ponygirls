/** Step 5: the public bg_task tool against the memory backend and the real supervisor. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { TaskBackend } from "../src/backend.ts";
import { BgTaskError, MAX_TOOL_RESPONSE_BYTES, type SessionId } from "../src/protocol.ts";
import { createBgTaskTool, fitListItems, type ToolHost } from "../src/tool.ts";
import { eventually, startRealBackend } from "./fixtures.ts";
import { MemoryTaskBackend } from "./memory-backend.ts";

type Setup = { backend: TaskBackend; sessionId: SessionId; forgotten: string[] };
const setups: Record<string, (t: TestContext) => Promise<Setup>> = {
  memory: async () => ({ backend: new MemoryTaskBackend("mem" as SessionId), sessionId: "mem" as SessionId, forgotten: [] }),
  real: async (t) => {
    const r = await startRealBackend(t, "tool-real");
    return { backend: r.backend, sessionId: r.sessionId, forgotten: [] };
  },
};

function hostFor(s: Setup): ToolHost {
  return {
    backend: async () => s.backend,
    sessionId: () => s.sessionId,
    noticeState: () => null,
    noticeForgotten: (task) => { s.forgotten.push(task.id); },
  };
}

type Result = { content: Array<{ type: string; text: string }>; details: any };

async function call(s: Setup, request: Record<string, unknown>, signal?: AbortSignal): Promise<Result> {
  const tool = createBgTaskTool(hostFor(s));
  const result = (await tool.execute("call-1", request as never, signal, undefined, {} as never)) as Result;
  const encoded = Buffer.byteLength(JSON.stringify({ content: result.content, details: result.details }));
  assert.ok(encoded <= MAX_TOOL_RESPONSE_BYTES, `response of ${encoded} bytes exceeds the budget`);
  return result;
}

async function fails(s: Setup, request: Record<string, unknown>, code: string): Promise<void> {
  await assert.rejects(call(s, request), (e: unknown) => e instanceof BgTaskError && e.code === code);
}

async function finished(s: Setup, id: string) {
  return eventually(async () => {
    const t = await s.backend.get(id as never);
    return t.state !== "running" ? t : null;
  }, `${id} to finish`);
}

for (const [name, make] of Object.entries(setups)) {
  test(`${name}: spawn returns the durable ID, state, log location, and notice policy without waiting`, async (t) => {
    const s = await make(t);
    const r = await call(s, { action: "spawn", label: "build", command: "sleep 30", cwd: "/", notify: true });
    assert.equal(r.details.action, "spawn");
    assert.equal(r.details.task.state, "running");
    assert.ok(r.details.logPath.startsWith("/"));
    assert.equal(r.details.task.notify, true);
    assert.match(r.content[0]!.text, new RegExp(r.details.task.id));
    assert.match(r.content[0]!.text, /end your turn/i);
    await call(s, { action: "terminate", id: r.details.task.id });
    const muted = await call(s, { action: "spawn", label: "m", command: "exit 0", cwd: "/", notify: false });
    assert.match(muted.content[0]!.text, /no completion notice/i);
  });

  test(`${name}: completed tasks stay enumerable and readable across repeated reads`, async (t) => {
    const s = await make(t);
    const id = (await call(s, { action: "spawn", label: "hello", command: "echo hello; exit 0", cwd: "/", notify: true })).details.task.id;
    await finished(s, id);
    for (let i = 0; i < 3; i++) {
      const r = await call(s, { action: "read", id, offset: 0, limit: 4096 });
      assert.match(r.content[0]!.text, /hello/);
      assert.equal(r.details.eof, true);
      assert.equal(r.details.nextOffset, r.details.size);
      const l = await call(s, { action: "list", cursor: null, limit: 10 });
      assert.equal(l.details.items[0].id, id);
      assert.equal(l.details.items[0].state, "completed");
    }
  });

  test(`${name}: signal, terminate, mute, and clear go through the task service`, async (t) => {
    const s = await make(t);
    const id = (await call(s, { action: "spawn", label: "loop", command: "sleep 30", cwd: "/", notify: true })).details.task.id;
    const sig = await call(s, { action: "signal", id, signal: "SIGCONT" });
    assert.equal(sig.details.delivered, true);
    assert.equal(sig.details.task.state, "running");
    const muted = await call(s, { action: "notify", id, enabled: false });
    assert.equal(muted.details.task.notify, false);
    assert.deepEqual(s.forgotten, [id]);
    await fails(s, { action: "clear", id }, "TASK_UNFINISHED");
    const stopped = await call(s, { action: "terminate", id });
    assert.equal(stopped.details.task.reason, "terminated");
    const cleared = await call(s, { action: "clear", id });
    assert.equal(cleared.details.id, id);
    assert.deepEqual(s.forgotten, [id, id]);
    await fails(s, { action: "read", id, offset: 0, limit: 10 }, "NOT_FOUND");
  });

  test(`${name}: unknown IDs, invalid operations, and malformed cursors fail the tool call`, async (t) => {
    const s = await make(t);
    await fails(s, { action: "read", id: "bgt-0000000000000000", offset: 0, limit: 10 }, "NOT_FOUND");
    await fails(s, { action: "explode" }, "INVALID_REQUEST");
    await fails(s, { action: "spawn", label: "x", command: "true", cwd: "relative/dir", notify: true }, "INVALID_REQUEST");
    await fails(s, { action: "spawn", label: "x", command: "true", cwd: "/" }, "INVALID_REQUEST");
    await fails(s, { action: "read", id: "x", offset: -1, limit: 10 }, "INVALID_REQUEST");
    await fails(s, { action: "read", id: "x", offset: 0, limit: 999999 }, "INVALID_REQUEST");
    await fails(s, { action: "signal", id: "x", signal: "SIGSEGV" }, "INVALID_REQUEST");
    await fails(s, { action: "list", cursor: "garbage", limit: 5 }, "CURSOR_INVALID");
    const foreign = Buffer.from(JSON.stringify({ v: 1, s: "another-session", u: 5, a: 3 })).toString("base64url");
    await fails(s, { action: "list", cursor: foreign, limit: 5 }, "CURSOR_INVALID");
  });

  test(`${name}: pagination returns every retained record through the watermark despite inserts and clears`, async (t) => {
    const s = await make(t);
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await call(s, { action: "spawn", label: `job-${i}`, command: "exit 0", cwd: "/", notify: false })).details.task.id);
    for (const id of ids) await finished(s, id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let page = 0;
    do {
      const r: Result = await call(s, { action: "list", cursor, limit: 5 });
      seen.push(...r.details.items.map((x: { label: string }) => x.label));
      cursor = r.details.nextCursor;
      if (page === 0) {
        await call(s, { action: "spawn", label: "inserted-late", command: "exit 0", cwd: "/", notify: false });
        await call(s, { action: "clear", id: ids[2]! });
      }
      page++;
    } while (cursor !== null);
    const expected = Array.from({ length: 12 }, (_, i) => `job-${11 - i}`).filter((l) => l !== "job-2");
    assert.deepEqual(seen, expected);
  });

  test(`${name}: read output is sanitized and offsets are accurate`, async (t) => {
    const s = await make(t);
    const id = (await call(s, { action: "spawn", label: "ansi", command: "sleep 30", cwd: "/", notify: false })).details.task.id;
    if (s.backend instanceof MemoryTaskBackend) {
      s.backend.append(id, "\x1b[31mred\x1b[0m \x1b]0;evil-title\x07ok\r\nprogress 10%\rprogress 100%\r\n");
      s.backend.finish(id, 0);
    } else {
      await call(s, { action: "terminate", id });
      const id2 = (await call(s, { action: "spawn", label: "ansi", command: "printf '\\033[31mred\\033[0m \\033]0;evil-title\\007ok\\nprogress 10%%\\rprogress 100%%\\n'", cwd: "/", notify: false })).details.task.id;
      await finished(s, id2);
      return checkSanitized(s, id2);
    }
    await checkSanitized(s, id);
  });
}

async function checkSanitized(s: Setup, id: string): Promise<void> {
  const r = await call(s, { action: "read", id, offset: 0, limit: 4096 });
  const text = r.content[0]!.text;
  assert.match(text, /red ok/);
  assert.match(text, /progress 100%/);
  assert.doesNotMatch(text, /evil-title|\x1b|progress 10%\n/);
}

test("memory: multibyte and escape-heavy windows split without corruption and fit the response budget", async (t) => {
  const s = await setups.memory!(t);
  const backend = s.backend as MemoryTaskBackend;
  const id = (await call(s, { action: "spawn", label: "big", command: "sleep 30", cwd: "/", notify: false })).details.task.id;
  const unit = "€\x1b[1mB\x1b[0m";
  const content = unit.repeat(6000);
  backend.append(id, content);
  let offset = 0;
  let collected = "";
  for (let i = 0; i < 100; i++) {
    const r = await call(s, { action: "read", id, offset, limit: 32768 });
    collected += r.content[0]!.text.split("\n").slice(1).join("\n");
    assert.ok(r.details.nextOffset > offset || r.details.nextOffset === r.details.size);
    offset = r.details.nextOffset;
    if (offset >= r.details.size) break;
  }
  assert.equal(collected.replaceAll("\n", ""), "€B".repeat(6000));
  assert.ok(!collected.includes("�"));
  const tail = await call(s, { action: "read", id, offset: "tail", limit: 5 });
  assert.ok(!tail.content[0]!.text.includes("�"));
  assert.equal(tail.details.eof, false, "a running task's log has no EOF");
});

test("list fitting truncates by serialized size and points the cursor at the last returned item", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ seq: 100 - i, blob: "x".repeat(100) }));
  const fitted = fitListItems(items, (subset) => Buffer.byteLength(JSON.stringify(subset)), 450);
  assert.equal(fitted.length, 3);
  assert.deepEqual(fitted.map((x) => x.seq), [100, 99, 98]);
});

test("an aborted spawn before admission launches nothing", async (t) => {
  const s = await setups.memory!(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(call(s, { action: "spawn", label: "x", command: "sleep 30", cwd: "/", notify: true }, controller.signal));
  assert.deepEqual((await s.backend.list(null, null, 10)).items, []);
});

test("real: an oversized command fails the tool call instead of hanging", async (t) => {
  const s = await setups.real!(t);
  const huge = `echo ${"x".repeat(1_500_000)}`;
  await Promise.race([
    assert.rejects(call(s, { action: "spawn", label: "huge", command: huge, cwd: "/", notify: false }), (e: unknown) => e instanceof BgTaskError && e.code === "INVALID_REQUEST"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("the oversized spawn hung")), 10000)),
  ]);
});

test("real: an oversized cwd fails the tool call instead of hanging", async (t) => {
  const s = await setups.real!(t);
  await Promise.race([
    assert.rejects(call(s, { action: "spawn", label: "x", command: "true", cwd: `/${"a".repeat(1_100_000)}`, notify: false }), (e: unknown) => e instanceof BgTaskError && e.code === "INVALID_REQUEST"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("the oversized spawn hung")), 10000)),
  ]);
});
