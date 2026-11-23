import assert from "node:assert/strict";
import test from "node:test";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth, type KeybindingsConfig, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { applyScopedSettingsChanges, ScopedSettingsController, type ScopedSettingsAction, type ScopedSettingsSnapshot } from "@ponygirls/pi-settings";
import { PLAIN_THEME } from "@ponygirls/pi-ui";
import { ALL_OFF, discoveryFields } from "../preferences.ts";
import { ArcheologistPane } from "../src/pane.ts";
import type { PaneInventory } from "../view-contract.ts";
import type { InventoryRow } from "../../context-rules/bridge.ts";

const explorer: InventoryRow = { agentId: "01234567-explorer", parentId: null, label: "explorer", state: "finished", paths: ["/shared", "/outer", "/shared"], complete: true };
const docs: InventoryRow = { agentId: "01234567-docs", parentId: explorer.agentId, label: "docs", state: "closed", paths: ["/shared", "/nested", "/deeper"], complete: true };
const fieldOrder = ["mainNested", "nested", "worktree", "parent", "global"] as const;

function fixture(rows: InventoryRow[] | undefined, bindings: KeybindingsConfig = {}) {
  let data: PaneInventory = { mainPaths: ["/main", "/main"], subagents: rows };
  let store: ScopedSettingsSnapshot<typeof ALL_OFF> = { defaults: ALL_OFF, managed: {}, global: {}, project: {}, session: {}, projectTrusted: false, targets: { global: "global", project: "project", session: "session" } };
  const settings = new ScopedSettingsController<typeof ALL_OFF>({ fields: discoveryFields, order: fieldOrder, inactive: () => "", adapter: {
    read: () => store,
    apply(scope, changes) { store = { ...store, [scope]: applyScopedSettingsChanges(discoveryFields, fieldOrder, store[scope], changes) }; }, applied() {},
  } });
  const applied: ScopedSettingsAction[] = [];
  const pane = new ArcheologistPane({ inventory: () => data, settings, keys: new KeybindingsManager(TUI_KEYBINDINGS, bindings), theme: PLAIN_THEME,
    home: "/home/operator", render() {}, close(action) { if (action) applied.push(action); },
  });
  const input = (...bytes: string[]) => { for (const data of bytes) pane.handleInput(data); };
  const frame = (width = 100, height = 22) => renderLayoutFrame(pane, width, height, () => {}).lines.map(l => l.trimEnd());
  return { pane, frame, input, applied, saved: () => store, inventory(subagents: InventoryRow[] | undefined) { data = { ...data, subagents }; input("l"); } };
}

const DOWN = "\x1b[B", UP = "\x1b[A", END = "\x1b[F", ESC = "\x1b", ENTER = "\r", SAVE = "\x13";

test("the pane combines five scoped controls, current main and distinct session paths", () => {
  const f = fixture([docs, explorer]);
  const text = f.frame().join("\n");
  for (const label of ["Main: auto-discover nested AGENTS.md", "Subagents: auto-discover nested AGENTS.md", "Subagents: worktree AGENTS.md", "Subagents: project AGENTS.md", "Subagents: global AGENTS.md"]) assert.ok(text.includes(label), label);
  assert.match(text, /Main — current context files \(1\)\n\s+\/main/);
  assert.match(text, /Subagents: files received in this session \(4 unique\)/);
  assert.equal(text.match(/\/shared/g)?.length, 1);
  assert.doesNotMatch(text, /all time|children|child|global user/i);
});

test("a path opens its recipient; full IDs keep nested focus across refresh, and back keeps the draft and path selection", async () => {
  const f = fixture([explorer, docs], { "tui.select.confirm": "x", "tui.select.cancel": "z", "tui.select.up": "k" });
  f.input(" ", END, ENTER);
  assert.match(f.frame().join("\n"), /▌ +\/deeper/);
  f.input("x");
  let text = f.frame().join("\n");
  assert.match(text, /explorer.*finished\n\s+\/shared  \+1\n▌\s+└─ docs.*closed\n\s+\/shared\n\s+\/nested\n\s+\/deeper/);
  f.inventory([docs, { ...explorer, label: "renamed" }]);
  f.input(ESC);
  assert.match(f.frame().join("\n"), /▌\s+└─ docs/);
  f.input("k");
  text = f.frame().join("\n");
  assert.match(text, /▌ renamed.*\n\s+\/shared\n\s+\/outer\n\s+└─ docs.*\n\s+\/shared  \+2/);
  f.input("z");
  text = f.frame().join("\n");
  assert.match(text, /▌ +\/deeper/);
  assert.match(text, /Main: auto-discover nested AGENTS.md\s+on \*\s+on · session/);
  f.input(SAVE);
  await f.applied[0].run(new AbortController().signal);
  assert.deepEqual(f.saved().session, { mainNested: true });
});

test("unavailable preferences cannot be staged, inherited or saved; the main control still saves sparsely", async () => {
  const f = fixture(undefined);
  const text = f.frame().join("\n");
  assert.match(text, /Subagents: global AGENTS.md\s+—\s+ponygirls-subagents unavailable/);
  assert.doesNotMatch(text, /No subagent files/);
  for (let i = 0; i < 4; ++i) f.input(DOWN, " ", "r", ENTER, SAVE);
  assert.equal(f.applied.length, 0);
  f.input(END, ENTER);
  assert.doesNotMatch(f.frame().join("\n"), /Archeologist ›/);
  f.input("\x1b[H", " ", SAVE);
  await f.applied[0].run(new AbortController().signal);
  assert.deepEqual(f.saved().session, { mainNested: true });
});

