import { stripVTControlCharacters } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { CURSOR_MARKER, Text, VStack, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PLAIN_THEME } from "@ponygirls/pi-ui";
import searchHub from "../extensions/search-hub.js";
import { SearchMonitor, type EngineDescriptor, type SearchOutcome } from "../extensions/search-monitor.js";
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
const policyKey = "?";
const STATS_HINTS = "tab next tab  ↑↓ scroll  PgUp/PgDn page  ? policy and legend  esc close";
const POLICY_HINTS = "↑↓ scroll  PgUp/PgDn page  esc back";
/** Every column while no source has a cancelled operation. */
const ALL_COLUMNS = ["SOURCE", "TIER", "ACTIVE", "OK", "EMPTY", "FAILED", "TIMEOUT", "LAST", "RESULTS", "LATENCY", "DEADLINE", "CAP"];
const DROP_ORDER = ["CAP", "DEADLINE", "LATENCY", "RESULTS", "EMPTY", "TIMEOUT"];
const KEPT_COLUMNS = ["SOURCE", "TIER", "ACTIVE", "OK", "FAILED", "LAST"];
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
/** The four sources of the specified target screen: brave and searxng observed, exa and the native model never attempted. */
function targetScreen(overrides: TestOverrides) {
	const names = ["exa", "brave", "searxng", "native:openai"];
	const engines: EngineDescriptor[] = names.map((name) => ({ name, label: name, tier: name === "searxng" ? "fallback" : name.startsWith("native:") ? "native" : "main", availability: "configured" }));
	let now = 0;
	const monitor = new SearchMonitor(() => now);
	const observe = (target: EngineDescriptor, outcome: SearchOutcome, elapsedMs: number) => {
		const finish = monitor.begin(target);
		now += elapsedMs;
		finish(outcome);
	};
	const [, brave, searxng] = engines;
	observe(brave, { status: "timeout" }, 30_000);
	for (let n = 0; n < 2; n++) observe(brave, { status: "empty" }, 400);
	for (let n = 0; n < 13; n++) observe(brave, { status: "success", resultCount: n === 0 ? 2 : 10 }, 700);
	observe(brave, { status: "success", resultCount: 9 }, 800);
	monitor.begin(brave);
	for (let n = 0; n < 16; n++) observe(searxng, { status: "success", resultCount: 3 }, 900);
	observe(searxng, { status: "failed" }, 1_234);
	const policy = fakePolicy({ mode: "targeted", combineForced: true, combineMode: "targeted", engineOrder: ["exa", "brave"] }, {
		sources: names.map((name) => ({ name, timeoutMs: name.startsWith("native:") ? 45_000 : 30_000, maxResults: 20, boost: 1 })),
		fallback: [{ backend: "searxng", timeoutMs: 3_000, maxResults: 3 }], native: { engineCount: 1, timeoutMs: 45_000, settlementGraceMs: 1_000 },
	});
	return setup({ rows: () => 40, monitor, engines: () => engines, policy: () => policy, ...overrides });
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

interface Cell { text: string; start: number; end: number }
/** Cells of one table line in terminal columns; a cell holds single spaces only, cells are two or more apart. */
function cellsOf(line: string): Cell[] {
	return [...line.matchAll(/\S+(?: \S+)*/g)].map((match) => {
		const start = visibleWidth(line.slice(0, match.index));
		return { text: match[0], start, end: start + visibleWidth(match[0]) };
	});
}
/** The one statistics table of a rendered stats tab: its header and every source row below it. */
function tableOf(lines: string[]) {
	const plainLines = lines.map(stripVTControlCharacters);
	const headerAt = plainLines.findIndex((line) => line.trimStart().startsWith("SOURCE"));
	if (headerAt < 0) throw new Error(`No statistics table in:\n${plainLines.join("\n")}`);
	const footerAt = plainLines.findIndex((line, index) => index > headerAt && line.startsWith("─"));
	const header = cellsOf(plainLines[headerAt]);
	const rows = plainLines.slice(headerAt + 1, footerAt < 0 ? plainLines.length : footerAt).map(cellsOf).filter((cells) => cells.length === header.length);
	const columns = header.map(({ text }) => text);
	const records = rows.map((cells) => Object.fromEntries(cells.map((cell, index) => [columns[index], cell.text])));
	return { header, rows, columns, records, headerLines: plainLines.filter((line) => line.trimStart().startsWith("SOURCE")).length };
}
const LEFT_ALIGNED = new Set(["SOURCE", "TIER", "LAST"]);
/** Text columns start under their header; numbers end under it (CAP: the cap, a boost trails it). */
function expectAligned(table: ReturnType<typeof tableOf>): void {
	expect(table.rows.length).toBeGreaterThan(0);
	for (const row of table.rows) row.forEach((cell, index) => {
		const head = table.header[index];
		if (LEFT_ALIGNED.has(head.text)) expect(cell.start, `${head.text} of ${row[0].text}`).toBe(head.start);
		else if (head.text === "CAP") expect(cell.start + visibleWidth(cell.text.split(" ")[0]), `CAP of ${row[0].text}`).toBe(head.end);
		else expect(cell.end, `${head.text} of ${row[0].text}`).toBe(head.end);
	});
}
/** Columns named on the "hidden at this width" note, which itself wraps at narrow widths. */
function hiddenColumns(lines: string[]): string[] {
	const note = /hidden at this width: ([A-Z]+(?:, [A-Z]+)*)/.exec(lines.map(stripVTControlCharacters).join(" ").replace(/\s+/g, " "));
	return note === null ? [] : note[1].split(", ");
}
/** The policy-and-legend view of the current statistics tab; leaves the pane back on its table. */
function policyOf(view: WebSearchView, width: number): string {
	view.handleInput(policyKey);
	const text = view.render(width).join("\n");
	view.handleInput(policyKey);
	return text;
}

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
		expect(tableOf(view.render(200)).records.map((row) => row.TIER)).toEqual(["main"]);
		const text = policyOf(view, 200);
		expect(text).toContain("Paper automatic search");
		expect(text).toContain("Always include policy");
		expect(text).not.toContain("Native policy");
		expect(text).not.toContain("discovery 10s");
		expect(text).not.toContain("combine mode");
		view.dispose();
	});
	it("explains first-nonempty defaults, overrides, shared weighted fusion and configured reranking", () => {
		const { deps, view } = setup({ rows: () => 100 });
		const text = policyOf(view, 200);
		for (const rule of [
			"Search engine activity (this extension instance)",
			"Configured unless marked [unknown/unavailable]. Active = dispatched logical ops, not queue/connections.",
			"Default auto: n=10 (max 20) · Main first · combine false · configured combine mode all",
			"first non-empty response; errors/empty advance",
			"Default: 20 candidates per Main engine; final n after fusion/reranking.",
			"Per-call count/combine may override", "combine=true uses configured mode",
			"Snapshot: no provider probes",
			"score = Σ weight/(k + rank), k=60", "original unique-document ranks, one contribution per source/page",
			"Shared weighted RRF", "Boosts/overlap before final cut", "attempts may be cached",
			"URL/identifier lookup priority and provenance preserved",
			"Reranking: rrf; lexical weights title=0.2, body=0.1; exact-title priority on",
			"no inherent tier bonus", "Fuse first, then cut to final n results",
			"Pool web+paper: 6 concurrent/2 per provider; overall 60s; default source 30s; discovery 10s.",
			"Deadlines include queue/rate waits",
			"Named calls: one engine, shared dedup/ranking/deadlines; no other tiers",
		]) expect(text.replace(/\s+/g, " ")).toContain(rule);
		expect(deps.search).not.toHaveBeenCalled();
		expect(deps.monitor.snapshot()).toEqual([]);
		view.dispose();
	});

	it("explains targeted non-empty slots and immediate failure/empty top-ups", () => {
		const { view } = setup({ rows: () => 100, policy: () => fakePolicy({ mode: "targeted", combineForced: true, combineMode: "targeted", requestedPerEngine: 20 }, {}) });
		const text = policyOf(view, 200);
		for (const rule of ["Main targeted", "up to 3 non-empty Main responses", "replace failed/empty slots immediately without waiting for the slowest peer", "20 candidates per Main engine"]) expect(text.replace(/\s+/g, " ")).toContain(rule);
		expect(text).not.toContain("first successful response");
		view.dispose();
	});

	it("explains all-Main shared-pool scheduling and its default candidate request", () => {
		const engines: EngineDescriptor[] = ["one", "two", "three"].map((name) => ({ name, label: name, tier: "main" }));
		const { view } = setup({ rows: () => 100, engines: () => engines, policy: () => fakePolicy({ mode: "all", combineForced: true, requestedPerEngine: 20, engineOrder: engines.map(({ name }) => name) }, {}) });
		const text = policyOf(view, 200);
		expect(text).toContain("Main policy · 3 current");
		expect(text).toContain("All: schedule every Main engine through the shared concurrency pool");
		expect(text).toContain("20 candidates per Main engine");
		expect(text).not.toMatch(/first successful response|up to 3 non-empty/);
		view.dispose();
	});

	it("states that configured combine is forced and cannot be disabled by a per-call override", () => {
		const { view } = setup({ rows: () => 100, policy: () => fakePolicy({ mode: "all", combineForced: true }, {}) });
		const text = policyOf(view, 200);
		expect(text).toContain("combine true (forced)");
		expect(text).toContain("Per-call count may override");
		expect(text).toContain("forced combine=true cannot be disabled");
		expect(text).not.toContain("Per-call count/combine may override");
		view.dispose();
	});

	it("reports invalid configured mode as rejected auto, not a silently working first/all mode", () => {
		const { deps, view } = setup({ rows: () => 100, policy: () => fakePolicy({ mode: "invalid", combineMode: "invalid", requestedPerEngine: null }, {}) });
		expect(view.render(200)[0]).toContain("1 source · invalid, n=10");
		const text = policyOf(view, 200);
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
		expect(policyOf(view, 200)).toContain("unrecognized strategy; actual fallback is sequential (configured order)");
		view.dispose();
	});

	it.each(["random", "round-robin", "best-latency"] as const)("shows configured preference, not a predicted %s next-query order, without sampling/rotating", (selectionStrategy) => {
		const policy = fakePolicy({ selectionStrategy, engineOrder: ["third", "first", "second"] }, {});
		const original = structuredClone(policy);
		const { deps, view } = setup({ rows: () => 100, policy: () => policy });
		const rng = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("render must not sample engine selection"); });
		try {
			const text = policyOf(view, 200);
			expect(text).toContain(`Selection: ${selectionStrategy}; preference is not a prediction of next wave/order`);
			expect(text).toContain("Preference (before strategy): third → first → second");
			expect(policyOf(view, 200)).toBe(text);
			expect(policy).toEqual(original);
			expect(rng).not.toHaveBeenCalled();
			expect(deps.search).not.toHaveBeenCalled();
		} finally { rng.mockRestore(); view.dispose(); }
	});

	it("orders one table by tier then configured order, with per-Fallback caps/deadlines and Native deadline/usage grace", () => {
		const engines: EngineDescriptor[] = [
			{ name: "fast", label: "fast", tier: "fallback" }, engine,
			{ name: "native:one", label: "Native one", tier: "native" },
			{ name: "broad", label: "broad", tier: "fallback" },
			{ name: "native:two", label: "Native two", tier: "native" },
		];
		const { view } = setup({ engines: () => engines, rows: () => 100, policy: () => fakePolicy({}, {
			fallback: [{ backend: "fast", timeoutMs: 7_000, maxResults: 2 }, { backend: "broad", timeoutMs: 2_500, maxResults: 14 }],
			native: { engineCount: 2, timeoutMs: 45_000, settlementGraceMs: 1_000 },
		}) });
		const table = tableOf(view.render(200));
		expect(table.headerLines).toBe(1);
		expect(table.records.map((row) => [row.SOURCE, row.TIER, row.DEADLINE, row.CAP])).toEqual([
			["fixture", "main", "30 s", "20"],
			["fast [unknown]", "always", "7 s", "2 ×?"],
			["broad [unknown]", "always", "2.5 s", "14 ×?"],
			["native:one [unknown]", "native", "·", "·"],
			["native:two [unknown]", "native", "·", "·"],
		]);
		expectAligned(table);
		expect(view.render(200)[0]).toContain("5 sources · first, n=10");
		const text = policyOf(view, 200);
		const main = text.indexOf("Main policy · 1 current"), fallback = text.indexOf("Always include policy · 2 current"), native = text.indexOf("Native policy · 2 current");
		expect(main).toBeGreaterThan(0); expect(fallback).toBeGreaterThan(main); expect(native).toBeGreaterThan(fallback);
		expect(text).toContain("Always alongside valid auto; no Main-failure wait or Main slots");
		expect(text).toContain("Always alongside valid auto; no Main slots");
		expect(text).toContain("deadline 45s + 1s cancellation/usage-settlement grace");
		view.dispose();
	});

	it("keeps no-Main defaults honest rather than inventing a per-engine request", () => {
		const { view } = setup({ engines: () => [], rows: () => 100, policy: () => fakePolicy({ mode: "all", combineForced: true, engineOrder: [], requestedPerEngine: null }, {}) });
		const empty = view.render(200).join("\n");
		expect(empty).toContain("No web search sources configured. /search-setup adds one.");
		expect(empty).toContain("0 sources · all, n=10");
		expect(empty).not.toContain("SOURCE");
		const text = policyOf(view, 200);
		expect(text).toContain("Main policy · 0 current");
		for (const tier of ["Main", "Always include", "Native"]) expect(text).toContain(`No current ${tier} engines configured.`);
		expect(text).toContain("No Main engines configured; no Main requests");
		expect(text).toContain("Preference (before strategy): none");
		expect(text).not.toMatch(/Default request:|NaN|Infinity/);
		view.dispose();
	});

	it("separates moved-tier history from current engines and keeps the original tier's statistics", () => {
		const moved = { name: "moved", label: "Moved", tier: "fallback" as const, availability: "configured" as const };
		const { deps, view } = setup({ engines: () => [moved], rows: () => 100 });
		deps.monitor.begin({ ...moved, tier: "main" })({ status: "success", resultCount: 7 });
		deps.monitor.begin(moved)({ status: "empty" });
		const lines = view.render(200);
		const historical = lines.findIndex((line) => line.includes("Previously observed · not currently configured in this tier"));
		const table = tableOf(lines);
		expect(table.headerLines).toBe(1);
		expect(table.records.map((row) => [row.SOURCE, row.TIER, row.ACTIVE, row.OK, row.EMPTY, row.LAST, row.RESULTS])).toEqual([
			["moved", "always", "·", "·", "1", "empty", "·"],
			["moved", "main", "·", "1", "·", "ok", "7 / 7"],
		]);
		expect(lines.findIndex((line) => line.includes("always"))).toBeLessThan(historical);
		expect(lines.findIndex((line) => line.includes("7 / 7"))).toBeGreaterThan(historical);
		view.dispose();
	});

	it("plain-formats and bounds untrusted current/historical names and configured preferences", () => {
		const control = "\x1b]8;;https://fixture.invalid/\x07Visible\x1b]8;;\x07\x1b]52;c;PAYLOAD\x07\x1b[31mred\x1b[0m\n";
		const name = control + "X".repeat(1_000);
		const unsafe: EngineDescriptor = { name, label: control + "Y".repeat(1_000), tier: "fallback" };
		const { deps, view } = setup({ engines: () => [unsafe], rows: () => 500, policy: () => fakePolicy({ engineOrder: [name] }, { fallback: [{ backend: name, timeoutMs: 4_000, maxResults: 3 }] }) });
		deps.monitor.begin({ ...unsafe, name: "old" + name, tier: "main" })({ status: "empty" });
		for (const text of [view.render(80).join("\n"), view.render(300).join("\n"), policyOf(view, 80)]) {
			expect(text).toContain("Visiblered");
			expect(text).not.toMatch(/\x1b|PAYLOAD|https:\/\/fixture\.invalid|X{65}|Y{81}/);
		}
		const wide = tableOf(view.render(300));
		expect(wide.records.map((row) => [row.SOURCE.length, row.TIER, row.DEADLINE, row.CAP])).toEqual([[64 + " [unknown]".length, "always", "4 s", "3 ×?"], [64, "main", "·", "·"]]);
		for (const open of [false, true]) {
			if (open) view.handleInput(policyKey);
			for (const width of [1, 4, 20, 40]) {
				const lines = view.render(width);
				expect(lines.length).toBeLessThanOrEqual(500);
				expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			}
		}
		view.dispose();
	});

	it("keeps policy explanations on Search engines, not Fetchers or Test search", () => {
		const policy = vi.fn(() => fakePolicy({}, {}));
		const { view } = setup({ rows: () => 100, policy });
		const table = view.render(80).join("\n");
		expect(table).not.toMatch(/Default auto|Aggregation ·|Legend ·|policy ·|Pool web\+paper|Deadlines include/);
		const search = policyOf(view, 80);
		expect(search).toContain("Aggregation · automatic search, all tiers");
		expect(search).toContain("Default auto");
		for (const [label, title] of [["Fetchers", "Fetcher activity"], ["Test web", "Enter a query above"]]) {
			select(view, label);
			policy.mockClear(); // Switching away measures the previous tab once to preserve its viewport.
			const text = view.render(80).join("\n");
			expect(text).toContain(title);
			expect(text).not.toMatch(/Default auto|Aggregation ·|Full-weight RRF|Configured preference|Main ·|policy and legend/);
			if (label === "Fetchers") {
				// The policy view belongs to the statistics tabs only.
				view.handleInput(policyKey);
				expect(view.render(80).join("\n")).toBe(text);
			}
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
		const lines = view.render(200);
		const text = lines.join("\n");
		expect(lines[0]).toContain("70 sources · first, n=10");
		expect(tableOf(lines).rows).toHaveLength(64);
		expect(text).toContain("engine-63");
		expect(text).not.toContain("engine-64");
		expect(text).not.toContain("old");
		expect(text).toContain("[7 more engines omitted]");
		const policy = policyOf(view, 200);
		expect(policy).toContain("Main policy · 70 current");
		expect(policy).toContain("[more omitted]");
		view.dispose();
	});

	it("opens offline, reports unknown/not-attempted honestly, and repaints from observations", () => {
		const { deps, view } = setup({ engines: () => [engine, { name: "unused", label: "Unavailable", tier: "fallback", availability: "unavailable" }], rows: () => 60 });
		const counters = () => tableOf(view.render(100)).records.map((row) => [row.SOURCE, row.ACTIVE, row.OK, row.EMPTY, row.FAILED, row.TIMEOUT, row.LAST]);
		expect(deps.search).not.toHaveBeenCalled();
		expect(counters()).toEqual([["fixture", "·", "·", "·", "·", "·", "never"], ["unused [unavailable]", "·", "·", "·", "·", "·", "never"]]);
		expect(policyOf(view, 100)).toContain("LAST never = no completed operation · health unknown");
		const finish = deps.monitor.begin(engine);
		expect(deps.requestRender).toHaveBeenCalled();
		expect(counters()[0]).toEqual(["fixture", "1", "·", "·", "·", "·", "never"]);
		finish({ status: "empty" });
		expect(counters()[0]).toEqual(["fixture", "·", "·", "1", "·", "·", "empty"]);
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
		expect(tableOf(view.render(120)).records.map((row) => [row.SOURCE, row.TIER, row.RESULTS])).toEqual([
			["fixture", "main", "·"], ["fallback [unknown]", "always", "·"], ["native [unknown]", "native", "·"], ["shared", "main", "3 / 3"],
		]);
		expect(search).not.toMatch(/removed|reader|Fetcher activity|Enter a query|> /);
		select(view, "Fetchers");
		const fetchers = view.render(120).join("\n");
		expect(fetchers).toContain("Fetcher activity");
		expect(fetchers).toContain("shared");
		expect(fetchers).toContain("removed · reader");
		expect(fetchers).toContain("historical (not current)");
		expect(fetchers).toMatch(/0(?: +\| |\/)0(?: +\| |\/)0(?: +\| |\/)1/);
		expect(fetchers).toMatch(/0(?: +\| |\/)0(?: +\| |\/)1/);
		expect(fetchers).not.toMatch(/fixture|· main|· fallback|· native/);
		select(view, "Test web");
		const test = view.render(120).join("\n");
		expect(test).toContain("Enter a query above");
		expect(test).not.toMatch(/activity|fixture|removed|shared/);
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
		const statistics = view.render(100).join("\n");
		expect(statistics).toContain("engine-19");
		expect(statistics).not.toContain("engine-0 ");
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
		expect(initial).toContain("engine-0 ");
		expect(initial).not.toContain("engine-19");
		view.handleInput(down);
		const lineDown = view.render(100).join("\n");
		expect(lineDown).not.toBe(initial);
		expect(lineDown).toContain("engine-1 ");
		view.handleInput(pageDown);
		const pageDownOnce = view.render(100).join("\n");
		expect(pageDownOnce).not.toBe(lineDown);
		expect(pageDownOnce).not.toContain("engine-1 ");
		view.handleInput(end);
		expect(view.render(100).join("\n")).toContain("engine-19");
		expect(scrollToText(view, () => view.render(100), "engine-10", up).join("\n")).toContain("engine-10");
		rows = 15;
		expect(view.render(40).length).toBeLessThanOrEqual(rows);
		view.handleInput(home); view.handleInput(pageUp);
		expect(view.render(100).join("\n")).toContain("engine-0 ");
		expect(scrollToText(view, () => view.render(100), "engine-19", down).join("\n")).toContain("engine-19");
		view.handleInput(esc);
	});

	it("keeps Ctrl+PgUp/PgDn bound as paging aliases", () => {
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
			view.handleInput(home);
			let lines = frame(width, height);
			expect(lines.join("\n")).toContain("tab next tab");
			expect(lines.join("\n")).toContain("esc close");
			expect(lines.join("\n")).toContain("engine-0 ");
			expect(lines.join("\n")).not.toContain("engine-29");
			expect(lines.at(-1)?.trimEnd()).toBe("Pi status");
			view.handleInput(end);
			lines = frame(width, height);
			expect(lines.join("\n")).toContain("engine-29");
			expect(lines.join("\n")).not.toContain("engine-0 ");
			// Intrinsic measurement must not reset an allocated scroll position.
			view.render(40);
			expect(frame(width, height).join("\n")).toContain("engine-29");
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		view.handleInput(home);
		expect(frame(80, 16).join("\n")).toContain("engine-0 ");
		expect(scrollToText(view, () => frame(80, 16), "engine-29", down).join("\n")).toContain("engine-29");
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
			if (index < 2) scrollToText(view, () => view.render(100), "main-19", up);
			const text = view.render(100).join("\n");
			expect(text).toContain(index === 0 ? "main-19" : index === 1 ? "paper-main-19" : index === 2 ? "reader-19" : index === 3 ? "web result 29" : "paper result 29");
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
			for (const text of ["draft query", "result 39", "tab next tab", "⏎ search", "↑↓ scroll", "PgUp/PgDn page", "^C cancel test", "esc close"]) expect(lines.join("\n")).toContain(text);
			expect(lines.at(-1)?.trimEnd()).toBe("Pi status");
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			view.handleInput(tab); view.handleInput(tab); frame(width, height); view.handleInput(end);
			expect(frame(width, height).join("\n")).toContain("engine-29");
			expect(frame(width, height).join("\n")).not.toContain("engine-0 ");
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
					const own = selected < 2 ? ["? policy and legend"] : selected === 2 ? ["^C cancel test"] : ["⏎ search", "^C cancel test"];
					for (const hint of ["tab next tab", "↑↓ scroll", "PgUp/PgDn page", ...own, "esc close"]) expect(lines.join("\n"), `tab ${selected}, width ${width}`).toContain(hint);
					expect(lines.join("\n")).not.toMatch(/Shift\+Tab|Ctrl\+/);
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
		expect(tableOf(view.render(100)).records.map((row) => row.SOURCE)).toEqual(["fixture"]);
		// The policy view is one level below its tab: it has no tab strip to click.
		view.handleInput(policyKey);
		expect(view.render(100)[0]).not.toContain("Fetchers");
		expect(view.handleMouse(mouse(fetcherX))).toBeUndefined();
		view.handleInput(policyKey);
		view.render(100);
		view.handleMouse(mouse(testX));
		expect(view.render(100).join("\n")).toContain("query");
		expect(deps.search).not.toHaveBeenCalled();
		view.dispose();
		expect(view.handleMouse(mouse(fetcherX))).toBeUndefined();
	});

	it("keeps historical observations visible but does not claim the removed engine is configured", () => {
		const { deps, view } = setup({ engines: () => [], rows: () => 100 });
		deps.monitor.begin(engine)({ status: "success" });
		const lines = view.render(100);
		const text = lines.join("\n");
		const historical = lines.findIndex((line) => line.includes("Previously observed · not currently configured in this tier"));
		expect(historical).toBeGreaterThan(0);
		expect(lines.findIndex((line) => line.includes("fixture"))).toBeGreaterThan(historical);
		expect(text).not.toMatch(/fixture.*configured/);
		// A success whose source reported no count is not shown as zero results.
		expect(tableOf(lines).records).toEqual([expect.objectContaining({ SOURCE: "fixture", TIER: "main", OK: "1", LAST: "ok", RESULTS: "?", DEADLINE: "·", CAP: "·" })]);
		expect(policyOf(view, 200)).toContain("? = not reported");
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
		const lines = view.render(80);
		const historical = lines.findIndex((line) => line.includes("Previously observed · not currently configured in this tier"));
		expect(tableOf(lines).records).toEqual([
			expect.objectContaining({ SOURCE: "arxiv [unknown]", TIER: "main", TIMEOUT: "1", LAST: "timeout", RESULTS: "·" }),
			expect.objectContaining({ SOURCE: "arxiv", TIER: "always", OK: "1", LAST: "ok", RESULTS: "8 / 8" }),
		]);
		expect(historical).toBeGreaterThan(lines.findIndex((line) => line.includes("arxiv [unknown]")));
		expect(lines.findIndex((line) => line.includes("8 / 8"))).toBeGreaterThan(historical);
		const policy = policyOf(view, 80);
		expect(policy).toContain("Paper automatic search");
		expect(lines.join("\n") + policy).not.toMatch(/combine|Fixture/);
		expect(deps.search).not.toHaveBeenCalled();
		expect(deps.profiles.papers.search).not.toHaveBeenCalled();
		view.handleInput(backTab);
		expect(view.render(80).join("\n")).not.toContain("ArXiv");
		expect(deps.monitor.snapshot()).toEqual([]);
		view.dispose();
	});

	it("renders the target statistics screen at 120 columns: title summary, one word-headed table, rule and hints", () => {
		const { deps, view } = targetScreen({});
		expect(view.render(120)).toEqual([
			"── Web search   Web stats   Paper stats   Fetchers   Test web   Test papers  ───────────── 4 sources · targeted, n=10 ──",
			"  SOURCE         TIER    ACTIVE  OK  EMPTY  FAILED  TIMEOUT  LAST    RESULTS  LATENCY  DEADLINE  CAP",
			"  exa            main         ·   ·      ·       ·        ·  never         ·        ·      30 s   20",
			"  brave          main         1  14      2       ·        1  ok      9 / 131    0.8 s      30 s   20",
			"  searxng        always       ·  16      ·       1        ·  failed   · / 48    1.2 s       3 s    3",
			"  native:openai  native       ·   ·      ·       ·        ·  never         ·        ·      45 s   20",
			"─".repeat(120),
			STATS_HINTS,
		]);
		expect(deps.search).not.toHaveBeenCalled();
		view.dispose();
	});

	it("puts the essentials on the title's right while all five tabs still fit, else on a line of their own", () => {
		const { view } = targetScreen({});
		for (const width of [120, 170]) {
			const lines = view.render(width);
			expect(lines[0]).toMatch(/^── Web search   Web stats   Paper stats   Fetchers   Test web   Test papers  ─+ 4 sources · targeted, n=10 ──$/);
			expect(visibleWidth(lines[0])).toBe(width);
			expect(lines[1].trimStart().startsWith("SOURCE")).toBe(true);
		}
		for (const width of [60, 80, 100]) {
			const lines = view.render(width);
			if (width >= 80) for (const label of ["Web stats", "Paper stats", "Fetchers", "Test web", "Test papers"]) expect(lines[0]).toContain(label);
			expect(lines[0]).not.toContain("sources");
			expect(lines[1]).toBe("  4 sources · targeted, n=10");
			expect(lines[2].trimStart().startsWith("SOURCE")).toBe(true);
		}
		view.dispose();
	});

	it.each([80, 100, 120, 170])("aligns word-headed counter/timing/config columns at %s cells with Unicode names and honest unattempted values", (width) => {
		const wide: EngineDescriptor = { name: "native:日本語モデル", label: "日本語 モデル", tier: "native", availability: "configured" };
		const { deps, view } = setup({ rows: () => 100, engines: () => [engine, { name: "unused", label: "未使用", tier: "main" }, wide] });
		deps.monitor.begin(engine)({ status: "success", resultCount: 7 });
		deps.monitor.begin(engine)({ status: "timeout" });
		deps.monitor.begin(wide)({ status: "success", resultCount: 1234 });
		const lines = view.render(width);
		const table = tableOf(lines);
		expect(table.headerLines).toBe(1);
		expectAligned(table);
		const hidden = hiddenColumns(lines);
		expect(hidden).toEqual(DROP_ORDER.slice(0, hidden.length));
		expect(table.columns).toEqual(ALL_COLUMNS.filter((name) => !hidden.includes(name)));
		expect(table.records.map((row) => [row.SOURCE, row.TIER, row.ACTIVE, row.OK, row.FAILED, row.LAST])).toEqual([
			["fixture", "main", "·", "1", "·", "timeout"], ["unused [unknown]", "main", "·", "·", "·", "never"], ["native:日本語モデル", "native", "·", "1", "·", "ok"],
		]);
		if (!hidden.includes("RESULTS")) expect(table.records.map((row) => row.RESULTS)).toEqual(["· / 7", "·", "1,234 / 1,234"]);
		if (!hidden.includes("DEADLINE")) expect(table.records.map((row) => row.DEADLINE)).toEqual(["30 s", "·", "·"]);
		// The old grid, abbreviations, placeholders and raw milliseconds are gone.
		expect(lines.join("\n")).not.toMatch(/\||-\+-|—|Ø|l\/Σ|ms\/cap|30000|…/);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		view.dispose();
	});

	it("drops columns in the stated order, names them on a dim line and never clips a cell", () => {
		const fg = vi.fn(PLAIN_THEME.fg);
		const { view } = targetScreen({ theme: { ...PLAIN_THEME, fg } });
		const steps: string[][] = [];
		// Per step: the table's own width, and the narrowest pane it was still used in.
		const natural: number[] = [];
		const narrowest: number[] = [];
		let narrowestTable = Infinity;
		for (let width = 170; width >= 1; width--) {
			const lines = view.render(width);
			expect(lines.every((line) => visibleWidth(line) <= width), `width ${width}`).toBe(true);
			if (!lines.some((line) => line.trimStart().startsWith("SOURCE"))) break;
			narrowestTable = width;
			const hidden = hiddenColumns(lines);
			expect(hidden, `width ${width}`).toEqual(DROP_ORDER.slice(0, hidden.length));
			const table = tableOf(lines);
			expect(table.columns, `width ${width}`).toEqual(ALL_COLUMNS.filter((name) => !hidden.includes(name)));
			expect(table.columns, `width ${width}`).toEqual(expect.arrayContaining(KEPT_COLUMNS));
			expect(table.records.map((row) => row.SOURCE), `width ${width}`).toEqual(["exa", "brave", "searxng", "native:openai"]);
			expect(table.records.map((row) => row.LAST), `width ${width}`).toEqual(["never", "ok", "failed", "never"]);
			expectAligned(table);
			// The title may shorten its tab strip; no table cell or note is ever cut.
			expect(lines.slice(1).join("\n"), `width ${width}`).not.toContain("…");
			if (steps.length === 0 || steps.at(-1)!.length !== hidden.length) steps.push(hidden);
			natural[hidden.length] = Math.max(...[table.header, ...table.rows].map((cells) => cells.at(-1)!.end));
			narrowest[hidden.length] = width;
		}
		// A column goes only when the table no longer fits: each layout is used down to exactly its own width.
		expect(narrowest).toEqual(natural);
		expect(natural).toEqual([100, 95, 85, 76, 67, 60, 51]);
		// Each step of the drop order is taken one column at a time, and the table survives at 60 columns.
		expect(steps).toEqual([[], ...DROP_ORDER.map((_, index) => DROP_ORDER.slice(0, index + 1))]);
		expect(narrowestTable).toBeLessThanOrEqual(60);
		expect(hiddenColumns(view.render(100))).toEqual([]);
		expect(view.render(99).at(-3)).toBe("  hidden at this width: CAP");
		expect(fg.mock.calls).toContainEqual(["dim", "hidden at this width: CAP"]);
		view.dispose();
	});

	it("lists the never-dropped facts as wrapped records when even those columns cannot fit", () => {
		const { deps, view } = setup({ rows: () => 500, policy: () => fakePolicy({}, { sources: [{ name: "fixture", timeoutMs: 123456789, maxResults: 987654321, boost: 12.3456789 }] }) });
		deps.monitor.begin(engine)({ status: "failed" });
		deps.monitor.begin(engine)({ status: "success", resultCount: 4 });
		deps.monitor.begin(engine);
		const lines = view.render(40);
		const text = lines.join("\n").replace(/\s+/g, " ");
		expect(text).toContain("fixture · main · active 1 · ok 1 · failed 1 · last ok");
		expect(lines.slice(1).join("\n")).not.toMatch(/SOURCE|…/);
		expect(hiddenColumns(lines)).toEqual(DROP_ORDER);
		for (let width = 1; width <= 45; width++) expect(view.render(width).every((line) => visibleWidth(line) <= width), `width ${width}`).toBe(true);
		expect(tableOf(view.render(200)).records).toEqual([expect.objectContaining({ DEADLINE: "123456.789 s", CAP: "987,654,321 ×12.3456789" })]);
		view.dispose();
	});

	it("shows zero as a dim dot and colours the last outcome by state", () => {
		const outcomes = ["success", "empty", "failed", "timeout", "cancelled"] as const;
		const engines: EngineDescriptor[] = [
			...outcomes.map((name): EngineDescriptor => ({ name, label: name, tier: "main", availability: "configured" })),
			{ name: "idle", label: "idle", tier: "main", availability: "unavailable" }, { name: "busy", label: "busy", tier: "main", availability: "unknown" },
		];
		const fg = vi.fn(PLAIN_THEME.fg);
		const { deps, view } = setup({ rows: () => 100, theme: { ...PLAIN_THEME, fg }, engines: () => engines });
		// A distinct count per outcome ties each colour to its own column: success 2, empty 3, failed 4, timeout 5, cancelled 6, active 7.
		outcomes.forEach((status, index) => { for (let n = 0; n < index + 2; n++) deps.monitor.begin(engines[index])({ status }); });
		for (let n = 0; n < 7; n++) deps.monitor.begin(engines[6]);
		const table = tableOf(view.render(200));
		expect(table.records.map((row) => [row.SOURCE, row.ACTIVE, row.OK, row.EMPTY, row.FAILED, row.TIMEOUT, row.CANCELLED, row.LAST])).toEqual([
			["success", "·", "2", "·", "·", "·", "·", "ok"], ["empty", "·", "·", "3", "·", "·", "·", "empty"], ["failed", "·", "·", "·", "4", "·", "·", "failed"],
			["timeout", "·", "·", "·", "·", "5", "·", "timeout"], ["cancelled", "·", "·", "·", "·", "·", "6", "cancelled"],
			["idle [unavailable]", "·", "·", "·", "·", "·", "·", "never"], ["busy [unknown]", "7", "·", "·", "·", "·", "·", "never"],
		]);
		expect(table.records[5]).toEqual({ SOURCE: "idle [unavailable]", TIER: "main", ACTIVE: "·", OK: "·", EMPTY: "·", FAILED: "·", TIMEOUT: "·", CANCELLED: "·", LAST: "never", RESULTS: "·", LATENCY: "·", DEADLINE: "·", CAP: "·" });
		for (const call of [
			["success", "ok"], ["warning", "empty"], ["error", "failed"], ["warning", "timeout"], ["muted", "cancelled"], ["dim", "never"],
			["success", "2"], ["warning", "3"], ["error", "4"], ["warning", "5"], ["muted", "6"], ["accent", "7"],
			["error", " [unavailable]"], ["muted", " [unknown]"],
		]) expect(fg.mock.calls).toContainEqual(call);
		// Zero is never coloured: every "·" is dim.
		expect(fg.mock.calls.filter(([, text]) => text.trim() === "·").every(([color]) => color === "dim")).toBe(true);
		expect(fg.mock.calls.some(([color, text]) => color === "dim" && text.trimStart().startsWith("SOURCE"))).toBe(true);
		view.dispose();
	});

	it("adds a CANCELLED column only while some source has cancelled operations", () => {
		const other: EngineDescriptor = { name: "other", label: "Other", tier: "main", availability: "configured" };
		const { deps, view } = setup({ rows: () => 100, engines: () => [engine, other] });
		deps.monitor.begin(engine)({ status: "success", resultCount: 2 });
		expect(tableOf(view.render(200)).columns).toEqual(ALL_COLUMNS);
		deps.monitor.begin(other)({ status: "cancelled" });
		const table = tableOf(view.render(200));
		expect(table.columns).toEqual(["SOURCE", "TIER", "ACTIVE", "OK", "EMPTY", "FAILED", "TIMEOUT", "CANCELLED", "LAST", "RESULTS", "LATENCY", "DEADLINE", "CAP"]);
		expect(table.records.map((row) => [row.SOURCE, row.CANCELLED, row.LAST])).toEqual([["fixture", "·", "ok"], ["other", "1", "cancelled"]]);
		expectAligned(table);
		view.dispose();
	});

	it("appends a boost other than 1 to the candidate cap and keeps the caps aligned", () => {
		const sources = [{ name: "plain", timeoutMs: 30_000, maxResults: 20, boost: 1 }, { name: "boosted", timeoutMs: 30_000, maxResults: 20, boost: 1.5 }, { name: "damped", timeoutMs: 2_500, maxResults: 3, boost: 0.5 }];
		const engines: EngineDescriptor[] = sources.map(({ name }) => ({ name, label: name, tier: "main", availability: "configured" }));
		const { view } = setup({ rows: () => 100, engines: () => engines, policy: () => fakePolicy({ engineOrder: engines.map(({ name }) => name) }, { sources }) });
		const table = tableOf(view.render(200));
		expect(table.records.map((row) => [row.SOURCE, row.DEADLINE, row.CAP])).toEqual([["plain", "30 s", "20"], ["boosted", "30 s", "20 ×1.5"], ["damped", "2.5 s", "3 ×0.5"]]);
		expectAligned(table);
		view.dispose();
	});

	it("gives an always-include source its own deadline and cap with the boost of its source entry", () => {
		const engines: EngineDescriptor[] = ["weighted", "unweighted", "unlisted"].map((name) => ({ name, label: name, tier: "fallback", availability: "configured" }));
		const { view } = setup({ rows: () => 100, engines: () => engines, policy: () => fakePolicy({ engineOrder: [] }, {
			sources: [{ name: "weighted", timeoutMs: 30_000, maxResults: 20, boost: 2 }, { name: "unweighted", timeoutMs: 30_000, maxResults: 20, boost: 1 }],
			fallback: [{ backend: "weighted", timeoutMs: 5_000, maxResults: 5 }, { backend: "unweighted", timeoutMs: 4_000, maxResults: 4 }, { backend: "unlisted", timeoutMs: 3_000, maxResults: 3 }],
		}) });
		const table = tableOf(view.render(200));
		// An unknown boost is not presented as boost 1.
		expect(table.records.map((row) => [row.SOURCE, row.TIER, row.DEADLINE, row.CAP])).toEqual([["weighted", "always", "5 s", "5 ×2"], ["unweighted", "always", "4 s", "4"], ["unlisted", "always", "3 s", "3 ×?"]]);
		expectAligned(table);
		view.dispose();
	});

	it("keeps a record that fits the pane on one line", () => {
		const long: EngineDescriptor = { name: "native:some-long-model-name-xx", label: "Long", tier: "native", availability: "configured" };
		const { view } = setup({ rows: () => 100, engines: () => [long] });
		const record = "  native:some-long-model-name-xx · native · never";
		expect(view.render(visibleWidth(record)).slice(2, 3)).toEqual([record]);
		expect(view.render(visibleWidth(record) - 1).slice(2, 4)).toEqual(["  native:some-long-model-name-xx · native ·", "    never"]);
		view.dispose();
	});

	it("opens, scrolls and leaves the policy view under structural allocation, restoring the table's position", () => {
		const engines: EngineDescriptor[] = Array.from({ length: 30 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n}`, tier: "main" }));
		const { deps, view } = setup({ engines: () => engines });
		view.focused = true;
		const root = new VStack([
			{ component: new Text("transcript", 0, 0), shrink: 0 },
			{ component: view, grow: 1, shrink: 1 },
			{ component: new Text("bottom badge\nPi status", 0, 0), shrink: 0 },
		]);
		const frame = (width: number, height: number) => renderLayoutFrame(root, width, height, () => {}).lines;
		for (const [width, height] of [[80, 16], [100, 25], [60, 14]]) {
			frame(width, height); view.handleInput(home); view.handleInput(end);
			const table = frame(width, height);
			expect(table.join("\n")).toContain("engine-29");
			expect(table.join("\n")).not.toContain("engine-0 ");
			view.handleInput(policyKey);
			let lines = frame(width, height);
			// The policy view has a one-line header and opens at its top, whatever the table's offset was.
			expect(lines[1]).toContain("Web stats · policy and legend");
			expect(lines[2]).toBe("Search engine activity (this extension instance)");
			expect(lines.join("\n")).toContain("esc back");
			expect(lines.join("\n")).not.toMatch(/engine-29|Fuse first/);
			expect(lines.at(-1)?.trimEnd()).toBe("Pi status");
			view.handleInput(end);
			lines = frame(width, height);
			expect(lines.join("\n").replace(/\s+/g, " ")).toContain("Named calls: one engine, shared dedup/ranking/deadlines; no other tiers.");
			expect(lines.join("\n")).not.toContain("Search engine activity");
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			view.render(40); // Intrinsic measurement must not reset the allocated policy viewport.
			expect(frame(width, height)).toEqual(lines);
			view.handleInput(esc);
			expect(deps.close).not.toHaveBeenCalled();
			expect(frame(width, height)).toEqual(table);
		}
		view.dispose();
	});

	it("says how to get sources when a profile has none", () => {
		const { deps, view } = setup({ engines: () => [], rows: () => 30 });
		deps.profiles.papers.engines = () => [];
		expect(view.render(100).slice(1, -2)).toEqual(["  0 sources · first, n=10", "  No web search sources configured. /search-setup adds one."]);
		view.handleInput(tab);
		expect(view.render(100).slice(1, -2)).toEqual(["  0 sources · first, n=10", "  No paper sources configured. /search-setup enables the backends they use."]);
		view.dispose();
	});

	it("moves all policy and legend text behind ? and returns to the table with ? or esc without closing", () => {
		const { deps, view } = targetScreen({});
		const table = view.render(120);
		view.handleInput(policyKey);
		const policy = view.render(120);
		expect(policy[0]).toMatch(/^── Web search · Web stats · policy and legend ─+$/);
		expect(visibleWidth(policy[0])).toBe(120);
		expect(policy.slice(-2)).toEqual(["─".repeat(120), POLICY_HINTS]);
		expect(policy.slice(1, -2).join(" ").replace(/\s+/g, " ")).toBe([
			"Search engine activity (this extension instance)",
			"Default auto: n=10 (max 20) · Main targeted · combine true (forced) · configured combine mode targeted",
			"Pool web+paper: 6 concurrent/2 per provider; overall 60s; default source 30s; discovery 10s.",
			"Legend · policy",
			"Configured unless marked [unknown/unavailable]. Active = dispatched logical ops, not queue/connections.",
			"LAST never = no completed operation · health unknown; DEADLINE/CAP · = unavailable.",
			"RESULTS = last / total; LATENCY = last completed operation; CAP = candidate cap, ×n = boost; ? = not reported.",
			"Per-call count may override; forced combine=true cannot be disabled.",
			"Deadlines include queue/rate waits; attempts may be cached. Snapshot: no provider probes.",
			"Main policy · 2 current",
			"Targeted: up to 3 non-empty Main responses; replace failed/empty slots immediately without waiting for the slowest peer. Default: 20 candidates per Main engine; final n after fusion/reranking.",
			"Selection: sequential (configured order). Preference (before strategy): exa → brave.",
			"Always include policy · 1 current",
			"Always alongside valid auto; no Main-failure wait or Main slots. Cap = default request/local cap.",
			"Native policy · 1 current",
			"Always alongside valid auto; no Main slots. Configured candidate budget each; deadline 45s + 1s cancellation/usage-settlement grace.",
			"Aggregation · automatic search, all tiers",
			"Shared weighted RRF: score = Σ weight/(k + rank), k=60; original unique-document ranks, one contribution per source/page. Boosts/overlap before final cut; no inherent tier bonus. Reranking: rrf; lexical weights title=0.2, body=0.1; exact-title priority on. URL/identifier lookup priority and provenance preserved.",
			"Fuse first, then cut to final n results (default n=10). Named calls: one engine, shared dedup/ranking/deadlines; no other tiers.",
		].join(" "));
		expect(policy.join("\n")).not.toMatch(/SOURCE|searxng|Act\/OK|Res l\/Σ|ms\/cap/);
		view.handleInput(esc);
		expect(deps.close).not.toHaveBeenCalled();
		expect(view.render(120)).toEqual(table);
		view.handleInput(policyKey); view.handleInput(policyKey);
		expect(view.render(120)).toEqual(table);
		view.handleInput(esc);
		expect(deps.close).toHaveBeenCalledTimes(1);
	});

	it("separates the policy sections with one blank line each", () => {
		const { view } = targetScreen({});
		view.handleInput(policyKey);
		const body = view.render(170).slice(1, -2);
		const headings = ["Search engine activity (this extension instance)", "Legend · policy", "Main policy · 2 current", "Always include policy · 1 current", "Native policy · 1 current", "Aggregation · automatic search, all tiers"];
		expect(body.filter((line) => line === "")).toHaveLength(headings.length - 1);
		expect(body[0]).toBe(headings[0]);
		for (const heading of headings.slice(1)) expect(body[body.indexOf(heading) - 1], heading).toBe("");
		view.dispose();
	});

	it.each([["a CSI-u key", "\x1b[63u"], ["a shifted CSI-u key", "\x1b[63;2u"], ["a CSI-u shifted slash", "\x1b[47:63;2u"], ["an xterm modifyOtherKeys key", "\x1b[27;2;63~"]])("opens the policy view when the terminal reports ? as %s", (_form, sequence) => {
		const { view } = setup();
		view.handleInput(sequence);
		expect(view.render(100).at(-1)).toBe(POLICY_HINTS);
		view.handleInput(sequence);
		expect(view.render(100).at(-1)).toBe(STATS_HINTS);
		view.dispose();
	});

	it("wraps a narrow record only between facts, with a hanging indent", () => {
		const { view } = targetScreen({});
		expect(view.render(48).slice(1, -3).map((line) => line.replaceAll("\u00a0", " "))).toEqual([
			"  4 sources · targeted, n=10",
			"  exa · main · never",
			"  brave · main · active 1 · ok 14 · last ok",
			"  searxng · always · ok 16 · failed 1 ·",
			"    last failed",
			"  native:openai · native · never",
			"  hidden at this width: CAP, DEADLINE, LATENCY,",
			"  RESULTS, EMPTY, TIMEOUT",
		]);
		view.dispose();
	});

	it("goes back from the policy view on the configured cancel key, then closes on the next one", () => {
		const { deps, view } = setup({ keys: { matches: (data, action) => data === "custom-cancel" && action === "tui.select.cancel" } });
		view.handleInput(policyKey);
		expect(view.render(100).at(-1)).toBe(POLICY_HINTS);
		view.handleInput("custom-cancel");
		expect(deps.close).not.toHaveBeenCalled();
		expect(view.render(100).at(-1)).toBe(STATS_HINTS);
		view.handleInput("custom-cancel");
		expect(deps.close).toHaveBeenCalledTimes(1);
	});

	it("scrolls the policy view with arrows and plain PgUp/PgDn, opens it at the top and restores the table's position", () => {
		const engines: EngineDescriptor[] = Array.from({ length: 20 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n}`, tier: "main" }));
		const { view } = setup({ engines: () => engines, rows: () => 10 });
		// Pi's fullscreen transcript owns bare PgUp/PgDn unless the focused pane claims viewport keys.
		expect(view.capturesViewportInput).toBe(true);
		view.render(100); view.handleInput(end);
		const table = view.render(100).join("\n");
		expect(table).toContain("engine-19");
		view.handleInput(policyKey);
		const top = view.render(100).join("\n");
		expect(top).toContain("Search engine activity (this extension instance)");
		expect(top).not.toMatch(/Fuse first|engine-19/);
		view.handleInput(down);
		expect(view.render(100).join("\n")).not.toBe(top);
		view.handleInput(up);
		expect(view.render(100).join("\n")).toBe(top);
		view.handleInput(pageDown);
		expect(view.render(100).join("\n")).not.toContain("Search engine activity");
		view.handleInput(pageUp);
		expect(view.render(100).join("\n")).toBe(top);
		view.handleInput(end);
		expect(view.render(100).join("\n")).toContain("Fuse first");
		view.handleInput(policyKey);
		expect(view.render(100).join("\n")).toBe(table);
		view.handleInput(policyKey);
		expect(view.render(100).join("\n")).toBe(top);
		// Tab stays bound in the policy view: it leaves for the next tab's table.
		view.handleInput(tab);
		expect(tableOf(view.render(100)).records.map((row) => row.SOURCE)).toEqual(["arxiv [unknown]"]);
		view.handleInput(backTab);
		expect(view.render(100).join("\n")).toBe(table);
		view.dispose();
	});

	it("treats ? as a query character on the Test tabs", async () => {
		const { deps, view } = setupTest();
		for (const key of ["w", "h", "y", policyKey]) view.handleInput(key);
		expect(view.render(100).join("\n")).not.toContain("policy and legend");
		view.handleInput("\r"); await flush();
		expect(deps.search).toHaveBeenCalledWith("why?", expect.any(AbortSignal));
		view.dispose();
	});

	it("spells every tab's key hints with the shared vocabulary under one footer rule", () => {
		const { view } = setup();
		const footers: string[][] = [];
		for (let index = 0; index < 5; index++) {
			footers.push(view.render(120).slice(-2));
			view.handleInput(tab);
		}
		const rule = "─".repeat(120);
		const test = "tab next tab  ⏎ search  ↑↓ scroll  PgUp/PgDn page  ^C cancel test  esc close";
		expect(footers).toEqual([[rule, STATS_HINTS], [rule, STATS_HINTS], [rule, "tab next tab  ↑↓ scroll  PgUp/PgDn page  ^C cancel test  esc close"], [rule, test], [rule, test]]);
		view.dispose();
	});

	it("describes its commands by purpose in at most 60 characters", () => {
		const commands = new Map<string, string>();
		const pi = { registerTool: () => {}, on: () => {}, registerCommand: (name: string, command: { description: string }) => commands.set(name, command.description) } as unknown as ExtensionAPI;
		searchHub(pi);
		expect(Object.fromEntries(commands)).toEqual({
			"search-setup": "Configure search backends",
			"search-status": "Search backends: configured and active",
			websearch: "Search sources: statistics, fetchers, test searches",
		});
		for (const description of commands.values()) expect(description.length).toBeLessThanOrEqual(60);
	});

	it.each([60, 80, 100, 120, 170])("keeps every line of every tab and both policy views within %s columns", (width) => {
		const { deps, view } = targetScreen({});
		deps.monitor.begin({ name: "reader:jina", label: "jina", tier: "reader" })({ status: "success", resultCount: 1 });
		for (let index = 0; index < 5; index++) {
			for (const open of index < 2 ? [false, true] : [false]) {
				if (open) view.handleInput(policyKey);
				const lines = view.render(width);
				expect(lines.every((line) => visibleWidth(line) <= width), `tab ${index}, policy ${open}`).toBe(true);
				expect(lines.at(-1), `tab ${index}, policy ${open}`).toContain(open ? "esc back" : "esc close");
				if (open) view.handleInput(policyKey);
			}
			view.handleInput(tab);
		}
		view.dispose();
	});

	it("fuzzes both policy views at every width from 1 to 80 columns", () => {
		const { view } = setup({ rows: () => 24 });
		for (let index = 0; index < 2; index++) {
			view.handleInput(policyKey);
			for (let width = 1; width <= 80; width++) {
				const lines = view.render(width);
				expect(lines.length).toBeLessThanOrEqual(24);
				expect(lines.every((line) => visibleWidth(line) <= width), `tab ${index}, width ${width}`).toBe(true);
			}
			view.handleInput(tab);
		}
		view.dispose();
	});

	it.each([[80, 24], [120, 40]])("retains all five tab labels, scrollable last rows and bounded chrome at %sx%s", (width, height) => {
		const engines: EngineDescriptor[] = Array.from({ length: 64 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n} 日本語`, tier: "main" }));
		const { view } = setup({ engines: () => engines, rows: () => height });
		const initial = view.render(width);
		for (const label of ["Web stats", "Paper stats", "Fetchers", "Test web", "Test papers"]) expect(initial[0]).toContain(label);
		expect(initial.length).toBeLessThanOrEqual(height);
		expect(initial.join("\n")).toContain("64 sources · first, n=10");
		expect(initial.at(-1)).toBe(STATS_HINTS);
		expect(initial.join("\n")).not.toContain("engine-63");
		// The note about dropped columns does not scroll away with the rows.
		if (width === 80) expect(initial.slice(-3)).toEqual(["  hidden at this width: CAP, DEADLINE, LATENCY", "─".repeat(80), STATS_HINTS]);
		else expect(hiddenColumns(initial)).toEqual([]);
		view.handleInput(end);
		expect(view.render(width).join("\n")).toContain("engine-63");
		expect(scrollToText(view, () => view.render(width), "engine-0 ", up).join("\n")).toContain("engine-0 ");
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
			if (label === "Paper stats") expect(text).toContain("arxiv [unknown]");
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

	it("keeps the ANSI table aligned, colors semantic states, and refreshes the injected palette", () => {
		let code = 31;
		const fg = vi.fn((_color: Parameters<typeof PLAIN_THEME.fg>[0], text: string) => `\x1b[${code}m${text}\x1b[0m`);
		const { deps, view } = setup({ rows: () => 200, theme: { ...PLAIN_THEME, fg } });
		deps.monitor.begin(engine)({ status: "failed" });
		const colored = view.render(120);
		const plain = colored.map(stripVTControlCharacters);
		expect(colored.every((line) => visibleWidth(line) <= 120)).toBe(true);
		const table = tableOf(colored);
		expect(table.records).toEqual([expect.objectContaining({ SOURCE: "fixture", FAILED: "1", LAST: "failed", DEADLINE: "30 s", CAP: "20" })]);
		expectAligned(table);
		expect(fg.mock.calls).toContainEqual(["error", "failed"]);
		expect(fg.mock.calls).toContainEqual(["error", "1"]);
		code = 32;
		view.invalidate();
		expect(view.render(120).join("\n")).not.toContain("\x1b[31m");
		expect(view.render(120).map(stripVTControlCharacters)).toEqual(plain);
		view.dispose();
	});

	it.each([1, 4, 20, 40, 60, 80, 120, 200, 300])("shows huge scalar values whole or names their column as hidden at %s columns", (width) => {
		const { deps, view } = setup({ rows: () => 10000, policy: () => fakePolicy({}, { sources: [{ name: "fixture", timeoutMs: 123456789, maxResults: 987654321, boost: 12.3456789 }] }) });
		deps.monitor.begin(engine)({ status: "success", resultCount: Number.MAX_SAFE_INTEGER });
		const lines = view.render(width);
		const squeezed = lines.join("").replace(/\s/g, "");
		const hidden = /hiddenatthiswidth:([A-Z,]+)/.exec(squeezed)?.[1].split(",") ?? [];
		for (const [column, value] of [["DEADLINE", "123456.789s"], ["CAP", "987,654,321×12.3456789"], ["RESULTS", "9,007,199,254,740,991/9,007,199,254,740,991"]]) {
			expect(squeezed.includes(value), `${column} at ${width}`).toBe(!hidden.includes(column));
		}
		expect(hidden.length === 0).toBe(width >= 200);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		view.dispose();
	});

	it("shows only source data, no policy or legend prose, in an 80x24 viewport", () => {
		const { view } = setup({ rows: () => 24 });
		const lines = view.render(80);
		expect(lines).toEqual([
			"── Web search   Web stats   Paper stats   Fetchers   Test web   Test papers  ───",
			"  1 source · first, n=10",
			"  SOURCE   TIER  ACTIVE  OK  EMPTY  FAILED  TIMEOUT  LAST   RESULTS  LATENCY",
			"  fixture  main       ·   ·      ·       ·        ·  never        ·        ·",
			"  hidden at this width: CAP, DEADLINE",
			"─".repeat(80),
			STATS_HINTS,
		]);
		view.dispose();
	});

	it("compares seven canonical source rows in one word-headed table at 120 columns", () => {
		const names = ["exa", "brave", "tavily", "searxng", "duckduckgo", "jina", "serper"];
		const engines: EngineDescriptor[] = names.map((name) => ({ name, label: name.toUpperCase(), tier: "main", availability: "configured" }));
		const { deps, view } = setup({ rows: () => 200, engines: () => engines, policy: () => fakePolicy({ engineOrder: names }, { sources: names.map((name) => ({ name, timeoutMs: 30000, maxResults: 20, boost: 1 })) }) });
		for (const engine of engines) deps.monitor.begin(engine)({ status: "success", resultCount: 9 });
		const lines = view.render(120);
		const table = tableOf(lines);
		expect(table.headerLines).toBe(1);
		expect(table.columns).toEqual(ALL_COLUMNS);
		expect(table.records.map((row) => [row.SOURCE, row.TIER, row.OK, row.LAST, row.RESULTS, row.LATENCY, row.DEADLINE, row.CAP])).toEqual(names.map((name) => [name, "main", "1", "ok", "9 / 9", "0.0 s", "30 s", "20"]));
		expectAligned(table);
		expect(hiddenColumns(lines)).toEqual([]);
		expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true);
		view.dispose();
	});

	it.each([80, 120])("joins stats and limits on one row per source at %s columns", (width) => {
		const fg = vi.fn(PLAIN_THEME.fg);
		const { deps, view } = setup({ rows: () => 200, theme: { ...PLAIN_THEME, fg } });
		deps.monitor.begin(engine)({ status: "success", resultCount: 9 });
		const lines = view.render(width);
		expect(lines.filter((line) => line.includes("fixture"))).toHaveLength(1);
		const table = tableOf(lines);
		expect(table.records).toEqual([expect.objectContaining({ SOURCE: "fixture", OK: "1", LAST: "ok", RESULTS: "9 / 9" })]);
		if (width === 120) {
			expect(table.records[0]).toMatchObject({ DEADLINE: "30 s", CAP: "20" });
			expect(hiddenColumns(lines)).toEqual([]);
		} else expect(hiddenColumns(lines)).toEqual(["CAP", "DEADLINE"]);
		expect(fg.mock.calls).toContainEqual(["success", "1"]);
		expect(fg.mock.calls).toContainEqual(["success", "ok"]);
		view.dispose();
	});

	it.each([80, 120])("keeps three long Unicode source names on one aligned row each at %s cells", (width) => {
		const engines: EngineDescriptor[] = ["native:model-alpha", "native:日本語モデル", "native:model-third"].map((name) => ({ name, label: `${name} 日本語`, tier: "native", availability: "configured" }));
		const { deps, view } = setup({ engines: () => engines, rows: () => 200 });
		deps.monitor.begin(engines[0])({ status: "success", resultCount: 9 });
		deps.monitor.begin(engines[1])({ status: "timeout" });
		const lines = view.render(width);
		const table = tableOf(lines);
		expect(table.records.map((row) => [row.SOURCE, row.TIER, row.TIMEOUT, row.LAST])).toEqual([["native:model-alpha", "native", "·", "ok"], ["native:日本語モデル", "native", "1", "timeout"], ["native:model-third", "native", "·", "never"]]);
		expectAligned(table);
		if (!hiddenColumns(lines).includes("RESULTS")) expect(table.records.map((row) => row.RESULTS)).toEqual(["9 / 9", "·", "·"]);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		view.dispose();
	});

	it("never clips oversized counters: the table drops columns, then becomes wrapped records", () => {
		const { deps, view } = setup({ rows: () => 100 });
		deps.monitor.begin(engine)({ status: "success", resultCount: Number.MAX_SAFE_INTEGER });
		const snapshot = deps.monitor.snapshot()[0];
		vi.spyOn(deps.monitor, "snapshot").mockReturnValue([{ ...snapshot, ongoing: Number.MAX_SAFE_INTEGER, success: Number.MAX_SAFE_INTEGER, empty: Number.MAX_SAFE_INTEGER, failed: Number.MAX_SAFE_INTEGER, timeout: Number.MAX_SAFE_INTEGER, cancelled: Number.MAX_SAFE_INTEGER }]);
		const big = "9,007,199,254,740,991";
		const table = tableOf(view.render(250));
		expect(table.records).toEqual([expect.objectContaining({ SOURCE: "fixture", ACTIVE: big, OK: big, EMPTY: big, FAILED: big, TIMEOUT: big, CANCELLED: big })]);
		expectAligned(table);
		const lines = view.render(80);
		expect(lines.join("\n").replace(/\s+/g, " ")).toContain(`fixture · main · active ${big} · ok ${big} · failed ${big} · last ok`);
		expect(hiddenColumns(lines)).toEqual(["CAP", "DEADLINE", "LATENCY", "RESULTS", "CANCELLED", "EMPTY", "TIMEOUT"]);
		expect(lines.join("\n")).not.toContain("…");
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
		view.dispose();
	});

});
