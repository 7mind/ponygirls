/**
 * Rendering for the model/effort pickers and the border indicator's compact
 * form. Only the shared kit is imported, so the tests run under plain node.
 */
import { MARKER_WIDTH, fit, frameTitle, keyHints, listRow, type KeyHint, type RenderedTitle, type UiFg, type UiTheme } from "@ponygirls/pi-ui";

import { METER_STEPS, MIN_ANSWER_TOKENS, type EffortModel, type EffortRow, type ThinkingApi, type ThinkingLevelName, type ThinkingWire } from "./ponygirls-model-picker-effort.ts";
import type { Hit } from "./ponygirls-model-picker-state.ts";

const THINKING_COLOR: Readonly<Record<ThinkingLevelName, UiFg>> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

const SHORT_LEVEL: Readonly<Record<ThinkingLevelName, string>> = {
	off: "off",
	minimal: "min",
	low: "low",
	medium: "med",
	high: "high",
	xhigh: "xhi",
	max: "max",
};

export const EFFORT_GLYPH = "◆";
export const FAVOURITE_GLYPH = "★";
const METER_FILLED = "▮";
const METER_EMPTY = "▯";
/** Width of the level-name column: the longest name, "minimal". */
const LEVEL_COLUMN = 7;
const COLUMN_GAP = "  ";
const THOUSAND = 1000;
const MILLION = 1_000_000;
/** Columns before favourite-row text: the selection gutter plus the star cell. */
export const FAVOURITE_CELL_WIDTH = 2;

export function thinkingColor(level: ThinkingLevelName): UiFg {
	return THINKING_COLOR[level];
}

export function shortLevel(level: ThinkingLevelName): string {
	return SHORT_LEVEL[level];
}

/** 500000 → 500k, 1048576 → 1M, 1500000 → 1.5M. */
export function formatTokenCount(tokens: number): string {
	if (tokens >= MILLION) return `${Number((tokens / MILLION).toFixed(1))}M`;
	if (tokens >= THOUSAND) return `${Math.round(tokens / THOUSAND)}k`;
	return String(tokens);
}

