import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { discoverClaudeModels } from "../executor/claude-cli.ts";

test("catalog discovery observes a leader exit before descendant stdout closure", { timeout: 3000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-discovery-exit-"));
  const script = join(root, "fake-cli");
  await writeFile(script, `#!${process.execPath}\nimport {spawn} from 'node:child_process';import {createInterface} from 'node:readline';for await(const line of createInterface({input:process.stdin})){const f=JSON.parse(line);if(f.type==='control_request'){console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:f.request_id,response:{models:[{value:'sonnet',displayName:'Sonnet',description:'fixture'}]}}}));const c=spawn(process.execPath,['-e','setTimeout(()=>{},200)'],{stdio:['ignore',process.stdout,'ignore']});c.unref();process.stdout.write('',()=>process.exit(0));}}`);
  await chmod(script, 0o755);
  try {
    const models = await discoverClaudeModels({ ...process.env, PI_CLAUDE_CODE_COMMAND: script }, undefined, 1000);
    assert.equal(models[0]!.value, "sonnet");
  } finally { await rm(root, { recursive: true, force: true }); }
});
