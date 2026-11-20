import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile, chmod, readFile } from "node:fs/promises";
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
  const cg = extension.commands.get("cg")!;
  assert.equal(typeof cg.getArgumentCompletions, "function", "/cg must expose syntax completions");
  const suggestions = await cg.getArgumentCompletions!("");
  assert.ok(suggestions);
  assert.ok(suggestions.some((item) => item.value === "use " && item.label.includes("PATH")));
  assert.deepEqual([...extension.commands.keys()], ["cg"]);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  const widgets: { text: string[] | undefined; placement: string | undefined }[] = [];
  const notices: string[] = [];
  const badgeColours: string[] = [];
  const badgeComponents: { render(width: number): string[]; invalidate(): void }[] = [];
  const theme = {
    fg(color: string, text: string) { badgeColours.push(color); return text; },
    bg(color: string, text: string) { return `[${color}]${text}[/]`; },
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
  assert.equal(widgets.at(-1)!.text![0], " 🕸️ indexing ");
  assert.equal(badgeColours.at(-1), "accent");
  const firstBadge = badgeComponents.at(-1)!;
  const { fg, bg } = theme;
  theme.fg = (color, text) => { badgeColours.push(color); return `new-theme:${text}`; };
  theme.bg = (color, text) => `[new-theme:${color}]${text}[/]`;
  firstBadge.invalidate();
  assert.equal(firstBadge.render(120)[0], " 🕸️ new-theme:indexing ");
  theme.fg = fg;
  theme.bg = bg;
  for (let n = 0; n < 100; n++) {
    try { await readFile(marker); break; }
    catch { await new Promise((done) => setTimeout(done, 10)); }
  }
  assert.ok(Number(await readFile(marker, "utf8")), "background CLI must actually start");
  const gate = emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "query", input: {} });
  await cg.handler("cancel", ctx as never);
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
  assert.match(widgets.at(-1)!.text![0], /🕸️ off/);
  emit("tool_execution_start", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "one" });
  emit("tool_execution_start", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "two" });
  assert.equal(widgets.at(-1)!.text![0], " 🕸️ querying 2 ");
  emit("tool_execution_end", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "one" });
  emit("tool_execution_end", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "one" });
  assert.equal(widgets.at(-1)!.text![0], " 🕸️ querying ");
  emit("tool_execution_end", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "two" });
  assert.match(widgets.at(-1)!.text![0], /🕸️ off/);
  assert.doesNotMatch(widgets.at(-1)!.text![0], /querying/);
  await cg.handler("sync", ctx as never);
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

