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

test("flat pages keep one row of overlap after the terminal grows or shrinks", () => {
  let rows = 12;
  const view = new ui.StatusView({ title: "Status", text: Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n"),
    theme: ui.PLAIN_THEME, keys: { matches: () => false }, rows: () => rows, requestRender() {}, close() {} });
  for (rows of [12, 20, 7]) {
    const body = () => view.render(80).filter(line => line.startsWith("line "));
    const before = body();
    assert.equal(before.length, rows - 2);
    view.handleInput("\x1b[6~");
    assert.equal(body()[0], before.at(-1));
  }
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
  assert.match(frame().join("\n"), /esc close/, "actual allocation must keep the close hints visible");
  view.handleInput("\u001b[F");
  assert.match(frame().join("\n"), /snapshot line 39/, "End reaches the real last row, not a pre-clipped body");
  assert.equal(frame().at(-1)!.trimEnd(), "Pi status");
  const grown = renderLayoutFrame(root, 80, 30, () => {}).lines.join("\n");
  assert.match(grown, /snapshot line 39/);
  assert.match(grown, /esc close/);
  renderLayoutFrame(root, 48, 12, () => {});
  view.handleInput("\u001b[F");
  const shrunk = renderLayoutFrame(root, 48, 12, () => {}).lines.join("\n");
  assert.match(shrunk, /snapshot line 39/);
  assert.match(shrunk, /esc close/);
});

for (const kind of ["status", "facts", "details"] as const) {
  test(`fullscreen paging moves the ${kind} body instead of the transcript`, async () => {
    const { ScrollView, TuiAltScreen, VStack, stripTerminalSequences } = await import("@earendil-works/pi-tui");
    let input: (data: string) => void = () => assert.fail("terminal not started");
    const tui = new TuiAltScreen({
      columns: 64, rows: 14, kittyProtocolActive: false, start(onInput) { input = onInput; },
      stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
      clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
    });
    const lines = Array.from({ length: 80 }, (_, i) => `Body row ${i + 1}`);
    const host = { title: "Status", theme: ui.PLAIN_THEME, keys: { matches: () => false }, rows: () => 14, requestRender: () => tui.requestRender(), close() {
      tui.setLayoutRoot(new VStack([{ component: chat, grow: 1 }]));
      tui.setFocus(null);
    } };
    const pane = kind === "status" ? new ui.StatusView({ ...host, text: lines.join("\n") }) : new ui.FactsView({ ...host,
      state: { text: "off", state: "settled" }, facts: () => [lines.map(text => ({ label: "Item", value: [{ text }] }))], details: () => lines.join("\n"),
    });
    const chat = new ScrollView({ render: () => lines.map((_, i) => `Chat row ${i + 1}`), invalidate() {} }, { primary: true, follow: "end" });
    tui.setLayoutRoot(new VStack([{ component: chat, basis: 3, shrink: 0 }, { component: pane, grow: 1, minSize: 0 }]));
    tui.setFocus(pane);
    const screen = () => { tui.renderNow(); return tui.getScreenLines().map(stripTerminalSequences).join("\n"); };
    tui.start();
    try {
      if (kind === "details") input("d");
      const initial = screen();
      assert.match(initial, /Body row 1\b/);
      input("\x1b[5~");
      assert.equal(screen(), initial, "at the local top, PageUp must not move chat");
      input("\x1b[6~");
      const next = screen();
      assert.doesNotMatch(next, /Body row 1\b/);
      assert.equal(next.match(/Body row \d+/)?.[0], initial.match(/Body row \d+/g)?.at(-1));
      assert.match(next, /Chat row 80\b/);
      input("\x1b[5~");
      assert.equal(screen(), initial);
      input("q");
      const closed = screen();
      assert.doesNotMatch(closed, /Body row/);
      assert.match(closed, /Chat row 80\b/);
      input("\x1b[5~");
      const earlier = screen();
      assert.match(earlier, /Chat row \d+/);
      assert.doesNotMatch(earlier, /Chat row 80\b/);
    } finally { tui.stop(); }
  });
}
