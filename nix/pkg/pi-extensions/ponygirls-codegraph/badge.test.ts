import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import extension from "./index.ts";
import { CG_HELP } from "./commands.ts";
import { isolateAgentConfig, emptySettingsContext } from "./test-fixtures.ts";

type Badge = Component & { handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined };
// Specified Behavioral-Active / Blackbox-Group: real extension, scripted UI boundary.
test("the badge opens the status pane without enabling Codegraph, /cg opens the same pane, and it closes by keyboard or shutdown", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "cg-badge-"));
  isolateAgentConfig(t, cwd);
  const disabled = process.env.SMIND_CODEGRAPH_DISABLED;
  process.env.SMIND_CODEGRAPH_DISABLED = "1";
  t.after(async () => {
    if (disabled === undefined) delete process.env.SMIND_CODEGRAPH_DISABLED; else process.env.SMIND_CODEGRAPH_DISABLED = disabled;
    await rm(cwd, { recursive: true, force: true });
  });
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  let cg: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
  extension({ on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
    registerCommand(_name: string, command: { handler(args: string, ctx: ExtensionContext): Promise<void> }) { cg = command.handler; },
    events: { on() {} } } as unknown as ExtensionAPI);
  let badge: Badge | undefined;
  const views: Array<{ component: Component; closed: boolean }> = [];
  const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };
  type PanelFactory = (tui: { terminal: { rows: number }; requestRender(): void }, activeTheme: typeof theme,
    keys: { matches(data: string, action: string): boolean }, done: () => void) => Component | Promise<Component>;
  const notices: string[] = [];
  const ctx = { ...emptySettingsContext, cwd, mode: "tui", hasUI: true, ui: {
    notify(text: string) { notices.push(text); },
    setWidget(_key: string, factory: ((tui: object, activeTheme: typeof theme) => Badge) | undefined) { badge = factory === undefined ? undefined : factory({}, theme); },
    custom(factory: PanelFactory, options: { retainEditorBorders: boolean }): Promise<void> {
      assert.equal(options.retainEditorBorders, true);
      return new Promise((resolve, reject) => {
        const view = { component: undefined as unknown as Component, closed: false }; views.push(view);
        Promise.resolve(factory({ terminal: { rows: 24 }, requestRender() {} }, theme,
          { matches: (data: string, action: string) => data === "\u001b" && action === "tui.select.cancel" },
          () => { view.closed = true; resolve(); })).then((component) => { view.component = component; }, reject);
      });
    },
  } } as unknown as ExtensionContext;
  await handlers.get("session_start")!({}, ctx);
  t.after(() => handlers.get("session_shutdown")!({}, ctx));
  assert.equal(typeof badge!.handleMouse, "function", "Codegraph badge must expose mouse actions");
  const click = { type: "click", button: "left", x: 0, y: 0 } as TuiMouseEvent;
  assert.equal(badge!.handleMouse({ ...click, button: "right" }), undefined);
  assert.equal(badge!.handleMouse({ ...click, type: "release" }), undefined);
  assert.equal(views.length, 0);
  assert.equal(badge!.handleMouse(click)?.handled, true);
  await new Promise(setImmediate);
  assert.equal(views.length, 1);
  const screen = (view: number) => views[view]!.component.render(100).map((line) => line.trimEnd()).join("\n");
  assert.match(screen(0), /^── Codegraph ─+\nNo checkouts listed\. \/cg discover PATH finds them;/, "the badge opens the status pane");
  assert.match(screen(0), /^d details  esc close$/m);
  views[0]!.component.handleInput!("d");
  assert.match(screen(0), /Codegraph inventory.*last checks/, "the complete text report stays one key away");
  assert.match(screen(0), /0 scopes/);
  assert.match(screen(0), /^↑↓ scroll  PgUp\/PgDn page  d table  esc close$/m);
  views[0]!.component.handleInput!("d");
  assert.doesNotMatch(screen(0), /Codegraph inventory/);
  assert.match(badge!.render(80)[0]!, /🕸️ off/, "read-only status must not enable routing");
  badge!.handleMouse(click); await new Promise(setImmediate);
  assert.equal(views[0]!.closed, true);
  badge!.handleMouse(click); await new Promise(setImmediate);
  views[1]!.component.handleInput!("\u001b"); await new Promise(setImmediate);
  assert.equal(views[1]!.closed, true);
  badge!.handleMouse(click); await new Promise(setImmediate);
  const oldBadge = badge!;
  await handlers.get("session_shutdown")!({}, ctx);
  assert.equal(views[2]!.closed, true);
  assert.equal(badge, undefined);
  await handlers.get("session_start")!({}, ctx);
  oldBadge.handleMouse(click); await new Promise(setImmediate);
  assert.equal(views.length, 3, "old-session badge callbacks remain revoked after restart");

  // `/cg` and `/cg status` open the same pane; clients without the TUI read the text report; help is asked for by name.
  const opened = async (): Promise<void> => {
    const count = views.length;
    for (let n = 0; n < 500 && (views.length === count || views.at(-1)!.component === undefined); n++) await new Promise((wait) => setTimeout(wait, 10));
    assert.equal(views.length, count + 1);
  };
  for (const args of ["", "status", "status --all", `status ${JSON.stringify(cwd)}`]) {
    const shown = cg!(args, ctx);
    if (args.endsWith('"')) {
      // A directory that is no checkout is refused before any pane opens.
      await shown;
      assert.match(notices.at(-1)!, /No Git checkout or opted-in workspace at /, args);
      continue;
    }
    await opened();
    assert.match(screen(views.length - 1), /^── Codegraph ─+\nNo checkouts listed\./, JSON.stringify(args));
    views.at(-1)!.component.handleInput!("\u001b");
    await shown;
    assert.equal(views.at(-1)!.closed, true);
  }
  const panes = views.length;
  const reports = notices.length;
  await cg!("help", ctx);
  assert.equal(notices.at(-1), CG_HELP);
  for (const args of ["", "status"]) {
    await cg!(args, { ...ctx, mode: "rpc" } as ExtensionContext);
    assert.match(notices.at(-1)!, /^Codegraph inventory — last checks, not live watcher health; logical bytes \(WAL\/SHM included\):\nAggregate total 0 bytes; 0 scopes\nNo projects\./, JSON.stringify(args));
  }
  assert.equal(notices.length, reports + 3);
  assert.equal(views.length, panes, "no pane outside the TUI, and none for help");
});