// Regression D3: "nothing indexed yet" is an info state; failures are one-line errors without JSON dumps.
test("Pi loader: empty checkout is an info notice and failures are one-line errors; badge has a compact form", {
  skip: !process.env.PI_CODEGRAPH_SDK_ROOT ? "set PI_CODEGRAPH_SDK_ROOT to the installed pi-monorepo" : false,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-codegraph-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  const binary = join(root, "fake-codegraph");
  const empty = { initialized: true, projectPath: root, indexPath: join(root, ".codegraph"),
    fileCount: 0, nodeCount: 0, pendingChanges: { added: 0, modified: 0, removed: 0 },
    index: { state: "complete", reindexRecommended: false, pendingRefs: 0, filesNeedingReindex: 0, filesWithParseErrors: 0 } };
  await writeFile(binary, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(empty))});\n`);
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
  const notices: { text: string; level: string }[] = [];
  type Badge = { render(width: number): string[]; renderCompact(width: number): string; invalidate(): void;
    handleMouse(event: { type: string; button: string; x: number; y: number }): unknown };
  let badge: Badge | undefined;
  const theme = {
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
    bold: (text: string) => text,
  };
  type Pane = { render(width: number): string[]; handleInput(data: string): void };
  type PaneFactory = (tui: { terminal: { rows: number }; requestRender(): void }, paneTheme: typeof theme,
    keys: { matches(data: string, action: string): boolean }, done: () => void) => Pane | Promise<Pane>;
  const panes: { component: Pane | undefined; closed: boolean }[] = [];
  // Unstyled, so table cells keep their real widths.
  const plain = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };
  const ctx = { cwd: root, mode: "tui", hasUI: true, ui: {
    theme,
    setWidget(_key: string, widget: ((...args: unknown[]) => Badge) | undefined) {
      badge = widget === undefined ? undefined : widget({}, theme);
    },
    notify(text: string, level: string) { notices.push({ text, level }); },
    custom(factory: PaneFactory): Promise<void> {
      return new Promise((resolve, reject) => {
        const pane: (typeof panes)[number] = { component: undefined, closed: false };
        panes.push(pane);
        Promise.resolve(factory({ terminal: { rows: 40 }, requestRender() {} }, plain,
          { matches: (data, action) => data === "\u001b" && action === "tui.select.cancel" },
          () => { pane.closed = true; resolve(); })).then((component) => { pane.component = component; }, reject);
      });
    },
  } } as unknown as ExtensionContext;
  const emit = (name: string, event: object) => extension.handlers.get(name)![0](event, ctx);
  const settle = async (done: () => boolean) => {
    for (let n = 0; n < 200 && !done(); n++) await new Promise((wait) => setTimeout(wait, 10));
  };
  /** Runs a /cg command that opens the status pane, returns its screen at 120 columns and after `d`, and closes it. */
  const statusPane = async (args: string): Promise<{ table: string; details: string }> => {
    const count = panes.length;
    const shown = extension.commands.get("cg")!.handler(args, ctx as never);
    await settle(() => panes.length > count && panes.at(-1)!.component !== undefined);
    assert.equal(panes.length, count + 1, `/cg ${args} must open one pane`);
    const pane = panes.at(-1)!.component!;
    const screen = () => pane.render(120).map((line) => line.trimEnd()).join("\n");
    const table = screen();
    pane.handleInput("d");
    const details = screen();
    pane.handleInput("\u001b");
    await shown;
    assert.equal(panes.at(-1)!.closed, true);
    return { table, details };
  };
  emit("session_start", { type: "session_start", reason: "startup" });
  assert.equal(badge!.renderCompact(20), "🕸️<accent>●</accent>");
  await settle(() => notices.length > 0);
  assert.deepEqual(notices, [{ text: "Codegraph: nothing indexed in this checkout yet · /cg status for details", level: "info" }]);
  assert.equal(badge!.render(120)[0], " 🕸️ <muted>empty</muted> ");
  assert.equal(badge!.renderCompact(20), "🕸️");
  await emit("session_shutdown", { type: "session_shutdown", reason: "reload" });

  await writeFile(binary, `#!${process.execPath}\nprocess.stderr.write("database is locked\\nsecond line");process.exit(3);\n`);
  notices.length = 0;
  emit("session_start", { type: "session_start", reason: "reload" });
  await settle(() => notices.length > 0);
  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.level, "error");
  assert.doesNotMatch(notices[0]!.text, /\n|Error:|\{/, "one line, no duplicated Error: prefix, no JSON");
  assert.match(notices[0]!.text, /^Codegraph: codegraph \w+ exited 3: database is locked · \/cg status for details$/);
  assert.equal(badge!.renderCompact(20), "🕸️<error>✖</error>");
  const failed = await statusPane("status");
  // Without a local index the status probe itself is skipped; the failed preparation stays on record.
  assert.match(failed.table, /^▌ \S+  skipped +— +— /m);
  assert.match(failed.table, /^last failure \d{4}-\d\d-\d\d \d\d:\d\d UTC\ncodegraph init exited 3: database is locked\nsecond line$/m, "full detail stays available via /cg status");
  assert.match(failed.details, /last failure: \S+: Error: codegraph init exited 3: database is locked\s+second line/);
  assert.equal(notices.length, 1, "the status pane replaces the status notification");
  await emit("session_shutdown", { type: "session_shutdown", reason: "exit" });

  // Regression: a second Pi starting while another process syncs the same index showed a red error and badge.
  const ready = { ...empty, fileCount: 2808, nodeCount: 106105 };
  const attempts = join(root, "sync-attempts");
  const refusal = "✗ Failed to sync: Sync could not acquire the file lock; retry when the index is available. CodeGraph database is locked by another process (kernel flock)";
  const fake = (sync: string) => `#!${process.execPath}\nconst command = process.argv[2];\n` +
    `if (command === "status") process.stdout.write(${JSON.stringify(JSON.stringify(ready))});\n` +
    `else if (command === "sync") { require("node:fs").appendFileSync(${JSON.stringify(attempts)}, "x"); ${sync} }\n`;
  await mkdir(join(root, ".codegraph"));
  await writeFile(join(root, ".codegraph", "codegraph.db"), "");
  await writeFile(binary, fake(`process.stderr.write(${JSON.stringify(`${refusal}\n`)}); process.exit(1);`));
  const syncAttempts = async () => (await readFile(attempts, "utf8").catch(() => "")).length;
  notices.length = 0;
  emit("session_start", { type: "session_start", reason: "startup" });
  assert.equal(badge!.renderCompact(20), "🕸️<accent>●</accent>");
  for (let n = 0; n < 500 && (await syncAttempts() === 0 || badge!.renderCompact(20) !== "🕸️"); n++) await new Promise((wait) => setTimeout(wait, 10));
  assert.equal(await syncAttempts(), 1, "the first sync must have met the lock");
  assert.deepEqual(notices, [], "lock contention is neither an error line nor any other notice");
  assert.equal(badge!.render(120)[0], " 🕸️ ", "no error badge");
  assert.equal(badge!.renderCompact(20), "🕸️");
  badge!.handleMouse({ type: "click", button: "left", x: 0, y: 0 });
  await settle(() => panes.at(-1)!.component !== undefined && !panes.at(-1)!.closed);
  const contended = panes.at(-1)!.component!.render(120).map((line) => line.trimEnd()).join("\n");
  assert.match(contended, /^── Codegraph ─+ 1 busy elsewhere ──$/m);
  assert.match(contended, /^▌ \S+  busy elsewhere +— +— /m);
  assert.match(contended, /^busy elsewhere · \d{4}-\d\d-\d\d \d\d:\d\d UTC · another process held the index lock; the next query or \/cg sync tries again$/m);
  assert.doesNotMatch(contended, /error|Failed to sync/, "the pane shows no failure");
  panes.at(-1)!.component!.handleInput("\u001b");
  const blocked = await emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "busy", input: {} }) as { block: boolean; reason: string };
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /Codegraph index busy at .*: another process holds the index lock; retry shortly/);
  assert.equal(await syncAttempts(), 2, "the query retried the sync");
  await writeFile(binary, fake(""));
  const routed: { projectPath?: string } = {};
  assert.equal(await emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", toolCallId: "free", input: routed }), undefined);
  assert.equal(routed.projectPath, root, "once the other process is done, the next query prepares the index itself");
  assert.equal(await syncAttempts(), 3);
  const prepared = await statusPane("");
  assert.match(prepared.table, /^── Codegraph ─+ 1 index ──$/m, "bare /cg shows the status pane");
  assert.match(prepared.table, /^  CHECKOUT +STATE  FILES  SYMBOLS +SIZE  CHECKED$/m);
  assert.match(prepared.table, /^▌ \S+  ready  2,808  106,105 +\S+  just now$/m);
  assert.match(prepared.details, /Codegraph inventory — last checks, not live watcher health/);
  assert.deepEqual(notices, []);
  await emit("session_shutdown", { type: "session_shutdown", reason: "exit" });
});
