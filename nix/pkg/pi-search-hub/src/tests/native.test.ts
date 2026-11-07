import { describe, expect, it, vi } from "vitest";
import {
	createAssistantMessageEventStream, createModels, createProvider, InMemoryCredentialStore,
	type Api, type AssistantMessage, type Model, type SimpleStreamOptions, type TranscriptContext,
} from "@earendil-works/pi-ai";
import { discoverNativeEngines, injectNativeSearchPayload, NativeSearchError, NativeUsageUnavailableError, type NativeDiscoveryContext, type NativeProviderId } from "../extensions/native.js";

const usage = { input: 12, output: 7, cacheRead: 3, cacheWrite: 0, totalTokens: 22, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } };
const ids = { openai: "gpt-4.1", "openai-codex": "gpt-6.1-sol", anthropic: "claude-sonnet-4-6", xai: "grok-4.7", "grok-build": "grok-4.6" };
const apis = { openai: "openai-responses", "openai-codex": "openai-codex-responses", anthropic: "anthropic-messages", xai: "openai-responses", "grok-build": "openai-responses" };
const source = (url: string, title = "Primary source") => ({ type: "url_citation", url, title, start_index: 0, end_index: 13 });
const responseEvent = (url = "https://example.org/facts", title?: string) => ({
	type: "response.output_item.done",
	item: { type: "message", content: [{ type: "output_text", text: "Factual claim with supporting citation.", annotations: [source(url, title)] }] },
});

