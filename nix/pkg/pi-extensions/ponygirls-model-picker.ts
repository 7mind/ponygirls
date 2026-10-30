/**
 * ponygirls-model-picker — fullscreen clicks and shortcuts for model and thinking level.
 *
 * pi's footer runs compact (setFooterOptions): [path (branch) • session]
 * [native stats] on one row, with the model suffix hidden — the model/effort
 * indicator lives on the editor's bottom-right border (a setWidget border
 * widget) with its ⌃⇧M / ⌃⇧E hints and is the model display. Clicking a
 * segment opens its picker — border widgets receive clicks on their own
 * columns — and the shortcuts work in either TUI mode. The picker hint lines
 * double as mouse buttons (mouse delivery is fullscreen-only). Pressing a
 * picker shortcut while that picker is open closes it; the other shortcut
 * switches pickers. Clicks on the transcript or editor cannot close a
 * picker: pi's extension API exposes no mouse channel for clicks outside a
 * component's own bounds.
 *
 * Favourites and last-selection times persist in
 * $PI_CODING_AGENT_DIR/model-picker.json (default ~/.pi/agent/model-picker.json).
 * A favourite is a model key with an optional pinned effort level; the same
 * model may appear several times with different efforts, each entry with its
 * own stable id, sort position, and selection time. Legacy string entries
 * ("provider/id") read as bare entries with no pinned effort. The Favourites
 * tab lists entries most recently selected first and edits their efforts one
 * entry at a time; the All models tab aggregates one row per model and shows
 * no efforts. A missing catalog entry is kept
 * in the file and omitted from the list until it exists again. Choosing a
 * favourite applies its pinned effort (when still supported by the model);
 * a bare entry changes only the model. Choosing while a turn is running
 * queues the switch instead: it applies automatically at the next turn end,
 * and the border indicator marks queued dimensions with the pending
 * background.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getSupportedThinkingLevels, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, SizeValue, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { Input, matchesKey, parseKey, visibleWidth } from "@earendil-works/pi-tui";
import { MARKER_WIDTH, fit, frameTitle, hintAt, type RenderedTitle, type Span } from "@ponygirls/pi-ui";

import { effortRows, isThinkingLevel, thinkingApi, type EffortCompat, type EffortModel, type EffortRow, type ThinkingBudgets, type ThinkingLevelName } from "./ponygirls-model-picker-effort.ts";
import {
	EFFORT_TITLE,
	FAVOURITE_CELL_WIDTH,
	actionHints,
	bodyLine,
	compactControls,
	effortFooter,
	effortMeta,
	effortRow,
	effortTitle,
	modelRow,
	type ActionHint,
} from "./ponygirls-model-picker-view.ts";

import {
	allModels,
	cycleFavouriteEntry,
	cycleModelEntry,
	entryIdBase,
	favouriteModels,
	latestEntryForKey,
	filterModels,
	filterChar,
	hitAt,
	modelKey,
	moveSelection,
	OUTLINE_INSET_X,
	outlineContentPoint,
	parsePickerState,
	pickerVisibleRows,
	recordSelection,
	removeFavouriteEntry,
	serializePickerState,
	toggleBareFavourite,
	windowStart,
	type FavouriteModel,
	type Hit,
	type ModelKey,
	type ModelRef,
	type PickerState,
} from "./ponygirls-model-picker-state.ts";

const MODEL_SHORTCUT = "ctrl+shift+m";
const THINKING_SHORTCUT = "ctrl+shift+e";
/** Widget key for the model/effort indicator on the editor's bottom-right border. */
const CONTROLS_WIDGET_KEY = "model-picker-controls";
/** Cycle the selected favourite's pinned effort through the model's native levels. */
const EFFORT_CYCLE_SHORTCUT = "ctrl+e";
const EFFORT_CYCLE_GLYPH = "⌃E";
/** Keycap glyphs for the controls (⌃ ctrl, ⇧ shift). */
const MODEL_SHORTCUT_GLYPH = "⌃⇧M";
const THINKING_SHORTCUT_GLYPH = "⌃⇧E";
/** Mouse wheel lines per notch, matching the /perf view. */
const WHEEL_LINES = 3;
/** Filter line index in ModelPicker.render output (the tabs are in the box's top border). */
const FILTER_LINE = 0;
/** Effort popup width floor: fits the meter, level, and the longest sent-value text. */
const EFFORT_MIN_WIDTH = 56;
/** Box columns around the effort title text: "┌─ " + at least " ─" + "┐" + one spare. */
const EFFORT_TITLE_CHROME = 7;
/** Effort popup rows besides the level rows: borders (2), footer (1), hints (1), one spare for wrapping. */
const EFFORT_CHROME_ROWS = 5;

