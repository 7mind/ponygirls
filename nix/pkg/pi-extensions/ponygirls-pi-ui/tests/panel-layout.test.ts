/** Behavioral-Active × Blackbox × Group; specified allocated pane layout contract. */
import assert from "node:assert/strict";
import test from "node:test";
import { VStack } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { PanelLayout } from "../src/panel-layout.ts";

const body = Array.from({ length: 50 }, (_, i) => `row ${i}`);

test("fixed pane chrome survives allocation and exposes the actual body height", () => {
  const panel = new PanelLayout(() => ({ header: ["title"], body, footer: ["esc close"] }));
  assert.equal(panel.hasAllocatedHeight, false);
  assert.equal(panel.height(24), 24);
  let renders = 0;
  const frame = renderLayoutFrame(panel, 48, 8, () => { renders++; });
  assert.equal(frame.lines[0], "title");
  assert.equal(frame.lines.at(-1), "esc close");
  assert.equal(panel.bodyHeight(24), 6);
  assert.equal(panel.height(24), 8);
  assert.equal(panel.hasAllocatedHeight, true);
  assert.equal(renders, 1, "request one follow-up for height-aware domain pagination");
});

test("intrinsic measurement never clamps scrolling with a terminal-sized preview", () => {
  const panel = new PanelLayout(() => ({ header: ["title"], body, footer: ["esc close"] }));
  const root = new VStack([{ component: panel, grow: 1 }]);
  renderLayoutFrame(root, 100, 18, () => {});
  panel.bodyScroll.scrollToEnd();
  const top = panel.bodyScroll.scrollTop;
  panel.render(48);
  assert.equal(panel.bodyScroll.scrollTop, top);
  const end = renderLayoutFrame(root, 100, 18, () => {});
  assert.equal(end.lines.at(-2), "row 49");
  renderLayoutFrame(root, 48, 8, () => {});
  panel.bodyScroll.scrollToEnd();
  const resized = renderLayoutFrame(root, 48, 8, () => {});
  assert.equal(resized.lines.at(-2), "row 49");
  assert.equal(resized.lines.at(-1), "esc close");
});

test("a zero-height body is allocated rather than mistaken for regular mode", () => {
  const panel = new PanelLayout(() => ({ header: ["title"], body, footer: ["esc close"] }));
  renderLayoutFrame(panel, 48, 2, () => {});
  assert.equal(panel.hasAllocatedHeight, true);
  assert.equal(panel.bodyHeight(24), 0);
  assert.equal(panel.height(24), 2);
});

test("a paginated panel regains height after resize under an auto-basis grow-zero editor", () => {
  let terminalRows = 12;
  const panel = new PanelLayout(() => ({ header: ["title"], body: body.slice(0, panel.bodyHeight(terminalRows - 2)), footer: ["esc close"] }));
  const transcript = { render: () => ["transcript"], invalidate() {} };
  const footer = { render: () => ["status", "badges"], invalidate() {} };
  const root = new VStack([
    { component: transcript, basis: 0, grow: 1, shrink: 1 },
    { component: panel, grow: 0, shrink: 1 },
    { component: footer, shrink: 0 },
  ]);
  renderLayoutFrame(root, 48, terminalRows, () => {});
  const short = panel.bodyScroll.viewportHeight;
  terminalRows = 24;
  renderLayoutFrame(root, 100, terminalRows, () => {});
  assert.ok(panel.bodyScroll.viewportHeight > short, "the pane must not retain its former small intrinsic height");
  assert.equal(panel.bodyScroll.viewportHeight, 20);
});


test("panel wheel handling consumes boundary gestures instead of scrolling the background", () => {
  const panel = new PanelLayout(() => ({ header: ["title"], body, footer: ["esc close"] }));
  renderLayoutFrame(panel, 48, 8, () => {});
  panel.bodyScroll.scrollToEnd();
  const wheel = { type: "wheel" as const, button: "none" as const, x: 1, y: 2, screenX: 1, screenY: 2, width: 48, height: 8, shift: false, alt: false, ctrl: false, wheelDelta: 3 };
  assert.equal(panel.handleMouse(wheel)?.handled, true);
  assert.equal(panel.handleMouse({ ...wheel, wheelDelta: -3 })?.handled, true);
  assert.equal(panel.bodyScroll.scrollTop, 41);
  assert.equal(panel.handleMouse({ ...wheel, type: "click", button: "left" }), undefined);
});
