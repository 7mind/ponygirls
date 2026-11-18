import { stripVTControlCharacters } from "node:util";
import { decodeKittyPrintable, Input, Key, matchesKey, ScrollView, visibleWidth, truncateToWidth, wrapTextWithAnsi, type Focusable, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { columnCells, columnHeader, ctrlKey, fitRight, formatCount, frameRule, frameTitle, HINT, hintAt, KEY, keyHints, listRow, MARKER_WIDTH, PanelLayout, stateColor, type Column, type KeyHint, type PanelParts, type Span, type UiState, type UiTheme } from "@ponygirls/pi-ui";
import { type EngineDescriptor, type EngineSnapshot, type SearchOutcomeStatus } from "./search-monitor.js";
import type { SearchPolicy } from "./search-policy.js";
import type { SearchDomain, SearchViewProfile, SearchViewProfiles } from "./search-profile.js";

export interface WebSearchViewDeps {
	profiles: SearchViewProfiles;
	theme: UiTheme;
	keys: { matches(data: string, action: "tui.select.cancel"): boolean };
	rows(): number;
	requestRender(): void;
	close(): void;
}

const MAX_QUERY_CHARS = 2000;
const MAX_RESULT_CHARS = 16_000;
const MAX_RESULT_LINES = 200;
const MAX_WRAPPED_RESULT_LINES = 400;
const MAX_ENGINES = 64;
const MAX_ENGINE_NAME_CHARS = 64;
const TITLE = "Web search";
const TAB_LABELS = ["Web stats", "Paper stats", "Fetchers", "Test web", "Test papers"] as const;
const DOMAINS = ["web", "papers"] as const;

const POLICY_KEY = "?";
const NEXT_TAB_HINT: KeyHint = { key: KEY.tab, action: "next tab" };
const CANCEL_TEST_HINT: KeyHint = { key: ctrlKey("c"), action: "cancel test" };
const STATS_HINTS: readonly KeyHint[] = [NEXT_TAB_HINT, HINT.scroll, HINT.page, { key: POLICY_KEY, action: "policy and legend" }, HINT.close];
const POLICY_HINTS: readonly KeyHint[] = [HINT.scroll, HINT.page, HINT.back];
const FETCHER_HINTS: readonly KeyHint[] = [NEXT_TAB_HINT, HINT.scroll, HINT.page, CANCEL_TEST_HINT, HINT.close];
const TEST_HINTS: readonly KeyHint[] = [NEXT_TAB_HINT, { key: KEY.enter, action: "search" }, HINT.scroll, HINT.page, CANCEL_TEST_HINT, HINT.close];

/** Statistics tiers in row order; readers have their own tab. */
const STATS_TIERS = [
	{ tier: "main", label: "main", title: "Main" },
	{ tier: "fallback", label: "always", title: "Always include" },
	{ tier: "native", label: "native", title: "Native" },
] as const;
const NO_SOURCES: Readonly<Record<SearchDomain, string>> = {
	web: "No web search sources configured. /search-setup adds one.",
	papers: "No paper sources configured. /search-setup enables the backends they use.",
};

const COLUMN_GAP = 2;
const CAP_HEADER = "CAP";
/** Keeps a record's label and value on one line when the record wraps. */
const NO_BREAK_SPACE = "\u00a0";
type StatsColumnId = "source" | "tier" | "active" | "ok" | "empty" | "failed" | "timeout" | "cancelled" | "last" | "results" | "latency" | "deadline" | "cap";
const STATS_COLUMNS: readonly { id: StatsColumnId; header: string; align: Column["align"] }[] = [
	{ id: "source", header: "SOURCE", align: "left" },
	{ id: "tier", header: "TIER", align: "left" },
	{ id: "active", header: "ACTIVE", align: "right" },
	{ id: "ok", header: "OK", align: "right" },
	{ id: "empty", header: "EMPTY", align: "right" },
	{ id: "failed", header: "FAILED", align: "right" },
	{ id: "timeout", header: "TIMEOUT", align: "right" },
	{ id: "cancelled", header: "CANCELLED", align: "right" },
	{ id: "last", header: "LAST", align: "left" },
	{ id: "results", header: "RESULTS", align: "right" },
	{ id: "latency", header: "LATENCY", align: "right" },
	{ id: "deadline", header: "DEADLINE", align: "right" },
	// Left-aligned so that a boost trails the cap; the caps themselves end under the header.
	{ id: "cap", header: CAP_HEADER, align: "left" },
];
/** Columns given up, first to last, when the table is wider than the pane; the others always stay. */
const DROP_ORDER: readonly StatsColumnId[] = ["cap", "deadline", "latency", "results", "cancelled", "empty", "timeout"];
const COUNTERS = {
	active: { field: "ongoing", state: "running" },
	ok: { field: "success", state: "ok" },
	empty: { field: "empty", state: "attention" },
	failed: { field: "failed", state: "error" },
	timeout: { field: "timeout", state: "attention" },
	cancelled: { field: "cancelled", state: "settled" },
} as const satisfies Partial<Record<StatsColumnId, { field: keyof EngineSnapshot; state: UiState }>>;
/** The counters that are never dropped: listed, when non-zero, in the records shown below the narrowest table. */
const RECORD_COUNTERS = ["active", "ok", "failed"] as const;
const OUTCOMES: Readonly<Record<SearchOutcomeStatus, { word: string; state: UiState }>> = {
	success: { word: "ok", state: "ok" },
	empty: { word: "empty", state: "attention" },
	failed: { word: "failed", state: "error" },
	timeout: { word: "timeout", state: "attention" },
	cancelled: { word: "cancelled", state: "settled" },
};

/** Untrusted search content is plain text, never executable terminal escapes or hyperlinks. */
function plain(text: string): string {
	return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\t/g, "  ");
}

