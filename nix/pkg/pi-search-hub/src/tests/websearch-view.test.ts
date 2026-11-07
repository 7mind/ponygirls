import { describe, expect, it, vi } from "vitest";
import { CURSOR_MARKER, Text, VStack, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { PLAIN_THEME } from "@ponygirls/pi-ui";
import { SearchMonitor, type EngineDescriptor } from "../extensions/search-monitor.js";
import { WebSearchView, type WebSearchViewDeps } from "../extensions/websearch-view.js";

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
const pageDown = "\x1b[6~";
const pageUp = "\x1b[5~";
const end = "\x1b[1;5F";
const home = "\x1b[1;5H";
const engine: EngineDescriptor = { name: "fixture", label: "Fixture", tier: "main", availability: "configured" };
function setup(overrides: Partial<WebSearchViewDeps> = {}) {
	const deps: WebSearchViewDeps = {
		monitor: new SearchMonitor(() => 0), engines: () => [engine], search: vi.fn(async () => "fixture result"),
		theme: PLAIN_THEME, keys: { matches: () => false }, rows: () => 20, requestRender: vi.fn(), close: vi.fn(), ...overrides,
	};
	return { deps, view: new WebSearchView(deps) };
}
function setupTest(overrides: Partial<WebSearchViewDeps> = {}) {
	const fixture = setup(overrides);
	fixture.view.handleInput(backTab); // Search tests deliberately select the Test search tab.
	return fixture;
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("WebSearchView", () => {
	it("opens offline, reports unknown/not-attempted honestly, and repaints from observations", () => {
		const { deps, view } = setup({ engines: () => [engine, { name: "unused", label: "Unavailable", tier: "fallback", availability: "unavailable" }] });
		const initial = view.render(100).join("\n");
		expect(deps.search).not.toHaveBeenCalled();
		expect(initial).toContain("Fixture (fixture) · main · configured");
		expect(initial).toContain("not attempted · health unknown");
		expect(initial).toContain("unavailable");
		const finish = deps.monitor.begin(engine);
		expect(deps.requestRender).toHaveBeenCalled();
		expect(view.render(100).join("\n")).toContain("active 1 · ok 0");
		finish({ status: "empty" });
		expect(view.render(100).join("\n")).toContain("active 0 · ok 0 · empty 1");
		view.dispose();
	});

	it("segregates main/fallback/native search engines from reader fetchers, including historical tiers", () => {
		const reader: EngineDescriptor = { name: "shared", label: "Reader", tier: "reader" };
		const native: EngineDescriptor = { name: "native", label: "Native", tier: "native" };
		const fallback: EngineDescriptor = { name: "fallback", label: "Fallback", tier: "fallback" };
		const { deps, view } = setup({ engines: () => [engine, reader, native, fallback], rows: () => 50 });
		deps.monitor.begin({ name: "shared", label: "Historical search", tier: "main" })({ status: "success", resultCount: 3 });
		deps.monitor.begin({ name: "removed", label: "Historical reader", tier: "reader" })({ status: "empty" });
		deps.monitor.begin(reader)({ status: "failed" });
		const search = view.render(120).join("\n");
		expect(search).toContain("Search engine activity");
		for (const title of ["Fixture (fixture) · main", "Native (native) · native", "Fallback (fallback) · fallback", "Historical search (shared) · main · unknown"]) expect(search).toContain(title);
		expect(search).toContain("total 3 observed");
		expect(search).not.toMatch(/Reader \(shared\)|Historical reader|· reader|Enter a query|> /);
		view.handleInput(tab);
		const fetchers = view.render(120).join("\n");
		expect(fetchers).toContain("Fetcher activity");
		expect(fetchers).toContain("Reader (shared) · reader");
		expect(fetchers).toContain("Historical reader (removed) · reader · unknown");
		expect(fetchers).toContain("failed 1");
		expect(fetchers).toContain("empty 1");
		expect(fetchers).not.toMatch(/Fixture \(fixture\)|Native \(native\)|Fallback \(fallback\)|Historical search|· main|· fallback|· native/);
		view.handleInput(tab);
		const test = view.render(120).join("\n");
		expect(test).toContain("Enter a query above");
		expect(test).not.toMatch(/activity|Reader \(shared\)|Fixture \(fixture\)|Historical reader|Historical search/);
		expect(deps.search).not.toHaveBeenCalled();
		view.dispose();
	});

	it("cycles all tabs in both directions and accepts/focuses query input only on Test search", async () => {
		const { deps, view } = setup();
		view.focused = true;
		expect(view.focused).toBe(true);
		expect(view.render(100).join("\n")).not.toContain(CURSOR_MARKER);
		view.handleInput("ignored search text"); view.handleInput("\r");
		view.handleInput(tab);
		expect(view.render(100).join("\n")).toContain("Fetcher activity");
		expect(view.render(100).join("\n")).not.toContain(CURSOR_MARKER);
		view.handleInput("ignored fetcher text"); view.handleInput("\r");
		expect(deps.search).not.toHaveBeenCalled();
		view.handleInput(tab);
		expect(view.render(100).join("\n")).toContain(CURSOR_MARKER);
		view.handleInput("draft");
		view.handleInput(tab);
		expect(view.render(100).join("\n")).toContain("Search engine activity");
		view.handleInput(backTab);
		expect(view.render(100).join("\n")).toContain("draft");
		view.handleInput(backTab);
		expect(view.render(100).join("\n")).toContain("Fetcher activity");
		view.handleInput(backTab);
		expect(view.render(100).join("\n")).toContain("Search engine activity");
		view.handleInput(backTab);
		view.handleInput("\r"); await flush();
		expect(deps.search).toHaveBeenCalledExactlyOnceWith("draft", expect.any(AbortSignal));
		view.handleInput(tab); view.handleInput(backTab);
		expect(view.render(100).join("\n")).toContain("fixture result");
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
		view.handleInput(tab);
		view.render(100); view.handleInput(end);
		const statistics = view.render(100).join("\n");
		expect(statistics).toContain("Engine 19");
		expect(search.mock.calls[0][1].aborted).toBe(false);
		pending.resolve("background result"); await flush();
		expect(view.render(100).join("\n")).toBe(statistics);
		view.handleInput(backTab);
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

	it.each([0, 1, 2])("Escape closes and disposes in-flight work on tab %s", async (selected) => {
		const pending = deferred<string>();
		const search = vi.fn((_query: string, _signal: AbortSignal) => pending.promise);
		const { deps, view } = setupTest({ search });
		view.handleInput("test"); view.handleInput("\r");
		for (let n = 0; n < (selected + 1) % 3; n++) view.handleInput(tab);
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
		expect(query.length).toBe(2048);
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
		view.handleInput(tab);
		const initial = view.render(100).join("\n");
		view.handleInput(down);
		expect(view.render(100).join("\n")).not.toBe(initial);
		view.handleInput(pageDown);
		expect(view.render(100).join("\n")).not.toContain("Engine 0 ");
		view.handleInput(end);
		expect(view.render(100).join("\n")).toContain("Engine 19 ");
		rows = 15;
		expect(view.render(40).length).toBeLessThanOrEqual(rows);
		view.handleInput(home); view.handleInput(pageUp);
		expect(view.render(100).join("\n")).toContain("Engine 0 ");
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
			expect(lines.join("\n")).toContain("Engine 29");
			// Intrinsic measurement must not reset an allocated scroll position.
			view.render(40);
			expect(frame(width, height).join("\n")).toContain("Engine 29");
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		view.handleInput(home);
		expect(frame(80, 16).join("\n")).toContain("Engine 0");
		view.dispose();
	});

	it("retains independent scroll positions on all three tabs", async () => {
		const engines: EngineDescriptor[] = ["main", "reader"].flatMap((tier) => Array.from({ length: 20 }, (_, n) => ({ name: `${tier}-${n}`, label: `${tier} ${n}`, tier: tier as "main" | "reader" })));
		const { view } = setup({ engines: () => engines, rows: () => 12, search: async () => Array.from({ length: 30 }, (_, n) => `result ${n}`).join("\n") });
		view.render(100); view.handleInput(end);
		const search = view.render(100).join("\n");
		expect(search).toContain("main 19");
		view.handleInput(tab); view.render(100); view.handleInput(end);
		const fetchers = view.render(100).join("\n");
		expect(fetchers).toContain("reader 19");
		view.handleInput(tab); view.handleInput("query"); view.handleInput("\r"); await flush();
		view.render(100); view.handleInput(end);
		const test = view.render(100).join("\n");
		expect(test).toContain("result 29");
		view.handleInput(tab);
		expect(view.render(100).join("\n")).toBe(search);
		view.handleInput(tab);
		expect(view.render(100).join("\n")).toBe(fetchers);
		view.handleInput(tab);
		expect(view.render(100).join("\n")).toBe(test);
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
			view.handleInput(tab); frame(width, height); view.handleInput(end);
			expect(frame(width, height).join("\n")).toContain("Engine 29");
			view.handleInput(backTab);
			view.render(20); // Intrinsic sizing must not reset the allocated Test viewport.
			lines = frame(width, height);
			expect(lines.join("\n")).toContain("result 39");
			expect(lines.join("\n")).toContain("draft query");
		}
		view.dispose();
	});

	it("bounds all tabs at narrow regular sizes without dropping navigation hints at practical widths", () => {
		const { view } = setup({ engines: () => [engine, { name: "reader", label: "Reader 日本語", tier: "reader" }], rows: () => 12 });
		for (let selected = 0; selected < 3; selected++) {
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
		const testX = title.indexOf("Test search");
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
		view.handleMouse(mouse(title.indexOf("Search engines")));
		expect(view.render(100).join("\n")).toContain("Search engine activity");
		view.handleMouse(mouse(testX));
		expect(view.render(100).join("\n")).toContain("query");
		expect(deps.search).not.toHaveBeenCalled();
		view.dispose();
		expect(view.handleMouse(mouse(fetcherX))).toBeUndefined();
	});

	it("keeps historical observations visible but does not claim the removed engine is configured", () => {
		const { deps, view } = setup({ engines: () => [] });
		deps.monitor.begin(engine)({ status: "success" });
		const text = view.render(100).join("\n");
		expect(text).toContain("Fixture (fixture) · main · unknown");
		expect(text).toContain("results last unknown");
		view.dispose();
	});
});
