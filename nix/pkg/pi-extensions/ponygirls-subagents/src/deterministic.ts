/**
 * ponygirls-subagents — deterministic provider driver for development/tests.
 *
 * Registers a scripted `test-sim` provider through the real ModelRuntime
 * extension-provider path (ProviderConfigInput.streamSimple), so SDK
 * integration — listener registration, proxy execution, agent_settled,
 * tool-call/result pairing, retry/compaction boundaries — is exercised
 * without provider credentials and without network. The script can request
 * tools, pause at controlled boundaries, emit errors, and generate context
 * volume.
 *
 * Paid/live-provider tests remain opt-in and separate.
 */

export interface ScriptUsageOverride {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Reasoning breakdown (part of output); absent stays null, never zero. */
  reasoning?: number;
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  costTotal?: number;
}

export type ScriptStep =
  | { kind: "text"; text: string; usage?: unknown; delayMs?: unknown }
  | { kind: "tool"; name: string; args: Record<string, unknown>; usage?: unknown; delayMs?: unknown }
  | { kind: "batch"; calls: Array<{ name: string; args: Record<string, unknown> }> }
  | { kind: "error"; message: string };

export type DeterministicEntryKind = "main" | "history" | "prefix";

import { existsSync, appendFileSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DeterministicModelRuntime {
  registerProvider: (id: string, config: Record<string, unknown>) => void;
  getModel: (provider: string, id: string) => Record<string, unknown> | undefined;
}

interface EventStreamCtor {
  new (
    isTerminal: (e: { type: string }) => boolean,
    getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown,
  ): { push: (e: unknown) => void; result?: () => Promise<unknown> };
}
export const SIM_PROVIDER = "test-sim";
export const SIM_MODEL = "sim-1";

function usage(): Record<string, unknown> {
  return {
    input: 10,
    output: 5,
    cacheRead: 3,
    cacheWrite: 2,
    reasoning: 1,
    totalTokens: 20,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

interface ResolvedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number | null;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
}

function defaultUsage(): ResolvedUsage {
  return { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: null, costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, costTotal: 0 };
}

function resolveStepUsage(step: { usage?: unknown }, what: string): ResolvedUsage {
  const base: ResolvedUsage = defaultUsage();
  const override: unknown = step.usage;
  if (override === undefined) return base;
  if (typeof override !== "object" || override === null) {
    throw new Error(`DRIVER_CONFIG: script step usage must be an object (${what})`);
  }
  const rec = override as Record<string, unknown>;
  const check = (name: string, required: boolean): number | null => {
    const v: unknown = rec[name];
    if (v === undefined) {
      if (required) throw new Error(`DRIVER_CONFIG: script step usage.${name} is required when usage is set (${what})`);
      return null;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(`DRIVER_CONFIG: script step usage.${name} must be a nonneg finite number (${what}, got ${String(v)})`);
    }
    return v;
  };
  const input: number | null = check("input", true);
  const output: number | null = check("output", true);
  const cacheRead: number | null = check("cacheRead", false);
  const cacheWrite: number | null = check("cacheWrite", false);
  const reasoning: number | null = check("reasoning", false);
  const costInput: number | null = check("costInput", false);
  const costOutput: number | null = check("costOutput", false);
  const costCacheRead: number | null = check("costCacheRead", false);
  const costCacheWrite: number | null = check("costCacheWrite", false);
  const costTotal: number | null = check("costTotal", false);
  if (input === null || output === null) throw new Error(`DRIVER_CONFIG: script step usage.input/output required (${what})`);
  return {
    input,
    output,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
    reasoning,
    costInput: costInput ?? 0,
    costOutput: costOutput ?? 0,
    costCacheRead: costCacheRead ?? 0,
    costCacheWrite: costCacheWrite ?? 0,
    costTotal: costTotal ?? 0,
  };
}

/**
 * Optional scripted response delay (test-only scheduling control, inert
 * unless a script step sets it): defers the provider push past public
 * completion so late-ORIGINAL accounting paths execute deterministically.
 * Malformed values fail loudly at registration, never silently ignored.
 */
function resolveStepDelay(step: { delayMs?: unknown }, what: string): number {
  const raw: unknown = step.delayMs;
  if (raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new Error(`DRIVER_CONFIG: script step delayMs must be a nonneg finite number (${what}, got ${String(raw)})`);
  }
  return raw;
}

function usageRecord(u: ResolvedUsage): Record<string, unknown> {
  return {
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    totalTokens: u.input + u.output + u.cacheRead + u.cacheWrite,
    // Reasoning rides only when reported (absent stays absent, never zero).
    ...(u.reasoning !== null ? { reasoning: u.reasoning } : {}),
    cost: { input: u.costInput, output: u.costOutput, cacheRead: u.costCacheRead, cacheWrite: u.costCacheWrite, total: u.costTotal },
  };
}

function assistantText(text: string, usage?: ResolvedUsage): Record<string, unknown> {
  const resolved: ResolvedUsage = usage ?? defaultUsage();
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: SIM_PROVIDER,
    model: SIM_MODEL,
    usage: usageRecord(resolved),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

let toolCallSeq = 1;

function assistantToolCall(name: string, args: Record<string, unknown>, usage?: ResolvedUsage): Record<string, unknown> {  return {
    role: "assistant",
    content: [{ type: "toolCall", id: `sim-${toolCallSeq++}`, name, arguments: args }],
    api: "openai-responses",
    provider: SIM_PROVIDER,
    model: SIM_MODEL,
    usage: usageRecord(usage ?? defaultUsage()),
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

/**
 * Narrow test-only ENTRY observer (dev/test driver hook).
 * Called synchronously at provider-callback ENTRY (streamSimple invocation),
 * BEFORE step selection/response/error. Preserves registration, script,
 * responses, model, context and options exactly. NOT a response counter
 * surrogate.
 *
 * The observer is the REQUIRED injection point for the mandatory
 * invocation-owned fault transport: every ENTRY must synchronously return a
 * per-invocation scope carrying the immutable owner
 * (task/agent/generation/provider/model/summary/turn) captured BEFORE the
 * ORIGINAL producer runs. There is deliberately no fallback: a missing
 * observer, a missing scope, or an invalid owner fails the ENTRY loudly
 * instead of attributing faults through a late environment read or a shared
 * registry. `onEntry` remains the optional narrow logging hook.
 */
export class EntryTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntryTraceError";
  }
}

export interface InvocationOwner {
  readonly taskRunId: string;
  readonly generation: number;
  readonly agentId: string;
  readonly provider: string;
  readonly model: string;
  readonly summaryKind: DeterministicEntryKind;
  readonly turn: number;
}

export interface InvocationScope {
  readonly owner: InvocationOwner;
  readonly faults: ObservationFault[];
}

export interface DeterministicEntryObserver {
  onEntry?: (info: { turn: number; provider: string; model: string; kind: DeterministicEntryKind }) => void;
  createInvocationScope: (info: { turn: number; provider: string; model: string; kind: DeterministicEntryKind }) => InvocationScope;
}

/** Loud structural validation for an injected invocation scope. Every field
 * is presence-checked explicitly (never truthiness-dropped) and stringified
 * in diagnostics. Returns the scope unchanged when valid. */
export function requireInvocationScope(scope: unknown): InvocationScope {
  const fail = (detail: string): never => {
    throw new Error(`DRIVER_INFRA: invocation observation scope invalid: ${detail}`);
  };
  if (typeof scope !== "object" || scope === null) fail(`scope must be an object (got ${String(scope)})`);
  const rec = scope as Record<string, unknown>;
  const owner: unknown = rec["owner"];
  const faults: unknown = rec["faults"];
  if (typeof owner !== "object" || owner === null) fail(`owner must be an object (got ${String(owner)})`);
  if (!Array.isArray(faults)) fail(`faults must be an array (got ${String(faults)})`);
  const o = owner as Record<string, unknown>;
  const taskRunId: unknown = o["taskRunId"];
  const generation: unknown = o["generation"];
  const agentId: unknown = o["agentId"];
  const provider: unknown = o["provider"];
  const model: unknown = o["model"];
  const summaryKind: unknown = o["summaryKind"];
  const turn: unknown = o["turn"];
  if (typeof taskRunId !== "string" || taskRunId.length === 0) fail(`taskRunId must be nonempty (got ${String(taskRunId)})`);
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) fail(`generation must be a nonneg integer (got ${String(generation)})`);
  if (typeof agentId !== "string" || agentId.length === 0) fail(`agentId must be nonempty (got ${String(agentId)})`);
  if (typeof provider !== "string" || provider.length === 0) fail(`provider must be nonempty (got ${String(provider)})`);
  if (typeof model !== "string" || model.length === 0) fail(`model must be nonempty (got ${String(model)})`);
  if (summaryKind !== "main" && summaryKind !== "history" && summaryKind !== "prefix") fail(`summaryKind must be main/history/prefix (got ${String(summaryKind)})`);
  if (typeof turn !== "number" || !Number.isInteger(turn) || turn <= 0) fail(`turn must be positive (got ${String(turn)})`);
  return scope as InvocationScope;
}

/** Detached scope factory for direct (worker-less) deterministic provider
 * use in tests: fixed test identity, caller-owned faults array. Production
 * worker paths always inject the real invocation owner instead. */
export function testInvocationScope(info: { turn: number; provider: string; model: string; kind: DeterministicEntryKind }): InvocationScope {
  return requireInvocationScope({
    owner: {
      taskRunId: "test-direct-invocation",
      generation: 0,
      agentId: "test-direct-agent",
      provider: info.provider,
      model: info.model,
      summaryKind: info.kind,
      turn: info.turn,
    },
    faults: [],
  });
}


interface SummaryContext {
  isSummary: boolean;
  summaryKind: DeterministicEntryKind;
}

/**
 * Version-pinned protocol literal (TEST DRIVER ONLY, not a runtime SDK import).
 * Exact text of SUMMARIZATION_SYSTEM_PROMPT from pinned pi-coding-agent 1.1.0
 * `dist/core/compaction/utils.js` (verified by execution against the store
 * path; the package export map does not re-export it, so no supported
 * package import exists). If the SDK changes this text, summary identity
 * fails closed to main and compaction fixtures fail loudly for re-pinning.
 */
export const PINNED_SDK_1_1_0_SUMMARIZATION_SYSTEM_PROMPT =
  "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.\n\nDo NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.";

/** SDK-built user-frame openers (verified builders in pinned 1.1.0
 * `dist/core/compaction/compaction.js`: history `promptText` opens with
 * `<conversation>\\n`; prefix opens with `# Conversation\\n`). */
export const PINNED_SDK_1_1_0_HISTORY_FRAME_OPEN = "<conversation>\n";
export const PINNED_SDK_1_1_0_PREFIX_FRAME_OPEN = "# Conversation\n";

function messageText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  let out = "";
  for (const block of content) {
    if (typeof block !== "object" || block === null) return null;
    const rec = block as Record<string, unknown>;
    if (rec["type"] === "text" && typeof rec["text"] === "string") out += rec["text"] as string;
  }
  return out;
}

/**
 * Truthful SDK-summary identity: the leading system message must equal the
 * SDK's summarization system prompt exactly (system prompt is SDK-built
 * prompt state, never user text), and the single user message must open
 * with the SDK-built frame (`<conversation>` history vs `# Conversation`
 * prefix). User text always sits after the frame opener, so no user content
 * — including literal `[User]:`, summarizer wording, or frame lookalikes —
 * can collide. Anything else is a main request; script semantics preserved.
 */
function classifyRequest(context: unknown): SummaryContext {
  const holder: unknown =
    typeof context === "object" && context !== null ? (context as { messages?: unknown }).messages : undefined;
  if (!Array.isArray(holder) || holder.length !== 2) return { isSummary: false, summaryKind: "main" };
  const first: unknown = holder[0];
  const second: unknown = holder[1];
  if (typeof first !== "object" || first === null || typeof second !== "object" || second === null) {
    return { isSummary: false, summaryKind: "main" };
  }
  const firstRec: Record<string, unknown> = first as Record<string, unknown>;
  const secondRec: Record<string, unknown> = second as Record<string, unknown>;
  if (firstRec["role"] !== "system" || secondRec["role"] !== "user") return { isSummary: false, summaryKind: "main" };
  const systemText: string | null = messageText(firstRec["content"]);
  if (systemText === null || systemText !== PINNED_SDK_1_1_0_SUMMARIZATION_SYSTEM_PROMPT) {
    return { isSummary: false, summaryKind: "main" };
  }
  const userText: string | null = messageText(secondRec["content"]);
  if (userText === null) return { isSummary: false, summaryKind: "main" };
  if (userText.startsWith(PINNED_SDK_1_1_0_HISTORY_FRAME_OPEN)) return { isSummary: true, summaryKind: "history" };
  if (userText.startsWith(PINNED_SDK_1_1_0_PREFIX_FRAME_OPEN)) return { isSummary: true, summaryKind: "prefix" };
  return { isSummary: false, summaryKind: "main" };
}

function summaryUsage(): Record<string, unknown> {
  return {
    input: 3,
    output: 4,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 7,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function summaryText(kind: DeterministicEntryKind): string {
  if (kind === "prefix") return "PREFIX_SUMMARY_MARKER: turn-prefix checkpoint of the split user span.";
  return "HISTORY_SUMMARY_MARKER: structured checkpoint of earlier history.";
}

interface SummaryUsageConfig {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

function checkUsageNumber(record: Record<string, unknown>, field: string, what: string): number {
  const v: unknown = record[field];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new Error(`DRIVER_CONFIG: PI_SUBAGENTS_SUMMARY_USAGE ${what}.${field} must be a nonneg finite number (got ${String(v)})`);
  }
  return v;
}

function checkUsageConfig(value: unknown, what: string): SummaryUsageConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error(`DRIVER_CONFIG: PI_SUBAGENTS_SUMMARY_USAGE ${what} must be an object`);
  }
  const rec: Record<string, unknown> = value as Record<string, unknown>;
  const cost: unknown = rec["cost"];
  if (typeof cost !== "object" || cost === null) {
    throw new Error(`DRIVER_CONFIG: PI_SUBAGENTS_SUMMARY_USAGE ${what}.cost must be an object`);
  }
  const costRec: Record<string, unknown> = cost as Record<string, unknown>;
  return {
    input: checkUsageNumber(rec, "input", what),
    output: checkUsageNumber(rec, "output", what),
    cacheRead: checkUsageNumber(rec, "cacheRead", what),
    cacheWrite: checkUsageNumber(rec, "cacheWrite", what),
    totalTokens: checkUsageNumber(rec, "totalTokens", what),
    cost: {
      input: checkUsageNumber(costRec, "input", what + ".cost"),
      output: checkUsageNumber(costRec, "output", what + ".cost"),
      cacheRead: checkUsageNumber(costRec, "cacheRead", what + ".cost"),
      cacheWrite: checkUsageNumber(costRec, "cacheWrite", what + ".cost"),
      total: checkUsageNumber(costRec, "total", what + ".cost"),
    },
  };
}

function resolveSummaryUsageConfig(): { history: SummaryUsageConfig; prefix: SummaryUsageConfig } | null {
  const raw: unknown = process.env["PI_SUBAGENTS_SUMMARY_USAGE"];
  if (raw === undefined || raw === "") return null;
  if (typeof raw !== "string") {
    throw new Error(`DRIVER_CONFIG: PI_SUBAGENTS_SUMMARY_USAGE must be a JSON string (got ${String(raw)})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (parseError: unknown) {
    const detail = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`DRIVER_CONFIG: PI_SUBAGENTS_SUMMARY_USAGE must be JSON: ${detail}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("DRIVER_CONFIG: PI_SUBAGENTS_SUMMARY_USAGE must be an object with history/prefix");
  }
  const rec: Record<string, unknown> = parsed as Record<string, unknown>;
  return { history: checkUsageConfig(rec["history"], "history"), prefix: checkUsageConfig(rec["prefix"], "prefix") };
}

function usageRecordFromConfig(config: SummaryUsageConfig): Record<string, unknown> {
  return {
    input: config.input,
    output: config.output,
    cacheRead: config.cacheRead,
    cacheWrite: config.cacheWrite,
    totalTokens: config.totalTokens,
    cost: { ...config.cost },
  };
}

function summaryMessage(kind: DeterministicEntryKind, usage: Record<string, unknown>): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text", text: summaryText(kind) }],
    api: "openai-responses",
    provider: SIM_PROVIDER,
    model: SIM_MODEL,
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

type DelayMode = "off" | "history";

function compactionDelayMode(): DelayMode {
  const raw: unknown = process.env["PI_SUBAGENTS_COMPACTION_DELAY"];
  if (raw === undefined || raw === "" || raw === "off") return "off";
  if (raw === "history") return "history";
  throw new Error(`DRIVER_CONFIG: PI_SUBAGENTS_COMPACTION_DELAY must be "off" or "history" (got ${String(raw)})`);
}

function agentConfinedPath(name: string): string {
  const agentDir: unknown = process.env["PI_SUBAGENTS_AGENT_DIR"];
  if (typeof agentDir !== "string" || agentDir.length === 0) {
    throw new Error(`DRIVER_INFRA: PI_SUBAGENTS_AGENT_DIR must be set for compaction controls (got ${String(agentDir)})`);
  }
  if (agentDir.includes("\0") || name.includes("\0") || name.includes("/") || name === "" || name === "." || name === "..") {
    throw new Error(`DRIVER_INFRA: invalid compaction control name: ${String(name)}`);
  }
  const target: string = join(agentDir, name);
  return target;
}

function writeLatch(path: string, info: { turn: number; kind: DeterministicEntryKind }, owner: InvocationOwner): void {
  appendFileSync(
    path,
    JSON.stringify({
      state: "pending",
      taskRunId: owner.taskRunId,
      generation: owner.generation,
      agentId: owner.agentId,
      provider: SIM_PROVIDER,
      model: SIM_MODEL,
      kind: info.kind,
      turn: info.turn,
      at: Date.now(),
    }) + "\n",
  );
}

export interface PendingLatch {
  state: "pending";
  taskRunId: string;
  generation: number;
  agentId: string;
  provider: string;
  model: string;
  kind: "history" | "prefix";
  turn: number;
  at: number;
}

export function decodeLatch(path: string): PendingLatch {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (readError: unknown) {
    const detail = readError instanceof Error ? readError.message : String(readError);
    throw new Error(`LATCH_MISSING: pending latch unreadable: ${path}: ${detail}`);
  }
  const lines: string[] = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error(`LATCH_CORRUPT: pending latch empty: ${path}`);
  const first: string = lines[0] as string;
  let value: unknown;
  try {
    value = JSON.parse(first) as unknown;
  } catch (parseError: unknown) {
    const detail = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`LATCH_CORRUPT: pending latch malformed JSON: ${path}: ${detail}`);
  }
  if (typeof value !== "object" || value === null) throw new Error(`LATCH_CORRUPT: pending latch must decode to an object: ${path}`);
  const rec: Record<string, unknown> = value as Record<string, unknown>;
  const state: unknown = rec["state"];
  const taskRunId: unknown = rec["taskRunId"];
  const generation: unknown = rec["generation"];
  const agentId: unknown = rec["agentId"];
  const provider: unknown = rec["provider"];
  const model: unknown = rec["model"];
  const kind: unknown = rec["kind"];
  const turn: unknown = rec["turn"];
  const at: unknown = rec["at"];
  if (state !== "pending") throw new Error(`LATCH_CORRUPT: state must be "pending" (got ${String(state)}): ${path}`);
  if (typeof taskRunId !== "string" || taskRunId.length === 0) throw new Error(`LATCH_CORRUPT: taskRunId must be nonempty (got ${String(taskRunId)}): ${path}`);
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) {
    throw new Error(`LATCH_CORRUPT: generation must be a nonneg integer (got ${String(generation)}): ${path}`);
  }
  if (typeof agentId !== "string" || agentId.length === 0) throw new Error(`LATCH_CORRUPT: agentId must be nonempty: ${path}`);
  if (typeof provider !== "string" || provider.length === 0) throw new Error(`LATCH_CORRUPT: provider must be nonempty: ${path}`);
  if (typeof model !== "string" || model.length === 0) throw new Error(`LATCH_CORRUPT: model must be nonempty: ${path}`);
  if (kind !== "history" && kind !== "prefix") throw new Error(`LATCH_CORRUPT: kind must be history/prefix (got ${String(kind)}): ${path}`);
  if (typeof turn !== "number" || !Number.isInteger(turn) || turn <= 0) throw new Error(`LATCH_CORRUPT: turn must be positive (got ${String(turn)}): ${path}`);
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) throw new Error(`LATCH_CORRUPT: at must be positive (got ${String(at)}): ${path}`);
  return { state: "pending", taskRunId, generation, agentId, provider, model, kind, turn, at };
}

