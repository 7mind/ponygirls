/** Pure scroll-viewport math. No Pi imports, so the tests can run under node. */

export const DEFAULT_VIEWPORT_BUDGET = 15;
export const MIN_VIEWPORT_BUDGET = 5;
export const MAX_VIEWPORT_BUDGET = 60;
/** Wheel lines per notch; a selection moves one row, a table moves a few lines. */
export const WHEEL_LINES = 3;
/** Budget resize step for the `+`/`-` keys. */
export const VIEWPORT_BUDGET_STEP = 5;

/** Clamp a viewport budget to the adjustable range. */
export function clampViewportBudget(budget: number): number {
	if (!Number.isFinite(budget)) return DEFAULT_VIEWPORT_BUDGET;
	return Math.max(MIN_VIEWPORT_BUDGET, Math.min(MAX_VIEWPORT_BUDGET, Math.floor(budget)));
}

/** Clamp a scroll offset so the window stays within `lineCount` content lines. */
export function clampScrollTop(scrollTop: number, lineCount: number, budget: number): number {
	if (!Number.isFinite(scrollTop)) return 0;
	const total = Math.max(0, Math.floor(lineCount));
	const size = Math.max(1, Math.floor(budget));
	return Math.max(0, Math.min(Math.max(0, total - size), Math.floor(scrollTop)));
}

/** Visible `[start, end)` content lines for an offset; every line is reachable. */
export function visibleRange(lineCount: number, scrollTop: number, budget: number): { start: number; end: number } {
	const total = Math.max(0, Math.floor(lineCount));
	const size = Math.max(1, Math.floor(budget));
	const start = clampScrollTop(scrollTop, total, size);
	return { start, end: Math.min(total, start + size) };
}
