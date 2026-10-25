/**
 * ponygirls-subagents — supervisor-side worker transport.
 *
 * Launches the packaged worker through Node fork() with an explicit
 * executable, empty inherited execArgv, explicit environment, no shell
 * interpolation, and one IPC channel. Task text travels in structured
 * messages, never argv. stdout/stderr are bounded diagnostic streams.
 *
 * Handshake with readiness timeout; a spawn rollback guard owns the child
 * until initial input is accepted and cleans up failed/cancelled startup.
 * IPC send callbacks mean transport progress, not receiver acceptance:
 * requests require application responses correlated by requestId.
 */

import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { err } from "./errors.ts";
import { bindChannel, validateEnvelope, type ChannelBinding, type IpcEnvelope, type ProviderAdmissionPayload, type ProviderAdmissionResponse, type WorkerEvent } from "./protocol.ts";
import { PROTOCOL_VERSION } from "./types.ts";

export const HANDSHAKE_TIMEOUT_MS = 30_000;
export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_DIAG_BYTES = 64 * 1024;

export interface WorkerLaunchOptions {
  workerPath: string;
  rootEpoch: string;
  agentId: string;
  sdkRoot: string | null;
  deterministic: boolean;
  agentDir: string;
  /** Private native-session directory (supervisor-owned, outside tool views). */
  sessionsDir: string;
  /** Host agent dir for the approved credential store (live reference). */
  hostAgentDir?: string;
  script?: Array<{ text?: string; repeat?: number; tool?: string; args?: Record<string, unknown> }>;
  extraEnv?: Record<string, string>;
}

export type WorkerEventHandler = (event: WorkerEvent, envelope: IpcEnvelope) => void;
export interface ToolRequest {
  tool: string;
  args: Record<string, unknown>;
  toolCallId: string;
  /** Prepared-ticket id minted by tool.prepare (absent for legacy direct calls). */
  ticket?: string;
  /** The generation's provider usage up to this call (worker-reported). */
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number; reasoning?: number | null; cost: number | null; unknown: boolean } | null;
}

/**
 * Supervisor answer to a worker `tool.execute` request.
 *
 * `content` is a legacy text string for native broker tools, or a content
 * block array (text/image/...) for external governing-runtime tools
 * (preserved schemas/results, bounded to IPC limits). Never a generic
 * untyped catchall: external blocks carry the parent tool's actual content.
 */
export interface ToolResponse {
  content: string | Array<Record<string, unknown>>;
  isError: boolean;
  details?: unknown;
  structuredContent?: unknown;
  usage?: unknown;
}

export type ToolRequestHandler = (payload: ToolRequest, envelope: IpcEnvelope) => Promise<ToolResponse>;

/** Worker -> supervisor preparation-only request (no execution). */
export interface ToolPrepareRequest {
  tool: string;
  args: Record<string, unknown>;
  toolCallId: string;
}

/** Supervisor answer: prepared args bound to a single-use ticket, or an error. */
export interface ToolPrepareResponse {
  ok: boolean;
  ticket?: string;
  preparedArgs?: Record<string, unknown>;
  error?: string;
}

export type ToolPrepareHandler = (payload: ToolPrepareRequest, envelope: IpcEnvelope) => Promise<ToolPrepareResponse>;

/** Worker -> supervisor notice releasing unconsumed prepared tickets. */
export type ToolTicketReleaseHandler = (payload: { tickets: string[] }, envelope: IpcEnvelope) => void;

/** Worker -> supervisor narrow provider-admission query (one NEW provider request). */
export type ProviderAdmissionHandler = (payload: ProviderAdmissionPayload, envelope: IpcEnvelope) => Promise<ProviderAdmissionResponse>;

export type WorkerExitHandler = (info: { code: number | null; signal: string | null }) => void;

