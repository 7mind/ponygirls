import { stripVTControlCharacters } from "node:util";
import { Input, Key, matchesKey, ScrollView, visibleWidth, truncateToWidth, wrapTextWithAnsi, type Focusable, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { frameTitle, hintAt, keyHints, PanelLayout, type PanelParts, type Span, type UiTheme } from "@ponygirls/pi-ui";
import { type EngineDescriptor, type EngineSnapshot } from "./search-monitor.js";
import type { SearchPolicy } from "./search-policy.js";
import type { SearchDomain, SearchViewProfiles } from "./search-profile.js";

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
const MAX_ENGINE_LABEL_CHARS = 80;
const TAB_LABELS = ["Web stats", "Paper stats", "Fetchers", "Test web", "Test papers"] as const;
const DOMAINS = ["web", "papers"] as const;

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
	private paneFocused = false;
	private readonly scrollTops = [0, 0, 0, 0, 0];
	private renderedWidth = 80;
	private tabSpans: Span[] = [];

	constructor(deps: WebSearchViewDeps) {
		super((width) => this.renderParts(width));
		this.deps = deps;
		this.tests = Object.fromEntries(DOMAINS.map((domain) => {
			const input = new Input({ prompt: "> ", placeholder: `Test a ${domain === "web" ? "web" : "paper"} search`, placeholderStyle: (text) => deps.theme.fg("dim", text) });
			input.onSubmit = (query) => { void this.run(domain, query); };
			return [domain, { input, active: null, generation: 0, result: "", state: "idle" }];
		})) as typeof this.tests;
		this.regularScroll = new ScrollView({ render: (width) => this.content(width), invalidate() {} }, { overscroll: "contain", scrollbar: "hidden" });
		this.unsubscribe = DOMAINS.map((domain) => deps.profiles[domain].monitor.subscribe(() => this.repaint()));
	}

	get focused(): boolean { return this.paneFocused; }
	set focused(value: boolean) {
		this.paneFocused = value;
		this.focusInputs();
	}

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

	private selectTab(index: number): void {
		if (index === this.tab) return;
		this.scrollTops[this.tab] = this.scroll.scrollTop;
		const previous = this.renderParts(this.renderedWidth);
		const height = this.hasAllocatedHeight
			? this.scroll.viewportHeight + previous.header.length + previous.footer.length
			: Math.max(1, Math.floor(this.deps.rows()));
		this.tab = index;
		this.focusInputs();
		const next = this.renderParts(this.renderedWidth);
		// Refresh both content extent and chrome-adjusted viewport before restoring:
		// a short previous tab or its smaller header must not clamp the saved offset.
		const viewport = Math.max(0, height - next.header.length - next.footer.length);
		this.scroll.updateLayout(next.body.length, viewport, () => this.repaint());
		this.scroll.scrollTo(this.scrollTops[index]);
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

	/** Compare sources without clipping scalar values; oversized tables become metric rows. */
	private table(headers: string[], rows: string[][], width: number): string[] {
		if (rows.length === 0) return [];
		const widths = headers.map((header, i) => Math.max(visibleWidth(header), ...rows.map((cells) => visibleWidth(cells[i]))));
		const row = (cells: string[]) => cells.map((cell, i) => truncateToWidth(cell, widths[i], "") + " ".repeat(Math.max(0, widths[i] - visibleWidth(cell)))).join(" | ");
		if (widths.reduce((a, b) => a + b, 0) + 3 * (headers.length - 1) <= width) {
			return [row(headers), widths.map((n) => "-".repeat(n)).join("-+-"), ...rows.map(row)];
		}
		const labelWidth = Math.max(...headers.slice(1).map(visibleWidth));
		return rows.flatMap((cells) => [
			`${headers[0]}: ${cells[0]}`,
			...headers.slice(1).map((header, i) => `${header.padEnd(labelWidth)} | ${cells[i + 1]}`),
		]);
	}

	private engineGroup(engines: EngineDescriptor[], stats: Map<string, EngineSnapshot>, historical: boolean, width: number, policy?: SearchPolicy): string[] {
		if (engines.length === 0) return [];
		const compact = width >= 60 && width < 110;
		const sourceName = (engine: EngineDescriptor) => `${historical ? `${engine.tier}/` : ""}${plainName(engine.name, MAX_ENGINE_NAME_CHARS)}`;
		const outcomes = engines.map((engine) => {
			const entry = stats.get(engineKey(engine));
			return [sourceName(engine), ...(entry ? [entry.ongoing, entry.success, entry.empty, entry.failed, entry.timeout, entry.cancelled, entry.lastOutcome ?? "pending"].map(String) : Array(7).fill("—"))];
		});
		const timing = engines.map((engine) => {
			const entry = stats.get(engineKey(engine));
			return [sourceName(engine), ...(entry ? [entry.resultCountLast ?? "unknown", entry.resultCountTotal, entry.latencyLastMs === null ? "unknown" : Math.round(entry.latencyLastMs), Math.round(entry.latencyTotalMs)].map(String) : Array(4).fill("—"))];
		});
		const lines = [
			...(engines.some((engine) => !stats.has(engineKey(engine))) ? ["— = not attempted · health unknown"] : []),
			...(compact ? ["Run=active · OK=ok · Ø=empty · Fail=failed · T/O=timeout · Cxl=cancelled"] : []),
			...this.table(compact ? ["Source", "Run", "OK", "Ø", "Fail", "T/O", "Cxl", "Last"] : ["Source", "active", "ok", "empty", "failed", "timeout", "cancelled", "last"], outcomes, width),
			"Observed results and latency (ms)",
			...(compact ? ["Res last/Res total = results last/results total", "ms last/ms total = latency last/latency total (ms)"] : []),
			...this.table(compact ? ["Source", "Res last", "Res total", "ms last", "ms total"] : ["Source", "results last", "results total", "latency last", "latency total"], timing, width),
		];
		const limits = historical ? [] : engines.flatMap((engine) => {
			const source = policy?.sources.find((entry) => entry.name === engine.name);
			return source ? [[sourceName(engine), ...[source.timeoutMs, source.maxResults, source.boost].map(String)]] : [];
		});
		if (limits.length) lines.push(...this.table(["Source", "deadline ms", "candidate cap", "boost"], limits, width));
		// Safe descriptive metadata is a separate legend, not repeated statistic cards.
		for (const engine of engines) {
			const label = plainName(engine.label, MAX_ENGINE_LABEL_CHARS);
			const name = plainName(engine.name, MAX_ENGINE_NAME_CHARS);
			lines.push(`${label}${label === name ? "" : ` (${name})`} · ${engine.tier} · ${historical ? "historical (not current)" : engine.availability ?? "unknown"}`);
			if (!historical && engine.tier === "fallback") {
				const limit = policy?.fallback.find((entry) => entry.backend === engine.name);
				lines.push(limit ? `  default request/local cap ${limit.maxResults} results · deadline ${duration(limit.timeoutMs)}` : "  default cap/deadline unavailable");
			}
		}
		return lines;
	}

	private testLines(width: number): string[] {
		const test = this.tests[this.testDomain!];
		const t = this.deps.theme;
		const lines: string[] = [];
		if (test.state === "idle") lines.push(t.fg("dim", "Enter a query above to test search. Opening this pane does not issue search or fetch probes."));
		else if (test.state === "searching") lines.push(t.fg("accent", "Searching… Ctrl+C cancels all tests."));
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
		else lines.push("First: walk Main engines until the first non-empty response; errors and empty responses advance to the next engine.");
		if (main.requestedPerEngine !== null) {
			lines.push(`Default request: ${main.requestedPerEngine} candidates per Main engine; final n is applied only after fusion/reranking.`);
		} else if (mainCount === 0) lines.push("No Main engines configured; no Main requests.");
		else lines.push("Default Main request unavailable while the mode is invalid.");
		const strategy = main.selectionStrategy;
		if (strategy === "unrecognized") lines.push("Selection: unrecognized strategy; actual fallback is sequential (configured order).");
		else if (strategy === "sequential") lines.push("Selection: sequential (configured order).");
		else lines.push(`Selection: ${strategy}; configured preference below is not a prediction of the next wave/order.`);
		const order = main.engineOrder.slice(0, MAX_ENGINES).map((name) => plainName(name, MAX_ENGINE_NAME_CHARS)).join(" → ");
		lines.push(`Configured preference (before strategy): ${order || "none"}${main.engineOrder.length > MAX_ENGINES ? " → [more omitted]" : ""}.`);
		return lines.map((line) => this.deps.theme.fg("dim", line));
	}

	private aggregationRules(policy: SearchPolicy): string[] {
		const t = this.deps.theme;
		return [
			t.bold("Aggregation · automatic search, all tiers"),
			t.fg("dim", `Shared weighted RRF: score = Σ weight/(k + rank), k=${policy.fusion.rankConstant}; original unique-document ranks, one contribution per source/page. Source boosts and overlap policies apply before the final cut.`),
			t.fg("dim", `Reranking: ${policy.fusion.rerank}; lexical weights title=${policy.fusion.titleWeight}, body=${policy.fusion.bodyWeight}; exact-title priority ${policy.fusion.exactTitle ? "on" : "off"}. URL/identifier lookup priority and provenance are preserved; no inherent tier bonus.`),
			t.fg("dim", `Fuse first, then cut to final n results (default n=${policy.defaultResultCount}). Named backend calls isolate one engine but retain shared dedup/ranking and deadlines; no other tiers are added.`),
		];
	}

	private engineContent(width: number): string[] {
		const domain: SearchDomain = this.tab === 1 ? "papers" : "web";
		const profile = this.deps.profiles[domain];
		const t = this.deps.theme;
		const fetchers = this.tab === 2;
		const lines = [t.bold(`${fetchers ? "Fetcher" : "Search engine"} activity (this extension instance)`)];
		const snapshots = profile.monitor.snapshot();
		const stats = new Map(snapshots.map((entry) => [engineKey(entry), entry]));
		const engines = new Map(profile.engines().map((entry) => [engineKey(entry), entry]));
		const matchesTab = (engine: EngineDescriptor) => (engine.tier === "reader") === fetchers;
		const current = [...engines.values()].filter(matchesTab);
		// Tier is part of the identity: moving an engine must not relabel its old observations.
		const historical = snapshots.filter((entry) => !engines.has(engineKey(entry)) && matchesTab(entry));
		const shown = [...current, ...historical].slice(0, MAX_ENGINES);
		const shownKeys = new Set(shown.map(engineKey));
		const append = (group: EngineDescriptor[], history: boolean) => {
			lines.push(...this.engineGroup(group.filter((engine) => shownKeys.has(engineKey(engine))), stats, history, width, policy));
		};
		let policy: SearchPolicy | undefined;
		if (fetchers) {
			lines.push(t.bold(`Current fetchers · ${current.length}`));
			if (current.length === 0) lines.push(t.fg("dim", "No current fetchers configured; health unknown."));
			append(current, false);
		} else {
			policy = profile.policy();
			if (domain === "web") {
				lines.push(t.fg("accent", `Default auto: n=${policy.defaultResultCount} (max ${policy.maximumResultCount}) · Main ${policy.main.mode} · combine ${policy.main.combineForced ? "true (forced)" : "false"} · configured combine mode ${policy.main.combineMode}`));
				lines.push(t.fg("dim", policy.main.combineForced
				? "Per-call count may override the default; configured combine=true cannot be disabled by a call."
				: "Per-call count/combine may override these defaults; combine=true uses the configured combine mode."));
			} else lines.push(t.fg("accent", `Paper automatic search: n=${policy.defaultResultCount} (max ${policy.maximumResultCount}) · Main ${policy.main.mode}`));
			lines.push(t.fg("dim", `Shared web/paper pool: max ${policy.execution.maxConcurrent} requests, ${policy.execution.perProvider} per provider. Overall ${duration(policy.execution.overallTimeoutMs)}; default source ${duration(policy.execution.sourceTimeoutMs)}; discovery ${duration(policy.execution.discoveryTimeoutMs)}.`));
			lines.push(t.fg("dim", "Source deadlines include queue/rate waits. Attempts may use cached results; viewing this snapshot runs no provider probes."));
			for (const tier of ["main", "fallback", "native"] as const) {
				const group = current.filter((engine) => engine.tier === tier);
				const title = tier === "main" ? "Main" : tier === "fallback" ? "Fallback" : "Native";
				lines.push(t.bold(`${title} · ${tier === "native" ? policy.native.engineCount : group.length} current`));
				if (tier === "main") lines.push(...this.mainRules(policy, group.length, domain));
				else if (tier === "fallback") lines.push(t.fg("dim", "Always attempted alongside valid automatic search; does not wait for Main failure or consume Main slots."));
				else lines.push(t.fg("dim", `Always attempted alongside valid automatic search; no Main slots. Each requests the configured candidate budget; default deadline ${duration(policy.native.timeoutMs)} + ${duration(policy.native.settlementGraceMs)} cancellation/usage-settlement grace.`));
				if (group.length === 0) lines.push(t.fg("dim", `No current ${title} engines configured.`));
				append(group, false);
			}
		}
		if (historical.length > 0) {
			lines.push(t.bold("Previously observed · not currently configured in this tier"));
			append(historical, true);
		}
		if (current.length + historical.length > MAX_ENGINES) lines.push(t.fg("dim", `[${current.length + historical.length - MAX_ENGINES} more engines omitted]`));
		if (policy) lines.push(...this.aggregationRules(policy));
		return lines;
	}

	private content(width: number): string[] {
		const w = Math.max(1, Math.floor(width));
		const lines = this.testDomain ? this.testLines(w) : this.engineContent(w);
		return lines.flatMap((line) => wrapTextWithAnsi(line, w)).map((line) => truncateToWidth(line, w, ""));
	}

	private renderParts(width: number): PanelParts {
		const w = Math.max(1, Math.floor(width));
		const t = this.deps.theme;
		this.renderedWidth = w;
		const hints = [
			{ key: "Tab/Shift+Tab", action: "tabs" },
			...(this.testDomain ? [{ key: "enter", action: "search" }] : []),
			{ key: "↑↓ Ctrl+PgUp/PgDn", action: "scroll" },
			{ key: "Ctrl+C", action: "cancel tests" }, { key: "esc", action: "close" },
		];
		const title = frameTitle(t, w, { title: "websearch", tabs: { labels: TAB_LABELS, active: this.tab } }, "none");
		this.tabSpans = title.tabSpans;
		return {
			header: [title.line, ...(this.testDomain ? this.tests[this.testDomain].input.render(w) : [])],
			body: this.content(w),
			footer: keyHints(t, w, hints).lines,
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
			this.dispose();
			this.deps.close();
			return;
		}
		if (matchesKey(data, Key.tab)) { this.selectTab((this.tab + 1) % TAB_LABELS.length); return; }
		if (matchesKey(data, Key.shift("tab"))) { this.selectTab((this.tab + TAB_LABELS.length - 1) % TAB_LABELS.length); return; }
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
			this.selectTab(tab);
			return { handled: true, render: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
		}
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.scroll.scrollBy(event.wheelDelta);
		return { handled: true, render: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
	}
}
