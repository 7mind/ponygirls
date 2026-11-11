import assert from 'node:assert/strict';

type Fields = Readonly<Record<string, unknown>>;
type Getter = (this: Fields) => unknown;
export interface RegistryEntry {
  readonly typeId: string;
  readonly domain: string;
  readonly version: string;
  readonly component: string;
  readonly parent: string | null;
  readonly tag: string | null;
}
export function object(value: unknown, label: string): Fields {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  return value as Fields;
}
export function text(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label}: string required`);
  return value;
}
function identifier(value: string): void { assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value), 'unsupported identifier'); }
function getter(owner: Fields, key: string): string {
  const method = owner[key];
  assert(typeof method === 'function' && method.length === 0, `invalid metadata getter ${key}`);
  return text((method as Getter).call(owner), key);
}
function metadata(owner: Fields, instance: Fields, name: string): string {
  const key = `Baboon${name}`;
  assert(Object.hasOwn(owner, key), `missing codec static ${key}`);
  const value = getter(instance, `baboon${name}`);
  assert.equal(value, text(owner[key], key));
  return value;
}

export function extractRegistry(exports: Fields, raw: unknown): readonly RegistryEntry[] {
  const document = object(raw, 'OpenAPI');
  assert.equal(document.openapi, '3.1.0');
  const info = object(document.info, 'info');
  const domain = text(info.title, 'domain');
  const version = text(info.version, 'version');
  domain.split('.').forEach(identifier);
  const schemas = object(object(document.components, 'components').schemas, 'schemas');
  const prefix = domain.replaceAll('.', '_') + '_';
  const byId = new Map<string, RegistryEntry>();
  const components = new Set<string>();
  for (const [name, exported] of Object.entries(exports).sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.endsWith('_JsonCodec')) continue;
    assert(typeof exported === 'function', `${name}: codec class required`);
    const owner = exported as unknown as Fields;
    assert(Object.hasOwn(owner, 'instance'), `${name}: instance required`);
    const instance = object(owner.instance, name);
    const stem = name.slice(0, -'_JsonCodec'.length);
    identifier(stem);
    const typeId = metadata(owner, instance, 'TypeIdentifier');
    assert.equal(metadata(owner, instance, 'DomainIdentifier'), domain);
    assert.equal(metadata(owner, instance, 'DomainVersion'), version);
    const hasParent = Object.hasOwn(owner, 'BaboonAdtTypeIdentifier');
    assert.equal(hasParent, 'baboonAdtTypeIdentifier' in instance, 'incomplete ADT metadata');
    const parent = hasParent ? metadata(owner, instance, 'AdtTypeIdentifier') : null;
    let tag: string | null = null;
    if (parent === null || parent === typeId) assert.equal(typeId, `${domain}/:#${stem}`);
    else {
      const root = `${domain}/:#`;
      assert(parent.startsWith(root), 'unsupported parent ID');
      const parentStem = parent.slice(root.length);
      identifier(parentStem);
      const member = `${domain}/[${parent}]#`;
      assert(typeId.startsWith(member), 'invalid member ID');
      tag = typeId.slice(member.length);
      identifier(tag);
      assert.equal(stem, `${parentStem}_${tag}`);
    }
    const component = prefix + stem;
    assert(Object.hasOwn(schemas, component), `missing component ${component}`);
    object(schemas[component], component);
    assert(!byId.has(typeId) && !components.has(component), 'duplicate codec identity');
    byId.set(typeId, { typeId, domain, version, component, parent, tag });
    components.add(component);
  }
  assert(byId.size > 0, 'no JSON codecs');
  assert.deepEqual([...components].sort(), Object.keys(schemas).sort(), 'component/codec inventory mismatch');
  for (const entry of byId.values()) {
    if (entry.parent !== null && entry.parent !== entry.typeId) {
      const parent = byId.get(entry.parent);
      assert(parent !== undefined && parent.parent === parent.typeId && parent.tag === null, 'missing ADT root');
      assert.equal(entry.component, `${parent.component}_${entry.tag}`);
    }
    if (entry.parent !== entry.typeId) continue;
    const schema = object(schemas[entry.component], entry.component);
    assert(Array.isArray(schema.oneOf), 'ADT oneOf required');
    const actual = schema.oneOf.map((value: unknown) => {
      const reference = object(value, 'ADT reference');
      assert.deepEqual(Object.keys(reference), ['$ref']);
      return text(reference.$ref, 'ADT reference');
    });
    const expected = [...byId.values()].filter(member => member.parent === entry.typeId && member.tag !== null)
      .map(member => `#/components/schemas/${member.component}`);
    assert(expected.length > 0 && new Set(actual).size === actual.length, 'invalid ADT member inventory');
    assert.deepEqual(actual.sort(), expected.sort());
  }
  return [...byId.values()].sort((a, b) => a.typeId < b.typeId ? -1 : a.typeId > b.typeId ? 1 : 0);
}
