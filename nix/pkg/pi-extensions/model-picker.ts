/**
 * model-picker — fullscreen clicks and shortcuts for model and thinking level.
 *
 * The built-in footer text is not a click target. This replaces the footer so
 * the model id and thinking level are hit-tested, and opens the same menus
 * from ctrl+shift+m and ctrl+shift+e. Mouse delivery is fullscreen-only; the
 * shortcuts work in either TUI mode.
 *
 * Favourites persist in $PI_CODING_AGENT_DIR/model-picker.json (default
 * ~/.pi/agent/model-picker.json). A missing catalog entry is kept in the file
 * and omitted from the list until it exists again.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getSupportedThinkingLevels, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { matchesKey, parseKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
	favouriteModels,
	filterModels,
	filterChar,
	hitAt,
	modelKey,
	outlineContentPoint,
	parseFavourites,
	toggleFavourite,
	type Hit,
	type ModelRef,
} from "./model-picker-state.ts";

const MODEL_SHORTCUT = "ctrl+shift+m";
const THINKING_SHORTCUT = "ctrl+shift+e";
const LIST_VISIBLE = 10;
const STAR_WIDTH = 2;

type PickerKind = "model" | "thinking";
type ModelTab = "favourites" | "all";

let latestCtx: ExtensionContext | undefined;
let pickerOpen = false;
let requestRender: (() => void) | undefined;

function favouritesPath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(dir, "model-picker.json");
}

function readFavourites(): string[] {
	try {
		return parseFavourites(readFileSync(favouritesPath(), "utf-8"));
	} catch {
		return [];
	}
}

function writeFavourites(favourites: readonly string[]): void {
	const path = favouritesPath();
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify({ favourites }, null, 2) + "\n", "utf-8");
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

function fmtCount(count: number): string {
	if (count < 1000) return String(count);
	if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

interface UsageMessage {
	role?: string;
	usage?: { input?: number; output?: number; cost?: { total?: number } };
}

function usageSummary(ctx: ExtensionContext): string {
	let input = 0;
	let output = 0;
	let cost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = (entry as { message?: UsageMessage }).message;
		if (message?.role !== "assistant" || !message.usage) continue;
		input += message.usage.input ?? 0;
		output += message.usage.output ?? 0;
		cost += message.usage.cost?.total ?? 0;
	}
	return `↑${fmtCount(input)} ↓${fmtCount(output)} $${cost.toFixed(3)}`;
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
			const gap = Math.max(0, innerWidth - visibleWidth(line));
			return this.border("│") + " " + line + " ".repeat(gap) + " " + this.border("│");
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

class ClickableFooter implements Component {
	private hits: Hit[] = [];

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly footerData: {
			getGitBranch(): string | null;
			getExtensionStatuses(): Map<string, string>;
			onBranchChange(cb: () => void): () => void;
		},
		private readonly open: (kind: PickerKind) => void,
	) {
		this.dispose = footerData.onBranchChange(() => tui.requestRender());
	}

	dispose: () => void;

	invalidate(): void {}

	render(width: number): string[] {
		const ctx = latestCtx;
		this.hits = [];
		if (!ctx) return [truncateToWidth(this.theme.fg("dim", "no session"), width)];

		const branch = this.footerData.getGitBranch();
		const usage = ctx.getContextUsage();
		const percent = usage?.percent == null ? "?" : `${usage.percent.toFixed(1)}%`;
		const where = `${shortCwd(ctx.cwd)}${branch ? ` (${branch})` : ""}  ${percent}`;
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
		const thinking = ctx.thinkingLevel ?? "off";

		const controls = this.controlsLine(width, model, thinking);
		const statuses = [...this.footerData.getExtensionStatuses().values()].join(" ");
		const lines = [
			truncateToWidth(this.theme.fg("dim", `${usageSummary(ctx)}  ${where}`), width),
			controls,
		];
		if (statuses) lines.push(truncateToWidth(this.theme.fg("dim", statuses), width));
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		const hit = hitAt(this.hits, event.x, event.y);
		if (!hit) return undefined;
		this.open(hit.action as PickerKind);
		return { handled: true };
	}

	private controlsLine(width: number, model: string, thinking: string): string {
		const parts: string[] = [];
		let column = 0;
		const push = (plain: string, styled: string, action?: PickerKind) => {
			const start = column;
			parts.push(styled);
			column += visibleWidth(plain);
			if (action) this.hits.push({ line: 1, start, end: column, action });
		};
		push(model, this.theme.fg("accent", model), "model");
		push(" • ", this.theme.fg("dim", " • "));
		push(thinking, this.theme.fg("accent", thinking), "thinking");
		const hint = `   ${MODEL_SHORTCUT} model · ${THINKING_SHORTCUT} effort`;
		if (column + visibleWidth(hint) <= width) push(hint, this.theme.fg("dim", hint));
		const line = parts.join("");
		if (visibleWidth(line) <= width) return line;
		this.hits = this.hits.filter((hit) => hit.start < width).map((hit) => ({ ...hit, end: Math.min(hit.end, width) }));
		return truncateToWidth(line, width);
	}
}

class ModelPicker implements Component {
	private tab: ModelTab = "favourites";
	private query = "";
	private selected = 0;
	private tabHits: Hit[] = [];
	private listStart = 3;

	constructor(
		private readonly theme: Theme,
		private readonly models: ModelRef[],
		private favourites: string[],
		private readonly onFavourites: (favourites: readonly string[]) => void,
		private readonly onChoose: (model: ModelRef) => void,
		private readonly onCancel: () => void,
	) {}

	invalidate(): void {}

	private visible(): ModelRef[] {
		const base = this.tab === "favourites" ? favouriteModels(this.models, this.favourites) : this.models;
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
		const start = Math.max(0, Math.min(this.selected - Math.floor(LIST_VISIBLE / 2), Math.max(0, rows.length - LIST_VISIBLE)));
		const shown = rows.slice(start, start + LIST_VISIBLE);
		if (shown.length === 0) {
			lines.push(this.theme.fg("dim", this.tab === "favourites" ? "no favourites — tab to All, space to mark" : "no match"));
		}
		for (let index = 0; index < shown.length; index++) {
			const model = shown[index]!;
			const absolute = start + index;
			const marked = this.favourites.includes(modelKey(model)) ? "* " : "  ";
			const cursor = absolute === this.selected ? "> " : "  ";
			const text = `${cursor}${marked}${model.provider}/${model.id}`;
			const styled = absolute === this.selected ? this.theme.fg("accent", text) : text;
			lines.push(truncateToWidth(styled, width));
		}
		lines.push(this.theme.fg("dim", "enter select · space or right-click favourite · tab switch · esc close"));
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || (event.button !== "left" && event.button !== "right")) return undefined;
		const tab = hitAt(this.tabHits, event.x, event.y);
		if (tab) {
			this.tab = tab.action as ModelTab;
			this.selected = 0;
			return { handled: true };
		}
		const row = event.y - this.listStart;
		const rows = this.visible();
		const start = Math.max(0, Math.min(this.selected - Math.floor(LIST_VISIBLE / 2), Math.max(0, rows.length - LIST_VISIBLE)));
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
			this.tab = this.tab === "favourites" ? "all" : "favourites";
			this.selected = 0;
			return;
		}
		if (matchesKey(data, "up")) {
			this.selected = Math.max(0, this.selected - 1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.selected = Math.min(Math.max(0, this.visible().length - 1), this.selected + 1);
			return;
		}
		if (matchesKey(data, "enter")) {
			const model = this.visible()[this.selected];
			if (model) this.onChoose(model);
			return;
		}
		if (matchesKey(data, "space")) {
			const model = this.visible()[this.selected];
			if (model) this.toggle(model);
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

	private toggle(model: ModelRef): void {
		this.favourites = toggleFavourite(this.favourites, modelKey(model));
		this.onFavourites(this.favourites);
	}
}

class ThinkingPicker implements Component {
	private selected: number;

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
		lines.push(this.theme.fg("dim", "enter select · esc close"));
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
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
		else if (matchesKey(data, "enter")) {
			const level = this.levels[this.selected];
			if (level) this.onChoose(level);
		}
	}
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
	let favourites = readFavourites();
	const chosen = await ctx.ui.custom<ModelRef | undefined>(
		(_tui, theme, _kb, done) =>
			new Outlined(
				new ModelPicker(
					theme,
					models,
					favourites,
					(next) => {
						favourites = [...next];
						try {
							writeFavourites(favourites);
						} catch (error) {
							ctx.ui.notify(`Could not save favourites: ${error instanceof Error ? error.message : String(error)}`, "error");
						}
					},
					(model) => done(model),
					() => done(undefined),
				),
				(text) => theme.fg("border", text),
			),
		popup(72, 20),
	);
	if (!chosen) return;
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
	const chosen = await ctx.ui.custom<ModelThinkingLevel | undefined>(
		(_tui, theme, _kb, done) =>
			new Outlined(
				new ThinkingPicker(theme, levels, ctx.thinkingLevel ?? "off", (level) => done(level), () => done(undefined)),
				(text) => theme.fg("border", text),
			),
		popup(40, 16),
	);
	if (!chosen) return;
	pi.setThinkingLevel(chosen);
	ctx.ui.notify(`Effort: ${chosen}`, "info");
}

async function withPicker(ctx: ExtensionContext, run: () => Promise<void>): Promise<void> {
	if (ctx.mode !== "tui" || pickerOpen) return;
	pickerOpen = true;
	try {
		await run();
	} finally {
		pickerOpen = false;
	}
}

function open(pi: ExtensionAPI, kind: PickerKind): void {
	const ctx = latestCtx;
	if (!ctx || pickerOpen) return;
	pickerOpen = true;
	// Defer so a footer click does not open an overlay inside mouse dispatch.
	queueMicrotask(() => {
		void (async () => {
			try {
				if (ctx.mode !== "tui") return;
				if (kind === "model") await openModelPicker(pi, ctx);
				else await openThinkingPicker(pi, ctx);
			} finally {
				pickerOpen = false;
			}
		})();
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
			return new ClickableFooter(tui, theme, footerData, (kind) => open(pi, kind));
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
