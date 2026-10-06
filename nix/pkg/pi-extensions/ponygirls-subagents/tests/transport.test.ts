import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerHandle } from "../src/worker-launch.ts";
import { bindChannel } from "../src/protocol.ts";

test("an oversized worker request is answered with an error, never dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-oversize-"));
  const handle = new WorkerHandle({
    workerPath: new URL("./fixtures/oversized-tool-worker.ts", import.meta.url).pathname,
    rootEpoch: "e",
    agentId: "a",
    sdkRoot: null,
    deterministic: false,
    agentDir: dir,
    sessionsDir: dir,
  }, bindChannel("e", "a", "i"));
  const handled: string[] = [];
  handle.setToolRequestHandler(async (p) => {
    handled.push(String(p.args["path"]));
    return { content: "ok", isError: false };
  });
  try {
    await handle.launch();
    const start = Date.now();
    while (!handle.diagnostics().stderr.includes("response big") && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 25));
    const stderr = handle.diagnostics().stderr;
    assert.match(stderr, /response big \{"ok":false,"content":"PAYLOAD_TOO_LARGE/);
    assert.match(stderr, /response small \{"ok":true/);
    assert.deepEqual(handled, ["small.txt"], "the oversized request never reached the broker");
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