type PickerKind = "model" | "thinking";
type ModelTab = "favourites" | "all";

/**
 * A model/effort switch chosen while a turn was running. Applied at the next
 * `turn_end`; the border indicator marks queued dimensions with a pending
 * background. Dimensions are independent: re-picking one replaces only that
 * half, and picking while idle applies immediately (a leftover queue is stale
 * by definition — its turn already ended — so it is dropped).
 */
interface PendingSwitch {
	model?: ModelRef;
	effort?: ModelThinkingLevel;
}

let pending: PendingSwitch = {};

function hasPending(): boolean {
	return pending.model !== undefined || pending.effort !== undefined;
}

type PickerAction = "choose" | "favourite" | "cycle" | "switch" | "page" | "close";

const MODEL_HINTS: readonly (readonly ActionHint<PickerAction>[])[] = [
	[
		{ key: "⏎", action: "select", command: "choose" },
		{ key: "␣/right-click", action: "favourite", command: "favourite" },
		{ key: EFFORT_CYCLE_GLYPH, action: "cycle effort", command: "cycle" },
	],
	[
		{ key: "⇥", action: "switch tab", command: "switch" },
		{ key: "⇞⇟", action: "page", command: "page" },
		{ key: "⎋", action: "close", command: "close" },
	],
];

const EFFORT_HINTS: readonly (readonly ActionHint<PickerAction>[])[] = [
	[
		{ key: "⏎", action: "select", command: "choose" },
		{ key: "⎋", action: "close", command: "close" },
	],
];

const MODEL_TABS: readonly ModelTab[] = ["favourites", "all"];
const MODEL_TAB_LABELS: readonly string[] = ["★ Favourites", "All"];

/** A styled fragment with its plain width and optional click action. */
interface Segment {
	plain: string;
	styled: string;
	action?: string;
}

/** Join styled segments and register click hit spans in visible-width columns. */
function segmentLine(hits: Hit[], line: number, startColumn: number, segments: readonly Segment[]): string {
	const parts: string[] = [];
	let column = startColumn;
	for (const segment of segments) {
		const start = column;
		parts.push(segment.styled);
		column += visibleWidth(segment.plain);
		if (segment.action) hits.push({ line, start, end: column, action: segment.action });
	}
	return parts.join("");
}

interface ActivePicker {
	kind: PickerKind;
	close: () => void;
}

let latestCtx: ExtensionContext | undefined;
let activePicker: ActivePicker | undefined;
let requestRender: (() => void) | undefined;

function statePath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(dir, "model-picker.json");
}

function readPickerState(): PickerState {
	try {
		return parsePickerState(readFileSync(statePath(), "utf-8"));
	} catch {
		return { favourites: [], selections: [] };
	}
}

function writePickerState(state: PickerState): void {
	const path = statePath();
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, serializePickerState(state), "utf-8");
	renameSync(temporary, path);
}

function catalog(ctx: ExtensionContext): Model<any>[] {
	if (ctx.scopedModels.length > 0) return ctx.scopedModels.map((scoped) => scoped.model);
	return ctx.modelRegistry.getAvailable();
}

function thinkingLevels(model: Model<any> | undefined): ModelThinkingLevel[] {
	return model ? getSupportedThinkingLevels(model) : ["off"];
}


/** A popup body whose title (and tabs) live in the box's top border. */
interface BoxedBody extends Component {
	title(width: number): RenderedTitle;
	selectTab?(index: number): void;
	handleInput?(data: string): void;
}

/** Draws a box around a body: title rule on top, side rules, closing rule. Clicks on the tabs select them. */
class Boxed implements Component {
	private bodyHeight = 0;
	private renderedWidth = 0;
	private tabSpans: Span[] = [];

	constructor(
		private readonly inner: BoxedBody,
		private readonly theme: Theme,
	) {}

	invalidate(): void {
		this.inner.invalidate();
	}

	render(width: number): string[] {
		this.renderedWidth = width;
		const innerWidth = Math.max(1, width - 2 * OUTLINE_INSET_X);
		const title = this.inner.title(width);
		this.tabSpans = title.tabSpans;
		const body = this.inner.render(innerWidth);
		this.bodyHeight = body.length;
		const side = this.theme.fg("border", "│");
		return [
			title.line,
			...body.map((line) => side + fit(line, innerWidth) + side),
			this.theme.fg("border", `└${"─".repeat(innerWidth)}┘`),
		];
	}

