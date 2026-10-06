/**
 * ponygirls-model-picker — fullscreen clicks and shortcuts for model and thinking level.
 *
 * The built-in footer text is not a click target. This wraps pi's native
 * footer and merges its pwd and stats rows into one status line: [path (branch)
 * • session] [native stats] [model ⌃⇧M • effort ⌃⇧E]. The stats row keeps its
 * native formatting and loses only its right side, which the clickable
 * controls replace; they open the same menus as ctrl+shift+m and
 * ctrl+shift+e. Mouse delivery is fullscreen-only; the shortcuts work in
 * either TUI mode. The picker hint lines double as mouse buttons. Pressing a
 * picker shortcut while that picker is open closes it; the other shortcut
 * switches pickers. Clicking a status-bar segment toggles the same way. Clicks
 * on the transcript or editor cannot close a picker: pi's extension API
 * exposes no mouse channel for clicks outside a component's own bounds.
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
 * and the footer marks queued dimensions with the pending background.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getSupportedThinkingLevels, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { FooterComponent, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component, SizeValue, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { Input, matchesKey, parseKey, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
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
/** Cycle the selected favourite's pinned effort through the model's native levels. */
const EFFORT_CYCLE_SHORTCUT = "ctrl+e";
const EFFORT_CYCLE_GLYPH = "⌃E";
/** Keycap glyphs for the footer controls (⌃ ctrl, ⇧ shift). */
const MODEL_SHORTCUT_GLYPH = "⌃⇧M";
const THINKING_SHORTCUT_GLYPH = "⌃⇧E";
const STAR_WIDTH = 2;
/** Mouse wheel lines per notch, matching the /perf view. */
const WHEEL_LINES = 3;
/** Filter line index in ModelPicker.render output (below the tab line). */
const FILTER_LINE = 1;

type PickerKind = "model" | "thinking";
type ModelTab = "favourites" | "all";

/**
 * A model/effort switch chosen while a turn was running. Applied at the next
 * `turn_end`; the footer marks queued dimensions with a pending background.
 * Dimensions are independent: re-picking one replaces only that half, and
 * picking while idle applies immediately (a leftover queue is stale by
 * definition — its turn already ended — so it is dropped).
 */
interface PendingSwitch {
	model?: ModelRef;
	effort?: ModelThinkingLevel;
}

let pending: PendingSwitch = {};

function hasPending(): boolean {
	return pending.model !== undefined || pending.effort !== undefined;
}

type PickerAction = "choose" | "favourite" | "cycle" | "switch" | "page-up" | "page-down" | "close";

/** A styled footer fragment with its plain width and optional click action. */
interface Segment {
	plain: string;
	styled: string;
	action?: string;
}

