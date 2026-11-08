/**
 * Reader dispatch for web_read — fallback orchestration across multiple
 * content extraction backends (Jina, Sofya, Firecrawl, Exa, Exa MCP).
 *
 * The single-reader logic lives in single.ts; this module adds retry/fallback.
 */

import { boundedOperation, TimeoutError, type SharedRuntime } from "../engine/runtime.js";
import { resolveTimeouts } from "../engine/policy.js";
import type { SearchConfig } from "../types.js";
import { fetchWithReader, readerLabel } from "./single.js";
import type { FetchParams, FetchResult } from "./single.js";

export type { FetchParams, FetchResult } from "./single.js";
export { fetchWithReader, readerLabel } from "./single.js";

/** Default fallback order for readers. */
export const DEFAULT_READER_FALLBACK = ["jina", "sofya", "firecrawl", "exa", "exa_mcp"];

/**
 * Determine whether a reader error is retryable (transient) or fatal (auth).
 *
 * Retryable: 422, 5xx, network errors, timeouts, "no content" messages.
 * Fatal: 401, 403 — configuration problems, not transient.
 */
function isRetryableError(err: Error): boolean {
	const msg = err.message;
	// Auth errors — do NOT retry
	if (/\b(401|403)\b/.test(msg) || /unauthorized|forbidden/i.test(msg)) {
		return false;
	}
	// Everything else is retryable
	return true;
}

/**
 * Try readers in fallback order until one succeeds.
 *
 * @param url       - The URL to fetch (already validated for SSRF).
 * @param readers   - Ordered list of reader backends to try.
 * @param params    - Additional parameters (fresh, keywords, mode, objective).
 * @param signal    - Optional abort signal.
 * @param config    - Search config for credential resolution.
 * @param onAttempt - Optional callback fired when an attempt is dispatched (not while queued).
 * @returns The fetched content and the reader that served it.
 */
export async function fetchWithFallback(
	url: string,
	readers: string[],
	params: FetchParams,
	signal: AbortSignal | undefined,
	config: SearchConfig,
	onAttempt?: (reader: string, index: number, total: number) => void,
	onOutcome?: (reader: string, status: "success" | "failed" | "cancelled" | "timeout") => void,
	runtime?: SharedRuntime,
): Promise<FetchResult> {
	if (!signal) return boundedOperation(inner => fetchWithFallback(url, readers, params, inner, config, onAttempt, onOutcome, runtime), resolveTimeouts(config.timeouts).overallMs, undefined, 0);
	const errors: Array<{ reader: string; error: string }> = [];

	for (let i = 0; i < readers.length; i++) {
		signal?.throwIfAborted();
		const candidate = readers[i];
		let attempted = false, outcomeReported = false;
		let cleanupAbort: (() => void) | undefined;
		const outcome = (status: "success" | "failed" | "cancelled" | "timeout") => {
			if (!attempted || outcomeReported) return;
			outcomeReported = true;
			onOutcome?.(candidate, status);
		};
		const isTimeout = (error: unknown) => error instanceof TimeoutError || (error instanceof Error && error.name === "TimeoutError");

		try {
			const timeoutMs = config.sources?.[candidate]?.timeoutMs ?? config.backends?.[candidate]?.timeout ?? resolveTimeouts(config.timeouts).readerMs;
			const read = (attemptSignal: AbortSignal) => {
				attempted = true;
				// Report logical cancellation synchronously, even if the transport
				// ignores it and the outer overall operation returns before catch runs.
				const abort = () => outcome(isTimeout(attemptSignal.reason) ? "timeout" : "cancelled");
				attemptSignal.addEventListener("abort", abort, { once: true });
				cleanupAbort = () => attemptSignal.removeEventListener("abort", abort);
				onAttempt?.(candidate, i, readers.length);
				return fetchWithReader(url, candidate, params, attemptSignal, config);
			};
			const result = runtime
				? await runtime.operation(candidate, timeoutMs, signal, 0, read)
				: await boundedOperation(read, timeoutMs, signal, 0);
			// A resolved call with no content did not read the page. Firecrawl
			// /v2/scrape does this when `data` exists but `markdown` is empty;
			// other readers can return a blank body too. Treat it as a retryable
			// failure so the chain continues.
			if (result.content.trim().length === 0) {
				throw new Error(`${candidate} returned no content for ${url}`);
			}
			signal?.throwIfAborted();
			outcome("success");
			return result;
		} catch (err) {
			outcome(isTimeout(err) || isTimeout(signal?.reason) ? "timeout" : signal?.aborted ? "cancelled" : "failed");
			signal?.throwIfAborted();
			const errorMsg = (err as Error).message;
			errors.push({ reader: candidate, error: errorMsg });

			// Auth errors are fatal — do not fall through
			if (!isRetryableError(err as Error)) {
				throw err;
			}

			// Last reader failed — throw combined error
			if (i === readers.length - 1) {
				const summary = errors
					.map(e => `${e.reader}: ${e.error}`)
					.join("; ");
				throw new Error(`All readers failed: ${summary}`);
			}
		} finally {
			cleanupAbort?.();
		}
	}

	// Should not reach here, but satisfy TS
	throw new Error("All readers failed: no readers in fallback list");
}
