/**
 * Extension — Unified web search (19 backends) + content extraction (web_read)
 *
 * Backends (choose any, all disabled by default):
 *   duckduckgo    — ✅ Free, no key, via Python ddgs lib. Rate-limited.
 *   jina          — ✅ Free tier (API key optional for higher rate limits), full markdown via s.jina.ai
 *   marginalia    — ✅ Anti-SEO, "public" key optional. 354ms avg
 *   serper        — ✅ Google via serper.dev, 2500 free/mo. 667ms
 *   brave         — ✅ Brave Search, 2000 free/mo. 460ms
 *   tavily        — ✅ AI search, 1000 free/mo. 356ms BEST QUALITY
 *   exa           — ✅ AI-native, 1000 free/mo. 137ms FASTEST
 *   firecrawl     — ✅ Search+crawl, keyless 1000 credits/mo (optional key). 644ms
 *   langsearch    — ✅ Free tier, no CC. 1816ms
 *   websearchapi  — ✅ Google-powered, 2000 free credits. 1323ms
 *   perplexity    — ✅ Unlimited free Sonar, citation-based answers
 *   searxng       — ✅ Self-hosted, 70+ aggregators. Needs instance URL
 *
 * Tools: web_search (auto-fallback + RRF combine modes), web_read (URL content)
 * Config: ~/.pi/agent/extensions/search.json + .pi/search.json (project wins)
 * Credentials: env var refs (ALL_CAPS), shell commands (!command), or literal keys
 *
 * /websearch opens the session statistics and interactive search panel.
 *
 * Example .pi/search.json:
 *   {
 *     "defaultBackend": "auto",
 *     "backends": {
 *       "duckduckgo": { "enabled": true },
 *       "marginalia": { "enabled": true },
 *       "serper": { "enabled": true, "apiKey": "..." },
 *       "tavily": { "enabled": true, "apiKey": "..." },
 *       "exa": { "enabled": true, "apiKey": "..." },
 *       "firecrawl": { "enabled": true, "apiKey": "..." },
 *       "langsearch": { "enabled": true, "apiKey": "..." },
 *       "websearchapi": { "enabled": true, "apiKey": "..." },
 *       "perplexity": { "enabled": true, "apiKey": "..." },
 *       "searxng": { "enabled": true, "instanceUrl": "http://localhost:8888" }
 *     }
 *   }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CustomViewToggle } from "@ponygirls/pi-ui";
import { SearchService } from "./search-service.js";
import { WebSearchView } from "./websearch-view.js";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import type { BackendConfig, SearchConfig } from "./types.js";
import { getAgentDir, clearCooldowns, validateUrl } from "./utils.js";
import { getKeySource } from "./credentials.js";
import { fetchWithFallback, DEFAULT_READER_FALLBACK } from "./readers/dispatch.js";
import { config, refreshConfig, getActiveBackends, latencyMap } from "./config.js";
import { BACKEND_DEFS } from "./backends/registry.js";
import { registerPaperResearch } from "./papers/tool.js";



interface InputOptions { placeholder: string; validate?: (value: string) => string | undefined }
async function setupInput(ctx: ExtensionContext, label: string, options: InputOptions): Promise<string | undefined> {
	const value = await ctx.ui.input(label, options.placeholder);
	if (value === undefined) return undefined;
	const error = options.validate === undefined ? undefined : options.validate(value);
	if (error !== undefined) { ctx.ui.notify(error, "error"); return undefined; }
	return value;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	registerPaperResearch(pi);
	let service = new SearchService();
	let pane = new CustomViewToggle();
	// -----------------------------------------------------------------------
	// Tool: web_search
	// -----------------------------------------------------------------------

	const registerSearch = (names: string[]) => pi.registerTool(defineTool({
		name: "web_search",
		label: "Web Search",
		description:
			`Search the web. Configured engines: ${names.join(", ")}. ` +
			"Automatic metasearch always queries the fallback and configured native-provider tiers, " +
			"while the main tier follows its selection/combine rules. Results are fused with URL deduplication and source attribution. " +
			"A named backend runs only that engine. Use combine=true for broader main-tier coverage.",
		promptSnippet: "Search the web (supports multiple search backends)",
		promptGuidelines: [
			"Use web_search when you need up-to-date information, facts, or documentation from the web",
			"Auto mode always queries fallback and native-provider tiers beside the selected main engines",
			"Set combine=true to query more main engines and merge/deduplicate all tier results",
			"Set combineMode=targeted in search.json to cap combine fan-out while still using multiple backends",
			"Configure additional backends in .pi/search.json for better quality results",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "Search query (natural language works best)",
			}),
			numResults: Type.Optional(
				Type.Number({
					description: "Number of results (1-20, default 10)",
					default: 10,
				}),
			),
			backend: Type.Optional(
				StringEnum([...names, ...(names.includes("native:openai-codex") ? ["openai-codex"] : []), "auto"], {
					description:
						"Backend to use. 'auto' picks the best configured backend (default)",
				}),
			),
			combine: Type.Optional(
				Type.Boolean({
					description:
						"When true, queries enabled backends in parallel and merges/deduplicates results. " +
						"Config combineMode controls whether this uses all backends or targeted fan-out. " +
						"Default is false (first successful main engine, alongside fallback and native tiers). " +
						"Ignored when a specific backend is requested (backend != 'auto').",
					default: false,
				}),
			),
			compact: Type.Optional(
				Type.Boolean({
					description:
						"When true, returns compact single-line results (title + URL). " +
						"Can also be set as default in search.json config. Default: false (verbose).",
					default: false,
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return service.search(params, signal, ctx);
		},
	}));
	registerSearch(["duckduckgo"]);
	const refreshTool = () => {
		const active = pi.getActiveTools();
		registerSearch(service.engines().filter(engine => engine.tier !== "reader").map(engine => engine.name));
		if (!active.includes("web_search")) pi.setActiveTools(pi.getActiveTools().filter(name => name !== "web_search"));
	};

	// -----------------------------------------------------------------------
	// Tool: web_read — Read/extract content from a URL
	// -----------------------------------------------------------------------

	pi.registerTool(defineTool({
		name: "web_read",
		label: "Read Web Page",
		description:
			"Fetch a URL as markdown. Use objective for a concrete question, keywords for long pages, " +
			"rush for speed, smart for better narrowing. Use reader param to switch between " +
			"Jina (default, free) and Sofya (250+ site parsers, needs API key).",
		promptSnippet: "Read content from a web page (supports markdown extraction)",
		promptGuidelines: [
			"Use web_read when you need to read the content of a specific URL",
			"Set objective for a concrete question when only part of the page matters",
			"Add keywords for long pages when you know the relevant terms",
			"Choose rush for speed or smart for higher-quality narrowing",
		],
		parameters: Type.Object({
			url: Type.String({
				description: "HTTP(S) URL or bare domain to fetch",
			}),
			fresh: Type.Optional(
				Type.Boolean({
					description: "Bypass cache when freshness matters",
				}),
			),
			keywords: Type.Optional(
				Type.Array(Type.String(), {
					description: "Keyword to focus extraction on relevant sections",
				}),
			),
			mode: Type.Optional(
				StringEnum(["rush", "smart"] as const, {
					description: "rush = faster mode, smart = better section selection on long/noisy pages",
				}),
			),
			objective: Type.Optional(
				Type.String({
					description:
						"CSS selector for targeted extraction. Use when only part of the page matters. (Jina reader only.)",
				}),
			),
			reader: Type.Optional(
				StringEnum(["jina", "sofya", "firecrawl", "exa", "exa_mcp"] as const, {
					description:
						"Reader backend: 'jina' (default, free, supports keywords/mode/objective), " +
						"'sofya' (250+ site-specific parsers, needs API key), " +
						"'firecrawl' (keyless, 1000 credits/mo), " +
						"'exa' (needs API key, 1000 req/mo), or " +
						"'exa_mcp' (zero-config, rate-limited). Overrides the configured default.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			refreshConfig(ctx.cwd);

			const url = params.url.startsWith("https://") || params.url.startsWith("http://")
				? params.url
				: `https://${params.url}`;

			const reader = params.reader ?? config.reader ?? "jina";

			// SSRF guard — block private/internal addresses regardless of reader.
			const ssrfError = validateUrl(url);
			if (ssrfError) {
				throw new Error(ssrfError);
			}

			// Build fallback chain: requested reader first, then the rest from default order
			const readerFallback = config.readerFallback ?? DEFAULT_READER_FALLBACK;
			const fallbackChain = [
				reader,
				...readerFallback.filter(r => r !== reader),
			];

			const finishes = new Map<string, ReturnType<typeof service.monitor.begin>>();
			const result = await fetchWithFallback(
				url,
				fallbackChain,
				{ fresh: params.fresh, keywords: params.keywords, mode: params.mode, objective: params.objective },
				signal,
				config,
				(candidate) => {
					finishes.set(candidate, service.monitor.begin({ name: `reader:${candidate}`, label: candidate, tier: "reader", availability: "configured" }));
				},
				(candidate, status) => finishes.get(candidate)!({ status, resultCount: status === "success" ? 1 : 0 }),
			);

			if (result.warning) {
				ctx.ui.notify(result.warning, "warning");
			}

			const truncated = result.content.length > 10000
				? result.content.slice(0, 10000) + `\n\n[... truncated, full length: ${result.content.length} chars]`
				: result.content;

			return {
				content: [{ type: "text", text: truncated }],
				details: {
					url,
					reader: result.reader,
					length: result.content.length,
					truncated: result.content.length > 10000,
				},
			};
		},
	}));

	// -----------------------------------------------------------------------
	// Commands
	// -----------------------------------------------------------------------

	pi.registerCommand("search-setup", {
		description: "Configure search backends interactively",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/search-setup requires interactive mode", "error");
				return;
			}

			// Build backend list with rate limits for free backends
			const backendList = Object.entries(BACKEND_DEFS)
				.filter(([_, d]) => d.setupLabel !== null)
				.map(([k, d]) => {
					let label = d.setupLabel!;
					// Add rate limit hints for free backends
					if (k === "duckduckgo") label += " (rate-limited)";
					if (k === "marginalia") label += " (rate-limited)";
					if (k === "jina") label += " (1000/mo free)";
					if (k === "exa_mcp") label += " (rate-limited)";
					if (k === "searxng") label += " (self-hosted)";
				return label;
			});

			const option = await ctx.ui.select("Which backend do you want to configure?", [
				...backendList,
				"⚡ Enable all free backends",
				"⚙️ Global settings",
				"✅ Done — save and exit",
			]);

			const backendKey: Record<string, string> = Object.fromEntries(
				Object.entries(BACKEND_DEFS)
					.filter(([_, d]) => d.setupLabel !== null)
					.map(([k, d]) => {
						let label = d.setupLabel!;
						if (k === "duckduckgo") label += " (rate-limited)";
						if (k === "marginalia") label += " (rate-limited)";
						if (k === "jina") label += " (1000/mo free)";
						if (k === "exa_mcp") label += " (rate-limited)";
						if (k === "searxng") label += " (self-hosted)";
					return [label, k];
				})
			);

			if (!option || option.startsWith("✅ Done")) {
				ctx.ui.notify("Search setup complete.", "info");
				return;
			}

			if (option === "⚙️ Global settings") {
				await configureGlobalSettings(ctx);
				return;
			}

			if (option === "⚡ Enable all free backends") {
				await enableAllFreeBackends(ctx);
				return;
			}

			const backend = backendKey[option!];
			const def = BACKEND_DEFS[backend];
			const label = option;

			// Free backends (needsKey: false) can be enabled without API key
			if (!def.needsKey) {
				// Auto-enable free backends directly
				const configDir = join(getAgentDir(), "extensions");
				const configPath = join(configDir, "search.json");
				mkdirSync(configDir, { recursive: true });

				let existing: SearchConfig = {};
				if (existsSync(configPath)) {
					try {
						existing = JSON.parse(readFileSync(configPath, "utf-8"));
					} catch {
						// ignore
					}
				}

				// Handle backends needing instance URL (e.g. SearXNG)
				let backendConfig: BackendConfig = { enabled: true };
				if (def.needsInstanceUrl) {
					const instanceUrl = await setupInput(ctx, "Enter your instance URL (e.g. http://localhost:8888):", {
						placeholder: "http://localhost:8888",
						validate: (v: string) =>
							v.trim().length > 0 ? undefined : "URL cannot be empty",
					});
					if (!instanceUrl) {
						ctx.ui.notify("Setup cancelled.", "info");
						return;
					}
					backendConfig.instanceUrl = instanceUrl.trim();
					// Optionally ask for API key (some instances require auth)
					const optKey = await setupInput(ctx, "Optional API key (press Enter to skip):", {
						placeholder: "sk-... (optional)",
				});
					if (optKey && optKey.trim()) {
						backendConfig.apiKey = optKey.trim();
					}
				} else if (def.optionalKey) {
					// Optionally ask for API key if optional
					const optKey = await setupInput(ctx, "Optional API key (press Enter to skip):", {
						placeholder: "sk-... (optional)",
					});
					if (optKey && optKey.trim()) {
						backendConfig.apiKey = optKey.trim();
					}
				}

				const updated: SearchConfig = {
					...existing,
					backends: {
						...existing.backends,
						[backend]: backendConfig,
					},
				};

				writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n", { mode: 0o600 });
				ctx.ui.notify(`${label} enabled. Run /reload to activate.`, "info");
				return;
			}

			const key = await setupInput(ctx, `Enter your ${label} API key:`, {
				placeholder: "sk-...",
				validate: (v: string) =>
					v.trim().length > 0 ? undefined : "Key cannot be empty",
			});

			if (!key) {
				ctx.ui.notify("Setup cancelled.", "info");
				return;
			}

			const configDir = join(getAgentDir(), "extensions");
			const configPath = join(configDir, "search.json");

			mkdirSync(configDir, { recursive: true });

			let existing: SearchConfig = {};
			if (existsSync(configPath)) {
				try {
					existing = JSON.parse(readFileSync(configPath, "utf-8"));
				} catch {
					// ignore
				}
			}

			// SearXNG setup needs both instance URL and optional API key
			let backendConfig: BackendConfig = { enabled: true };
			if (backend === "searxng") {
				const url = await setupInput(ctx, "Enter your SearXNG instance URL (e.g. http://localhost:8888):", {
					placeholder: "http://localhost:8888",
					validate: (v: string) =>
						v.trim().length > 0 ? undefined : "URL cannot be empty",
				});
				if (!url) {
					ctx.ui.notify("Setup cancelled.", "info");
					return;
				}
				backendConfig.instanceUrl = url.trim();
				// Optionally ask for API key (some instances require auth)
				const optionalKey = await setupInput(ctx, "Optional API key (leave empty if none):", {
					placeholder: "sk-... (optional)",
				});
				if (optionalKey && optionalKey.trim()) {
					backendConfig.apiKey = optionalKey.trim();
				}
			} else {
				backendConfig.apiKey = key?.trim() || "";
			}

			const updated: SearchConfig = {
				...existing,
				backends: {
					...existing.backends,
					[backend]: backendConfig,
				},
			};

			writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n", { mode: 0o600 });

			ctx.ui.notify(
				`${label} API key saved to ${configPath}. Run /reload to activate.`,
				"info",
			);
		},
	});

	// -------------------------------------------------------------------------
	// Enable all free backends
	// -------------------------------------------------------------------------

	async function enableAllFreeBackends(ctx: ExtensionContext) {
		const configDir = join(getAgentDir(), "extensions");
		const configPath = join(configDir, "search.json");
		mkdirSync(configDir, { recursive: true });

		let existing: SearchConfig = {};
		if (existsSync(configPath)) {
			try {
				existing = JSON.parse(readFileSync(configPath, "utf-8"));
			} catch {
				// ignore
			}
		}

		// List of free backends to enable
		const freeBackends = [
			"duckduckgo",
			"jina",
			"marginalia",
			"exa_mcp",
			"searxng",
		];

		const updated: SearchConfig = {
			...existing,
			backends: {
				...existing.backends,
				...Object.fromEntries(
					freeBackends.map(name => [name, { enabled: true }])
				),
			},
		};

		writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n", { mode: 0o600 });
		ctx.ui.notify(
			`Enabled: DuckDuckGo, Jina, Marginalia, Exa MCP, SearXNG. Run /reload to activate.`,
			"info",
		);
	}

	// -------------------------------------------------------------------------
	// Global settings configuration
	// -------------------------------------------------------------------------

	async function configureGlobalSettings(ctx: ExtensionContext) {
		const configDir = join(getAgentDir(), "extensions");
		const configPath = join(configDir, "search.json");
		mkdirSync(configDir, { recursive: true });

		let existing: SearchConfig = {};
		if (existsSync(configPath)) {
			try {
				existing = JSON.parse(readFileSync(configPath, "utf-8"));
			} catch {
				// ignore
			}
		}

		const settings = [
			["compact", "Compact output", existing.compact ? "On" : "Off"],
			["combine", "Combine mode (parallel search)", existing.combine ? "On" : "Off"],
			["combineMode", "Combine strategy", existing.combineMode ?? "all"],
			["cacheTtl", "Cache TTL (ms)", String(existing.cacheTtl ?? 300000)],
			["cacheMax", "Max cached queries", String(existing.cacheMax ?? 100)],
			["reader", "Web reader", existing.reader ?? "jina"],
			["readerFallback", "Reader fallback order", (existing.readerFallback ?? DEFAULT_READER_FALLBACK).join(", ")],
			["selectionStrategy", "Selection strategy", existing.selectionStrategy ?? "sequential"],
		];

		const labels = settings.map(([key, label, current]) => `${label}: ${current}`);
		labels.push("✅ Done — save and exit");

		const selected = await ctx.ui.select("Configure global settings:", labels);
		if (!selected || selected === "✅ Done — save and exit") {
			ctx.ui.notify("Global settings saved.", "info");
			return;
		}

		// Find which setting was selected
		const idx = labels.indexOf(selected);
		if (idx < 0 || idx >= settings.length) {
			ctx.ui.notify("Setup cancelled.", "info");
			return;
		}

		const [key, label] = settings[idx];
		let value: unknown;

		switch (key) {
			case "compact":
			case "combine": {
				const toggle = await ctx.ui.select(`${label} — current: ${selected.split(": ")[1]}`, ["On", "Off", "Cancel"]);
				if (toggle === "Cancel" || !toggle) {
					ctx.ui.notify("Setup cancelled.", "info");
					return;
				}
				value = toggle === "On";
				break;
			}
			case "combineMode": {
				const choice = await ctx.ui.select(`${label} — current: ${selected.split(": ")[1]}`, ["all", "targeted", "Cancel"]);
				if (choice === "Cancel" || !choice) {
					ctx.ui.notify("Setup cancelled.", "info");
					return;
				}
				value = choice;
				break;
			}
			case "cacheTtl":
			case "cacheMax": {
				const input = await setupInput(ctx, `${label} — current: ${selected.split(": ")[1]}`, {
					placeholder: selected.split(": ")[1],
					validate: (v) => /\d+/.test(v) ? undefined : "Must be a number",
				});
				if (!input) {
					ctx.ui.notify("Setup cancelled.", "info");
					return;
				}
				value = parseInt(input, 10);
				break;
			}
			case "readerFallback": {
				const current = existing.readerFallback ?? DEFAULT_READER_FALLBACK;
				const choice = await ctx.ui.select(`${label} — current: ${current.join(", ")}`, [
					"Default (jina, sofya, firecrawl, exa, exa_mcp)",
					"Custom order",
					"Cancel",
				]);
				if (choice === "Cancel" || !choice) {
					ctx.ui.notify("Setup cancelled.", "info");
					return;
				}
				if (choice === "Default (jina, sofya, firecrawl, exa, exa_mcp)") {
					value = undefined; // removes override, uses default
				} else {
					const input = await setupInput(ctx, "Enter reader order (comma-separated, e.g. firecrawl, jina, sofya):", {
						placeholder: current.join(", "),
						validate: (v: string) => {
							const parts = v.split(",").map(s => s.trim()).filter(Boolean);
							if (parts.length === 0) return "At least one reader required";
							const valid = ["jina", "sofya", "firecrawl", "exa", "exa_mcp"];
							const invalid = parts.filter(p => !valid.includes(p));
							if (invalid.length > 0) return `Unknown reader(s): ${invalid.join(", ")}. Valid: ${valid.join(", ")}`;
							return undefined;
						},
					});
					if (!input) {
						ctx.ui.notify("Setup cancelled.", "info");
						return;
					}
					value = input.split(",").map(s => s.trim()).filter(Boolean);
				}
				break;
			}
			case "reader": {
				const choice = await ctx.ui.select(`${label} — current: ${selected.split(": ")[1]}`, [
					"jina (free)", "sofya (needs key)", "firecrawl (keyless)", "exa (needs key)", "exa_mcp (free)", "Cancel"
				]);
				if (choice === "Cancel" || !choice) {
					ctx.ui.notify("Setup cancelled.", "info");
					return;
				}
				value = choice.startsWith("jina") ? "jina" : choice.startsWith("firecrawl") ? "firecrawl" : choice.startsWith("exa_mcp") ? "exa_mcp" : choice.startsWith("exa") ? "exa" : "sofya";
				break;
			}
			case "selectionStrategy": {
				const choice = await ctx.ui.select(`${label} — current: ${selected.split(": ")[1]}`, [
					"sequential", "random", "round-robin", "best-latency", "Cancel",
				]);
				if (choice === "Cancel" || !choice) {
					ctx.ui.notify("Setup cancelled.", "info");
					return;
				}
				value = choice;
				break;
			}
			default:
				ctx.ui.notify("Unknown setting.", "error");
				return;
		}

		const updated: SearchConfig = { ...existing, [key]: value };
		writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n", { mode: 0o600 });
		ctx.ui.notify(`${label} set. Run /reload to apply.`, "info");

		// Allow configuring another setting
		await configureGlobalSettings(ctx);
	}

	pi.registerCommand("search-status", {
		description: "Show which search backends are configured and active",
		handler: async (_args, ctx) => {
			refreshConfig(ctx.cwd);

			const backendLabels: Record<string, string> = Object.fromEntries(
				Object.entries(BACKEND_DEFS).map(([k, v]) => [k, `${v.label}${k === "duckduckgo" ? " (free, no key)" : ""}`])
			);

			// Collect table rows first to compute aligned column widths
			type Row = [string, string, string];
			const rows: Row[] = [];

			for (const [name, label] of Object.entries(backendLabels)) {
				const { configured, source } = getKeySource(name, config);
				const bc = config.backends?.[name as keyof typeof config.backends];
				const samples = latencyMap.get(name) ?? [];
				const avgLatency = samples.length > 0
					? `${Math.round(samples.reduce((sum, s) => sum + s.ms, 0) / samples.length)}ms`
					: "\u2014";

				if (name === "duckduckgo") {
					rows.push([label, "\u2713 enabled, key: \u2014 (free)", avgLatency]);
				} else if (name === "marginalia" && bc?.enabled) {
					rows.push([label, "\u2713 enabled, key: optional (public)", avgLatency]);
				} else if (name === "searxng" && bc?.enabled) {
					const urlInfo = bc.instanceUrl ? `url: ${bc.instanceUrl}` : "no URL set";
					rows.push([label, `\u2713 enabled, ${urlInfo}${configured ? `, key: \u2713 (${source})` : ", key: \u2014"}`, avgLatency]);
				} else if (bc?.enabled) {
					const keyStatus = configured
						? `\u2713${source ? ` (${source})` : ""}`
						: "\u2014 (Pi auth)";
					rows.push([label, `\u2713 enabled, key: ${keyStatus}`, avgLatency]);
				} else {
					rows.push([label, `\u2014 disabled${configured ? `, key: \u2713 (${source})` : ""}`, avgLatency]);
				}
			}

			// Compute column widths from headers + data
			const col1Header = "Backend";
			const col2Header = "Status";
			const col3Header = "Avg Latency";
			const w1 = rows.reduce((max, [c]) => Math.max(max, c.length), col1Header.length);
			const w2 = rows.reduce((max, [, s]) => Math.max(max, s.length), col2Header.length);
			const w3 = rows.reduce((max, [, , s]) => Math.max(max, s.length), col3Header.length);

			const pad = (s: string, w: number) => s + " ".repeat(w - s.length);

			const tableLines = [
				`| ${pad(col1Header, w1)} | ${pad(col2Header, w2)} | ${pad(col3Header, w3)} |`,
				`| ${"-".repeat(w1)} | ${"-".repeat(w2)} | ${"-".repeat(w3)} |`,
				...rows.map(([c1, c2, c3]) => `| ${pad(c1, w1)} | ${pad(c2, w2)} | ${pad(c3, w3)} |`),
			];

			const activeBackends = getActiveBackends();
			const resolvedDefault = activeBackends[0] || "none";
			const lines: string[] = [
				"## Search Backend Status",
				`Configured default: ${config.defaultBackend || "none"}`,
				`Resolved default: ${resolvedDefault}`,
				`Combine mode: ${config.combine ? (config.combineMode || "all") : "off"}`,
				`Strategy: ${config.selectionStrategy || "sequential"}`,
				`Active: ${activeBackends.join(", ") || "none"}`,
				"",
				...tableLines,
			];

			if (activeBackends.length === 1 && activeBackends[0] === "duckduckgo") {
				lines.push("");
				lines.push("Only DuckDuckGo is active (no API key needed).");
				lines.push("Add a search backend with /search-setup to get more results.");
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});


	// -----------------------------------------------------------------------
	// Session start
	// -----------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		pane.dispose();
		pane = new CustomViewToggle();
		service = new SearchService();
		clearCooldowns();
		await service.refresh(ctx, undefined);
		refreshTool();
	});
	pi.on("before_agent_start", async (_event, ctx) => {
		await service.refresh(ctx, ctx.signal);
		refreshTool();
	});
	pi.on("session_shutdown", () => pane.dispose());
	pi.registerCommand("websearch", {
		description: "Search engines, session statistics, and interactive search testing",
		handler: async (_args, ctx) => {
			await service.refresh(ctx, undefined);
			if (ctx.mode !== "tui") {
				ctx.ui.notify(JSON.stringify({ engines: service.engines(), statistics: service.monitor.snapshot() }), "info");
				return;
			}
			const owner = service;
			await pane.open(ctx.ui, (tui, theme, keys, done) => new WebSearchView({
				monitor: owner.monitor, engines: () => owner.engines(), policy: () => owner.policy(),
				search: async (query, signal) => {
					const result = await owner.search({ query }, signal, ctx);
					if (result.isError) throw new Error(result.content[0].text);
					return result.content[0].text;
				},
				theme, keys, rows: () => tui.terminal.rows, requestRender: () => tui.requestRender(), close: done,
			}));
		},
	});
}
