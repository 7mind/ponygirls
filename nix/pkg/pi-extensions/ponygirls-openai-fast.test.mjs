import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const packageRoot = process.env.PI_PACKAGE_ROOT;
assert.ok(packageRoot, "Set PI_PACKAGE_ROOT to the installed Pi package directory");
const { createJiti } = await import(pathToFileURL(join(packageRoot, "node_modules/jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  fsCache: false,
  alias: { "@earendil-works/pi-coding-agent": join(packageRoot, "dist/bundle/index.js") },
});
const extensionPath = resolve(import.meta.dirname, "ponygirls-openai-fast.ts");
const { FilePreferenceStore, PREFERENCE_FILENAME, registerFastMode } = await jiti.import(extensionPath);

class MemoryPreferenceStore {
  constructor(cell) { this.cell = cell; this.path = "memory:openai-fast"; }
  read() { return this.cell.enabled; }
  write(enabled) { this.cell.enabled = enabled; }
}

class PiHarness {
  constructor(store) {
    this.handlers = new Map();
    this.commands = new Map();
    this.notifications = [];
    this.model = { provider: "openai", id: "gpt-test" };
    this.context = {
      model: this.model,
      ui: { notify: (message, type) => this.notifications.push({ message, type }) },
    };
    registerFastMode({
      on: (name, handler) => this.handlers.set(name, handler),
      registerCommand: (name, command) => this.commands.set(name, command),
    }, store);
  }
  async command(args) {
    await this.commands.get("fast").handler(args, this.context);
    return this.notifications.at(-1).message;
  }
  emit(name, data) { return this.handlers.get(name)({ type: name, ...data }, this.context); }
  request(payload) { return this.emit("before_provider_request", { payload }); }
  response(tier) {
    this.emit("after_provider_response", { status: 200 });
    this.emit("provider_stream_event", {
      provider: this.model.provider, model: this.model.id, api: "openai-responses",
      data: { type: "response.completed", response: { service_tier: tier } },
    });
  }
}

function temporaryDirectory(t) {
  const parent = resolve(import.meta.dirname, "debug");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "fast-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Specified-origin Behavioral-Active Blackbox tests, run with both adapters.
for (const adapter of ["memory", "filesystem"]) {
  function fixture(t) {
    if (adapter === "memory") {
      const cell = { enabled: true };
      return { store: new MemoryPreferenceStore(cell), reopen: () => new MemoryPreferenceStore(cell) };
    }
    const directory = temporaryDirectory(t);
    const path = join(directory, "agent", PREFERENCE_FILENAME);
    return { store: new FilePreferenceStore(path), reopen: () => new FilePreferenceStore(path) };
  }

  test(`${adapter}: default on; off and on survive new stores and Pi runtimes`, async (t) => {
    const { store, reopen } = fixture(t);
    assert.equal(store.read(), true);
    const pi = new PiHarness(store);
    assert.match(await pi.command("status"), /Fast mode: ON \(persistent\)/);
    assert.match(await pi.command("off"), /Fast mode: OFF \(persistent\)/);
    const restarted = new PiHarness(reopen());
    assert.match(await restarted.command(""), /Fast mode: OFF/);
    assert.equal(restarted.request({}).service_tier, "default");
    assert.match(await restarted.command("on"), /Fast mode: ON/);
    assert.equal(new PiHarness(reopen()).request({}).service_tier, "priority");
    assert.equal(pi.request({}).service_tier, "priority");
  });

  test(`${adapter}: requests preserve model, reasoning, and original payload`, async (t) => {
    const { store } = fixture(t);
    const pi = new PiHarness(store);
    for (const provider of ["openai", "openai-codex"]) {
      pi.model.provider = provider;
      const payload = { model: "gpt-test", reasoning: { effort: "xhigh" }, service_tier: "auto" };
      const priority = pi.request(payload);
      assert.deepEqual(priority, { ...payload, service_tier: "priority" });
      assert.equal(payload.service_tier, "auto");
      assert.deepEqual(pi.request(priority), priority);
      await pi.command("off");
      assert.deepEqual(pi.request(priority), { ...payload, service_tier: "default" });
      await pi.command("on");
    }
  });

  test(`${adapter}: other providers are untouched and status says not applicable`, async (t) => {
    const { store } = fixture(t);
    const pi = new PiHarness(store);
    for (const provider of ["anthropic", "xiaomi-token-plan-ams", "openrouter"]) {
      pi.model.provider = provider;
      assert.equal(pi.request({ service_tier: "auto" }), undefined);
      assert.match(await pi.command("status"), /Next request: unchanged .*not an OpenAI provider/);
      assert.match(await pi.command("status"), /no OpenAI request observed/);
    }
  });

  test(`${adapter}: invalid command does not change preference`, async (t) => {
    const { store } = fixture(t);
    const pi = new PiHarness(store);
    await pi.command("off");
    assert.equal(await pi.command("toggle"), "Usage: /fast [on|off|status]");
    assert.equal(pi.notifications.at(-1).type, "warning");
    assert.equal(store.read(), false);
    assert.match(await pi.command(" ON "), /Fast mode: ON/);
  });

  test(`${adapter}: priority request is not proof of priority response`, async (t) => {
    const { store } = fixture(t);
    const pi = new PiHarness(store);
    pi.request({});
    assert.match(await pi.command("status"), /Requested tier: priority\nOpenAI-reported tier: not reported; unverified/);
    pi.emit("provider_stream_event", {
      provider: "openai", model: "gpt-test",
      data: { type: "response.created", response: { service_tier: "priority" } },
    });
    assert.match(await pi.command("status"), /not reported; unverified/);
    pi.response("default");
    assert.match(await pi.command("status"), /Requested tier: priority\nOpenAI-reported tier: default\nHTTP status: 200/);
    pi.request({});
    assert.match(await pi.command("status"), /not reported; unverified/);
    pi.response("priority");
    assert.match(await pi.command("status"), /OpenAI-reported tier: priority/);
    assert.match(await pi.command("off"), /Next request: default/);
    assert.match(await pi.command("status"), /Requested tier: priority\nOpenAI-reported tier: priority/);
    assert.match(await new PiHarness(store).command("status"), /unverified; no OpenAI request observed/);
  });

  test(`${adapter}: chat stream tiers, missing tiers, and mismatched models`, async (t) => {
    const { store } = fixture(t);
    const pi = new PiHarness(store);
    pi.request({});
    for (const [provider, model] of [["anthropic", "gpt-test"], ["openai", "other-model"]]) {
      pi.emit("provider_stream_event", {
        provider, model, data: { type: "response.completed", response: { service_tier: "priority" } },
      });
    }
    assert.match(await pi.command("status"), /not reported; unverified/);
    pi.emit("provider_stream_event", {
      provider: "openai", model: "gpt-test",
      data: { object: "chat.completion.chunk", service_tier: "default" },
    });
    assert.match(await pi.command("status"), /OpenAI-reported tier: default/);
    pi.request({});
    pi.response(undefined);
    assert.match(await pi.command("status"), /not reported; unverified/);
    pi.emit("after_provider_response", { status: 429 });
    assert.match(await pi.command("status"), /HTTP status: 429/);
  });

  test(`${adapter}: invalid payloads and missing model fail explicitly`, async (t) => {
    const { store } = fixture(t);
    const pi = new PiHarness(store);
    for (const payload of [null, [], 1, "request"]) {
      assert.throws(() => pi.request(payload), /requires an object request payload/);
    }
    pi.context.model = undefined;
    assert.throws(() => pi.request({}), /requires a selected model/);
    assert.match(await pi.command("status"), /no model selected/);
  });
}

test("host: Pi loads the factory and persists /fast in the configured agent directory", async (t) => {
  const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")));
  const agentDir = temporaryDirectory(t);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  const loader = new sdk.DefaultResourceLoader({
    cwd: agentDir, agentDir, settingsManager: sdk.SettingsManager.inMemory(),
    additionalExtensionPaths: [extensionPath], noExtensions: true,
    noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
  });
  const notifications = [];
  const context = {
    model: { provider: "openai-codex", id: "gpt-test" },
    ui: { notify: (message) => notifications.push(message) },
  };
  for (const action of ["off", "status"]) {
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    const extension = loaded.extensions.find((item) => item.path === extensionPath);
    assert.ok(extension, "Pi must load the ported extension");
    const command = extension.commands.get("fast");
    assert.ok(command, "The factory must register /fast");
    await command.handler(action, context);
    assert.match(notifications.at(-1), /Fast mode: OFF \(persistent\)/);
    assert.ok(notifications.at(-1).includes(join(agentDir, PREFERENCE_FILENAME)));
  }
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, PREFERENCE_FILENAME), "utf8")), { enabled: false });
});