function plainName(text: string, limit: number): string {
	return plain(text).replace(/[\r\n]/g, " ").slice(0, limit);
}

function duration(ms: number): string { return `${ms / 1000}s`; }

function boundedResult(text: string): string {
	const clipped = text.slice(0, MAX_RESULT_CHARS);
	const lines = plain(clipped).split("\n");
	const truncated = text.length > MAX_RESULT_CHARS || lines.length > MAX_RESULT_LINES;
	return lines.slice(0, MAX_RESULT_LINES).join("\n") + (truncated ? "\n[Result truncated]" : "");
}

function engineKey(engine: Pick<EngineDescriptor, "name" | "tier">): string {
	return JSON.stringify([engine.tier, engine.name]);
}

/** One styled paragraph wrapped into the row gutter; when it wraps, continuation lines are indented `hang` columns further. */
function inGutter(text: string, width: number, hang: number): string[] {
	const roomy = width > MARKER_WIDTH + hang;
	const gutter = roomy ? MARKER_WIDTH : 0;
	const unhung = wrapTextWithAnsi(text, Math.max(1, width - gutter));
	const lines = unhung.length === 1 || !roomy ? unhung : wrapTextWithAnsi(text, width - gutter - hang);
	return lines.map((line, index) => `${" ".repeat(gutter + (roomy && index > 0 ? hang : 0))}${line}`);
}

/** One statistics row: identity, observations once attempted, resolved default limits when the policy has them (a null boost is unknown). */
interface SourceRow {
	name: string;
	tierLabel: string;
	marker: "unknown" | "unavailable" | null;
	entry: EngineSnapshot | undefined;
	limits: { timeoutMs: number; maxResults: number; boost: number | null } | null;
}

interface StatsModel {
	domain: SearchDomain;
	policy: SearchPolicy;
	/** `count` is the tier's configured size as the policy reports it; `engines` its current descriptors. */
	tiers: { tier: (typeof STATS_TIERS)[number]["tier"]; title: string; count: number; engines: number }[];
	sourceCount: number;
	current: SourceRow[];
	historical: SourceRow[];
	omitted: number;
}

interface TestState {
	input: Input;
	active: AbortController | null;
	generation: number;
	result: string;
	state: "idle" | "searching" | "done" | "failed" | "cancelled";
}

/** Event-driven /websearch pane. Opening it never probes a provider or reads credentials. */
export class WebSearchView extends PanelLayout implements Focusable {
	private readonly deps: WebSearchViewDeps;
	private readonly tests: Record<SearchDomain, TestState>;
	private readonly regularScroll: ScrollView;
	private readonly unsubscribe: (() => void)[];
	private disposed = false;
	private tab = 0;
	private policyOpen = false;
	private paneFocused = false;
	private readonly scrollTops = [0, 0, 0, 0, 0];
	private renderedWidth = 80;
	private tabSpans: Span[] = [];
	/** Pi's fullscreen transcript otherwise takes bare PgUp/PgDn, the paging keys this pane advertises. */
	readonly capturesViewportInput = true;

	constructor(deps: WebSearchViewDeps) {
		super((width) => this.renderParts(width));
		this.deps = deps;
		this.tests = Object.fromEntries(DOMAINS.map((domain) => {
			const input = new Input({ prompt: "> ", placeholder: `Test a ${domain === "web" ? "web" : "paper"} search`, placeholderStyle: (text) => deps.theme.fg("dim", text) });
			input.onSubmit = (query) => { void this.run(domain, query); };
			return [domain, { input, active: null, generation: 0, result: "", state: "idle" }];
		})) as typeof this.tests;
		this.regularScroll = new ScrollView({ render: (width) => this.renderParts(width).body, invalidate() {} }, { overscroll: "contain", scrollbar: "hidden" });
		this.unsubscribe = DOMAINS.map((domain) => deps.profiles[domain].monitor.subscribe(() => this.repaint()));
	}

	get focused(): boolean { return this.paneFocused; }
	set focused(value: boolean) {
		this.paneFocused = value;
		this.focusInputs();
	}

