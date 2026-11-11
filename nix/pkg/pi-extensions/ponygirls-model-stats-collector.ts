/** Headless /perf collection shared by interactive sessions and isolated workers. */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	classifyOutcome, isUsableRecord, parseStatsLine, pruneRecords,
	serializeStatsRecord, WEEK_MS, type StatsRecord,
} from "./ponygirls-model-stats-state.ts";

const PRUNE_EVERY = 64;

function writeRecords(path: string, records: readonly StatsRecord[]): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, records.map((record) => serializeStatsRecord(record) + "\n").join(""), "utf-8");
	renameSync(temporary, path);
}

/** Invalid lines are removed on load; storage remains best-effort. */
export function readStatsRecords(path: string): StatsRecord[] {
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

export function registerStatsCollector(pi: ExtensionAPI, agentDir: string): void {
	const path = join(agentDir, "model-stats.jsonl");
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
		const effort = message.thinkingLevel === undefined ? {} : { effort: message.thinkingLevel };
		const record: StatsRecord = outcome === "ok"
			? { type: "ok", ts: finishedAt, key, ttftMs: (open.firstTokenAt ?? finishedAt) - open.startedAt,
				totalMs: finishedAt - open.startedAt, outputTokens: message.usage.output, ...effort }
			: { type: "fail", ts: finishedAt, key, kind: outcome, ...effort };
		if (!isUsableRecord(record)) return;
		try {
			mkdirSync(dirname(path), { recursive: true });
			appendFileSync(path, `${serializeStatsRecord(record)}\n`, "utf-8");
			writesSincePrune += 1;
			if (writesSincePrune >= PRUNE_EVERY) {
				writesSincePrune = 0;
				writeRecords(path, pruneRecords(readStatsRecords(path), Date.now() - WEEK_MS));
			}
		} catch {
			// Stats are best-effort; a storage failure must not disturb the turn.
		}
	});
}
