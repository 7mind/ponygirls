import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const extension = fileURLToPath(new URL("../index.ts", import.meta.url));
const cases = ["direct", "codemode", "codemode-replaced", "direct-replaced", "direct-final-error", "codemode-final-error", "codemode-caught-error", "disabled", "blocked", "abort", "override"] as const;
for (const mode of cases) test(`standalone model requests: ${mode}`, async t => {
  const root = mkdtempSync(join(tmpdir(), "archeologist-")), cwd = join(root, "project"), agent = join(root, "agent");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of [agent, join(cwd, "section"), join(cwd, "other"), join(cwd, "unused"), join(root, "outside")]) mkdirSync(dir, { recursive: true });
  const write = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data));
  writeFileSync(join(cwd, "AGENTS.md"), "NATIVE_STARTUP");
  for (const [dir, text] of [["section", "SECTION_RULE"], ["other", "OTHER_RULE"], ["unused", "UNVISITED_RULE"], ["../outside", "OUTSIDE_RULE"]]) {
    writeFileSync(join(cwd, dir, "AGENTS.md"), text); write(join(cwd, dir, "probe"), { number: 42 });
  }
  symlinkSync(join(cwd, "section"), join(cwd, "alias"));
  const code = mode.startsWith("codemode");
  write(join(agent, "settings.json"), { codemode: { mode: mode.endsWith("error") ? "on" : "only" }, retry: { enabled: false } });
  if (mode !== "disabled") write(join(agent, "archeologist.json"), { version: 1, mainNested: true });
  if (mode.endsWith("-replaced")) write(join(cwd, "other/probe"), { number: 73 });
  const hook = join(root, "late.ts");
  const hooks: Record<string, string> = {
    blocked: 'pi.on("tool_call", () => ({ block:true, reason:"fixture" }));',
    abort: 'pi.on("tool_execution_end", (_e,ctx) => ctx.abort());',
    override: 'pi.registerTool({name:"read",description:"replacement",label:"Replacement",parameters:Type.Object({path:Type.String()}), execute:async()=>({content:[{type:"text",text:"override success"}],details:{}})});',
  };
  if (mode.endsWith("-replaced")) hooks[mode] = `pi.on("${code ? "tool_result" : "tool_execution_end"}", e => {
    if (e.toolName === "read" && !e.isError) { renameSync("section", "previous"); renameSync("other", "section"); }
  });`;
  const patch = mode === "codemode-caught-error" ? { isError: true, content: [{ type: "text", text: "fixture rejection" }] } : { isError: true };
  const late = mode.endsWith("error") ? `pi.on("tool_result", e => e.toolName === "read" ? ${JSON.stringify(patch)} : undefined);` : hooks[mode];
  writeFileSync(hook, `import { Type } from 'typebox'; import { renameSync } from 'node:fs'; export default pi => { ${late ?? ""} }`);
  const requests: string[] = [];
  const toolResults: string[] = [];
  const call = (name: string, args: unknown) => ({ name, arguments: JSON.stringify(args) });
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = []; for await (const part of req) parts.push(part);
    const { messages } = JSON.parse(Buffer.concat(parts).toString());
    requests.push(JSON.stringify(messages));
    toolResults.push(...messages.filter((m: { role: string }) => m.role === "tool").map((m: { content: string }) => m.content));
    const calls = code ? [call("codemode", { code: `try { return JSON.parse(await tools.read({path:"@alias/probe"})).number; } catch { return "caught inner error"; }` })]
      : mode === "direct" ? [call("read", { path: "@alias/probe" }), call("write", { path: "other/created", content: "already written" }), call("read", { path: "section/probe" }), call("read", { path: "unused/missing" }), call("read", { path: "../outside/probe" }), call("bash", {command: "printf unused/probe"})]
      : [call("read", { path: "section/probe" })];
    const first = requests.length === 1;
    const delta = first ? { role: "assistant", tool_calls: calls.map((fn, index) => ({ index, id: `call_${index}`, type: "function", function: fn })) } : { role: "assistant", content: "complete" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }]) res.write(`data: ${JSON.stringify({ id: "fixture", choices: [choice] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const addr = server.address(); assert.ok(addr && typeof addr !== "string");
  write(join(agent, "models.json"), { providers: { fixture: { baseUrl: `http://127.0.0.1:${addr.port}/v1`, apiKey: "fixture", api: "openai-completions", models: [{ id: "model", contextWindow: 16384, maxTokens: 512 }] } } });
  const bin = process.env.PI_BIN; assert.ok(bin);
  const session = join(root, "session.jsonl");
  async function run(args: string[]) {
    const cli = promisify(execFile)(bin!, ["--offline", "--model", "fixture/model", "-ne", "-e", extension, "-e", hook, ...(code ? ["-e", "builtin:codemode", "--tools", "+codemode"] : []), ...args, "-p", "Inspect."], { cwd, timeout: 45000, env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: agent, PI_TELEMETRY: "0" } });
    cli.child.stdin!.end();
    const { stderr } = await cli;
    assert.doesNotMatch(stderr, /failed to load|extension.*error/i);
  }
  if (mode === "abort") await assert.rejects(run(["--session", session]), { code: 1, stderr: "This operation was aborted\n" });
  else await run(["--session", session]);
  assert.match(requests[0], /NATIVE_STARTUP/);
  assert.doesNotMatch(requests[0], /SECTION_RULE|OTHER_RULE|UNVISITED_RULE|OUTSIDE_RULE/);
  const accepted = mode === "direct" || mode === "codemode";
  if (mode !== "abort") assert.equal(requests.length, 2);
  assert.equal((requests[1]?.match(/SECTION_RULE/g) ?? []).length, Number(accepted), requests[1]);
  assert.equal((requests[1]?.match(/OTHER_RULE/g) ?? []).length, Number(mode === "direct"));
  assert.doesNotMatch(requests.join(""), /UNVISITED_RULE|OUTSIDE_RULE/);
  const entries = readFileSync(session, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const deltas = entries.filter(e => e.customType === "archeologist.nested");
  assert.equal(deltas.length, Number(accepted));
  assert.deepEqual(deltas.flatMap(e => e.data.files.map((f: { content: string }) => f.content)), mode === "direct" ? ["SECTION_RULE", "OTHER_RULE"] : mode === "codemode" ? ["SECTION_RULE"] : []);
  if (code) { assert.match(toolResults.join(""), mode === "codemode-caught-error" ? /Script completed[\s\S]*caught inner error/ : /Script completed[\s\S]*42/); }
  if (mode.endsWith("-replaced")) {
    assert.equal(JSON.parse(readFileSync(join(cwd, "section/probe"), "utf8")).number, 73);
    assert.match(toolResults.join(""), /42/); assert.doesNotMatch(toolResults.join(""), /73/);
  }
  if (mode === "override") assert.match(toolResults.join(""), /override success/);
  if (mode === "direct") {
    assert.equal(readFileSync(join(cwd, "other/created"), "utf8"), "already written");
    writeFileSync(join(cwd, "section/AGENTS.md"), "CHANGED_AFTER_ACCESS");
    const manager = SessionManager.open(session);
    manager.appendCompaction("FIXTURE_COMPACTED", null, 100);
    await run(["--session", session]);
    assert.match(requests.at(-1)!, /FIXTURE_COMPACTED/);
    assert.doesNotMatch(requests.at(-1)!, /already written/);
    assert.match(requests.at(-1)!, /SECTION_RULE/); assert.doesNotMatch(requests.at(-1)!, /CHANGED_AFTER_ACCESS/);
    await run(["--fork", session]); assert.doesNotMatch(requests.at(-1)!, /SECTION_RULE|OTHER_RULE/);
    write(join(agent, "archeologist.json"), { version: 1, mainNested: false });
    await run(["--session", session]); assert.doesNotMatch(requests.at(-1)!, /SECTION_RULE|OTHER_RULE/);
    write(join(agent, "archeologist.json"), { version: 1, mainNested: true });
    await run(["--session", session]); assert.match(requests.at(-1)!, /SECTION_RULE/);
    const branch = SessionManager.open(session);
    branch.branch(entries.find(e => e.type === "message" && e.message.role === "user").id);
    branch.appendCustomEntry("tree-navigation-fixture", {});
    await run(["--session", session]); assert.doesNotMatch(requests.at(-1)!, /SECTION_RULE|OTHER_RULE/);
    await run(["--no-session"]); assert.doesNotMatch(requests.at(-1)!, /SECTION_RULE|OTHER_RULE/);
  }
});
