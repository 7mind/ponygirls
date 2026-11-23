import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentSession, createEventBus, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { requestAdmission, requestInventory } from "../../context-rules/bridge.ts";
import { DISCOVERY_OFF } from "../../context-rules/rules.ts";

const main = fileURLToPath(new URL("..", import.meta.url));
const sub = fileURLToPath(new URL("../../ponygirls-subagents", import.meta.url));

test("reloading either optional extension revokes the previous session's command and bridge bindings", async t => {
  const root = mkdtempSync(join(tmpdir(), "archeologist-reload-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "cwd"), agentDir = join(root, "agent"); mkdirSync(cwd); mkdirSync(agentDir);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const eventBus = createEventBus();
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, eventBus });
  await resourceLoader.reload();
  const sessionManager = SessionManager.inMemory(cwd);
  const binding = { rootSessionId: sessionManager.getSessionId(), cwd };
  const { session } = await createAgentSession({ cwd, agentDir, resourceLoader, sessionManager });
  t.after(() => session.dispose()); await session.bindExtensions({});
  for (const extensions of [[main], [sub], [main, sub], [sub, main], [sub], [main], []]) {
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ extensions }));
    await session.reload();
    const commands = session.extensionRunner.getRegisteredCommands().map(c => c.name);
    assert.deepEqual(commands.filter(name => name === "agents" || name === "archeologist").sort(), extensions.map(p => p === main ? "archeologist" : "agents").sort());
    assert.deepEqual(requestAdmission(eventBus, binding), extensions.includes(main) ? { mainFiles: [], grants: DISCOVERY_OFF } : undefined);
    assert.deepEqual(requestInventory(eventBus, binding), extensions.includes(sub) ? [] : undefined);
    assert.equal(requestAdmission(eventBus, { ...binding, rootSessionId: "another-session" }), undefined);
    assert.equal(requestInventory(eventBus, { ...binding, cwd: root }), undefined);
  }
});
