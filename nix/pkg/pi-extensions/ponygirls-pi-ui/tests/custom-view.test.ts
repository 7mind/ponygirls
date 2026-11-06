/** Behavioral-Active × Blackbox × Atomic; specified custom-view ownership contract. */
import assert from "node:assert/strict";
import test from "node:test";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { CustomViewToggle, type CustomViewFactory, type CustomViewUI } from "../src/custom-view.ts";

function fixture(delayed: boolean) {
  let opens = 0;
  let closes = 0;
  let start: (() => void) | null = null;
  let options: unknown;
  const ui: CustomViewUI<string, string> = {
    custom<T>(factory: (tui: TUI, theme: string, keys: string, done: (value: T) => void) => Component | Promise<Component>, opts?: { retainEditorBorders?: boolean }) {
      opens += 1;
      options = opts;
      return new Promise<T>((resolve, reject) => {
        const invoke = () => {
          try {
            Promise.resolve(factory({} as TUI, "theme", "keys", (value) => { closes += 1; resolve(value); })).catch(reject);
          } catch (error) { reject(error); }
        };
        if (delayed) start = invoke;
        else invoke();
      });
    },
  };
  return { ui, opens: () => opens, closes: () => closes, options: () => options, start: () => start!() };
}
const component = (): Component => ({ render: () => [], invalidate() {} });

test("toggle closes through done, commands do not duplicate, and Esc allows reopening", async () => {
  const h = fixture(false);
  const view = new CustomViewToggle();
  let esc = () => {};
  const factory: CustomViewFactory<string, string> = (_tui, _theme, _keys, done) => { esc = done; return component(); };
  const opened = view.toggle(h.ui, factory);
  void view.open(h.ui, factory);
  assert.equal(h.opens(), 1);
  assert.deepEqual(h.options(), { retainEditorBorders: true });
  await view.toggle(h.ui, factory);
  await opened;
  assert.equal(h.closes(), 1);
  const reopened = view.open(h.ui, factory);
  esc();
  await reopened;
  assert.equal(h.closes(), 2);
  const last = view.toggle(h.ui, factory);
  view.dispose();
  await last;
  await view.toggle(h.ui, factory);
  assert.equal(h.opens(), 3);
});

test("a double click before the host calls the factory cancels without constructing a view", async () => {
  const h = fixture(true);
  const view = new CustomViewToggle();
  let constructed = 0;
  const factory = () => { constructed += 1; return component(); };
  const opened = view.toggle(h.ui, factory);
  const closed = view.toggle(h.ui, factory);
  void view.toggle(h.ui, factory);
  assert.equal(h.opens(), 1);
  h.start();
  await Promise.all([opened, closed]);
  assert.equal(constructed, 0);
  assert.equal(h.closes(), 1);
});

test("closing during asynchronous construction disposes the late component exactly once", async () => {
  const h = fixture(false);
  const view = new CustomViewToggle();
  let complete!: (value: Component & { dispose(): void }) => void;
  let disposed = 0;
  const opened = view.open(h.ui, () => new Promise((resolve) => { complete = resolve; }));
  await view.toggle(h.ui, component);
  await opened;
  complete({ ...component(), dispose: () => { disposed += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposed, 1);
});

test("shutdown before factory invocation revokes work and stale completion cannot close the next view", async () => {
  const h = fixture(true);
  const view = new CustomViewToggle();
  let constructed = 0;
  const opened = view.open(h.ui, () => { constructed += 1; return component(); });
  view.dispose();
  h.start();
  await opened;
  assert.equal(constructed, 0);
  await view.open(h.ui, component);
  assert.equal(h.opens(), 1);
});

test("failed construction releases ownership so the next open can succeed", async () => {
  const h = fixture(false);
  const view = new CustomViewToggle();
  await assert.rejects(view.open(h.ui, () => { throw new Error("factory failed"); }), /factory failed/);
  const opened = view.open(h.ui, component);
  await view.toggle(h.ui, component);
  await opened;
  assert.equal(h.opens(), 2);
});

test("stale done callbacks cannot close a replacement interaction", async () => {
  const h = fixture(false);
  const view = new CustomViewToggle();
  let staleDone = () => {};
  const first = view.open(h.ui, (_tui, _theme, _keys, done) => { staleDone = done; return component(); });
  await view.toggle(h.ui, component);
  await first;
  const second = view.open(h.ui, component);
  staleDone();
  assert.equal(h.closes(), 1);
  await view.toggle(h.ui, component);
  await second;
  assert.equal(h.closes(), 2);
});

test("closing before host mounting disposes synchronous factory resources once", async () => {
  const h = fixture(false);
  const view = new CustomViewToggle();
  let disposed = 0;
  const opened = view.open(h.ui, () => ({ ...component(), dispose: () => { disposed += 1; } }));
  await view.toggle(h.ui, component);
  await opened;
  assert.equal(disposed, 1);
});
