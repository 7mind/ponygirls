/**
 * What pi-ai sends for each thinking level of a model, for the effort picker.
 * Pure: no Pi imports. pi-ai's own helpers (api/simple-options, the Google
 * budget table, the Anthropic adaptive effort mapping) are not reachable
 * through pi's extension module aliases, so the rules are mirrored here and a
 * drift test compares them with the pinned pi-ai dist files.
 */

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

/** Meter steps: off is empty, max fills all of them. */
export const METER_STEPS = THINKING_LEVELS.length - 1;

/** Levels with a token budget in pi-ai (`ThinkingBudgets`, settings `thinkingBudgets`). */
export type BudgetLevel = "minimal" | "low" | "medium" | "high";
export type ThinkingBudgets = Partial<Record<BudgetLevel, number>>;

/** Mirrors pi-ai api/simple-options DEFAULT_THINKING_BUDGETS. */
export const DEFAULT_THINKING_BUDGETS: Readonly<Record<BudgetLevel, number>> = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16384,
};

/** Mirrors pi-ai api/simple-options MIN_ANSWER_TOKENS: tokens always left for the answer. */
export const MIN_ANSWER_TOKENS = 1024;

export type GoogleApi = "google-generative-ai" | "google-vertex";

interface GoogleBudgetTable {
	idFragment: string;
	budgets: Readonly<Record<BudgetLevel, number>>;
}

const GEMINI_25_PRO: GoogleBudgetTable = { idFragment: "2.5-pro", budgets: { minimal: 128, low: 2048, medium: 8192, high: 32768 } };
const GEMINI_25_FLASH_LITE: GoogleBudgetTable = { idFragment: "2.5-flash-lite", budgets: { minimal: 512, low: 2048, medium: 8192, high: 24576 } };
const GEMINI_25_FLASH: GoogleBudgetTable = { idFragment: "2.5-flash", budgets: { minimal: 128, low: 2048, medium: 8192, high: 24576 } };

/**
 * pi-ai's Gemini 2.5 budget tables (getGoogleBudget, one copy per API), first
 * matching id fragment wins. Vertex has no flash-lite table: its flash-lite
 * models match the flash one.
 */
export const GOOGLE_BUDGET_TABLES: Readonly<Record<GoogleApi, readonly GoogleBudgetTable[]>> = {
	"google-generative-ai": [GEMINI_25_PRO, GEMINI_25_FLASH_LITE, GEMINI_25_FLASH],
	"google-vertex": [GEMINI_25_PRO, GEMINI_25_FLASH],
};

/** getGoogleBudget's result for a model without a table: Gemini decides (dynamic thinking). */
export const GOOGLE_DYNAMIC_BUDGET = -1;

/** The model fields that decide what pi-ai sends. */
export interface EffortModel {
	provider: string;
	id: string;
	api: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Partial<Record<ThinkingLevelName, string | null>>;
	compat?: EffortCompat;
}

export interface EffortCompat {
	forceAdaptiveThinking?: boolean;
	supportsThinkingTokenBudget?: boolean;
	thinkingTokenBudgetField?: string;
}

/** How the model's API carries the thinking level. */
export type ThinkingApi =
	| { kind: "effort-only" }
	| { kind: "budget"; field: string }
	| { kind: "adaptive" }
	| { kind: "google-budget"; api: GoogleApi }
	| { kind: "google-level" }
	| { kind: "no-reasoning" }
	| { kind: "unmodelled"; api: string };

/** What is sent for one level. */
export type ThinkingWire =
	| { kind: "off" }
	| { kind: "effort"; value: string }
	| { kind: "budget"; tokens: number; custom: boolean }
	| { kind: "adaptive"; effort: string }
	| { kind: "google-level"; level: string }
	| { kind: "dynamic" }
	| { kind: "unmodelled" };

