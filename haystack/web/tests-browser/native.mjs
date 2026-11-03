// Controlled public-API browser harness. The only server under test is the
// executable selected by HAYSTACK_SERVER_COMMAND (Scala JVM or native image).
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { writeFile, rename, appendFile } from "node:fs/promises";
export { ownedDatabase } from "./database.mjs";
import { BaboonCodecContext } from "../../generated/typescript/BaboonSharedRuntime.ts";
import { PutRequest, PutResult, DocumentPayload, GetRequest, Item, HistoryRequest, HistoryResult } from "../../generated/typescript/haystack/api/index.ts";

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function freePort() {
  const socket = http.createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
export async function configFor({ database, port, webRoot, auth }) {
  if (!database || Object.keys(database).sort().join(",") !== "jdbcUrl,passwordFile,user") throw new Error("validated runtime database descriptor required");
  return {
    listenHost: "127.0.0.1", listenPort: port, webRoot, authReloadMs: 1000, auth,
    database: {
      ...database,
      limits: { maxConnections: 8, maxQueued: 32, queueTimeoutMs: 5000, connectTimeoutMs: 5000,
        statementTimeoutMs: 30000, lockTimeoutMs: 5000, idleTransactionTimeoutMs: 30000, socketTimeoutMs: 40000 },
    },
    retrieval: { policy: "operator-approved-metadata-v1", includeMetadata: true, approvedFieldPrefixes: [],
      maxChunkBytes: 8192, embedding: null, maxConcurrent: 2, maxQueued: 8, batchSize: 4 },
  };
}
export async function atomicConfig(file, value) {
  const temporary = file + ".next";
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}
export async function assertPortAvailable(port, host = "127.0.0.1") {
  const probe = http.createServer();
  try {
    await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(port, host, resolve); });
    await new Promise((resolve) => probe.close(resolve));
  } catch { throw new Error(`Fixture port ${port} is occupied; refusing to contact an existing listener`); }
}
export async function startServer(configFile, port, logFile) {
  const command = process.env.HAYSTACK_SERVER_COMMAND;
  if (!command) throw new Error("HAYSTACK_SERVER_COMMAND must select the Scala/native executable; no Node fallback");
  await assertPortAvailable(port);
  // Operator-provided shell command permits java -jar as well as one executable.
  // Configuration path is always a separate, quoted positional argument.
  const child = spawn("bash", ["-c", `exec ${command} "$@"`, "haystack-server", "serve", configFile], {
    stdio: ["ignore", "pipe", "pipe"], env: process.env,
  });
  let output = "";
  let ownReady = false;
  let log = Promise.resolve();
  const record = (chunk) => {
    output = (output + chunk.toString()).slice(-16384);
    if (output.split(/\r?\n/u).includes("haystack: ready")) ownReady = true;
    log = log.then(() => appendFile(logFile, chunk));
  };
  child.stdout.on("data", record); child.stderr.on("data", record);
  child.on("error", (error) => { output += error.message; });
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Server exited: ${child.exitCode ?? child.signalCode}\n${output}`);
      try {
        if (ownReady && (await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1000) })).ok) return child;
      } catch {}
      await delay(50);
    }
    throw new Error(`Server startup timed out\n${output}`);
  } catch (error) { await stopServer(child); throw error; }
  finally { await log; }
}
export async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);
  child.kill("SIGTERM"); await exited; clearTimeout(deadline);
}
export function publicClient(base, token) {
  const context = BaboonCodecContext.Default;
  async function call(path, codec, request, resultCodec) {
    const response = await fetch(`${base}${path}`, { method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-Haystack-Version": "1.0.0", Authorization: `Bearer ${token}` },
      body: JSON.stringify(codec.encode(context, request)) });
    const text = await response.text();
    assert.equal(response.status, 200, `${path}: ${text}`);
    return resultCodec.decode(context, JSON.parse(text));
  }
  return {
    put({ key, documentJson, expectedRevision, requestId }) {
      return call("/api/v1/put", PutRequest.jsonCodec(), new PutRequest(key, new DocumentPayload(documentJson), expectedRevision, requestId), PutResult.jsonCodec());
    },
    history(key) { return call("/api/v1/history", HistoryRequest.jsonCodec(), new HistoryRequest(key), HistoryResult.jsonCodec()); },
    get(key, revision) { return call("/api/v1/get", GetRequest.jsonCodec(), new GetRequest(key, revision), Item.jsonCodec()); },
  };
}