	handleInput(data: string): void {
		this.inner.handleInput?.(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.y === 0) {
			const tab = event.type === "click" && event.button === "left" ? hintAt(this.tabSpans, event.x) : undefined;
			if (tab !== undefined) this.inner.selectTab?.(tab);
			return { handled: true };
		}
		const point = outlineContentPoint(event.x, event.y, this.renderedWidth, this.bodyHeight);
		if (!point) return { handled: true };
		return this.inner.handleMouse?.({ ...event, x: point.x, y: point.y }) ?? { handled: true };
	}
}

function popup(width: SizeValue, maxHeight: SizeValue) {
	return {
		overlay: true as const,
		overlayOptions: { anchor: "center" as const, width, maxHeight, margin: 1 },
	};
}

/** The model/effort indicator on the editor's bottom-right border. Clicks open the pickers. */
class ControlsBorder implements Component {
	private hits: Hit[] = [];

	constructor(
		private readonly theme: Theme,
		private readonly open: (kind: PickerKind) => void,
	) {}

	invalidate(): void {}

	render(_width: number): string[] {
		const ctx = latestCtx;
		if (!ctx) return [];
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
		const thinking = ctx.thinkingLevel || "off";
		// A queued switch marks its dimension with the pending background until
		// the turn ends. Queuing the current value is a no-op, so it shows plain.
		const queuedModel =
			pending.model && `${pending.model.provider}/${pending.model.id}` !== model
				? `${pending.model.provider}/${pending.model.id}`
				: undefined;
		const queuedEffort = pending.effort && pending.effort !== thinking ? pending.effort : undefined;
		const segments: Segment[] = [
			queuedModel
				? {
						plain: `${model} → ${queuedModel} ${MODEL_SHORTCUT_GLYPH}`,
						styled: `${this.theme.fg("accent", model)} ${this.theme.fg("dim", "→")} ${this.theme.bg("toolPendingBg", queuedModel)} ${this.theme.fg("dim", MODEL_SHORTCUT_GLYPH)}`,
						action: "model",
					}
				: {
						plain: `${model} ${MODEL_SHORTCUT_GLYPH}`,
						styled: `${this.theme.fg("accent", model)} ${this.theme.fg("dim", MODEL_SHORTCUT_GLYPH)}`,
						action: "model",
					},
			{ plain: " • ", styled: this.theme.fg("dim", " • ") },
			queuedEffort
				? {
						plain: `${thinking} → ${queuedEffort} ${THINKING_SHORTCUT_GLYPH}`,
						styled: `${this.theme.fg("accent", thinking)} ${this.theme.fg("dim", "→")} ${this.theme.bg("toolPendingBg", queuedEffort)} ${this.theme.fg("dim", THINKING_SHORTCUT_GLYPH)}`,
						action: "thinking",
					}
				: {
						plain: `${thinking} ${THINKING_SHORTCUT_GLYPH}`,
						styled: `${this.theme.fg("accent", thinking)} ${this.theme.fg("dim", THINKING_SHORTCUT_GLYPH)}`,
						action: "thinking",
					},
		];
		this.hits = [];
		return [segmentLine(this.hits, 0, 0, segments)];
	}

	/** Short form for narrow borders: model id without provider, ◆ and the (abbreviated) level. */
	renderCompact(width: number): string {
		const ctx = latestCtx;
		if (!ctx) return "";
		const level = ctx.thinkingLevel || "off";
		const queuedModel =
			pending.model && (ctx.model === undefined || pending.model.provider !== ctx.model.provider || pending.model.id !== ctx.model.id)
				? pending.model.id
				: undefined;
		const queuedLevel = pending.effort && pending.effort !== level ? pending.effort : undefined;
		const compact = compactControls(this.theme, width, {
			modelId: ctx.model ? ctx.model.id : "no-model",
			level,
			...(queuedModel === undefined ? {} : { queuedModelId: queuedModel }),
			...(queuedLevel === undefined ? {} : { queuedLevel }),
		});
		this.hits = compact.hits;
		return compact.line;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		const hit = hitAt(this.hits, event.x, event.y);
		if (!hit) return undefined;
		this.open(hit.action as PickerKind);
		return { handled: true };
	}
}

