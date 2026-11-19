// Controlled loopback embedding endpoint (OpenAI-style `{input:[…]}` → `{data:[{index,embedding}]}`) for the
// retrieval browser leg and the capture harness. Deterministic hashed bag of words with a tiny synonym table, so
// "automobile" lands near "car". It proves wiring, readiness and fallbacks, never semantic quality. No external
// network: it listens on 127.0.0.1 only and records every request it receives.
import http from "node:http";
import path from "node:path";
import { writeFile } from "node:fs/promises";

export const STUB_DIMENSIONS = 16;
export const DOCUMENT_PREFIX = "DOC: ";
export const QUERY_PREFIX = "QUERY: ";
const SYNONYMS = new Map([["automobile", "car"], ["vehicle", "car"], ["boat", "ship"]]);
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Words hashed into the first dimensions; the last dimension is a constant so that no vector is zero. */
export function stubVector(text) {
  const vector = new Array(STUB_DIMENSIONS).fill(0);
  vector[STUB_DIMENSIONS - 1] = 1;
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const word = SYNONYMS.get(raw) ?? raw;
    let hash = FNV_OFFSET;
    for (const unit of word) hash = Math.imul(hash ^ unit.codePointAt(0), FNV_PRIME) >>> 0;
    vector[hash % (STUB_DIMENSIONS - 1)] += 1;
  }
  return vector;
}

/** The server's `retrieval.embedding` block for this stub (bounds as in production, haystack/docs). */
export async function stubEmbeddingConfig(stub, dir) {
  const credentialFile = path.join(dir, "embedding-key");
  await writeFile(credentialFile, "", { mode: 0o600 });
  return { operationUrl: stub.url, model: "controlled-stub", revision: "hashed-bag-of-words-v1", dimensions: STUB_DIMENSIONS, sendDimensions: false,
    documentPrefix: DOCUMENT_PREFIX, queryPrefix: QUERY_PREFIX, normalization: "cosine", credentialFile, deadlineMs: 5000,
    maxResponseBytes: 1048576, maxBatch: 16, maxInputBytes: 16384, maxRequestBytes: 262144 };
}

/**
 * Starts the stub on a free loopback port. `requests` lists every request's inputs; `hold(match)` defers answers to
 * requests with an input matching `match` until `release()`; `stop()`/`start()` close and reopen the same port
 * (an outage: connections are refused); `close()` ends it.
 */
export async function startEmbeddingStub() {
  const requests = [];
  const holds = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let input;
    try { ({ input } = JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { input = null; }
    if (request.method !== "POST" || !Array.isArray(input) || !input.every((text) => typeof text === "string")) {
      response.writeHead(400, { "Content-Type": "application/json" }).end("{}");
      return;
    }
    requests.push(input);
    for (const hold of holds) if (input.some(hold.match)) await hold.released;
    const data = input.map((text, index) => ({ index, embedding: stubVector(text) }));
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data }));
  });
  const listen = (port) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  await listen(0);
  const port = server.address().port;
  const stop = async () => {
    if (!server.listening) return;
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  };
  return {
    url: `http://127.0.0.1:${port}/v1/embeddings`,
    requests,
    hold(match) {
      const hold = { match };
      hold.released = new Promise((resolve) => { hold.release = () => { holds.splice(holds.indexOf(hold), 1); resolve(); }; });
      holds.push(hold);
      return hold;
    },
    stop,
    async start() { if (!server.listening) await listen(port); },
    async close() { for (const hold of [...holds]) hold.release(); await stop(); },
  };
}
