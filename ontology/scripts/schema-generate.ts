import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as codecs from '../generated/typescript/ontology/api/index.js';
import { extractRegistry } from './schema-registry.js';
import { compilePlan } from './schema-plan.js';
import { definitions, schemaFor, serialize } from './schema-json.js';
import { fixtures } from './schema-fixtures.js';

const PINNED_COMPILER = '1d0debf771b8a22334e68cf7e6f99d55443f2451279eae3713ad1b155a96cfc4';
async function main(args: readonly string[]): Promise<void> {
  assert.equal(args.length, 5, 'expected RAW_OPENAPI MODEL OUTPUT_DIR TYPED_PLAN COMPILER_SHA256');
  const [rawFile, modelFile, output, typedPlan, compilerDigest] = args;
  assert(rawFile !== undefined && modelFile !== undefined && output !== undefined && typedPlan !== undefined && compilerDigest !== undefined);
  assert.equal(compilerDigest, PINNED_COMPILER, 'unqualified compiler');
  const rawBytes = await readFile(rawFile);
  const modelBytes = await readFile(modelFile);
  const raw: unknown = JSON.parse(rawBytes.toString('utf8'));
  const registry = extractRegistry(codecs, raw);
  const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const plan = compilePlan(registry, raw, { compilerDigest, modelDigest: hash(modelBytes), rawDigest: hash(rawBytes) });
  const fixtureData = JSON.stringify(fixtures(plan, codecs), null, 2) + '\n';
  await mkdir(output, { recursive: true });
  const encoded = JSON.stringify(plan, null, 2);
  await writeFile(path.join(output, 'ontology-wire-plan.json'), encoded + '\n');
  await mkdir(path.dirname(typedPlan), { recursive: true });
  await writeFile(typedPlan, "import type { WirePlan } from '../../web/src/wire-plan.js';\nexport const wirePlan: WirePlan = " + encoded + ';\n');
  await writeFile(path.join(output, 'ontology-wire-fixtures.json'), fixtureData);
  const planDigest = hash(Buffer.from(encoded + '\n'));
  await writeFile(path.join(output, 'ontology-wire-schemas.json'), serialize({ planDigest, definitions: definitions(plan) }) + '\n');
  for (const [name, root] of [['find', 'FindRequest'], ['read', 'ReadRequest'], ['apply', 'ApplyRequest']] as const) {
    await writeFile(path.join(output, `ontology-mcp-${name}.json`), serialize(schemaFor(plan, `${plan.domain}/:#${root}`)) + '\n');
  }
  console.log(JSON.stringify({ types: registry.length, domain: plan.domain, version: plan.version, modelDigest: plan.modelDigest, rawDigest: plan.rawDigest }));
}
await main(process.argv.slice(2));
