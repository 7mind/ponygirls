import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import type { Extension, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Specified Behavioral-Active / Blackbox-Group: actual Pi loader, public extension hooks.
test("Pi loader: factory is inert, session startup returns before CLI, commands and shutdown remain live", {
  skip: !process.env.PI_CODEGRAPH_SDK_ROOT ? "set PI_CODEGRAPH_SDK_ROOT to the installed pi-monorepo" : false,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-codegraph-extension-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  const marker = join(root, "started");
  const binary = join(root, "slow-codegraph");
  await writeFile(binary, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);\n`);
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
  const loader = await import(pathToFileURL(join(sdk, "dist/core/extensions/loader.js")).href);
  const loaded = await loader.loadExtensions([resolve(import.meta.dirname, "index.ts")], root);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0] as Extension;
  assert.ok(extension);
  assert.equal(extension.tools.size, 0, "existing MCP tool names must remain untouched");
  assert.deepEqual([...extension.commands.keys()], ["cg", "cg-status", "cg-sync", "cg-reindex", "cg-cancel"]);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  const widgets: { text: string[] | undefined; placement: string | undefined }[] = [];
  const notices: string[] = [];
  const badgeBackgrounds: string[] = [];
  const badgeComponents: { render(width: number): string[]; invalidate(): void }[] = [];
  const theme = {
    bg(color: string, text: string) { badgeBackgrounds.push(color); return text; },
  };
  const ctx = { cwd: root, mode: "tui", hasUI: true, ui: {
    theme,
    setWidget(_key: string, widget: string[] | ((...args: unknown[]) => { render(width: number): string[]; invalidate(): void }) | undefined, options: { placement: string } | undefined) {
      let text: string[] | undefined;
      if (typeof widget === "function") {
        const component = widget({}, theme);
        badgeComponents.push(component);
        text = component.render(120);
      } else text = widget;
      widgets.push({ text, placement: options === undefined ? undefined : options.placement });
    },
    notify(text: string) { notices.push(text); },
  } } as unknown as ExtensionContext;
  const emit = (name: string, event: object) => {
    const handlers = extension.handlers.get(name);
    assert.ok(handlers);
    assert.equal(handlers.length, 1);
    return handlers[0](event, ctx);
  };
  const start = emit("session_start", { type: "session_start", reason: "startup" });
  assert.equal(start, undefined, "startup hook must not return the owned background promise");
  assert.equal(widgets.at(-1)!.placement, "borderBottomLeft");
  assert.match(widgets.at(-1)!.text![0], /^ CG: working\b/);
  assert.equal(badgeBackgrounds.at(-1), "selectedBg");
  const firstBadge = badgeComponents.at(-1)!;
  theme.bg = (color, text) => { badgeBackgrounds.push(color); return `new-theme:${text}`; };
  firstBadge.invalidate();
  assert.match(firstBadge.render(120)[0], /^new-theme: CG:/);
  theme.bg = (color, text) => { badgeBackgrounds.push(color); return text; };
  for (let n = 0; n < 100; n++) {
    try { await readFile(marker); break; }
    catch { await new Promise((done) => setTimeout(done, 10)); }
  }
  assert.ok(Number(await readFile(marker, "utf8")), "background CLI must actually start");
  const gate = emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "query", input: {} });
  const cancel = extension.commands.get("cg-cancel")!;
  await cancel.handler("", ctx as never);
  assert.equal((await gate as { block: boolean }).block, true);
  assert.match(widgets.at(-1)!.text![0], /cancelled/);
  assert.ok(notices.some((text) => text.includes("MCP watcher unchanged")));
  await emit("session_shutdown", { type: "session_shutdown", reason: "reload" });
  await emit("session_shutdown", { type: "session_shutdown", reason: "reload" });
  assert.equal(widgets.at(-1)!.text, undefined);
  const widgetCount = widgets.length;
  await new Promise((done) => setTimeout(done, 30));
  assert.equal(widgets.length, widgetCount, "old runtime must not republish after shutdown");

  process.env.SMIND_CODEGRAPH_DISABLED = "1";
  await rm(marker);
  emit("session_start", { type: "session_start", reason: "reload" });
  await new Promise((done) => setTimeout(done, 30));
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  assert.match(widgets.at(-1)!.text![0], /skipped/);
  emit("tool_execution_start", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "one" });
  emit("tool_execution_start", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "two" });
  assert.equal(widgets.at(-1)!.text![0], " CG: querying (2) / skipped ");
  emit("tool_execution_end", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "one" });
  emit("tool_execution_end", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "one" });
  assert.match(widgets.at(-1)!.text![0], /querying \(1\)/);
  emit("tool_execution_end", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "two" });
  assert.match(widgets.at(-1)!.text![0], /skipped/);
  assert.doesNotMatch(widgets.at(-1)!.text![0], /querying/);
  await extension.commands.get("cg-sync")!.handler("", ctx as never);
  for (let n = 0; n < 100; n++) {
    try { await readFile(marker); break; }
    catch { await new Promise((done) => setTimeout(done, 10)); }
  }
  assert.ok(Number(await readFile(marker, "utf8")), "disabled automatic mode must still permit explicit commands");
  await emit("session_shutdown", { type: "session_shutdown", reason: "exit" });

  // Regression: an MCP default opened on an ancestor stays there after local init.
  const status = { initialized: true, projectPath: root, indexPath: join(root, ".codegraph"),
    fileCount: 1, nodeCount: 1, pendingChanges: { added: 0, modified: 0, removed: 0 },
    index: { state: "complete", reindexRecommended: false, pendingRefs: 0,
      filesNeedingReindex: 0, filesWithParseErrors: 0 } };
  await writeFile(binary, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(status))});\n`);
  delete process.env.SMIND_CODEGRAPH_DISABLED;
  emit("session_start", { type: "session_start", reason: "reload" });
  const implicitInput: { query: string; projectPath?: string } = { query: "childOnly" };
  await emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "implicit", input: implicitInput });
  assert.equal(implicitInput.projectPath, root, "verified checkout must replace an omitted MCP default root");
  const explicitInput = { query: "parentOnly", projectPath: "/explicit-other-checkout" };
  await emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "explicit", input: explicitInput });
  assert.equal(explicitInput.projectPath, "/explicit-other-checkout");
  const otherInput: { query: string; projectPath?: string } = { query: "other" };
  await emit("tool_call", { toolName: "mcp__codegraph__different_tool", toolCallId: "other", input: otherInput });
  assert.equal(otherInput.projectPath, root, "other Codegraph tools must use the same verified project scope");
  await emit("session_shutdown", { type: "session_shutdown", reason: "exit" });
  const stdout: unknown[][] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => { stdout.push(args); };
  console.error = () => {};
  try {
    await extension.commands.get("cg")!.handler("help", { ...ctx, mode: "json", hasUI: false } as never);
    assert.equal(stdout.length, 0, "command diagnostics must not corrupt JSON/RPC stdout");
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await emit("session_shutdown", { type: "session_shutdown", reason: "exit" });
  }
});
