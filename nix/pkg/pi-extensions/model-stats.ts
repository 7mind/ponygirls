/**
 * model-stats — per-model response-time distributions and a /perf command.
 *
 * Each provider request is anchored at before_provider_headers (fired per HTTP
 * call, so a retry re-anchors) and the first provider_stream_event after it is
 * the first-token mark. An assistant message_end finalizes the sample: ttft and
 * total span, plus output tokens for a decode-span tok/s rate. Aborted, timed
 * out, and errored responses are not sampled; they count in per-kind counters.
 * Pi's internal retries never reach message_end, so only the final attempt of
 * a request is measured; nested streamSimple calls run between turns and cannot
 * clobber an open anchor.
 *
 * Records persist as JSONL in $PI_CODING_AGENT_DIR/model-stats.jsonl (default
 * ~/.pi/agent/model-stats.jsonl). Lines that do not parse, and ok samples whose
 * decode span is not a measurement, are dropped from that file on load. Every
 * PRUNE_EVERY appends the file is also rewritten without records older than a
 * week (the longest window); a racing concurrent session can lose the records
 * it appended during the rewrite — accepted for stats. /perf replaces the
 * editor with mean/p50/p90/p99 tables
 * per model for the last hour, 24 hours, and week — the same in-place custom
 * view as /usage, not an overlay.
 *
 * Wire-up: listed in nix/hm/pi.nix `programs.pi.settings.extensions`.
 */

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, parseKey, truncateToWidth } from "@earendil-works/pi-tui";

import {
	classifyOutcome,
	isUsableRecord,
	parseStatsLine,
	pruneRecords,
	renderWindow,
	serializeStatsRecord,
	summarize,
	WEEK_MS,
	type StatsRecord,
} from "./model-stats-state.ts";

const PRUNE_EVERY = 64;

function statsPath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(dir, "model-stats.jsonl");
}

function writeRecords(path: string, records: readonly StatsRecord[]): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, records.map((record) => serializeStatsRecord(record) + "\n").join(""), "utf-8");
	renameSync(temporary, path);
}

/** Parsed usable records. Non-blank lines that do not parse, or that are not a measurement, are removed from the file. */
function readRecords(): StatsRecord[] {
	const path = statsPath();
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return [];
	}
	const kept: StatsRecord[] = [];
	let dropped = 0;
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		const record = parseStatsLine(line);
		if (!record || !isUsableRecord(record)) {
			dropped += 1;
			continue;
		}
		kept.push(record);
	}
	if (dropped > 0) {
		try {
			writeRecords(path, kept);
		} catch {
			// The in-memory view is still filtered; a rewrite failure must not hide stats.
		}
	}
	return kept;
}

function writePruned(path: string): void {
	writeRecords(path, pruneRecords(readRecords(), Date.now() - WEEK_MS));
}

class StatsView implements Component {
	private readonly theme: Theme;
	private readonly summaries: ReturnType<typeof summarize>;
	private readonly onClose: () => void;

	constructor(theme: Theme, summaries: ReturnType<typeof summarize>, onClose: () => void) {
		this.theme = theme;
		this.summaries = summaries;
		this.onClose = onClose;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		for (const windowSummary of this.summaries) {
			if (lines.length > 0) lines.push("");
			lines.push(this.theme.fg("accent", windowSummary.label));
			lines.push(...renderWindow(windowSummary, width));
		}
		const rule = this.theme.fg("border", "─".repeat(Math.max(1, width)));
		return [rule, ...lines.map((line) => truncateToWidth(line, width)), "", this.theme.fg("dim", "[q] close"), rule];
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || parseKey(data) === "q") this.onClose();
	}
}

export default function (pi: ExtensionAPI): void {
	/** Open request attempt; before_provider_headers is the dispatch anchor. */
	let attempt: { startedAt: number; firstTokenAt?: number } | undefined;
	let writesSincePrune = 0;

	pi.on("before_provider_headers", () => {
		attempt = { startedAt: Date.now() };
	});

	pi.on("provider_stream_event", () => {
		if (attempt && attempt.firstTokenAt === undefined) attempt.firstTokenAt = Date.now();
	});

	pi.on("message_end", (event) => {
		const open = attempt;
		attempt = undefined;
		if (!open || event.message.role !== "assistant") return;
		const message = event.message;
		const finishedAt = Date.now();
		const key = `${message.provider}/${message.model}`;
		const outcome = classifyOutcome(message.stopReason, message.errorMessage);
		const record: StatsRecord =
			outcome === "ok"
				? {
						type: "ok",
						ts: finishedAt,
						key,
						ttftMs: (open.firstTokenAt ?? finishedAt) - open.startedAt,
						totalMs: finishedAt - open.startedAt,
						outputTokens: message.usage.output,
					}
				: { type: "fail", ts: finishedAt, key, kind: outcome };
		if (!isUsableRecord(record)) return;
		try {
			const path = statsPath();
			mkdirSync(dirname(path), { recursive: true });
			appendFileSync(path, `${serializeStatsRecord(record)}\n`, "utf-8");
			writesSincePrune += 1;
			if (writesSincePrune >= PRUNE_EVERY) {
				writesSincePrune = 0;
				writePruned(path);
			}
		} catch {
			// Stats are best-effort; a storage failure must not disturb the turn.
		}
	});

	pi.registerCommand("perf", {
		description: "Per-model response-time distributions (last hour / 24h / week)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/perf needs the interactive UI", "warning");
				return;
			}
			const summaries = summarize(readRecords(), Date.now());
			// In place, replacing the editor, as /usage does. An overlay is a popup.
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => new StatsView(theme, summaries, () => done()));
		},
	});
}
