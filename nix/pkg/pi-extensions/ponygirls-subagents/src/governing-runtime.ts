/**
 * ponygirls-subagents — governing-session runtime adapter (pinned).
 *
 * Pinned to pi 1.1.0 (`@earendil-works/*`). The public `AgentTool` type has
 * only a 4-arg `execute`, but the runtime wrapper
 * (`dist/core/tools/tool-definition-wrapper.js`) accepts a 5th
 * `ExtensionToolContext` and invokes
 * `definition.execute(id, params, signal, onUpdate, ctx ?? ctxFactory(id, signal))`.
 * This module names that runtime signature narrowly (no `any`, no private
 * session field access) so the supervisor can dispatch approved external
 * tools after the originating spawn result finalizes, with broker-owned
 * IDs/signals and an independent journal — avoiding Pi orphan native
 * `parentToolCallId`/counter/`nestedCalls` attribution (which finalizes at
 * the originating tool result).
 *
 * Independent authorization: delegated calls do NOT replay the governing
 * session's top-level `tool_call`/`tool_result` extension hooks, permission
 * prompts, transcript events, or `nestedCalls` summaries. Authority comes
 * solely from root+owner `allowedTools` intersection plus supervisor
 * journaling (same model as the existing file/shell broker). Documented as
 * a limitation, never claimed as hook equivalence.
 */

export const GOVERNING_RUNTIME_PI_VERSION = "1.1.0";

export interface GoverningResultContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface GoverningToolResult {
  content: GoverningResultContent[];
  details?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
  usage?: unknown;
}

/**
 * Narrow runtime handle: the actual callable `AgentTool` objects from
 * `ctx.tools` (4-arg public type) also accept a 5th context at runtime.
 * This named type pins that 5th-arg contract without private access.
 */
export interface PinnedGoverningHandle {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
  readonly prepareArguments?: (args: unknown) => unknown;
  readonly outputSchema?: unknown;
  readonly executionMode?: "sequential" | "parallel";
  execute: PinnedGoverningExecute;
}

export type PinnedGoverningExecute = (
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: GoverningToolResult) => void) | undefined,
  ctx: unknown,
) => Promise<GoverningToolResult>;

export type { AgentToolCallOutcome, AgentToolResult } from "@earendil-works/pi-agent-core";

/** Bounds for external results (within IPC MAX_PAYLOAD_BYTES 256KiB). */

/**
 * Valid public SDK `Usage` shape (pi-ai): all counters finite non-negative,
 * totalTokens present, cost a full breakdown object (never a collapsed
 * number). Anything else is NOT forwarded as `AgentToolResult.usage`.
 */
