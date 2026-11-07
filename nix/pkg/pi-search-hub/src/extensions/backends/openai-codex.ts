import { discoverNativeEngines, type NativeDiscoveryContext, type NativeSearchResponse } from "../native.js";
import type { BackendConfig, SearchResult } from "../types.js";

const DEFAULT_SEARCH_CONTEXT_SIZE = "low";
const MAX_TOOL_RESULTS = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 1000;

/** Compatibility alias. Credentials and endpoints must come from this session's registry. */
export async function searchOpenAICodex(
	query: string,
	numResults: number,
	signal?: AbortSignal,
	_backendConfig?: BackendConfig,
	ctx?: NativeDiscoveryContext,
): Promise<NativeSearchResponse> {
	if (!ctx) throw new Error("OpenAI search requires the active Pi model registry context");
	const engine = (await discoverNativeEngines(ctx, signal)).find((candidate) => candidate.id === "openai");
	if (!engine) throw new Error("No configured OpenAI native web-search model is available");
	return engine.search(query, numResults, signal);
}

export function injectCodexSearchPayload(payload: unknown): unknown {
	const body = isRecord(payload) ? payload : {};
	const existingTools = Array.isArray(body.tools) ? body.tools.filter(Boolean) : [];
	const filteredTools = existingTools.filter((tool) => {
		if (!isRecord(tool)) return true;
		return tool.type !== "web_search";
	});

	body.tools = [
		{
			type: "web_search",
			external_web_access: true,
			search_context_size: DEFAULT_SEARCH_CONTEXT_SIZE,
		},
		...filteredTools,
	];
	body.tool_choice = "auto";
	body.parallel_tool_calls = false;

	const include = Array.isArray(body.include)
		? body.include.filter((value): value is string => typeof value === "string")
		: [];
	body.include = Array.from(new Set([...include, "web_search_call.action.sources"]));

	return body;
}

export function normalizeSubmitSearchResults(args: unknown, numResults: number): SearchResult[] {
	if (!isRecord(args) || !Array.isArray(args.results)) {
		return [];
	}

	const limit = Math.max(1, Math.min(numResults, MAX_TOOL_RESULTS));
	const deduped = new Set<string>();
	const results: SearchResult[] = [];

	for (const rawResult of args.results) {
		const normalized = normalizeSearchResult(rawResult);
		if (!normalized) continue;

		const dedupeKey = normalizeUrlForDedup(normalized.url);
		if (deduped.has(dedupeKey)) continue;

		deduped.add(dedupeKey);
		results.push(normalized);
		if (results.length >= limit) break;
	}

	return results;
}

export function normalizeSearchResult(rawResult: unknown): SearchResult | null {
	if (!isRecord(rawResult)) return null;

	const url = normalizeHttpUrl(rawResult.url);
	if (!url) return null;

	const fallbackTitle = safeUrlHostname(url);
	const title = truncateText(cleanString(rawResult.title) || fallbackTitle, MAX_TITLE_LENGTH);
	const snippet = truncateText(cleanString(rawResult.snippet), MAX_SNIPPET_LENGTH);
	const content = truncateText(cleanString(rawResult.content), MAX_SNIPPET_LENGTH);
	const display = snippet || content;
	if (!display) return null;

	return {
		title,
		url,
		snippet: display,
		content: display,
	};
}

export function normalizeHttpUrl(value: unknown): string | undefined {
	const input = cleanString(value);
	if (!input) return undefined;

	const candidate = hasUrlScheme(input)
		? input
		: looksLikeDomainOrPath(input)
			? `https://${input}`
			: input;

	try {
		const url = new URL(candidate);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return undefined;
		}
		url.hash = "";
		return url.toString();
	} catch {
		return undefined;
	}
}

export function normalizeUrlForDedup(url: string): string {
	try {
		const normalized = new URL(url);
		normalized.hash = "";
		normalized.pathname = normalized.pathname.replace(/\/+$/, "") || "/";
		return normalized.toString().toLowerCase();
	} catch {
		return url.trim().toLowerCase();
	}
}

function safeUrlHostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

function cleanString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function truncateText(value: string, maxLength: number): string {
	return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function hasUrlScheme(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

export function looksLikeDomainOrPath(value: string): boolean {
	return /^[^\s/]+\.[^\s]+(?:\/.*)?$/.test(value);
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}
