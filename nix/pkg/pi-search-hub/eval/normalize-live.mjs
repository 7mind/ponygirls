import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" }, queries: { type: "string" } } });
if (!values.input || !values.output || !process.env.PI_SDK_ROOT) throw new Error("Required: PI_SDK_ROOT, --input DIR --output NEW.json");
const here = path.dirname(fileURLToPath(import.meta.url));
const queryBytes = fs.readFileSync(values.queries ?? path.join(here, "live-queries.json"));
const specification = JSON.parse(queryBytes);
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const require = createRequire(path.join(process.env.PI_SDK_ROOT, "package.json"));
const { createJiti } = require("jiti");
const { reciprocalRankFusion } = await createJiti(import.meta.url).import(path.join(here, "../src/extensions/dispatch.ts"));
const dispatchSha256 = sha256(fs.readFileSync(path.join(here, "../src/extensions/dispatch.ts")));
function canonical(url) {
  try { const parsed = new URL(url); parsed.hash = ""; return parsed.toString(); }
  catch { return url; }
}
const tierOrder = ["main", "fallback", "native"];
const cases = [];
let binding;
for (const query of specification.queries) {
  const filename = `${query.id}.json`;
  const bytes = fs.readFileSync(path.join(values.input, filename));
  const record = JSON.parse(bytes);
  if (JSON.stringify(record.query) !== JSON.stringify(query) || record.binding.queriesSha256 !== sha256(queryBytes)) throw new Error(`Query binding mismatch: ${filename}`);
  if (binding !== undefined && JSON.stringify(record.binding) !== JSON.stringify(binding)) throw new Error(`Mixed source/harness binding: ${filename}`);
  binding = record.binding;
  if (record.outcome.error) throw new Error(`Query did not finish: ${filename}`);
  const names = new Set();
  const engines = record.attempts.map(attempt => {
    if (!tierOrder.includes(attempt.tier) || names.has(attempt.backend)) throw new Error(`Invalid/duplicate engine: ${filename}`);
    names.add(attempt.backend);
    const ids = (attempt.results ?? []).map(result => canonical(result.url));
    return { name: attempt.backend, tier: attempt.tier, requested: attempt.requested, ok: attempt.ok, error: attempt.error,
      elapsedMs: attempt.elapsedMs, label: attempt.label, documents: ids, duplicateRows: ids.length - new Set(ids).size };
  }).sort((left, right) => tierOrder.indexOf(left.tier) - tierOrder.indexOf(right.tier));
  const lists = engines.filter(engine => engine.ok).map(engine => ({ backend: engine.name,
    results: engine.documents.map(url => ({ url, title: url, backend: engine.name })) }));
  const total = lists.reduce((sum, list) => sum + list.results.length, 0);
  const baseline = reciprocalRankFusion(lists, total).map(result => canonical(result.url));
  cases.push({ query, capturedAt: record.capturedAt, elapsedMs: record.elapsedMs,
    rawRecordSha256: sha256(bytes), engines, productionRrf60: baseline });
}
if (!cases.length) throw new Error("No frozen query cases");
fs.writeFileSync(values.output, JSON.stringify({ schema: 1, binding: { ...binding, dispatchSha256 },
  note: "Public URL/rank metadata only. Non-target documents are unjudged, not irrelevant. Native source encounter order is not verified relevance order.",
  cases }, null, 2) + "\n", { flag: "wx" });
console.log(`Normalized ${cases.length} fixed public queries; production RRF60 rankings retained for offline parity verification.`);