/** A clickable hint button: bracketed label in accent, click zone over the brackets. */
function hintButton(theme: Theme, label: string, action: PickerAction): Segment {
	return { plain: `[${label}]`, styled: theme.fg("accent", `[${label}]`), action };
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

function shortCwd(cwd: string): string {
	const home = process.env.HOME;
	if (home && (cwd === home || cwd.startsWith(`${home}/`))) return `~${cwd.slice(home.length)}`;
	return cwd;
}

type NativeSession = ConstructorParameters<typeof FooterComponent>[0];
type NativeFooterData = ConstructorParameters<typeof FooterComponent>[1];

interface FooterData {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	onBranchChange(cb: () => void): () => void;
}

/**
 * Live AgentSession stand-in: extensions get ctx, not the session. routedModel
 * and modelRuntime are stubbed — the routed display and the "(sub)" marker
 * (outside the hardcoded kimi-coding case) are not visible at the extension
 * boundary, with or without reuse.
 */
function nativeSession(): NativeSession {
	return {
		sessionManager: {
			getCwd: () => latestCtx!.cwd,
			getSessionName: () => latestCtx!.sessionManager.getSessionName(),
			getSessionId: () => latestCtx!.sessionManager.getSessionId(),
			getLeafId: () => latestCtx!.sessionManager.getLeafId(),
			getEntries: () => latestCtx!.sessionManager.getEntries(),
			/** ReadonlySessionManager omits getEntryCount; FooterComponent keys its stats cache on it. */
			getEntryCount: () => latestCtx!.sessionManager.getEntries().length,
		},
		getContextUsage: () => latestCtx!.getContextUsage(),
		modelRuntime: { isUsingSubscription: () => false },
		routedModel: undefined,
		get model() {
			return latestCtx!.model;
		},
		get state() {
			return { model: latestCtx!.model, thinkingLevel: latestCtx!.thinkingLevel };
		},
	} as unknown as NativeSession;
}

/** FooterDataProvider stand-in: the "(provider)" prefix is suppressed because the swapped-in controls show the provider. */
function nativeFooterData(footerData: FooterData): NativeFooterData {
	return {
		getGitBranch: () => footerData.getGitBranch(),
		// "tokemon" renders on the right via mergeRow, not in the native rows.
		getExtensionStatuses: () => {
			const all = footerData.getExtensionStatuses();
			if (!all.has("tokemon")) return all;
			const rest = new Map(all);
			rest.delete("tokemon");
			return rest;
		},
		getAvailableProviderCount: () => 1,
		onBranchChange: (callback: () => void) => footerData.onBranchChange(callback),
	};
}

/** Mirror of FooterComponent's right side, whose provider prefix nativeFooterData suppresses. */
function nativeRightSide(model: Model<any> | undefined, thinking: ModelThinkingLevel | undefined): string {
	const id = model?.id || "no-model";
	if (!model?.reasoning) return id;
	const level = thinking || "off";
	return level === "off" ? `${id} • thinking off` : `${id} • ${level}`;
}


class Outlined implements Component {
	private bodyHeight = 0;
	private renderedWidth = 0;

	constructor(
		private readonly inner: Component & { handleInput?(data: string): void },
		private readonly border: (text: string) => string,
	) {}

	invalidate(): void {
		this.inner.invalidate();
	}

	render(width: number): string[] {
		this.renderedWidth = width;
		const innerWidth = Math.max(1, width - 4);
		const body = this.inner.render(innerWidth);
		this.bodyHeight = body.length;
		const rule = (left: string, right: string) => this.border(left + "─".repeat(Math.max(0, width - 2)) + right);
		const lines = body.map((line) => {
			const fitted = truncateToWidth(line, innerWidth);
			const gap = Math.max(0, innerWidth - visibleWidth(fitted));
			return this.border("│") + " " + fitted + " ".repeat(gap) + " " + this.border("│");
		});
		return [rule("┌", "┐"), ...lines, rule("└", "┘")];
	}

	handleInput(data: string): void {
		this.inner.handleInput?.(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
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

class ExtendedFooter implements Component {
	private readonly native: FooterComponent;
	private hits: Hit[] = [];

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly footerData: FooterData,
		private readonly open: (kind: PickerKind) => void,
	) {
		this.native = new FooterComponent(nativeSession(), nativeFooterData(footerData));
		this.dispose = footerData.onBranchChange(() => tui.requestRender());
	}

	dispose: () => void;

	invalidate(): void {
		this.native.invalidate();
	}

	render(width: number): string[] {
		const ctx = latestCtx;
		this.hits = [];
		if (!ctx) return [truncateToWidth(this.theme.fg("dim", "no session"), width)];

		const branch = this.footerData.getGitBranch();
		const sessionName = ctx.sessionManager.getSessionName();
		const path = `${shortCwd(ctx.cwd)}${branch ? ` (${branch})` : ""}${sessionName ? ` • ${sessionName}` : ""}`;
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
		const thinking = ctx.thinkingLevel || "off";
		// A queued switch marks its dimension with the pending background until
		// the turn ends. Queuing the current value is a no-op, so it shows plain.
		const queuedModel = pending.model && `${pending.model.provider}/${pending.model.id}` !== model
			? `${pending.model.provider}/${pending.model.id}`
			: undefined;
		const queuedEffort = pending.effort && pending.effort !== thinking ? pending.effort : undefined;
		const controls: Segment[] = [
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
		const controlsWidth = controls.reduce((total, segment) => total + visibleWidth(segment.plain), 0);

		// One status line: [path (branch) • session] [native stats] [tokemon] [controls]. The
		// native stats row keeps its formatting and loses only its right side, which
		// the clickable controls replace. The tokemon quota line sits immediately
		// before the controls; when it fits nowhere, the row without it is tried.
		// The path yields in tiers (full, half,
		// dropped) before the swap gives up and the native rows pass through.
		const natural = visibleWidth(this.theme.fg("dim", path));
		const quotaText = this.footerData.getExtensionStatuses().get("tokemon");
		const quota: Segment | undefined = quotaText ? { plain: quotaText, styled: this.theme.fg("dim", quotaText) } : undefined;
		for (const budget of [natural, Math.floor(natural / 2), 0]) {
			for (const q of quota === undefined ? [undefined] : [quota, undefined]) {
				const merged = this.mergeRow(width, budget, path, controls, controlsWidth, nativeRightSide(ctx.model, ctx.thinkingLevel), q);
				if (merged) return merged;
			}
		}
		return this.native.render(width);
	}

	private mergeRow(
		width: number,
		budget: number,
		path: string,
		controls: readonly Segment[],
		controlsWidth: number,
		nativeRight: string,
		quota?: Segment,
	): string[] | undefined {
		const left = budget <= 0 ? "" : truncateToWidth(this.theme.fg("dim", path), budget, this.theme.fg("dim", "..."));
		const leftWidth = visibleWidth(left);
		const gap = leftWidth > 0 ? 2 : 0;
		const quotaWidth = quota ? visibleWidth(quota.plain) : 0;
		const quotaGap = quotaWidth > 0 ? 1 : 0;
		const rowBudget = width - leftWidth - gap;
		const nativeWidth = rowBudget + visibleWidth(nativeRight) - controlsWidth;
		if (rowBudget <= controlsWidth + quotaWidth + quotaGap || nativeWidth <= 0) return undefined;
		const rows = this.native.render(nativeWidth);
		const stats = rows[1] ?? "";
		if (!stripTerminalSequences(stats).endsWith(nativeRight)) return undefined;
		const cut = truncateToWidth(stats, visibleWidth(stats) - visibleWidth(nativeRight) - quotaWidth - quotaGap, "");
		const startColumn = leftWidth + gap + rowBudget - controlsWidth;
		const row = left + " ".repeat(gap) + cut + (quota ? quota.styled + " ".repeat(quotaGap) : "") + segmentLine(this.hits, 0, startColumn, controls);
		return [row, ...rows.slice(2)]; // native status rows pass through
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		const hit = hitAt(this.hits, event.x, event.y);
		if (!hit) return undefined;
		this.open(hit.action as PickerKind);
		return { handled: true };
	}
}

class ModelPicker implements Component {
	private tab: ModelTab = "favourites";
	private readonly filter: Input;
	private selected = 0;
	private tabHits: Hit[] = [];
	private hintHits: Hit[] = [];
	private listStart = 2;

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
			prompt: "filter: ",
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
			this.tab === "favourites" ? favouriteModels(this.models, this.state) : this.models.map((model) => ({ ...model }));
		return filterModels(base, this.filter.getValue());
	}

	render(width: number): string[] {
		const rows = this.visible();
		if (this.selected >= rows.length) this.selected = Math.max(0, rows.length - 1);
		const favouritesLabel = this.tab === "favourites" ? "[Favourite models]" : " Favourite models ";
		const allLabel = this.tab === "all" ? "[All models]" : " All models ";
		this.tabHits = [
			{ line: 0, start: 0, end: visibleWidth(favouritesLabel), action: "favourites" },
			{
				line: 0,
				start: visibleWidth(favouritesLabel) + 1,
				end: visibleWidth(favouritesLabel) + 1 + visibleWidth(allLabel),
				action: "all",
			},
		];
		const tabLine = `${this.theme.fg(this.tab === "favourites" ? "accent" : "dim", favouritesLabel)} ${this.theme.fg(this.tab === "all" ? "accent" : "dim", allLabel)}`;
		const lines = [truncateToWidth(tabLine, width), this.filter.render(width)[0] ?? ""];
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
				lines.push(index === 0 ? this.theme.fg("dim", this.tab === "favourites" ? "no favourites — ⇥ to All models, ␣ to mark" : "no match") : "");
				continue;
		}
			const absolute = start + index;
			// Every Favourites-tab row is an entry; in the All tab the star means
			// at least one entry (bare or effort-pinned) exists for the model.
			const marked =
				this.tab === "favourites" || this.state.favourites.some((item) => item.key === modelKey(model)) ? "* " : "  ";
			const cursor = absolute === this.selected ? "> " : "  ";
			const effort = this.rowEffort(model);
			const text = `${cursor}${marked}${model.provider}/${model.id}${effort ? ` • ${effort}` : ""}`;
			const styled = absolute === this.selected ? this.theme.fg("accent", text) : text;
			if (thumb < 0) {
				lines.push(truncateToWidth(styled, width));
				continue;
			}
			const rail = index === thumb ? this.theme.fg("accent", "█") : this.theme.fg("dim", "│");
			const clipped = truncateToWidth(styled, Math.max(0, width - 1));
			const gap = Math.max(0, width - 1 - visibleWidth(clipped));
			lines.push(clipped + " ".repeat(gap) + rail);
		}
		const separator: Segment = { plain: " · ", styled: this.theme.fg("dim", " · ") };
		this.hintHits = [];
		lines.push(
			segmentLine(this.hintHits, lines.length, 0, [
				hintButton(this.theme, "⏎ select", "choose"),
				separator,
				hintButton(this.theme, "␣ or right-click favourite", "favourite"),
				separator,
				hintButton(this.theme, `${EFFORT_CYCLE_GLYPH} cycle effort`, "cycle"),
			]),
		);
		lines.push(
			segmentLine(this.hintHits, lines.length, 0, [
				hintButton(this.theme, "⇥ switch", "switch"),
				separator,
				hintButton(this.theme, "⇞ page up", "page-up"),
				separator,
				hintButton(this.theme, "⇟ page down", "page-down"),
				separator,
				hintButton(this.theme, "⎋ close", "close"),
			]),
		);
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
			if (event.button === "left") this.activate(hint.action as PickerAction);
			return { handled: true };
		}
		const tab = hitAt(this.tabHits, event.x, event.y);
		if (tab) {
			this.tab = tab.action as ModelTab;
			this.selected = 0;
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
		if (event.button === "right" || event.x < STAR_WIDTH + 2) {
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
			case "page-up":
				this.move(-this.visibleRows);
				break;
			case "page-down":
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
	private rowEffort(model: FavouriteModel): string | undefined {
		return this.tab === "favourites" ? model.effort : undefined;
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

class ThinkingPicker implements Component {
	private selected: number;
	private hintHits: Hit[] = [];

	constructor(
		private readonly theme: Theme,
		private readonly levels: ModelThinkingLevel[],
		current: ModelThinkingLevel,
		private readonly onChoose: (level: ModelThinkingLevel) => void,
		private readonly onCancel: () => void,
	) {
		const index = levels.indexOf(current);
		this.selected = index >= 0 ? index : 0;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines = [this.theme.fg("accent", "Effort"), ""];
		for (let index = 0; index < this.levels.length; index++) {
			const level = this.levels[index]!;
			const text = `${index === this.selected ? "> " : "  "}${level}`;
			lines.push(truncateToWidth(index === this.selected ? this.theme.fg("accent", text) : text, width));
		}
		this.hintHits = [];
		lines.push(
			segmentLine(this.hintHits, lines.length, 0, [
				hintButton(this.theme, "⏎ select", "choose"),
				{ plain: " · ", styled: this.theme.fg("dim", " · ") },
				hintButton(this.theme, "⎋ close", "close"),
			]),
		);
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		const hint = hitAt(this.hintHits, event.x, event.y);
		if (hint) {
			this.activate(hint.action as PickerAction);
			return { handled: true };
		}
		const level = this.levels[event.y - 2];
		if (level) this.onChoose(level);
		return { handled: true };
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onCancel();
			return;
		}
		if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, "down")) this.selected = Math.min(this.levels.length - 1, this.selected + 1);
		else if (matchesKey(data, "enter")) this.choose();
	}

	private choose(): void {
		const level = this.levels[this.selected];
		if (level) this.onChoose(level);
	}

	private activate(action: PickerAction): void {
		if (action === "choose") this.choose();
		else this.onCancel();
	}
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
		new Outlined(
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
			(text) => theme.fg("border", text),
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
	const chosen = await dialog<ModelThinkingLevel>("thinking", ctx, 40, 16, (kind) => open(pi, kind), (_tui, theme, done) =>
		new Outlined(
			new ThinkingPicker(theme, levels, ctx.thinkingLevel ?? "off", (level) => done(level), () => done(undefined)),
			(text) => theme.fg("border", text),
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
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			return new ExtendedFooter(tui, theme, footerData, (kind) => open(pi, kind));
		});
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