/** 16384 → "16 384". */
export function groupDigits(value: number): string {
	return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** A clickable hint on a picker's hint lines; a click runs `command`. */
export interface ActionHint<A extends string> extends KeyHint {
	command: A;
}

/**
 * Hint lines in the kit's key-hint style, one or more lines per group, shifted
 * right by `indent` columns. Hits carry the line index within the returned
 * lines; callers offset them by where the lines land.
 */
export function actionHints<A extends string>(
	theme: UiTheme,
	width: number,
	groups: readonly (readonly ActionHint<A>[])[],
	indent: number,
): { lines: string[]; hits: Hit[] } {
	const lines: string[] = [];
	const hits: Hit[] = [];
	for (const group of groups) {
		const rendered = keyHints(theme, Math.max(1, width - indent), group);
		rendered.lines.forEach((line, index) => {
			const lineIndex = lines.length;
			lines.push(" ".repeat(indent) + line);
			for (const span of rendered.spans[index] ?? []) {
				hits.push({ line: lineIndex, start: indent + span.start, end: indent + span.end, action: group[span.index]!.command });
			}
		});
	}
	return { lines, hits };
}

/** Indent a non-row body line so it lines up with list-row text. */
export function bodyLine(text: string, width: number): string {
	return fit(" ".repeat(MARKER_WIDTH) + text, width);
}

export interface ModelRowView {
	favourite: boolean;
	label: string;
	effort?: ThinkingLevelName;
}

/** Model-picker row content: ★ in warning, the model, and a pinned effort as a coloured ◆ plus its name. */
export function modelRowContent(theme: UiTheme, row: ModelRowView): string {
	const star = row.favourite ? theme.fg("warning", FAVOURITE_GLYPH) : " ";
	const effort = row.effort === undefined ? "" : `  ${theme.fg(thinkingColor(row.effort), EFFORT_GLYPH)} ${theme.fg("muted", row.effort)}`;
	return `${star} ${theme.fg("text", row.label)}${effort}`;
}

export function modelRow(theme: UiTheme, width: number, row: ModelRowView, selected: boolean): string {
	return listRow(theme, width, modelRowContent(theme, row), selected);
}

export const EFFORT_TITLE = "Effort";

/** Title facts: the model and its context and output limits; none without a model. */
export function effortMeta(model: EffortModel | undefined): string | undefined {
	if (model === undefined) return undefined;
	return `${model.provider}/${model.id} · ctx ${formatTokenCount(model.contextWindow)} · out ${formatTokenCount(model.maxTokens)}`;
}

export function effortTitle(theme: UiTheme, width: number, model: EffortModel | undefined): RenderedTitle {
	const meta = effortMeta(model);
	return frameTitle(theme, width, meta === undefined ? { title: EFFORT_TITLE } : { title: EFFORT_TITLE, meta }, "box");
}

function meter(theme: UiTheme, steps: number, level: ThinkingLevelName, selected: boolean): string {
	const filled = METER_FILLED.repeat(steps);
	const empty = METER_EMPTY.repeat(METER_STEPS - steps);
	return (filled ? theme.fg(thinkingColor(level), filled) : "") + (empty ? theme.fg(selected ? "muted" : "dim", empty) : "");
}

/** The sent value as [left detail, right-aligned amount]. */
function wireText(theme: UiTheme, wire: ThinkingWire): [string, string] {
	switch (wire.kind) {
		case "off":
			return [theme.fg("muted", "thinking off"), ""];
		case "effort":
			return [`${theme.fg("muted", "effort ")}${theme.fg("text", wire.value)}`, ""];
		case "budget":
			return [theme.fg("muted", "budget"), `${theme.fg("text", groupDigits(wire.tokens))}${theme.fg("muted", " tok")}`];
		case "adaptive":
			return [`${theme.fg("muted", "adaptive · ")}${theme.fg("text", wire.effort)}`, ""];
		case "google-level":
			return [`${theme.fg("muted", "level ")}${theme.fg("text", wire.level)}`, ""];
		case "dynamic":
			return [theme.fg("muted", "dynamic"), ""];
		case "unmodelled":
			return ["", ""];
	}
}

/** Effort row content for `width` columns of row content (after the selection gutter). */
export function effortRowContent(theme: UiTheme, width: number, row: EffortRow, selected: boolean): string {
	const [detail, amount] = wireText(theme, row.wire);
	const alias = row.sameAs === undefined ? "" : theme.fg("muted", ` · same as ${row.sameAs}`);
	const left = `${meter(theme, row.meter, row.level, selected)}${COLUMN_GAP}${fit(theme.fg("text", row.level), LEVEL_COLUMN)}${COLUMN_GAP}${detail}${alias}`;
	if (!amount) return left;
	const amountWidth = plainWidth(amount);
	return `${fit(left, Math.max(0, width - amountWidth))}${amount}`;
}

/** Columns kept free after a right-aligned budget, matching the gutter's breathing room. */
const RIGHT_MARGIN = 1;

export function effortRow(theme: UiTheme, width: number, row: EffortRow, selected: boolean): string {
	return listRow(theme, width, effortRowContent(theme, width - MARKER_WIDTH - RIGHT_MARGIN, row, selected), selected);
}

/** Which kind of API applies and the limit it implies, plain text. */
export function effortFooter(api: ThinkingApi, model: EffortModel, rows: readonly EffortRow[]): string {
	const out = formatTokenCount(model.maxTokens);
	const custom = rows.some((row) => row.wire.kind === "budget" && row.wire.custom) ? " · custom budgets from settings" : "";
	switch (api.kind) {
		case "effort-only":
			return `effort-only API: no thinking-token cap; shares the ${out} output`;
		case "budget":
			return `budget API (${api.field}): answer keeps ≥ ${groupDigits(MIN_ANSWER_TOKENS)} of the ${out} output${custom}`;
		case "adaptive":
			return "adaptive thinking: the model sizes its own thinking";
		case "google-budget":
			return rows.some((row) => row.wire.kind === "dynamic")
				? `Gemini thinking budget: dynamic, the model sizes its own thinking${custom}`
				: `Gemini thinking budget per level${custom}`;
		case "google-level":
			return "Gemini thinking level: no thinking-token cap";
		case "no-reasoning":
			return "no reasoning support: thinking is always off";
		case "unmodelled":
			return `${api.api}: what is sent per level is not shown`;
	}
}

/**
 * Visible width of text whose characters are all single-column (digits, the
 * picker glyphs, ASCII model ids), ignoring SGR escapes. The kit does not
 * export pi-tui's visibleWidth, and pi-tui is not resolvable from the tests.
 */
function plainWidth(styled: string): number {
	return [...styled.replace(/\x1b\[[0-9;]*m/g, "")].length;
}

export interface CompactControls {
	modelId: string;
	level: ThinkingLevelName;
	queuedModelId?: string;
	queuedLevel?: ThinkingLevelName;
}

/**
 * The border indicator's short form: `<model id> · ◆ <level>`, with the level
 * abbreviated when the full name does not fit. A queued dimension shows
 * `current → queued` with the queued value on the pending background. Hits
 * map the model part to "model" and the effort part to "thinking".
 */
export function compactControls(theme: UiTheme, width: number, controls: CompactControls): { line: string; hits: Hit[] } {
	const full = composeCompact(theme, controls, (level) => level);
	if (full.width <= width) return { line: full.line, hits: full.hits };
	const short = composeCompact(theme, controls, shortLevel);
	return { line: short.line, hits: short.hits };
}

function composeCompact(
	theme: UiTheme,
	controls: CompactControls,
	levelName: (level: ThinkingLevelName) => string,
): { line: string; width: number; hits: Hit[] } {
	const arrow = " → ";
	const modelPlain = controls.queuedModelId === undefined ? controls.modelId : `${controls.modelId}${arrow}${controls.queuedModelId}`;
	const modelStyled =
		controls.queuedModelId === undefined
			? theme.fg("text", controls.modelId)
			: `${theme.fg("text", controls.modelId)}${theme.fg("dim", arrow)}${theme.bg("toolPendingBg", controls.queuedModelId)}`;
	const separator = " · ";
	const current = `${EFFORT_GLYPH} ${levelName(controls.level)}`;
	const effortPlain = controls.queuedLevel === undefined ? current : `${current}${arrow}${levelName(controls.queuedLevel)}`;
	const currentStyled = `${theme.fg(thinkingColor(controls.level), EFFORT_GLYPH)} ${theme.fg("accent", levelName(controls.level))}`;
	const effortStyled =
		controls.queuedLevel === undefined
			? currentStyled
			: `${currentStyled}${theme.fg("dim", arrow)}${theme.bg("toolPendingBg", levelName(controls.queuedLevel))}`;
	const modelEnd = plainWidth(modelPlain);
	const effortStart = modelEnd + plainWidth(separator);
	const end = effortStart + plainWidth(effortPlain);
	return {
		line: `${modelStyled}${theme.fg("dim", separator)}${effortStyled}`,
		width: end,
		hits: [
			{ line: 0, start: 0, end: modelEnd, action: "model" },
			{ line: 0, start: effortStart, end, action: "thinking" },
		],
	};
}