	private get statsDomain(): SearchDomain | undefined { return this.tab === 0 ? "web" : this.tab === 1 ? "papers" : undefined; }
	private get testDomain(): SearchDomain | undefined { return this.tab === 3 ? "web" : this.tab === 4 ? "papers" : undefined; }
	private focusInputs(): void {
		for (const domain of DOMAINS) this.tests[domain].input.focused = this.paneFocused && this.testDomain === domain;
	}
	private get scroll(): ScrollView { return this.hasAllocatedHeight ? this.bodyScroll : this.regularScroll; }

	override invalidate(): void { if (this.tests) for (const domain of DOMAINS) this.tests[domain].input.invalidate(); }

	/** Idempotent; even a backend that ignores abort cannot repaint or resurrect this pane. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const unsubscribe of this.unsubscribe) unsubscribe();
		for (const domain of DOMAINS) {
			const test = this.tests[domain];
			test.generation++;
			const controller = test.active;
			test.active = null;
			controller?.abort();
			test.result = "";
			test.input.setValue("");
		}
	}

	private repaint(): void {
		if (!this.disposed) this.deps.requestRender();
	}

	/** Switch tab or open/close the policy view. Each tab keeps its scroll position; the policy view opens at its top. */
	private show(tab: number, policyOpen: boolean): void {
		if (tab === this.tab && policyOpen === this.policyOpen) return;
		if (!this.policyOpen) this.scrollTops[this.tab] = this.scroll.scrollTop;
		const previous = this.renderParts(this.renderedWidth);
		const height = this.hasAllocatedHeight
			? this.scroll.viewportHeight + previous.header.length + previous.footer.length
			: Math.max(1, Math.floor(this.deps.rows()));
		this.tab = tab;
		this.policyOpen = policyOpen;
		this.focusInputs();
		const next = this.renderParts(this.renderedWidth);
		// Refresh both content extent and chrome-adjusted viewport before restoring:
		// a short previous tab or its smaller header must not clamp the saved offset.
		const viewport = Math.max(0, height - next.header.length - next.footer.length);
		this.scroll.updateLayout(next.body.length, viewport, () => this.repaint());
		this.scroll.scrollTo(policyOpen ? 0 : this.scrollTops[tab]);
		this.repaint();
	}

	private resetTestScroll(domain: SearchDomain): void {
		const index = domain === "web" ? 3 : 4;
		this.scrollTops[index] = 0;
		if (this.tab === index) this.scroll.scrollToStart();
	}

	private async run(domain: SearchDomain, value: string): Promise<void> {
		const test = this.tests[domain];
		const query = plain(value).replace(/[\r\n]/g, " ").slice(0, MAX_QUERY_CHARS).trim();
		if (this.disposed || test.active || !query) return;
		const generation = ++test.generation;
		const controller = new AbortController();
		test.active = controller;
		test.state = "searching";
		test.result = "";
		this.resetTestScroll(domain);
		this.repaint();
		try {
			const text = await this.deps.profiles[domain].search(query, controller.signal);
			if (this.disposed || generation !== test.generation) return;
			test.result = boundedResult(text);
			test.state = "done";
		} catch {
			if (this.disposed || generation !== test.generation) return;
			// Native/provider errors can contain headers, URLs with API keys, or echoed config.
			test.state = controller.signal.aborted ? "cancelled" : "failed";
		} finally {
			if (!this.disposed && generation === test.generation) {
				test.active = null;
				this.resetTestScroll(domain);
				this.repaint();
			}
		}
	}

	private cancel(): void {
		for (const domain of DOMAINS) {
			const test = this.tests[domain];
			if (!test.active) continue;
			const controller = test.active;
			test.active = null;
			test.generation++;
			test.state = "cancelled";
			controller.abort();
		}
		this.repaint();
	}

