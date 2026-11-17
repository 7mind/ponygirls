import assert from "node:assert/strict";
import test from "node:test";
import { borderBadge, borderBadgeCompact, type UiTheme } from "@ponygirls/pi-ui";
import { codegraphBadge, stateNotice } from "./presentation.ts";
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

test("badge: quiet when the index needs nothing; a word for work, chosen states and failure; querying outranks the phase", () => {
  const cases: [State["phase"], number, string, string][] = [
    ["ready", 0, " 🕸️ ", "🕸️"],
    ["idle", 0, " 🕸️ ", "🕸️"],
    ["working", 0, " 🕸️ <accent>indexing</accent> ", "🕸️<accent>▸</accent>"],
    ["ready", 1, " 🕸️ <accent>querying</accent> ", "🕸️<accent>▸</accent>"],
    ["skipped", 2, " 🕸️ <accent>querying 2</accent> ", "🕸️<accent>▸</accent>"],
    ["error", 0, " 🕸️ <error>error</error> ", "🕸️<error>✖</error>"],
    ["cancelled", 0, " 🕸️ <warning>cancelled</warning> ", "🕸️<warning>!</warning>"],
    ["empty", 0, " 🕸️ <muted>empty</muted> ", "🕸️"],
    ["skipped", 0, " 🕸️ <muted>off</muted> ", "🕸️"],
  ];
  for (const [phase, queries, full, compact] of cases) {
    const badge = codegraphBadge(phase, queries);
    assert.equal(borderBadge(theme, badge, 80), full, `${phase}/${queries}`);
    assert.equal(borderBadgeCompact(theme, badge, 80), compact, `${phase}/${queries} compact`);
  }
});
