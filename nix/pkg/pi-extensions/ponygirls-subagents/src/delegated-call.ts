/**
 * ponygirls-subagents — preparation of delegated governing-session calls.
 *
 * Delegated calls never replay the governing session's `tool_call` hooks
 * (authorization stays the supervisor's). Extensions whose tools need the
 * preparation such a hook performs (e.g. ponygirls-codegraph building the
 * target index and canonicalizing `projectPath`) opt in through this
 * `pi.events` channel instead. The contract is duplicated, not imported, by
 * participating extensions (they are packaged separately):
 *
 * - The payload is emitted synchronously. A handler that prepares the call
 *   must call `waitUntil(work)` before its first `await`.
 * - `input` is a copy of the validated arguments; handlers may change it in
 *   place. The changed copy is what the tool receives.
 * - `cwd` is the child's working directory, for resolving relative paths.
 * - A rejected `work` blocks the call; its message is the child's error.
 */

export const DELEGATED_CALL_CHANNEL = "ponygirls-subagents:prepare-delegated-call";

export interface DelegatedCallEvent {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly cwd: string;
  waitUntil(work: Promise<void>): void;
}

/** A delegated call about to run in the governing session. */
export interface DelegatedCall {
  tool: string;
  args: Record<string, unknown>;
  workdir: string;
}

/** Structural subset of pi's `EventBus`. */
export interface DelegatedCallBus {
  emit(channel: string, data: unknown): void;
}

/**
 * The arguments the tool receives once every opted-in extension prepared the
 * call, or null when none claimed it: the call then proceeds synchronously
 * with its validated arguments, exactly as without this channel.
 */
export function prepareThroughEventBus(bus: DelegatedCallBus, call: DelegatedCall): Promise<Record<string, unknown>> | null {
  const input = structuredClone(call.args);
  const work: Promise<void>[] = [];
  let open = true;
  const event: DelegatedCallEvent = {
    toolName: call.tool,
    input,
    cwd: call.workdir,
    waitUntil: (w) => {
      if (!open) throw new Error(`waitUntil for ${call.tool} must be called synchronously by the event handler`);
      work.push(w);
    },
  };
  bus.emit(DELEGATED_CALL_CHANNEL, event);
  open = false;
  if (work.length === 0) return null;
  return Promise.all(work).then(() => input);
}
