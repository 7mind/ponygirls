/**
 * model-picker — fullscreen clicks and shortcuts for model and thinking level.
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
 * The Favourites tab lists them most recently selected first. A missing catalog
 * entry is kept in the file and omitted from the list until it exists again.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getSupportedThinkingLevels, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { FooterComponent, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { matchesKey, parseKey, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
	favouriteModels,
	filterModels,
	filterChar,
	hitAt,
	modelKey,
	moveSelection,
	outlineContentPoint,
	parsePickerState,
	recordSelection,
	serializePickerState,
	toggleFavourite,
	windowStart,
	type Hit,
	type ModelKey,
	type ModelRef,
	type PickerState,
} from "./model-picker-state.ts";

const MODEL_SHORTCUT = "ctrl+shift+m";
const THINKING_SHORTCUT = "ctrl+shift+e";
/** Keycap glyphs for the footer controls (⌃ ctrl, ⇧ shift). */
const MODEL_SHORTCUT_GLYPH = "⌃⇧M";
const THINKING_SHORTCUT_GLYPH = "⌃⇧E";
const LIST_VISIBLE = 10;
const STAR_WIDTH = 2;

type PickerKind = "model" | "thinking";
type ModelTab = "favourites" | "all";

type PickerAction = "choose" | "favourite" | "switch" | "page-up" | "page-down" | "close";

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
		getExtensionStatuses: () => footerData.getExtensionStatuses(),
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

