import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import type { Extension, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface RpcMessage {
  id: number | string;
  method?: string;
  result?: { tools?: { name: string }[]; content?: { type: string; text: string }[] };
  error?: { message: string };
}
function client(binary: string, root: string, env: NodeJS.ProcessEnv) {
  const child = spawn(binary, ["serve", "--mcp"], { cwd: root, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let sequence = 0;
  let stderr = "";
  const pending = new Map<number, { resolve(value: RpcMessage): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-32768); });
  const send = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line) as RpcMessage;
    if (message.method === "roots/list") {
      send({ id: message.id, result: { roots: [{ uri: pathToFileURL(root).href, name: "fixture" }] } });
      return;
    }
    const entry = pending.get(message.id as number);
    if (entry === undefined) return;
    pending.delete(message.id as number);
    clearTimeout(entry.timer);
    entry.resolve(message);
  });
  child.on("close", () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(`MCP exited: ${stderr}`)); }
    pending.clear();
  });
  return {
    request(method: string, params: object): Promise<RpcMessage> {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); }, 20_000);
        pending.set(id, { resolve, reject, timer });
        send({ id, method, params });
      });
    },
    notify(method: string) { send({ method }); },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = new Promise<void>((done) => child.once("close", () => done()));
      child.stdin.end();
      const timer = setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      }, 1000);
      await closed;
      clearTimeout(timer);
    },
  };
}
function text(message: RpcMessage): string {
  assert.equal(message.error, undefined);
  assert.ok(message.result?.content);
  return message.result.content.map((part) => part.text).join("\n");
}

// Regression / Behavioral-Active Blackbox-GoodCommunication: existing MCP ancestor default
// remains open after a nested checkout's independent local index becomes ready.
test("MCP before init: nested checkout defaults stay local and explicit paths remain authoritative", {
  skip: !process.env.PONYGIRLS_CODEGRAPH_BIN || !process.env.PI_CODEGRAPH_SDK_ROOT
    ? "set PONYGIRLS_CODEGRAPH_BIN and PI_CODEGRAPH_SDK_ROOT for actual stdio MCP regression" : false,
}, async (t) => {
  const binary = process.env.PONYGIRLS_CODEGRAPH_BIN!;
  const base = await mkdtemp(join(tmpdir(), "pi-codegraph-mcp-"));
  const cleanup: (() => Promise<unknown>)[] = [() => rm(base, { recursive: true, force: true })];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const env = { ...process.env, CODEGRAPH_TELEMETRY: "0", CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS: "500" };
  const cli = (...args: string[]) => execFileSync(binary, args, { env, stdio: "pipe" });
  const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  const parent = join(base, "parent");
  const nested = join(parent, "nested-child");
  await mkdir(parent);
  git(parent, "init", "--quiet");
  await writeFile(join(parent, "example.ts"), "export function parentOnly() { return 'parentOnly-source'; }\n");
  cli("init", parent, "--yes");
  await mkdir(nested);
  git(nested, "init", "--quiet");
  await writeFile(join(nested, "example.ts"), "export function childOnly() { return 'childOnly-source'; }\n");
  const mcp = client(binary, nested, env);
  // Rebuild uses the CLI's verified daemon shutdown; cleanup never signals an unverified PID.
  cleanup.push(async () => {
    await mcp.close();
    cli("index", parent, "--quiet");
    for (const root of [parent, nested]) {
      await assert.rejects(readFile(join(root, ".codegraph", "writer.pid")), { code: "ENOENT" });
    }
  });
  await mcp.request("initialize", { protocolVersion: "2024-11-05", capabilities: { roots: { listChanged: false } },
    clientInfo: { name: "pi-codegraph-fixture", version: "1" }, rootUri: pathToFileURL(nested).href });
  mcp.notify("notifications/initialized");
  const tools = await mcp.request("tools/list", {});
  assert.ok(tools.result?.tools?.some((tool) => tool.name === "codegraph_explore"), "tools must be exposed before local init");
  const loader = await import(pathToFileURL(join(process.env.PI_CODEGRAPH_SDK_ROOT!, "dist/core/extensions/loader.js")).href);
  const loaded = await loader.loadExtensions([resolve(import.meta.dirname, "index.ts")], nested);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0] as Extension;
  const ctx = { cwd: nested, mode: "json", hasUI: false } as ExtensionContext;
  const emit = async (name: string, event: object) => {
    const handlers = extension.handlers.get(name);
    assert.ok(handlers);
    return handlers[0](event, ctx);
  };
  cleanup.push(() => emit("session_shutdown", { type: "session_shutdown", reason: "exit" }));
  await emit("session_start", { type: "session_start", reason: "startup" });
  const explore = async (query: string, projectPath: string | undefined) => {
    const input: { query: string; projectPath?: string } = { query };
    if (projectPath !== undefined) input.projectPath = projectPath;
    const result = await emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: query, input });
    assert.equal(result, undefined, JSON.stringify(result));
    return text(await mcp.request("tools/call", { name: "codegraph_explore", arguments: input }));
  };
  assert.match(await explore("childOnly", undefined), /\*\*`example\.ts`\*\*/);
  assert.doesNotMatch(await explore("parentOnly", undefined), /return 'parentOnly-source'/,
    "default queries must not return ancestor-only source");
  assert.match(await explore("parentOnly", parent), /return 'parentOnly-source'/);
  assert.match(await explore("childOnly", nested), /return 'childOnly-source'/);
});

