import type { WireNode, WirePlan } from './wire-plan.js';

export interface WireCodecIdentity {
  baboonTypeIdentifier(): string;
  baboonDomainIdentifier(): string;
  baboonDomainVersion(): string;
}
const MAX_DEPTH = 96;
const MIN_I32 = -2147483648;
const MAX_I32 = 2147483647;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const INTEGER_TEXT = /^-?(0|[1-9][0-9]*)$/;
const UUID_TEXT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function required(condition: boolean): asserts condition { if (!condition) throw new Error('Invalid wire value'); }
function record(value: unknown): Readonly<Record<string, unknown>> {
  required(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Readonly<Record<string, unknown>>;
}
function i64(value: unknown): string {
  let integer: bigint;
  if (typeof value === 'bigint') integer = value;
  else if (typeof value === 'number') { required(Number.isSafeInteger(value)); integer = BigInt(value); }
  else { required(typeof value === 'string' && value.length <= 20 && INTEGER_TEXT.test(value)); integer = BigInt(value); }
  required(integer >= MIN_I64 && integer <= MAX_I64);
  return integer.toString();
}

export class WireValidation {
  private readonly components: ReadonlyMap<string, string>;
  constructor(private readonly plan: WirePlan) {
    required(plan.formatVersion === 1);
    this.components = new Map(plan.registry.map(entry => [entry.typeId, entry.component]));
    required(this.components.size === plan.registry.length);
    for (const entry of plan.registry) required(entry.domain === plan.domain && entry.version === plan.version && Object.hasOwn(plan.nodes, entry.component));
  }
  normalize(codec: WireCodecIdentity, value: unknown): unknown {
    required(codec.baboonDomainIdentifier() === this.plan.domain && codec.baboonDomainVersion() === this.plan.version);
    const component = this.components.get(codec.baboonTypeIdentifier());
    required(component !== undefined);
    return this.walk({ kind: 'ref', component }, value, 0, new Set());
  }
  private walk(node: WireNode, value: unknown, depth: number, references: ReadonlySet<string>): unknown {
    switch (node.kind) {
      case 'ref': {
        required(!references.has(node.component));
        const target = this.plan.nodes[node.component];
        required(target !== undefined);
        return this.walk(target, value, depth, new Set([...references, node.component]));
      }
      case 'nullable': return value === null ? null : this.walk(node.value, value, depth, references);
      case 'object': {
        required(depth < MAX_DEPTH);
        const input = record(value);
        const fields = Object.keys(node.fields);
        required(Object.keys(input).length === fields.length && fields.every(name => Object.hasOwn(input, name)));
        return Object.fromEntries(fields.map(name => {
          const child = node.fields[name]; required(child !== undefined);
          return [name, this.walk(child, input[name], depth + 1, new Set())];
        }));
      }
      case 'array':
        required(depth < MAX_DEPTH && Array.isArray(value));
        return (value as unknown[]).map(item => this.walk(node.element, item, depth + 1, new Set()));
      case 'adt': {
        required(depth < MAX_DEPTH);
        const input = record(value);
        const tags = Object.keys(input);
        const tag = tags[0];
        required(tags.length === 1 && tag !== undefined && Object.hasOwn(node.members, tag));
        const component = node.members[tag]; required(component !== undefined);
        return Object.fromEntries([[tag, this.walk({ kind: 'ref', component }, input[tag], depth + 1, new Set())]]);
      }
      case 'enum': required(typeof value === 'string' && node.values.includes(value)); return value;
      case 'string': required(typeof value === 'string'); return value;
      case 'boolean': required(typeof value === 'boolean'); return value;
      case 'uuid': required(typeof value === 'string' && UUID_TEXT.test(value)); return value;
      case 'i32': required(typeof value === 'number' && Number.isInteger(value) && value >= MIN_I32 && value <= MAX_I32); return value;
      case 'i64': return i64(value);
      default: throw new Error('Unsupported wire plan node');
    }
  }
}
