import { describe, expect, it, vi } from "vitest";
import { Text, VStack, visibleWidth } from "@earendil-works/pi-tui";
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

	it("edits queries using the real Input and displays direct results without closing", async () => {
		const { deps, view } = setup();
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
		const { deps, view } = setup();
		for (const key of ["q", "j", "k", "r"]) view.handleInput(key);
		view.handleInput("\r");
		await flush();
		expect(deps.search).toHaveBeenCalledWith("qjkr", expect.any(AbortSignal));
		expect(deps.close).not.toHaveBeenCalled();
		view.dispose();
	});

	it("ignores blank submission and duplicate Enter during an active search", async () => {
		const pending = deferred<string>();
		const { deps, view } = setup({ search: vi.fn(() => pending.promise) });
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
		const { deps, view } = setup({ search: vi.fn(async () => { throw new Error("Authorization: Bearer fixture-secret https://fixture/?key=credential\x1b]52;c;PAYLOAD\x07"); }) });
		view.handleInput("test"); view.handleInput("\r"); await flush();
		const text = view.render(100).join("\n");
		expect(text).toContain("Search failed.");
		expect(text).not.toMatch(/fixture-secret|credential\b|Authorization|PAYLOAD/);
		expect(deps.close).not.toHaveBeenCalled();
		view.dispose();
	});

	it("bounds and sanitizes results and query paste, including hidden terminal hyperlinks", async () => {
		const text = "\x1b]8;;https://fixture.invalid/\x07label\x1b]8;;\x07\x1b[31mred\x1b[0m\x1b]52;c;PAYLOAD\x07\n" + "日本語 👩🏽‍💻 é ".repeat(3000);
		const { deps, view } = setup({ search: vi.fn(async () => text), rows: () => 500 });
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
		const { deps, view } = setup();
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
		const { deps, view } = setup({ search, keys: { matches: (data) => data === "\x03" || data === esc } });
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
		const { deps, view } = setup({ search });
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
		const { deps, view } = setup({ search, keys: { matches: (data, action) => data === "custom-cancel" && action === "tui.select.cancel" } });
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
		view.handleInput("👩🏽‍💻 日本語 é");
		for (const width of [1, 2, 3, 4, 5, 10]) {
			expect(view.render(width).every((line) => visibleWidth(line) <= width), `query width ${width}`).toBe(true);
		}
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

	it("preserves input/chrome and scrolls all rows under structural allocation", () => {
		const engines: EngineDescriptor[] = Array.from({ length: 30 }, (_, n) => ({ name: `engine-${n}`, label: `Engine ${n}`, tier: "fallback" }));
		const { view } = setup({ engines: () => engines });
		view.focused = true;
		view.handleInput("draft query");
		const root = new VStack([
			{ component: new Text("transcript", 0, 0), shrink: 0 },
			{ component: view, grow: 1, shrink: 1 },
			{ component: new Text("bottom badge\nPi status", 0, 0), shrink: 0 },
		]);
		const frame = (width: number, height: number) => renderLayoutFrame(root, width, height, () => {}).lines;
		for (const [width, height] of [[80, 16], [40, 12], [100, 25]]) {
			let lines = frame(width, height);
			expect(lines.join("\n")).toContain("draft query");
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

	it("keeps historical observations visible but does not claim the removed engine is configured", () => {
		const { deps, view } = setup({ engines: () => [] });
		deps.monitor.begin(engine)({ status: "success" });
		const text = view.render(100).join("\n");
		expect(text).toContain("Fixture (fixture) · main · unknown");
		expect(text).toContain("results last unknown");
		view.dispose();
	});
});
