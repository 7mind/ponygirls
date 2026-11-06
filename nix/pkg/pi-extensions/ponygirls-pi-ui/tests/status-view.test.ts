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
