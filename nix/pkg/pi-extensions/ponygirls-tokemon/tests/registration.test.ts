import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
import { ENV_PROVIDER_KEYS } from "../src/discovery.ts";
import { TAG_THEME, untag } from "./scripted-http.ts";

type Badge = Component & { dispose?(): void };
type Factory = (tui: { requestRender(): void; terminal: { rows: number } }, theme: typeof TAG_THEME) => Badge;
type PanelFactory = (tui: { requestRender(): void; terminal: { rows: number } }, theme: typeof TAG_THEME & { bg(color: string, text: string): string }, keys: object, done: () => void) => Badge;
const click = { type: "click", button: "left", x: 0, y: 0 } as TuiMouseEvent;

async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "tokemon-registration-"));
  const names = [...ENV_PROVIDER_KEYS.map(([name]) => name), "PI_CODING_AGENT_DIR", "XDG_CACHE_HOME"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const now = Date.parse("2026-11-06T15:00:30Z");
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now });
  for (const name of names) delete process.env[name];
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.XDG_CACHE_HOME = dir;
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "oauth", access: "fixture", refresh: "fixture", expires: now + 3600000 } }));
  let requests = 0, renders = 0, publications = 0, opens = 0, closes = 0;
  let current: Badge | undefined;
  let stale = false;
  globalThis.fetch = async (input) => {
    requests++;
    const url = input instanceof Request ? input.url : String(input);
    assert.ok(url.startsWith("https://api.anthropic.com/api/oauth/"));
    return Response.json(url.endsWith("/usage") ? { five_hour: { utilization: 42, resets_at: "2026-11-06T16:00:00Z" } } : { account: { email: "fixture@example.test" } });
  };
  const handlers = new Map<string, (event: object, ctx: unknown) => void>();
  const tui = { terminal: { rows: 24 }, requestRender() { renders++; } };
  const theme = { ...TAG_THEME, bg: (_color: string, text: string) => text };
  const model = { provider: "anthropic" };
  const ctx = { get mode() { if (stale) throw new Error("This extension ctx is stale after reload"); return "tui"; }, hasUI: true,
    get model() { if (stale) throw new Error("This extension ctx is stale after reload"); return model; },
    modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "fixture" } }), getAvailable: () => [] },
    ui: {
      notify() {},
      setWidget(_key: string, factory: Factory | undefined) {
        current?.dispose?.();
        publications++;
        current = factory === undefined ? undefined : factory(tui, theme);
      },
      custom(factory: PanelFactory): Promise<void> {
        opens++;
        return new Promise(resolve => {
          const component = factory(tui, theme, {}, () => { closes++; component.dispose?.(); resolve(); });
        });
      },
    },
  };
  extension({ registerTool() {}, registerCommand() {}, on: (name: string, handler: (event: object, ctx: unknown) => void) => handlers.set(name, handler) } as unknown as ExtensionAPI);
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  t.after(() => {
    handlers.get("session_shutdown")!({}, ctx);
    globalThis.fetch = originalFetch;
    t.mock.timers.reset();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(dir, { recursive: true, force: true });
  });
  handlers.get("session_start")!({}, ctx);
  await flush();
  return { ctx, handlers, flush, model, current: () => current, renders: () => renders, publications: () => publications,
    requests: () => requests, opens: () => opens, closes: () => closes, invalidate: () => { stale = true; } };
}

test("idle redraw updates same-width countdown and stale age without replacing the owned registration", async (t) => {
  const f = await fixture(t);
  const badge = f.current()!, count = f.publications();
  assert.match(untag(badge.render(120)[0]), /59:30/);
  t.mock.timers.tick(30_000);
  assert.equal(f.current(), badge, "same-owner redraw must preserve the registered component");
  assert.equal(f.publications(), count);
  assert.match(untag(badge.render(120)[0]), /59:00/);
  assert.ok(f.renders() > 0);
  assert.equal(f.requests(), 2);
  t.mock.timers.tick(270_000);
  assert.match(untag(badge.render(120)[0]), /stale 5m/);
  assert.equal(f.current(), badge);
});

test("hide/reappear starts a new registration but does not close the live view; owner replacement revokes old callbacks", async (t) => {
  const f = await fixture(t), old = f.current()!;
  old.handleMouse!(click); await f.flush();
  assert.equal(f.opens(), 1);
  f.model.provider = "xiaomi";
  f.handlers.get("model_select")!({}, f.ctx); await f.flush();
  assert.equal(f.current(), undefined);
  assert.equal(f.closes(), 0);
  old.handleMouse!(click); await f.flush();
  assert.equal(f.closes(), 0, "removed badge must not toggle the still-live view");
  f.model.provider = "anthropic";
  f.handlers.get("model_select")!({}, f.ctx); await f.flush();
  const next = f.current()!;
  assert.notEqual(next, old);
  next.handleMouse!(click); await f.flush();
  assert.equal(f.closes(), 1);
  f.handlers.get("session_start")!({}, f.ctx); await f.flush();
  assert.notEqual(f.current(), next);
  next.handleMouse!(click); await f.flush();
  assert.equal(f.opens(), 1);
  f.current()!.handleMouse!(click); await f.flush();
  assert.equal(f.opens(), 2);
});

test("a late stale callback cannot revoke a replacement session owner", async (t) => {
  const f = await fixture(t), old = f.current()!;
  f.invalidate();
  old.handleMouse!(click);
  const fresh = { mode: "tui", hasUI: true, model: f.model, modelRegistry: f.ctx.modelRegistry, ui: f.ctx.ui };
  f.handlers.get("session_start")!({}, fresh);
  await f.flush();
  assert.notEqual(f.current(), old, "the new owner must still publish after the old callback rejects");
  f.current()!.handleMouse!(click); await f.flush();
  assert.equal(f.opens(), 1);
});

test("stale context redraw without shutdown revokes callbacks and stops future publication", async (t) => {
  const f = await fixture(t), old = f.current()!;
  f.invalidate();
  assert.doesNotThrow(() => t.mock.timers.tick(30_000));
  const count = f.publications();
  old.handleMouse!(click); await f.flush();
  assert.equal(f.opens(), 0);
  assert.doesNotThrow(() => t.mock.timers.tick(600_000));
  assert.equal(f.publications(), count);
});
