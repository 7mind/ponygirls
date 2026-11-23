import { matchesKey, parseKey, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { clampScrollTop, clampViewportBudget, defaultTableBudget, VIEWPORT_BUDGET_STEP, WHEEL_LINES } from "./scroll-state.ts";

export class TableViewport {
	private readonly rows: () => number | undefined;
	private readonly requestRender: () => void;
	private manualBudget: number | undefined;
	private lineCount = 0;
	private top = 0;

	constructor(rows: () => number | undefined, requestRender: () => void) {
		this.rows = rows;
		this.requestRender = requestRender;
	}

	get budget(): number { return this.manualBudget ?? defaultTableBudget(this.rows()); }
	get scrollTop(): number { return this.top; }

	reconcile(frame: { lineCount: number; scrollTop: number }): void {
		this.lineCount = frame.lineCount;
		this.top = frame.scrollTop;
	}

	reset(): void { this.top = 0; }

	handleInput(data: string): void {
		const key = parseKey(data);
		if (matchesKey(data, "up") || key === "k") this.scrollTo(this.top - 1);
		else if (matchesKey(data, "down") || key === "j") this.scrollTo(this.top + 1);
		else if (matchesKey(data, "pageUp")) this.scrollTo(this.top - this.budget);
		else if (matchesKey(data, "pageDown")) this.scrollTo(this.top + this.budget);
		else if (matchesKey(data, "home")) this.scrollTo(0);
		else if (matchesKey(data, "end")) this.scrollTo(this.lineCount);
		else if (key === "+" || key === "=") this.growBudget(VIEWPORT_BUDGET_STEP);
		else if (key === "-" || key === "_") this.growBudget(-VIEWPORT_BUDGET_STEP);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.scrollTo(this.top + (event.wheelDelta < 0 ? -WHEEL_LINES : WHEEL_LINES));
		return { handled: true, render: false };
	}

	private scrollTo(target: number): void {
		const next = clampScrollTop(target, this.lineCount, this.budget);
		if (next === this.top) return;
		this.top = next;
		this.requestRender();
	}

	private growBudget(delta: number): void {
		const current = this.budget;
		const next = clampViewportBudget(current + delta);
		if (next === current) return;
		this.manualBudget = next;
		this.top = clampScrollTop(this.top, this.lineCount, next);
		this.requestRender();
	}
}
