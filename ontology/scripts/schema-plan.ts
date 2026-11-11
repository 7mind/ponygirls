import assert from 'node:assert/strict';
import { object, text, type RegistryEntry } from './schema-registry.js';
import type { WireNode, WirePlan } from '../web/src/wire-plan.js';

export interface SourceDigests { readonly compilerDigest: string; readonly modelDigest: string; readonly rawDigest: string }
const LOCAL_REFERENCE = '#/components/schemas/';
function keys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  assert(Object.keys(value).every(key => key === 'description' || allowed.includes(key)), 'unsupported schema keyword');
  if (value.description !== undefined) assert(typeof value.description === 'string', 'invalid description');
}
function strings(value: unknown): readonly string[] {
  assert(Array.isArray(value) && value.every(item => typeof item === 'string'), 'string list required');
  assert(new Set(value).size === value.length, 'duplicate list member');
  return value;
}

export function compilePlan(registry: readonly RegistryEntry[], raw: unknown, digests: SourceDigests): WirePlan {
  for (const digest of Object.values(digests)) assert(/^[0-9a-f]{64}$/.test(digest), 'invalid source digest');
  const document = object(raw, 'document');
  const info = object(document.info, 'info');
  const schemas = object(object(document.components, 'components').schemas, 'schemas');
  const reference = (value: unknown): string => {
    const ref = text(value, 'reference');
    assert(ref.startsWith(LOCAL_REFERENCE), 'nonlocal reference');
    const component = ref.slice(LOCAL_REFERENCE.length);
    assert(Object.hasOwn(schemas, component), 'unresolved reference');
    return component;
  };
  const nullable = (value: unknown): boolean => {
    const schema = object(value, 'field');
    return Array.isArray(schema.oneOf) && schema.oneOf.some(member => object(member, 'alternative').type === 'null');
  };
  const compile = (value: unknown): WireNode => {
    const schema = object(value, 'schema node');
    if (Object.hasOwn(schema, '$ref')) {
      keys(schema, ['$ref']);
      return { kind: 'ref', component: reference(schema.$ref) };
    }
    if (Object.hasOwn(schema, 'oneOf')) {
      keys(schema, ['oneOf']);
      assert(Array.isArray(schema.oneOf) && schema.oneOf.length === 2, 'unsupported union');
      const nulls = schema.oneOf.filter(member => object(member, 'alternative').type === 'null');
      assert(nulls.length === 1, 'nullable union required');
      keys(object(nulls[0], 'null alternative'), ['type']);
      const other = schema.oneOf.find(member => object(member, 'alternative').type !== 'null');
      assert(other !== undefined);
      return { kind: 'nullable', value: compile(other) };
    }
    if (schema.type === 'object') {
      keys(schema, ['type', 'properties', 'required']);
      if (!Object.hasOwn(schema, 'properties')) {
        assert(!Object.hasOwn(schema, 'required'), 'unexpected empty-object required list');
        return { kind: 'object', fields: {} };
      }
      const fields = object(schema.properties, 'properties');
      const required = strings(schema.required);
      const expected = Object.entries(fields).filter(([, field]) => !nullable(field)).map(([name]) => name).sort();
      assert.deepEqual([...required].sort(), expected, 'unexpected compiler required-field policy');
      return { kind: 'object', fields: Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, field]) => [name, compile(field)])) };
    }
    if (schema.type === 'array') {
      keys(schema, ['type', 'items']);
      return { kind: 'array', element: compile(schema.items) };
    }
    if (schema.type === 'string' && Object.hasOwn(schema, 'enum')) {
      keys(schema, ['type', 'enum']);
      const values = strings(schema.enum);
      assert(values.length > 0, 'empty enum');
      return { kind: 'enum', values };
    }
    keys(schema, ['type', 'format']);
    if (schema.type === 'string') {
      if (schema.format === undefined) return { kind: 'string' };
      if (schema.format === 'uuid') return { kind: 'uuid' };
      if (schema.format === 'int64') return { kind: 'i64' };
    }
    if (schema.type === 'integer' && schema.format === 'int32') return { kind: 'i32' };
    if (schema.type === 'boolean' && schema.format === undefined) return { kind: 'boolean' };
    throw new Error('unsupported primitive schema');
  };
  const nodes = Object.fromEntries(registry.map(entry => {
    const schema = object(schemas[entry.component], entry.component);
    let node: WireNode;
    if (entry.parent === entry.typeId) {
      keys(schema, ['oneOf']);
      node = { kind: 'adt', members: Object.fromEntries(registry.filter(member => member.parent === entry.typeId && member.tag !== null).map(member => [member.tag, member.component])) };
    } else node = compile(schema);
    return [entry.component, node];
  }));
  // Only reference-only paths need cycle rejection; recursive containers are depth-bounded at runtime.
  const references = (node: WireNode, seen: ReadonlySet<string>): void => {
    if (node.kind === 'nullable') references(node.value, seen);
    if (node.kind === 'ref') {
      assert(!seen.has(node.component), 'non-consuming reference cycle');
      const next = nodes[node.component]; assert(next !== undefined);
      references(next, new Set([...seen, node.component]));
    }
  };
  for (const [component, node] of Object.entries(nodes)) references(node, new Set([component]));
  return { formatVersion: 1, domain: text(info.title, 'domain'), version: text(info.version, 'version'), ...digests, registry, nodes };
}