/** Real Pi provider collection with in-memory credentials and dummy streams only. */
async function fixture(config: {
	providers?: NativeProviderId[];
	oauth?: NativeProviderId[];
	events?: unknown[];
	stopReason?: AssistantMessage["stopReason"];
	rawStopReason?: string;
	current?: NativeProviderId;
	settleAfterAbortMs?: number | "never";
} = {}) {
	const credentials = new InMemoryCredentialStore();
	const models = createModels({ credentials, authContext: { env: async () => undefined, fileExists: async () => false } });
	const dispatch = vi.fn();
	for (const id of config.providers ?? ["openai", "anthropic", "xai"]) {
		const model: Model<Api> = {
			id: ids[id], name: ids[id], provider: id, api: apis[id], baseUrl: id === "grok-build" ? "https://cli-chat-proxy.grok.com/v1" : `https://${id}.configured-proxy.test/v1`,
			headers: { "X-Model": "configured" }, reasoning: false, input: ["text"],
			contextWindow: 10000, maxTokens: 3000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		const stream = (requestModel: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
			const output = createAssistantMessageEventStream();
			void (async () => {
				const payload = await options?.onPayload?.({ model: requestModel.id, store: false, include: ["reasoning.encrypted_content"] }, requestModel);
				dispatch({ model: requestModel, context, options, payload });
				for (const event of config.events ?? [responseEvent()]) await options?.onProviderStreamEvent?.(event, requestModel);
				const message: AssistantMessage = {
					role: "assistant", content: [{ type: "text", text: '{"url":"https://invented.invalid/"}' }],
					api: requestModel.api, model: requestModel.id, provider: requestModel.provider,
					stopReason: config.stopReason ?? "stop", rawStopReason: config.rawStopReason,
					errorMessage: config.stopReason === "error" ? "server search unavailable" : undefined,
					usage, timestamp: Date.now(),
				};
				const finish = () => {
					output.push({ type: "start", partial: message });
					output.push({ type: "done", reason: "stop", message });
					output.end();
				};
				if (config.settleAfterAbortMs === "never") return;
				if (typeof config.settleAfterAbortMs === "number") {
					options?.signal?.addEventListener("abort", () => setTimeout(finish, config.settleAfterAbortMs as number), { once: true });
				} else finish();
			})();
			return output;
		};
		if (config.oauth?.includes(id)) await credentials.modify(id, async () => ({ type: "oauth", access: "dummy-oauth-never-sent", refresh: "dummy-refresh", expires: Date.now() + 3_600_000 }));
		models.setProvider(createProvider({
			id, models: [model], api: { stream, streamSimple: stream },
			auth: {
				apiKey: { name: "dummy", resolve: async () => ({ auth: { apiKey: "dummy-never-sent", baseUrl: "https://credential-endpoint.test/v1", headers: { "X-Gateway": "configured", "X-Suppress": null } } }) },
				...(config.oauth?.includes(id) ? { oauth: {
					name: "dummy subscription", isSubscription: true,
					login: async () => { throw new Error("must not login in tests"); },
					refresh: async (credential: import("@earendil-works/pi-ai").OAuthCredential) => credential,
					toAuth: async (credential: import("@earendil-works/pi-ai").OAuthCredential) => ({ apiKey: credential.access }),
				} } : {}),
			},
		}));
	}
	const ctx: NativeDiscoveryContext = {
		model: config.current ? models.getModel(config.current, ids[config.current]) : undefined,
		modelRegistry: {
			getAvailableOfType: models.getAvailableOfType.bind(models),
			streamSimple: models.streamSimple.bind(models),
			isUsingOAuth: (model) => config.oauth?.includes(model.provider as NativeProviderId) ?? false,
			getProvider: models.getProvider.bind(models),
		},
	};
	return { ctx, dispatch, models };
}

describe("configured native search", () => {
	it("discovers only configured catalog models with actual model/auth-mode labels", async () => {
		const { ctx, dispatch } = await fixture({ providers: ["openai", "xai"], oauth: ["openai"] });
		const engines = await discoverNativeEngines(ctx);
		expect(engines.map((e) => e.id)).toEqual(["openai", "xai"]);
		expect(engines[0].label).toContain("gpt-4.1; subscription OAuth");
		expect(engines[1].label).toContain("grok-4.7; API credentials");
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("preserves registry endpoint, headers, cancellation, context normalization and usage", async () => {
		const { ctx, dispatch } = await fixture({ providers: ["openai"] });
		const [engine] = await discoverNativeEngines(ctx);
		const controller = new AbortController();
		const signal = controller.signal;
		const result = await engine.search("test query", 3, signal);
		expect(result.results).toEqual([{ title: "Primary source", url: "https://example.org/facts", snippet: "Factual claim" }]);
		expect(result.usage).toEqual(usage);
		const call = dispatch.mock.calls[0][0];
		expect(call.model.baseUrl).toBe("https://credential-endpoint.test/v1");
		expect(call.options.headers).toMatchObject({ "X-Gateway": "configured", "X-Model": "configured", "X-Suppress": null });
		expect(call.options.timeoutMs).toBe(45_000);
		controller.abort();
		expect(call.options.signal.aborted).toBe(true);
		expect(call.context.messages[0]).toMatchObject({ role: "system" });
		expect(call.context.messages[1]).toMatchObject({ role: "user", content: "test query" });
		expect(call.payload).toMatchObject({ store: false, tools: [{ type: "web_search" }], include: ["reasoning.encrypted_content", "web_search_call.action.sources"] });
	});

	it("uses the current compatible configured model without querying all models", async () => {
		const { ctx, models } = await fixture({ providers: ["xai"], current: "xai" });
		const lookup = vi.spyOn(ctx.modelRegistry, "getAvailableOfType");
		const [engine] = await discoverNativeEngines(ctx);
		expect(engine.label).toContain(models.getModels("xai")[0].id);
		expect(lookup.mock.calls.map((call) => call[1])).toEqual(["openai", "openai-codex", "anthropic", "xai", "grok-build"]);
	});

	it("keeps the real legacy Codex provider distinct from OpenAI API credentials", async () => {
		const { ctx } = await fixture({ providers: ["openai", "openai-codex"], oauth: ["openai-codex"] });
		const engines = await discoverNativeEngines(ctx);
		expect(engines.map((engine) => engine.id)).toEqual(["openai", "openai-codex"]);
		expect(engines[1].label).toContain("gpt-6.1-sol; subscription OAuth");
		await expect(engines[1].search("q", 3)).resolves.toHaveProperty("results");
	});

	it("uses registered pi-xai Grok Build OAuth with proxy headers and native citations", async () => {
		const { ctx, dispatch } = await fixture({ providers: ["grok-build"], oauth: ["grok-build"] });
		ctx.sessionManager = { getSessionId: () => "test-session" };
		const [engine] = await discoverNativeEngines(ctx);
		expect(engine.id).toBe("grok-build");
		expect(engine.label).toContain("subscription OAuth");
		await expect(engine.search("q", 3)).resolves.toHaveProperty("results");
		const call = dispatch.mock.calls[0][0];
		expect(call.model.baseUrl).toBe("https://cli-chat-proxy.grok.com/v1");
		expect(call.options.headers).toMatchObject({ "x-grok-conv-id": "test-session", "X-Model": "configured" });
		expect(call.options.apiKey).toBe("dummy-oauth-never-sent");
		expect(call.payload.tools).toEqual([{ type: "web_search" }]);
	});

	it("applies only the verified pi-xai nested-call compatibility cleanup", () => {
		const payload = injectNativeSearchPayload("grok-build", {
			seed: 123, parallel_tool_calls: true, prompt_cache_retention: "24h", service_tier: "auto",
			reasoning: { effort: "low", summary: "auto" }, temperature: 3, top_p: -1, store: false,
		}, "grok-4.6") as Record<string, unknown>;
		expect(payload).toMatchObject({ reasoning: { effort: "low" }, temperature: 2, top_p: 0, store: false, include: ["reasoning.encrypted_content"] });
		for (const key of ["seed", "parallel_tool_calls", "prompt_cache_retention", "service_tier"]) expect(key in payload).toBe(false);
	});

	it("surfaces configured providers with unverified model APIs rather than silently omitting them", async () => {
		const { ctx } = await fixture({ providers: ["xai"] });
		const get = ctx.modelRegistry.getAvailableOfType;
		ctx.modelRegistry.getAvailableOfType = async (type, id, options) => {
			const available = await get(type, id, options);
			return available.map((model) => ({ ...model, api: "unknown-protocol" }));
		};
		const [engine] = await discoverNativeEngines(ctx);
		expect(engine.label).toContain("unsupported search model/API");
		await expect(engine.search("q", 1)).rejects.toThrow("no verified native search model");
	});

	it("keeps discovery failures local to one provider", async () => {
		const { ctx } = await fixture({ providers: ["xai"] });
		const get = ctx.modelRegistry.getAvailableOfType;
		ctx.modelRegistry.getAvailableOfType = (type, id, options) => id === "openai" ? Promise.reject(new Error("broken auth")) : get(type, id, options);
		const engines = await discoverNativeEngines(ctx);
		expect(engines.map((engine) => engine.id)).toEqual(["openai", "xai"]);
		await expect(engines[0].search("q", 1)).rejects.toThrow("discovery: broken auth");
		await expect(engines[1].search("q", 1)).resolves.toHaveProperty("results");
	});

	it("extracts OpenAI action sources and final-response citations with strict bounded URLs", async () => {
		const { ctx } = await fixture({ providers: ["openai"], events: [
			{ type: "response.output_item.done", item: { type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://example.org/facts#section" }, { type: "url", url: "javascript:alert(1)" }, { type: "url", url: "https://user:secret@example.org/" }] } } },
			responseEvent(),
			{ type: "response.completed", response: { output: [responseEvent("https://example.org/other").item] } },
		] });
		const [engine] = await discoverNativeEngines(ctx);
		const { results } = await engine.search("q", 1);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ title: "Primary source", url: "https://example.org/facts" });
	});

	it("extracts xAI content-part and annotation events, using host rather than numeric titles", async () => {
		const { ctx } = await fixture({ providers: ["xai"], oauth: ["xai"], events: [
			{ type: "response.output_text.annotation.added", annotation: source("https://docs.example.org/", "1") },
			{ type: "response.content_part.done", part: responseEvent("https://docs.example.org/", "1").item.content[0] },
			{ type: "response.completed", response: { citations: ["https://second.example.org/", "data:text/plain,no"] } },
		] });
		const [engine] = await discoverNativeEngines(ctx);
		expect(engine.label).toContain("subscription OAuth");
		const { results } = await engine.search("q", 5);
		expect(results.map((r) => r.url)).toEqual(["https://docs.example.org/", "https://second.example.org/"]);
		expect(results[0].title).toBe("docs.example.org");
	});

	it("extracts Anthropic server results and citation deltas, never encrypted content", async () => {
		const { ctx, dispatch } = await fixture({ providers: ["anthropic"], oauth: ["anthropic"], events: [
			{ type: "content_block_start", content_block: { type: "web_search_tool_result", content: [{ type: "web_search_result", title: "Documentation", url: "https://docs.example.org/", encrypted_content: "DO NOT EXPOSE" }] } },
			{ type: "content_block_delta", delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://docs.example.org/", title: "Documentation", cited_text: "Exact source excerpt" } } },
		] });
		const [engine] = await discoverNativeEngines(ctx);
		expect(await engine.search("q", 5)).toMatchObject({ results: [{ title: "Documentation", url: "https://docs.example.org/", snippet: "Exact source excerpt" }], usage });
		expect(dispatch.mock.calls[0][0].payload.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
	});

	it("does not accept model-generated JSON URLs as grounded evidence", async () => {
		const { ctx } = await fixture({ providers: ["openai"], events: [] });
		const [engine] = await discoverNativeEngines(ctx);
		await expect(engine.search("q", 3)).rejects.toBeInstanceOf(NativeSearchError);
		await expect(engine.search("q", 3)).rejects.toMatchObject({ message: expect.stringContaining("no grounded source URLs"), usage });
	});

	it("reports native server errors, provider errors, and non-replayable pause_turn", async () => {
		for (const config of [
			{ events: [{ type: "content_block_start", content_block: { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } } }], error: "max_uses_exceeded" },
			{ stopReason: "error" as const, error: "server search unavailable" },
			{ rawStopReason: "pause_turn", error: "paused before completion" },
		]) {
			const { ctx } = await fixture({ ...config, providers: ["anthropic"] });
			const [engine] = await discoverNativeEngines(ctx);
			await expect(engine.search("q", 3)).rejects.toThrow(config.error);
		}
	});

	it("does not swallow cancellation in discovery or search", async () => {
		const { ctx, dispatch } = await fixture({ providers: ["openai"] });
		const controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await expect(discoverNativeEngines(ctx, controller.signal)).rejects.toThrow("cancelled");
		const [engine] = await discoverNativeEngines(ctx);
		await expect(engine.search("q", 1, controller.signal)).rejects.toThrow("cancelled");
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("bounds an abort-ignoring stream at the internal deadline plus usage-settlement grace", async () => {
		vi.useFakeTimers();
		vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), ms);
			return controller.signal;
		});
		try {
			const { ctx, dispatch } = await fixture({ providers: ["openai"], settleAfterAbortMs: "never" });
			const [engine] = await discoverNativeEngines(ctx);
			let outcome: unknown = "pending";
			void engine.search("q", 3).then(() => { outcome = "resolved"; }, (error) => { outcome = error; });
			await vi.advanceTimersByTimeAsync(45_999);
			expect(dispatch).toHaveBeenCalledOnce();
			expect(dispatch.mock.calls[0][0].options.signal.aborted).toBe(true);
			expect(outcome).toBe("pending");
			await vi.advanceTimersByTimeAsync(1);
			expect(outcome).toMatchObject({ name: "NativeUsageUnavailableError", message: expect.stringContaining("usage unavailable") });
			expect(outcome).toBeInstanceOf(NativeUsageUnavailableError);
			expect(outcome).toBeInstanceOf(NativeSearchError);
			expect((outcome as NativeSearchError).usage).toBeUndefined();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.restoreAllMocks();
			vi.useRealTimers();
		}
	});

	it("waits briefly after caller abort for terminal usage instead of racing it away", async () => {
		vi.useFakeTimers();
		try {
			const { ctx, dispatch } = await fixture({ providers: ["openai"], settleAfterAbortMs: 25 });
			const [engine] = await discoverNativeEngines(ctx);
			const controller = new AbortController();
			let outcome: unknown = "pending";
			void engine.search("q", 3, controller.signal).then(() => { outcome = "resolved"; }, (error) => { outcome = error; });
			await vi.advanceTimersByTimeAsync(0);
			expect(dispatch).toHaveBeenCalledOnce();
			controller.abort(new Error("user stopped"));
			await vi.advanceTimersByTimeAsync(24);
			expect(outcome).toBe("pending");
			await vi.advanceTimersByTimeAsync(1);
			expect(outcome).toBeInstanceOf(NativeSearchError);
			expect(outcome).toMatchObject({ usage, message: "openai native search cancelled" });
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("preserves unrelated payload fields and tools without mutating Pi's payload", () => {
		const original = { model: "configured-id", tools: [{ type: "web_search_preview" }, { type: "function", name: "existing" }], include: ["reasoning.encrypted_content"], custom: true };
		const payload = injectNativeSearchPayload("openai", original);
		expect(payload).toMatchObject({ model: "configured-id", tools: [{ type: "web_search" }, { type: "function", name: "existing" }], custom: true });
		expect(original.tools[0].type).toBe("web_search_preview");
	});
});
