import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
if (!process.env.PI_SDK_ROOT || !process.env.SEARCH_HUB_ROOT) throw new Error("PI_SDK_ROOT and SEARCH_HUB_ROOT are required");
const require = createRequire(path.join(process.env.PI_SDK_ROOT, "package.json"));
const { createJiti } = require("jiti");
const { reciprocalRankFusion } = await createJiti(import.meta.url).import(path.join(process.env.SEARCH_HUB_ROOT, "extensions/dispatch.ts"));
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, "fixtures/live-public-20261107.json"), "utf8"));
for (const item of fixture.cases) {
  const lists = item.engines.filter(engine => engine.ok).map(engine => ({ backend: engine.name,
    results: engine.documents.map(url => ({ url, title: url, backend: engine.name })) }));
  const size = lists.reduce((count, list) => count + list.results.length, 0);
  const actual = reciprocalRankFusion(lists, size).map(result => result.url);
  if (JSON.stringify(actual) !== JSON.stringify(item.productionRrf60)) throw new Error(`Frozen production RRF60 mismatch: ${item.query.id}`);
}
console.log(`Installed production RRF60 parity: ${fixture.cases.length} frozen live pools`);