test("MCP from a non-Git parent: lazy repository isolation and ambiguous defaults", {
  skip: !process.env.PONYGIRLS_CODEGRAPH_BIN || !process.env.PI_CODEGRAPH_SDK_ROOT
    ? "set PONYGIRLS_CODEGRAPH_BIN and PI_CODEGRAPH_SDK_ROOT for workspace MCP checks" : false,
}, async (t) => {
  const binary = process.env.PONYGIRLS_CODEGRAPH_BIN!;
  const base = await mkdtemp(join(tmpdir(), "pi-codegraph-workspace-mcp-"));
  const env = { ...process.env, CODEGRAPH_TELEMETRY: "0", CODEGRAPH_NO_WATCH: "1" };
  t.after(() => rm(base, { recursive: true, force: true }));
  const roots = [join(base, "alpha"), join(base, "beta")];
  for (const [index, root] of roots.entries()) {
    await mkdir(root);
    execFileSync("git", ["-C", root, "init", "--quiet"]);
    await writeFile(join(root, "example.ts"), `export function sentinel${index}() { return 'only-${index}'; }\n`);
  }
  const mcp = client(binary, base, env);
  t.after(() => mcp.close());
  await mcp.request("initialize", { protocolVersion: "2024-11-05", capabilities: {},
    clientInfo: { name: "workspace-fixture", version: "1" } });
  mcp.notify("notifications/initialized");
  const loader = await import(pathToFileURL(join(process.env.PI_CODEGRAPH_SDK_ROOT!, "dist/core/extensions/loader.js")).href);
  const loaded = await loader.loadExtensions([resolve(import.meta.dirname, "index.ts")], base);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0] as Extension;
  const ctx = { cwd: base, mode: "json", hasUI: false } as ExtensionContext;
  const emit = (name: string, event: object) => extension.handlers.get(name)![0](event, ctx);
  t.after(() => emit("session_shutdown", { type: "session_shutdown", reason: "exit" }));
  emit("session_start", { type: "session_start", reason: "startup" });
  const implicit = await emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "ambiguous", input: { query: "sentinel" } });
  assert.notEqual(implicit, undefined, "multi-repository defaults must be rejected rather than forwarded to MCP");
  assert.equal((implicit as { block: boolean }).block, true);
  for (const root of [base, ...roots]) {
    await assert.rejects(readFile(join(root, ".codegraph", "codegraph.db")), { code: "ENOENT" });
  }
  for (const [index, root] of roots.entries()) {
    const input = { query: `sentinel${index}`, projectPath: root };
    assert.equal(await emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: root, input }), undefined);
    const output = text(await mcp.request("tools/call", { name: "codegraph_explore", arguments: input }));
    assert.match(output, new RegExp(`return 'only-${index}'`));
    assert.doesNotMatch(output, new RegExp(`return 'only-${1 - index}'`));
  }
  await assert.rejects(readFile(join(base, ".codegraph", "codegraph.db")), { code: "ENOENT" });
});