class ModelPicker implements BoxedBody {
	private tab: ModelTab = "favourites";
	private readonly filter: Input;
	private selected = 0;
	private hintHits: Hit[] = [];
	private listStart = FILTER_LINE + 1;

	constructor(
		private readonly theme: Theme,
		private readonly models: ModelRef[],
		private state: PickerState,
		private readonly levelsFor: (key: ModelKey) => readonly string[],
		private readonly onFavourites: (next: PickerState) => void,
		private readonly onChoose: (model: FavouriteModel) => void,
		private readonly onCancel: () => void,
		private readonly visibleRows: number,
	) {
		this.filter = new Input({
			prompt: theme.fg("dim", "filter "),
			placeholder: "type to search",
			placeholderStyle: (text) => theme.fg("dim", text),
		});
		// Focus is ours to manage: the TUI only tracks components in its own
		// tree, and the cursor stays pinned at the end (append/backspace only).
		this.filter.focused = true;
	}

	invalidate(): void {
		this.filter.invalidate();
	}

	private visible(): FavouriteModel[] {
		const base: readonly FavouriteModel[] =
			this.tab === "favourites" ? favouriteModels(this.models, this.state) : allModels(this.models);
		return filterModels(base, this.filter.getValue());
	}

	title(width: number): RenderedTitle {
		return frameTitle(
			this.theme,
			width,
			{ title: "Model", tabs: { labels: MODEL_TAB_LABELS, active: MODEL_TABS.indexOf(this.tab) } },
			"box",
		);
	}

	selectTab(index: number): void {
		const tab = MODEL_TABS[index];
		if (tab === undefined) return;
		this.tab = tab;
		this.selected = 0;
	}

