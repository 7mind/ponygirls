import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toolRequestExample } from '../src/tool-examples.ts';
import { toolCatalogFixture, type ToolInputProperties } from './tool-catalog-fixture.ts';

const TOOL_NAMES = ['search_sessions', 'get_session', 'get_chunks', 'get_messages', 'related_sessions', 'list_facets', 'ingest_status', 'whoami'];
test('BA specified: curated synthetic requests match the current eight tool schema fixtures', () => {
  assert.deepEqual(toolCatalogFixture.map(tool => tool.name), TOOL_NAMES);
  for (const tool of toolCatalogFixture) {
    const request = toolRequestExample(tool.name);
    assert.ok(request !== null); assert.equal(request.jsonrpc, '2.0'); assert.equal(request.method, 'tools/call'); assert.equal(request.id, 1); assert.equal(request.params.name, tool.name);
    const args = request.params.arguments;
    for (const required of tool.inputSchema.required) assert.ok(required in args, `${tool.name} requires ${required}`);
    for (const [name, value] of Object.entries(args)) {
      const property = tool.inputSchema.properties[name as keyof ToolInputProperties];
      assert.ok(property !== undefined, `${tool.name} does not accept ${name}`);
      if (property.type === 'integer') { assert.equal(typeof value, 'number'); assert.ok(Number.isInteger(value)); assert.ok(value >= property.minimum && value <= property.maximum); }
      else if (property.type === 'string') { assert.equal(typeof value, 'string'); if ('maxLength' in property) assert.ok(value.length <= property.maxLength); if ('enum' in property) assert.ok(property.enum.includes(value)); }
      else assert.fail('The curated examples do not require array arguments.');
      if (name === 'sessionId' || name === 'generationId') assert.match(String(value), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    assert.ok(!('generationId' in args) || 'revision' in args);
    assert.deepEqual(JSON.parse(JSON.stringify(request)), request);
  }
});
test('BA specified: dynamic or unknown catalog tools have no invented example', () => {
  for (const name of ['source_catalog', 'dynamic_tool_from_registry', 'authorized_read', 'future_tool', 'whoami<script>', '']) assert.equal(toolRequestExample(name), null);
});
test('BA specified: examples use lexical search and do not invent unsupported related-session arguments', () => {
  const search = toolRequestExample('search_sessions'), related = toolRequestExample('related_sessions'), who = toolRequestExample('whoami');
  assert.ok(search !== null && search.params.name === 'search_sessions'); assert.equal(search.params.arguments.mode, 'lexical'); assert.equal(search.params.arguments.query, 'synthetic');
  assert.ok(related !== null && related.params.name === 'related_sessions'); assert.deepEqual(Object.keys(related.params.arguments).sort(), ['limit', 'sessionId']);
  assert.ok(who !== null); assert.deepEqual(who.params.arguments, {});
});
