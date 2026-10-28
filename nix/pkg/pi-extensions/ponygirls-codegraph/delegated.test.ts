import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import type { Extension, ExtensionContext } from "@earendil-works/pi-coding-agent";

// The ponygirls-subagents delegated-call contract (duplicated there by design).
const CHANNEL = "ponygirls-subagents:prepare-delegated-call";
interface DelegatedCallEvent {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly cwd: string;
  waitUntil(work: Promise<void>): void;
}

// Specified Behavioral-Active / Blackbox-Group: actual Pi loader and event bus, public contract.
test("subagent calls are prepared like the session's own: index first, then a verified projectPath", {
  skip: !process.env.PI_CODEGRAPH_SDK_ROOT ? "set PI_CODEGRAPH_SDK_ROOT to the installed pi-monorepo" : false,
}, async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "pi-codegraph-delegated-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const child = join(base, "child");
  await mkdir(child);
  execFileSync("git", ["init", "--quiet", child]);
  const calls = join(base, "calls.log");
  const status = { initialized: true, projectPath: child, indexPath: join(child, ".codegraph"),
    fileCount: 1, nodeCount: 1, pendingChanges: { added: 0, modified: 0, removed: 0 },
    index: { state: "complete", reindexRecommended: false, pendingRefs: 0, filesNeedingReindex: 0, filesWithParseErrors: 0 } };
  const binary = join(base, "fake-codegraph");
  await writeFile(binary, `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(calls)},process.argv.slice(2).join(' ')+'\\n');` +
    `if(fs.existsSync(${JSON.stringify(join(base, "fail"))})){process.stderr.write('index failed');process.exit(1);}` +
    `process.stdout.write(${JSON.stringify(JSON.stringify(status))});\n`);
  await chmod(binary, 0o755);
  const old = { binary: process.env.PONYGIRLS_CODEGRAPH_BIN, disabled: process.env.SMIND_CODEGRAPH_DISABLED };
  process.env.PONYGIRLS_CODEGRAPH_BIN = binary;
  delete process.env.SMIND_CODEGRAPH_DISABLED;
  t.after(() => {
    if (old.binary === undefined) delete process.env.PONYGIRLS_CODEGRAPH_BIN;
    else process.env.PONYGIRLS_CODEGRAPH_BIN = old.binary;
    if (old.disabled === undefined) delete process.env.SMIND_CODEGRAPH_DISABLED;
    else process.env.SMIND_CODEGRAPH_DISABLED = old.disabled;
  });
  const sdk = process.env.PI_CODEGRAPH_SDK_ROOT!;
  const { createEventBus } = await import(pathToFileURL(join(sdk, "dist/core/event-bus.js")).href) as { createEventBus: () => { emit(c: string, d: unknown): void } };
  const bus = createEventBus();
  const loader = await import(pathToFileURL(join(sdk, "dist/core/extensions/loader.js")).href);
  const loaded = await loader.loadExtensions([resolve(import.meta.dirname, "index.ts")], base, bus);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0] as Extension;
  const ctx = { cwd: base, mode: "print", hasUI: false, ui: { notify() {}, setWidget() {} } } as unknown as ExtensionContext;
  const emit = (name: string, event: object) => extension.handlers.get(name)![0](event, ctx);
  const prepare = async (toolName: string, input: Record<string, unknown>, cwd: string): Promise<{ claimed: boolean; input: Record<string, unknown> }> => {
    const work: Promise<void>[] = [];
    const event: DelegatedCallEvent = { toolName, input, cwd, waitUntil: (w) => { work.push(w); } };
    bus.emit(CHANNEL, event);
    await Promise.all(work);
    return { claimed: work.length > 0, input };
  };
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  emit("session_start", { type: "session_start", reason: "startup" });

  const own = await prepare("mcp__codegraph__codegraph_explore", { query: "q" }, child);
  assert.equal(own.claimed, true);
  assert.equal(own.input.projectPath, child, "an omitted projectPath means the child's own checkout");
  const relative = await prepare("mcp__codegraph__codegraph_explore", { query: "q", projectPath: "child" }, base);
  assert.equal(relative.input.projectPath, child, "relative paths resolve against the child's cwd");
  const shared = await prepare("mcp__codegraph__codegraph_explore", { query: "q" }, base);
  assert.equal(shared.input.projectPath, child, "a child in the session's cwd uses the session default");
  assert.equal((await prepare("mcp__other__tool", { query: "q" }, child)).claimed, false);

  await writeFile(join(base, "fail"), "");
  await emit("session_shutdown", { type: "session_shutdown", reason: "reload" });
  await rm(join(child, ".codegraph"), { recursive: true, force: true });
  emit("session_start", { type: "session_start", reason: "reload" });
  await assert.rejects(prepare("mcp__codegraph__codegraph_explore", { query: "q" }, child), /index failed|unavailable|exited 1/);
  await emit("session_shutdown", { type: "session_shutdown", reason: "exit" });
});