	/** The fetchers' comparative table; compact records retain every scalar when it cannot fit. */
	private engineGroup(engines: EngineDescriptor[], stats: Map<string, EngineSnapshot>, historical: boolean, width: number): string[] {
		if (engines.length === 0) return [];
		const t = this.deps.theme;
		const headers = ["Source", "Act", "OK", "Ø", "Fail", "T/O", "Cxl", "Last", "Res l/Σ", "ms l/Σ", "ms/cap/×"];
		const rows = engines.map((engine) => {
			const entry = stats.get(engineKey(engine));
			const name = plainName(engine.name, MAX_ENGINE_NAME_CHARS);
			const availability = engine.availability ?? "unknown";
			const suffix = historical ? ` · ${engine.tier} · historical (not current)` : availability === "configured" ? "" : ` [${availability}]`;
			const count = (value: number, color: "accent" | "success" | "warning" | "error") => t.fg(value ? color : "dim", String(value));
			const outcome = entry?.lastOutcome ?? (entry ? "pending" : "—");
			const outcomeColor = outcome === "success" ? "success" : outcome === "failed" ? "error" : outcome === "timeout" || outcome === "cancelled" || outcome === "empty" ? "warning" : "dim";
			// The search policy carries no per-fetcher deadline, candidate cap or boost.
			const limits = "—/—/—";
			return [t.fg("accent", name) + t.fg(availability === "unavailable" ? "error" : "dim", suffix),
				...(entry ? [count(entry.ongoing, "accent"), count(entry.success, "success"), count(entry.empty, "warning"), count(entry.failed, "error"), count(entry.timeout, "warning"), count(entry.cancelled, "warning")] : Array(6).fill(t.fg("dim", "—"))),
				t.fg(outcomeColor, outcome), entry ? `${entry.resultCountLast ?? "unknown"}/${entry.resultCountTotal}` : "—/—",
				entry ? `${entry.latencyLastMs === null ? "unknown" : Math.round(entry.latencyLastMs)}/${Math.round(entry.latencyTotalMs)}` : "—/—", limits];
		});
		const widths = headers.map((header, i) => Math.max(visibleWidth(header), ...rows.map((row) => visibleWidth(row[i]))));
		const row = (cells: string[]) => cells.map((cell, i) => cell + " ".repeat(widths[i] - visibleWidth(cell))).join(t.fg("dim", " | "));
		if (width >= 100 && widths.reduce((a, b) => a + b, 0) + 3 * (headers.length - 1) <= width) {
			return [t.fg("accent", row(headers)), t.fg("dim", widths.map((n) => "-".repeat(n)).join("-+-")), ...rows.map(row)];
		}
		return rows.flatMap((cells) => [cells[0],
			`  Act/OK/Ø/Fail/T/O/Cxl ${cells.slice(1, 7).join("/")} · Last ${cells[7]}`,
			`  Res l/Σ ${cells[8]} · ms l/Σ ${cells[9]} · ms/cap/× ${cells[10]}`]);
	}

	private testLines(width: number): string[] {
		const test = this.tests[this.testDomain!];
		const t = this.deps.theme;
		const lines: string[] = [];
		if (test.state === "idle") lines.push(t.fg("dim", "Enter a query above to test search. Opening this pane does not issue search or fetch probes."));
		else if (test.state === "searching") lines.push(t.fg("accent", `Searching… ${ctrlKey("c")} cancels all tests.`));
		else if (test.state === "failed") lines.push(t.fg("error", "Search failed. Provider error details are hidden to protect credentials."));
		else if (test.state === "cancelled") lines.push(t.fg("warning", "Search cancelled."));
		else {
			lines.push(t.bold("Search result"));
			const wrapped = test.result.split("\n").flatMap((line) => wrapTextWithAnsi(line, width));
			lines.push(...wrapped.slice(0, MAX_WRAPPED_RESULT_LINES));
			if (wrapped.length > MAX_WRAPPED_RESULT_LINES) lines.push(t.fg("dim", "[Result truncated for display]"));
			if (!test.result.trim()) lines.push(t.fg("dim", "No displayable results returned."));
		}
		return lines;
	}

	private mainRules(policy: SearchPolicy, mainCount: number, domain: SearchDomain): string[] {
		const { main } = policy;
		const lines: string[] = [];
		if (main.mode === "invalid") lines.push(`${domain === "web" ? "Invalid configured combine mode" : "Invalid automatic search mode"}: automatic search is rejected before any tier is launched.`);
		else if (main.mode === "targeted") lines.push(`Targeted: up to ${main.targetUsableEngines} non-empty Main responses; replace failed/empty slots immediately without waiting for the slowest peer.`);
		else if (main.mode === "all") lines.push("All: schedule every Main engine through the shared concurrency pool.");
		else lines.push("First: stop at first non-empty response; errors/empty advance.");
		if (main.requestedPerEngine !== null) {
			lines.push(`Default: ${main.requestedPerEngine} candidates per Main engine; final n after fusion/reranking.`);
		} else if (mainCount === 0) lines.push("No Main engines configured; no Main requests.");
		else lines.push("Default Main request unavailable while the mode is invalid.");
		const strategy = main.selectionStrategy;
		if (strategy === "unrecognized") lines.push("Selection: unrecognized strategy; actual fallback is sequential (configured order).");
		else if (strategy === "sequential") lines.push("Selection: sequential (configured order).");
		else lines.push(`Selection: ${strategy}; preference is not a prediction of next wave/order.`);
		const order = main.engineOrder.slice(0, MAX_ENGINES).map((name) => plainName(name, MAX_ENGINE_NAME_CHARS)).join(" → ");
		lines.push(`Preference (before strategy): ${order || "none"}${main.engineOrder.length > MAX_ENGINES ? " → [more omitted]" : ""}.`);
		return [lines.slice(0, 2).join(" "), lines.slice(2).join(" ")];
	}

