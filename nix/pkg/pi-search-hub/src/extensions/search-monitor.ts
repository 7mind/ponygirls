/** Per-extension, in-memory observations. Never accepts queries, credentials, or error text. */
export type EngineTier = "main" | "fallback" | "native" | "reader";

/** Only safe display metadata belongs here; do not pass backend config or credentials. */
export interface EngineDescriptor {
	name: string;
	label: string;
	tier: EngineTier;
	availability?: "configured" | "unavailable" | "unknown";
}

export type SearchOutcomeStatus = "success" | "empty" | "failed" | "cancelled";
export interface SearchOutcome {
	status: SearchOutcomeStatus;
	/** Omit when a successful operation has no observable result count (e.g. native search). */
	resultCount?: number;
}

export interface EngineSnapshot {
	name: string;
	label: string;
	tier: EngineTier;
	ongoing: number;
	/** Non-empty or uncounted successful operations; empty is counted separately. */
	success: number;
	failed: number;
	empty: number;
	cancelled: number;
	/** Completion order, not start order; null means never completed. */
	lastOutcome: SearchOutcomeStatus | null;
	/** Null on failure/cancellation or when the backend did not expose a count. */
	resultCountLast: number | null;
	/** Sum of observed result counts only. */
	resultCountTotal: number;
	latencyLastMs: number | null;
	/** Sum of completed request durations, including failed/cancelled requests. */
	latencyTotalMs: number;
}

export class SearchMonitor {
	private readonly engines = new Map<string, EngineSnapshot>();
	private readonly listeners = new Set<() => void>();

	constructor(private readonly now: () => number = () => performance.now()) {}

	/** Starts one attempted operation. The returned finisher is safe to call more than once. */
	begin(engine: EngineDescriptor): (outcome: SearchOutcome) => void {
		const key = JSON.stringify([engine.tier, engine.name]);
		let stats = this.engines.get(key);
		if (!stats) {
			// Copy only allowlisted metadata, never a caller's config object.
			stats = {
				name: engine.name, label: engine.label, tier: engine.tier,
				ongoing: 0, success: 0, failed: 0, empty: 0, cancelled: 0,
				lastOutcome: null, resultCountLast: null, resultCountTotal: 0,
				latencyLastMs: null, latencyTotalMs: 0,
			};
			this.engines.set(key, stats);
		}
		stats.label = engine.label;
		const started = this.now();
		stats.ongoing++;
		this.changed();
		let finished = false;
		return (outcome) => {
			if (finished) return;
			finished = true;
			const elapsed = this.now() - started;
			const latency = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
			const count = outcome.status === "empty" ? 0
				: outcome.status === "success" && Number.isSafeInteger(outcome.resultCount) && outcome.resultCount! >= 0
					? outcome.resultCount! : null;
			stats.ongoing--;
			stats[outcome.status]++;
			stats.lastOutcome = outcome.status;
			stats.resultCountLast = count;
			stats.resultCountTotal += count ?? 0;
			stats.latencyLastMs = latency;
			stats.latencyTotalMs += latency;
			this.changed();
		};
	}

	/** Classify resolved backend results explicitly: an empty result is not a verified success. */
	async observe<T>(engine: EngineDescriptor, operation: () => Promise<T>, classify: (value: T) => SearchOutcome): Promise<T> {
		const finish = this.begin(engine);
		try {
			const value = await operation();
			finish(classify(value));
			return value;
		} catch (error) {
			finish({ status: error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed" });
			throw error;
		}
	}

	/** Unattempted engines are absent, not reported healthy. Snapshots are detached copies. */
	snapshot(): EngineSnapshot[] {
		return Array.from(this.engines.values(), (stats) => ({ ...stats }));
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	private changed(): void {
		for (const listener of [...this.listeners]) {
			// Rendering is an observer and must never change a backend's success/failure.
			try { listener(); } catch { /* An unavailable view must not break a search. */ }
		}
	}
}
