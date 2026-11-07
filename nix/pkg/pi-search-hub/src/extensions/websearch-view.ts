import { stripVTControlCharacters } from "node:util";
import { Input, Key, matchesKey, ScrollView, truncateToWidth, wrapTextWithAnsi, type Focusable, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { frameTitle, hintAt, keyHints, PanelLayout, type PanelParts, type Span, type UiTheme } from "@ponygirls/pi-ui";
import { type EngineDescriptor, type EngineSnapshot, SearchMonitor } from "./search-monitor.js";
import type { SearchPolicy } from "./search-policy.js";

export interface WebSearchViewDeps {
	monitor: SearchMonitor;
	/** Safe metadata only, refreshed by the command owner when opening the pane. */
	engines(): readonly EngineDescriptor[];
	/** Resolved defaults only; reading this snapshot must not select or discover engines. */
	policy(): SearchPolicy;
	/** Owns backend dispatch/formatting. Never return credentials or raw provider errors. */
	search(query: string, signal: AbortSignal): Promise<string>;
	theme: UiTheme;
	keys: { matches(data: string, action: "tui.select.cancel"): boolean };
	rows(): number;
	requestRender(): void;
	close(): void;
}

const MAX_QUERY_CHARS = 2048;
const MAX_RESULT_CHARS = 16_000;
const MAX_RESULT_LINES = 200;
const MAX_WRAPPED_RESULT_LINES = 400;
const MAX_ENGINES = 64;
const MAX_ENGINE_NAME_CHARS = 64;
const MAX_ENGINE_LABEL_CHARS = 80;
const TAB_LABELS = ["Search engines", "Fetchers", "Test search"] as const;
const TEST_TAB = 2;

/** Untrusted search content is plain text, never executable terminal escapes or hyperlinks. */
function plain(text: string): string {
	return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\t/g, "  ");
}

