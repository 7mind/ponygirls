import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [sdk, packagePath, fakeCli, addonPath] = process.argv.slice(2);
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
const namespace = "pi-claude-code.execution.v1";
const { NativeSessions } = await import(pathToFileURL(join(addonPath, "src/execution-lifecycle.ts")).href);
const { ClaudeExecutor } = await import(pathToFileURL(join(addonPath, "executor/claude-cli.ts")).href);
const sessions = new NativeSessions();
const executor = new ClaudeExecutor();
const capability = provider[Symbol.for(namespace)];
assert.equal(capability.version, 1);
const receipts = [];
const lifecycleIds = [];
const faultedLifecycleIds = new Set();
const withinObservation = async (pending) => {
  let timer;
  try { return await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("logical cleanup exceeded 3000ms")), 3000); })]); }
  finally { clearTimeout(timer); }
};
const stopped = async (pid) => {
  try { const state = (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ").pop().split(" ")[0]; return state === "Z" || state === "X"; }
  catch (error) { if (error.code === "ENOENT") return true; throw error; }
};
const waitFor = async (predicate) => {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, "controlled CLI observation deadline exceeded");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const launchesAt = async (directory) => {
  try { return (await readFile(join(directory, "launch.jsonl"), "utf8")).trim().split("\n").map(JSON.parse); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
};
const request = async (model, cwd, sessionId, retention, text) => {
  const delegation = {
    capability, cwd, lifecycleSessionId: sessionId,
    beforeEntry: (actual) => { assert.equal(actual, capability); },
    captureOriginal: (raw) => { receipts.push(raw.result()); return raw; },
  };
  const execution = sessions.enter(delegation, {});
  const metadata = { capability, execution: { ...execution, run: (input) => executor.runClaudeRequest({ ...input, delegation: execution }) } };
  lifecycleIds.push(sessionId);
  const messages = typeof text === "string" ? [{ role: "user", content: text, timestamp: 0 }] : text;
  const stream = registry.streamSimple(model, { messages }, { sessionId: `${sessionId}:cache`, cacheRetention: retention, metadata: { [namespace]: metadata } });
  for await (const _event of stream) {}
  return stream.result();
};
const workerCwd = resolve("worker-cwd");
const reviewerCwd = resolve("reviewer-cwd");
await mkdir(workerCwd);
await mkdir(reviewerCwd);
try {
  const normal = registry.streamSimple(sonnet, { messages: [{ role: "user", content: "governor", timestamp: 0 }] }, { cacheRetention: "none" });
  const normalResult = await normal.result();
  assert.equal(normalResult.stopReason, "stop", normalResult.errorMessage);
  const answers = await Promise.all([
    request(opus, workerCwd, "worker", "short", "worker"),
    request(sonnet, reviewerCwd, "reviewer", "none", "reviewer"),
    request(opus, workerCwd, "worker", "none", "concurrent one-shot"),
  ]);
  for (const answer of answers) { assert.equal(answer.stopReason, "stop", answer.errorMessage); assert.equal(answer.usage.input, 7); assert.equal(answer.usage.output, 3); }
  assert.equal((await Promise.all(receipts)).length, 3);
  const launches = (await readFile(join(config, "launch.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(launches.length, 4);
  assert.ok(launches.some((launch) => launch.cwd === process.cwd() && launch.model === "fixture-sonnet-route"));
  assert.equal(launches.filter((launch) => launch.cwd === workerCwd && launch.model === "fixture-opus-route").length, 2);
  assert.ok(launches.some((launch) => launch.cwd === reviewerCwd && launch.model === "fixture-sonnet-route"));
  for (const launch of launches) { assert.equal(launch.config, config); assert.equal(launch.emptyTools, true); assert.equal(launch.settingSources, ""); assert.equal(launch.strictMcp, true); }
  const activeNone = request(opus, workerCwd, "active", "none", "WAIT_FIXTURE");
  const activeCached = request(opus, workerCwd, "active", "short", "WAIT_FIXTURE");
  await waitFor(async () => (await launchesAt(config)).length === 6);
  await sessions.dispose("active");
  for (const answer of await Promise.all([activeNone, activeCached])) assert.equal(answer.stopReason, "aborted", answer.errorMessage);
  const faultOwner = "active-close-failure";
  faultedLifecycleIds.add(faultOwner);
  const beforeFault = (await launchesAt(config)).length;
  const faultPending = [request(opus, workerCwd, faultOwner, "none", "WAIT_FIXTURE"), request(opus, workerCwd, faultOwner, "short", "WAIT_FIXTURE")];
  await waitFor(async () => (await launchesAt(config)).length === beforeFault + 2);
  const faultOwned = (await launchesAt(config)).slice(beforeFault);
  const faultOriginalKill = process.kill;
  const faultAttempts = [];
  process.kill = (pid, signal) => {
    if (signal === "SIGKILL" && pid < 0) {
      faultAttempts.push(pid);
      if (pid === -faultOwned[0].pid) throw Object.assign(new Error("controlled active EPERM"), { code: "EPERM" });
    }
    return Reflect.apply(faultOriginalKill, process, [pid, signal]);
  };
  try {
    await assert.rejects(withinObservation(sessions.dispose(faultOwner)), (error) => error instanceof AggregateError);
    for (const launch of faultOwned) assert.ok(faultAttempts.includes(-launch.pid));
    assert.equal(await stopped(faultOwned[0].pid), false);
    assert.equal(await stopped(faultOwned[1].pid), true);
    for (const answer of await withinObservation(Promise.all(faultPending))) assert.equal(answer.stopReason, "aborted", answer.errorMessage);
  } finally {
    process.kill = faultOriginalKill;
    for (const launch of faultOwned) {
      try { process.kill(-launch.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await assert.rejects(withinObservation(sessions.dispose(faultOwner)), /cleanup failed/);
    await Promise.all(faultPending);
    for (const launch of faultOwned) assert.equal(await stopped(launch.pid), true);
  }
  assert.throws(() => sessions.enter({ capability, cwd: workerCwd, lifecycleSessionId: faultOwner, beforeEntry: () => {}, captureOriginal: (raw) => raw }, {}), /retired/);
  console.log("Controlled active EPERM: bounded aggregated fault, every owned close attempted, producers settled, explicit physical recovery verified, failure/re-entry barrier retained");
  await writeFile(join(config, "hold-replay"), "");
  const replaying = request(opus, workerCwd, "replaying", "none", [
    { role: "user", content: "prior question", timestamp: 0 },
    { role: "assistant", api: opus.api, provider: opus.provider, model: opus.id, content: [{ type: "text", text: "prior answer" }], stopReason: "stop", timestamp: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
    { role: "user", content: "not issued", timestamp: 2 },
  ]);
  await waitFor(async () => { try { return (await readFile(join(config, "replay.jsonl"), "utf8")).length > 0; } catch (error) { if (error.code === "ENOENT") return false; throw error; } });
  const replayPid = JSON.parse((await readFile(join(config, "replay.jsonl"), "utf8")).trim()).pid;
  await sessions.dispose("replaying");
  assert.equal((await replaying).stopReason, "aborted");
  const replayFrames = (await readFile(join(config, "frames.jsonl"), "utf8")).trim().split("\n").map(JSON.parse).filter((frame) => frame.pid === replayPid);
  assert.equal(replayFrames.length, 1);
  assert.equal(replayFrames[0].querying, false);
  const pendingConfig = resolve("pending-config");
  await mkdir(pendingConfig);
  await writeFile(join(pendingConfig, "fixture.json"), JSON.stringify({ answer: "unused" }));
  await writeFile(join(pendingConfig, "hold-auth"), "");
  process.env.PI_CLAUDE_CODE_CONFIG_DIR = pendingConfig;
  const acquiring = request(opus, workerCwd, "acquiring", "none", "not issued");
  await waitFor(async () => { try { return (await readFile(join(pendingConfig, "auth.jsonl"), "utf8")).length > 0; } catch (error) { if (error.code === "ENOENT") return false; throw error; } });
  await sessions.dispose("acquiring");
  assert.equal((await acquiring).stopReason, "aborted");
  assert.equal((await launchesAt(pendingConfig)).length, 0);
  process.env.PI_CLAUDE_CODE_CONFIG_DIR = config;
  const cleanupOwner = "synchronous-close-failure";
  const beforeCleanup = (await launchesAt(config)).length;
  for (const cache of ["first", "second"]) {
    const execution = sessions.enter({ capability, cwd: workerCwd, lifecycleSessionId: cleanupOwner, beforeEntry: (actual) => assert.equal(actual, capability), captureOriginal: (raw) => raw }, {});
    const stream = registry.streamSimple(opus, { messages: [{ role: "user", content: "owned warm process", timestamp: 0 }] }, {
      sessionId: `${cleanupOwner}:${cache}`, cacheRetention: "short",
      metadata: { [namespace]: { capability, execution: { ...execution, run: (input) => executor.runClaudeRequest({ ...input, delegation: execution }) } } },
    });
    const answer = await stream.result();
    assert.equal(answer.stopReason, "stop", answer.errorMessage);
  }
  const owned = (await launchesAt(config)).slice(beforeCleanup);
  assert.equal(owned.length, 2);
  const originalKill = process.kill;
  const attempted = [];
  process.kill = (pid, signal) => {
    if (signal === "SIGKILL" && pid < 0) {
      attempted.push(pid);
      if (pid === -owned[0].pid) throw Object.assign(new Error("controlled close EPERM"), { code: "EPERM" });
    }
    return Reflect.apply(originalKill, process, [pid, signal]);
  };
  try {
    await assert.rejects(sessions.dispose(cleanupOwner), /EPERM|cleanup failed/);
    assert.ok(attempted.includes(-owned[0].pid));
    assert.ok(attempted.includes(-owned[1].pid), "second owned process close must be attempted after synchronous EPERM");
    assert.equal(await stopped(owned[0].pid), false, "the injected failure must leave the first process running until explicit cleanup");
    assert.equal(await stopped(owned[1].pid), true);
  } finally {
    process.kill = originalKill;
    for (const launch of owned) {
      try { process.kill(-launch.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await assert.rejects(sessions.dispose(cleanupOwner), /cleanup failed/);
    for (const launch of owned) assert.equal(await stopped(launch.pid), true);
  }
  console.log("Controlled synchronous EPERM: every owned close attempted, second process observed stopped, failed first process explicitly recovered, all owned processes observed stopped, cleanup fault retained");
  const { NativeModels } = await import(pathToFileURL(join(addonPath, "src/models.ts")).href);
  const { readFileSync } = await import("node:fs");
  const models = new NativeModels(() => registry);
  const binding = models.nativeBinding(models.describe(opus));
  const revokedConfig = resolve("revoked-config");
  await mkdir(revokedConfig);
  process.env.PI_CLAUDE_CODE_CONFIG_DIR = revokedConfig;
  const countAuth = () => {
    try { return readFileSync(join(revokedConfig, "auth.jsonl"), "utf8").trim().split("\n").filter(Boolean).length; }
    catch (error) { if (error.code === "ENOENT") return 0; throw error; }
  };
  let checks = 0;
  let authAtRevoke = null;
  const revokedExecution = sessions.enter({ capability, cwd: workerCwd, lifecycleSessionId: "revoked-acquisition", beforeEntry: (actual) => {
    assert.equal(actual, capability);
    binding.assertCurrent();
    checks++;
    if (checks === 5) queueMicrotask(() => { authAtRevoke = countAuth(); registry.unregisterProvider("claude-code"); });
  }, captureOriginal: (raw) => raw }, {});
  lifecycleIds.push("revoked-acquisition");
  const revokedAnswer = await registry.streamSimple(opus, { messages: [{ role: "user", content: "must not issue", timestamp: 0 }] }, { cacheRetention: "none", metadata: { [namespace]: { capability, execution: { ...revokedExecution, run: (input) => executor.runClaudeRequest({ ...input, delegation: revokedExecution }) } } } }).result();
  assert.notEqual(authAtRevoke, null);
  assert.equal(countAuth(), authAtRevoke);
  assert.equal((await launchesAt(revokedConfig)).length, 0);
  assert.equal(revokedAnswer.stopReason, "error");
  assert.match(revokedAnswer.errorMessage, /MODEL_UNAVAILABLE/);
  console.log("Controlled acquisition revocation: actual provider unregistered during executable resolution; no later status or inference subprocess; visible MODEL_UNAVAILABLE");
} finally {
  const ids = [...new Set(lifecycleIds)];
  const outcomes = await Promise.allSettled(ids.map((id) => sessions.dispose(id)));
  for (let index = 0; index < ids.length; index++) {
    const outcome = outcomes[index];
    assert.equal(outcome.status, faultedLifecycleIds.has(ids[index]) ? "rejected" : "fulfilled");
    if (outcome.status === "rejected") assert.ok(outcome.reason instanceof AggregateError);
  }
  await executor.closeClaudeProcesses();
}
const launchEvidence = (await readFile(join(config, "launch.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
const authEvidence = (await readFile(join(resolve("pending-config"), "auth.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
for (const launch of [...launchEvidence, ...authEvidence]) {
  try { const fields = (await readFile(`/proc/${launch.pid}/stat`, "utf8")).split(") ").pop().split(" "); assert.ok(fields[0] === "Z" || fields[0] === "X", `owned CLI ${launch.pid} remains live`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
console.log("Read-only pinned Claude package: SDK loader, published 5.5 catalog, native CLI routes/cwd/config, raw usage, pending acquisition/history replay/active concurrent/none-retention/warm disposal verified (controlled CLI, not Anthropic acceptance)");