	render(width: number): string[] {
		const rows = this.visible();
		if (this.selected >= rows.length) this.selected = Math.max(0, rows.length - 1);
		const lines = [bodyLine(this.filter.render(Math.max(1, width - MARKER_WIDTH))[0] ?? "", width)];
		this.listStart = lines.length;
		const size = this.visibleRows;
		const start = windowStart(this.selected, rows.length, size);
		const shown = rows.slice(start, start + size);
		// Scrollbar rail when the list overflows; the thumb tracks the window.
		const maxStart = Math.max(0, rows.length - size);
		const thumb = maxStart === 0 ? -1 : Math.round((start / maxStart) * (size - 1));
		// Exactly `size` rows so the popup height does not jump while filtering.
		for (let index = 0; index < size; index++) {
			const model = shown[index];
			if (!model) {
				lines.push(
					index === 0
						? bodyLine(this.theme.fg("dim", this.tab === "favourites" ? "no favourites — ⇥ to All models, ␣ to mark" : "no match"), width)
						: "",
				);
				continue;
			}
			const absolute = start + index;
			// Every Favourites-tab row is an entry; in the All tab the star means
			// at least one entry (bare or effort-pinned) exists for the model.
			const favourite = this.tab === "favourites" || this.state.favourites.some((item) => item.key === modelKey(model));
			const effort = this.rowEffort(model);
			const view = { favourite, label: `${model.provider}/${model.id}`, ...(effort === undefined ? {} : { effort }) };
			if (thumb < 0) {
				lines.push(modelRow(this.theme, width, view, absolute === this.selected));
				continue;
			}
			const rail = index === thumb ? this.theme.fg("accent", "█") : this.theme.fg("dim", "│");
			const rowWidth = Math.max(MARKER_WIDTH, width - 1);
			lines.push(fit(modelRow(this.theme, rowWidth, view, absolute === this.selected), rowWidth) + rail);
		}
		const hints = actionHints(this.theme, width, MODEL_HINTS, MARKER_WIDTH);
		this.hintHits = hints.hits.map((hit) => ({ ...hit, line: hit.line + lines.length }));
		lines.push(...hints.lines);
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			this.move(event.wheelDelta < 0 ? -WHEEL_LINES : WHEEL_LINES);
			return { handled: true };
		}
		if (event.type !== "click" || (event.button !== "left" && event.button !== "right")) return undefined;
		const hint = hitAt(this.hintHits, event.x, event.y);
		if (hint) {
			if (event.button !== "left") return { handled: true };
			// "⇞⇟ page": the ⇞ column pages up, the rest of the hint pages down.
			if (hint.action === "page") this.move(event.x === hint.start ? -this.visibleRows : this.visibleRows);
			else this.activate(hint.action as PickerAction);
			return { handled: true };
		}
		// The filter is a real input with its cursor pinned at the end (append
		// and backspace are the only edits); clicks there select nothing.
		// Cursor placement is not forwarded: Input maps clicks assuming its
		// default two-column prompt, and ours is wider.
		if (event.y === FILTER_LINE) return { handled: true };
		const row = event.y - this.listStart;
		if (row < 0 || row >= this.visibleRows) return { handled: true };
		const rows = this.visible();
		const start = windowStart(this.selected, rows.length, this.visibleRows);
		const model = rows[start + row];
		if (!model) return { handled: true };
		if (event.button === "right" || event.x < MARKER_WIDTH + FAVOURITE_CELL_WIDTH) {
			this.toggle(model);
			return { handled: true };
		}
		this.onChoose(model);
		return { handled: true };
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onCancel();
			return;
		}
		if (matchesKey(data, "tab") || matchesKey(data, "left") || matchesKey(data, "right")) {
			this.switchTab();
			return;
		}
		if (matchesKey(data, "up")) {
			this.move(-1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.move(1);
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.move(-this.visibleRows);
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.move(this.visibleRows);
			return;
		}
		if (matchesKey(data, "enter")) {
			this.choose();
			return;
		}
		if (matchesKey(data, "space")) {
			this.favourite();
			return;
		}
		if (matchesKey(data, EFFORT_CYCLE_SHORTCUT)) {
			this.cycle();
			return;
		}
		if (matchesKey(data, "backspace") || matchesKey(data, "delete")) {
			this.editFilter(data);
			return;
		}
		const typed = filterChar(parseKey(data));
		if (typed) {
			this.editFilter(data);
		}
	}

	/** Forward an edit key to the filter input; a changed filter resets the selection. */
	private editFilter(data: string): void {
		const before = this.filter.getValue();
		this.filter.handleInput(data);
		if (this.filter.getValue() !== before) this.selected = 0;
	}

	/**
	 * Choosing a Favourites-tab row applies exactly that entry. An All-tab row
	 * aggregates all entries for the model, so it applies the most recently
	 * stored one (bare when the model is not favourited): the same target the
	 * effort hotkey advances. The chosen row carries the applied entry's id for
	 * the selection log.
	 */
	private choose(): void {
		const row = this.visible()[this.selected];
		if (!row) return;
		if (this.tab === "favourites") {
			this.onChoose(row);
			return;
		}
		const latest = latestEntryForKey(this.state.favourites, modelKey(row));
		this.onChoose({ ...row, entryId: latest?.id, ...(latest?.effort === undefined ? {} : { effort: latest.effort }) });
	}

	private favourite(): void {
		const model = this.visible()[this.selected];
		if (model) this.toggle(model);
	}

	private cycle(): void {
		const row = this.visible()[this.selected];
		if (!row) return;
		const key = modelKey(row);
		const levels = this.levelsFor(key);
		// Cycling keeps the entry's id, so the row keeps its sort position and
		// stays distinct from a sibling entry with the same key and effort.
		const next =
			this.tab === "favourites"
				? cycleFavouriteEntry(this.state, row.entryId!, levels)
				: cycleModelEntry(this.state, key, levels);
		this.state = next;
		this.onFavourites(next);
	}

	private switchTab(): void {
		this.tab = this.tab === "favourites" ? "all" : "favourites";
		this.selected = 0;
	}

	private move(delta: number): void {
		this.selected = moveSelection(this.selected, delta, this.visible().length);
	}

	private activate(action: PickerAction): void {
		switch (action) {
			case "choose":
				this.choose();
				break;
			case "favourite":
				this.favourite();
				break;
			case "cycle":
				this.cycle();
				break;
			case "switch":
				this.switchTab();
				break;
			case "page":
				this.move(this.visibleRows);
				break;
			case "close":
				this.onCancel();
				break;
		}
	}

	/**
	 * Displayed effort for a row: the entry's own pin on the Favourites tab.
	 * All-tab rows aggregate a model's entries and show no effort — efforts
	 * live on entries and are edited on the Favourites tab.
	 */
	private rowEffort(model: FavouriteModel): ThinkingLevelName | undefined {
		if (this.tab !== "favourites" || model.effort === undefined) return undefined;
		// parsePickerState keeps only known levels, and cycling uses the model's levels.
		if (!isThinkingLevel(model.effort)) throw new Error(`Unknown pinned effort '${model.effort}'`);
		return model.effort;
	}

	/**
	 * Space (or right-click) removes exactly the entry under the cursor in the
	 * Favourites tab. In the All tab it toggles only the bare entry, so
	 * effort-pinned variants of the same model survive; they are removed
	 * from the Favourites tab.
	 */
	private toggle(model: FavouriteModel): void {
		const key = modelKey(model);
		this.save({
			...this.state,
			favourites:
				this.tab === "favourites"
					? removeFavouriteEntry(this.state.favourites, model.entryId!)
					: toggleBareFavourite(this.state.favourites, key),
		});
	}

	private save(next: PickerState): void {
		this.state = next;
		this.onFavourites(next);
	}
}