	private aggregationRules(policy: SearchPolicy): string[] {
		const t = this.deps.theme;
		return [
			t.bold("Aggregation · automatic search, all tiers"),
			t.fg("text", `Shared weighted RRF: score = Σ weight/(k + rank), k=${policy.fusion.rankConstant}; original unique-document ranks, one contribution per source/page. Boosts/overlap before final cut; no inherent tier bonus. Reranking: ${policy.fusion.rerank}; lexical weights title=${policy.fusion.titleWeight}, body=${policy.fusion.bodyWeight}; exact-title priority ${policy.fusion.exactTitle ? "on" : "off"}. URL/identifier lookup priority and provenance preserved.`),
			t.fg("text", `Fuse first, then cut to final n results (default n=${policy.defaultResultCount}). Named calls: one engine, shared dedup/ranking/deadlines; no other tiers.`),
		];
	}

	/** Current and previously observed engines of one tab, bounded to MAX_ENGINES in configured-then-observed order. */
	private inventory(profile: SearchViewProfile, fetchers: boolean) {
		const snapshots = profile.monitor.snapshot();
		const stats = new Map(snapshots.map((entry) => [engineKey(entry), entry]));
		const engines = new Map(profile.engines().map((entry) => [engineKey(entry), entry]));
		const matchesTab = (engine: Pick<EngineDescriptor, "tier">) => (engine.tier === "reader") === fetchers;
		const current = [...engines.values()].filter(matchesTab);
		// Tier is part of the identity: moving an engine must not relabel its old observations.
		const historical = snapshots.filter((entry) => !engines.has(engineKey(entry)) && matchesTab(entry));
		const shownKeys = new Set([...current, ...historical].slice(0, MAX_ENGINES).map(engineKey));
		const shown = <T extends Pick<EngineDescriptor, "name" | "tier">>(group: T[]): T[] => group.filter((engine) => shownKeys.has(engineKey(engine)));
		return { stats, current, historical, shown, omitted: Math.max(0, current.length + historical.length - MAX_ENGINES) };
	}

	private fetcherContent(width: number): string[] {
		const t = this.deps.theme;
		const { stats, current, historical, shown, omitted } = this.inventory(this.deps.profiles.web, true);
		const lines = [t.bold("Fetcher activity (this extension instance)"), t.bold(`Current fetchers · ${current.length}`)];
		if (current.length === 0) lines.push(t.fg("dim", "No current fetchers configured; health unknown."));
		lines.push(...this.engineGroup(shown(current), stats, false, width));
		if (historical.length > 0) {
			lines.push(t.bold("Previously observed · not currently configured in this tier"));
			lines.push(...this.engineGroup(shown(historical), stats, true, width));
		}
		if (omitted > 0) lines.push(t.fg("dim", `[${omitted} more engines omitted]`));
		lines.push(t.bold("Legend · policy"),
			t.fg("dim", "Configured unless marked [unknown/unavailable]. Active = dispatched logical ops, not queue/connections."),
			t.fg("dim", "Act/OK/Ø/Fail/T/O/Cxl = active/ok/empty/failed/timeout/cancelled; Res, ms = last/total."),
			t.fg("dim", "Observations — = not attempted · health unknown; limits — = unavailable. ms/cap/× = deadline ms/candidate cap/boost."));
		return lines;
	}

	/** Rows in tier order, then configured order; previously observed rows keep the tier they were observed in. */
	private statsModel(domain: SearchDomain): StatsModel {
		const profile = this.deps.profiles[domain];
		const policy = profile.policy();
		const { stats, current, historical, shown, omitted } = this.inventory(profile, false);
		const tiers = STATS_TIERS.filter(({ tier }) => domain === "web" || tier !== "native");
		const rank = (engine: Pick<EngineDescriptor, "tier">) => {
			const index = STATS_TIERS.findIndex(({ tier }) => tier === engine.tier);
			if (index < 0) throw new Error(`Not a statistics tier: ${engine.tier}`);
			return index;
		};
		const inTierOrder = <T extends Pick<EngineDescriptor, "tier">>(group: T[]): T[] => [...group].sort((a, b) => rank(a) - rank(b));
		const sources = current.filter((engine) => tiers.some(({ tier }) => tier === engine.tier));
		const limits = (engine: EngineDescriptor): SourceRow["limits"] => {
			const source = policy.sources.find((entry) => entry.name === engine.name);
			const fallback = engine.tier === "fallback" ? policy.fallback.find((entry) => entry.backend === engine.name) : undefined;
			if (fallback) return { timeoutMs: fallback.timeoutMs, maxResults: fallback.maxResults, boost: source ? source.boost : null };
			return source ? { timeoutMs: source.timeoutMs, maxResults: source.maxResults, boost: source.boost } : null;
		};
		return {
			domain, policy, omitted,
			tiers: tiers.map(({ tier, title }) => {
				const engines = current.filter((engine) => engine.tier === tier).length;
				return { tier, title, count: tier === "native" ? policy.native.engineCount : engines, engines };
			}),
			sourceCount: sources.length,
			current: inTierOrder(shown(sources)).map((engine) => {
				const availability = engine.availability ?? "unknown";
				return { name: plainName(engine.name, MAX_ENGINE_NAME_CHARS), tierLabel: STATS_TIERS[rank(engine)].label, marker: availability === "configured" ? null : availability, entry: stats.get(engineKey(engine)), limits: limits(engine) };
			}),
			historical: inTierOrder(shown(historical)).map((entry) => ({ name: plainName(entry.name, MAX_ENGINE_NAME_CHARS), tierLabel: STATS_TIERS[rank(entry)].label, marker: null, entry, limits: null })),
		};
	}

