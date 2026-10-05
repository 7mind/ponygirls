/**
 * pi-subagents — supervisor-side worker transport.
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
import { bindChannel, validateEnvelope, type ChannelBinding, type IpcEnvelope, type WorkerEvent } from "./protocol.ts";
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
  script?: Array<{ text?: string; tool?: string; args?: Record<string, unknown> }>;
  extraEnv?: Record<string, string>;
}

export type WorkerEventHandler = (event: WorkerEvent, envelope: IpcEnvelope) => void;
export type ToolRequestHandler = (
  payload: { tool: string; args: Record<string, unknown>; toolCallId: string },
  envelope: IpcEnvelope,
) => Promise<{ content: string; isError: boolean }>;

export class WorkerHandle {
  private proc: ChildProcess | null = null;
  private binding: ChannelBinding;
  private workerInstanceId: string;
  private pending = new Map<string, { resolve: (p: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private onEvent: WorkerEventHandler | null = null;
  private onToolRequest: ToolRequestHandler | null = null;
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
    proc.stdout?.on("data", (d: Buffer) => {
      this.stdoutTail = Buffer.concat([this.stdoutTail, d]).subarray(-MAX_DIAG_BYTES);
    });
    proc.stderr?.on("data", (d: Buffer) => {
      this.stderrTail = Buffer.concat([this.stderrTail, d]).subarray(-MAX_DIAG_BYTES);
    });
    proc.on("message", (raw: unknown) => {
      void this.onInbound(raw);
    });
    proc.on("exit", (code, signal) => {
      this.exited = { code, signal };
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`worker exited before response (request ${id})`));
      }
      this.pending.clear();
    });

    // Hello carries the binding; worker answers with a `ready` event.
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker handshake timeout")), HANDSHAKE_TIMEOUT_MS);
      const check = (raw: unknown): void => {
        const e = raw as Record<string, unknown>;
        if (e?.["operation"] === "ready") {
          const checked = validateEnvelope(raw, this.binding, "from-worker");
          if (checked.ok) {
            clearTimeout(timer);
            proc.off("message", check);
            resolve();
          }
        }
      };
      proc.on("message", check);
    });
    proc.send?.({
      operation: "__hello",
      rootEpoch: this.options.rootEpoch,
      agentId: this.options.agentId,
      workerInstanceId: this.workerInstanceId,
    });
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
      this.proc?.send?.(envelope, (sendErr) => {
        if (sendErr) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          reject(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
        }
        // Send callback is transport progress, not receiver acceptance;
        // the application response resolves the promise.
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

  private async onInbound(raw: unknown): Promise<void> {
    const asRecord = raw as Record<string, unknown>;
    if (asRecord?.["operation"] === "ready") return; // consumed by handshake
    // Responses to supervisor requests.
    if (asRecord?.["type"] === "response" && typeof asRecord["requestId"] === "string") {
      const pending = this.pending.get(asRecord["requestId"] as string);
      if (!pending) return;
      this.pending.delete(asRecord["requestId"] as string);
      clearTimeout(pending.timer);
      pending.resolve((asRecord["payload"] as unknown) ?? null);
      return;
    }
    const checked = validateEnvelope(raw, this.binding, "from-worker");
    if (!checked.ok) return; // Drop malformed/foreign/stale frames.
    const env = checked.envelope;
    if (env.operation === "event") {
      const payload = env.payload as { kind?: string; detail?: Record<string, unknown> } & Record<string, unknown>;
      // The worker sends the WorkerEvent as payload while the envelope
      // carries the fenced ids; unwrap one level (never double-nest).
      if (typeof payload?.["kind"] === "string" && this.onEvent) {
        const inner = (payload["detail"] ?? {}) as Record<string, unknown>;
        this.onEvent(
          {
            kind: payload["kind"] as WorkerEvent["kind"],
            taskRunId: env.taskRunId,
            executionGeneration: env.executionGeneration,
            detail: inner,
          },
          env,
        );
      }
      return;
    }
    if (env.operation === "tool.execute") {
      const payload = env.payload as { tool?: string; args?: Record<string, unknown>; toolCallId?: string };
      if (typeof payload?.["tool"] !== "string" || !this.onToolRequest) {
        this.respondTool(env, { content: "INVALID: malformed tool request", isError: true });
        return;
      }
      try {
        const result = await this.onToolRequest({
          tool: payload["tool"] as string,
          args: (payload["args"] as Record<string, unknown>) ?? {},
          toolCallId: typeof payload["toolCallId"] === "string" ? (payload["toolCallId"] as string) : "",
        }, env);
        this.respondTool(env, result);
      } catch (e) {
        this.respondTool(env, { content: `INVALID: ${(e as Error).message}`, isError: true });
      }
    }
  }

  private respondTool(env: IpcEnvelope, result: { content: string; isError: boolean }): void {
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
      payload: { ok: !result.isError, content: result.content },
    };
    this.proc?.send?.(response);
  }
}

export function newWorkerBinding(rootEpoch: string, agentId: string): ChannelBinding {
  return bindChannel(rootEpoch, agentId, randomUUID());
}
