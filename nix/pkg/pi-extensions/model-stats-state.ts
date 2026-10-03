/** Pure model-stats logic. No Pi imports, so the tests can run under node. */

export interface ResponseSample {
	type: "ok";
	/** Completion time, epoch milliseconds. */
	ts: number;
	/** Model identity in `provider/id` form. */
	key: string;
	/** Request dispatch to first provider stream event, milliseconds. */
	ttftMs: number;
	/** Request dispatch to finalized message, milliseconds. */
	totalMs: number;
	outputTokens: number;
}

export type FailureKind = "aborted" | "timeout" | "error";

export interface FailureRecord {
	type: "fail";
	ts: number;
	key: string;
	kind: FailureKind;
}

export type StatsRecord = ResponseSample | FailureRecord;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Longest reporting window; also the retention limit for stored records. */
export const WEEK_MS = 7 * DAY_MS;

export const WINDOWS = [
	{ label: "Last hour", ms: HOUR_MS },
	{ label: "Last 24 hours", ms: DAY_MS },
	{ label: "Last week", ms: WEEK_MS },
] as const;

const TIMEOUT_PATTERN = /\btimeout\b|\btimed out\b|deadline exceeded|etimedout/i;

/** Bucket a finalized message: "ok" messages are sampled; the rest only count. */
export function classifyOutcome(stopReason: string, errorMessage?: string): "ok" | FailureKind {
	if (stopReason === "aborted") return "aborted";
	if (stopReason === "error") return errorMessage && TIMEOUT_PATTERN.test(errorMessage) ? "timeout" : "error";
	return "ok";
}

/** Output tokens per second over the decode span (first token → done). When no first token was observed (non-streaming providers report ttft == total), the full span is the only available rate. */
export function tokensPerSecond(sample: ResponseSample): number {
	const decodeMs = sample.totalMs - sample.ttftMs;
	const spanMs = decodeMs > 0 ? decodeMs : Math.max(sample.totalMs, 1);
	return sample.outputTokens / (spanMs / 1000);
}

/** Linear-interpolated percentile of an ascending-sorted list; NaN when empty. */
export function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) return Number.NaN;
	const rank = (p / 100) * (sorted.length - 1);
	const lower = Math.floor(rank);
	const upper = Math.ceil(rank);
	const low = sorted[lower]!;
	const high = sorted[upper]!;
	return low + (high - low) * (rank - lower);
}

export interface MetricStats {
	mean: number;
	p50: number;
	p90: number;
	p99: number;
}

export function summarizeMetric(values: readonly number[]): MetricStats | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((left, right) => left - right);
	const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
	return { mean, p50: percentile(sorted, 50), p90: percentile(sorted, 90), p99: percentile(sorted, 99) };
}

export interface ModelWindowStats {
	key: string;
	responses: number;
	failures: Record<FailureKind, number>;
	ttft?: MetricStats;
	total?: MetricStats;
	tps?: MetricStats;
}

export interface WindowSummary {
	label: string;
	models: ModelWindowStats[];
}

/** Per-window, per-model aggregates over `records`, most active model first. */
export function summarize(records: readonly StatsRecord[], now: number): WindowSummary[] {
	return WINDOWS.map((window) => {
		const cutoff = now - window.ms;
		const byKey = new Map<string, { samples: ResponseSample[]; failures: Record<FailureKind, number> }>();
		for (const record of records) {
			if (record.ts < cutoff) continue;
			let bucket = byKey.get(record.key);
			if (!bucket) {
				bucket = { samples: [], failures: { aborted: 0, timeout: 0, error: 0 } };
				byKey.set(record.key, bucket);
			}
			if (record.type === "ok") bucket.samples.push(record);
			else bucket.failures[record.kind] += 1;
		}
		const models = [...byKey.entries()]
			.map(([key, bucket]): ModelWindowStats => {
				const sampled = bucket.samples;
				return {
					key,
					responses: sampled.length,
					failures: bucket.failures,
					ttft: summarizeMetric(sampled.map((sample) => sample.ttftMs)),
					total: summarizeMetric(sampled.map((sample) => sample.totalMs)),
					tps: summarizeMetric(sampled.map(tokensPerSecond)),
				};
			})
			.sort(
				(left, right) =>
					right.responses + failureTotal(right) - (left.responses + failureTotal(left)) ||
					left.key.localeCompare(right.key),
			);
		return { label: window.label, models };
	});
}

function failureTotal(model: ModelWindowStats): number {
	return model.failures.aborted + model.failures.timeout + model.failures.error;
}

