import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { SqliteDecisionStore } from "../../src/store.ts";

export default function (pi) {
  let calls = 0;
  pi.registerProvider("decisions-tui-fixture", {
    api: "openai-completions", apiKey: "synthetic-fixture-only", baseUrl: "http://fixture.invalid",
    models: [{ id: "scripted", name: "Decisions fixture", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const message = { role: "assistant", content: [{ type: "text", text: `FIXTURE RESPONSE ${++calls}; no external provider contacted.` }],
        api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "stop",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message }); stream.end(); });
      return stream;
    },
  });
  pi.registerCommand("fixture-seed", { description: "Create disposable questions for the isolated terminal journey", handler: async (_args, ctx) => {
    const store = new SqliteDecisionStore(join(getAgentDir(), "decisions", "questions.sqlite"));
    try {
      for (const [index, status] of ["own", "pending", "answered", "dismissed"].entries()) {
        const q = store.ask(ctx.cwd, { question: `Fixture question ${index + 1}?`, context: "Synthetic terminal acceptance only", options: [], recommendation: "",
          sessionId: status === "own" ? ctx.sessionManager.getSessionId() : "other", toolCallId: `fixture-${index}` });
        if (status === "answered" || status === "dismissed") store.resolve(ctx.cwd, q.id, q.revision, status, status === "answered" ? "Fixture answer" : null);
      }
    } finally { store.close(); }
    ctx.ui.notify("FIXTURE SEEDED", "info");
  } });
  pi.registerCommand("fixture-status", { description: "Inspect durable acceptance receipts", handler: async (_args, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const count = type => entries.filter(e => e.type === "custom_message" && e.customType === type).length;
    ctx.ui.notify(`FIXTURE RECEIPTS index=${count("decisions-context")} full=${count("decisions-answer")}`, "info");
  } });
}
