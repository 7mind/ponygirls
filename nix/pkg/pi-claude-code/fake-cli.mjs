import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

if ("ANTHROPIC_API_KEY" in process.env) throw new Error("fixture received forbidden API credentials");
const config = process.env.CLAUDE_CONFIG_DIR;
if (!config) throw new Error("fixture requires an explicit config directory");
if (process.argv.includes("auth")) {
  appendFileSync(join(config, "auth.jsonl"), JSON.stringify({ pid: process.pid, config }) + "\n");
  while (existsSync(join(config, "hold-auth"))) await new Promise((resolve) => setTimeout(resolve, 10));
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "test" }));
  process.exit(0);
}
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const querying = process.argv.includes("--system-prompt-file");
let tools = [];
if (querying) {
  const mcp = JSON.parse(argument("--mcp-config"));
  tools = JSON.parse(readFileSync(mcp.mcpServers.pi.args[1], "utf8")).map((tool) => tool.name);
  const settings = JSON.parse(readFileSync(argument("--settings"), "utf8"));
  const effort = JSON.parse(settings.env.CLAUDE_CODE_EXTRA_BODY).output_config?.effort;
  appendFileSync(join(config, "launch.jsonl"), JSON.stringify({ pid: process.pid, cwd: process.cwd(), config, model: argument("--model"), effort, detached: process.platform !== "win32", emptyTools: argument("--tools") === "", settingSources: argument("--setting-sources"), strictMcp: process.argv.includes("--strict-mcp-config") }) + "\n");
}
const history = [];
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const frame = JSON.parse(line);
  if (frame.type === "control_request") {
    console.log(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: { models: [
      { value: "fixture-opus-route", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", description: "controlled catalog", supportsAdaptiveThinking: true },
      { value: "fixture-sonnet-route", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet 5.5", description: "controlled catalog", supportsAdaptiveThinking: true },
    ] } } }));
    continue;
  }
  history.push(frame.message);
  const uuid = { user_message_uuids: [frame.uuid] };
  if (querying) appendFileSync(join(config, "frames.jsonl"), JSON.stringify({ pid: process.pid, type: frame.type, querying: frame.shouldQuery !== false }) + "\n");
  if (frame.shouldQuery === false) {
    if (querying && existsSync(join(config, "hold-replay"))) {
      appendFileSync(join(config, "replay.jsonl"), JSON.stringify({ pid: process.pid }) + "\n");
      while (existsSync(join(config, "hold-replay"))) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    console.log(JSON.stringify({ type: "result", num_turns: 0, ...uuid }));
    continue;
  }
  if (frame.type !== "user") continue;
  const text = JSON.stringify(history);
  if (text.includes("WAIT_FIXTURE")) continue;
  const fixture = JSON.parse(readFileSync(join(config, "fixture.json"), "utf8"));
  const usage = { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 };
  const message = { id: `fixture-${process.pid}`, role: "assistant" };
  const events = [];
  const stream = (event) => events.push({ type: "stream_event", event });
  let content;
  let stopReason = "end_turn";
  if (fixture.thinkingDeltas !== undefined) {
    const signature = "fixture-signature";
    const deltas = Array.from({ length: fixture.thinkingDeltas }, (_, i) => i.toString(16).padStart(4, "0"));
    stream({ type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { ...usage, output_tokens: 0 } } });
    stream({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
    for (const thinking of deltas) stream({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } });
    stream({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature } });
    stream({ type: "content_block_stop", index: 0 });
    stream({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
    stream({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: fixture.answer } });
    stream({ type: "content_block_stop", index: 1 });
    usage.output_tokens = 1237;
    usage.output_tokens_details = { thinking_tokens: 1234 };
    stream({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage });
    content = [{ type: "thinking", thinking: deltas.join(""), signature }, { type: "text", text: fixture.answer }];
  } else if (tools.includes("submit_gate_decision")) {
    const prompt = history.map((message) => typeof message.content === "string" ? message.content : message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n")).join("\n");
    const candidate = /Candidate (candidate-\d+)[^\n]*\n([^]*?)(?:\n\n|$)/.exec(prompt);
    if (!candidate) throw new Error("fixture reviewer missing candidate");
    const approved = candidate[2].includes("Opus");
    const verdict = approved ? { schemaVersion: 1, candidateId: candidate[1], decision: "approve", advisories: [] } : { schemaVersion: 1, candidateId: candidate[1], decision: "blocked", reason: "candidate lacks Opus", missingPrerequisites: ["Opus substring"] };
    content = [{ type: "tool_use", id: "verdict", name: "mcp__pi__submit_gate_decision", input: verdict }];
    stopReason = "tool_use";
  } else if (tools.includes("read") && !text.includes("tool_result")) {
    content = [{ type: "tool_use", id: "read-fixture", name: "mcp__pi__read", input: { path: "probe.txt" } }];
    stopReason = "tool_use";
  } else content = [{ type: "text", text: fixture.answer }];
  stream({ type: "message_stop" });
  events.push({ type: "assistant", message: { ...message, content, stop_reason: stopReason, usage } });
  events.push({ type: "result", subtype: stopReason === "tool_use" ? "error_max_turns" : "success", is_error: stopReason === "tool_use", usage, ...uuid });
  process.stdout.write(events.map((event) => JSON.stringify(event) + "\n").join(""));
}

if (!querying) await new Promise((resolve) => setTimeout(resolve, 50));
