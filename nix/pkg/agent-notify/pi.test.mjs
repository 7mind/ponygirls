import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("Pi records an agent run before sending its settled completion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-notify-test-"));
  const command = join(directory, "notify");
  const log = join(directory, "calls");
  try {
    const bash = execFileSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).trim();
    await writeFile(command, `#!${bash}\nprintf '%s\\n' "$@" >> '${log}'\n`, { mode: 0o755 });
    const source = process.env.NOTIFY_PI_EXTENSION
      ? await readFile(process.env.NOTIFY_PI_EXTENSION, "utf8")
      : await readFile(new URL("./pi.ts", import.meta.url), "utf8");
    const extensionFile = join(directory, "extension.ts");
    const extensionSource = source.replace(/execFile\("[^"]+"/, `execFile(${JSON.stringify(command)}`);
    await writeFile(extensionFile, extensionSource);
    const { default: extension } = await import(pathToFileURL(extensionFile).href);
    const handlers = new Map();
    extension({ on: (name, handler) => handlers.set(name, handler) });
    const context = { sessionManager: { getSessionId: () => "stable-session" } };
    await handlers.get("agent_start")({ type: "agent_start" }, context);
    await handlers.get("agent_settled")({ type: "agent_settled" }, context);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    assert.equal(calls[0], "pi");
    assert.equal(calls[1], "--start");
    assert.deepEqual(JSON.parse(calls[2]), { session_id: "stable-session" });
    assert.equal(calls[3], "pi");
    assert.deepEqual(JSON.parse(calls[4]), { session_id: "stable-session" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
