import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type KeybindingsManager, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ScopedSettingsAction, ScopedSettingsPort, ScopedSettingsRow, ScopedSettingsState } from "@ponygirls/pi-settings";
import { KEY, MARKER_WIDTH, PanelLayout, ctrlKey, fit, frameTitle, hintAt, keyHints, listRow, shortId, type KeyHint, type PanelParts, type Span, type UiTheme } from "@ponygirls/pi-ui";
import type { PaneInventory } from "../view-contract.ts";
import { displayPath, displayText, incomplete, presentInventory } from "./pane-inventory.ts";

const SUBAGENTS = "subagents";
const UNAVAILABLE = "ponygirls-subagents unavailable";
const EMPTY = "No subagent files received yet";
const pathKey = (path: string) => `path:${path}`;

interface PaneOptions {
  settings: ScopedSettingsPort;
  inventory(): PaneInventory;
  theme: UiTheme;
  keys: Pick<KeybindingsManager, "matches" | "getKeys">;
  home: string;
  render(): void;
  close(action?: ScopedSettingsAction): void;
}

class Rows {
  readonly lines: string[] = [];
  readonly keys: (string | null)[] = [];
  readonly width: number;
  private readonly theme: UiTheme;
  private readonly selected: string | null;

  constructor(width: number, theme: UiTheme, selected: string | null) {
    this.width = width;
    this.theme = theme;
    this.selected = selected;
  }

  room(indent: number): number { return Math.max(1, this.width - MARKER_WIDTH - indent); }

  add(text: string, key: string | null = null, indent = 0, mark = true): void {
    const pad = " ".repeat(indent);
    for (const line of wrapTextWithAnsi(text, this.room(indent))) {
      const selected = mark && key !== null && key === this.selected;
      this.lines.push(truncateToWidth(listRow(this.theme, this.width, pad + line, selected), this.width, ""));
      this.keys.push(key);
    }
  }
}

interface Hint extends KeyHint { run(): void }
interface Frame {
  width: number;
  tabs: Span[];
  body: (string | null)[];
  hints: Span[][];
  actions: Hint[];
}

export class ArcheologistPane extends PanelLayout {
  readonly capturesViewportInput = true;
  private readonly options: PaneOptions;
  private inventory: ReturnType<typeof presentInventory>;
  private overviewKey: string;
  private inTree = false;
  private agentId: string | null = null;
  private hitGeometry: Frame | null = null;
  private reveal = true;
  private lastHeight = -1;
  private live = true;

  constructor(options: PaneOptions) {
    super(width => this.sections(width));
    this.options = options;
    this.inventory = presentInventory(options.inventory());
    const state = options.settings.state();
    this.overviewKey = state.rows[state.selectedIndex].id;
  }

  private available(row: ScopedSettingsRow): boolean {
    return !row.inactive && (row.id === "mainNested" || this.inventory.available);
  }

  private targets(state: ScopedSettingsState): string[] {
    return this.inTree ? this.inventory.tree.map(({ agent }) => agent.agentId)
      : [...state.rows.map(r => r.id), SUBAGENTS, ...this.inventory.paths.map(pathKey)];
  }

  private select(key: string) {
    if (this.inTree) this.agentId = key;
    else {
      this.overviewKey = key;
      const settings = this.options.settings;
      const index = settings.state().rows.findIndex(r => r.id === key);
      if (index >= 0) settings.select(index);
    }
    this.reveal = true;
  }

  private get selected() { return this.inTree ? this.agentId : this.overviewKey; }

  private move(delta: number) {
    const targets = this.targets(this.options.settings.state());
    if (targets.length) this.select(targets[Math.max(0, Math.min(targets.length - 1, targets.indexOf(this.selected ?? "") + delta))]);
  }