function removeLatch(path: string): void {
  try {
    unlinkSync(path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`DRIVER_INFRA: cannot remove pending latch ${path}: ${detail}`);
  }
}

/**
 * Register the scripted provider on a real ModelRuntime. Consumes one script
 * step per model turn; extra turns receive a terminal text step.
 *
 * Fault transport is strictly invocation-owned: every provider-callback
 * ENTRY synchronously obtains a per-invocation scope from the injected
 * observer, and all later async observation for that invocation appends to
 * the scope's faults stamped with the scope's immutable owner. There is no
 * module-global fault registry, no environment read, and no fallback: the
 * owner (worker generation channel or detached test scope) is injected
 * BEFORE the ORIGINAL producer runs and travels in the invocation closure.
 */
export interface ObservationFault {
  turn: number;
  kind: DeterministicEntryKind;
  error: string;
  taskRunId: string;
  generation: number;
  agentId: string;
  at: number;
}

function recordObservationError(turn: number, kind: DeterministicEntryKind, detail: string, scope: InvocationScope): void {
  const message = `DRIVER_OBSERVATION_FAILED turn ${String(turn)} kind ${kind}: ${detail}`;
  process.stderr.write(message + "\n");
  const owner: InvocationOwner = requireInvocationScope(scope).owner;
  scope.faults.push({
    turn,
    kind,
    error: detail,
    taskRunId: owner.taskRunId,
    generation: owner.generation,
    agentId: owner.agentId,
    at: Date.now(),
  });
  try {
    appendFileSync(
      agentConfinedPath("summary-usage-error.jsonl"),
      JSON.stringify({ turn, kind, error: detail, taskRunId: owner.taskRunId, generation: owner.generation, agentId: owner.agentId, at: Date.now() }) + "\n",
    );
  } catch (checkpointError: unknown) {
    const checkpointDetail = checkpointError instanceof Error ? checkpointError.message : String(checkpointError);
    process.stderr.write(`DRIVER_OBSERVATION_CHECKPOINT_FAILED turn ${String(turn)} kind ${kind}: ${checkpointDetail}\n`);
    // Required checkpoint failures are themselves joinable faults of the same
    // invocation owner: a fallible file must never be the sole transport for
    // a mandatory observation failure.
    scope.faults.push({
      turn,
      kind,
      error: `observation checkpoint failed: ${checkpointDetail}`,
      taskRunId: owner.taskRunId,
      generation: owner.generation,
      agentId: owner.agentId,
      at: Date.now(),
    });
  }
}