	/** Zero and "never attempted" are a dim dot; the cap is right-aligned in `capWidth` so that a boost can trail it. */
	private statsCells(row: SourceRow, capWidth: number): Record<StatsColumnId, string> {
		const t = this.deps.theme;
		const { entry, limits } = row;
		const quiet = t.fg("dim", "·");
		const count = (id: keyof typeof COUNTERS): string => {
			const value = entry === undefined ? 0 : entry[COUNTERS[id].field];
			return value === 0 ? quiet : t.fg(stateColor(COUNTERS[id].state), formatCount(value));
		};
		const outcome = entry === undefined ? null : entry.lastOutcome;
		const lastResults = (): string => {
			if (entry === undefined) return quiet;
			if (entry.resultCountLast !== null) return entry.resultCountLast === 0 ? quiet : t.fg("text", formatCount(entry.resultCountLast));
			// A success whose source exposed no count is unknown, not zero; any other outcome returned nothing.
			return outcome === "success" ? t.fg("muted", "?") : quiet;
		};
		const boost = limits === null || limits.boost === 1 ? "" : ` ×${limits.boost === null ? "?" : limits.boost}`;
		return {
			source: t.fg("text", row.name) + (row.marker === null ? "" : t.fg(row.marker === "unavailable" ? stateColor("error") : "muted", ` [${row.marker}]`)),
			tier: t.fg("muted", row.tierLabel),
			active: count("active"), ok: count("ok"), empty: count("empty"), failed: count("failed"), timeout: count("timeout"), cancelled: count("cancelled"),
			last: outcome === null ? t.fg("dim", "never") : t.fg(stateColor(OUTCOMES[outcome].state), OUTCOMES[outcome].word),
			results: entry === undefined || entry.resultCountTotal === 0 ? lastResults() : `${lastResults()}${t.fg("dim", " / ")}${t.fg("text", formatCount(entry.resultCountTotal))}`,
			latency: entry === undefined || entry.latencyLastMs === null ? quiet : t.fg("text", `${(entry.latencyLastMs / 1000).toFixed(1)} s`),
			deadline: limits === null ? quiet : t.fg("muted", `${limits.timeoutMs / 1000} s`),
			cap: limits === null ? t.fg("dim", fitRight("·", capWidth)) : t.fg("muted", `${fitRight(formatCount(limits.maxResults), capWidth)}${boost}`),
		};
	}

	/** Below the narrowest table: one wrapped line per source with its never-dropped facts, non-zero counters only. */
	private statsRecord(row: SourceRow, cells: Record<StatsColumnId, string>, width: number): string[] {
		const t = this.deps.theme;
		const { entry } = row;
		const labelled = (label: string, value: string) => `${t.fg("muted", label)}${NO_BREAK_SPACE}${value}`;
		const counters = RECORD_COUNTERS.filter((id) => entry !== undefined && entry[COUNTERS[id].field] > 0).map((id) => labelled(id, cells[id]));
		const last = entry === undefined || entry.lastOutcome === null ? cells.last : labelled("last", cells.last);
		return inGutter([cells.source, cells.tier, ...counters, last].join(t.fg("dim", " · ")), width, MARKER_WIDTH);
	}