export class WorkerHandle {
  private proc: ChildProcess | null = null;
  private binding: ChannelBinding;
  private workerInstanceId: string;
  private pending = new Map<string, { resolve: (p: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private onEvent: WorkerEventHandler | null = null;
  private onToolRequest: ToolRequestHandler | null = null;
  private onPrepareRequest: ToolPrepareHandler | null = null;
  private onTicketRelease: ToolTicketReleaseHandler | null = null;
  private onProviderAdmissionRequest: ProviderAdmissionHandler | null = null;
  private onExit: WorkerExitHandler | null = null;
  private stdoutTail = Buffer.alloc(0);
  private stderrTail = Buffer.alloc(0);
  private exited: { code: number | null; signal: string | null } | null = null;
  private disposed = false;

  private options: WorkerLaunchOptions;
  constructor(
    options: WorkerLaunchOptions,
    binding: ChannelBinding,
  ) {
    this.options = options;
    this.binding = binding;
    this.workerInstanceId = binding.workerInstanceId;
  }

  get instanceId(): string {
    return this.workerInstanceId;
  }

  /** OS pid for recovery ownership verification (null when unknown). */
  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  get exit(): { code: number | null; signal: string | null } | null {
    return this.exited;
  }

  diagnostics(): { stdout: string; stderr: string } {
    return { stdout: this.stdoutTail.toString("utf8"), stderr: this.stderrTail.toString("utf8") };
  }

  setEventHandler(handler: WorkerEventHandler): void {
    this.onEvent = handler;
  }

  setToolRequestHandler(handler: ToolRequestHandler): void {
    this.onToolRequest = handler;
  }

  setPrepareRequestHandler(handler: ToolPrepareHandler): void {
    this.onPrepareRequest = handler;
  }

  setTicketReleaseHandler(handler: ToolTicketReleaseHandler): void {
    this.onTicketRelease = handler;
  }

  setProviderAdmissionRequestHandler(handler: ProviderAdmissionHandler): void {
    this.onProviderAdmissionRequest = handler;
  }

  /** Called once if the process exits without being disposed by the supervisor. */
  setExitHandler(handler: WorkerExitHandler): void {
    this.onExit = handler;
  }

  /** Launch and complete the handshake. Guard owns the child until ready. */
  async launch(): Promise<void> {
    const env: Record<string, string> = {
      PI_SUBAGENTS_WORKER: "1",
      PATH: "/usr/bin:/bin",
      HOME: this.options.agentDir,
      PI_SUBAGENTS_AGENT_DIR: this.options.agentDir,
      PI_SUBAGENTS_SESSIONS_DIR: this.options.sessionsDir,
      ...(this.options.sdkRoot ? { PI_SUBAGENTS_SDK_ROOT: this.options.sdkRoot } : {}),
      ...(this.options.hostAgentDir ? { PI_SUBAGENTS_HOST_AGENT_DIR: this.options.hostAgentDir } : {}),
      ...(this.options.deterministic ? { PI_SUBAGENTS_DETERMINISTIC: "1" } : {}),
      ...(this.options.script ? { PI_SUBAGENTS_SCRIPT: JSON.stringify(this.options.script) } : {}),
      ...this.options.extraEnv,
    };
    const proc = fork(this.options.workerPath, [], {
      execArgv: [],
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.proc = proc;
    // Without a listener, a failed spawn or send would be thrown in the
    // governing process; failures surface through exit and request errors.
    proc.on("error", () => {});
    proc.stdout?.on("data", (d: Buffer) => {
      this.stdoutTail = Buffer.concat([this.stdoutTail, d]).subarray(-MAX_DIAG_BYTES);
    });
    proc.stderr?.on("data", (d: Buffer) => {
      this.stderrTail = Buffer.concat([this.stderrTail, d]).subarray(-MAX_DIAG_BYTES);
    });
    proc.on("message", (raw: unknown) => {
      void this.onInbound(raw);
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker handshake timeout")), HANDSHAKE_TIMEOUT_MS);
      const check = (raw: unknown): void => {
        const e = raw as Record<string, unknown>;
        if (e?.["operation"] === "ready" && validateEnvelope(raw, this.binding, "from-worker").ok) {
          clearTimeout(timer);
          proc.off("message", check);
          resolve();
        }
      };
      proc.on("message", check);
      proc.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`worker exited during handshake (code ${code}, signal ${signal}): ${this.stderrTail.toString("utf8").slice(-2000)}`));
      });
    });
    proc.on("exit", (code, signal) => {
      this.exited = { code, signal };
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`worker exited before response (request ${id})`));
      }
      this.pending.clear();
      if (!this.disposed) this.onExit?.({ code, signal });
    });
    // Hello carries the binding; worker answers with a `ready` event.
    this.send({ operation: "__hello", rootEpoch: this.options.rootEpoch, agentId: this.options.agentId, workerInstanceId: this.workerInstanceId });
    try {
      await ready;
    } catch (e) {
      this.kill();
      throw err("INVALID", `worker handshake failed: ${(e as Error).message}`);
    }
  }

  /** Send a supervisor operation and await the application response. */
  request(operation: string, payload: unknown, opts?: { taskRunId?: string; generation?: number; timeoutMs?: number }): Promise<unknown> {
    if (this.disposed || !this.proc || this.exited) {
      return Promise.reject(new Error("worker not running"));
    }
    const requestId = randomUUID();
    const envelope: IpcEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      rootEpoch: this.binding.rootEpoch,
      agentId: this.binding.agentId,
      workerInstanceId: this.workerInstanceId,
      requestId,
      seq: null,
      type: "request",
      operation,
      taskRunId: opts?.taskRunId ?? null,
      executionGeneration: opts?.generation ?? null,
      payload,
    };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`worker request timeout: ${operation}`));
      }, opts?.timeoutMs ?? REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      // Send callback is transport progress, not receiver acceptance;
      // the application response resolves the promise.
      this.send(envelope, (sendErr) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(sendErr);
      });
    });
  }

  kill(): void {
    this.disposed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("worker handle disposed"));
    }
    this.pending.clear();
    try {
      this.proc?.kill("SIGKILL");
    } catch {
      // already gone
    }
  }

  /** IPC send that never throws or emits: a closed channel is reported to onError. */
  private send(message: unknown, onError?: (e: Error) => void): void {
    const proc = this.proc;
    if (!proc || !proc.connected) {
      onError?.(new Error("worker channel closed"));
      return;
    }
    proc.send(message as object, (sendErr) => {
      if (sendErr) onError?.(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
    });
  }

  private async onInbound(raw: unknown): Promise<void> {
    const checked = validateEnvelope(raw, this.binding, "from-worker");
    if (!checked.ok) {
      // A request is answered even when rejected, so its caller never waits
      // for a timer; anything else malformed is dropped.
      const r = raw as Record<string, unknown> | null;
      if (r?.["type"] === "request" && (r["operation"] === "tool.execute" || r["operation"] === "tool.prepare" || r["operation"] === "provider.admission") && typeof r["requestId"] === "string") {
        const hint = checked.code === "PAYLOAD_TOO_LARGE" ? "; split the content into smaller pieces" : "";
        this.send({
          protocolVersion: PROTOCOL_VERSION,
          rootEpoch: this.binding.rootEpoch,
          agentId: this.binding.agentId,
          workerInstanceId: this.workerInstanceId,
          requestId: r["requestId"],
          seq: null,
          type: "response",
          operation: r["operation"] as string,
          taskRunId: null,
          executionGeneration: null,
          payload: r["operation"] === "tool.prepare"
            ? { ok: false, error: `${checked.code}: ${checked.message}${hint}` }
            : r["operation"] === "provider.admission"
              ? { ok: false, code: checked.code, error: `${checked.code}: ${checked.message}${hint}` }
              : { ok: false, content: `${checked.code}: ${checked.message}${hint}` },
        });
      }
      return;
    }
    const env = checked.envelope;
    if (env.operation === "ready") return; // consumed by the handshake
    if (env.type === "response" && env.requestId !== null) {
      const pending = this.pending.get(env.requestId);
      if (!pending) return;
      this.pending.delete(env.requestId);
      clearTimeout(pending.timer);
      pending.resolve(env.payload);
      return;
    }
    if (env.operation === "event") {
      const payload = env.payload as { kind?: string; detail?: Record<string, unknown> } & Record<string, unknown>;
      // The worker sends the WorkerEvent as payload while the envelope
      // carries the fenced ids; unwrap one level (never double-nest).
      if (typeof payload?.["kind"] === "string" && this.onEvent) {
        this.onEvent(
          {
            kind: payload["kind"] as WorkerEvent["kind"],
            taskRunId: env.taskRunId,
            executionGeneration: env.executionGeneration,
            detail: (payload["detail"] ?? {}) as Record<string, unknown>,
          },
          env,
        );
      }
      return;
    }
    if (env.operation === "tool.execute") {
      const payload = env.payload as { tool?: string; args?: Record<string, unknown>; toolCallId?: string; ticket?: string; usage?: ToolRequest["usage"] };
      if (typeof payload?.["tool"] !== "string" || !this.onToolRequest) {
        this.respondTool(env, { content: "INVALID: malformed tool request", isError: true });
        return;
      }
      try {
        const result = await this.onToolRequest({
          tool: payload["tool"] as string,
          args: (payload["args"] as Record<string, unknown>) ?? {},
          toolCallId: typeof payload["toolCallId"] === "string" ? (payload["toolCallId"] as string) : "",
          ticket: typeof payload["ticket"] === "string" ? (payload["ticket"] as string) : undefined,
          usage: payload["usage"] ?? null,
        }, env);
        this.respondTool(env, result);
      } catch (e) {
        this.respondTool(env, { content: `INVALID: ${(e as Error).message}`, isError: true });
      }
      return;
    }
    if (env.operation === "tool.prepare") {
      const payload = env.payload as { tool?: string; args?: Record<string, unknown>; toolCallId?: string };
      // Explicit UNSUPPORTED (not a denial): the peer predates tool.prepare.
      // Workers downgrade to the legacy unticketed path on exactly this
      // signal; every other ok:false is a hard denial that never downgrades.
      if (!this.onPrepareRequest) {
        this.respondPrepare(env, { ok: false, error: "UNSUPPORTED: tool.prepare not implemented by peer" });
        return;
      }
      if (typeof payload?.["tool"] !== "string") {
        this.respondPrepare(env, { ok: false, error: "INVALID: malformed prepare request" });
        return;
      }
      try {
        this.respondPrepare(env, await this.onPrepareRequest({
          tool: payload["tool"] as string,
          args: (payload["args"] as Record<string, unknown>) ?? {},
          toolCallId: typeof payload["toolCallId"] === "string" ? (payload["toolCallId"] as string) : "",
        }, env));
      } catch (e) {
        this.respondPrepare(env, { ok: false, error: `INVALID: ${(e as Error).message}` });
      }
      return;
    }
    if (env.operation === "tool.ticket-release") {
      // One-way notice: unconsumed prepared tickets the worker dropped after
      // local validation/hook blocks, aborts, or settlement. No answer.
      const payload = env.payload as { tickets?: unknown };
      if (Array.isArray(payload?.["tickets"]) && this.onTicketRelease) {
        try {
          this.onTicketRelease({ tickets: (payload["tickets"] as unknown[]).filter((x): x is string => typeof x === "string") }, env);
        } catch {
          // best effort; tickets also expire with their task/generation scope
        }
      }
      return;
    }
    if (env.operation === "provider.admission") {
      // Narrow per-request admission query: available during hold so it can
      // return a denial (model inference itself is never exempt control).
      const payload = env.payload as { reason?: unknown; provider?: unknown; modelId?: unknown; thinkingLevel?: unknown };
      if (!this.onProviderAdmissionRequest) {
        this.respondAdmission(env, { ok: false, code: "UNSUPPORTED", error: "UNSUPPORTED: provider.admission not implemented by peer" });
        return;
      }
      if (typeof payload?.["reason"] !== "string" || typeof payload?.["provider"] !== "string" || typeof payload?.["modelId"] !== "string" || typeof payload?.["thinkingLevel"] !== "string") {
        this.respondAdmission(env, { ok: false, code: "INVALID", error: "INVALID: malformed provider admission request" });
        return;
      }
      if (typeof env.taskRunId !== "string" || env.taskRunId.length === 0 || typeof env.executionGeneration !== "number" || !Number.isInteger(env.executionGeneration) || env.executionGeneration < 0) {
        this.respondAdmission(env, { ok: false, code: "INVALID", error: "INVALID: provider admission requires a nonempty taskRunId and nonneg integer executionGeneration" });
        return;
      }
      try {
        this.respondAdmission(env, await this.onProviderAdmissionRequest({
          reason: payload["reason"] as string,
          provider: payload["provider"] as string,
          modelId: payload["modelId"] as string,
          thinkingLevel: payload["thinkingLevel"] as string,
        }, env));
      } catch (e) {
        this.respondAdmission(env, { ok: false, code: "INVALID", error: `INVALID: ${(e as Error).message}` });
      }
      return;
    }
  }

  private respondPrepare(env: IpcEnvelope, result: ToolPrepareResponse): void {
    const response: IpcEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      rootEpoch: this.binding.rootEpoch,
      agentId: this.binding.agentId,
      workerInstanceId: this.workerInstanceId,
      requestId: env.requestId,
      seq: null,
      type: "response",
      operation: "tool.prepare",
      taskRunId: env.taskRunId,
      executionGeneration: env.executionGeneration,
      payload: { ok: result.ok, ...(result.ticket !== undefined ? { ticket: result.ticket } : {}), ...(result.preparedArgs !== undefined ? { preparedArgs: result.preparedArgs } : {}), ...(result.error !== undefined ? { error: result.error } : {}) },
    };
    this.send(response);
  }

  private respondAdmission(env: IpcEnvelope, result: ProviderAdmissionResponse): void {
    const response: IpcEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      rootEpoch: this.binding.rootEpoch,
      agentId: this.binding.agentId,
      workerInstanceId: this.workerInstanceId,
      requestId: env.requestId,
      seq: null,
      type: "response",
      operation: "provider.admission",
      taskRunId: env.taskRunId,
      executionGeneration: env.executionGeneration,
      payload: { ok: result.ok, ...(result.code !== undefined ? { code: result.code } : {}), ...(result.error !== undefined ? { error: result.error } : {}), ...(result.ok && result.auth !== undefined ? { auth: result.auth } : {}) },
    };
    this.send(response);
  }

  private respondTool(env: IpcEnvelope, result: ToolResponse): void {
    const response: IpcEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      rootEpoch: this.binding.rootEpoch,
      agentId: this.binding.agentId,
      workerInstanceId: this.workerInstanceId,
      requestId: env.requestId,
      seq: null,
      type: "response",
      operation: "tool.execute",
      taskRunId: env.taskRunId,
      executionGeneration: env.executionGeneration,
      payload: {
        ok: !result.isError,
        content: result.content,
        ...(result.details !== undefined ? { details: result.details } : {}),
        ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
        ...(result.usage !== undefined ? { usage: result.usage } : {}),
      },
    };
    // A worker that died while its tool ran gets no answer; that is not an
    // error in the governing process.
    this.send(response);
  }
}

export function newWorkerBinding(rootEpoch: string, agentId: string): ChannelBinding {
  return bindChannel(rootEpoch, agentId, randomUUID());
}
