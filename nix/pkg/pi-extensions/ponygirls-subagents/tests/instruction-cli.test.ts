import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

for (const scenario of ["implicit", "saved", "empty", "tilde"]) test(`Pi CLI AGENTS.md ${scenario}: saved project authority and resolved user directory reach the child provider`, async t => {
  const sdk = process.env.PI_SUBAGENTS_SDK_ROOT;
  if (!sdk) { t.skip("needs packaged Pi"); return; }
  const dir = mkdtempSync(join(tmpdir(), "subagents-cli-"));
  const cwd = join(dir, "project"), home = join(dir, "home"), agent = scenario === "tilde" ? join(home, "custom") : join(home, ".pi", "agent");
  const write = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data));
  const childMessages = Promise.withResolvers<string>();
  let calls = 0;
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = []; for await (const chunk of request) parts.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(parts).toString());
    if (++calls > 12) { childMessages.reject(new Error("unexpected provider loop")); response.writeHead(400); response.end(); return; }
    const parent = body.tools?.some((tool: { function: { name: string } }) => tool.function.name === "manage_gate");
    const spawn = parent && !body.messages.some((message: { role: string }) => message.role === "tool");
    if (!parent) childMessages.resolve(JSON.stringify(body.messages));
    if (parent && !spawn && !JSON.stringify(body.messages.at(-1)).includes("agentId")) childMessages.reject(new Error(`spawn failed: ${JSON.stringify(body.messages.at(-1))}`));
    if (parent && !spawn) await childMessages.promise.catch(() => {});
    const delta = spawn ? { role: "assistant", tool_calls: [{ index: 0, id: "spawn", type: "function", function: { name: "spawn_agent", arguments: JSON.stringify({ task_name: "marker", message: "Report.", profile: "reader", isolation: "none" }) } }] } : { role: "assistant", content: "done" };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: spawn ? "tool_calls" : "stop" }]) response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [choice] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { childMessages.resolve(""); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  mkdirSync(join(cwd, ".pi"), { recursive: true }); mkdirSync(agent, { recursive: true });
  write(join(cwd, ".pi", "archeologist.json"), { version: 1, global: true });
  write(join(agent, "settings.json"), { defaultProjectTrust: "never", retry: { enabled: false }, quietStartup: true });
  if (scenario === "saved") write(join(agent, "trust.json"), { [cwd]: true });
  if (["empty", "tilde"].includes(scenario)) write(join(agent, "archeologist.json"), { version: 1, global: true });
  writeFileSync(join(agent, "AGENTS.md"), "SYNTHETIC_USER_RULE"); writeFileSync(join(cwd, "AGENTS.md"), "SYNTHETIC_CWD_RULE");
  write(join(agent, "models.json"), { providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "local-fixture", api: "openai-completions", models: [{ id: "model", contextWindow: 8192, maxTokens: 128 }] } } });
  const extensions = [new URL("../index.ts", import.meta.url).pathname, new URL("../../ponygirls-archeologist/index.ts", import.meta.url).pathname];
  if (scenario === "saved" || scenario === "tilde") extensions.reverse();
  const cli = promisify(execFile)(process.execPath, [join(sdk, "dist/cli.js"), "--offline", "--no-extensions", "--no-context-files", ...extensions.flatMap(path => ["-e", path]), "--model", "fixture/model", "-p", "Delegate once."], {
    cwd, timeout: 45_000, env: { HOME: home, PATH: process.env.PATH, PI_CODING_AGENT_DIR: scenario === "empty" ? "" : scenario === "tilde" ? "~/custom" : agent, PI_SUBAGENTS_SDK_ROOT: sdk, PI_OFFLINE: "1", PI_TELEMETRY: "0" },
  });
  cli.child.stdin!.end();
  const [seen] = await Promise.all([childMessages.promise, cli]);
  assert.equal(seen.includes("SYNTHETIC_USER_RULE"), scenario !== "implicit");
  assert.ok(!seen.includes("SYNTHETIC_CWD_RULE"));
});
