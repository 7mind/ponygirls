import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const packageRoot = process.env.PI_PACKAGE_ROOT;
assert.ok(packageRoot, "Set PI_PACKAGE_ROOT to the installed Pi package directory");
const { createJiti } = await import(pathToFileURL(join(packageRoot, "node_modules/jiti/lib/jiti.mjs")));
const { SessionManager } = await import(pathToFileURL(join(packageRoot, "dist/index.js")));
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
  write(enabled) { this.cell.enabled = enabled; this.cell.inherit = false; }
  readOverrides() { return this.cell.inherit ? {} : { enabled: this.read() }; }
  writeOverrides(value) { this.cell.inherit = value.enabled === undefined; this.cell.enabled = this.cell.inherit ? true : value.enabled; }
}

class PiHarness {
  constructor(store) {
    this.handlers = new Map();
    this.commands = new Map();
    this.notifications = [];
    this.model = { provider: "openai", id: "gpt-test" };
    this.manager = SessionManager.inMemory();
    this.context = {
      cwd: "/fixture", isProjectTrusted: () => false, sessionManager: this.manager, hasUI: false, mode: "rpc",
      model: this.model,
      ui: { notify: (message, type) => this.notifications.push({ message, type }) },
    };
    registerFastMode({
      on: (name, handler) => this.handlers.set(name, handler),
      appendEntry: (type, data) => this.manager.appendCustomEntry(type, data),
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
    assert.equal(await pi.command("status"), adapter === "memory"
      ? "Fast mode on (global) · next request: priority (openai/gpt-test)\nProvider-reported tier: not observed yet in this session"
      : "Fast mode on (default) · next request: priority (openai/gpt-test)\nProvider-reported tier: not observed yet in this session");
    assert.match(await pi.command("off"), /^Fast mode off \(global\) · next request: standard \(openai\/gpt-test\)\n/);
    const restarted = new PiHarness(reopen());
    assert.match(await restarted.command(""), /^Fast mode off \(global\) · /);
    assert.equal(restarted.request({}).service_tier, "default");
    assert.match(await restarted.command("on"), /^Fast mode on \(global\) · next request: priority /);
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
      const status = await pi.command("status");
      assert.match(status, new RegExp(`^Fast mode on \\(\\w+\\) · next request: not an OpenAI model \\(${provider}/gpt-test\\)\n`));
      assert.match(status, /\nProvider-reported tier: not observed yet in this session$/);
    }
  });

  test(`${adapter}: invalid command does not change preference`, async (t) => {
    const { store } = fixture(t);
    const pi = new PiHarness(store);
    await pi.command("off");
    assert.equal(await pi.command("toggle"), "Usage: /fast [on|off|status|settings] or global|project|session on|off|inherit");
    assert.equal(pi.notifications.at(-1).type, "warning");
    assert.equal(store.read(), false);
    assert.match(await pi.command(" ON "), /^Fast mode on \(global\)/);
  });

  test(`${adapter}: priority request is not proof of priority response`, async (t) => {
    const { store } = fixture(t);
    const pi = new PiHarness(store);
    const reported = async () => (await pi.command("status")).split("\n")[1];
    pi.request({});
    assert.equal(await reported(), "Provider-reported tier: not reported (openai/gpt-test, asked for priority, no HTTP status yet)");
    pi.emit("provider_stream_event", {
      provider: "openai", model: "gpt-test",
      data: { type: "response.created", response: { service_tier: "priority" } },
    });
    assert.match(await reported(), /^Provider-reported tier: not reported \(/);
    pi.response("default");
    assert.equal(await reported(), "Provider-reported tier: standard (openai/gpt-test, asked for priority, HTTP 200)");
    pi.request({});
    assert.match(await reported(), /^Provider-reported tier: not reported \(/);
    pi.response("priority");
    assert.equal(await reported(), "Provider-reported tier: priority (openai/gpt-test, asked for priority, HTTP 200)");
    assert.match(await pi.command("off"), / · next request: standard \(openai\/gpt-test\)\n/);
    assert.equal(await reported(), "Provider-reported tier: priority (openai/gpt-test, asked for priority, HTTP 200)", "the last request, not the new setting");
    pi.request({});
    pi.response("flex");
    assert.equal(await reported(), "Provider-reported tier: flex (openai/gpt-test, asked for standard, HTTP 200)", "an unfamiliar tier is shown as reported");
    assert.match(await new PiHarness(store).command("status"), /\nProvider-reported tier: not observed yet in this session$/);
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
    assert.match(await pi.command("status"), /\nProvider-reported tier: not reported \(openai\/gpt-test, asked for priority, no HTTP status yet\)$/);
    pi.emit("provider_stream_event", {
      provider: "openai", model: "gpt-test",
      data: { object: "chat.completion.chunk", service_tier: "default" },
    });
    assert.match(await pi.command("status"), /\nProvider-reported tier: standard \(/);
    pi.request({});
    pi.response(undefined);
    assert.match(await pi.command("status"), /\nProvider-reported tier: not reported \(openai\/gpt-test, asked for priority, HTTP 200\)$/);
    pi.emit("after_provider_response", { status: 429 });
    assert.match(await pi.command("status"), /\nProvider-reported tier: not reported \(openai\/gpt-test, asked for priority, HTTP 429\)$/);
  });

  test(`${adapter}: invalid payloads and missing model fail explicitly`, async (t) => {
    const { store } = fixture(t);
    const pi = new PiHarness(store);
    for (const payload of [null, [], 1, "request"]) {
      assert.throws(() => pi.request(payload), /requires an object request payload/);
    }
    pi.context.model = undefined;
    assert.throws(() => pi.request({}), /requires a selected model/);
    assert.equal(await pi.command("status"), `Fast mode on (${adapter === "memory" ? "global" : "default"}) · next request: no model selected\nProvider-reported tier: not observed yet in this session`);
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
    cwd: agentDir, isProjectTrusted: () => false, sessionManager: SessionManager.inMemory(), hasUI: false, mode: "rpc",
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
    assert.equal(notifications.at(-1), "Fast mode off (global) · next request: standard (openai-codex/gpt-test)\n" +
      "Provider-reported tier: not observed yet in this session", "two lines, no file paths");
  }
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, PREFERENCE_FILENAME), "utf8")), { enabled: false });
});

