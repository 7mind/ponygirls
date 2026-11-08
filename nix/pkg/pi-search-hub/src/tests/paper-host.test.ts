import { it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage, type Message } from "@earendil-works/pi-ai";
import { FALLBACK_ENV_MAP } from "../extensions/credentials.js";

// Behavioral-Active-Effectual-GoodCommunication: real SDK loader/model loop + owned HTTP server.
// Scripted model output establishes tool wiring, not semantic research quality.
it("loads the extension in real Pi and executes scholarly search with structured provenance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paper-host-"));
  vi.stubEnv("HOME", dir); vi.stubEnv("PI_CODING_AGENT_DIR", dir);
  const requests: URL[] = [];
  const server = createServer((req, res) => {
    requests.push(new URL(req.url!, "http://localhost"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results: [{ title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762v7", content: "Transformer attention" }], unresponsive_engines: [] }));
  });
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (address === null || typeof address === "string") throw new Error("No fixture port");
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi/search.json"), JSON.stringify({ backends: {
      ...Object.fromEntries(Object.keys(FALLBACK_ENV_MAP).map(name => [name, { enabled: false }])),
      searxng: { enabled: true, instanceUrl: `http://127.0.0.1:${address.port}` },
    } }));
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
      additionalExtensionPaths: [process.env.PI_SEARCH_HUB_EXTENSION === undefined ? resolve(import.meta.dirname, "../extensions/search-hub.ts") : process.env.PI_SEARCH_HUB_EXTENSION],
      noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
    await loader.reload(); expect(loader.getExtensions().errors).toEqual([]);
    const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    let turn = 0;
    const observed: Message[][] = [];
    runtime.registerProvider("paper-fixture", { api: "openai-completions", apiKey: "fixture-only", baseUrl: "http://fixture.invalid",
      models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1000 }],
      streamSimple(model, context) {
        observed.push(structuredClone(context.messages));
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
          content: turn++ === 0 ? [{ type: "toolCall", id: "paper-call", name: "paper_research", arguments: { action: "search", query: "Transformer attention", numResults: 2 } }] : [{ type: "text", text: "Tool receipt observed." }],
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: turn === 1 ? "toolUse" : "stop" };
        queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: turn === 1 ? "toolUse" : "stop", message }); stream.end(); });
        return stream;
      } });
    const model = runtime.getModel("paper-fixture", "scripted"); if (model === undefined) throw new Error("Fixture model absent");
    ({ session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: "off", settingsManager: settings,
      resourceLoader: loader, sessionManager: SessionManager.inMemory(), tools: ["paper_research"] }));
    const errors: unknown[] = [];
    await session.bindExtensions({ mode: "rpc", onError: error => errors.push(error) });
    expect(session.getActiveToolNames()).toContain("paper_research");
    expect(requests).toHaveLength(0);
    await session.prompt("Exercise the paper fixture.");
    expect(errors).toEqual([]); expect(turn).toBe(2); expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("categories")).toBe("science");
    const result = session.messages.find(message => message.role === "toolResult" && message.toolName === "paper_research");
    expect(result?.role).toBe("toolResult");
    if (result?.role !== "toolResult") throw new Error("Paper receipt absent");
    expect(result.isError).toBe(false);
    const data = JSON.parse(result.content.filter(part => part.type === "text").map(part => part.text).join(""));
    expect(data.results[0].ids).toContainEqual({ namespace: "arxiv", value: "1706.03762" });
    expect(data.results[0].sources).toEqual(["searxng"]);
    expect(data.providers[0].tier).toBe("alwaysInclude");
    expect(data.results[0].abstract).toBeUndefined();
    expect(JSON.stringify(observed.at(-1))).toContain("1706.03762");
    await session.reload(); expect(session.getActiveToolNames()).toContain("paper_research"); expect(requests).toHaveLength(1);
  } finally {
    if (session !== undefined) { await session.abort(); session.dispose(); }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.unstubAllEnvs(); rmSync(dir, { recursive: true });
  }
}, 20_000);
