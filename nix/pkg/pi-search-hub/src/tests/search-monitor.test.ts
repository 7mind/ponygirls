import { describe, expect, it } from "vitest";
import { SearchMonitor, type EngineDescriptor } from "../extensions/search-monitor.js";

// Specified Behavioral-Active × Blackbox × Atomic: no network, credentials, or real clock.
const main: EngineDescriptor = { name: "fixture", label: "Fixture search", tier: "main" };
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

describe("SearchMonitor", () => {
	it("distinguishes unattempted, pending, empty, successful and failed concurrent calls", () => {
		let now = 10;
		const monitor = new SearchMonitor(() => now);
		expect(monitor.snapshot()).toEqual([]);
		const first = monitor.begin(main);
		now = 15;
		const second = monitor.begin(main);
		expect(monitor.snapshot()[0]).toMatchObject({ ongoing: 2, success: 0, empty: 0, failed: 0, lastOutcome: null, resultCountLast: null, latencyLastMs: null });
		now = 30;
		second({ status: "empty" });
		expect(monitor.snapshot()[0]).toMatchObject({ ongoing: 1, empty: 1, lastOutcome: "empty", resultCountLast: 0, latencyLastMs: 15 });
		now = 50;
		first({ status: "success", resultCount: 4 });
		first({ status: "failed" });
		expect(monitor.snapshot()[0]).toEqual({ name: "fixture", label: "Fixture search", tier: "main", ongoing: 0, success: 1, empty: 1, failed: 0, cancelled: 0, lastOutcome: "success", resultCountLast: 4, resultCountTotal: 4, latencyLastMs: 40, latencyTotalMs: 55 });
		now = 60;
		const fail = monitor.begin(main);
		now = 65;
		fail({ status: "failed", resultCount: 999 });
		expect(monitor.snapshot()[0]).toMatchObject({ failed: 1, ongoing: 0, resultCountLast: null, resultCountTotal: 4, latencyLastMs: 5, latencyTotalMs: 60 });
	});

	it("isolates extension instances and tiers, counts uncounted native success honestly", () => {
		const monitor = new SearchMonitor(() => 10);
		monitor.begin(main)({ status: "success", resultCount: 2 });
		monitor.begin({ ...main, tier: "native" })({ status: "success" });
		monitor.begin({ name: "fixture-reader", label: "Reader", tier: "reader" })({ status: "cancelled" });
		expect(monitor.snapshot()).toHaveLength(3);
		expect(monitor.snapshot()[1]).toMatchObject({ tier: "native", success: 1, empty: 0, resultCountLast: null, resultCountTotal: 0 });
		expect(monitor.snapshot()[2]).toMatchObject({ tier: "reader", cancelled: 1, failed: 0 });
		expect(new SearchMonitor().snapshot()).toEqual([]);
	});

	it("emits start/finish changes, supports unsubscribe, and isolates broken observers", () => {
		const monitor = new SearchMonitor();
		const snapshots: number[] = [];
		monitor.subscribe(() => { throw new Error("view unavailable"); });
		const unsubscribe = monitor.subscribe(() => snapshots.push(monitor.snapshot()[0].ongoing));
		const finish = monitor.begin(main);
		finish({ status: "success" });
		finish({ status: "success" });
		expect(snapshots).toEqual([1, 0]);
		unsubscribe(); unsubscribe();
		monitor.begin(main)({ status: "empty" });
		expect(snapshots).toEqual([1, 0]);
	});

	it("returns detached snapshots and discards unexpected metadata and raw errors", async () => {
		const monitor = new SearchMonitor(() => 0);
		const engine = { ...main, credential: "fixture-secret", query: "private query" };
		const error = new Error("Bearer fixture-secret");
		await expect(monitor.observe(engine, async () => { throw error; }, () => ({ status: "success" }))).rejects.toBe(error);
		const snapshot = monitor.snapshot();
		snapshot[0].ongoing = 100;
		snapshot[0].label = "changed";
		expect(monitor.snapshot()[0]).toMatchObject({ ongoing: 0, label: main.label, failed: 1 });
		expect(JSON.stringify(monitor.snapshot())).not.toMatch(/fixture-secret|private query|Bearer/);
	});

	it("observes concurrent operations in completion order without changing results", async () => {
		let now = 0;
		const monitor = new SearchMonitor(() => now);
		const a = deferred<number[]>();
		const b = deferred<number[]>();
		const classify = (results: number[]) => ({ status: results.length ? "success" as const : "empty" as const, resultCount: results.length });
		const first = monitor.observe(main, () => a.promise, classify);
		now = 2;
		const second = monitor.observe(main, () => b.promise, classify);
		expect(monitor.snapshot()[0].ongoing).toBe(2);
		now = 5;
		b.resolve([]);
		await expect(second).resolves.toEqual([]);
		now = 9;
		const result = [1, 2];
		a.resolve(result);
		await expect(first).resolves.toBe(result);
		expect(monitor.snapshot()[0]).toMatchObject({ ongoing: 0, success: 1, empty: 1, resultCountLast: 2, latencyLastMs: 9, latencyTotalMs: 12 });
	});

	it("finishes synchronous failures and aborts, even if classification throws", async () => {
		const monitor = new SearchMonitor(() => 0);
		const abort = new Error("not retained"); abort.name = "AbortError";
		await expect(monitor.observe(main, () => { throw abort; }, () => ({ status: "empty" }))).rejects.toBe(abort);
		const error = new Error("classification failed");
		await expect(monitor.observe(main, async () => "value", () => { throw error; })).rejects.toBe(error);
		expect(monitor.snapshot()[0]).toMatchObject({ ongoing: 0, cancelled: 1, failed: 1, lastOutcome: "failed" });
	});

	it("does not invent result counts and clamps a backwards clock", () => {
		let now = 20;
		const monitor = new SearchMonitor(() => now);
		const finish = monitor.begin(main);
		now = 10;
		finish({ status: "success", resultCount: NaN });
		monitor.begin(main)({ status: "success", resultCount: -2 });
		monitor.begin(main)({ status: "success", resultCount: 1.5 });
		expect(monitor.snapshot()[0]).toMatchObject({ success: 3, resultCountLast: null, resultCountTotal: 0, latencyLastMs: 0, latencyTotalMs: 0 });
	});
});
