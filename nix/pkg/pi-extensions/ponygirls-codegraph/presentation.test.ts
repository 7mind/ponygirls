import assert from "node:assert/strict";
import test from "node:test";
import type { UiTheme } from "@ponygirls/pi-ui";
import { renderCompactBadge, stateNotice } from "./presentation.ts";
import type { State } from "./runtime.ts";

const theme: UiTheme = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
  bg: (color, text) => `[${color}]${text}[/${color}]`,
  bold: (text) => text,
};

test("state notices: empty is info, errors are one line without Error: prefixes or JSON, others are silent", () => {
  assert.deepEqual(stateNotice({ phase: "empty", detail: "/r: no indexable files (0 files, 0 symbols)" }),
    { text: "Codegraph: nothing indexed in this checkout yet · /cg status for details", level: "info" });
  assert.deepEqual(stateNotice({ phase: "error", detail: "Error: Index not ready at /r\n{\"fileCount\":3}" }),
    { text: "Codegraph: Index not ready at /r · /cg status for details", level: "error" });
  assert.deepEqual(stateNotice({ phase: "error", detail: "Error: Error: codegraph init exited 1: \nstdout text\n" }),
    { text: "Codegraph: codegraph init exited 1 · /cg status for details", level: "error" });
  assert.deepEqual(stateNotice({ phase: "error", detail: "\n" }),
    { text: "Codegraph: failed · /cg status for details", level: "error" });
  for (const phase of ["idle", "working", "ready", "skipped", "cancelled"] as const) {
    assert.equal(stateNotice({ phase, detail: "x" }), null, phase);
  }
});

test("compact badge: glyph and colour follow state; querying counts as running", () => {
  const chip = (glyph: string, color: string) => `[toolPendingBg] <${color}>${glyph}</${color}><text>cg</text> [/toolPendingBg]`;
  const cases: [State["phase"], boolean, string][] = [
    ["ready", false, chip("◇", "success")],
    ["working", false, chip("⚙", "accent")],
    ["ready", true, chip("⚙", "accent")],
    ["error", false, chip("✖", "error")],
    ["empty", false, chip("◇", "muted")],
    ["idle", false, chip("◇", "muted")],
    ["skipped", false, chip("◇", "muted")],
    ["cancelled", false, chip("◇", "muted")],
  ];
  for (const [phase, querying, expected] of cases) assert.equal(renderCompactBadge(theme, phase, querying), expected, `${phase}/${querying}`);
});
