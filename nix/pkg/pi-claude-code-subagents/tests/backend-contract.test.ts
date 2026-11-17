import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DefaultResourceLoader, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { backendRegistryContract } from "ponygirls-subagents/tests/backend-contract-fixture.ts";
import { ClaudeExecutor } from "../executor/claude-cli.ts";
import { createClaudeBackend } from "../src/backend.ts";
import type { NativeInferenceService } from "../src/native-service.ts";

backendRegistryContract("production Claude Code backend", async () => {
  const packagePath = process.env["PI_SUBAGENTS_CLAUDE_PACKAGE"];
  assert.ok(packagePath, "production provider package is required");
  const root = await mkdtemp(join(tmpdir(), "claude-backend-contract-"));
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: SettingsManager.inMemory({ packages: [packagePath] }), noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const registry = new ModelRegistry(runtime);
  const provider = loader.getExtensions().runtime.pendingNativeProviderRegistrations[0]!.provider;
  registry.registerProvider(provider);
  const executor = new ClaudeExecutor();
  const sessions = new Set<NativeInferenceService>();
  return {
    registration: createClaudeBackend(() => registry, executor, sessions, () => {}),
    selected: { provider: "claude-code", id: "claude-opus-5-5", thinkingLevel: "off" },
    unselected: { provider: "stock-control", id: "model", thinkingLevel: "off" },
    dispose: async () => { await Promise.all([...sessions].map((session) => session.dispose())); await executor.closeClaudeProcesses(); await rm(root, { recursive: true, force: true }); },
  };
});