class ThinkingPicker implements BoxedBody {
	private selected: number;
	private hintHits: Hit[] = [];

	constructor(
		private readonly theme: Theme,
		private readonly model: EffortModel | undefined,
		private readonly rows: readonly EffortRow[],
		private readonly footer: string,
		current: ModelThinkingLevel,
		private readonly onChoose: (level: ModelThinkingLevel) => void,
		private readonly onCancel: () => void,
	) {
		const index = rows.findIndex((row) => row.level === current);
		this.selected = index >= 0 ? index : 0;
	}

	invalidate(): void {}

	title(width: number): RenderedTitle {
		return effortTitle(this.theme, width, this.model);
	}

	render(width: number): string[] {
		const lines = this.rows.map((row, index) => effortRow(this.theme, width, row, index === this.selected));
		lines.push(bodyLine(this.theme.fg("muted", this.footer), width));
		const hints = actionHints(this.theme, width, EFFORT_HINTS, MARKER_WIDTH);
		this.hintHits = hints.hits.map((hit) => ({ ...hit, line: hit.line + lines.length }));
		lines.push(...hints.lines);
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		const hint = hitAt(this.hintHits, event.x, event.y);
		if (hint) {
			this.activate(hint.action as PickerAction);
			return { handled: true };
		}
		const row = this.rows[event.y];
		if (row) this.onChoose(row.level);
		return { handled: true };
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onCancel();
			return;
		}
		if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, "down")) this.selected = Math.min(this.rows.length - 1, this.selected + 1);
		else if (matchesKey(data, "enter")) this.choose();
	}

	private choose(): void {
		const row = this.rows[this.selected];
		if (row) this.onChoose(row.level);
	}

	private activate(action: PickerAction): void {
		if (action === "choose") this.choose();
		else this.onCancel();
	}
}

/** The compat flags that change what is sent for a thinking level; each API has its own compat type. */
function effortCompat(model: Model<any>): EffortCompat | undefined {
	const compat = model.compat;
	if (compat === undefined) return undefined;
	return {
		...("forceAdaptiveThinking" in compat ? { forceAdaptiveThinking: compat.forceAdaptiveThinking } : {}),
		...("supportsThinkingTokenBudget" in compat ? { supportsThinkingTokenBudget: compat.supportsThinkingTokenBudget } : {}),
		...("thinkingTokenBudgetField" in compat ? { thinkingTokenBudgetField: compat.thinkingTokenBudgetField } : {}),
	};
}

/** The model fields the effort picker explains. */
function effortModel(model: Model<any>): EffortModel {
	const compat = effortCompat(model);
	return {
		provider: model.provider,
		id: model.id,
		api: model.api,
		reasoning: model.reasoning,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		...(model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: model.thinkingLevelMap }),
		...(compat === undefined ? {} : { compat }),
	};
}

/** Run a picker dialog, registering its close handle so shortcuts can toggle or switch it. */
async function dialog<T>(
	kind: PickerKind,
	ctx: ExtensionContext,
	width: SizeValue,
	maxHeight: SizeValue,
	onShortcut: (kind: PickerKind) => void,
	build: (tui: TUI, theme: Theme, done: (value: T | undefined) => void) => Component,
): Promise<T | undefined> {
	let closed = false;
	const chosen = await ctx.ui.custom<T | undefined>((tui, theme, _kb, done) => {
		activePicker = {
			kind,
			close: () => {
				if (closed) return;
				closed = true;
				done(undefined);
			},
		};
		const inner = build(tui, theme, done);
		return {
			invalidate: () => inner.invalidate(),
			render: (atWidth: number) => inner.render(atWidth),
			// Extension shortcuts are dispatched from the editor, which receives no
			// input while a dialog is focused — intercept the chords here.
			handleInput: (data: string) => {
				if (matchesKey(data, MODEL_SHORTCUT)) return onShortcut("model");
				if (matchesKey(data, THINKING_SHORTCUT)) return onShortcut("thinking");
				inner.handleInput?.(data);
			},
			handleMouse: (event: TuiMouseEvent) => inner.handleMouse?.(event),
		};
	}, popup(width, maxHeight));
	if (activePicker?.kind === kind) activePicker = undefined;
	return chosen;
}