test("/fast completes its three actions", () => {
  const harness = new PiHarness(new MemoryPreferenceStore({ enabled: true }));
  const complete = harness.commands.get("fast").getArgumentCompletions;
  assert.deepEqual(complete("").map((item) => item.value), ["on", "off", "status"]);
  assert.deepEqual(complete("o").map((item) => item.value), ["on", "off"]);
  assert.deepEqual(complete("ST").map((item) => item.value), ["status"]);
  assert.equal(complete("on "), null);
  assert.equal(complete("x"), null);
});

// Filesystem-specific Effectual-GoodCommunication boundary checks.
test("filesystem: invalid state fails instead of silently enabling priority; commands can repair it", async (t) => {
  const directory = temporaryDirectory(t);
  const path = join(directory, PREFERENCE_FILENAME);
  const store = new FilePreferenceStore(path);
  const pi = new PiHarness(store);
  for (const text of ["{", "null", "[]", "{}", '{"enabled":"false"}']) {
    writeFileSync(path, text);
    assert.throws(() => store.read());
    await assert.rejects(pi.command("status"));
    assert.throws(() => pi.request({}));
  }
  assert.match(await pi.command("off"), /Fast mode: OFF/);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), [PREFERENCE_FILENAME]);
});

test("filesystem: failed writes do not claim success", async (t) => {
  const directory = temporaryDirectory(t);
  const parent = join(directory, "not-a-directory");
  writeFileSync(parent, "occupied");
  const pi = new PiHarness(new FilePreferenceStore(join(parent, PREFERENCE_FILENAME)));
  await assert.rejects(pi.command("on"));
  assert.deepEqual(pi.notifications, []);
});