function popup(width: number, maxHeight: number) {
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
		const controls: Segment[] = [
			{
				plain: `${model} ${MODEL_SHORTCUT_GLYPH}`,
				styled: `${this.theme.fg("accent", model)} ${this.theme.fg("dim", MODEL_SHORTCUT_GLYPH)}`,
				action: "model",
			},
			{ plain: " • ", styled: this.theme.fg("dim", " • ") },
			{
				plain: `${thinking} ${THINKING_SHORTCUT_GLYPH}`,
				styled: `${this.theme.fg("accent", thinking)} ${this.theme.fg("dim", THINKING_SHORTCUT_GLYPH)}`,
				action: "thinking",
			},
		];
		const controlsWidth = controls.reduce((total, segment) => total + visibleWidth(segment.plain), 0);

		// One status line: [path (branch) • session] [native stats] [controls]. The
		// native stats row keeps its formatting and loses only its right side, which
		// the clickable controls replace. The path yields in tiers (full, half,
		// dropped) before the swap gives up and the native rows pass through.
		const natural = visibleWidth(this.theme.fg("dim", path));
		for (const budget of [natural, Math.floor(natural / 2), 0]) {
			const merged = this.mergeRow(width, budget, path, controls, controlsWidth, nativeRightSide(ctx.model, ctx.thinkingLevel));
			if (merged) return merged;
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
	): string[] | undefined {
		const left = budget <= 0 ? "" : truncateToWidth(this.theme.fg("dim", path), budget, this.theme.fg("dim", "..."));
		const leftWidth = visibleWidth(left);
		const gap = leftWidth > 0 ? 2 : 0;
		const rowBudget = width - leftWidth - gap;
		const nativeWidth = rowBudget + visibleWidth(nativeRight) - controlsWidth;
		if (rowBudget <= controlsWidth || nativeWidth <= 0) return undefined;
		const rows = this.native.render(nativeWidth);
		const stats = rows[1] ?? "";
		if (!stripTerminalSequences(stats).endsWith(nativeRight)) return undefined;
		const cut = truncateToWidth(stats, visibleWidth(stats) - visibleWidth(nativeRight), "");
		const startColumn = leftWidth + gap + rowBudget - controlsWidth;
		const row = left + " ".repeat(gap) + cut + segmentLine(this.hits, 0, startColumn, controls);
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
	private query = "";
	private selected = 0;
	private tabHits: Hit[] = [];
	private hintHits: Hit[] = [];
	private listStart = 3;

	constructor(
		private readonly theme: Theme,
		private readonly models: ModelRef[],
		private state: PickerState,
		private readonly onFavourites: (favourites: readonly ModelKey[]) => void,
		private readonly onChoose: (model: ModelRef) => void,
		private readonly onCancel: () => void,
	) {}

	invalidate(): void {}

	private visible(): ModelRef[] {
		const base = this.tab === "favourites" ? favouriteModels(this.models, this.state) : this.models;
		return filterModels(base, this.query);
	}

	render(width: number): string[] {
		const rows = this.visible();
		if (this.selected >= rows.length) this.selected = Math.max(0, rows.length - 1);
		const favouritesLabel = this.tab === "favourites" ? "[Favourites]" : " Favourites ";
		const allLabel = this.tab === "all" ? "[All]" : " All ";
		this.tabHits = [
			{ line: 1, start: 0, end: visibleWidth(favouritesLabel), action: "favourites" },
			{
				line: 1,
				start: visibleWidth(favouritesLabel) + 1,
				end: visibleWidth(favouritesLabel) + 1 + visibleWidth(allLabel),
				action: "all",
			},
		];
		const tabLine = `${this.theme.fg(this.tab === "favourites" ? "accent" : "dim", favouritesLabel)} ${this.theme.fg(this.tab === "all" ? "accent" : "dim", allLabel)}`;
		const lines = [
			this.theme.fg("accent", "Model"),
			truncateToWidth(tabLine, width),
			this.theme.fg("dim", this.query ? `filter: ${this.query}` : "filter: type to search"),
		];
		this.listStart = lines.length;
		const start = windowStart(this.selected, rows.length, LIST_VISIBLE);
		const shown = rows.slice(start, start + LIST_VISIBLE);
		// Exactly LIST_VISIBLE rows so the popup height does not jump while filtering.
		for (let index = 0; index < LIST_VISIBLE; index++) {
			const model = shown[index];
			if (!model) {
				lines.push(index === 0 ? this.theme.fg("dim", this.tab === "favourites" ? "no favourites — ⇥ to All, ␣ to mark" : "no match") : "");
				continue;
			}
			const absolute = start + index;
			const marked = this.state.favourites.includes(modelKey(model)) ? "* " : "  ";
			const cursor = absolute === this.selected ? "> " : "  ";
			const text = `${cursor}${marked}${model.provider}/${model.id}`;
			const styled = absolute === this.selected ? this.theme.fg("accent", text) : text;
			lines.push(truncateToWidth(styled, width));
		}
		const separator: Segment = { plain: " · ", styled: this.theme.fg("dim", " · ") };
		this.hintHits = [];
		lines.push(
			segmentLine(this.hintHits, lines.length, 0, [
				hintButton(this.theme, "⏎ select", "choose"),
				separator,
				hintButton(this.theme, "␣ or right-click favourite", "favourite"),
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
		const row = event.y - this.listStart;
		if (row < 0 || row >= LIST_VISIBLE) return { handled: true };
		const rows = this.visible();
		const start = windowStart(this.selected, rows.length, LIST_VISIBLE);
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
			this.move(-LIST_VISIBLE);
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.move(LIST_VISIBLE);
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
		if (matchesKey(data, "backspace")) {
			this.query = this.query.slice(0, -1);
			this.selected = 0;
			return;
		}
		const typed = filterChar(parseKey(data));
		if (typed) {
			this.query += typed;
			this.selected = 0;
		}
	}

	private choose(): void {
		const model = this.visible()[this.selected];
		if (model) this.onChoose(model);
	}

	private favourite(): void {
		const model = this.visible()[this.selected];
		if (model) this.toggle(model);
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
			case "switch":
				this.switchTab();
				break;
			case "page-up":
				this.move(-LIST_VISIBLE);
				break;
			case "page-down":
				this.move(LIST_VISIBLE);
				break;
			case "close":
				this.onCancel();
				break;
		}
	}

	private toggle(model: ModelRef): void {
		this.state = { ...this.state, favourites: toggleFavourite(this.state.favourites, modelKey(model)) };
		this.onFavourites(this.state.favourites);
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
	width: number,
	maxHeight: number,
	onShortcut: (kind: PickerKind) => void,
	build: (theme: Theme, done: (value: T | undefined) => void) => Component,
): Promise<T | undefined> {
	let closed = false;
	const chosen = await ctx.ui.custom<T | undefined>((_tui, theme, _kb, done) => {
		activePicker = {
			kind,
			close: () => {
				if (closed) return;
				closed = true;
				done(undefined);
			},
		};
		const inner = build(theme, done);
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

async function openModelPicker(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Wait for the current turn to finish before changing model", "warning");
		return;
	}
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
	const chosen = await dialog<ModelRef>("model", ctx, 72, 20, (kind) => open(pi, kind), (theme, done) =>
		new Outlined(
			new ModelPicker(
				theme,
				models,
				state,
				(favourites) => save({ ...state, favourites: [...favourites] }),
				(model) => done(model),
				() => done(undefined),
			),
			(text) => theme.fg("border", text),
		),
	);
	if (!chosen) return;
	save(recordSelection(state, modelKey(chosen), Date.now()));
	const model = models.find((item) => item.provider === chosen.provider && item.id === chosen.id);
	if (!model) return;
	const accepted = await pi.setModel(model);
	ctx.ui.notify(accepted ? `Model: ${model.provider}/${model.id}` : `No credentials for ${model.provider}`, accepted ? "info" : "error");
}

async function openThinkingPicker(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Wait for the current turn to finish before changing effort", "warning");
		return;
	}
	const levels = thinkingLevels(ctx.model);
	const chosen = await dialog<ModelThinkingLevel>("thinking", ctx, 40, 16, (kind) => open(pi, kind), (theme, done) =>
		new Outlined(
			new ThinkingPicker(theme, levels, ctx.thinkingLevel ?? "off", (level) => done(level), () => done(undefined)),
			(text) => theme.fg("border", text),
		),
	);
	if (!chosen) return;
	pi.setThinkingLevel(chosen);
	ctx.ui.notify(`Effort: ${chosen}`, "info");
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

	pi.registerShortcut(MODEL_SHORTCUT, {
		description: "Open the model picker (favourites, then all models)",
		handler: (ctx) => {
			latestCtx = ctx;
			open(pi, "model");
		},
	});
	pi.registerShortcut(THINKING_SHORTCUT, {
		description: "Open the effort picker",
		handler: (ctx) => {
			latestCtx = ctx;
			open(pi, "thinking");
		},
	});
	pi.registerCommand("pick-model", {
		description: "Pick a model (favourites tab first; space marks a favourite)",
		handler: async (_args, ctx) => {
			latestCtx = ctx;
			await withPicker(ctx, () => openModelPicker(pi, ctx));
		},
	});
	pi.registerCommand("pick-thinking", {
		description: "Pick the effort / thinking level",
		handler: async (_args, ctx) => {
			latestCtx = ctx;
			await withPicker(ctx, () => openThinkingPicker(pi, ctx));
		},
	});
}
