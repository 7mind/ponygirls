/**
 * /tools: every tool the session has registered, as a list (three tabs, a
 * filter, three sort keys) and one tool in detail (see detail.ts). While it is
 * open it reads the registry again once a second, so tools that register late
 * or that the model loads show up. Tool-supplied text is untrusted and is
 * drawn only through `displayLine` and `displayText`.
 */
import { Input, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Focusable, type TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  HINT, KEY, MARKER_WIDTH, PanelLayout, columnCells, columnHeader, frameRule, frameTitle, keyHints, listRow, stateColor,
  type InlinePane, type KeyHint, type PanelParts, type UiFg, type UiTheme,
} from "@ponygirls/pi-ui";
import { ToolActivation, type ActivationResult } from "./activation.ts";
import { buildCatalog, canLoad, canUnload, findEntry, isCharged, type ToolCatalog, type ToolEntry } from "./catalog.ts";
import { COLUMN_GAP, MIN_DESCRIPTION_COLUMN, clip, listCells, listLayout, type ColumnId, type ListCells, type ListLayout } from "./columns.ts";
import { JSON_VIEW_KEY, declarationJson, jsonLines, outlineLines } from "./detail.ts";
import { displayLine } from "./display.ts";
import { originLabel } from "./origin.ts";
import { activationNotice, budgetText, sourceFacts, stateLabel, stateTone, tabCount, tabLabel, type Notice } from "./present.ts";
import { SORT_KEYS, TABS, listItems, nextOf, selectTools, summarize, type CatalogSummary, type ListItem, type Query, type SourceSummary } from "./query.ts";
import type { ToolRegistry } from "./registry.ts";

/** How often an open pane reads the registry again. */
export const REFRESH_MS = 1000;
/**
 * Rows a pane that has to take its height from the terminal leaves to everything but its body: its title,
 * position line, rule, hints and notice, and pi's footer.
 */
const CHROME_ROWS = 9;
/** The line under a scrolled detail that says which lines are shown. */
const POSITION_ROWS = 1;
const FILTER_KEY = "/";
const FILTER_PROMPT = `${FILTER_KEY} `;
/** The cell the input draws its cursor in behind the text. */
const CURSOR_CELL = 1;
const SORT_KEY = "s";
const LOAD_KEY = "l";
const UNLOAD_KEY = "u";
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export interface ToolsPaneDeps {
  registry: ToolRegistry;
  theme: UiTheme;
  keys: { matches(data: string, action: "tui.select.cancel"): boolean };
  /** Terminal rows: the size the pane plans for until pi allocates it one. */
  rows(): number;
  requestRender(): void;
  close(): void;
  /** Colours pretty-printed JSON for the terminal, one string per line. */
  highlightJson(json: string): string[];
  /** Paths under it are shown as `~/…`. */
  home: string;
  refreshEveryMs: number;
  /** The filter the pane opens with. */
  filter: string;
}

interface Detail {
  mode: "outline" | "json";
  scroll: number;
}

interface JsonCache {
  json: string;
  width: number;
  lines: string[];
}

export class ToolsPane extends PanelLayout implements InlinePane, Focusable {
  readonly capturesViewportInput = true;

  private readonly deps: ToolsPaneDeps;
  private readonly activation: ToolActivation;
  private catalog: ToolCatalog;
  private summary: CatalogSummary;
  private query: Query;
  private shown: ToolEntry[] = [];
  private items: ListItem[] = [];
  private selected: string | null = null;
  /** Where the selected tool is, or was, in `shown`. */
  private position = 0;
  private detail: Detail | null = null;
  private filterInput: Input | null = null;
  private notice: Notice | null = null;
  private hasFocus = false;
  private timer: ReturnType<typeof setInterval> | null;
  private jsonCache: JsonCache | null = null;

  constructor(deps: ToolsPaneDeps) {
    super((width) => this.renderParts(width));
    this.deps = deps;
    this.activation = new ToolActivation(deps.registry);
    this.query = { tab: "all", sort: "source", filter: deps.filter };
    this.catalog = buildCatalog(deps.registry.snapshot());
    this.summary = summarize(this.catalog);
    this.reselect();
    this.timer = setInterval(() => this.tick(), deps.refreshEveryMs);
  }