test("losing the peer with a pending subagent edit does not save that scope", () => {
  const f = fixture([]);
  f.input(DOWN, " ");
  f.inventory(undefined);
  f.input(SAVE);
  assert.equal(f.applied.length, 0);
  assert.match(f.frame().join("\n"), /unavailable; changes not saved/);
});

test("complete empty, partial empty, and known paths with gaps have distinct messages in overview and tree", () => {
  const f = fixture([]);
  assert.match(f.frame().join("\n"), /No subagent files received yet/);
  f.inventory([{ ...explorer, paths: [], complete: false }]);
  let text = f.frame().join("\n");
  assert.match(text, /0 known files; history incomplete/);
  assert.doesNotMatch(text, /No subagent files received yet/);
  f.input(END, ENTER);
  assert.match(f.frame().join("\n"), /finished\n\s+0 known files; history incomplete/);
  f.inventory([{ ...explorer, complete: false }]);
  assert.match(f.frame().join("\n"), /2 known files; history incomplete\n\s+\/shared\n\s+\/outer/);
  f.input(ESC);
  assert.match(f.frame().join("\n"), /2 known files; history incomplete\)  \[⏎ ›\]\n\s+\/shared\n\s+\/outer/);
});

test("a focused agent's long paths wrap and page in full at narrow width; paging does not move focus", () => {
  const paths = Array.from({ length: 40 }, (_, n) => `/long/${"segment/".repeat(6)}rule-${n}.md`);
  const f = fixture([explorer, { ...docs, paths }], { "tui.select.pageDown": "v" });
  f.frame(); f.input(END, ENTER);
  const width = 37, seen: string[] = [];
  for (let i = 0; i < paths.length; ++i) {
    const lines = f.frame(width, 12);
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
    const chunks = lines.filter(l => l.startsWith("         ")).map(l => l.trim());
    let overlap = Math.min(seen.length, chunks.length);
    while (overlap && seen.slice(-overlap).join("\n") !== chunks.slice(0, overlap).join("\n")) overlap--;
    seen.push(...chunks.slice(overlap));
    f.input("v");
  }
  assert.equal(seen.join(""), paths.join(""));
  f.input(UP);
  assert.match(f.frame(88, 14).join("\n"), /▌ explorer.*\n\s+\/shared\n\s+\/outer/);
});

test("mouse hit testing opens an aggregate path on click, not press, after local scrolling", () => {
  const f = fixture([explorer, docs]);
  const width = 90, height = 9;
  f.frame(width, height); f.input(END); f.frame(width, height);
  const y = f.frame(width, height).findIndex(l => l.includes("/deeper"));
  assert.ok(y > 0);
  const mouse: TuiMouseEvent = { type: "press", button: "left", x: 5, y, screenX: 5, screenY: y + 9, width, height, shift: false, alt: false, ctrl: false };
  assert.equal(f.pane.handleMouse(mouse)?.render, false);
  assert.match(f.frame(width, height).join("\n"), /Subagents:|open tree/);
  assert.equal(f.pane.handleMouse({ ...mouse, type: "click" })?.render, true);
  assert.match(f.frame(width, height).join("\n"), /Archeologist › Subagents/);
});

test("terminal controls in labels and paths are inert; deduplication precedes home abbreviation", () => {
  const f = fixture([{ ...explorer, label: "x\x1b[2J", paths: ["/home/operator/file", "~/file", "/x\n\u202e☃"] }]);
  let text = f.frame().join("\n");
  assert.match(text, /3 unique/); assert.equal(text.match(/~\/file/g)?.length, 2);
  assert.doesNotMatch(text, /\x1b|\u202e/); assert.match(text, /\\u000a\\u202e☃/);
  f.input(END, ENTER);
  assert.match(f.frame().join("\n"), /x\\u001b\[2J/);
});

test("returning from a folded tree reveals the original path in a taller overview", () => {
  const agents = Array.from({ length: 13 }, (_, i) => ({ ...explorer, agentId: `agent-${i}`, paths: Array.from({ length: 15 }, (_, n) => `/${i}-item-${n}`) }));
  const f = fixture(agents);
  const screen = () => { f.frame(90, 10); return f.frame(90, 10).join("\n"); };
  screen(); f.input(END);
  assert.match(screen(), /▌ +\/12-item-14/);
  f.input(ENTER); assert.match(screen(), /▌ explorer +agent-12/);
  f.input(UP); assert.match(screen(), /▌ explorer +agent-11/);
  f.input(ESC); assert.match(screen(), /▌ +\/12-item-14/);
});

test("the selected scope saves independently; inherit removes only its override", async () => {
  const f = fixture([]);
  const save = async () => { f.input(SAVE); const action = f.applied.shift(); assert.ok(action); await action.run(new AbortController().signal); };
  f.input(" ", "\x1b[C", DOWN, " ", SAVE);
  assert.match(f.frame().join("\n"), /Project settings require a trusted project/);
  assert.equal(f.applied.length, 0);
  f.input("\x1b[C", " "); await save();
  assert.deepEqual(f.saved().global, { nested: true });
  assert.deepEqual(f.saved().project, {});
  assert.deepEqual(f.saved().session, {});
  f.input("\x1b[C", " "); await save();
  assert.deepEqual(f.saved().session, { mainNested: true, nested: false });
  f.input("r"); await save();
  assert.deepEqual(f.saved().session, { mainNested: true });
  assert.match(f.frame().join("\n"), /Subagents: auto-discover nested AGENTS.md\s+inherit\s+on · global/);
});
