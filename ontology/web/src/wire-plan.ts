export type WireNode =
  | { readonly kind: 'ref'; readonly component: string }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, WireNode>> }
  | { readonly kind: 'array'; readonly element: WireNode }
  | { readonly kind: 'nullable'; readonly value: WireNode }
  | { readonly kind: 'adt'; readonly members: Readonly<Record<string, string>> }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'string' | 'boolean' | 'uuid' | 'i32' | 'i64' };

export interface WireType {
  readonly typeId: string;
  readonly domain: string;
  readonly version: string;
  readonly component: string;
  readonly parent: string | null;
  readonly tag: string | null;
}
export interface WirePlan {
  readonly formatVersion: 1;
  readonly domain: string;
  readonly version: string;
  readonly compilerDigest: string;
  readonly modelDigest: string;
  readonly rawDigest: string;
  readonly registry: readonly WireType[];
  readonly nodes: Readonly<Record<string, WireNode>>;
}
