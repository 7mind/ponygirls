#!/usr/bin/env node
// Characterization tooling ONLY. Imports the actual retained old production TS
// build; never loaded by the Scala service, current client or deployed runtime.
// Run: cd haystack && npm run build -w server && node scripts/generate-historical-fixtures.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { validateDocument } from '../server/dist/domain/document.js';
import { parseRaw, canonicalize } from '../server/dist/domain/json.js';
import { ItemService } from '../server/dist/application/service.js';
import { InMemoryItemRepository } from '../server/dist/storage/memory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'server/src/test/resources/haystack/historical');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [
  'server/src/domain/document.ts', 'server/src/domain/json.ts', 'server/src/domain/qid.ts',
  'server/src/application/service.ts', 'server/src/storage/memory.ts', 'server/src/mcp/adapter.ts', 'package-lock.json',
];
const sourceDigests = Object.fromEntries(await Promise.all(sources.map(async name => [name, hash(await readFile(path.join(root, name)))])));
const adapter = await readFile(path.join(root, 'server/src/mcp/adapter.ts'), 'utf8');
assert.match(adapter, /document_json: z\.string\(\)\.min\(1\)\.max\(1024 \* 1024 \+ 1024\)/);
const oldMcpMaxUtf16 = 1024 * 1024 + 1024;
const document = (fields, tags = '[]') => `{"title":"historical synthetic","description":"synthetic fixture only","fields":${fields},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[],"tags":${tags}}`;
const cases = [
  { name: 'coefficient-100000', raw: document(`{"n":${'9'.repeat(100000)},"decimal":0.10}`), accepted: true, newWrite: true },
  { name: 'object-key-262145', raw: document(`{"${'k'.repeat(262145)}":"value"}`), accepted: true, newWrite: true },
  { name: 'fields-64-arrays-scalar', raw: document('['.repeat(64) + '0' + ']'.repeat(64)), accepted: true, newWrite: true },
  { name: 'fields-65-empty-arrays', raw: document('['.repeat(65) + ']'.repeat(65)), accepted: true, newWrite: true },
  { name: 'fields-65-arrays-scalar', raw: document('['.repeat(65) + '0' + ']'.repeat(65)), accepted: false, newWrite: false },
  { name: 'fields-66-empty-arrays', raw: document('['.repeat(66) + ']'.repeat(66)), accepted: false, newWrite: false },
  { name: 'unicode-bmp-over-new-byte-envelope', raw: document(JSON.stringify(Array(3).fill('界'.repeat(200000)))), accepted: true, newWrite: false },
  { name: 'unicode-astral-over-new-byte-envelope', raw: document(JSON.stringify(Array(3).fill('🐎'.repeat(120000)))), accepted: true, newWrite: false },
  { name: 'tag-non-whitespace-control', raw: document('{}', JSON.stringify(['\u001clabel', 'label\u001f'])), accepted: true, newWrite: true },
  { name: 'field-string-262145', raw: document(JSON.stringify('s'.repeat(262145))), accepted: false, newWrite: false },
];
await mkdir(output, { recursive: true });
const fixtures = [];
let index = 0;
for (const fixture of cases) {
  const value = parseRaw(fixture.raw);
  const canonical = canonicalize(value);
  let accepted = true;
  try { validateDocument(value); } catch (error) {
    assert.equal(error.code, 'invalid-document'); accepted = false;
  }
  assert.equal(accepted, fixture.accepted, `${fixture.name}: actual old production validator disagrees`);
  assert.ok(canonical.length <= oldMcpMaxUtf16, `${fixture.name}: not an old MCP-admissible string envelope`);
  if (accepted) {
    // Actual old application path produces an acknowledgement and authoritative
    // canonical text, not just a reconstructed AST or a copied validator.
    const service = new ItemService(new InMemoryItemRepository(), { now: () => new Date('2026-10-07T18:00:00Z') });
    const requestId = `0193e8d5-6f5c-7a1b-8c2d-${String(++index).padStart(12, '0')}`;
    const result = await service.put({ key: 'historical:' + fixture.name, documentJson: fixture.raw, expectedRevision: 0, requestId },
      { userId: 'historical-author', type: 'human', tokenId: 'old-fixture-token' });
    assert.equal(result.revision, 1);
    assert.equal((await service.get('historical:' + fixture.name)).documentCanonical, canonical);
  }
  const file = fixture.name + '.json.gz';
  const bytes = Buffer.from(canonical, 'utf8');
  await writeFile(path.join(output, file), gzipSync(bytes, { level: 9 }));
  fixtures.push({ name: fixture.name, file, accepted, newWrite: fixture.newWrite, sha256: hash(bytes), utf16Chars: canonical.length, utf8Bytes: bytes.length });
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  format: 'old-production-ts-admission-fixtures-v1',
  provenance: 'Actual retained TS parseRaw + validateDocument; accepted fixtures acknowledged through actual old ItemService over its handwritten memory adapter. PG JSONB/current/history preservation is exercised separately by Scala tests.',
  sourceDigests, oldMcpMaxUtf16, fixtures,
}, null, 2) + '\n');
console.log(`Generated ${fixtures.length} synthetic historical fixtures (${fixtures.filter(f => f.accepted).length} acknowledged by old production service).`);