  private refresh() {
    this.inventory = presentInventory(this.options.inventory());
    this.options.settings.reload();
    if (!this.inventory.available) this.inTree = false;
    if (this.overviewKey.startsWith("path:") && !this.inventory.paths.includes(this.overviewKey.slice(5))) this.overviewKey = SUBAGENTS;
    if (!this.inventory.tree.some(({ agent }) => agent.agentId === this.agentId)) this.agentId = this.inventory.tree[0]?.agent.agentId ?? null;
    this.reveal = true;
  }

  private activate(inherit: boolean) {
    if (this.inTree) return;
    const { settings } = this.options;
    const row = settings.state().rows.find(r => r.id === this.overviewKey);
    if (row) {
      if (!this.available(row)) settings.setNotice(UNAVAILABLE);
      else if (inherit) settings.inheritSelected();
      else settings.toggleSelected();
    } else if (!inherit && this.inventory.available) {
      const recipient = this.overviewKey.startsWith("path:") ? this.inventory.tree.find(({ agent }) => agent.paths.includes(this.overviewKey.slice(5))) : undefined;
      this.agentId = recipient?.agent.agentId ?? this.agentId ?? this.inventory.tree[0]?.agent.agentId ?? null;
      this.inTree = true;
      this.bodyScroll.scrollToStart();
    }
    this.reveal = true;
  }

  private save() {
    const { settings, close } = this.options;
    if (settings.state().rows.some(row => row.staged && !this.available(row))) settings.setNotice(`${UNAVAILABLE}; changes not saved.`);
    else {
      const action = settings.beginApply();
      if (action) close(action);
    }
  }

  private back() {
    if (!this.inTree) this.options.close();
    else { this.inTree = false; this.reveal = true; }
  }

  private page(direction: number) {
    this.bodyScroll.scrollBy(direction * Math.max(1, this.bodyScroll.viewportHeight - 1));
    this.reveal = false;
  }

  private overview(body: Rows, state: ScopedSettingsState) {
    const { theme, home } = this.options;
    const { main, paths, available, complete } = this.inventory;
    const labelWidth = Math.max(...state.rows.map(row => visibleWidth(row.label)));
    const localWidth = Math.max(...state.rows.map(r => visibleWidth(r.localText) + 2), "Local".length);
    const columns = (label: string, local: string, value: string) => `${fit(label, labelWidth)}  ${fit(local, localWidth)}  ${value}`;
    const wide = labelWidth + localWidth + 4 + "Effective · source".length <= body.room(0);
    body.add(theme.fg("dim", wide ? columns("Discovery", "Local", "Effective · source") : "Discovery"));
    for (const row of state.rows) {
      const local = `${row.localText}${row.staged ? " *" : ""}`;
      const effective = `${row.effectiveText} · ${row.origin}`;
      if (!this.available(row)) body.add(theme.fg("muted", wide ? columns(row.label, "—", UNAVAILABLE) : `${row.label} — ${UNAVAILABLE}`), row.id);
      else if (wide) body.add(columns(row.label, local, effective), row.id);
      else {
        body.add(row.label, row.id);
        body.add(theme.fg("muted", `Local: ${local}  Effective: ${effective}`), row.id, 2);
      }
    }
    body.add("");
    body.add(theme.bold(`Main — current context files (${main.length})`));
    if (!main.length) body.add(theme.fg("muted", "No main context files loaded"), null, 2);
    for (const path of main) body.add(displayPath(path, home), null, 2);
    body.add("");
    const count = !available ? "" : ` (${complete ? `${paths.length} unique` : incomplete(paths.length)})`;
    const enter = this.options.keys.getKeys("tui.select.confirm")[0];
    const open = available && enter ? `  [${enter === "enter" ? KEY.enter : enter} ›]` : "";
    body.add(theme.bold(`Subagents: files received in this session${count}`) + theme.fg("muted", open), SUBAGENTS);
    if (!available || (!paths.length && complete)) body.add(theme.fg("muted", available ? EMPTY : UNAVAILABLE), SUBAGENTS, 2, false);
    for (const path of paths) body.add(displayPath(path, home), pathKey(path), 2);
  }

