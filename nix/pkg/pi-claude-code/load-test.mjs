import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [sdk, packagePath, fakeCli] = process.argv.slice(2);
assert.ok(sdk);
assert.ok(packagePath);
assert.ok(fakeCli);
const config = resolve("controlled-config");
await mkdir(config);
await writeFile(join(config, "fixture.json"), JSON.stringify({ answer: "Opus controlled response" }));
const executable = resolve("controlled-claude");
await writeFile(executable, `#!${process.execPath}\n${await readFile(fakeCli, "utf8")}`);
await chmod(executable, 0o755);
process.env.PI_CLAUDE_CODE_COMMAND = executable;
process.env.PI_CLAUDE_CODE_CONFIG_DIR = config;
const { DefaultResourceLoader, SettingsManager } = await import(pathToFileURL(join(sdk, "dist/index.js")).href);
const cwd = resolve("workspace");
const agentDir = resolve("agent");
await mkdir(cwd, { recursive: true });
await mkdir(agentDir, { recursive: true });
assert.equal((await stat(packagePath)).mode & 0o222, 0, "package must be read-only");
await assert.rejects(access(join(packagePath, "node_modules")), { code: "ENOENT" });
await access(join(packagePath, "src/inert-mcp.mjs"));
const manifest = JSON.parse(await readFile(join(packagePath, "package.json"), "utf8"));
assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
const settingsManager = SettingsManager.inMemory({ packages: [packagePath] });
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await loader.reload();
const result = loader.getExtensions();
assert.deepEqual(result.errors, []);
assert.deepEqual(result.warnings, []);
assert.equal(result.extensions.length, 1);
assert.equal(result.extensions[0].path, join(packagePath, "src/index.ts"));
assert.equal(result.extensions[0].commands.has("claude-code-status"), true);
const registrations = result.runtime.pendingNativeProviderRegistrations;
assert.equal(registrations.length, 1);
assert.equal(registrations[0].provider.id, "claude-code");
assert.ok(registrations[0].provider.getModels().length > 0);
const { ModelRuntime, ModelRegistry } = await import(pathToFileURL(join(sdk, "dist/index.js")).href);
const { InMemoryCredentialStore } = await import(pathToFileURL(join(sdk, "node_modules/@earendil-works/pi-ai/dist/index.js")).href);
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
const registry = new ModelRegistry(runtime);
const provider = registrations[0].provider;
registry.registerProvider(provider);
assert.equal(registry.getRegisteredNativeProvider("claude-code"), provider);
const refreshed = await registry.refresh({ providers: ["claude-code"], allowNetwork: true, force: true });
assert.deepEqual([...refreshed.errors], []);
const opus = registry.find("claude-code", "claude-opus-5-5");
const sonnet = registry.find("claude-code", "claude-sonnet-5-5");
assert.ok(opus);
assert.ok(sonnet);
assert.equal(opus.api, "claude-code-stream-json");

const capability = provider[Symbol.for("pi-claude-code.execution.v1")];
assert.equal(capability.version, 1);
const stream = registry.streamSimple(sonnet, { messages: [{ role: "user", content: "governor", timestamp: 0 }] }, { cacheRetention: "none" });
const normal = await stream.result();
assert.equal(normal.stopReason, "stop", normal.errorMessage);
assert.equal(normal.usage.input, 7);
assert.equal(normal.usage.output, 3);
const launches = (await readFile(join(config, "launch.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
assert.equal(launches.length, 1);
assert.equal(launches[0].model, "fixture-sonnet-route");
assert.equal(launches[0].cwd, process.cwd());
console.log("Immutable original provider entrypoint and ordinary request verified without addon context");
