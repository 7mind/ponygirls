/**
 * One extension activation bound to one native Pi session: it owns that
 * session's supervisor client. Task authority never moves to another session;
 * a session switch, fork, or reload ends this activation.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SupervisorBackend, type ShutdownReason, type TaskBackend } from "./backend.ts";
import { BgTaskError, OWNER_HANDOFF_WAIT_MS, SIDECAR_SUFFIX, retryDelayMs, type SessionId } from "./protocol.ts";

export interface RuntimeConfig {
  python: string;
  shell: string;
  script: string;
}

export type ConfigResult = { ok: true; config: RuntimeConfig } | { ok: false; error: string };

/** Executables are packaging-supplied dependencies, never guessed. */
export function readRuntimeConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const python = env.PI_BG_TASKS_PYTHON;
  const shell = env.PI_BG_TASKS_SHELL;
  const missing = [!python && "PI_BG_TASKS_PYTHON", !shell && "PI_BG_TASKS_SHELL"].filter(Boolean);
  if (missing.length) return { ok: false, error: `${missing.join(" and ")} must name the packaged executables` };
  if (!python!.startsWith("/") || !shell!.startsWith("/")) return { ok: false, error: "PI_BG_TASKS_PYTHON and PI_BG_TASKS_SHELL must be absolute paths" };
  return { ok: true, config: { python: python!, shell: shell!, script: fileURLToPath(new URL("../supervisor.py", import.meta.url)) } };
}

export interface ActivationInit {
  sessionId: SessionId;
  sessionFile: string | undefined;
  config: ConfigResult;
}

export class Activation {
  readonly sessionId: SessionId;
  readonly sidecar: string | null;
  private readonly config: ConfigResult;
  private starting: Promise<TaskBackend> | null = null;
  private current: SupervisorBackend | null = null;
  private disposed = false;
  private readonly backendListeners = new Set<(backend: SupervisorBackend) => void>();
  private readonly restartFailureListeners = new Set<(error: unknown, retryInMs: number) => void>();
  private restartFailures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(init: ActivationInit) {
    this.sessionId = init.sessionId;
    this.sidecar = init.sessionFile ? `${init.sessionFile}${SIDECAR_SUFFIX}` : null;
    this.config = init.config;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Whether earlier activations left state to recover and notices to replay. */
  hasExistingState(): boolean {
    return this.sidecar !== null && existsSync(this.sidecar);
  }

  /** Called when restarting a lost supervisor failed; another attempt follows after `retryInMs`. */
  onRestartFailed(listener: (error: unknown, retryInMs: number) => void): void {
    this.restartFailureListeners.add(listener);
  }

  /** Called for every newly started supervisor (startup recovery or after supervisor loss). */
  onBackend(listener: (backend: SupervisorBackend) => void): void {
    this.backendListeners.add(listener);
  }

  backend(): Promise<TaskBackend> {
    if (this.disposed) return Promise.reject(new BgTaskError("ACTIVATION_DISPOSED", "this extension activation has ended"));
    if (!this.config.ok) return Promise.reject(new BgTaskError("CONFIG_MISSING", this.config.error));
    if (this.sidecar === null) return Promise.reject(new BgTaskError("NO_PERSISTENT_SESSION", "background tasks need a persistent session file (not --no-session)"));
    if (this.current && !this.current.isLost) return Promise.resolve(this.current);
    if (!this.starting) {
      const config = this.config.config;
      const sidecar = this.sidecar;
      this.starting = SupervisorBackend.start({ python: config.python, script: config.script, shell: config.shell, sidecar, sessionId: this.sessionId, handoffWaitMs: OWNER_HANDOFF_WAIT_MS })
        .then(async (backend) => {
          if (this.disposed) {
            await backend.shutdown("quit");
            throw new BgTaskError("ACTIVATION_DISPOSED", "this extension activation has ended");
          }
          this.current = backend;
          backend.onLost(() => this.restart(backend));
          for (const listener of this.backendListeners) listener(backend);
          return backend;
        })
        .finally(() => { this.starting = null; });
    }
    return this.starting;
  }

  /**
   * The current supervisor exited on its own: start its successor now, so that
   * recovery commits the lost tasks' outcomes and their notices go out without
   * waiting for a tool call. Failed starts are retried with backoff.
   */
  private restart(lost: SupervisorBackend): void {
    if (this.disposed || this.current !== lost || this.restartTimer !== null) return;
    this.backend().then(
      () => {
        this.restartFailures = 0;
      },
      (error: unknown) => {
        if (this.disposed) return;
        this.restartFailures++;
        const delay = retryDelayMs(this.restartFailures);
        for (const listener of this.restartFailureListeners) listener(error, delay);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.restart(lost);
        }, delay);
      },
    );
  }

  /** Graceful end of this activation; owned tasks stop and keep their outcomes and pending notices. */
  async shutdown(reason: ShutdownReason): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const pending = this.starting;
    if (pending) await pending.catch(() => undefined);
    const backend = this.current;
    this.current = null;
    if (backend && !backend.isLost) await backend.shutdown(reason);
  }
}
