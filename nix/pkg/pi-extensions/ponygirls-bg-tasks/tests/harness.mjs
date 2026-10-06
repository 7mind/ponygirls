// Provider-free Pi SDK harness: a scripted local model stream, no external
// providers, telemetry, ambient extensions, skills, themes, or context files.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.PI_BG_TASKS_SDK_ROOT;
assert.ok(root, "Set PI_BG_TASKS_SDK_ROOT to the pinned pi-monorepo directory; scripted-Pi checks must not silently skip.");
export const sdk = await import(pathToFileURL(join(root, "dist/index.js")));
const { createAssistantMessageEventStream } = await import(
  pathToFileURL(join(root, "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js"))
);

const ZERO_USAGE = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const cleanups = new WeakMap();

/**
 * Cleanup in reverse registration order (runtimes and supervisors before their
 * directories), running every step even if one fails: node:test runs t.after
 * hooks first-in-first-out and stops at a failing hook.
 */
export function defer(t, fn) {
  let stack = cleanups.get(t);
  if (!stack) {
    const steps = [];
    stack = steps;
    cleanups.set(t, steps);
    t.after(async () => {
      const errors = [];
      for (const step of steps.reverse()) {
        try {
          await step();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw errors[0];
    });
  }
  stack.push(fn);
}

export function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  defer(t, () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A deferred promise for test-controlled ordering. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function text(value) {
  return { content: [{ type: "text", text: value }] };
}

export function toolCall(id, name, args) {
  return { content: [{ type: "toolCall", id, name, arguments: args }] };
}

/**
 * Scripted model. `script(request)` returns a reply (or a promise of one):
 * { content, stopReason?, waitForAbort?, errorMessage? }. `request` exposes the
 * provider context, the 1-based call index, and the abort signal.
 */
export function scriptedModel(script) {
  const requests = [];
  return {
    requests,
    register(runtime) {
      runtime.registerProvider("bg-fixture", {
        baseUrl: "http://fixture.invalid",
        apiKey: "fixture-only",
        api: "openai-completions",
        models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }],
        streamSimple(model, context, options) {
          const stream = createAssistantMessageEventStream();
          const request = { index: requests.length + 1, context, signal: options?.signal };
          requests.push(request);
          const emit = (reply) => {
            const content = reply.content ?? [];
            const stopReason = reply.stopReason ?? (content.some((p) => p.type === "toolCall") ? "toolUse" : "stop");
            const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage: { ...ZERO_USAGE }, stopReason, timestamp: Date.now(), ...(reply.errorMessage ? { errorMessage: reply.errorMessage } : {}) };
            stream.push({ type: "start", partial: message });
            if (stopReason === "error" || stopReason === "aborted") stream.push({ type: "error", reason: stopReason, error: message });
            else stream.push({ type: "done", reason: stopReason, message });
            stream.end();
          };
          Promise.resolve()
            .then(() => script(request))
            .then((reply) => {
              assert.ok(reply, `Unexpected model request #${request.index}`);
              if (reply.waitForAbort === true) {
                const onAbort = () => emit({ content: [], stopReason: "aborted", errorMessage: "aborted" });
                if (options.signal.aborted) onAbort();
                else options.signal.addEventListener("abort", onAbort, { once: true });
              } else emit(reply);
            })
            .catch((error) => emit({ content: [], stopReason: "error", errorMessage: String(error) }));
          return stream;
        },
      });
    },
  };
}

/** Context messages seen by the model as compact role/type labels. */
export function contextLabels(request) {
  return request.context.messages.filter((m) => m.role !== "system").map((m) => {
    if (m.role === "user") {
      const t = typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join("");
      return `user:${t}`;
    }
    if (m.role === "assistant") return `assistant:${m.content.map((p) => (p.type === "toolCall" ? `call(${p.id})` : p.type === "text" ? p.text : p.type)).join(",")}`;
    if (m.role === "toolResult") return `result(${m.toolCallId})`;
    return m.role;
  });
}

/**
 * Create a session runtime that can be replaced (new/fork/switch) and reloaded,
 * with only the given extension paths/factories loaded.
 */
/** A UI context that records notifications and treats every other UI call as a no-op. */
export function recordingUi() {
  const notifications = [];
  const ui = new Proxy({ notify: (message, type) => notifications.push({ message, type }) }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "theme") return undefined;
      return () => undefined;
    },
  });
  return { ui, notifications };
}

export async function createRuntime(t, { dir, model, extensionPaths = [], extensionFactories = [], sessionManager, mode = "rpc", tools, settings = {}, uiContext }) {
  const errors = [];
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, ...settings });
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  model.register(modelRuntime);
  const createRuntimeFactory = async ({ cwd, agentDir, sessionManager: manager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir, settingsManager, modelRuntime,
      resourceLoaderOptions: { additionalExtensionPaths: extensionPaths, extensionFactories, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true } });
    assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
    const result = await sdk.createAgentSessionFromServices({ services, sessionManager: manager, sessionStartEvent,
      model: modelRuntime.getModel("bg-fixture", "scripted"), thinkingLevel: "off", ...(tools ? { tools } : {}) });
    return { ...result, services, diagnostics: [] };
  };
  const runtime = await sdk.createAgentSessionRuntime(createRuntimeFactory, { cwd: dir, agentDir: dir, sessionManager: sessionManager ?? sdk.SessionManager.create(dir, join(dir, "sessions")) });
  const bind = async (session) => {
    await session.bindExtensions({ mode, onError: (error) => errors.push(error), shutdownHandler: () => {}, ...(uiContext ? { uiContext } : {}) });
  };
  runtime.setRebindSession(bind);
  await bind(runtime.session);
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await runtime.session.abort();
    await runtime.dispose();
  };
  defer(t, dispose);
  return { runtime, errors, dispose, get session() { return runtime.session; } };
}

export function customEntries(session, customType) {
  return session.sessionManager.getEntries().filter((e) => e.type === "custom_message" && e.customType === customType);
}

export async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 20, message = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