  private tree(body: Rows) {
    const { theme, home } = this.options;
    if (!this.inventory.tree.length) body.add(EMPTY);
    for (const { agent, depth } of this.inventory.tree) {
      const indent = Math.min(2 * depth, Math.floor(body.width / 4));
      const level = depth ? "└─ " : "";
      const key = agent.agentId;
      body.add(`${level}${displayText(agent.label)}  ${shortId(displayText(key))}  ${displayText(agent.state)}`, key, indent);
      const under = indent + level.length + 2;
      if (!agent.complete) body.add(theme.fg("warning", incomplete(agent.paths.length)), key, under, false);
      else if (!agent.paths.length) body.add(theme.fg("muted", "No files received yet"), key, under, false);
      if (key === this.agentId) {
        for (const path of agent.paths) body.add(displayPath(path, home), key, under, false);
      } else if (agent.paths.length) {
        const more = agent.paths.length > 1 ? `  +${agent.paths.length - 1}` : "";
        const preview = truncateToWidth(displayPath(agent.paths[0], home), Math.max(1, body.room(under) - more.length), "…");
        body.add(theme.fg("muted", preview + more), key, under, false);
      }
    }
  }

  private hints(state: ScopedSettingsState): Hint[] {
    const binding = (name: Parameters<PaneOptions["keys"]["getKeys"]>[0]) => this.options.keys.getKeys(name)[0] ?? "";
    const pair = (a: string, b: string, normal: string, symbol: string) => {
      const joined = [a, b].filter(Boolean).join("/");
      return joined === normal ? symbol : joined;
    };
    const select = pair(binding("tui.select.up"), binding("tui.select.down"), "up/down", KEY.upDown);
    const page = pair(binding("tui.select.pageUp"), binding("tui.select.pageDown"), "pageUp/pageDown", KEY.page);
    const confirm = binding("tui.select.confirm"), cancel = binding("tui.select.cancel");
    const scope = state.scopes.find(s => s.scope === state.scope)!;
    const row = state.rows.find(r => r.id === this.overviewKey);
    const hints: Hint[] = [{ key: select, action: this.inTree ? "focus subagent" : "select", run: () => this.move(1) }];
    if (!this.inTree) {
      if (scope.editable && row && this.available(row)) hints.push({ key: KEY.space, action: "toggle", run: () => this.activate(false) });
      if (!row && this.inventory.available) hints.push({ key: confirm === "enter" ? KEY.enter : confirm, action: "open tree", run: () => this.activate(false) });
      hints.push({ key: KEY.leftRight, action: "scope", run: () => this.options.settings.cycleScope(1) });
      if (scope.editable && row?.localSet && this.available(row)) hints.push({ key: "r", action: "inherit", run: () => this.activate(true) });
      if (scope.editable && scope.dirty) hints.push({ key: ctrlKey("s"), action: "save", run: () => this.save() });
    }
    hints.push({ key: page, action: "scroll", run: () => this.page(1) }, { key: "l", action: "refresh", run: () => this.refresh() },
      { key: cancel === "escape" ? KEY.esc : cancel, action: this.inTree ? "back" : "close", run: () => this.back() });
    return hints.filter(h => h.key !== "");
  }