	/**
	 * One table for all tiers. A column is shown whole or dropped (DROP_ORDER) and named on a dim line
	 * (`hidden`, kept in sight below the scrolling rows); when even the kept columns cannot fit, each
	 * source becomes a wrapped record.
	 */
	private statsTable(model: StatsModel, width: number): { header: string[]; body: string[]; hidden: string[] } {
		const t = this.deps.theme;
		const note = (text: string) => inGutter(t.fg("dim", text), width, 0);
		const rows = [...model.current, ...model.historical];
		const capWidth = Math.max(visibleWidth(CAP_HEADER), ...rows.map((row) => (row.limits === null ? 1 : visibleWidth(formatCount(row.limits.maxResults)))));
		const cells = rows.map((row) => this.statsCells(row, capWidth));
		const columns = STATS_COLUMNS
			.filter(({ id }) => id !== "cancelled" || rows.some((row) => row.entry !== undefined && row.entry.cancelled > 0))
			.map((column) => {
				const header = column.id === "cap" ? fitRight(column.header, capWidth) : column.header;
				return { id: column.id, name: column.header, header, align: column.align, width: Math.max(visibleWidth(header), ...cells.map((cell) => visibleWidth(cell[column.id]))) };
			});
		const fits = (shown: typeof columns) => MARKER_WIDTH + shown.reduce((sum, column) => sum + column.width, 0) + COLUMN_GAP * (shown.length - 1) <= width;
		let visible = columns;
		const hidden: string[] = [];
		for (const id of DROP_ORDER) {
			if (fits(visible)) break;
			const dropped = visible.find((column) => column.id === id);
			if (dropped === undefined) continue;
			visible = visible.filter((column) => column !== dropped);
			hidden.push(dropped.name);
		}
		const tabular = rows.length > 0 && fits(visible);
		const line = (index: number) => tabular
			? [listRow(t, width, columnCells(visible, visible.map((column) => cells[index][column.id]), COLUMN_GAP), false)]
			: this.statsRecord(rows[index], cells[index], width);
		const body: string[] = [];
		if (model.current.length === 0) body.push(...note(NO_SOURCES[model.domain]));
		model.current.forEach((_, index) => body.push(...line(index)));
		if (model.historical.length > 0) {
			body.push(...note("Previously observed · not currently configured in this tier"));
			model.historical.forEach((_, index) => body.push(...line(model.current.length + index)));
		}
		if (model.omitted > 0) body.push(...note(`[${model.omitted} more engines omitted]`));
		return {
			header: tabular ? [columnHeader(t, visible, COLUMN_GAP)] : [],
			body,
			hidden: rows.length > 0 && hidden.length > 0 ? note(`hidden at this width: ${hidden.join(", ")}`) : [],
		};
	}

	/** Everything the statistics tab says in prose: pool and defaults, legend, per-tier policy, aggregation. */
	private policyLines(model: StatsModel): string[] {
		const t = this.deps.theme;
		const { domain, policy } = model;
		const prose = (text: string) => t.fg("text", text);
		const section = (heading: string) => ["", t.bold(heading)];
		const lines = [t.bold("Search engine activity (this extension instance)")];
		if (domain === "web") lines.push(prose(`Default auto: n=${policy.defaultResultCount} (max ${policy.maximumResultCount}) · Main ${policy.main.mode} · combine ${policy.main.combineForced ? "true (forced)" : "false"} · configured combine mode ${policy.main.combineMode}`));
		else lines.push(prose(`Paper automatic search: n=${policy.defaultResultCount} (max ${policy.maximumResultCount}) · Main ${policy.main.mode}`));
		lines.push(prose(`Pool web+paper: ${policy.execution.maxConcurrent} concurrent/${policy.execution.perProvider} per provider; overall ${duration(policy.execution.overallTimeoutMs)}; default source ${duration(policy.execution.sourceTimeoutMs)}${domain === "web" ? `; discovery ${duration(policy.execution.discoveryTimeoutMs)}` : ""}.`));
		lines.push(...section("Legend · policy"),
			prose("Configured unless marked [unknown/unavailable]. Active = dispatched logical ops, not queue/connections."),
			prose("LAST never = no completed operation · health unknown; DEADLINE/CAP · = unavailable."),
			prose("RESULTS = last / total; LATENCY = last completed operation; CAP = candidate cap, ×n = boost; ? = not reported."));
		if (domain === "web") lines.push(prose(policy.main.combineForced
			? "Per-call count may override; forced combine=true cannot be disabled."
			: "Per-call count/combine may override; combine=true uses configured mode."));
		lines.push(prose("Deadlines include queue/rate waits; attempts may be cached. Snapshot: no provider probes."));
		for (const { tier, title, count, engines } of model.tiers) {
			lines.push(...section(`${title} policy · ${count} current`));
			if (engines === 0) lines.push(prose(`No current ${title} engines configured.`));
			if (tier === "main") lines.push(...this.mainRules(policy, engines, domain).map(prose));
			else if (tier === "fallback") lines.push(prose("Always alongside valid auto; no Main-failure wait or Main slots. Cap = default request/local cap."));
			else lines.push(prose(`Always alongside valid auto; no Main slots. Configured candidate budget each; deadline ${duration(policy.native.timeoutMs)} + ${duration(policy.native.settlementGraceMs)} cancellation/usage-settlement grace.`));
		}
		lines.push("", ...this.aggregationRules(policy));
		return lines;
	}

