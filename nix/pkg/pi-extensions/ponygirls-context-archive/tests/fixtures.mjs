import { DEFAULT_PREFERENCES, validatePreferences } from "../src/preferences.ts";

export class MemoryPreferences {
  path = "memory:context-archive";
  defaults = { ...DEFAULT_PREFERENCES };
  failure = null;
  read() { if (this.failure !== null) throw new Error(this.failure); return structuredClone(this.defaults); }
  write(defaults) { if (this.failure !== null) throw new Error(this.failure); this.defaults = validatePreferences(defaults); }
}

export const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
export function assistant(content, overrides = {}) {
  return { role: "assistant", content, api: "openai-completions", provider: "fixture", model: "fixture", usage, stopReason: content.some((p) => p.type === "toolCall") ? "toolUse" : "stop", timestamp: 1, ...overrides };
}
export function apply(manager, drafts) {
  for (const draft of drafts) {
    if (draft.type === "custom") manager.appendCustomEntry(draft.customType, draft.data);
    else if (draft.type === "context_edit") manager.appendContextEdit(draft.targetId, draft.replacement);
    else throw new Error(`Unexpected draft ${draft.type}`);
  }
}
export function productionHistory(manager) {
  manager.appendMessage({ role: "user", content: "Preserve authorization: only local fixture edits allowed.", timestamp: 1 });
  const input = manager.appendMessage(assistant([{ type: "toolCall", id: "old-call", name: "bash", arguments: { command: "# Historical invocation\n" + "s".repeat(100000) } }]));
  const output = manager.appendMessage({ role: "toolResult", toolCallId: "old-call", toolName: "bash", content: [{ type: "text", text: "OLD_OBSERVATION=17\n" + "o".repeat(100000) }], isError: false, timestamp: 2 });
  for (let i = 0; i < 7; i++) manager.appendMessage(assistant([{ type: "text", text: `Recent working state ${i}\n` + "t".repeat(12000) }], { timestamp: 3 + i }));
  return { input, output };
}