/** Drop records at or past the retention cutoff (epoch milliseconds). */
export function pruneRecords(records: readonly StatsRecord[], cutoff: number): StatsRecord[] {
	return records.filter((record) => record.ts >= cutoff);
}

/** Parse one JSONL record, or undefined for blank/malformed lines. */
export function parseStatsLine(line: string): StatsRecord | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	const record = parsed as {
		type?: unknown;
		ts?: unknown;
		key?: unknown;
		kind?: unknown;
		ttftMs?: unknown;
		totalMs?: unknown;
		outputTokens?: unknown;
	};
	if (!isFiniteNumber(record.ts) || typeof record.key !== "string" || !record.key.includes("/")) return undefined;
	if (record.type === "fail") {
		return record.kind === "aborted" || record.kind === "timeout" || record.kind === "error"
			? { type: "fail", ts: record.ts, key: record.key, kind: record.kind }
			: undefined;
	}
	if (record.type === "ok") {
		if (!isFiniteNumber(record.ttftMs) || !isFiniteNumber(record.totalMs) || !isFiniteNumber(record.outputTokens))
			return undefined;
		return { type: "ok", ts: record.ts, key: record.key, ttftMs: record.ttftMs, totalMs: record.totalMs, outputTokens: record.outputTokens };
	}
	return undefined;
}

export function serializeStatsRecord(record: StatsRecord): string {
	return JSON.stringify(record);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

const FAILURE_KINDS: readonly FailureKind[] = ["aborted", "timeout", "error"];
const FAILURE_HEADERS: Record<FailureKind, string> = { aborted: "abrt", timeout: "tout", error: "err" };
const FAILURE_WIDTH = 4;
const METRIC_CELL = 6;
const METRIC_BLOCK = METRIC_CELL * 4;
const MODEL_MAX_WIDTH = 30;

function right(text: string, width: number): string {
	return text.length >= width ? text : `${" ".repeat(width - text.length)}${text}`;
}

function fit(text: string, width: number): string {
	if (text.length > width) return `${text.slice(0, Math.max(0, width - 1))}…`;
	return text + " ".repeat(width - text.length);
}

function seconds(ms: number): string {
	const value = ms / 1000;
	return value < 100 ? value.toFixed(1) : String(Math.round(value));
}

function rate(tokensPerSec: number): string {
	return tokensPerSec < 100 ? tokensPerSec.toFixed(1) : String(Math.round(tokensPerSec));
}

function metricBlock(stats: MetricStats | undefined, format: (value: number) => string): string {
	if (!stats) return right("-", METRIC_BLOCK);
	return [stats.mean, stats.p50, stats.p90, stats.p99].map((value) => right(format(value), METRIC_CELL)).join("");
}

const SUB_HEADER = ["mean", "p50", "p90", "p99"].map((label) => right(label, METRIC_CELL)).join("");

/** One window's table: a group header row, a sub-header row, one row per model. */
export function renderWindow(summary: WindowSummary): string[] {
	if (summary.models.length === 0) return ["(no samples)"];
	const modelWidth = Math.max(5, Math.min(MODEL_MAX_WIDTH, Math.max(...summary.models.map((model) => model.key.length))));
	const counterWidth = FAILURE_KINDS.length * FAILURE_WIDTH + (FAILURE_KINDS.length - 1);
	const counterHeader = FAILURE_KINDS.map((kind) => right(FAILURE_HEADERS[kind], FAILURE_WIDTH)).join(" ");
	const header = `${fit("", modelWidth)} ${right("n", 4)} ${counterHeader}  ${fit("ttft s", METRIC_BLOCK)}  ${fit("total s", METRIC_BLOCK)}  ${fit("tok/s", METRIC_BLOCK)}`;
	const subHeader = `${fit("model", modelWidth)} ${" ".repeat(4)} ${" ".repeat(counterWidth)}  ${SUB_HEADER}  ${SUB_HEADER}  ${SUB_HEADER}`;
	const rows = summary.models.map((model) => {
		const tally = FAILURE_KINDS.map((kind) => right(model.failures[kind] > 0 ? String(model.failures[kind]) : "", FAILURE_WIDTH)).join(" ");
		return `${fit(model.key, modelWidth)} ${right(String(model.responses), 4)} ${tally}  ${metricBlock(model.ttft, seconds)}  ${metricBlock(model.total, seconds)}  ${metricBlock(model.tps, rate)}`;
	});
	return [header, subHeader, ...rows];
}
