import assert from "node:assert/strict";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [sdk, packagePath] = process.argv.slice(2);
assert.ok(sdk);
assert.ok(packagePath);
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
console.log("Read-only Claude Code package discovered and loaded from settings.packages");
