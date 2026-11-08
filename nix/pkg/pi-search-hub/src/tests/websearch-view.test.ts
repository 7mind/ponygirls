import { describe, expect, it, vi } from "vitest";
import { CURSOR_MARKER, Text, VStack, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { PLAIN_THEME } from "@ponygirls/pi-ui";
import { SearchMonitor, type EngineDescriptor } from "../extensions/search-monitor.js";
import { WebSearchView, type WebSearchViewDeps } from "../extensions/websearch-view.js";
import type { SearchViewProfile } from "../extensions/search-profile.js";
import type { SearchPolicy } from "../extensions/search-policy.js";

// Specified Behavioral-Active × Blackbox × Group: real shared layout/Input, controlled search callback.
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
const esc = "\x1b";
const tab = "\t";
const backTab = "\x1b[Z";
const down = "\x1b[B";
const up = "\x1b[A";
const pageDown = "\x1b[6~";
const pageUp = "\x1b[5~";
const end = "\x1b[1;5F";
const home = "\x1b[1;5H";
const engine: EngineDescriptor = { name: "fixture", label: "Fixture", tier: "main", availability: "configured" };
function fakePolicy(main: Partial<SearchPolicy["main"]>, rest: Partial<Omit<SearchPolicy, "main">>): SearchPolicy {
	return {
		defaultResultCount: 10, maximumResultCount: 20,
		main: { mode: "first", combineForced: false, combineMode: "all", selectionStrategy: "sequential", engineOrder: ["fixture"], targetUsableEngines: 3, requestedPerEngine: 20, ...main },
		sources: [{ name: "fixture", timeoutMs: 30000, maxResults: 20, boost: 1 }], fallback: [], native: { engineCount: 0, timeoutMs: 45_000, settlementGraceMs: 1_000 }, fusion: { rankConstant: 60, rerank: "rrf", titleWeight: .2, bodyWeight: .1, exactTitle: true },
		execution: { maxConcurrent: 6, perProvider: 2, overallTimeoutMs: 60_000, sourceTimeoutMs: 30_000, discoveryTimeoutMs: 10_000 }, ...rest,
	};
}
type TestOverrides = Partial<WebSearchViewDeps & SearchViewProfile>;
function setup(overrides: TestOverrides = {}) {
	const web: SearchViewProfile = { monitor: new SearchMonitor(() => 0), engines: () => [engine], policy: () => fakePolicy({}, {}), search: vi.fn(async () => "fixture result") };
	for (const key of ["monitor", "engines", "policy", "search"] as const) if (overrides[key]) Object.assign(web, { [key]: overrides[key] });
	const papers: SearchViewProfile = { monitor: new SearchMonitor(() => 0), engines: () => [{ name: "arxiv", label: "ArXiv", tier: "main" }], policy: () => fakePolicy({}, {}), search: vi.fn(async () => "paper result") };
	const deps = {
		theme: PLAIN_THEME, keys: { matches: () => false }, rows: () => 20, requestRender: vi.fn(), close: vi.fn(), ...overrides, profiles: overrides.profiles ?? { web, papers }, ...web,
	};
	return { deps, view: new WebSearchView(deps) };
}
function setupTest(overrides: TestOverrides = {}) {
	const fixture = setup(overrides);
	for (let n = 0; n < 3; n++) fixture.view.handleInput(tab);
	return fixture;
}
/** Navigate real public tab events, without depending on old three-tab adjacency. */
function select(view: WebSearchView, label: string, width = 100): void {
	for (let n = 0; n < 5; n++) {
		const title = view.render(width)[0];
		// Mouse uses the rendered title's measured spans.
		const x = title.indexOf(label);
		if (x >= 0) { view.handleMouse({ type: "click", button: "left", x, y: 0, screenX: x, screenY: 0, width, height: 20, shift: false, alt: false, ctrl: false }); return; }
		view.handleInput(tab);
	}
	throw new Error(`Tab missing: ${label}`);
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

/** Reach content through public navigation, retaining actual layout/geometry assertions. */
function scrollToText(view: WebSearchView, render: () => string[], text: string, direction: string): string[] {
	const maximumSteps = 600;
	for (let step = 0; step < maximumSteps; step++) {
		const lines = render();
		if (lines.join("\n").includes(text)) return lines;
		view.handleInput(direction);
	}
	throw new Error(`Did not reach ${text} through pane scrolling`);
}

describe("WebSearchView", () => {
	it("shows paper-specific policy without suggesting native model sources or discovery", () => {
		const { view } = setup({ rows: () => 200 });
		select(view, "Paper stats", 200);
		const text = view.render(200).join("\n");
		expect(text).toContain("Paper automatic search");
		expect(text).toContain("Always include");
		expect(text).not.toContain("Native ·");
		expect(text).not.toContain("discovery 10s");
		expect(text).not.toContain("combine mode");
		view.dispose();
	});
	it("explains first-nonempty defaults, overrides, shared weighted fusion and configured reranking", () => {
		const { deps, view } = setup({ rows: () => 100 });
		const text = view.render(200).join("\n");
		for (const rule of [
			"Default auto: n=10 (max 20) · Main first · combine false · configured combine mode all",
			"first non-empty response; errors and empty responses advance",
			"Default request: 20 candidates per Main engine; final n is applied only after fusion/reranking.",
			"Per-call count/combine may override these defaults", "combine=true uses the configured combine mode",
			"viewing this snapshot runs no provider probes",
			"score = Σ weight/(k + rank), k=60", "original unique-document ranks, one contribution per source/page",
			"Shared weighted RRF", "Source boosts and overlap policies apply before the final cut", "Attempts may use cached results",
			"URL/identifier lookup priority and provenance are preserved",
			"Reranking: rrf; lexical weights title=0.2, body=0.1; exact-title priority on",
			"no inherent tier bonus", "Fuse first, then cut to final n results",
			"Shared web/paper pool: max 6 requests, 2 per provider. Overall 60s; default source 30s; discovery 10s.",
			"Source deadlines include queue/rate waits",
			"Named backend calls isolate one engine but retain shared dedup/ranking and deadlines; no other tiers are added",
		]) expect(text).toContain(rule);
		expect(deps.search).not.toHaveBeenCalled();
		expect(deps.monitor.snapshot()).toEqual([]);
		view.dispose();
	});

	it("explains targeted non-empty slots and immediate failure/empty top-ups", () => {
		const { view } = setup({ rows: () => 100, policy: () => fakePolicy({ mode: "targeted", combineForced: true, combineMode: "targeted", requestedPerEngine: 20 }, {}) });
		const text = view.render(200).join("\n");
		for (const rule of ["Main targeted", "up to 3 non-empty Main responses", "replace failed/empty slots immediately without waiting for the slowest peer", "20 candidates per Main engine"]) expect(text).toContain(rule);
		expect(text).not.toContain("first successful response");
		view.dispose();
	});

	it("explains all-Main shared-pool scheduling and its default candidate request", () => {
		const engines: EngineDescriptor[] = ["one", "two", "three"].map((name) => ({ name, label: name, tier: "main" }));
		const { view } = setup({ rows: () => 100, engines: () => engines, policy: () => fakePolicy({ mode: "all", combineForced: true, requestedPerEngine: 20, engineOrder: engines.map(({ name }) => name) }, {}) });
		const text = view.render(200).join("\n");
		expect(text).toContain("Main · 3 current");
		expect(text).toContain("All: schedule every Main engine through the shared concurrency pool");
		expect(text).toContain("20 candidates per Main engine");
		expect(text).not.toMatch(/first successful response|up to 3 non-empty/);
		view.dispose();
	});

	it("states that configured combine is forced and cannot be disabled by a per-call override", () => {
		const { view } = setup({ rows: () => 100, policy: () => fakePolicy({ mode: "all", combineForced: true }, {}) });
		const text = view.render(200).join("\n");
		expect(text).toContain("combine true (forced)");
		expect(text).toContain("Per-call count may override the default");
		expect(text).toContain("configured combine=true cannot be disabled by a call");
		expect(text).not.toContain("Per-call count/combine may override");
		view.dispose();
	});

	it("reports invalid configured mode as rejected auto, not a silently working first/all mode", () => {
		const { deps, view } = setup({ rows: () => 100, policy: () => fakePolicy({ mode: "invalid", combineMode: "invalid", requestedPerEngine: null }, {}) });
		const text = view.render(200).join("\n");
		expect(text).toContain("Main invalid");
		expect(text).toContain("configured combine mode invalid");
		expect(text).toContain("automatic search is rejected before any tier is launched");
		expect(text).toContain("Default Main request unavailable while the mode is invalid");
		expect(text).not.toMatch(/First:|All:|Targeted:|Default request: 10/);
		expect(deps.search).not.toHaveBeenCalled();
		view.dispose();
	});

	it("reports unrecognized strategy's actual sequential fallback", () => {
		const { view } = setup({ rows: () => 100, policy: () => fakePolicy({ selectionStrategy: "unrecognized" }, {}) });
		expect(view.render(200).join("\n")).toContain("unrecognized strategy; actual fallback is sequential (configured order)");
		view.dispose();
	});

	it.each(["random", "round-robin", "best-latency"] as const)("shows configured preference, not a predicted %s next-query order, without sampling/rotating", (selectionStrategy) => {
		const policy = fakePolicy({ selectionStrategy, engineOrder: ["third", "first", "second"] }, {});
		const original = structuredClone(policy);
		const { deps, view } = setup({ rows: () => 100, policy: () => policy });
		const rng = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("render must not sample engine selection"); });
		try {
			const text = view.render(200).join("\n");
			expect(text).toContain(`Selection: ${selectionStrategy}; configured preference below is not a prediction of the next wave/order`);
			expect(text).toContain("Configured preference (before strategy): third → first → second");
			expect(view.render(200).join("\n")).toBe(text);
			expect(policy).toEqual(original);
			expect(rng).not.toHaveBeenCalled();
			expect(deps.search).not.toHaveBeenCalled();
		} finally { rng.mockRestore(); view.dispose(); }
	});

	it("groups current tiers with per-Fallback caps/deadlines and Native deadline/usage grace", () => {
		const engines: EngineDescriptor[] = [
			{ name: "fast", label: "Fast fallback", tier: "fallback" }, engine,
			{ name: "native:one", label: "Native one", tier: "native" },
			{ name: "broad", label: "Broad fallback", tier: "fallback" },
			{ name: "native:two", label: "Native two", tier: "native" },
		];
		const { view } = setup({ engines: () => engines, rows: () => 100, policy: () => fakePolicy({}, {
			fallback: [{ backend: "fast", timeoutMs: 7_000, maxResults: 2 }, { backend: "broad", timeoutMs: 2_500, maxResults: 14 }],
			native: { engineCount: 2, timeoutMs: 45_000, settlementGraceMs: 1_000 },
		}) });
		const text = view.render(200).join("\n");
		const main = text.indexOf("Main · 1 current"), fallback = text.indexOf("Always include · 2 current"), native = text.indexOf("Native · 2 current");
		expect(main).toBeGreaterThan(0); expect(fallback).toBeGreaterThan(main); expect(native).toBeGreaterThan(fallback);
		expect(text.indexOf("Fixture (fixture)")).toBeGreaterThan(main);
		expect(text.indexOf("Fixture (fixture)")).toBeLessThan(fallback);
		const fast = text.slice(text.indexOf("Fast fallback"), text.indexOf("Broad fallback"));
		expect(fast).toContain("default request/local cap 2 results · deadline 7s");
		expect(text.slice(text.indexOf("Broad fallback"), native)).toContain("default request/local cap 14 results · deadline 2.5s");
		expect(text).toContain("Always attempted alongside valid automatic search; does not wait for Main failure or consume Main slots");
		expect(text).toContain("Always attempted alongside valid automatic search; no Main slots");
		expect(text).toContain("deadline 45s + 1s cancellation/usage-settlement grace");
		view.dispose();
	});

	it("keeps no-Main defaults honest rather than inventing a per-engine request", () => {
		const { view } = setup({ engines: () => [], rows: () => 100, policy: () => fakePolicy({ mode: "all", combineForced: true, engineOrder: [], requestedPerEngine: null }, {}) });
		const text = view.render(200).join("\n");
		expect(text).toContain("Main · 0 current");
		expect(text).toContain("No Main engines configured; no Main requests");
		expect(text).toContain("Configured preference (before strategy): none");
		expect(text).not.toMatch(/Default request:|NaN|Infinity/);
		view.dispose();
	});

	it("separates moved-tier history from current engines and keeps the original tier's statistics", () => {
		const moved = { name: "moved", label: "Moved", tier: "fallback" as const, availability: "configured" as const };
		const { deps, view } = setup({ engines: () => [moved], rows: () => 100 });
		deps.monitor.begin({ ...moved, tier: "main" })({ status: "success", resultCount: 7 });
		deps.monitor.begin(moved)({ status: "empty" });
		const text = view.render(200).join("\n");
		const historical = text.indexOf("Previously observed · not currently configured in this tier");
		expect(text.slice(0, historical)).toContain("Moved (moved) · alwaysInclude · configured");
		expect(text.slice(0, historical)).toMatch(/0 +\| 0 +\| 1 +\|/);
		expect(text.slice(0, historical)).not.toMatch(/7 +\| 7/);
		expect(text.slice(historical)).toContain("Moved (moved) · main · historical (not current)");
		expect(text.slice(historical)).toMatch(/0 +\| 1 +\| 0 +\|/);
		expect(text.slice(historical)).toMatch(/7 +\| 7/);
		view.dispose();
	});

	it("plain-formats and bounds untrusted current/historical names and configured preferences", () => {
		const control = "\x1b]8;;https://fixture.invalid/\x07Visible\x1b]8;;\x07\x1b]52;c;PAYLOAD\x07\x1b[31mred\x1b[0m\n";
		const name = control + "X".repeat(1_000);
		const unsafe: EngineDescriptor = { name, label: control + "Y".repeat(1_000), tier: "fallback" };
		const { deps, view } = setup({ engines: () => [unsafe], rows: () => 500, policy: () => fakePolicy({ engineOrder: [name] }, { fallback: [{ backend: name, timeoutMs: 4_000, maxResults: 3 }] }) });
		deps.monitor.begin({ ...unsafe, name: "old" + name, tier: "main" })({ status: "empty" });
		const text = view.render(80).join("\n");
		expect(text).toContain("Visiblered");
		expect(text).toContain("default request/local cap 3 results · deadline 4s");
		expect(text).not.toMatch(/\x1b|PAYLOAD|https:\/\/fixture\.invalid|X{65}|Y{81}/);
		for (const width of [1, 4, 20, 40]) {
			const lines = view.render(width);
			expect(lines.length).toBeLessThanOrEqual(500);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		view.dispose();
	});

	it("keeps policy explanations on Search engines, not Fetchers or Test search", () => {
		const policy = vi.fn(() => fakePolicy({}, {}));
		const { view } = setup({ rows: () => 100, policy });
		const search = view.render(80).join("\n");
		expect(search).toContain("Aggregation · automatic search, all tiers");
		expect(search).toContain("Default auto");
		for (const [label, title] of [["Fetchers", "Fetcher activity"], ["Test web", "Enter a query above"]]) {
			select(view, label);
			policy.mockClear(); // Switching away measures the previous tab once to preserve its viewport.
			const text = view.render(80).join("\n");
			expect(text).toContain(title);
			expect(text).not.toMatch(/Default auto|Aggregation ·|Full-weight RRF|Configured preference|Main ·/);
			expect(policy).not.toHaveBeenCalled();
		}
		view.dispose();
	});

	it("retains the 64-engine display bound and bounds configured preference independently", () => {
		const engines: EngineDescriptor[] = Array.from({ length: 70 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n}`, tier: "main" }));
		// This inventory-bound assertion intentionally inspects the full 64-row model;
		// separate 80x24/120x40 tests below verify normal viewport clipping and scrolling.
		const { deps, view } = setup({ engines: () => engines, rows: () => 1000, policy: () => fakePolicy({ engineOrder: engines.map(({ name }) => name) }, {}) });
		deps.monitor.begin({ name: "old", label: "Old", tier: "main" })({ status: "empty" });
		const text = view.render(200).join("\n");
		expect(text).toContain("Main · 70 current");
		expect(text).toContain("Engine 63 (engine-63)");
		expect(text).not.toContain("Engine 64 (engine-64)");
		expect(text).not.toContain("Old (old)");
		expect(text).toContain("[7 more engines omitted]");
		expect(text).toContain("[more omitted]");
		view.dispose();
	});

	it("opens offline, reports unknown/not-attempted honestly, and repaints from observations", () => {
		const { deps, view } = setup({ engines: () => [engine, { name: "unused", label: "Unavailable", tier: "fallback", availability: "unavailable" }], rows: () => 60 });
		const initial = view.render(100).join("\n");
		expect(deps.search).not.toHaveBeenCalled();
		expect(initial).toContain("Fixture (fixture) · main · configured");
		expect(initial).toContain("not attempted · health unknown");
		expect(initial).toContain("unavailable");
		const finish = deps.monitor.begin(engine);
		expect(deps.requestRender).toHaveBeenCalled();
		expect(view.render(100).join("\n")).toMatch(/1 +\| 0 +\| 0/);
		finish({ status: "empty" });
		expect(view.render(100).join("\n")).toMatch(/0 +\| 0 +\| 1/);
		view.dispose();
	});

	it("segregates main/fallback/native search engines from reader fetchers, including historical tiers", () => {
		const reader: EngineDescriptor = { name: "shared", label: "Reader", tier: "reader" };
		const native: EngineDescriptor = { name: "native", label: "Native", tier: "native" };
		const fallback: EngineDescriptor = { name: "fallback", label: "Fallback", tier: "fallback" };
		const { deps, view } = setup({ engines: () => [engine, reader, native, fallback], rows: () => 100 });
		deps.monitor.begin({ name: "shared", label: "Historical search", tier: "main" })({ status: "success", resultCount: 3 });
		deps.monitor.begin({ name: "removed", label: "Historical reader", tier: "reader" })({ status: "empty" });
		deps.monitor.begin(reader)({ status: "failed" });
		const search = view.render(120).join("\n");
		expect(search).toContain("Search engine activity");
		for (const title of ["Fixture (fixture) · main", "Native (native) · native", "Fallback (fallback) · alwaysInclude", "Historical search (shared) · main · historical (not current)"]) expect(search).toContain(title);
		expect(search).toMatch(/3 +\| 3/);
		expect(search).not.toMatch(/Reader \(shared\)|Historical reader|· reader|Enter a query|> /);
		select(view, "Fetchers");
		const fetchers = view.render(120).join("\n");
		expect(fetchers).toContain("Fetcher activity");
		expect(fetchers).toContain("Reader (shared) · reader");
		expect(fetchers).toContain("Historical reader (removed) · reader · historical (not current)");
		expect(fetchers).toMatch(/0 +\| 0 +\| 0 +\| 1/);
		expect(fetchers).toMatch(/0 +\| 0 +\| 1/);
		expect(fetchers).not.toMatch(/Fixture \(fixture\)|Native \(native\)|Fallback \(fallback\)|Historical search|· main|· fallback|· native/);
		select(view, "Test web");
		const test = view.render(120).join("\n");
		expect(test).toContain("Enter a query above");
		expect(test).not.toMatch(/activity|Reader \(shared\)|Fixture \(fixture\)|Historical reader|Historical search/);
		expect(deps.search).not.toHaveBeenCalled();
		view.dispose();
	});

	it("cycles all five tabs in both directions and focuses only test query inputs", async () => {
		const { deps, view } = setup();
		view.focused = true;
		for (const label of ["Web stats", "Paper stats", "Fetchers", "Test web", "Test papers"]) {
			const text = view.render(100).join("\n");
			expect(text).toContain(label);
			expect(text.includes(CURSOR_MARKER)).toBe(label.startsWith("Test"));
			if (label === "Test web") view.handleInput("web draft");
			if (label === "Test papers") view.handleInput("paper draft");
			view.handleInput(tab);
		}
		view.handleInput(backTab);
		expect(view.render(100).join("\n")).toContain("paper draft");
		view.handleInput(backTab);
		expect(view.render(100).join("\n")).toContain("web draft");
		view.handleInput("\r"); await flush();
		expect(deps.search).toHaveBeenCalledExactlyOnceWith("web draft", expect.any(AbortSignal));
		view.focused = false;
		expect(view.render(100).join("\n")).not.toContain(CURSOR_MARKER);
		view.dispose();
	});

	it("keeps search running across tabs and does not reset the viewed statistics scroll on completion", async () => {
		const pending = deferred<string>();
		const engines: EngineDescriptor[] = Array.from({ length: 20 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n}`, tier: "main" }));
		const search = vi.fn((_query: string, _signal: AbortSignal) => pending.promise);
		const { deps, view } = setupTest({ search, engines: () => engines, rows: () => 10 });
		view.handleInput("working query"); view.handleInput("\r");
		select(view, "Web stats");
		view.render(100); view.handleInput(end);
		expect(view.render(100).join("\n")).toContain("Fuse first");
		const statistics = scrollToText(view, () => view.render(100), "Engine 19", up).join("\n");
		expect(search.mock.calls[0][1].aborted).toBe(false);
		pending.resolve("background result"); await flush();
		expect(view.render(100).join("\n")).toBe(statistics);
		select(view, "Test web");
		expect(view.render(100).join("\n")).toContain("working query");
		expect(view.render(100).join("\n")).toContain("background result");
		expect(deps.close).not.toHaveBeenCalled();
		view.dispose();
	});

	it("cancels owned work from the Fetchers tab without closing or accepting stale results", async () => {
		const pending = deferred<string>();
		const search = vi.fn((_query: string, _signal: AbortSignal) => pending.promise);
		const { deps, view } = setupTest({ search, keys: { matches: (data) => data === "\x03" } });
		view.handleInput("test"); view.handleInput("\r");
		view.handleInput(backTab);
		expect(view.render(100).join("\n")).toContain("Fetcher activity");
		view.handleInput("\x03");
		expect(search.mock.calls[0][1].aborted).toBe(true);
		expect(deps.close).not.toHaveBeenCalled();
		pending.resolve("stale result"); await flush();
		view.handleInput(tab);
		expect(view.render(100).join("\n")).toContain("Search cancelled.");
		expect(view.render(100).join("\n")).not.toContain("stale result");
		view.dispose();
	});

	it.each([0, 1, 2, 3, 4])("Escape closes and disposes in-flight work on tab %s", async (selected) => {
		const pending = deferred<string>();
		const search = vi.fn((_query: string, _signal: AbortSignal) => pending.promise);
		const { deps, view } = setupTest({ search });
		view.handleInput("test"); view.handleInput("\r");
		for (let n = 0; n < (selected + 5 - 3) % 5; n++) view.handleInput(tab);
		view.handleInput(esc);
		expect(search.mock.calls[0][1].aborted).toBe(true);
		expect(deps.close).toHaveBeenCalledTimes(1);
		vi.mocked(deps.requestRender).mockClear();
		pending.resolve("late result"); await flush();
		deps.monitor.begin(engine)({ status: "empty" });
		view.handleInput(tab);
		expect(deps.requestRender).not.toHaveBeenCalled();
	});

	it("edits queries using the real Input and displays direct results without closing", async () => {
		const { deps, view } = setupTest();
		view.focused = true;
		expect(view.focused).toBe(true);
		view.handleInput("query");
		view.handleInput("\x7f");
		view.handleInput("ies");
		view.handleInput("\r");
		await flush();
		expect(deps.search).toHaveBeenCalledWith("queries", expect.any(AbortSignal));
		expect(view.render(80).join("\n")).toContain("fixture result");
		expect(deps.close).not.toHaveBeenCalled();
		expect(deps.monitor.snapshot(), "only dispatch owns stats; pane must not double count").toEqual([]);
		view.dispose();
	});

	it("treats q, j, k and r as query characters, not accidental commands", async () => {
		const { deps, view } = setupTest();
		for (const key of ["q", "j", "k", "r"]) view.handleInput(key);
		view.handleInput("\r");
		await flush();
		expect(deps.search).toHaveBeenCalledWith("qjkr", expect.any(AbortSignal));
		expect(deps.close).not.toHaveBeenCalled();
		view.dispose();
	});

	it("ignores blank submission and duplicate Enter during an active search", async () => {
		const pending = deferred<string>();
		const { deps, view } = setupTest({ search: vi.fn(() => pending.promise) });
		view.handleInput("\r");
		expect(deps.search).not.toHaveBeenCalled();
		view.handleInput("test"); view.handleInput("\r"); view.handleInput("\r");
		expect(deps.search).toHaveBeenCalledTimes(1);
		expect(view.render(80).join("\n")).toContain("Searching…");
		pending.resolve("completed"); await flush();
		expect(view.render(80).join("\n")).toContain("completed");
		view.dispose();
	});

	it("shows only a generic failure, never raw native credentials, headers or terminal escapes", async () => {
		const { deps, view } = setupTest({ search: vi.fn(async () => { throw new Error("Authorization: Bearer fixture-secret https://fixture/?key=credential\x1b]52;c;PAYLOAD\x07"); }) });
		view.handleInput("test"); view.handleInput("\r"); await flush();
		const text = view.render(100).join("\n");
		expect(text).toContain("Search failed.");
		expect(text).not.toMatch(/fixture-secret|credential\b|Authorization|PAYLOAD/);
		expect(deps.close).not.toHaveBeenCalled();
		view.dispose();
	});

	it("bounds and sanitizes results and query paste, including hidden terminal hyperlinks", async () => {
		const text = "\x1b]8;;https://fixture.invalid/\x07label\x1b]8;;\x07\x1b[31mred\x1b[0m\x1b]52;c;PAYLOAD\x07\n" + "日本語 👩🏽‍💻 é ".repeat(3000);
		const { deps, view } = setupTest({ search: vi.fn(async () => text), rows: () => 500 });
		view.handleInput("\x1b[200~" + "q".repeat(3000) + "\x1b[201~");
		view.handleInput("\r"); await flush();
		const query = vi.mocked(deps.search).mock.calls[0][0];
		expect(query.length).toBe(2000);
		const lines = view.render(20);
		expect(lines.join("\n")).not.toMatch(/PAYLOAD|https:\/\/fixture.invalid|\x1b\]8|\x1b\]52|\x1b\[31m/);
		expect(lines.join("\n")).toContain("Result truncated");
		expect(lines.length).toBeLessThan(450);
		expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
		view.dispose();
	});

	// Regression: native Input preserves control sequences inside bracketed paste.
	it("sanitizes query paste before rendering or dispatch, not only result content", async () => {
		const { deps, view } = setupTest();
		view.handleInput("\x1b[200~query\x1b]52;c;PAYLOAD\x07\x1b[31mred\x1b[0m\x1b[201~");
		expect(view.render(80).join("\n")).not.toMatch(/PAYLOAD|\x1b\]52|\x1b\[31m/);
		view.handleInput("\r"); await flush();
		expect(deps.search).toHaveBeenCalledWith("queryred", expect.any(AbortSignal));
		view.dispose();
	});

	it("cancels an owned request, permits another query, and ignores stale completion", async () => {
		const old = deferred<string>();
		const fresh = deferred<string>();
		const search = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
		const { deps, view } = setupTest({ search, keys: { matches: (data) => data === "\x03" || data === esc } });
		view.handleInput("first"); view.handleInput("\r");
		const signal = search.mock.calls[0][1] as AbortSignal;
		view.handleInput("\x03");
		expect(signal.aborted).toBe(true);
		expect(deps.close).not.toHaveBeenCalled();
		expect(view.render(80).join("\n")).toContain("Search cancelled.");
		view.handleInput("\x15"); // Ctrl+U clears the query through Input.
		view.handleInput("second"); view.handleInput("\r");
		fresh.resolve("fresh result"); await flush();
		old.resolve("stale result"); await flush();
		const text = view.render(80).join("\n");
		expect(text).toContain("fresh result");
		expect(text).not.toContain("stale result");
		view.dispose();
	});

	it("disposes idempotently, aborts work, unsubscribes, and never repaints after late rejection", async () => {
		const pending = deferred<string>();
		const search = vi.fn((_query: string, _signal: AbortSignal) => pending.promise);
		const { deps, view } = setupTest({ search });
		view.handleInput("test"); view.handleInput("\r");
		const signal = search.mock.calls[0][1] as AbortSignal;
		view.dispose(); view.dispose();
		expect(signal.aborted).toBe(true);
		vi.mocked(deps.requestRender).mockClear();
		deps.monitor.begin(engine)({ status: "success", resultCount: 2 });
		pending.reject(new Error("late fixture-secret")); await flush();
		view.handleInput("\r");
		expect(deps.requestRender).not.toHaveBeenCalled();
		expect(search).toHaveBeenCalledTimes(1);
	});

	it("honors configured cancel, closing and aborting before the caller disposes", async () => {
		const pending = deferred<string>();
		const search = vi.fn((_query: string, _signal: AbortSignal) => pending.promise);
		const { deps, view } = setupTest({ search, keys: { matches: (data, action) => data === "custom-cancel" && action === "tui.select.cancel" } });
		view.handleInput("test"); view.handleInput("\r"); view.handleInput("custom-cancel");
		expect(deps.close).toHaveBeenCalledTimes(1);
		expect((search.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
		pending.resolve("late result"); await flush();
	});

	it("bounds regular layout at narrow widths, supports page/line scrolling and resize", () => {
		let rows = 10;
		const engines: EngineDescriptor[] = Array.from({ length: 20 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n} 日本語`, tier: "fallback" }));
		const { view } = setup({ engines: () => engines, rows: () => rows });
		for (const width of [1, 4, 20, 80]) {
			const lines = view.render(width);
			expect(lines.length).toBeLessThanOrEqual(rows);
			expect(lines.every((line) => visibleWidth(line) <= width), `width ${width}`).toBe(true);
		}
		view.handleInput(backTab);
		view.handleInput("👩🏽‍💻 日本語 é");
		for (const width of [1, 2, 3, 4, 5, 10]) {
			expect(view.render(width).every((line) => visibleWidth(line) <= width), `query width ${width}`).toBe(true);
		}
		select(view, "Web stats");
		const initial = view.render(100).join("\n");
		view.handleInput(down);
		expect(view.render(100).join("\n")).not.toBe(initial);
		view.handleInput(pageDown);
		expect(view.render(100).join("\n")).not.toBe(initial);
		const firstEngineAtViewportEdge = scrollToText(view, () => view.render(100), "Engine 0 ", down).join("\n");
		view.handleInput(pageDown);
		expect(view.render(100).join("\n")).not.toBe(firstEngineAtViewportEdge);
		// A row first visible at the bottom can remain at the top after one page.
		view.handleInput(pageDown);
		expect(view.render(100).join("\n")).not.toContain("Engine 0 ");
		view.handleInput(end);
		expect(view.render(100).join("\n")).toContain("Fuse first");
		expect(scrollToText(view, () => view.render(100), "Engine 19 ", up).join("\n")).toContain("Engine 19 ");
		rows = 15;
		expect(view.render(40).length).toBeLessThanOrEqual(rows);
		view.handleInput(home); view.handleInput(pageUp);
		expect(view.render(100).join("\n")).toContain("Default auto");
		expect(scrollToText(view, () => view.render(100), "Engine 0 ", down).join("\n")).toContain("Engine 0 ");
		view.handleInput(esc);
	});

	it("supports Ctrl+Page keys not reserved by Pi's fullscreen transcript", () => {
		const engines: EngineDescriptor[] = Array.from({ length: 20 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n}`, tier: "main" }));
		const { view } = setup({ engines: () => engines, rows: () => 10 });
		const initial = view.render(100).join("\n");
		view.handleInput("\x1b[6;5~");
		expect(view.render(100).join("\n")).not.toBe(initial);
		view.handleInput("\x1b[5;5~");
		expect(view.render(100).join("\n")).toBe(initial);
		view.dispose();
	});

	it("preserves tab chrome and scrolls all engine rows under structural allocation", () => {
		const engines: EngineDescriptor[] = Array.from({ length: 30 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n}`, tier: "fallback" }));
		const { view } = setup({ engines: () => engines });
		view.focused = true;
		const root = new VStack([
			{ component: new Text("transcript", 0, 0), shrink: 0 },
			{ component: view, grow: 1, shrink: 1 },
			{ component: new Text("bottom badge\nPi status", 0, 0), shrink: 0 },
		]);
		const frame = (width: number, height: number) => renderLayoutFrame(root, width, height, () => {}).lines;
		for (const [width, height] of [[80, 16], [40, 12], [100, 25]]) {
			let lines = frame(width, height);
			expect(lines.join("\n")).toContain("Tab/Shift+Tab tabs");
			expect(lines.join("\n")).toContain("esc close");
			expect(lines.at(-1)?.trimEnd()).toBe("Pi status");
			view.handleInput(end);
			lines = frame(width, height);
			expect(lines.join("\n")).toContain("Fuse first");
			lines = scrollToText(view, () => frame(width, height), "Engine 29", up);
			expect(lines.join("\n")).toContain("Engine 29");
			// Intrinsic measurement must not reset an allocated scroll position.
			view.render(40);
			expect(frame(width, height).join("\n")).toContain("Engine 29");
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		view.handleInput(home);
		expect(frame(80, 16).join("\n")).toContain("Default auto");
		expect(scrollToText(view, () => frame(80, 16), "Engine 0", down).join("\n")).toContain("Engine 0");
		view.dispose();
	});

	it("retains independent scroll positions on all five tabs", async () => {
		const engines: EngineDescriptor[] = ["main", "reader"].flatMap((tier) => Array.from({ length: 20 }, (_, n) => ({ name: `${tier}-${n}`, label: `${tier} ${n}`, tier: tier as "main" | "reader" })));
		const results = (domain: string) => Array.from({ length: 30 }, (_, n) => `${domain} result ${n}`).join("\n");
		const { deps, view } = setup({ engines: () => engines, rows: () => 12, search: async () => results("web") });
		deps.profiles.papers.engines = () => engines.filter(({ tier }) => tier === "main").map((entry) => ({ ...entry, name: `paper-${entry.name}`, label: `Paper ${entry.label}` }));
		deps.profiles.papers.search = async () => results("paper");
		const snapshots: string[] = [];
		for (let index = 0; index < 5; index++) {
			if (index >= 3) { view.handleInput(`query ${index}`); view.handleInput("\r"); await flush(); }
			view.render(100); view.handleInput(end);
			if (index < 2) scrollToText(view, () => view.render(100), "main 19", up);
			const text = view.render(100).join("\n");
			expect(text).toContain(index === 0 ? "main 19" : index === 1 ? "Paper main 19" : index === 2 ? "reader 19" : index === 3 ? "web result 29" : "paper result 29");
			snapshots.push(text);
			view.handleInput(tab);
		}
		for (const snapshot of snapshots) { expect(view.render(100).join("\n")).toBe(snapshot); view.handleInput(tab); }
		view.dispose();
	});

	it("keeps Test input, hints and all result rows through structural tab switches and resize", async () => {
		const engines: EngineDescriptor[] = Array.from({ length: 30 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n}`, tier: "main" }));
		const { view } = setupTest({ engines: () => engines, search: async () => Array.from({ length: 40 }, (_, n) => `result ${n}`).join("\n") });
		view.focused = true;
		view.handleInput("draft query"); view.handleInput("\r"); await flush();
		const root = new VStack([
			{ component: new Text("transcript", 0, 0), shrink: 0 },
			{ component: view, grow: 1, shrink: 1 },
			{ component: new Text("bottom badge\nPi status", 0, 0), shrink: 0 },
		]);
		const frame = (width: number, height: number) => renderLayoutFrame(root, width, height, () => {}).lines;
		for (const [width, height] of [[80, 16], [40, 12], [100, 25]]) {
			frame(width, height); view.handleInput(end);
			let lines = frame(width, height);
			for (const text of ["draft query", "result 39", "Tab/Shift+Tab tabs", "Ctrl+PgUp/PgDn", "Ctrl+C cancel", "esc close"]) expect(lines.join("\n")).toContain(text);
			expect(lines.at(-1)?.trimEnd()).toBe("Pi status");
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			view.handleInput(tab); view.handleInput(tab); frame(width, height); view.handleInput(end);
			expect(frame(width, height).join("\n")).toContain("Fuse first");
			expect(scrollToText(view, () => frame(width, height), "Engine 29", up).join("\n")).toContain("Engine 29");
			view.handleInput(backTab); view.handleInput(backTab);
			view.render(20); // Intrinsic sizing must not reset the allocated Test viewport.
			lines = frame(width, height);
			expect(lines.join("\n")).toContain("result 39");
			expect(lines.join("\n")).toContain("draft query");
		}
		view.dispose();
	});

	it("bounds all tabs at narrow regular sizes without dropping navigation hints at practical widths", () => {
		const { view } = setup({ engines: () => [engine, { name: "reader", label: "Reader 日本語", tier: "reader" }], rows: () => 12 });
		for (let selected = 0; selected < 5; selected++) {
			for (const width of [1, 2, 4, 20, 40, 80]) {
				const lines = view.render(width);
				expect(lines.length).toBeLessThanOrEqual(12);
				expect(lines.every((line) => visibleWidth(line) <= width), `tab ${selected}, width ${width}`).toBe(true);
				if (width >= 40) {
					for (const hint of ["Tab/Shift+Tab tabs", "Ctrl+PgUp/PgDn", "Ctrl+C cancel", "esc close"]) expect(lines.join("\n")).toContain(hint);
				}
			}
			view.handleInput(tab);
		}
		view.dispose();
	});

	it("switches tabs by shared title spans and ignores clipped tabs, other rows and non-left clicks", () => {
		const { deps, view } = setup();
		const mouse = (x: number, overrides: Partial<TuiMouseEvent> = {}): TuiMouseEvent => ({ type: "click", button: "left", x, y: 0, screenX: x, screenY: 0, width: 100, height: 20, shift: false, alt: false, ctrl: false, ...overrides });
		const title = view.render(100)[0];
		const fetcherX = title.indexOf("Fetchers");
		const testX = title.indexOf("Test web");
		expect(view.handleMouse(mouse(fetcherX))?.handled).toBe(true);
		expect(view.render(100).join("\n")).toContain("Fetcher activity");
		view.handleMouse(mouse(testX, { y: 1 }));
		view.handleMouse(mouse(testX, { button: "right" }));
		expect(view.render(100).join("\n")).toContain("Fetcher activity");
		view.render(40); // Test search is clipped; an old wide-span coordinate is not clickable.
		expect(view.handleMouse(mouse(testX, { width: 40 }))).toBeUndefined();
		view.render(100);
		expect(view.handleMouse(mouse(testX))?.handled).toBe(true);
		expect(view.render(100).join("\n")).toContain("Enter a query above");
		view.handleInput("query");
		view.render(100);
		view.handleMouse(mouse(title.indexOf("Web stats")));
		expect(view.render(100).join("\n")).toContain("Search engine activity");
		view.handleMouse(mouse(testX));
		expect(view.render(100).join("\n")).toContain("query");
		expect(deps.search).not.toHaveBeenCalled();
		view.dispose();
		expect(view.handleMouse(mouse(fetcherX))).toBeUndefined();
	});

	it("keeps historical observations visible but does not claim the removed engine is configured", () => {
		const { deps, view } = setup({ engines: () => [], rows: () => 100 });
		deps.monitor.begin(engine)({ status: "success" });
		const text = view.render(100).join("\n");
		expect(text).toContain("Fixture (fixture) · main · historical (not current)");
		expect(text).toContain("Previously observed · not currently configured in this tier");
		expect(text).not.toContain("Fixture (fixture) · main · configured");
		expect(text).toMatch(/unknown +\| 0 +\|/);
		view.dispose();
	});
	it("runs web and paper independently, preserves queries, and ignores duplicate submissions per domain", async () => {
		const web = deferred<string>();
		const paper = deferred<string>();
		const { deps, view } = setupTest({ search: vi.fn(() => web.promise) });
		const paperSearch = vi.fn((_query: string, _signal: AbortSignal) => paper.promise);
		deps.profiles.papers.search = paperSearch;
		view.focused = true;
		view.handleInput("web draft"); view.handleInput("\r"); view.handleInput("\r");
		view.handleInput(tab);
		view.handleInput("paper draft"); view.handleInput("\r"); view.handleInput("\r");
		expect(deps.search).toHaveBeenCalledTimes(1);
		expect(paperSearch).toHaveBeenCalledExactlyOnceWith("paper draft", expect.any(AbortSignal));
		web.resolve("web-only result"); await flush();
		const papers = view.render(80).join("\n");
		expect(papers).toContain("paper draft");
		expect(papers).toContain("Searching…");
		expect(papers).not.toContain("web-only result");
		view.handleInput(backTab);
		expect(view.render(80).join("\n")).toContain("web-only result");
		expect(view.render(80).join("\n")).toContain("web draft");
		paper.resolve("paper-only result"); await flush();
		expect(view.render(80).join("\n")).not.toContain("paper-only result");
		view.handleInput(tab);
		expect(view.render(80).join("\n")).toContain("paper-only result");
		expect(view.render(80).join("\n")).toContain("paper draft");
		view.dispose();
	});

	it.each(["cancel", "escape", "dispose"])("%s aborts both tests, unsubscribes on close, and rejects late domain completions", async (action) => {
		const web = deferred<string>();
		const paper = deferred<string>();
		const webSearch = vi.fn((_query: string, _signal: AbortSignal) => web.promise);
		const { deps, view } = setupTest({ search: webSearch });
		const paperSearch = vi.fn((_query: string, _signal: AbortSignal) => paper.promise);
		deps.profiles.papers.search = paperSearch;
		view.handleInput("web"); view.handleInput("\r");
		view.handleInput(tab); view.handleInput("papers"); view.handleInput("\r");
		select(view, "Paper stats");
		if (action === "dispose") view.dispose();
		else view.handleInput(action === "cancel" ? "\x03" : esc);
		expect(webSearch.mock.calls[0][1].aborted).toBe(true);
		expect(paperSearch.mock.calls[0][1].aborted).toBe(true);
		vi.mocked(deps.requestRender).mockClear();
		web.resolve("stale-web"); paper.reject(new Error("raw-secret")); await flush();
		expect(deps.requestRender).not.toHaveBeenCalled();
		if (action === "cancel") {
			select(view, "Test web");
			expect(view.render(80).join("\n")).toContain("Search cancelled.");
			select(view, "Test papers");
			expect(view.render(80).join("\n")).toContain("Search cancelled.");
			view.dispose();
		}
		vi.mocked(deps.requestRender).mockClear();
		deps.profiles.web.monitor.begin(engine)({ status: "success" });
		deps.profiles.papers.monitor.begin({ name: "arxiv", label: "ArXiv", tier: "main" })({ status: "timeout" });
		expect(deps.requestRender).not.toHaveBeenCalled();
	});

	it("shows paper monitor observations without issuing web or paper searches, and retains historical tiers", () => {
		const { deps, view } = setup({ rows: () => 100 });
		view.handleInput(tab);
		const paperEngine: EngineDescriptor = { name: "arxiv", label: "ArXiv 日本語", tier: "main" };
		deps.profiles.papers.monitor.begin(paperEngine)({ status: "timeout" });
		deps.profiles.papers.monitor.begin({ ...paperEngine, tier: "fallback" })({ status: "success", resultCount: 8 });
		expect(deps.requestRender).toHaveBeenCalled();
		const text = view.render(80).join("\n");
		expect(text).toContain("Paper automatic search");
		expect(text).toContain("timeout");
		expect(text).toContain("ArXiv 日本語 (arxiv) · alwaysInclude · historical (not current)");
		expect(text).toMatch(/8 +\| 8/);
		expect(text).not.toMatch(/combine|Fixture/);
		expect(deps.search).not.toHaveBeenCalled();
		expect(deps.profiles.papers.search).not.toHaveBeenCalled();
		view.handleInput(backTab);
		expect(view.render(80).join("\n")).not.toContain("ArXiv");
		expect(deps.monitor.snapshot()).toEqual([]);
		view.dispose();
	});

	it.each([80, 120])("aligns all counter/timing/config columns at %s cells with Unicode labels and honest unattempted values", (width) => {
		const { deps, view } = setup({ rows: () => 100, engines: () => [
			{ ...engine, label: "日本語 👩🏽‍💻 é" }, { name: "unused", label: "未使用", tier: "main" },
		] });
		deps.monitor.begin(engine)({ status: "success", resultCount: 7 });
		deps.monitor.begin(engine)({ status: "timeout" });
		const lines = view.render(width);
		const text = lines.join("\n");
		for (const key of ["active", "ok", "empty", "failed", "timeout", "cancelled", "last", "results last", "results total", "latency last", "latency total", "deadline ms", "candidate cap", "boost"]) expect(text).toContain(key);
		expect(text).toContain("not attempted · health unknown");
		expect(text).toContain("—");
		expect(text).toContain("30000");
		for (let index = 0; index < lines.length - 2; index++) {
			if (!lines[index + 1].includes("-+-")) continue;
			const boundaries = (line: string, separator: string) => [...line.matchAll(new RegExp(`\\${separator}`, "g"))].map((match) => visibleWidth(line.slice(0, match.index)));
			expect(boundaries(lines[index], "|")).toEqual(boundaries(lines[index + 1], "+"));
			expect(boundaries(lines[index], "|")).toEqual(boundaries(lines[index + 2], "|"));
		}
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		view.dispose();
	});

	it("uses narrow metric rows without silently dropping counters or truncating scalar policy values", () => {
		const { view } = setup({ rows: () => 500, policy: () => fakePolicy({}, { sources: [{ name: "fixture", timeoutMs: 123456789, maxResults: 987654321, boost: 12.3456789 }] }) });
		const text = view.render(40).join("\n");
		for (const key of ["active", "ok", "empty", "failed", "timeout", "cancelled", "last", "results last", "results total", "latency last", "latency total", "123456789", "987654321", "12.3456789"]) expect(text).toContain(key);
		for (let width = 1; width <= 45; width++) expect(view.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
		view.dispose();
	});

	it.each([[80, 24], [120, 40]])("retains all five tab labels, scrollable last rows and bounded chrome at %sx%s", (width, height) => {
		const engines: EngineDescriptor[] = Array.from({ length: 64 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n} 日本語`, tier: "main" }));
		const { view } = setup({ engines: () => engines, rows: () => height });
		const initial = view.render(width);
		for (const label of ["Web stats", "Paper stats", "Fetchers", "Test web", "Test papers"]) expect(initial[0]).toContain(label);
		expect(initial.length).toBeLessThanOrEqual(height);
		view.handleInput(end);
		expect(view.render(width).join("\n")).toContain("Fuse first");
		expect(scrollToText(view, () => view.render(width), "Engine 63", up).join("\n")).toContain("Engine 63");
		expect(view.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
		view.dispose();
	});

	it("uses all five measured mouse hit targets under fullscreen allocation", () => {
		const { view } = setup();
		view.focused = true;
		const root = new VStack([{ component: new Text("transcript", 0, 0), shrink: 0 }, { component: view, grow: 1, shrink: 1 }]);
		for (const label of ["Paper stats", "Fetchers", "Test web", "Test papers", "Web stats"]) {
			const lines = renderLayoutFrame(root, 80, 24, () => {}).lines;
			const title = lines[1];
			const x = visibleWidth(title.slice(0, title.indexOf(label)));
			expect(view.handleMouse({ type: "click", button: "left", x, y: 0, screenX: x, screenY: 1, width: 80, height: 23, shift: false, alt: false, ctrl: false })?.handled).toBe(true);
			const text = renderLayoutFrame(root, 80, 24, () => {}).lines.join("\n");
			expect(text.includes(CURSOR_MARKER)).toBe(label.startsWith("Test"));
			if (label === "Paper stats") expect(text).toContain("Paper automatic search");
			if (label === "Fetchers") expect(text).toContain("Fetcher activity");
		}
		view.dispose();
	});

	it("fuzzes all five narrow tab widths including focused Unicode query editors", () => {
		const { view } = setup({ rows: () => 24 });
		view.focused = true;
		for (let index = 0; index < 5; index++) {
			if (index >= 3) view.handleInput("日本語 👩🏽‍💻 é");
			for (let width = 1; width <= 80; width++) {
				const lines = view.render(width);
				expect(lines.length).toBeLessThanOrEqual(24);
				expect(lines.every((line) => visibleWidth(line) <= width), `tab ${index}, width ${width}`).toBe(true);
			}
			view.handleInput(tab);
		}
		view.dispose();
	});

	it.each([80, 120])("compares three sources as aligned rows with one outcome header per group at %s cells", (width) => {
		const engines: EngineDescriptor[] = ["native:model-alpha", "native:日本語モデル", "native:model-third"].map((name) => ({ name, label: `${name} 日本語`, tier: "native", availability: "configured" }));
		const { deps, view } = setup({ engines: () => engines, rows: () => 100, policy: () => fakePolicy({ engineOrder: [] }, { native: { engineCount: 3, timeoutMs: 45000, settlementGraceMs: 1000 } }) });
		deps.monitor.begin(engines[0])({ status: "success", resultCount: 9 });
		deps.monitor.begin(engines[1])({ status: "timeout" });
		const all = view.render(width);
		const lines = all.slice(all.findIndex((line) => line.includes("Native · 3 current")), all.findIndex((line) => line.includes("Aggregation ·")));
		const headers = lines.filter((line) => line.startsWith("Source") && line.includes(width === 80 ? "| Run" : "| active"));
		expect(headers).toHaveLength(1);
		const at = lines.indexOf(headers[0]);
		const rows = lines.slice(at + 2, at + 5);
		const boundaries = (line: string) => [...line.matchAll(/\|/g)].map((match) => visibleWidth(line.slice(0, match.index)));
		for (let n = 0; n < 3; n++) {
			expect(rows[n]).toContain(engines[n].name);
			expect(boundaries(rows[n])).toEqual(boundaries(headers[0]));
		}
		expect(rows[0]).toMatch(/0 +\| 1 +\| 0/);
		expect(rows[1]).toContain("timeout");
		expect(rows[2]).toContain("—");
		expect(lines.join("\n")).toContain("not attempted · health unknown");
		view.dispose();
	});

	it("falls back safely for oversized counters without clipping values or misaligning a comparative table", () => {
		const { deps, view } = setup({ rows: () => 100 });
		deps.monitor.begin(engine)({ status: "success", resultCount: Number.MAX_SAFE_INTEGER });
		const snapshot = deps.monitor.snapshot()[0];
		vi.spyOn(deps.monitor, "snapshot").mockReturnValue([{ ...snapshot, ongoing: Number.MAX_SAFE_INTEGER, success: Number.MAX_SAFE_INTEGER, empty: Number.MAX_SAFE_INTEGER, failed: Number.MAX_SAFE_INTEGER, timeout: Number.MAX_SAFE_INTEGER, cancelled: Number.MAX_SAFE_INTEGER }]);
		const lines = view.render(80);
		const text = lines.join("\n");
		expect(text).toContain("Source: fixture");
		expect(text.match(/9007199254740991/g)?.length).toBeGreaterThanOrEqual(6);
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
		view.dispose();
	});

});