test("/fast completes legacy actions and scoped settings controls", () => {
  const harness = new PiHarness(new MemoryPreferenceStore({ enabled: true }));
  const complete = harness.commands.get("fast").getArgumentCompletions;
  assert.deepEqual(complete("").map((item) => item.value), ["on", "off", "status", "settings", "global ", "project ", "session "]);
  assert.deepEqual(complete("o").map((item) => item.value), ["on", "off"]);
  assert.deepEqual(complete("ST").map((item) => item.value), ["status"]);
  assert.equal(complete("on "), null);
  assert.equal(complete("x"), null);
  assert.deepEqual(complete("session ").map(item => item.value), ["session on", "session off", "session inherit"]);
});

test("scoped precedence and reset preserve legacy global /fast on and off", async t => {
  const dir = temporaryDirectory(t), store = new FilePreferenceStore(join(dir, "agent", PREFERENCE_FILENAME));
  const pi = new PiHarness(store); pi.context.cwd = dir; pi.context.isProjectTrusted = () => true;
  const setting = async args => (await pi.command(args)).split(" · ")[0];
  assert.equal(await setting("off"), "Fast mode off (global)"); assert.equal(store.read(), false);
  assert.equal(await setting("project on"), "Fast mode on (project)"); assert.equal(pi.request({}).service_tier, "priority");
  assert.equal(await setting("session off"), "Fast mode off (session)"); assert.equal(pi.request({}).service_tier, "default");
  assert.equal(await setting("on"), "Fast mode off (session)"); assert.equal(store.read(), true); assert.equal(pi.request({}).service_tier, "default");
  assert.equal(await setting("session inherit"), "Fast mode on (project)"); assert.equal(pi.request({}).service_tier, "priority");
  assert.equal(await setting("project off"), "Fast mode off (project)"); assert.equal(pi.request({}).service_tier, "default");
  assert.equal(await setting("project inherit"), "Fast mode on (global)"); assert.equal(pi.request({}).service_tier, "priority");
  assert.equal(await setting("global inherit"), "Fast mode on (default)"); assert.deepEqual(store.readOverrides(), {}); assert.equal(store.read(), true);
  assert.doesNotMatch(await pi.command("status"), /openai-fast\.json/, "status names no file");
});

test("untrusted project state is ignored, and settings in RPC neither write nor send inference", async t => {
  const dir = temporaryDirectory(t); mkdirSync(join(dir, ".pi")); writeFileSync(join(dir, ".pi", PREFERENCE_FILENAME), "malformed");
  const store = new FilePreferenceStore(join(dir, "agent", PREFERENCE_FILENAME)), pi = new PiHarness(store); pi.context.cwd = dir;
  assert.equal(pi.request({}).service_tier, "priority");
  assert.match(await pi.command("status"), /^Fast mode on \(default\) · next request: priority \(openai\/gpt-test\)\n/, "the ignored project file does not become the source");
  await assert.rejects(pi.command("project on"), /trusted project/);
  assert.match(await pi.command("settings"), /requires interactive TUI/);
  assert.deepEqual(store.readOverrides(), {});
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
  assert.match(await pi.command("off"), /^Fast mode off \(global/);
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