	private renderParts(width: number): PanelParts {
		const w = Math.max(1, Math.floor(width));
		const t = this.deps.theme;
		this.renderedWidth = w;
		const bounded = (lines: string[]) => lines.flatMap((line) => wrapTextWithAnsi(line, w)).map((line) => truncateToWidth(line, w, ""));
		const footer = (hints: readonly KeyHint[]) => [frameRule(t, w), ...keyHints(t, w, hints).lines];
		const tabs = { labels: TAB_LABELS, active: this.tab };
		const statsDomain = this.statsDomain;
		if (statsDomain === undefined) {
			const title = frameTitle(t, w, { title: TITLE, tabs }, "none");
			this.tabSpans = title.tabSpans;
			const testDomain = this.testDomain;
			return testDomain === undefined
				? { header: [title.line], body: bounded(this.fetcherContent(w)), footer: footer(FETCHER_HINTS) }
				: { header: [title.line, ...this.tests[testDomain].input.render(w)], body: bounded(this.testLines(w)), footer: footer(TEST_HINTS) };
		}
		const model = this.statsModel(statsDomain);
		if (this.policyOpen) {
			// One level below the tab: no tab strip, esc goes back.
			this.tabSpans = [];
			const title = frameTitle(t, w, { title: TITLE, meta: `${TAB_LABELS[this.tab]} · policy and legend` }, "none");
			return { header: [title.line], body: bounded(this.policyLines(model)), footer: footer(POLICY_HINTS) };
		}
		const summary = `${formatCount(model.sourceCount)} ${model.sourceCount === 1 ? "source" : "sources"} · ${model.policy.main.mode}, n=${model.policy.defaultResultCount}`;
		const summarized = frameTitle(t, w, { title: TITLE, tabs, right: t.fg("muted", summary) }, "none");
		// The summary may not cost a tab: where the title cannot hold both, it gets a line of its own.
		const title = summarized.tabSpans.length === TAB_LABELS.length ? summarized : frameTitle(t, w, { title: TITLE, tabs }, "none");
		this.tabSpans = title.tabSpans;
		const table = this.statsTable(model, w);
		return {
			header: [title.line, ...bounded([...(title === summarized ? [] : inGutter(t.fg("muted", summary), w, 0)), ...table.header])],
			body: bounded(table.body),
			footer: [...bounded(table.hidden), ...footer(STATS_HINTS)],
		};
	}

	override render(width: number): string[] {
		const { header, body, footer } = this.renderParts(width);
		const rows = Math.max(1, Math.floor(this.deps.rows()));
		const height = Math.min(body.length, Math.max(0, rows - header.length - footer.length));
		// Intrinsic previews must not clamp the viewport allocated by Pi's structural layout.
		this.regularScroll.updateLayout(body.length, height, () => this.repaint());
		const start = Math.min(this.scroll.scrollTop, Math.max(0, body.length - height));
		return [...header, ...body.slice(start, start + height), ...footer].slice(0, rows);
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		// Pi's default select.cancel includes Ctrl+C; here it cancels the test, not the pane.
		if (matchesKey(data, Key.ctrl("c"))) { this.cancel(); return; }
		if (this.deps.keys.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
			if (this.policyOpen) { this.show(this.tab, false); return; }
			this.dispose();
			this.deps.close();
			return;
		}
		if (matchesKey(data, Key.tab)) { this.show((this.tab + 1) % TAB_LABELS.length, false); return; }
		if (matchesKey(data, Key.shift("tab"))) { this.show((this.tab + TAB_LABELS.length - 1) % TAB_LABELS.length, false); return; }
		// A shifted printable key arrives raw, as xterm modifyOtherKeys, or as Kitty CSI-u with or without its base key.
		if (this.statsDomain !== undefined && (matchesKey(data, POLICY_KEY) || decodeKittyPrintable(data) === POLICY_KEY)) { this.show(this.tab, !this.policyOpen); return; }
		const page = Math.max(1, this.scroll.viewportHeight - 1);
		if (matchesKey(data, Key.up)) this.scroll.scrollBy(-1);
		else if (matchesKey(data, Key.down)) this.scroll.scrollBy(1);
		else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("pageUp"))) this.scroll.scrollBy(-page);
		else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("pageDown"))) this.scroll.scrollBy(page);
		else if (matchesKey(data, Key.ctrl("home"))) this.scroll.scrollToStart();
		else if (matchesKey(data, Key.ctrl("end"))) this.scroll.scrollToEnd();
		else if (this.testDomain) {
			const input = this.tests[this.testDomain].input;
			// Home/End and ordinary characters belong to the query editor, not pane commands.
			input.handleInput(data);
			const value = input.getValue();
			// Input accepts raw bracketed paste; sanitize before it can reach the terminal.
			const safe = plain(value).replace(/[\r\n]/g, " ").slice(0, MAX_QUERY_CHARS);
			if (safe !== value) input.setValue(safe);
		}
		this.repaint();
	}

	override handleMouse(event: TuiMouseEvent): ReturnType<PanelLayout["handleMouse"]> {
		if (this.disposed) return undefined;
		if (event.type === "click" && event.button === "left" && event.y === 0) {
			const tab = hintAt(this.tabSpans, event.x);
			if (tab === undefined) return undefined;
			this.show(tab, false);
			return { handled: true, render: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
		}
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.scroll.scrollBy(event.wheelDelta);
		return { handled: true, render: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
	}
}