/** Apply a favourite now: the model, plus its pinned effort when supported. */
async function applyFavourite(pi: ExtensionAPI, ctx: ExtensionContext, models: Model<any>[], chosen: FavouriteModel): Promise<void> {
	const model = models.find((item) => item.provider === chosen.provider && item.id === chosen.id);
	if (!model) return;
	const accepted = await pi.setModel(model);
	if (!accepted) {
		ctx.ui.notify(`No credentials for ${model.provider}`, "error");
		return;
	}
	if (chosen.effort === undefined) {
		ctx.ui.notify(`Model: ${model.provider}/${model.id}`, "info");
		return;
	}
	const effort = chosen.effort as ModelThinkingLevel;
	if (!thinkingLevels(model).includes(effort)) {
		ctx.ui.notify(`Model: ${model.provider}/${model.id} (pinned effort '${chosen.effort}' is not supported, effort unchanged)`, "warning");
		return;
	}
	pi.setThinkingLevel(effort);
	ctx.ui.notify(`Model: ${model.provider}/${model.id} • ${chosen.effort}`, "info");
}

/** Queue a favourite for the next turn end. A pinned effort queues alongside the model. */
function queueFavourite(ctx: ExtensionContext, chosen: FavouriteModel): void {
	pending = {
		...pending,
		model: { provider: chosen.provider, id: chosen.id },
		...(chosen.effort === undefined ? {} : { effort: chosen.effort as ModelThinkingLevel }),
	};
	const label = chosen.effort === undefined ? modelKey(chosen) : `${modelKey(chosen)} • ${chosen.effort}`;
	ctx.ui.notify(`Queued ${label} — applies when the turn finishes`, "info");
	requestRender?.();
}

/** Apply the queued switch against a fresh catalog; stale entries are dropped with a warning. */
async function applyPending(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const queued = pending;
	pending = {};
	requestRender?.();
	if (queued.model === undefined && queued.effort === undefined) return;
	const models = catalog(ctx);
	let current = ctx.model;
	if (queued.model) {
		const label = `${queued.model.provider}/${queued.model.id}`;
		const model = models.find((item) => item.provider === queued.model!.provider && item.id === queued.model!.id);
		if (!model) {
			ctx.ui.notify(`Queued model ${label} is no longer available — dropped`, "warning");
			return;
		}
		const accepted = await pi.setModel(model);
		if (!accepted) {
			ctx.ui.notify(`No credentials for ${model.provider} (queued ${label} dropped)`, "error");
			return;
		}
		current = model;
		ctx.ui.notify(`Model: ${label}`, "info");
	}
	if (queued.effort !== undefined) {
		if (!thinkingLevels(current).includes(queued.effort)) {
			ctx.ui.notify(`Queued effort '${queued.effort}' is not supported by the current model — dropped`, "warning");
			return;
		}
		pi.setThinkingLevel(queued.effort);
		ctx.ui.notify(`Effort: ${queued.effort}`, "info");
	}
}

