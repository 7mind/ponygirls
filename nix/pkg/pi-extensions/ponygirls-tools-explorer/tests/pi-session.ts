/**
 * A real pi session from the pinned SDK, with a scripted model: the place to
 * check what the explorer assumes about pi itself. Nothing leaves the process.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage, type Usage } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type ExtensionAPI, type ExtensionCommandContext, type ExtensionError, type ExtensionFactory, type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

export type NotifyLevel = "info" | "warning" | "error";
export type Notify = (message: string, level: NotifyLevel) => void;

/** How the session is bound: nobody watching (a print run), a client that is notified (RPC), or the terminal UI. */
export type SessionUi =
  | { mode: "print" }
  | { mode: "rpc"; notify: Notify }
  | { mode: "tui"; notify: Notify; custom: ExtensionUIContext["custom"] };

export const SCRIPTED_MODEL = "scripted";
export const SCRIPTED_CONTEXT_WINDOW = 100_000;
const PROVIDER = "tools-explorer-fixture";
const SCRIPTED_API = "openai-completions";
const CONTEXT_COMMAND = "probe-context";
const USAGE: Usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** The names of the tools a request told the provider about. */
export function requestedTools(request: string): string[] {
  const context = JSON.parse(request) as { messages: { role: string }[] };
  return getCurrentTools(context.messages).map((tool) => tool.name).sort();
}

export interface PiSessionOptions {
  /** Registers the tools and commands the test needs. */
  extension: ExtensionFactory;
  /** Extension files loaded the way pi loads them from settings. */
  extensionPaths: readonly string[];
  /** A custom system prompt, as SYSTEM.md or --system-prompt sets one. */
  systemPrompt: string | null;
  /** An allowlist of tools, as `--tools` passes one; `null` for pi's default selection. */
  toolAllowlist: readonly string[] | null;
  ui: SessionUi;
}

export interface PiSession {
  pi: ExtensionAPI;
  /** A command context of the session, as the /tools handler receives one. */
  ctx: ExtensionCommandContext;
  session: AgentSession;
  /** The context of every model request made so far, serialized. */
  requests: string[];
  errors: ExtensionError[];
  /** One model request, answered by the scripted model. */
  request(): Promise<void>;
}

export async function startPiSession(t: TestContext, options: PiSessionOptions): Promise<PiSession> {
  const dir = mkdtempSync(join(tmpdir(), "tools-explorer-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 50 }, retry: { enabled: false } });
  let api: ExtensionAPI | null = null;
  let context: ExtensionCommandContext | null = null;
  const loader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager,
    additionalExtensionPaths: [...options.extensionPaths],
    noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    ...(options.systemPrompt === null ? {} : { systemPrompt: options.systemPrompt }),
    extensionFactories: [async (pi) => {
      api = pi;
      pi.registerCommand(CONTEXT_COMMAND, { description: "Hand a command context to the test", handler: async (_args, ctx) => { context = ctx; } });
      await options.extension(pi);
    }],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);

  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const requests: string[] = [];
  runtime.registerProvider(PROVIDER, {
    baseUrl: "http://fixture.invalid", apiKey: "fixture-only", api: SCRIPTED_API,
    models: [{ id: SCRIPTED_MODEL, name: "Scripted", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: SCRIPTED_CONTEXT_WINDOW, maxTokens: 1000 }],
    streamSimple(model, requestContext) {
      requests.push(JSON.stringify(requestContext));
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant", content: [{ type: "text", text: "ok" }], api: model.api, provider: model.provider, model: model.id,
        usage: { ...USAGE, cost: { ...USAGE.cost } }, stopReason: "stop", timestamp: Date.now(),
      };
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: "stop", message });
        stream.end();
      });
      return stream;
    },
  });
  const model = runtime.getModel(PROVIDER, SCRIPTED_MODEL);
  assert.ok(model, "the scripted model is registered");
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: "off", settingsManager, resourceLoader: loader,
    sessionManager: SessionManager.create(dir, dir),
    ...(options.toolAllowlist === null ? {} : { tools: [...options.toolAllowlist] }),
  });
  const errors: ExtensionError[] = [];
  const ui = options.ui;
  await session.bindExtensions({
    mode: ui.mode,
    onError: (error) => { errors.push(error); },
    ...(ui.mode === "print" ? {} : { uiContext: {
      ...session.extensionRunner.getUIContext(),
      notify: (message: string, level?: NotifyLevel) => ui.notify(message, level ?? "info"),
      ...(ui.mode === "tui" ? { custom: ui.custom } : {}),
    } }),
  });
  t.after(async () => {
    await session.abort();
    session.dispose();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(dir, { recursive: true, force: true });
  });
  await session.prompt(`/${CONTEXT_COMMAND}`);
  assert.equal(requests.length, 0, "a command makes no model request");
  assert.ok(api, "the test extension was loaded");
  assert.ok(context, "the command handed over its context");
  return { pi: api, ctx: context, session, requests, errors, request: () => session.prompt("probe request") };
}
