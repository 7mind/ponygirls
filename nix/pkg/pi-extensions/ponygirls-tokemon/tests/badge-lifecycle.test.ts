import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
import { ENV_PROVIDER_KEYS } from "../src/discovery.ts";
import { renderBorderWidget, untag, TAG_THEME } from "./scripted-http.ts";

test("badge initializes, ages while idle without polling, and stops on shutdown", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tokemon-badge-"));
  const names = [...ENV_PROVIDER_KEYS.map(([name]) => name), "PI_CODING_AGENT_DIR", "XDG_CACHE_HOME"];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  const savedFetch = globalThis.fetch;
  const now = Date.now();
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now });
  try {
    for (const name of names) delete process.env[name];
    process.env.PI_CODING_AGENT_DIR = dir;
    process.env.XDG_CACHE_HOME = dir;
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "oauth", access: "fixture", refresh: "fixture", expires: now + 3600000 } }));
    let requests = 0;
    globalThis.fetch = async (input) => {
      requests++;
      const url = input instanceof Request ? input.url : String(input);
      return Response.json(url.endsWith("/usage") ? { five_hour: { utilization: 42 } } : { account: { email: "test@example.test" } });
    };
    const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (event: string, handler: (event: unknown, ctx: unknown) => void) => handlers.set(event, handler) } as unknown as ExtensionAPI);
    const views: Array<{ component: Component & { dispose?(): void }; closed: boolean }> = [];
    type PanelFactory = (tui: { terminal: { rows: number }; requestRender(): void },
      theme: typeof TAG_THEME & { bg(color: string, text: string): string }, keys: object,
      done: () => void) => Component & { dispose?(): void };
    const custom = (factory: PanelFactory, options: { retainEditorBorders: boolean }): Promise<void> => new Promise((resolve) => {
      assert.equal(options.retainEditorBorders, true);
      const view = { component: undefined as unknown as Component & { dispose?(): void }, closed: false };
      views.push(view);
      view.component = factory({ terminal: { rows: 24 }, requestRender() {} }, { ...TAG_THEME, bg: (_color: string, text: string) => text }, {}, () => {
        view.closed = true;
        view.component.dispose?.();
        resolve();
      });
    });
    const widgets: Array<{ content: unknown; options: unknown }> = [];
    const ctx = { mode: "tui", hasUI: true, model: { provider: "anthropic" }, modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "fixture" } }) }, ui: { custom, setWidget: (_key: string, content: unknown, options: unknown) => { widgets.push({ content, options }); } } };
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    handlers.get("session_start")!({}, ctx);
    await flush();
    assert.match(untag(renderBorderWidget(widgets.at(-1)!.content)), /\[██░░░ 42%\]/);
    assert.deepEqual(widgets.at(-1)!.options, { placement: "borderTopRight" });
    type Badge = Component & { handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined };
    const badge = () => (widgets.at(-1)!.content as (tui: { requestRender(): void }, theme: typeof TAG_THEME) => Badge)({ requestRender() {} }, TAG_THEME) as Badge;
    assert.equal(typeof badge().handleMouse, "function", "quota badge must expose mouse actions");
    const click = { type: "click", button: "left", x: 0, y: 0 } as TuiMouseEvent;
    assert.equal(badge().handleMouse({ ...click, button: "right" }), undefined);
    assert.equal(badge().handleMouse({ ...click, type: "release" }), undefined);
    assert.equal(views.length, 0);
    assert.equal(badge().handleMouse(click)?.handled, true);
    await flush();
    assert.equal(views.length, 1);
    assert.match(untag(views[0]!.component.render(120).join("\n")), /token quotas/);
    badge().handleMouse(click); await flush();
    assert.equal(views[0]!.closed, true);
    badge().handleMouse(click); await flush();
    views[1]!.component.handleInput!("\u001b"); await flush();
    assert.equal(views[1]!.closed, true);
    t.mock.timers.tick(270_000);
    await flush();
    assert.equal(requests, 2, "idle redraws must not query providers");
    // The five-minute refresh may be in flight, but age must render immediately.
    t.mock.timers.tick(30_000);
    assert.match(untag(renderBorderWidget(widgets.at(-1)!.content)), /⚠ stale 5m$/);
    badge().handleMouse(click); await flush();
    const oldBadge = badge();
    handlers.get("session_shutdown")!({}, ctx);
    await flush();
    assert.equal(views[2]!.closed, true);
    oldBadge.handleMouse(click); await flush();
    assert.equal(views.length, 3, "retained badge callbacks cannot reopen after shutdown");
    const count = widgets.length;
    t.mock.timers.tick(600_000);
    await flush();
    assert.equal(widgets.length, count, "timers and in-flight callbacks cannot draw after shutdown");
  } finally {
    globalThis.fetch = savedFetch;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    t.mock.timers.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});