export function isValidUsage(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  for (const k of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    if (typeof r[k] !== "number" || !Number.isFinite(r[k] as number) || (r[k] as number) < 0) return false;
  }
  const c = r["cost"];
  if (typeof c !== "object" || c === null) return false;
  for (const k of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
    const v = (c as Record<string, unknown>)[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return false;
  }
  return true;
}

/**
 * Wire receipt: preserve a valid public `Usage` verbatim, or drop it
 * (invalid/incomplete shapes are never forwarded as SDK Usage; the ledger
 * keeps its own numeric aggregate separately and marks the loss).
 */
export const EXTERNAL_TEXT_MAX = 48_000;
export const EXTERNAL_RESULT_MAX = 200_000;
const MAX_CONTENT_BLOCKS = 50;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function hasExecute(v: unknown): v is { execute: (...args: never[]) => Promise<GoverningToolResult> } {
  return isRecord(v) && typeof (v as { execute?: unknown }).execute === "function";
}

/** Type guard for a governing handle snapshot (never trusts live array). */
export function isGoverningHandle(v: unknown): v is PinnedGoverningHandle {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return typeof r["name"] === "string" && (r["name"] as string).length > 0 && hasExecute(v);
}

/**
 * Snapshot the governing session's current callable handles from a base
 * `ExtensionToolContext`-like value. Returns a copy (never the live array);
 * skips malformed entries rather than throwing (availability is resolved
 * separately against allowlist patterns).
 */
export function snapshotGoverningHandles(baseCtx: unknown): PinnedGoverningHandle[] {
  if (!isRecord(baseCtx)) return [];
  const tools = (baseCtx as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  const out: PinnedGoverningHandle[] = [];
  for (const t of tools) {
    if (!isGoverningHandle(t)) continue;
    out.push(t);
  }
  return out;
}

/** Names of a handle snapshot (for allowlist resolution). */
export function governingHandleNames(handles: readonly PinnedGoverningHandle[]): string[] {
  return handles.map((h) => h.name);
}

/**
 * Create a broker-scoped context that preserves the base context via
 * prototype (never spread-flatten, so live getters like `cwd`/`model` and
 * `assertActive` revocation keep working), overriding only `tools` and
 * `executeTool`.
 */
export function createScopedGoverningContext(
  baseCtx: object,
  overrides: {
    tools: () => readonly unknown[];
    executeTool: (name: string, args: unknown, options?: { signal?: AbortSignal; onUpdate?: (p: import("@earendil-works/pi-agent-core").AgentToolResult) => void }) => Promise<import("@earendil-works/pi-agent-core").AgentToolCallOutcome>;
    /** Child-owned lifetime signal (exposed as the scoped `signal`, not the governing one). */
    signal?: () => AbortSignal | undefined;
  },
): object {
  return Object.create(baseCtx, {
    tools: { get: overrides.tools, enumerable: true, configurable: true },
    executeTool: { value: overrides.executeTool, writable: false, enumerable: true, configurable: true },
    ...(overrides.signal !== undefined ? { signal: { get: overrides.signal, enumerable: true, configurable: true } } : {}),
  });
}

/** Combine child lifetime with an explicit nested signal (both must cancel). */
export function combineSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
  if (!secondary || secondary === primary) return primary;
  if (primary.aborted) return primary;
  if (secondary.aborted) return secondary;
  if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
    return (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([primary, secondary]);
  }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  primary.addEventListener("abort", onAbort, { once: true });
  secondary.addEventListener("abort", onAbort, { once: true });
  if (primary.aborted || secondary.aborted) controller.abort();
  return controller.signal;
}

/**
 * Wrap one parent handle for a child: the wrapper presents a 4-arg execute
 * (compatible with public `runToolCall`) but always forwards the broker's
 * scoped context as the pinned 5th arg, so internal `ctx.executeTool` and
 * `ctx.tools` accesses cannot escape child grants. Never exposes the raw
 * parent handle or raw control closures.
 */
export function wrapGoverningHandleForChild(
  parent: PinnedGoverningHandle,
  scopedCtx: unknown,
): PinnedGoverningHandle {
  const execute: PinnedGoverningExecute = (toolCallId, params, signal, onUpdate, _ctx) => {
    return parent.execute(toolCallId, params, signal, onUpdate, scopedCtx);
  };
  return {
    name: parent.name,
    description: parent.description,
    parameters: parent.parameters,
    ...(parent.prepareArguments !== undefined ? { prepareArguments: parent.prepareArguments } : {}),
    ...(parent.outputSchema !== undefined ? { outputSchema: parent.outputSchema } : {}),
    ...(parent.executionMode !== undefined ? { executionMode: parent.executionMode } : {}),
    execute,
  };
}

/** Normalize a thrown/returned failure to an isError result (never throws). */
export function normalizeExternalError(code: string, message: string): GoverningToolResult {
  const text = message.startsWith(code) ? message : `${code}: ${message}`;
  return { content: [{ type: "text", text: text.slice(0, EXTERNAL_TEXT_MAX) }], details: {}, isError: true };
}

/**
 * Bound an external result to IPC limits: at most MAX_CONTENT_BLOCKS blocks,
 * text truncated to EXTERNAL_TEXT_MAX, total JSON within EXTERNAL_RESULT_MAX
 * (guaranteed postcondition). Preserves actual schemas/content — truncates,
 * never rewrites types. Oversize images truncated with explicit markers,
 * excess blocks dropped with explicit `[dropped N block(s)]` markers, and
 * details/structuredContent dropped only with explicit `[details dropped]`
 * markers in content (never silent loss).
 */
export function boundExternalResult(result: GoverningToolResult): GoverningToolResult {
  const isError = result.isError === true;
  const rawBlocks = Array.isArray(result.content) ? result.content : [];
  const droppedBlocks = Math.max(0, rawBlocks.length - MAX_CONTENT_BLOCKS);
  const blocks = rawBlocks.slice(0, MAX_CONTENT_BLOCKS);
  let content: GoverningResultContent[] = blocks.map((b) => {
    if (!isRecord(b)) return { type: "text", text: "[invalid content block]" };
    const type = typeof (b as { type?: unknown }).type === "string" ? (b as { type: string }).type : "text";
    if (type === "text") {
      const text = typeof (b as { text?: unknown }).text === "string" ? ((b as { text: string }).text as string) : "";
      return { ...b, type, text: text.length > EXTERNAL_TEXT_MAX ? `${text.slice(0, EXTERNAL_TEXT_MAX)}\n[truncated]` : text };
    }
    // Images (and other non-text blocks): never slice encoded bytes (that
    // would produce invalid content). Keep whole when the payload fits;
    // oversize images are replaced below with an explicit text marker.
    return { ...b, type };
  });
  if (droppedBlocks > 0) {
    content = [...content, { type: "text", text: `[dropped ${droppedBlocks} content block(s): output bound]` }];
  }
  const fits = (v: GoverningToolResult): boolean => {
    try {
      return Buffer.byteLength(JSON.stringify(v), "utf8") <= EXTERNAL_RESULT_MAX;
    } catch {
      return false;
    }
  };
  // Wire usage: a valid public Usage is preserved verbatim (never collapsed
  // into the ledger aggregate); invalid/incomplete shapes are dropped here
  // with an accurate marker instead of being forwarded as SDK Usage.
  // INVALID (unrecognized shape) and oversize losses use distinct markers:
  // tiny invalid values must never read as oversize truncation.
  const droppedInvalid: string[] = [];
  const droppedOversize: string[] = [];
  let usage: unknown;
  if (result.usage === undefined || result.usage === null) {
    usage = undefined;
  } else if (isValidUsage(result.usage)) {
    usage = result.usage;
  } else {
    usage = undefined;
    droppedInvalid.push("usage");
  }
  const markDropped = (list: GoverningResultContent[]): GoverningResultContent[] => {
    const marks: string[] = [];
    if (droppedInvalid.length > 0) marks.push(`[${droppedInvalid.join("/")} dropped: invalid]`);
    if (droppedOversize.length > 0) marks.push(`[${droppedOversize.join("/")} dropped: oversize]`);
    return marks.length > 0 ? [...list, { type: "text", text: marks.join(" ") }] : list;
  };
  let out: GoverningToolResult = {
    ...result,
    content: markDropped(content),
    ...(usage === undefined ? { usage: undefined } : { usage }),
    ...(isError ? { isError: true as const } : {}),
  };
  // Remove the explicit undefined so JSON shape stays clean.
  if (out.usage === undefined) delete (out as { usage?: unknown }).usage;
  if (fits(out)) return out;
  // Oversize: replace oversize image blocks with explicit text markers first
  // (never sliced bytes), then drop details/structuredContent/usage with an
  // accurate marker naming every field actually dropped.
  const withoutImages: GoverningResultContent[] = [];
  let droppedImages = 0;
  for (const b of content) {
    if (b.type === "image") {
      try {
        if (Buffer.byteLength(JSON.stringify(b), "utf8") > EXTERNAL_TEXT_MAX) {
          droppedImages++;
          continue;
        }
      } catch {
        droppedImages++;
        continue;
      }
    }
    withoutImages.push(b);
  }
  if (droppedImages > 0) {
    withoutImages.push({ type: "text", text: `[dropped ${droppedImages} image block(s): output bound]` });
  }
  // Strip arbitrary block metadata beyond the known content shape when still
  // oversize (usage/metadata included in the size check below).
  const slim = (list: GoverningResultContent[]): GoverningResultContent[] =>
    list.map((b): GoverningResultContent => {
      if (b.type === "text") return { type: "text", text: typeof b.text === "string" ? b.text : "" };
      if (b.type === "image") {
        const data = typeof b.data === "string" ? b.data : "";
        const mimeType = typeof b.mimeType === "string" ? b.mimeType : "";
        return { type: "image", data, mimeType };
      }
      return { type: b.type };
    });
  droppedOversize.push("details", "structuredContent");
  out = {
    content: markDropped(withoutImages),
    details: {},
    structuredContent: undefined,
    ...(usage === undefined ? {} : { usage }),
    ...(isError ? { isError: true as const } : {}),
  };
  if (out.usage === undefined) delete (out as { usage?: unknown }).usage;
  if (out.structuredContent === undefined) delete (out as { structuredContent?: unknown }).structuredContent;
  if (fits(out)) return out;
  // Truncate long texts harder, keeping markers explicit.
  const hard: GoverningResultContent[] = out.content.map((b) => {
    if (b.type === "text" && typeof b.text === "string" && b.text.length > 8000) {
      return { type: "text", text: `${b.text.slice(0, 8000)}\n[truncated]` };
    }
    return b;
  });
  out = { content: slim(hard), details: {}, structuredContent: undefined, ...(usage === undefined ? {} : { usage }), ...(isError ? { isError: true as const } : {}) };
  if (out.usage === undefined) delete (out as { usage?: unknown }).usage;
  if (out.structuredContent === undefined) delete (out as { structuredContent?: unknown }).structuredContent;
  if (fits(out)) return out;
  // Drop usage too — but a valid SMALL usage is kept whenever the wire
  // fits after content reduction (billing facts are too valuable to drop
  // first); only genuinely oversize usage is dropped, always named.
  if (usage !== undefined) {
    const keepUsage: GoverningToolResult = {
      content: [...slim(hard), { type: "text", text: "[details/structuredContent dropped: oversize]" }],
      details: {},
      structuredContent: undefined,
      usage,
      ...(isError ? { isError: true as const } : {}),
    };
    delete (keepUsage as { structuredContent?: unknown }).structuredContent;
    if (fits(keepUsage)) return keepUsage;
  }
  out = {
    content: [...slim(hard), { type: "text", text: "[usage/details/structuredContent dropped: oversize]" }],
    details: {},
    structuredContent: undefined,
    ...(isError ? { isError: true as const } : {}),
  };
  delete (out as { structuredContent?: unknown }).structuredContent;
  if (fits(out)) return out;
  // Final checked minimal fallback (always fits; preserves error status and
  // names every field actually dropped: content, usage, details,
  // structuredContent).
  const fallback: GoverningToolResult = {
    content: [{ type: "text", text: "PAYLOAD_TOO_LARGE: external result exceeds IPC bound; content/usage/details/structuredContent dropped" }],
    details: {},
    ...(isError ? { isError: true as const } : {}),
  };
  if (fits(fallback)) return fallback;
  return { content: [{ type: "text", text: "PAYLOAD_TOO_LARGE" }], details: {}, ...(isError ? { isError: true as const } : {}) };
}