function plainName(text: string, limit: number): string {
	return plain(text).replace(/\n/g, " ").slice(0, limit);
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

/** Event-driven /websearch pane. Opening it never probes a provider or reads credentials. */
export class WebSearchView extends PanelLayout implements Focusable {
	private readonly deps: WebSearchViewDeps;
	private readonly input: Input;
	private readonly regularScroll: ScrollView;
	private readonly unsubscribe: () => void;
	private disposed = false;
	private active: AbortController | null = null;
	private generation = 0;
	private result = "";
	private state: "idle" | "searching" | "done" | "failed" | "cancelled" = "idle";
	private tab = 0;
	private paneFocused = false;
	private readonly scrollTops = [0, 0, 0];
	private renderedWidth = 80;
	private tabSpans: Span[] = [];

	constructor(deps: WebSearchViewDeps) {
		super((width) => this.renderParts(width));
		this.deps = deps;
		this.input = new Input({ prompt: "> ", placeholder: "Test a web search", placeholderStyle: (text) => deps.theme.fg("dim", text) });
		this.input.onSubmit = (query) => { void this.run(query); };
		this.regularScroll = new ScrollView({ render: (width) => this.content(width), invalidate() {} }, { overscroll: "contain", scrollbar: "hidden" });
		this.unsubscribe = deps.monitor.subscribe(() => this.repaint());
	}

	get focused(): boolean { return this.paneFocused; }
	set focused(value: boolean) {
		this.paneFocused = value;
		this.input.focused = value && this.tab === TEST_TAB;
	}

	private get scroll(): ScrollView { return this.hasAllocatedHeight ? this.bodyScroll : this.regularScroll; }

	override invalidate(): void { this.input?.invalidate(); }

	/** Idempotent; even a backend that ignores abort cannot repaint or resurrect this pane. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation++;
		this.unsubscribe();
		const controller = this.active;
		this.active = null;
		controller?.abort();
		this.result = "";
		this.input.setValue("");
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
		this.input.focused = this.paneFocused && index === TEST_TAB;
		const next = this.renderParts(this.renderedWidth);
		// Refresh both content extent and chrome-adjusted viewport before restoring:
		// a short previous tab or its smaller header must not clamp the saved offset.
		const viewport = Math.max(0, height - next.header.length - next.footer.length);
		this.scroll.updateLayout(next.body.length, viewport, () => this.repaint());
		this.scroll.scrollTo(this.scrollTops[index]);
		this.repaint();
	}

	private resetTestScroll(): void {
		this.scrollTops[TEST_TAB] = 0;
		if (this.tab === TEST_TAB) this.scroll.scrollToStart();
	}

	private async run(value: string): Promise<void> {
		const query = plain(value).replace(/\n/g, " ").slice(0, MAX_QUERY_CHARS).trim();
		if (this.disposed || this.active || !query) return;
		const generation = ++this.generation;
		const controller = new AbortController();
		this.active = controller;
		this.state = "searching";
		this.result = "";
		this.resetTestScroll();
		this.repaint();
		try {
			const text = await this.deps.search(query, controller.signal);
			if (this.disposed || generation !== this.generation) return;
			this.result = boundedResult(text);
			this.state = "done";
		} catch {
			if (this.disposed || generation !== this.generation) return;
			// Native/provider errors can contain headers, URLs with API keys, or echoed config.
			this.state = controller.signal.aborted ? "cancelled" : "failed";
		} finally {
			if (!this.disposed && generation === this.generation) {
				this.active = null;
				this.resetTestScroll();
				this.repaint();
			}
		}
	}

	private cancel(): void {
		if (!this.active) return;
		const controller = this.active;
		this.active = null;
		this.generation++;
		this.state = "cancelled";
		controller.abort();
		this.repaint();
	}

	private engineLines(engine: EngineDescriptor, stats: EngineSnapshot | undefined, historical: boolean): string[] {
		const t = this.deps.theme;
		const label = plainName(engine.label, MAX_ENGINE_LABEL_CHARS);
		const name = plainName(engine.name, MAX_ENGINE_NAME_CHARS);
		const title = `${label}${label === name ? "" : ` (${name})`} · ${engine.tier} · ${historical ? "historical (not current)" : engine.availability ?? "unknown"}`;
		if (!stats) return [t.bold(title), t.fg("dim", "  not attempted · health unknown")];
		const last = stats.lastOutcome ?? "pending";
		const stateColor = last === "failed" ? "error" : last === "success" ? "success" : last === "empty" || last === "cancelled" ? "warning" : "muted";
		return [
			t.bold(title),
			t.fg(stateColor, `  active ${stats.ongoing} · ok ${stats.success} · empty ${stats.empty} · failed ${stats.failed} · cancelled ${stats.cancelled} · last ${last}`),
			t.fg("dim", `  results last ${stats.resultCountLast ?? "unknown"} / total ${stats.resultCountTotal} observed · latency last ${stats.latencyLastMs === null ? "unknown" : `${Math.round(stats.latencyLastMs)}ms`} / total ${Math.round(stats.latencyTotalMs)}ms`),
		];
	}

	private testLines(width: number): string[] {
		const t = this.deps.theme;
		const lines: string[] = [];
		if (this.state === "idle") lines.push(t.fg("dim", "Enter a query above to test search. Opening this pane does not issue search or fetch probes."));
		else if (this.state === "searching") lines.push(t.fg("accent", "Searching… Ctrl+C cancels this test."));
		else if (this.state === "failed") lines.push(t.fg("error", "Search failed. Provider error details are hidden to protect credentials."));
		else if (this.state === "cancelled") lines.push(t.fg("warning", "Search cancelled."));
		else {
			lines.push(t.bold("Search result"));
			const wrapped = this.result.split("\n").flatMap((line) => wrapTextWithAnsi(line, width));
			lines.push(...wrapped.slice(0, MAX_WRAPPED_RESULT_LINES));
			if (wrapped.length > MAX_WRAPPED_RESULT_LINES) lines.push(t.fg("dim", "[Result truncated for display]"));
			if (!this.result.trim()) lines.push(t.fg("dim", "No displayable results returned."));
		}
		return lines;
	}

	private mainRules(policy: SearchPolicy, mainCount: number): string[] {
		const { main } = policy;
		const lines: string[] = [];
		if (main.mode === "invalid") lines.push("Invalid configured combine mode: automatic search is rejected before any tier is launched.");
		else if (main.mode === "targeted") lines.push(`Targeted: up to ${main.targetUsableEngines} non-empty Main responses; initial wave parallel, then top up failures/empty responses from remaining engines.`);
		else if (main.mode === "all") lines.push("All: every Main engine is queried in parallel.");
		else lines.push("First: walk Main engines until the first successful response, even empty; errors advance to the next engine.");
		if (main.requestedPerEngine !== null) {
			const basis = main.mode === "targeted" ? `ceil(n/${main.targetUsableEngines})` : main.mode === "all" ? "ceil(n/Main count)" : "n";
			lines.push(`Default request: ${main.requestedPerEngine} results per Main engine (${basis}).`);
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
			t.fg("dim", `Full-weight RRF: score = Σ 1/(k + rank), k=${policy.fusion.rankConstant}; original engine lists, unique-document ranks after within-engine URL dedup. One vote per named engine per distinct page.`),
			t.fg("dim", "Cross-engine agreement boosts pages; URL deduplication preserves source attribution. No per-tier bonus or semantic reranker."),
			t.fg("dim", `Fuse first, then cut to final n results (default n=${policy.defaultResultCount}). Named backend calls isolate one engine and bypass fusion/dedup; no other tiers are added.`),
		];
	}

	private engineContent(): string[] {
		const t = this.deps.theme;
		const fetchers = this.tab === 1;
		const lines = [t.bold(`${fetchers ? "Fetcher" : "Search engine"} activity (this extension instance)`)];
		const snapshots = this.deps.monitor.snapshot();
		const stats = new Map(snapshots.map((entry) => [engineKey(entry), entry]));
		const engines = new Map(this.deps.engines().map((entry) => [engineKey(entry), entry]));
		const matchesTab = (engine: EngineDescriptor) => (engine.tier === "reader") === fetchers;
		const current = [...engines.values()].filter(matchesTab);
		// Tier is part of the identity: moving an engine must not relabel its old observations.
		const historical = snapshots.filter((entry) => !engines.has(engineKey(entry)) && matchesTab(entry));
		const shown = [...current, ...historical].slice(0, MAX_ENGINES);
		const shownKeys = new Set(shown.map(engineKey));
		const append = (engine: EngineDescriptor, history: boolean) => {
			if (shownKeys.has(engineKey(engine))) lines.push(...this.engineLines(engine, stats.get(engineKey(engine)), history));
		};
		let policy: SearchPolicy | undefined;
		if (fetchers) {
			lines.push(t.bold(`Current fetchers · ${current.length}`));
			if (current.length === 0) lines.push(t.fg("dim", "No current fetchers configured; health unknown."));
			for (const engine of current) append(engine, false);
		} else {
			policy = this.deps.policy();
			lines.push(t.fg("accent", `Default auto: n=${policy.defaultResultCount} (max ${policy.maximumResultCount}) · Main ${policy.main.mode} · combine ${policy.main.combineForced ? "true (forced)" : "false"} · configured combine mode ${policy.main.combineMode}`));
			lines.push(t.fg("dim", policy.main.combineForced
				? "Per-call count may override the default; configured combine=true cannot be disabled by a call."
				: "Per-call count/combine may override these defaults; combine=true uses the configured combine mode."));
			lines.push(t.fg("dim", "Attempts may use cached results; viewing this snapshot runs no discovery or provider probes."));
			for (const tier of ["main", "fallback", "native"] as const) {
				const group = current.filter((engine) => engine.tier === tier);
				const title = tier === "main" ? "Main" : tier === "fallback" ? "Fallback" : "Native";
				lines.push(t.bold(`${title} · ${tier === "native" ? policy.native.engineCount : group.length} current`));
				if (tier === "main") lines.push(...this.mainRules(policy, group.length));
				else if (tier === "fallback") lines.push(t.fg("dim", "Always attempted alongside valid automatic search; does not wait for Main failure or consume Main slots."));
				else lines.push(t.fg("dim", `Always attempted alongside valid automatic search; no Main slots. Each requests n results; deadline ${duration(policy.native.timeoutMs)} + ${duration(policy.native.settlementGraceMs)} cancellation/usage-settlement grace.`));
				if (group.length === 0) lines.push(t.fg("dim", `No current ${title} engines configured.`));
				for (const engine of group) {
					append(engine, false);
					if (tier === "fallback" && shownKeys.has(engineKey(engine))) {
						const limits = policy.fallback.find((entry) => entry.backend === engine.name);
						lines.push(t.fg("dim", limits ? `  default request/local cap ${limits.maxResults} results · deadline ${duration(limits.timeoutMs)}` : "  default cap/deadline unavailable"));
					}
				}
			}
		}
		if (historical.length > 0) {
			lines.push(t.bold("Previously observed · not currently configured in this tier"));
			for (const engine of historical) append(engine, true);
		}
		if (current.length + historical.length > MAX_ENGINES) lines.push(t.fg("dim", `[${current.length + historical.length - MAX_ENGINES} more engines omitted]`));
		if (policy) lines.push(...this.aggregationRules(policy));
		return lines;
	}

	private content(width: number): string[] {
		const w = Math.max(1, Math.floor(width));
		const lines = this.tab === TEST_TAB ? this.testLines(w) : this.engineContent();
		return lines.flatMap((line) => wrapTextWithAnsi(line, w)).map((line) => truncateToWidth(line, w, ""));
	}

	private renderParts(width: number): PanelParts {
		const w = Math.max(1, Math.floor(width));
		const t = this.deps.theme;
		this.renderedWidth = w;
		const hints = [
			{ key: "Tab/Shift+Tab", action: "tabs" },
			...(this.tab === TEST_TAB ? [{ key: "enter", action: "search" }] : []),
			{ key: "↑↓ Ctrl+PgUp/PgDn", action: "scroll" },
			{ key: "Ctrl+C", action: "cancel" }, { key: "esc", action: "close" },
		];
		const title = frameTitle(t, w, { title: "websearch", tabs: { labels: TAB_LABELS, active: this.tab } }, "none");
		this.tabSpans = title.tabSpans;
		return {
			header: [title.line, ...(this.tab === TEST_TAB ? this.input.render(w) : [])],
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
		else if (this.tab === TEST_TAB) {
			// Home/End and ordinary characters belong to the query editor, not pane commands.
			this.input.handleInput(data);
			const value = this.input.getValue();
			// Input accepts raw bracketed paste; sanitize before it can reach the terminal.
			const safe = plain(value).replace(/\n/g, " ").slice(0, MAX_QUERY_CHARS);
			if (safe !== value) this.input.setValue(safe);
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
