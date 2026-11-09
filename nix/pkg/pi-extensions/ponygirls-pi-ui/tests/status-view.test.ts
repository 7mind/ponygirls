import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import * as ui from "../src/index.ts";

// Specified Behavioral-Active / Blackbox-Group: shared panel and real TUI rendering.
test("status view wraps narrow/wide text, bounds its viewport, and scrolls", () => {
  assert.equal(typeof ui.StatusView, "function", "shared read-only status view must be exported");
  let rows = 12;
  let renders = 0;
  const view = new ui.StatusView({ title: "Status", text: Array.from({ length: 30 }, (_, n) => `line ${n} 日本語`).join("\n"),
    theme: ui.PLAIN_THEME, keys: { matches: () => false }, rows: () => rows, requestRender: () => { renders++; }, close() {} });
  for (const width of [4, 20, 100]) {
    const lines = view.render(width);
    assert.ok(lines.length <= rows);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
  }
  view.render(100);
  view.handleInput("\u001b[F");
  assert.match(view.render(100).join("\n"), /line 29/);
  view.handleInput("\u001b[H");
  assert.match(view.render(100).join("\n"), /line 0/);
  view.handleMouse({ type: "wheel", wheelDelta: 4 } as never);
  assert.doesNotMatch(view.render(100).join("\n"), /line 0 /);
  rows = 9;
  assert.ok(view.render(100).length <= rows);
  assert.ok(renders > 0);
});

test("status view rebuilds themed content on invalidation without losing the snapshot", () => {
  let color = "success";
  const snapshot = "Historical evidence";
  const view = new ui.StatusView({ title: "Status", text: () => `${color}: ${snapshot}`, theme: ui.PLAIN_THEME,
    keys: { matches: () => false }, rows: () => 24, requestRender() {}, close() {} });
  assert.match(view.render(80).join("\n"), /success: Historical evidence/);
  color = "accent";
  view.invalidate();
  assert.match(view.render(80).join("\n"), /accent: Historical evidence/);
  assert.doesNotMatch(view.render(80).join("\n"), /success:/);
});

test("status view provides current width to content on resize and invalidation", () => {
  const widths: number[] = [];
  const view = new ui.StatusView({ title: "Width", text: (width: number) => { widths.push(width); return `Content width ${width}`; },
    theme: ui.PLAIN_THEME, keys: { matches: () => false }, rows: () => 24, requestRender() {}, close() {} });
  assert.match(view.render(80).join("\n"), /Content width 80/);
  assert.match(view.render(40).join("\n"), /Content width 40/);
  view.invalidate();
  assert.match(view.render(60).join("\n"), /Content width 60/);
  assert.ok(widths.includes(80)); assert.ok(widths.includes(40)); assert.ok(widths.includes(60));
});

test("status view honors configured cancel and q without mutating its text", () => {
  assert.equal(typeof ui.StatusView, "function");
  let closed = 0;
  const view = new ui.StatusView({ title: "Status", text: "snapshot", theme: ui.PLAIN_THEME,
    keys: { matches: (data, action) => data === "cancel" && action === "tui.select.cancel" },
    rows: () => 24, requestRender() {}, close: () => { closed++; } });
  view.handleInput("cancel"); view.handleInput("q");
  assert.equal(closed, 2);
  view.handleInput("not a command");
  assert.match(view.render(40).join("\n"), /snapshot/);
});

test("allocated fullscreen height preserves status hints and scrolls the complete snapshot", async () => {
  const { VStack, Text } = await import("@earendil-works/pi-tui");
  const { renderLayoutFrame } = await import("@earendil-works/pi-tui/dist/layout.js");
  const view = new ui.StatusView({ title: "Status", text: Array.from({ length: 40 }, (_, n) => `snapshot line ${n}`).join("\n"),
    theme: ui.PLAIN_THEME, keys: { matches: () => false }, rows: () => 30, requestRender() {}, close() {} });
  const root = new VStack([
    { component: new Text("transcript", 0, 0), shrink: 0 },
    { component: new Text("top badge", 0, 0), shrink: 0 },
    { component: view, shrink: 1 },
    { component: new Text("bottom badge\nPi status", 0, 0), shrink: 0 },
  ]);
  const frame = () => renderLayoutFrame(root, 48, 18, () => {}).lines;
  assert.match(frame().join("\n"), /esc\/q close/, "actual allocation must keep the close hints visible");
  view.handleInput("\u001b[F");
  assert.match(frame().join("\n"), /snapshot line 39/, "End reaches the real last row, not a pre-clipped body");
  assert.equal(frame().at(-1)!.trimEnd(), "Pi status");
  const grown = renderLayoutFrame(root, 80, 30, () => {}).lines.join("\n");
  assert.match(grown, /snapshot line 39/);
  assert.match(grown, /esc\/q close/);
  renderLayoutFrame(root, 48, 12, () => {});
  view.handleInput("\u001b[F");
  const shrunk = renderLayoutFrame(root, 48, 12, () => {}).lines.join("\n");
  assert.match(shrunk, /snapshot line 39/);
  assert.match(shrunk, /esc\/q close/);
});