export interface EffortRow {
	level: ThinkingLevelName;
	/** Filled meter steps, 0 (off) … METER_STEPS (max). */
	meter: number;
	wire: ThinkingWire;
	/** Another supported level that sends exactly the same thing. */
	sameAs?: ThinkingLevelName;
}

const EFFORT_ONLY_APIS: ReadonlySet<string> = new Set(["openai-codex-responses", "openai-responses", "azure-openai-responses", "openai-completions"]);
/** pi-ai's Anthropic Messages budget field. */
const ANTHROPIC_BUDGET_FIELD = "budget_tokens";
/** pi-ai's openai-completions field for `supportsThinkingTokenBudget` (vLLM). */
const COMPLETIONS_DEFAULT_BUDGET_FIELD = "thinking_token_budget";
const GOOGLE_LEVELS: ReadonlySet<string> = new Set(["minimal", "low", "medium", "high"]);

function isGoogleApi(api: string): api is GoogleApi {
	return api in GOOGLE_BUDGET_TABLES;
}

export function isThinkingLevel(value: string): value is ThinkingLevelName {
	return (THINKING_LEVELS as readonly string[]).includes(value);
}

export function meterSteps(level: ThinkingLevelName): number {
	return THINKING_LEVELS.indexOf(level);
}

/** Mirrors pi-ai openai-completions resolveThinkingTokenBudgetField. */
function completionsBudgetField(compat: EffortCompat | undefined): string | undefined {
	if (compat?.thinkingTokenBudgetField) return compat.thinkingTokenBudgetField;
	if (compat?.supportsThinkingTokenBudget) return COMPLETIONS_DEFAULT_BUDGET_FIELD;
	return undefined;
}

/** Mirrors pi-ai google-shared usesGoogleThinkingLevel: Gemini 3+/Gemma 4 take a discrete level. */
export function usesGoogleThinkingLevel(model: Pick<EffortModel, "id">): boolean {
	const id = model.id.toLowerCase();
	return (
		/gemini-3(?:\.\d+)?-(?:pro|flash)/.test(id) ||
		/gemini-(?:[4-9]|[1-9]\d)/.test(id) ||
		id === "gemini-flash-latest" ||
		id === "gemini-flash-lite-latest" ||
		/gemma-?4/.test(id)
	);
}

export function thinkingApi(model: EffortModel): ThinkingApi {
	if (!model.reasoning) return { kind: "no-reasoning" };
	if (model.api === "anthropic-messages") {
		return model.compat?.forceAdaptiveThinking === true ? { kind: "adaptive" } : { kind: "budget", field: ANTHROPIC_BUDGET_FIELD };
	}
	if (isGoogleApi(model.api)) return usesGoogleThinkingLevel(model) ? { kind: "google-level" } : { kind: "google-budget", api: model.api };
	if (model.api === "openai-completions") {
		const field = completionsBudgetField(model.compat);
		if (field !== undefined) return { kind: "budget", field };
	}
	if (EFFORT_ONLY_APIS.has(model.api)) return { kind: "effort-only" };
	return { kind: "unmodelled", api: model.api };
}

/** Mirrors pi-ai simple-options clampReasoning: xhigh and max use the high budget. */
export function budgetLevel(level: Exclude<ThinkingLevelName, "off">): BudgetLevel {
	return level === "xhigh" || level === "max" ? "high" : level;
}

/**
 * The budget pi-ai sends on budget APIs (Anthropic Messages, openai-completions
 * with a budget field): the level's budget, capped so MIN_ANSWER_TOKENS remain
 * under the model's output limit.
 */
export function sharedCeilingBudget(level: Exclude<ThinkingLevelName, "off">, maxTokens: number, custom: ThinkingBudgets): number {
	const key = budgetLevel(level);
	const budget = custom[key] ?? DEFAULT_THINKING_BUDGETS[key];
	return Math.min(budget, Math.max(0, maxTokens - MIN_ANSWER_TOKENS));
}