function recordSummaryUsage(turn: number, kind: DeterministicEntryKind, usage: unknown): void {
  const path: string = agentConfinedPath("summary-usage.jsonl");
  if (typeof usage !== "object" || usage === null) {
    throw new Error(`DRIVER_BUG: summary usage must be an object (turn ${String(turn)})`);
  }
  const rec: Record<string, unknown> = usage as Record<string, unknown>;
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) {
    const v: unknown = rec[field];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`DRIVER_BUG: summary usage.${field} must be finite (turn ${String(turn)})`);
    }
  }
  const cost: unknown = rec["cost"];
  if (typeof cost !== "object" || cost === null) {
    throw new Error(`DRIVER_BUG: summary usage.cost must be an object (turn ${String(turn)})`);
  }
  const costRec: Record<string, unknown> = cost as Record<string, unknown>;
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
    const v: unknown = costRec[field];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`DRIVER_BUG: summary usage.cost.${field} must be finite (turn ${String(turn)})`);
    }
  }
  appendFileSync(path, JSON.stringify({ turn, kind, usage }) + "\n");
}

export function registerDeterministicProvider(
  runtime: DeterministicModelRuntime,
  EventStream: EventStreamCtor,
  steps: ScriptStep[],
  observer?: DeterministicEntryObserver,
): { provider: string; id: string } {
  for (let si = 0; si < steps.length; si += 1) {
    const step: ScriptStep = steps[si];
    if (step.kind === "text" || step.kind === "tool") {
      resolveStepUsage(step, `script[${String(si)}]`);
      resolveStepDelay(step, `script[${String(si)}]`);
    }
  }
  const summaryConfig: { history: SummaryUsageConfig; prefix: SummaryUsageConfig } | null = resolveSummaryUsageConfig();
  const summaryUsageFor = (kind: DeterministicEntryKind): Record<string, unknown> => {
    if (summaryConfig === null) return summaryUsage();
    return usageRecordFromConfig(kind === "prefix" ? summaryConfig.prefix : summaryConfig.history);
  };
  let index = 0;
  let turn = 0;
  runtime.registerProvider(SIM_PROVIDER, {
    api: "openai-responses",
    apiKey: "deterministic",
    baseUrl: "https://example.invalid",
    streamSimple: (model: unknown, context: unknown, options: unknown) => {
      const classified: SummaryContext = classifyRequest(context);
      turn += 1;
      observer?.onEntry?.({ turn, provider: SIM_PROVIDER, model: SIM_MODEL, kind: classified.summaryKind });
      // Mandatory invocation-owned fault transport, injected BEFORE the
      // ORIGINAL producer runs: the observer synchronously returns a
      // per-invocation scope whose immutable owner
      // (task/agent/generation/provider/model/summary/turn) stamps every
      // later async observation fault for this invocation. No environment
      // read, no shared registry, no fallback — absence fails loudly here.
      const rawScope: unknown = observer?.createInvocationScope?.({
        turn,
        provider: SIM_PROVIDER,
        model: SIM_MODEL,
        kind: classified.summaryKind,
      });
      if (rawScope === undefined || rawScope === null) {
        throw new Error(
          "DRIVER_INFRA: invocation observation scope unavailable at ENTRY " +
            `(turn ${String(turn)} kind ${String(classified.summaryKind)}): injected owner required before ORIGINAL`,
        );
      }
      const scope: InvocationScope = requireInvocationScope(rawScope);
      if (classified.isSummary) {
        const kind: DeterministicEntryKind = classified.summaryKind;
        const stream = new EventStream(
          (e) => e.type === "done" || e.type === "error",
          (e) => {
            const ev = e as { type: string; message?: unknown; error?: unknown };
            if (ev.type === "done") return ev.message;
            if (ev.type === "error") return ev.error;
            throw new Error("unexpected event type");
          },
        );
        const rawSignal: unknown =
          typeof options === "object" && options !== null ? (options as { signal?: unknown }).signal : undefined;
        const signal: AbortSignal | undefined = rawSignal instanceof AbortSignal ? rawSignal : undefined;
        const pushSummary = (event: { type: "done"; reason: "stop"; message: Record<string, unknown> } | { type: "error"; reason: "error" | "aborted"; error: Record<string, unknown> }): void => {
          stream.push(event);
          if (typeof stream.result !== "function") {
            process.stderr.write(`DRIVER_USAGE_OBSERVATION_FAILED turn ${String(turn)} kind ${kind}: stream has no supported result()\n`);
            return;
          }
          void stream.result().then(
            (message: unknown) => {
              try {
                if (typeof message !== "object" || message === null) {
                  throw new Error("own result must be an assistant message object");
                }
                recordSummaryUsage(turn, kind, (message as { usage?: unknown }).usage);
              } catch (observeError: unknown) {
                const detail = observeError instanceof Error ? observeError.message : String(observeError);
                recordObservationError(turn, kind, detail, scope);
              }
            },
            (error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error);
              recordObservationError(turn, kind, `result rejected: ${detail}`, scope);
            },
          );
        };
        const respondSummary = (): void => {
          if (signal?.aborted === true) {
            pushSummary({ type: "error", reason: "aborted", error: { ...summaryMessage(kind, summaryUsageFor(kind)), content: [], stopReason: "aborted", errorMessage: "aborted" } });
            return;
          }
          pushSummary({ type: "done", reason: "stop", message: summaryMessage(kind, summaryUsageFor(kind)) });
        };
        let delayMode: DelayMode;
        try {
          delayMode = compactionDelayMode();
        } catch (configError: unknown) {
          const detail = configError instanceof Error ? configError.message : String(configError);
          pushSummary({ type: "error", reason: "error", error: { ...summaryMessage(kind, summaryUsageFor(kind)), content: [], stopReason: "error", errorMessage: detail } });
          return stream;
        }
        const shouldDelay: boolean = delayMode === "history" && kind === "history";
        if (!shouldDelay) {
          queueMicrotask(respondSummary);
          return stream;
        }
        let releasePath: string;
        let latchPath: string;
        try {
          releasePath = agentConfinedPath("summary-release");
          latchPath = agentConfinedPath("summary-pending");
          writeLatch(latchPath, { turn, kind }, scope.owner);
        } catch (setupError: unknown) {
          const detail = setupError instanceof Error ? setupError.message : String(setupError);
          pushSummary({ type: "error", reason: "error", error: { ...summaryMessage(kind, summaryUsageFor(kind)), content: [], stopReason: "error", errorMessage: detail } });
          return stream;
        }
        process.stderr.write("COMPACTION_SUMMARY_PENDING history\n");
        const finishDelayed = (): void => {
          try {
            removeLatch(latchPath);
          } catch (latchError: unknown) {
            const detail = latchError instanceof Error ? latchError.message : String(latchError);
            pushSummary({ type: "error", reason: "error", error: { ...summaryMessage(kind, summaryUsageFor(kind)), content: [], stopReason: "error", errorMessage: `DRIVER_INFRA: cannot remove pending latch: ${detail}` } });
            return;
          }
          process.stderr.write("COMPACTION_SUMMARY_RELEASED history\n");
          respondSummary();
        };
        const poll = (): void => {
          if (signal?.aborted === true) {
            finishDelayed();
            return;
          }
          let released = false;
          try {
            released = existsSync(releasePath);
          } catch (checkError: unknown) {
            const detail = checkError instanceof Error ? checkError.message : String(checkError);
            try {
              removeLatch(latchPath);
            } catch (latchError: unknown) {
              const latchDetail = latchError instanceof Error ? latchError.message : String(latchError);
              process.stderr.write(`DRIVER_INFRA: latch removal failed during marker-check failure: ${latchDetail}\n`);
            }
            pushSummary({ type: "error", reason: "error", error: { ...summaryMessage(kind, summaryUsageFor(kind)), content: [], stopReason: "error", errorMessage: `DRIVER_INFRA: release marker check failed: ${detail}` } });
            return;
          }
          if (released) {
            finishDelayed();
            return;
          }
          setTimeout(poll, 20);
        };
        setTimeout(poll, 20);
        return stream;
      }
      const step: ScriptStep = index < steps.length ? steps[index++]! : { kind: "text", text: "done" };
      const stream = new EventStream(
        (e) => e.type === "done" || e.type === "error",
        (e) => {
          const ev = e as { type: string; message?: unknown; error?: unknown };
          if (ev.type === "done") return ev.message;
          if (ev.type === "error") return ev.error;
          throw new Error("unexpected event type");
        },
      );
      const stepUsage = step.kind === "text" || step.kind === "tool" ? resolveStepUsage(step, `script turn ${String(turn)}`) : undefined;
      const stepDelayMs = step.kind === "text" || step.kind === "tool" ? resolveStepDelay(step, `script turn ${String(turn)}`) : 0;
      const respond = (): void => {
        if (step.kind === "text") {
          stream.push({ type: "done", reason: "stop", message: assistantText(step.text, stepUsage) });
        } else if (step.kind === "tool") {
          stream.push({ type: "done", reason: "toolUse", message: assistantToolCall(step.name, step.args, stepUsage) });
        } else if (step.kind === "batch") {
          const calls = step.calls.map((c) => ({ type: "toolCall" as const, id: `sim-${toolCallSeq++}`, name: c.name, arguments: c.args }));
          stream.push({
            type: "done",
            reason: "toolUse",
            message: {
              role: "assistant",
              content: calls,
              api: "openai-responses",
              provider: SIM_PROVIDER,
              model: SIM_MODEL,
              usage: usage(),
              stopReason: "toolUse",
              timestamp: Date.now(),
            },
          });
        } else {
          // Provider failures end with stopReason "error" and an errorMessage, as real providers report them.
          stream.push({ type: "error", reason: "error", error: { ...assistantText(""), content: [], stopReason: "error", errorMessage: step.message } });
        }
      };
      // Responses push on the microtask queue (production timing unchanged;
      // no test-only delay for ORDERING: back-to-back calls dispatch without
      // parent-await points, which is exactly why held-mid-compaction is
      // reported as a fixture blocker with a scope question instead of a
      // timing hack). A scripted delayMs models a genuinely slow provider
      // (real network latency, not test choreography) for accounting-
      // lifetime coverage: holding the ORIGINAL response past public
      // completion.
      if (stepDelayMs > 0) setTimeout(respond, stepDelayMs);
      else queueMicrotask(respond);
      return stream;
    },
    models: [
      {
        type: "chat",
        id: SIM_MODEL,
        name: "deterministic sim",
        api: "openai-responses",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 4096,
      },
    ],
  });
  return { provider: SIM_PROVIDER, id: SIM_MODEL };
}
