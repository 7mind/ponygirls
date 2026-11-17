import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AddressInfo } from "node:net";

export async function portableControl(registry: ModelRegistry, answer: string) {
  let requests = 0;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model: string; tools?: Array<{ function: { name: string } }>; messages: unknown[] };
      assert.equal(body.model, "portable-control");
      assert.equal(request.headers.authorization, "Bearer fixture-key");
      requests++;
      const reviewer = body.tools !== undefined && body.tools.some((tool) => tool.function.name === "submit_gate_decision");
      const candidate = /Candidate (candidate-\d+)/.exec(JSON.stringify(body.messages));
      if (reviewer) assert.ok(candidate);
      response.writeHead(200, { "content-type": "text/event-stream" });
      const header = { id: `portable-${requests}`, object: "chat.completion.chunk", created: 1, model: body.model };
      const delta = reviewer ? { role: "assistant", tool_calls: [{ index: 0, id: "portable-verdict", type: "function", function: { name: "submit_gate_decision", arguments: JSON.stringify({ schemaVersion: 1, candidateId: candidate![1], decision: "approve", advisories: [] }) } }] } : { role: "assistant", content: answer };
      response.write(`data: ${JSON.stringify({ ...header, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...header, choices: [{ index: 0, delta: {}, finish_reason: reviewer ? "tool_calls" : "stop" }], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } })}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const model = { provider: "portable-native-control", id: "portable-control", thinkingLevel: "off" };
  registry.registerProvider(model.provider, { api: "openai-completions", baseUrl, apiKey: "fixture-key", models: [{ id: model.id, name: "Portable control", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 256 }] });
  return { model, requests: () => requests, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => { if (error !== undefined) reject(error); else resolve(); }); }) };
}
