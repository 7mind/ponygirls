import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TestContext } from "node:test";
import { SupervisorBackend } from "../src/backend.ts";
import type { SessionId } from "../src/protocol.ts";

export const PYTHON = process.env.PI_BG_TASKS_PYTHON ?? "";
export const SHELL = process.env.PI_BG_TASKS_SHELL ?? "";
export const SUPERVISOR_SCRIPT = resolve(import.meta.dirname, "../supervisor.py");
assert.ok(PYTHON && SHELL, "Set PI_BG_TASKS_PYTHON and PI_BG_TASKS_SHELL; real-adapter checks must not silently skip.");

const cleanups = new WeakMap<TestContext, Array<() => unknown>>();

/**
 * Register cleanup that runs in reverse order (resources before the directories
 * holding them), and every step runs even if an earlier one fails. node:test
 * runs t.after hooks first-in-first-out and stops at a failing hook.
 */
export function defer(t: TestContext, fn: () => unknown): void {
  let stack = cleanups.get(t);
  if (!stack) {
    const steps: Array<() => unknown> = [];
    stack = steps;
    cleanups.set(t, steps);
    t.after(async () => {
      const errors: unknown[] = [];
      for (const step of steps.reverse()) {
        try {
          await step();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw errors[0];
    });
  }
  stack.push(fn);
}

export function tempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  defer(t, () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export async function startRealBackend(t: TestContext, sessionId: string, dir = tempDir(t, "bg-real-")): Promise<{ backend: SupervisorBackend; sidecar: string; sessionId: SessionId }> {
  const sidecar = join(dir, `${sessionId}.jsonl.bg-tasks`);
  const backend = await SupervisorBackend.start({ python: PYTHON, script: SUPERVISOR_SCRIPT, shell: SHELL, sidecar, sessionId, handoffWaitMs: 0 });
  defer(t, async () => {
    if (!backend.isLost) await backend.shutdown("quit");
  });
  return { backend, sidecar, sessionId: sessionId as SessionId };
}

export async function eventually<T>(fn: () => Promise<T | undefined | null | false>, what: string, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