  private sections(width: number): PanelParts {
    const { settings, theme } = this.options;
    const state = settings.state();
    const tabs = { labels: state.scopes.map(({ scope, dirty }) => scope[0].toUpperCase() + scope.slice(1) + (dirty ? "*" : "")), active: state.scopes.findIndex(s => s.scope === state.scope) };
    const title = frameTitle(theme, width, this.inTree ? { title: "Archeologist › Subagents", right: width >= 48 ? "This session" : undefined }
      : { title: "Archeologist", meta: "Scope:", tabs }, "none");
    const body = new Rows(width, theme, this.selected);
    if (this.inTree) this.tree(body); else this.overview(body, state);
    const actions = this.hints(state), hints = keyHints(theme, width, actions);
    const notice = this.inTree ? "" : (state.scopes.find(s => s.scope === state.scope)!.reason || state.notice);
    const message = displayText(notice);
    if (visibleWidth(message) > width) body.add(theme.fg("muted", message));
    const footer = [...(notice ? [truncateToWidth(theme.fg("muted", message), width, "…")] : []), ...hints.lines];
    if (!this.isMeasuring) {
      const height = this.bodyScroll.viewportHeight;
      if (height && (this.reveal || this.hitGeometry?.width !== width || this.lastHeight !== height)) {
        const index = body.keys.indexOf(this.selected), top = this.bodyScroll.scrollTop;
        if (index >= 0 && (index < top || index >= top + height)) this.bodyScroll.scrollTo(index);
        const next = this.bodyScroll.scrollTop;
        this.reveal = index >= 0 && (index < next || index >= next + height);
        if (this.reveal) this.options.render();
      }
      this.lastHeight = height;
      this.hitGeometry = { width, body: body.keys, tabs: title.tabSpans, hints: hints.spans, actions };
    }
    return { header: [title.line], body: body.lines, footer };
  }

  handleInput(data: string): void {
    const { settings, keys } = this.options;
    if (!this.live || !settings.active || settings.busy) return;
    if (keys.matches(data, "tui.select.cancel")) this.back();
    else if (keys.matches(data, "tui.select.up")) this.move(-1);
    else if (keys.matches(data, "tui.select.down")) this.move(1);
    else if (keys.matches(data, "tui.select.pageUp")) this.page(-1);
    else if (keys.matches(data, "tui.select.pageDown")) this.page(1);
    else if (data === "l") this.refresh();
    else if (matchesKey(data, Key.home)) this.move(-Infinity);
    else if (matchesKey(data, Key.end)) this.move(Infinity);
    else if (this.inTree) return;
    else if (keys.matches(data, "tui.select.confirm")) this.activate(false);
    else if (data === " " && this.options.settings.state().rows.some(r => r.id === this.overviewKey)) this.activate(false);
    else if (data === "r") this.activate(true);
    else if (matchesKey(data, Key.ctrl("s"))) this.save();
    else if (keys.matches(data, "tui.input.tab") || matchesKey(data, Key.right)) settings.cycleScope(1);
    else if (matchesKey(data, Key.left)) settings.cycleScope(-1);
    else return;
    this.redraw();
  }

  private redraw() { if (this.live) { this.invalidate(); this.options.render(); } }

  override handleMouse(event: TuiMouseEvent): ReturnType<PanelLayout["handleMouse"]> {
    if (!this.live || !this.options.settings.active || this.options.settings.busy) return undefined;
    if (event.type === "wheel") { this.reveal = false; return super.handleMouse(event); }
    const frame = this.hitGeometry;
    if (!frame || event.width !== frame.width || event.button !== "left" || (event.type !== "press" && event.type !== "click")) return undefined;
    let run: (() => void) | undefined;
    if (event.y === 0) {
      const tab = hintAt(frame.tabs, event.x);
      if (tab !== undefined) run = () => this.options.settings.selectScope(this.options.settings.state().scopes[tab].scope);
    } else if (event.y >= event.height - frame.hints.length) {
      const hint = hintAt(frame.hints[event.y - event.height + frame.hints.length], event.x);
      if (hint !== undefined) run = frame.actions[hint].run;
    } else if (event.y <= this.bodyScroll.viewportHeight) {
      const key = frame.body[event.y - 1 + this.bodyScroll.scrollTop];
      if (key !== null && key !== undefined) run = () => { this.select(key); if (!this.inTree) this.activate(false); };
    }
    if (!run) return undefined;
    if (event.type === "click") { run(); this.redraw(); }
    return { handled: true, render: event.type === "click", focus: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
  }

  dispose() { this.live = false; this.hitGeometry = null; }
}
