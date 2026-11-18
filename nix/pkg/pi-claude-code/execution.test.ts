import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { InMemoryCredentialStore, normalizeContext, type AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createClaudeCodeProvider } from "../src/provider.ts";
import { EXECUTION_NAMESPACE, EXECUTION_SYMBOL, type ClaudeExecution } from "../src/execution.ts";
import type { RunClaudeInput } from "../src/claude-cli.ts";

test("BG selected execution uses the original private discovery route, thinking and tool-change state through SDK auth", { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "claude-preparation-seam-"));
  const executable = join(root, "claude");
  const discovery = join(root, "discovery");
  await writeFile(executable, `#!${process.execPath}
import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
if(process.argv.includes('auth')) { console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',subscriptionType:'test'})); process.exit(0); }
appendFileSync(${JSON.stringify(discovery)}, 'discovery\\n');
for await (const line of createInterface({input:process.stdin})) {
 const f=JSON.parse(line);
 if(f.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:f.request_id,response:{models:[
 {value:'hidden-nondefault-opus',resolvedModel:'claude-opus-5-5',displayName:'Opus',description:'fixture',supportsAdaptiveThinking:false},
 {value:'hidden-nondefault-sonnet',resolvedModel:'claude-sonnet-5',displayName:'Sonnet',description:'fixture',supportsAdaptiveThinking:true}
 ]}}}));
}
await new Promise(resolve=>setTimeout(resolve,50));
`);
  await chmod(executable, 0o755);
  const previous = process.env.PI_CLAUDE_CODE_COMMAND;
  process.env.PI_CLAUDE_CODE_COMMAND = executable;
  t.after(async () => { if (previous === undefined) delete process.env.PI_CLAUDE_CODE_COMMAND; else process.env.PI_CLAUDE_CODE_COMMAND = previous; await rm(root, { recursive: true, force: true }); });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const registry = new ModelRegistry(runtime);
  const provider = createClaudeCodeProvider();
  registry.registerProvider(provider);
  assert.equal(registry.getRegisteredNativeProvider(provider.id), provider);
  const refreshed = await registry.refresh({ providers: [provider.id], allowNetwork: true, force: true });
  assert.deepEqual([...refreshed.errors], []);
  const capability = Reflect.get(provider, EXECUTION_SYMBOL);
  const prepared: RunClaudeInput[] = [];
  const originals: Promise<unknown>[] = [];
  let assertions = 0;
  const execution: ClaudeExecution = {
    cwd: root, signal: new AbortController().signal,
    beforeEntry: () => { assertions++; },
    run: async (input) => { prepared.push(input); throw new Error("controlled prepared request capture"); },
    captureOriginal: (stream: AssistantMessageEventStream) => { originals.push(stream.result()); return stream; },
    track: async (pending) => pending,
  };
  const tool = (name: string) => ({ name, description: name, parameters: { type: "object", properties: {} } });
  const context = normalizeContext({ messages: [
    { role: "system", content: "base", toolsAdded: [tool("alpha")], timestamp: 0 },
    { role: "user", content: "first", timestamp: 1 },
    { role: "system", content: "beta available", toolsAdded: [tool("beta")], timestamp: 2 },
    { role: "user", content: "second", timestamp: 3 },
  ] });
  for (const id of ["claude-opus-5-5", "claude-sonnet-5"]) {
    const model = registry.find(provider.id, id)!;
    assert.ok(model);
    assert.equal(model.compat, undefined);
    const result = await registry.streamSimple(model, context, { reasoning: "high", metadata: { [EXECUTION_NAMESPACE]: { capability, execution } } }).result();
    assert.match(result.errorMessage!, /controlled prepared request capture/);
  }
  assert.equal(prepared.length, 2);
  assert.equal(prepared[0]!.model, "hidden-nondefault-opus");
  assert.equal(prepared[1]!.model, "hidden-nondefault-sonnet");
  assert.equal(prepared[0]!.extraBody.thinking, undefined);
  assert.deepEqual(prepared[1]!.extraBody.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(prepared[0]!.betas, ["mid-conversation-tool-changes-2026-07-01"]);
  assert.equal(prepared[1]!.betas, undefined);
  assert.ok(prepared[0]!.nativeSystemInjections!.length > 0);
  assert.equal(prepared[1]!.nativeSystemInjections, undefined);
  for (const input of prepared) { assert.equal(input.cwd, root); assert.equal(input.env!.PI_CLAUDE_CODE_COMMAND, executable); }
  assert.equal((await Promise.all(originals)).length, 2);
  assert.ok(assertions >= 4);
  assert.equal(await readFile(discovery, "utf8"), "discovery\n");
});
