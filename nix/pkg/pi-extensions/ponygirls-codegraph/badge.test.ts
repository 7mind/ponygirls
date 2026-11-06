import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import extension from "./index.ts";

type Badge = Component & { handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined };
// Specified Behavioral-Active / Blackbox-Group: real extension, scripted UI boundary.
test("badge toggles last-checked status without enabling Codegraph, and closes by keyboard or shutdown", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "cg-badge-"));
  const disabled = process.env.SMIND_CODEGRAPH_DISABLED;
  process.env.SMIND_CODEGRAPH_DISABLED = "1";
  t.after(async () => {
    if (disabled === undefined) delete process.env.SMIND_CODEGRAPH_DISABLED; else process.env.SMIND_CODEGRAPH_DISABLED = disabled;
    await rm(cwd, { recursive: true, force: true });
  });
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  extension({ on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
    registerCommand() {}, events: { on() {} } } as unknown as ExtensionAPI);
  let badge: Badge | undefined;
  const views: Array<{ component: Component; closed: boolean }> = [];
  const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };
  type PanelFactory = (tui: { terminal: { rows: number }; requestRender(): void }, activeTheme: typeof theme,
    keys: { matches(data: string, action: string): boolean }, done: () => void) => Component | Promise<Component>;
  const ctx = { cwd, mode: "tui", hasUI: true, ui: {
    notify() {},
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
  assert.match(views[0]!.component.render(100).join("\n"), /Codegraph inventory.*last checks/);
  assert.match(views[0]!.component.render(100).join("\n"), /0 scopes/);
  assert.match(badge!.render(80)[0]!, /skipped/, "read-only status must not enable routing");
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
});