  get focused(): boolean { return this.hasFocus; }
  set focused(value: boolean) {
    this.hasFocus = value;
    if (this.filterInput !== null) this.filterInput.focused = value;
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  override invalidate(): void {
    super.invalidate();
    this.jsonCache = null;
    if (this.filterInput !== null) this.filterInput.invalidate();
  }

  // ---- state ---------------------------------------------------------------------

  private refresh(): void {
    this.catalog = buildCatalog(this.deps.registry.snapshot());
    this.summary = summarize(this.catalog);
    this.reselect();
  }

  private tick(): void {
    try {
      this.refresh();
    } catch (error) {
      // A session that was replaced can no longer be read; what was read last stays on screen.
      this.dispose();
      this.notice = { text: `The tools can no longer be read: ${displayLine(error instanceof Error ? error.message : String(error))}`, state: "error" };
    }
    this.deps.requestRender();
  }

  /** Apply the query to the catalog again and keep the selection on its tool, or else in its place. */
  private reselect(): void {
    this.shown = selectTools(this.catalog, this.query);
    this.items = listItems(this.shown, this.summary, this.query.sort);
    const index = this.shown.findIndex((entry) => entry.name === this.selected);
    if (index !== -1) {
      this.position = index;
      return;
    }
    if (this.detail !== null && this.selected !== null) {
      // An open tool stays open while it is registered, also after it left this tab.
      if (findEntry(this.catalog, this.selected) !== null) return;
      this.notice = { text: `${displayLine(this.selected)} is no longer registered.`, state: "attention" };
      this.detail = null;
    }
    this.position = Math.min(this.position, Math.max(0, this.shown.length - 1));
    const entry = this.shown[this.position];
    this.selected = entry === undefined ? null : entry.name;
  }

  private current(): ToolEntry | null {
    return this.selected === null ? null : findEntry(this.catalog, this.selected);
  }

  /** Another tab, order or filter is another list: it starts at its first tool. */
  private setQuery(change: Partial<Query>): void {
    this.query = { ...this.query, ...change };
    this.selected = null;
    this.position = 0;
    this.reselect();
  }

  private select(index: number): void {
    if (this.shown.length === 0) return;
    this.position = Math.max(0, Math.min(this.shown.length - 1, index));
    this.selected = this.shown[this.position]!.name;
  }

  /** Only the top is a limit here: where the text ends depends on the width, so drawing sets the lower one. */
  private scrollDetail(detail: Detail, delta: number): void {
    detail.scroll = Math.max(0, detail.scroll + delta);
  }

  private startFilter(): void {
    const input = new Input({ prompt: this.deps.theme.fg("accent", FILTER_PROMPT) });
    // A paste leaves the cursor behind the text; setValue would leave it in front.
    if (this.query.filter !== "") input.handleInput(`${PASTE_START}${this.query.filter}${PASTE_END}`);
    input.focused = this.hasFocus;
    input.onSubmit = () => { this.filterInput = null; };
    input.onEscape = () => {
      this.filterInput = null;
      this.setQuery({ filter: "" });
    };
    this.filterInput = input;
  }

  private switchTool(change: "load" | "unload"): void {
    const entry = this.current();
    if (entry === null) return;
    let result: ActivationResult;
    try {
      result = change === "load" ? this.activation.load(entry.name) : this.activation.unload(entry.name);
      this.refresh();
    } catch (error) {
      this.notice = { text: `The active tools could not be changed: ${displayLine(error instanceof Error ? error.message : String(error))}`, state: "error" };
      return;
    }
    this.notice = activationNotice(result);
  }

  // ---- input ---------------------------------------------------------------------

  handleInput(data: string): void {
    this.notice = null;
    if (this.filterInput !== null) this.filterKey(data, this.filterInput);
    else if (this.detail !== null) this.detailKey(data, this.detail);
    else this.listKey(data);
    this.deps.requestRender();
  }

  private filterKey(data: string, input: Input): void {
    if (matchesKey(data, Key.up)) this.select(this.position - 1);
    else if (matchesKey(data, Key.down)) this.select(this.position + 1);
    else {
      input.handleInput(data);
      // Enter and escape end the edit through the input's callbacks; anything else may have changed the text.
      if (this.filterInput === input && input.getValue() !== this.query.filter) this.setQuery({ filter: input.getValue() });
    }
  }

  private closes(data: string): boolean {
    return this.deps.keys.matches(data, "tui.select.cancel") || data === "q";
  }

  private listKey(data: string): void {
    const page = Math.max(1, this.listRows() - 1);
    if (this.closes(data)) {
      if (this.query.filter !== "") this.setQuery({ filter: "" });
      else this.deps.close();
    } else if (matchesKey(data, Key.tab)) this.setQuery({ tab: nextOf(TABS, this.query.tab) });
    else if (data === SORT_KEY) this.setQuery({ sort: nextOf(SORT_KEYS, this.query.sort) });
    else if (data === FILTER_KEY) this.startFilter();
    else if (matchesKey(data, Key.enter)) {
      if (this.current() !== null) this.detail = { mode: "outline", scroll: 0 };
    } else if (matchesKey(data, Key.up) || data === "k") this.select(this.position - 1);
    else if (matchesKey(data, Key.down) || data === "j") this.select(this.position + 1);
    else if (matchesKey(data, Key.pageUp)) this.select(this.position - page);
    else if (matchesKey(data, Key.pageDown)) this.select(this.position + page);
    else if (matchesKey(data, Key.home)) this.select(0);
    else if (matchesKey(data, Key.end)) this.select(this.shown.length - 1);
    else if (data === LOAD_KEY) this.switchTool("load");
    else if (data === UNLOAD_KEY) this.switchTool("unload");
  }

  private detailKey(data: string, detail: Detail): void {
    const page = Math.max(1, this.bodyRows() - 1);
    if (this.closes(data)) {
      this.detail = null;
      this.reselect();
    } else if (matchesKey(data, Key.up) || data === "k") this.scrollDetail(detail, -1);
    else if (matchesKey(data, Key.down) || data === "j") this.scrollDetail(detail, 1);
    else if (matchesKey(data, Key.pageUp)) this.scrollDetail(detail, -page);
    else if (matchesKey(data, Key.pageDown)) this.scrollDetail(detail, page);
    else if (matchesKey(data, Key.home)) detail.scroll = 0;
    else if (matchesKey(data, Key.end)) detail.scroll = Number.MAX_SAFE_INTEGER;
    else if (matchesKey(data, Key.left)) this.step(detail, -1);
    else if (matchesKey(data, Key.right)) this.step(detail, 1);
    else if (data === JSON_VIEW_KEY) {
      detail.mode = detail.mode === "json" ? "outline" : "json";
      detail.scroll = 0;
    } else if (data === LOAD_KEY) this.switchTool("load");
    else if (data === UNLOAD_KEY) this.switchTool("unload");
  }

  /** The previous or next tool of the list, without leaving the detail view. */
  private step(detail: Detail, direction: -1 | 1): void {
    const before = this.selected;
    // A tool that left the list has no place in it; its former place is now the next tool's.
    const inList = this.shown.some((entry) => entry.name === this.selected);
    this.select(inList || direction < 0 ? this.position + direction : this.position);
    if (this.selected !== before) detail.scroll = 0;
  }

  override handleMouse(event: TuiMouseEvent): ReturnType<PanelLayout["handleMouse"]> {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    if (this.detail !== null) this.scrollDetail(this.detail, event.wheelDelta);
    else this.select(this.position + event.wheelDelta);
    return { handled: true, render: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
  }

  // ---- rendering -----------------------------------------------------------------

  private renderParts(width: number): PanelParts {
    const w = Math.max(1, Math.floor(width));
    const entry = this.detail === null ? null : this.current();
    return this.detail !== null && entry !== null ? this.renderDetail(w, this.detail, entry) : this.renderList(w);
  }

  private gutter(): string {
    return " ".repeat(MARKER_WIDTH);
  }

  /** Lines between the title and the footer: what pi's layout gave the pane, or what the terminal leaves it. */
  private bodyRows(): number {
    return Math.max(1, this.bodyHeight(this.deps.rows() - CHROME_ROWS));
  }

  /** Lines of the body left for the list under the column header and the filter. */
  private listRows(): number {
    const filterLine = this.filterInput !== null || this.query.filter !== "" ? 1 : 0;
    return Math.max(1, this.bodyRows() - filterLine - 1);
  }

  /** A dim line under the row gutter, wrapped between words. */
  private note(text: string, width: number): string[] {
    // The gutter alone can take a pane a few columns wide.
    return wrapTextWithAnsi(text, Math.max(1, width - MARKER_WIDTH)).map((line) => truncateToWidth(this.deps.theme.fg("dim", `${this.gutter()}${line}`), width, ""));
  }

  private footer(width: number, notes: readonly string[], hints: readonly KeyHint[]): string[] {
    const th = this.deps.theme;
    const notice = this.notice === null ? [] : wrapTextWithAnsi(th.fg(stateColor(this.notice.state), this.notice.text), width);
    return [...notes, frameRule(th, width), ...notice, ...keyHints(th, width, hints).lines];
  }

  private switchHints(entry: ToolEntry | null): KeyHint[] {
    if (entry === null) return [];
    return [...(canLoad(entry) ? [{ key: LOAD_KEY, action: "load" }] : []), ...(canUnload(entry) ? [{ key: UNLOAD_KEY, action: "unload" }] : [])];
  }

  // ---- list ----------------------------------------------------------------------

  private titleLine(width: number): string {
    const th = this.deps.theme;
    const budget = budgetText(this.summary, this.catalog.model);
    const tabs = { labels: TABS.map((tab) => tabLabel(this.summary, tab)), active: TABS.indexOf(this.query.tab) };
    const tokens = th.fg("text", budget.tokens);
    const titled = (right: string) => frameTitle(th, width, { title: "Tools", tabs, right }, "none");
    if (budget.share !== null) {
      // The share of the window is the first thing a narrow title gives up: every tab stays on the line.
      const whole = titled(`${tokens}${th.fg("dim", ` · ${budget.share}`)}`);
      if (whole.tabSpans.length === TABS.length) return whole.line;
    }
    return titled(tokens).line;
  }

  /** The filter and how many tools of the tab it leaves; `null` without a filter. */
  private filterLine(width: number): string | null {
    const th = this.deps.theme;
    const count = th.fg("dim", `${this.shown.length} of ${tabCount(this.summary, this.query.tab)}`);
    const gap = " ".repeat(COLUMN_GAP);
    if (this.filterInput !== null) {
      // The input is as wide as its text, so the count stays beside it; a longer text scrolls inside the room.
      const room = width - MARKER_WIDTH - visibleWidth(count) - COLUMN_GAP;
      const counted = room >= MIN_DESCRIPTION_COLUMN;
      const wanted = FILTER_PROMPT.length + visibleWidth(this.filterInput.getValue()) + CURSOR_CELL;
      const input = this.filterInput.render(Math.max(1, Math.min(wanted, counted ? room : width - MARKER_WIDTH)))[0]!;
      return truncateToWidth(`${this.gutter()}${input}${counted ? `${gap}${count}` : ""}`, width, "");
    }
    if (this.query.filter === "") return null;
    return truncateToWidth(`${this.gutter()}${th.fg("accent", FILTER_PROMPT)}${th.fg("text", displayLine(this.query.filter))}${gap}${count}`, width, "…");
  }

  private emptyText(): string {
    if (this.catalog.entries.length === 0) return "No tools are registered in this session.";
    if (this.query.filter !== "") return `No ${this.query.tab === "all" ? "" : `${this.query.tab} `}tool matches the filter. ${KEY.esc} clears it.`;
    return `No ${this.query.tab} tools. ${KEY.tab} shows ${nextOf(TABS, this.query.tab)}.`;
  }

  private listHints(): KeyHint[] {
    const entry = this.current();
    const select = this.shown.length > 1 ? [HINT.select] : [];
    if (this.filterInput !== null) return [...select, { key: KEY.enter, action: "keep filter" }, { key: KEY.esc, action: "clear filter" }];
    const filtered = this.query.filter !== "";
    return [
      ...select,
      ...(entry === null ? [] : [{ key: KEY.enter, action: "details" }]),
      { key: KEY.tab, action: nextOf(TABS, this.query.tab) },
      { key: SORT_KEY, action: `sort by ${nextOf(SORT_KEYS, this.query.sort)}` },
      { key: FILTER_KEY, action: filtered ? "edit filter" : "filter" },
      ...this.switchHints(entry),
      filtered ? { key: KEY.esc, action: "clear filter" } : HINT.close,
    ];
  }

  private toolLine(entry: ToolEntry, cells: ListCells, layout: ListLayout, width: number, selected: boolean): string {
    const th = this.deps.theme;
    const colors: Readonly<Record<ColumnId, UiFg>> = {
      tool: "text",
      state: stateColor(stateTone(entry)),
      tokens: isCharged(entry) ? "text" : "muted",
      source: "muted",
      description: "muted",
    };
    const styled = layout.shown.map((id, index) => {
      const text = id === "description" ? displayLine(entry.definition.description) : cells[id];
      return th.fg(colors[id], clip(text, layout.columns[index]!.width));
    });
    return listRow(th, width, columnCells(layout.columns, styled, COLUMN_GAP), selected);
  }

  private headingLine(source: SourceSummary, width: number): string {
    const th = this.deps.theme;
    const label = th.bold(th.fg("text", displayLine(originLabel(source.origin))));
    return truncateToWidth(`${this.gutter()}${label}${" ".repeat(COLUMN_GAP)}${th.fg("dim", sourceFacts(source))}`, width, "…");
  }

  private renderList(width: number): PanelParts {
    const th = this.deps.theme;
    const header = [this.titleLine(width)];
    const body: string[] = [];
    const filterLine = this.filterLine(width);
    if (filterLine !== null) body.push(filterLine);
    if (this.shown.length === 0) {
      return { header, body: [...body, ...this.note(this.emptyText(), width)], footer: this.footer(width, [], this.listHints()) };
    }
    const cells = new Map(this.shown.map((entry) => [entry.name, listCells(entry)]));
    const layout = listLayout(width, [...cells.values()], this.query.sort !== "source");
    body.push(truncateToWidth(columnHeader(th, layout.columns, COLUMN_GAP), width, "…"));
    const visible = this.listRows();
    const index = this.items.findIndex((item) => item.kind === "tool" && item.entry.name === this.selected);
    const top = Math.max(0, Math.min(index - Math.floor(visible / 2), this.items.length - visible));
    for (const item of this.items.slice(top, top + visible)) {
      body.push(item.kind === "source" ? this.headingLine(item.summary, width)
        : this.toolLine(item.entry, cells.get(item.entry.name)!, layout, width, item.entry.name === this.selected));
    }
    const hidden = layout.hidden.length === 0 ? [] : this.note(`hidden at this width: ${layout.hidden.join(", ")}`, width);
    return { header, body, footer: this.footer(width, hidden, this.listHints()) };
  }

  // ---- detail --------------------------------------------------------------------

  private detailLines(detail: Detail, entry: ToolEntry, width: number): string[] {
    if (detail.mode === "outline") return outlineLines(entry, this.catalog, { theme: this.deps.theme, width, home: this.deps.home });
    const json = declarationJson(entry);
    if (this.jsonCache === null || this.jsonCache.json !== json || this.jsonCache.width !== width) {
      this.jsonCache = { json, width, lines: jsonLines(this.deps.highlightJson(json), width) };
    }
    return this.jsonCache.lines;
  }

  private detailHints(detail: Detail, entry: ToolEntry): KeyHint[] {
    return [
      HINT.scroll,
      HINT.page,
      ...(this.shown.length > 1 ? [{ key: KEY.leftRight, action: "previous/next tool" }] : []),
      { key: JSON_VIEW_KEY, action: detail.mode === "json" ? "parameters" : "JSON" },
      ...this.switchHints(entry),
      HINT.back,
    ];
  }

  private renderDetail(width: number, detail: Detail, entry: ToolEntry): PanelParts {
    const th = this.deps.theme;
    const state = th.fg(stateColor(stateTone(entry)), stateLabel(entry.state));
    const header = [frameTitle(th, width, { title: displayLine(entry.name), right: state }, "none").line];
    const lines = this.detailLines(detail, entry, width);
    const footer = this.footer(width, [], this.detailHints(detail, entry));
    // Whether the position line is needed is decided from the pane's whole height: decided from the height
    // the text has now, the line would stay after the text fits without it. Its row is the text's otherwise.
    const fixed = header.length + footer.length;
    const room = Math.max(1, this.height(this.deps.rows() - CHROME_ROWS + fixed + POSITION_ROWS) - fixed);
    const positioned = lines.length > room;
    const rows = positioned ? Math.max(1, room - POSITION_ROWS) : room;
    const scroll = Math.max(0, Math.min(detail.scroll, lines.length - rows));
    if (!this.isMeasuring) detail.scroll = scroll;
    const body = lines.slice(scroll, scroll + rows);
    const position = positioned ? [truncateToWidth(th.fg("dim", `${this.gutter()}lines ${scroll + 1}-${scroll + body.length} of ${lines.length}`), width, "…")] : [];
    return { header, body, footer: [...position, ...footer] };
  }
}
