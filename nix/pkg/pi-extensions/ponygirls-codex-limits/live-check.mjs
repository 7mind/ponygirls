import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PI_PACKAGE_ROOT;
assert.ok(root, "Set PI_PACKAGE_ROOT to the installed Pi package directory");
const sdk = await import(pathToFileURL(join(root, "dist/index.js")));
const { createJiti } = await import(pathToFileURL(join(root, "node_modules/jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false, alias: {
  "@earendil-works/pi-ai/providers/all": join(root, "node_modules/@earendil-works/pi-ai/dist/providers/all.js"),
} });
const { default: extension } = await jiti.import(join(import.meta.dirname, "index.ts"));
const runtime = await sdk.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
assert.ok(await runtime.checkAuth("openai-codex"), "Codex OAuth must be configured for live acceptance");
const baseline = new Map(runtime.getModels("openai-codex").map((model) => [model.id, model]));
const events = new Map(), commands = new Map();
extension({ registerProvider: (provider) => runtime.registerNativeProvider(provider),
  on: (event, handler) => events.set(event, handler), registerCommand: (name, command) => commands.set(name, command),
  setModel: async () => true });
const result = await runtime.refresh({ providers: ["openai-codex"], allowNetwork: true });
if (result.errors.size) {
  console.log(JSON.stringify({ discovery: "failed", providers: [...result.errors.keys()], errorTypes: [...result.errors.values()].map((e) => e.name) }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ discovery: "passed", models: runtime.getModels("openai-codex").map((m) => ({
    id: m.id, catalogContext: baseline.get(m.id).contextWindow, effectiveContext: m.contextWindow, output: m.maxTokens,
  })) }, null, 2));
  await commands.get("codex-limits").handler("", { model: undefined, ui: { notify: (message) => {
    console.log(message);
    assert.match(message, /Live context limits applied to [1-9][0-9]* catalog models/);
  } } });
}
