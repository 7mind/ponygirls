import assert from 'node:assert/strict';
import { BaboonCodecContext } from '../generated/typescript/BaboonSharedRuntime.js';
import type { WireNode, WirePlan } from '../web/src/wire-plan.js';
import { object } from './schema-registry.js';

interface RuntimeCodec {
  decode(context: BaboonCodecContext, value: unknown): unknown;
  encode(context: BaboonCodecContext, value: unknown): unknown;
}
export interface WireFixture {
  readonly typeId: string;
  readonly label: string;
  readonly wire: unknown;
  readonly scalaTypeId: string;
  readonly scalaWire: unknown;
}
export function fixtures(plan: WirePlan, exports: Readonly<Record<string, unknown>>): readonly WireFixture[] {
  const example = (node: WireNode, active: ReadonlySet<string>): unknown => {
    switch (node.kind) {
      case 'ref': {
        assert(!active.has(node.component), 'fixture has no finite required expansion');
        const next = plan.nodes[node.component]; assert(next !== undefined);
        return example(next, new Set([...active, node.component]));
      }
      case 'object': return Object.fromEntries(Object.entries(node.fields).map(([name, value]) => [name, example(value, active)]));
      case 'array': return [];
      case 'nullable': return null;
      case 'adt': {
        const member = Object.entries(node.members)[0]; assert(member !== undefined);
        return { [member[0]]: example({ kind: 'ref', component: member[1] }, active) };
      }
      case 'enum': { const value = node.values[0]; assert(value !== undefined); return value; }
      case 'string': return 'controlled-codec-fixture';
      case 'boolean': return true;
      case 'uuid': return '00000000-0000-4000-8000-000000000001';
      case 'i32': return 1;
      case 'i64': return '9223372036854775807';
    }
  };
  const output: WireFixture[] = [];
  for (const entry of plan.registry) {
    const prefix = plan.domain.replaceAll('.', '_') + '_';
    assert(entry.component.startsWith(prefix));
    const value = exports[entry.component.slice(prefix.length) + '_JsonCodec'];
    assert(typeof value === 'function');
    const instance = object((value as unknown as Readonly<Record<string, unknown>>).instance, 'codec instance');
    assert(typeof instance.encode === 'function' && typeof instance.decode === 'function');
    const codec = instance as unknown as RuntimeCodec;
    const node = plan.nodes[entry.component]; assert(node !== undefined);
    const base = example(node, new Set());
    const candidates: [string, unknown][] = [['base', base]];
    if (node.kind === 'object') {
      for (const [name, field] of Object.entries(node.fields)) {
        if (field.kind === 'nullable') candidates.push([`field:${name}:present`, { ...object(base, 'base'), [name]: example(field.value, new Set()) }]);
        if (field.kind === 'array') candidates.push([`field:${name}:item`, { ...object(base, 'base'), [name]: [example(field.element, new Set())] }]);
      }
    }
    if (node.kind === 'adt') for (const [tag, component] of Object.entries(node.members)) candidates.push([`variant:${tag}`, { [tag]: example({ kind: 'ref', component }, new Set()) }]);
    if (node.kind === 'enum') for (const value of node.values) candidates.push([`enum:${value}`, value]);
    for (const [label, input] of candidates) {
      const encoded = codec.encode(BaboonCodecContext.Default, codec.decode(BaboonCodecContext.Default, input));
      assert.deepEqual(encoded, input, `generated codec representation differs for ${entry.typeId}/${label}`);
      if (entry.parent !== null && entry.parent !== entry.typeId) {
        const tag = entry.tag; assert(tag !== null);
        output.push({ typeId: entry.typeId, label, wire: encoded, scalaTypeId: entry.parent, scalaWire: { [tag]: encoded } });
      } else output.push({ typeId: entry.typeId, label, wire: encoded, scalaTypeId: entry.typeId, scalaWire: encoded });
    }
  }
  return output;
}
