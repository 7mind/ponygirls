// Behavioral-Active-Blackbox-GoodCommunication; regression: production
// shutdown must not call end() again on the already-closed migration pool.
import { it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { Pool } from "pg";

const CONN = process.env.HAYSTACK_TEST_PG;
it("production entrypoint exits cleanly on SIGTERM", { skip: CONN === undefined ? "set HAYSTACK_TEST_PG" : false, timeout: 20_000 }, async () => {
  assert.ok(CONN);
  const admin = new Pool({ connectionString: CONN });
  try { await admin.query("DROP DATABASE IF EXISTS haystack_runtime"); await admin.query("CREATE DATABASE haystack_runtime"); }
  finally { await admin.end(); }
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-runtime-"));
  const token = randomBytes(32).toString("base64url");
  const hashFile = path.join(dir, "token.sha");
  const authFile = path.join(dir, "auth.json");
  await writeFile(hashFile, createHash("sha256").update(token).digest("hex"), { mode: 0o600 });
  await writeFile(authFile, JSON.stringify({ activityProjectId: "agent-activity", users: [
    { id: "runtime", type: "human", displayName: "Runtime", tokens: [{ id: "test", hashFile }] },
  ], cookieSecure: false, allowedHosts: ["127.0.0.1"], allowedOrigins: [`http://127.0.0.1:${port}`] }), { mode: 0o600 });
  const child = spawn(process.execPath, [new URL("../src/index.js", import.meta.url).pathname], {
    env: { ...process.env, HAYSTACK_DATABASE_URL: CONN.replace(/haystack_test/, "haystack_runtime"),
      HAYSTACK_AUTH_JSON: authFile, HAYSTACK_LISTEN: "127.0.0.1", HAYSTACK_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stdout.resume(); child.stderr.on("data", (data: Buffer) => { errors += data.toString(); });
  const exited = once(child, "exit");
  try {
    let ready = false;
    for (let i = 0; i < 100 && child.exitCode === null; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, `runtime did not start: ${errors}`);
    child.kill("SIGTERM");
    assert.equal((await exited)[0], 0, errors);
  } finally {
    if (child.exitCode === null) { child.kill("SIGKILL"); await exited; }
    await rm(dir, { recursive: true, force: true });
  }
});
