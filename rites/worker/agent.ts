// The agent runner: one Pi SDK session per run in the trusted host worker.
// The model credential lives in memory only; the model's tool calls are
// brokered into isolated bubblewrap tool-runners (see broker.ts). Success is
// decided ONLY by the last assistant message's stopReason being "stop"; a
// resolved prompt() promise proves nothing by itself. Session invariants
// (active tool set, selected model identity, thinking level) are asserted
// before the run: a silently clamped configuration fails loudly instead.

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type {
  ApiKeyCredential,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { RunOutcome } from "../generated/typescript/rites/worker/RunOutcome.js";
import type { RunRequest } from "../generated/typescript/rites/worker/RunRequest.js";
import { ToolBroker, brokeredToolNames } from "./broker.js";
import type { ApiKeyModelCredential, ModelConfig } from "./model-config.js";
import { loadRunEnvironment, validateToolRunnerEntry } from "./run-env.js";
import { isolatedResourceLoader } from "./resources.js";

export interface AgentRunOutcome {
  readonly outcome: RunOutcome;
  readonly failureCode: string | null;
}

export interface RunAgentOptions {
  readonly request: RunRequest;
  readonly workspace: string;
  readonly modelConfig: ModelConfig;
  /** Total run budget in milliseconds; the internal watchdog fires earlier. */
  readonly timeoutMs: number;
  /** Supervisor-facing cancellation (SIGTERM/SIGINT), already armed. */
  readonly cancel: AbortSignal;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const WATCHDOG_MARGIN_MS_MIN = 250;
const WATCHDOG_MARGIN_MS_MAX = 10_000;

/**
 * In-memory credential store that exposes exactly one API-key credential for
 * exactly one provider. It is never persisted; MODEL_CONFIG stays the only
 * on-disk copy of the secret, and it is never passed to a tool-runner.
 */
class SingleCredentialStore implements CredentialStore {
  private readonly providerId: string;
  private readonly credential: Credential;

  constructor(providerId: string, credential: ApiKeyModelCredential) {
    this.providerId = providerId;
    const apiKeyCredential: ApiKeyCredential = { type: "api_key", key: credential.key };
    this.credential = apiKeyCredential;
  }

  read(providerId: string): Promise<Credential | undefined> {
    return Promise.resolve(this.credentialFor(providerId));
  }

  list(): Promise<readonly CredentialInfo[]> {
    const info: CredentialInfo = { providerId: this.providerId, type: this.credential.type };
    return Promise.resolve([info]);
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const current = this.credentialFor(providerId);
    if (current === undefined) {
      return undefined;
    }
    return fn(current);
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }

  private credentialFor(providerId: string): Credential | undefined {
    if (providerId !== this.providerId) {
      return undefined;
    }
    return this.credential;
  }
}

function terminal(outcome: RunOutcome, failureCode: string | null): AgentRunOutcome {
  return { outcome, failureCode };
}

function failed(failureCode: string): AgentRunOutcome {
  return terminal(RunOutcome.Failed, failureCode);
}

function cancelled(failureCode: string): AgentRunOutcome {
  return terminal(RunOutcome.Cancelled, failureCode);
}

/** Narrow a protocol-validated thinking level to the SDK's union. */
function toThinkingLevel(value: string): ThinkingLevel {
  const level = THINKING_LEVELS.find(entry => entry === value);
  if (level === undefined) {
    throw new Error("thinking level out of range");
  }
  return level;
}

/**
 * Run one request to a terminal outcome. This function never throws: every
 * failure path maps to a bounded machine failureCode without echoing provider
 * text or configuration values.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentRunOutcome> {
  if (options.cancel.aborted) {
    return cancelled("aborted");
  }
  let environment: ReturnType<typeof loadRunEnvironment> | undefined;
  try {
    environment = loadRunEnvironment(process.env);
    validateToolRunnerEntry(environment);
  } catch {
    return failed("worker-internal");
  }
  if (environment === undefined) {
    return failed("worker-internal");
  }
  if (options.cancel.aborted) {
    return cancelled("aborted");
  }
  const root = mkdtempSync(join(tmpdir(), "rites-worker-"));
  let session: AgentSession | undefined;
  let broker: ToolBroker | undefined;
  const cancelState = { cause: undefined as "signal" | "deadline" | undefined };
  const requestAbort = (): void => {
    if (cancelState.cause === undefined) {
      cancelState.cause = "signal";
    }
    if (session !== undefined) {
      void session.abort().catch(() => {
        // An abort that itself fails falls through to the supervisor timeout.
      });
    }
    if (broker !== undefined) {
      broker.cancelAll();
    }
  };
  const watchdogMargin = Math.max(
    WATCHDOG_MARGIN_MS_MIN,
    Math.min(WATCHDOG_MARGIN_MS_MAX, Math.floor(options.timeoutMs / 8)),
  );
  const watchdog = setTimeout(() => {
    if (cancelState.cause === undefined) {
      cancelState.cause = "deadline";
    }
    if (session !== undefined) {
      void session.abort().catch(() => {
        // See requestAbort.
      });
    }
    if (broker !== undefined) {
      broker.cancelAll();
    }
  }, Math.max(WATCHDOG_MARGIN_MS_MIN, options.timeoutMs - watchdogMargin));
  options.cancel.addEventListener("abort", requestAbort, { once: true });
  try {
    mkdirSync(join(root, "agent"), { recursive: true });
    writeFileSync(join(root, "models.json"), JSON.stringify(options.modelConfig.modelsJson));
    let runtime: ModelRuntime;
    try {
      runtime = await ModelRuntime.create({
        credentials: new SingleCredentialStore(
          options.modelConfig.provider,
          options.modelConfig.credential,
        ),
        modelsPath: join(root, "models.json"),
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
    } catch {
      return failed("invalid-config");
    }
    if (options.cancel.aborted) {
      return cancelled("aborted");
    }
    const model = runtime.getModel(options.request.model.provider, options.request.model.model);
    if (model === undefined) {
      return failed("model-unavailable");
    }
    const requestedThinkingLevel = toThinkingLevel(options.request.model.thinkingLevel);
    broker = new ToolBroker({
      environment,
      workspace: options.workspace,
      deadlineAt: Date.now() + options.timeoutMs,
      cancel: options.cancel,
    });
    const created = await createAgentSession({
      cwd: options.workspace,
      agentDir: join(root, "agent"),
      model,
      thinkingLevel: requestedThinkingLevel,
      modelRuntime: runtime,
      resourceLoader: isolatedResourceLoader(),
      tools: brokeredToolNames(),
      customTools: broker.definitions(),
      sessionManager: SessionManager.inMemory(options.workspace),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    });
    session = created.session;

    // The active tool set must be exactly the brokered tools: no built-in
    // host tool may be reachable by the model.
    const activeTools = [...session.getActiveToolNames()].sort();
    const expectedTools = [...brokeredToolNames()].sort();
    if (activeTools.length !== expectedTools.length || activeTools.some((name, index) => name !== expectedTools[index])) {
      return failed("worker-internal");
    }
    // The selected model must be exactly the requested one.
    const selected = session.model;
    if (
      selected === undefined ||
      selected.provider !== options.request.model.provider ||
      selected.id !== options.request.model.model
    ) {
      return failed("model-unavailable");
    }
    // Pi clamps unsupported thinking levels silently; reject instead.
    if (session.thinkingLevel !== requestedThinkingLevel) {
      return failed("thinking-unsupported");
    }

    try {
      await session.prompt(options.request.prompt, { expandPromptTemplates: false });
    } catch {
      return failed("worker-internal");
    }
    if (cancelState.cause === "deadline") {
      return cancelled("deadline");
    }
    if (cancelState.cause === "signal") {
      return cancelled("aborted");
    }
    const messages = session.messages;
    let lastAssistantStopReason: string | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message !== null && typeof message === "object" && "stopReason" in message) {
        lastAssistantStopReason = (message as { stopReason: string }).stopReason;
        break;
      }
    }
    if (lastAssistantStopReason === undefined) {
      return failed("worker-internal");
    }
    if (lastAssistantStopReason === "stop") {
      if (broker !== undefined && broker.hadInfrastructureFailure()) {
        return failed("worker-internal");
      }
      return terminal(RunOutcome.Completed, null);
    }
    if (lastAssistantStopReason === "length") {
      return failed("model-length");
    }
    if (lastAssistantStopReason === "error") {
      return failed("model-error");
    }
    if (lastAssistantStopReason === "aborted") {
      return cancelled("aborted");
    }
    return failed("worker-internal");
  } catch {
    return failed("worker-internal");
  } finally {
    clearTimeout(watchdog);
    options.cancel.removeEventListener("abort", requestAbort);
    if (broker !== undefined) {
      broker.cancelAll();
    }
    if (session !== undefined) {
      try {
        session.dispose();
      } catch {
        // Disposal failures do not change a decided outcome.
      }
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}

/**
 * The model config the tests use to reach a local scripted provider. Fixture
 * names only; no real provider identity, endpoint or credential.
 */
export function scriptedModelConfig(provider: string, modelId: string, baseUrl: string, key: string): ModelConfig {
  return {
    provider,
    modelsJson: {
      providers: {
        [provider]: {
          name: `${provider} scripted fixture`,
          baseUrl,
          api: "openai-completions",
          models: [
            {
              id: modelId,
              name: `${modelId} scripted fixture`,
              reasoning: false,
              contextWindow: 8192,
              maxTokens: 4096,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    },
    credential: { type: "api_key", key },
  };
}
