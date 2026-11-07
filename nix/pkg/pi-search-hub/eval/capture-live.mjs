import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  output: { type: "string" }, configRoot: { type: "string" }, queries: { type: "string" },
  from: { type: "string", default: "0" }, count: { type: "string", default: "1" },
} });
if (!values.output || !values.configRoot || !process.env.PI_SDK_ROOT) {
  throw new Error("Required: PI_SDK_ROOT and --output DIR --configRoot PROJECT [--queries FILE --from N --count N]");
}
const from = Number(values.from), count = Number(values.count);
if (!Number.isInteger(from) || from < 0 || !Number.isInteger(count) || count < 1) throw new Error("Invalid query range");
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../src");
const queryFile = values.queries ? path.resolve(values.queries) : path.join(here, "live-queries.json");
const queryBytes = fs.readFileSync(queryFile);
const queries = JSON.parse(queryBytes).queries.slice(from, from + count);
if (queries.length !== count) throw new Error("Query range exceeds frozen input");
const output = path.resolve(values.output);
fs.mkdirSync(output, { recursive: true });
for (const query of queries) if (fs.existsSync(path.join(output, `${query.id}.json`))) throw new Error(`Refusing to overwrite ${query.id}`);
const sdk = path.resolve(process.env.PI_SDK_ROOT);
const require = createRequire(path.join(sdk, "package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url);
const { ModelRuntime, ModelRegistry } = await import(pathToFileURL(path.join(sdk, "dist/index.js")));
const { discoverNativeEngines } = await jiti.import(path.join(source, "extensions/native.ts"));
const configuration = await jiti.import(path.join(source, "extensions/config.ts"));
const { runBackend } = await jiti.import(path.join(source, "extensions/backends/registry.ts"));
const { runMetasearch } = await jiti.import(path.join(source, "extensions/metasearch.ts"));
const { resolveAlwaysInclude, selectBackendsForFallback } = await jiti.import(path.join(source, "extensions/dispatch.ts"));
const runtime = await ModelRuntime.create({ allowModelNetwork: false });
const modelRegistry = new ModelRegistry(runtime);
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sourceHash = crypto.createHash("sha256");
for (const dir of ["extensions", "backends"]) {
  for (const relative of fs.readdirSync(path.join(source, dir), { recursive: true }).sort()) {
    const file = path.join(source, dir, relative);
    if (fs.statSync(file).isFile()) sourceHash.update(`${dir}/${relative}\0`).update(fs.readFileSync(file)).update("\0");
  }
}
const binding = { sourceSha256: sourceHash.digest("hex"), harnessSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), queriesSha256: hash(queryBytes), sdk };

for (const query of queries) {
  const start = performance.now();
  const deadline = AbortSignal.timeout(90_000);
  configuration.refreshConfig(path.resolve(values.configRoot), true);
  const config = configuration.config;
  const ordinary = configuration.getActiveBackends().filter(name => name !== "openai-codex");
  const native = await discoverNativeEngines({ modelRegistry }, deadline);
  const nativeByName = new Map(native.map(engine => [`native:${engine.id}`, engine]));
  const fallback = resolveAlwaysInclude(config.alwaysInclude, ordinary);
  const fallbackNames = new Set(fallback.map(entry => entry.backend));
  const attempts = [];
  let outcome;
  try {
    outcome = await runMetasearch({
      // Thirty requested final hits make the unchanged targeted-main policy request ten per engine.
      // Replay later caps the same frozen lists to four/ten without making another request.
      mode: "targeted", orderedBackends: selectBackendsForFallback(config.selectionStrategy ?? "sequential", ordinary),
      fallback, native: native.map(engine => ({ backend: `native:${engine.id}`, timeoutMs: 45_000, maxResults: 10 })),
      query: query.query, numResults: 30, signal: deadline,
      runBackend: async (backend, text, requested, signal) => {
        const began = performance.now();
        const record = { backend, tier: nativeByName.has(backend) ? "native" : fallbackNames.has(backend) ? "fallback" : "main", requested, startedAt: new Date().toISOString() };
        attempts.push(record);
        try {
          const engine = nativeByName.get(backend);
          const response = engine ? await engine.search(text, requested, signal) : { results: await runBackend(backend, text, requested, signal) };
          Object.assign(record, { ok: true, results: response.results, usage: response.usage, label: engine?.label });
          return response.results;
        } catch (error) {
          // Raw SDK errors can contain credential-bearing URLs or headers; never write them.
          Object.assign(record, { ok: false, error: signal?.aborted ? "cancelled-or-deadline" : "engine-failed", usage: error.usage });
          throw new Error(record.error);
        } finally { record.elapsedMs = Math.round(performance.now() - began); }
      },
    });
  } catch { outcome = { error: deadline.aborted ? "query-deadline" : "dispatch-failed" }; }
  const evidence = { schema: 1, binding, query, capturedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start),
    policy: "targeted-main-ten-hits; configured fallback deadlines/caps; native-ten-hits", attempts,
    outcome: { error: outcome.error, finalResultCount: outcome.results?.length, backendStats: outcome.backendStats ? Object.fromEntries(outcome.backendStats) : undefined } };
  fs.writeFileSync(path.join(output, `${query.id}.json`), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`${query.id}: ${attempts.filter(attempt => attempt.ok).length}/${attempts.length} usable transport responses, ${evidence.elapsedMs}ms`);
}
