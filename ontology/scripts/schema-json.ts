import assert from 'node:assert/strict';
import type { WireNode, WirePlan } from '../web/src/wire-plan.js';

export type SchemaJson = null | boolean | string | number | bigint | readonly SchemaJson[] | { readonly [key: string]: SchemaJson };
export type SchemaObject = { readonly [key: string]: SchemaJson };
const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
function magnitude(bound: string): string {
  assert.equal(bound.length, 19);
  const parts = ['0', '[1-9][0-9]{0,17}'];
  let prefix = '';
  for (let index = 0; index < bound.length; index++) {
    const char = bound[index]; assert(char !== undefined);
    const digit = Number(char); const lower = index === 0 ? 1 : 0;
    if (digit > lower) {
      const range = digit - lower === 1 ? String(lower) : `[${lower}-${digit - 1}]`;
      const remaining = bound.length - index - 1;
      parts.push(prefix + range + (remaining === 0 ? '' : `[0-9]{${remaining}}`));
    }
    prefix += char;
  }
  parts.push(bound);
  return `(?:${parts.join('|')})`;
}
const I64_TEXT = `^(?:${magnitude('9223372036854775807')}|-${magnitude('9223372036854775808')})$`;
export function emitRule(node: WireNode): SchemaObject {
  switch (node.kind) {
    case 'ref': return { $ref: `#/$defs/${node.component}` };
    case 'object': return { type: 'object', properties: Object.fromEntries(Object.entries(node.fields).map(([name, value]) => [name, emitRule(value)])), required: Object.keys(node.fields), additionalProperties: false };
    case 'array': return { type: 'array', items: emitRule(node.element) };
    case 'nullable': return { anyOf: [emitRule(node.value), { type: 'null' }] };
    case 'adt': return { type: 'object', oneOf: Object.entries(node.members).map(([tag, component]) => ({ type: 'object', properties: { [tag]: { $ref: `#/$defs/${component}` } }, required: [tag], additionalProperties: false })) };
    case 'enum': return { type: 'string', enum: node.values };
    case 'string': return { type: 'string' };
    case 'boolean': return { type: 'boolean' };
    case 'uuid': return { type: 'string', pattern: UUID };
    case 'i32': return { type: 'integer', minimum: -2147483648, maximum: 2147483647 };
    case 'i64': return { anyOf: [{ type: 'string', pattern: I64_TEXT }, { type: 'integer', minimum: -9223372036854775808n, maximum: 9223372036854775807n }] };
  }
}
export function definitions(plan: WirePlan): Readonly<Record<string, SchemaObject>> {
  return Object.fromEntries(Object.entries(plan.nodes).map(([name, node]) => [name, emitRule(node)]));
}
function references(node: WireNode): readonly string[] {
  switch (node.kind) {
    case 'ref': return [node.component];
    case 'object': return Object.values(node.fields).flatMap(references);
    case 'array': return references(node.element);
    case 'nullable': return references(node.value);
    case 'adt': return Object.values(node.members);
    default: return [];
  }
}
export function schemaFor(plan: WirePlan, typeId: string): SchemaObject {
  const entry = plan.registry.find(value => value.typeId === typeId); assert(entry !== undefined);
  const pending = [entry.component]; const included = new Set<string>();
  while (pending.length !== 0) {
    const component = pending.pop(); assert(component !== undefined);
    if (included.has(component)) continue;
    included.add(component);
    const node = plan.nodes[component]; assert(node !== undefined);
    pending.push(...references(node));
  }
  const root = plan.nodes[entry.component]; assert(root !== undefined);
  const defs = definitions(plan);
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...emitRule(root),
    $defs: Object.fromEntries([...included].sort().map(name => { const value = defs[name]; assert(value !== undefined); return [name, value]; })) };
}
export function serialize(value: SchemaJson): string {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') {
    assert(typeof value !== 'number' || Number.isFinite(value));
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(serialize).join(',') + ']';
  return '{' + Object.entries(value).map(([key, item]) => JSON.stringify(key) + ':' + serialize(item)).join(',') + '}';
}