/** Mirrors pi-ai anthropic-messages mapThinkingLevelToEffort. */
export function adaptiveEffort(model: Pick<EffortModel, "thinkingLevelMap">, level: ThinkingLevelName): string {
	const mapped = model.thinkingLevelMap?.[level];
	if (typeof mapped === "string") return mapped;
	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		default:
			return "high";
	}
}

/** Mirrors pi-ai google-shared resolveGoogleThinkingLevel; undefined where pi-ai would reject the mapping. */
export function googleLevel(model: EffortModel, level: ThinkingLevelName): string | undefined {
	const mapped = model.thinkingLevelMap?.[level];
	const resolved = typeof mapped === "string" ? mapped.toLowerCase() : level;
	return GOOGLE_LEVELS.has(resolved) ? resolved : undefined;
}

/** Mirrors pi-ai getGoogleBudget (of `api`) for a resolved Google level. */
export function googleBudget(api: GoogleApi, modelId: string, level: BudgetLevel, custom: ThinkingBudgets): number {
	const override = custom[level];
	if (override !== undefined) return override;
	const table = GOOGLE_BUDGET_TABLES[api].find((entry) => modelId.includes(entry.idFragment));
	return table ? table.budgets[level] : GOOGLE_DYNAMIC_BUDGET;
}

function wireFor(model: EffortModel, api: ThinkingApi, level: ThinkingLevelName, custom: ThinkingBudgets): ThinkingWire {
	if (level === "off") return { kind: "off" };
	switch (api.kind) {
		case "effort-only":
			return { kind: "effort", value: model.thinkingLevelMap?.[level] ?? level };
		case "budget":
			return { kind: "budget", tokens: sharedCeilingBudget(level, model.maxTokens, custom), custom: custom[budgetLevel(level)] !== undefined };
		case "adaptive":
			return { kind: "adaptive", effort: adaptiveEffort(model, level) };
		case "google-level": {
			const resolved = googleLevel(model, level);
			return resolved === undefined ? { kind: "unmodelled" } : { kind: "google-level", level: resolved };
		}
		case "google-budget": {
			const resolved = googleLevel(model, level);
			if (resolved === undefined) return { kind: "unmodelled" };
			const tokens = googleBudget(api.api, model.id, resolved as BudgetLevel, custom);
			return tokens === GOOGLE_DYNAMIC_BUDGET ? { kind: "dynamic" } : { kind: "budget", tokens, custom: custom[resolved as BudgetLevel] !== undefined };
		}
		case "no-reasoning":
			return { kind: "off" };
		case "unmodelled":
			return { kind: "unmodelled" };
	}
}

/** The level name a wire value stands for, when it is one. */
function wireLevel(level: ThinkingLevelName, wire: ThinkingWire): string | undefined {
	switch (wire.kind) {
		case "effort":
			return wire.value;
		case "adaptive":
			return wire.effort;
		case "google-level":
			return wire.level;
		case "budget":
			return level === "off" ? undefined : budgetLevel(level);
		default:
			return undefined;
	}
}

function sameWire(left: ThinkingWire, right: ThinkingWire): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * One row per supported level. A level is an alias ("same as X") when its wire
 * value names another supported level X that sends exactly the same thing.
 */
export function effortRows(model: EffortModel, levels: readonly ThinkingLevelName[], custom: ThinkingBudgets): EffortRow[] {
	const api = thinkingApi(model);
	const wires = new Map(levels.map((level) => [level, wireFor(model, api, level, custom)] as const));
	return levels.map((level) => {
		const wire = wires.get(level)!;
		const row: EffortRow = { level, meter: meterSteps(level), wire };
		const named = wireLevel(level, wire);
		if (named !== undefined && named !== level && isThinkingLevel(named)) {
			const other = wires.get(named);
			if (other !== undefined && sameWire(other, wire)) row.sameAs = named;
		}
		return row;
	});
}
