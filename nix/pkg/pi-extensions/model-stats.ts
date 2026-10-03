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
 * ~/.pi/agent/model-stats.jsonl). Every PRUNE_EVERY appends the file is
 * rewritten without records older than a week (the longest window); a racing
 * concurrent session can lose the records it appended during the rewrite —
 * accepted for stats. /perf renders mean/p50/p90/p99 tables per model for the
 * last hour, 24 hours, and week.
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
	parseStatsLine,
	pruneRecords,
	renderWindow,
	serializeStatsRecord,
	summarize,
	WEEK_MS,
	type StatsRecord,
} from "./model-stats-state.ts";

const PRUNE_EVERY = 64;
const VIEWPORT = 26;

function statsPath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(dir, "model-stats.jsonl");
}

function readRecords(): StatsRecord[] {
	let raw: string;
	try {
		raw = readFileSync(statsPath(), "utf-8");
	} catch {
		return [];
	}
	return raw.split("\n").flatMap((line) => {
		const record = parseStatsLine(line);
		return record ? [record] : [];
	});
}

function writePruned(path: string): void {
	const kept = pruneRecords(readRecords(), Date.now() - WEEK_MS);
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, kept.map((record) => serializeStatsRecord(record) + "\n").join(""), "utf-8");
	renameSync(temporary, path);
}

class StatsView implements Component {
	private offset = 0;
	private readonly theme: Theme;
	private readonly lines: readonly string[];
	private readonly onClose: () => void;

	constructor(theme: Theme, lines: readonly string[], onClose: () => void) {
		this.theme = theme;
		this.lines = lines;
		this.onClose = onClose;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const end = Math.min(this.lines.length, this.offset + VIEWPORT);
		const body = this.lines.slice(this.offset, end).map((line) => truncateToWidth(line, width));
		const position = this.lines.length > VIEWPORT ? `↑↓ scroll · ${end}/${this.lines.length} · ` : "";
		return [...body, this.theme.fg("dim", `${position}⎋ close`)];
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || parseKey(data) === "q") {
			this.onClose();
			return;
		}
		const last = Math.max(0, this.lines.length - VIEWPORT);
		if (matchesKey(data, "up")) this.offset = Math.max(0, this.offset - 1);
		else if (matchesKey(data, "down")) this.offset = Math.min(last, this.offset + 1);
		else if (matchesKey(data, "pageUp")) this.offset = Math.max(0, this.offset - VIEWPORT);
		else if (matchesKey(data, "pageDown")) this.offset = Math.min(last, this.offset + VIEWPORT);
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
			await ctx.ui.custom<void>(
				(_tui, theme, _kb, done) => {
					const lines: string[] = [];
					for (const windowSummary of summaries) {
						if (lines.length > 0) lines.push("");
						lines.push(theme.fg("accent", windowSummary.label));
						lines.push(...renderWindow(windowSummary));
					}
					return new StatsView(theme, lines, () => done());
				},
				{ overlay: true, overlayOptions: { anchor: "center", width: 120, maxHeight: 32, margin: 1 } },
			);
		},
	});
}