async function openModelPicker(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const models = catalog(ctx);
	if (models.length === 0) {
		ctx.ui.notify("No models available", "warning");
		return;
	}
	let state = readPickerState();
	const save = (next: PickerState) => {
		state = next;
		try {
			writePickerState(state);
		} catch (error) {
			ctx.ui.notify(`Could not save model picker state: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	};
	const levelsFor = (key: ModelKey): readonly string[] => {
		const model = models.find((item) => modelKey(item) === key);
		return thinkingLevels(model);
	};
	const chosen = await dialog<FavouriteModel>("model", ctx, "66%", "66%", (kind) => open(pi, kind), (tui, theme, done) =>
		new Boxed(
			new ModelPicker(
				theme,
				models,
				state,
				levelsFor,
				save,
				(model) => done(model),
				() => done(undefined),
				pickerVisibleRows(tui.terminal?.rows),
			),
			theme,
		),
	);
	if (!chosen) return;
	save(recordSelection(state, chosen.entryId ?? entryIdBase({ key: modelKey(chosen), effort: chosen.effort }), Date.now()));
	if (ctx.isIdle()) {
		pending = {};
		requestRender?.();
		await applyFavourite(pi, ctx, models, chosen);
	} else {
		queueFavourite(ctx, chosen);
	}
}

async function openThinkingPicker(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const levels = thinkingLevels(ctx.model);
	const model = ctx.model ? effortModel(ctx.model) : undefined;
	const budgets: ThinkingBudgets = pi.getSettings().thinkingBudgets ?? {};
	const rows: EffortRow[] = model ? effortRows(model, levels, budgets) : [{ level: "off", meter: 0, wire: { kind: "off" } }];
	const footer = model ? effortFooter(thinkingApi(model), model, rows) : "no model selected";
	const meta = effortMeta(model);
	const titleText = meta === undefined ? EFFORT_TITLE : `${EFFORT_TITLE} · ${meta}`;
	const width = Math.max(EFFORT_MIN_WIDTH, visibleWidth(titleText) + EFFORT_TITLE_CHROME, visibleWidth(footer) + 2 * MARKER_WIDTH + 2 * OUTLINE_INSET_X);
	const chosen = await dialog<ModelThinkingLevel>("thinking", ctx, width, rows.length + EFFORT_CHROME_ROWS, (kind) => open(pi, kind), (_tui, theme, done) =>
		new Boxed(
			new ThinkingPicker(theme, model, rows, footer, ctx.thinkingLevel ?? "off", (level) => done(level), () => done(undefined)),
			theme,
		),
	);
	if (!chosen) return;
	if (ctx.isIdle()) {
		pending = {};
		requestRender?.();
		pi.setThinkingLevel(chosen);
		ctx.ui.notify(`Effort: ${chosen}`, "info");
	} else {
		pending = { ...pending, effort: chosen };
		ctx.ui.notify(`Queued effort ${chosen} — applies when the turn finishes`, "info");
		requestRender?.();
	}
}

async function withPicker(ctx: ExtensionContext, run: () => Promise<void>): Promise<void> {
	if (ctx.mode !== "tui" || activePicker) return;
	await run();
}

function open(pi: ExtensionAPI, kind: PickerKind): void {
	const ctx = latestCtx;
	if (!ctx || ctx.mode !== "tui") return;
	// The open picker's own shortcut closes it; the other shortcut switches.
	const active = activePicker;
	if (active) {
		active.close();
		if (active.kind === kind) return;
	}
	// Defer so a footer click does not open an overlay inside mouse dispatch.
	queueMicrotask(() => {
		void (kind === "model" ? openModelPicker(pi, ctx) : openThinkingPicker(pi, ctx));
	});
}

export default function (pi: ExtensionAPI): void {
	const remember = (_event: unknown, ctx: ExtensionContext) => {
		latestCtx = ctx;
		requestRender?.();
	};
	pi.on("session_start", (_event, ctx) => {
		latestCtx = ctx;
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooterOptions({ compact: true, showModelSuffix: false });
		ctx.ui.setWidget(
			CONTROLS_WIDGET_KEY,
			(tui, theme) => {
				requestRender = () => tui.requestRender();
				return new ControlsBorder(theme, (kind) => open(pi, kind));
			},
			{ placement: "borderBottomRight" },
		);
	});
	pi.on("model_select", remember);
	pi.on("thinking_level_select", remember);
	pi.on("turn_end", (_event, ctx) => {
		latestCtx = ctx;
		if (!hasPending()) return;
		void applyPending(pi, ctx).catch((error) => {
			pending = {};
			requestRender?.();
			ctx.ui.notify(`Could not apply queued switch: ${error instanceof Error ? error.message : String(error)}`, "error");
		});
	});

	pi.registerShortcut(MODEL_SHORTCUT, {
		description: "Open the model picker (favourites, then all models; queued when a turn is running)",
		handler: (ctx) => {
			latestCtx = ctx;
			open(pi, "model");
		},
	});
	pi.registerShortcut(THINKING_SHORTCUT, {
		description: "Open the effort picker (queued when a turn is running)",
		handler: (ctx) => {
			latestCtx = ctx;
			open(pi, "thinking");
		},
	});
	pi.registerCommand("pick-model", {
		description: "Pick a model (favourites tab first; space marks a favourite, ctrl+e cycles its effort; queued when a turn is running)",
		handler: async (_args, ctx) => {
			latestCtx = ctx;
			await withPicker(ctx, () => openModelPicker(pi, ctx));
		},
	});
	pi.registerCommand("pick-thinking", {
		description: "Pick the effort / thinking level (queued when a turn is running)",
		handler: async (_args, ctx) => {
			latestCtx = ctx;
			await withPicker(ctx, () => openThinkingPicker(pi, ctx));
		},
	});
}
