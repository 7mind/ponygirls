import { stripVTControlCharacters } from "node:util";
import { Input, Key, matchesKey, ScrollView, truncateToWidth, wrapTextWithAnsi, type Focusable, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { frameTitle, keyHints, PanelLayout, type PanelParts, type UiTheme } from "@ponygirls/pi-ui";
import { type EngineDescriptor, type EngineSnapshot, SearchMonitor } from "./search-monitor.js";

export interface WebSearchViewDeps {
	monitor: SearchMonitor;
	/** Safe metadata only, refreshed by the command owner when opening the pane. */
	engines(): readonly EngineDescriptor[];
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

/** Untrusted search content is plain text, never executable terminal escapes or hyperlinks. */
function plain(text: string): string {
	return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\t/g, "  ");
}

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

	constructor(deps: WebSearchViewDeps) {
		super((width) => this.renderParts(width));
		this.deps = deps;
		this.input = new Input({ prompt: "> ", placeholder: "Test a web search", placeholderStyle: (text) => deps.theme.fg("dim", text) });
		this.input.onSubmit = (query) => { void this.run(query); };
		this.regularScroll = new ScrollView({ render: (width) => this.content(width), invalidate() {} }, { overscroll: "contain", scrollbar: "hidden" });
		this.unsubscribe = deps.monitor.subscribe(() => this.repaint());
	}

	get focused(): boolean { return this.input.focused; }
	set focused(value: boolean) { this.input.focused = value; }

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

	private async run(value: string): Promise<void> {
		const query = plain(value).replace(/\n/g, " ").slice(0, MAX_QUERY_CHARS).trim();
		if (this.disposed || this.active || !query) return;
		const generation = ++this.generation;
		const controller = new AbortController();
		this.active = controller;
		this.state = "searching";
		this.result = "";
		this.scroll.scrollToStart();
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
				this.scroll.scrollToStart();
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

	private engineLines(engine: EngineDescriptor, stats: EngineSnapshot | undefined): string[] {
		const t = this.deps.theme;
		const label = plain(engine.label).replace(/\n/g, " ").slice(0, 80);
		const name = plain(engine.name).replace(/\n/g, " ").slice(0, 64);
		const title = `${label}${label === name ? "" : ` (${name})`} · ${engine.tier} · ${engine.availability ?? "unknown"}`;
		if (!stats) return [t.bold(title), t.fg("dim", "  not attempted · health unknown")];
		const last = stats.lastOutcome ?? "pending";
		const stateColor = last === "failed" ? "error" : last === "success" ? "success" : last === "empty" || last === "cancelled" ? "warning" : "muted";
		return [
			t.bold(title),
			t.fg(stateColor, `  active ${stats.ongoing} · ok ${stats.success} · empty ${stats.empty} · failed ${stats.failed} · cancelled ${stats.cancelled} · last ${last}`),
			t.fg("dim", `  results last ${stats.resultCountLast ?? "unknown"} / total ${stats.resultCountTotal} observed · latency last ${stats.latencyLastMs === null ? "unknown" : `${Math.round(stats.latencyLastMs)}ms`} / total ${Math.round(stats.latencyTotalMs)}ms`),
		];
	}

	private content(width: number): string[] {
		const w = Math.max(1, Math.floor(width));
		const t = this.deps.theme;
		const lines: string[] = [];
		if (this.state === "idle") lines.push(t.fg("dim", "Enter a query above to test search. No network probes run when opening this pane."));
		else if (this.state === "searching") lines.push(t.fg("accent", "Searching… Ctrl+C cancels this test."));
		else if (this.state === "failed") lines.push(t.fg("error", "Search failed. Provider error details are hidden to protect credentials."));
		else if (this.state === "cancelled") lines.push(t.fg("warning", "Search cancelled."));
		else {
			lines.push(t.bold("Search result"));
			const wrapped = this.result.split("\n").flatMap((line) => wrapTextWithAnsi(line, w));
			lines.push(...wrapped.slice(0, MAX_WRAPPED_RESULT_LINES));
			if (wrapped.length > MAX_WRAPPED_RESULT_LINES) lines.push(t.fg("dim", "[Result truncated for display]"));
			if (!this.result.trim()) lines.push(t.fg("dim", "No displayable results returned."));
		}
		lines.push("", t.bold("Engine activity (this extension instance)"));
		const snapshots = this.deps.monitor.snapshot();
		const stats = new Map(snapshots.map((entry) => [engineKey(entry), entry]));
		const engines = new Map(this.deps.engines().map((entry) => [engineKey(entry), entry]));
		// Preserve observations of engines removed by a config refresh, without calling them configured.
		for (const entry of snapshots) if (!engines.has(engineKey(entry))) engines.set(engineKey(entry), { name: entry.name, label: entry.label, tier: entry.tier });
		const shown = [...engines.values()].slice(0, MAX_ENGINES);
		if (shown.length === 0) lines.push(t.fg("dim", "No engine descriptors available; configuration and health unknown."));
		for (const engine of shown) lines.push(...this.engineLines(engine, stats.get(engineKey(engine))));
		if (engines.size > MAX_ENGINES) lines.push(t.fg("dim", `[${engines.size - MAX_ENGINES} more engines omitted]`));
		return lines.flatMap((line) => wrapTextWithAnsi(line, w)).map((line) => truncateToWidth(line, w, ""));
	}

	private renderParts(width: number): PanelParts {
		const w = Math.max(1, Math.floor(width));
		const t = this.deps.theme;
		const hints = w < 35 ? [{ key: "esc", action: "close" }] : [
			{ key: "enter", action: "search" }, { key: "↑↓ PgUp PgDn", action: "scroll" },
			{ key: "Ctrl+C", action: "cancel" }, { key: "esc", action: "close" },
		];
		return {
			header: [frameTitle(t, w, { title: "websearch", meta: this.state }, "none").line, ...this.input.render(w)],
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
		const page = Math.max(1, this.scroll.viewportHeight - 1);
		if (matchesKey(data, Key.up)) this.scroll.scrollBy(-1);
		else if (matchesKey(data, Key.down)) this.scroll.scrollBy(1);
		else if (matchesKey(data, Key.pageUp)) this.scroll.scrollBy(-page);
		else if (matchesKey(data, Key.pageDown)) this.scroll.scrollBy(page);
		else if (matchesKey(data, Key.ctrl("home"))) this.scroll.scrollToStart();
		else if (matchesKey(data, Key.ctrl("end"))) this.scroll.scrollToEnd();
		else {
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
		if (this.disposed || event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.scroll.scrollBy(event.wheelDelta);
		return { handled: true, render: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
	}
}
