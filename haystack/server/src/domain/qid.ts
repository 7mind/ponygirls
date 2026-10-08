// Haystack domain: qualified item IDs. Normative: haystack/docs/model.md §1.
// Single codec for every layer (MCP, HTTP, cursors, links, storage projections).
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
const HEX = "0123456789ABCDEF";

export interface ItemKey {
  readonly project: string;
  readonly item: string;
}

export const MAX_COMPONENT_CHARS = 256;
export const MAX_COMPONENT_BYTES = 1024;

export function encodeComponent(component: string): string {
  if (component.length === 0) throw new InvalidId("empty id component");
  if (component.length > MAX_COMPONENT_CHARS) throw new InvalidId("id component too long");
  if (component.includes("\0")) throw new InvalidId("NUL in id component");
  const bytes = Buffer.from(component, "utf-8");
  if (bytes.length > MAX_COMPONENT_BYTES) throw new InvalidId("id component too long");
  let out = "";
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (UNRESERVED.test(ch)) out += ch;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function decodeComponent(encoded: string): string {
  if (encoded.length === 0) throw new InvalidId("empty id component");
  const raw: number[] = [];
  for (let i = 0; i < encoded.length; ) {
    const c = encoded[i]!;
    if (c === "%") {
      const triplet = encoded.slice(i, i + 3);
      if (!/^%[0-9A-F]{2}$/.test(triplet)) throw new InvalidId(`bad escape in id: ${triplet}`);
      const value = parseInt(triplet.slice(1), 16);
      const ch = String.fromCharCode(value);
      if (UNRESERVED.test(ch)) throw new InvalidId("noncanonical escape of unreserved char");
      raw.push(value);
      i += 3;
    } else if (UNRESERVED.test(c)) {
      raw.push(c.charCodeAt(0));
      i += 1;
    } else {
      throw new InvalidId(`bad char in id: ${c}`);
    }
  }
  const decoded = Buffer.from(raw).toString("utf-8");
  // Buffer decodes invalid sequences with U+FFFD; reject by re-encoding.
  if (encodeComponent(decoded) !== encoded) throw new InvalidId("noncanonical id encoding");
  return decoded;
}

export function encodeKey(key: ItemKey): string {
  return `${encodeComponent(key.project)}:${encodeComponent(key.item)}`;
}

export function decodeKey(qualified: string): ItemKey {
  const colon = qualified.indexOf(":");
  if (colon < 0 || qualified.indexOf(":", colon + 1) >= 0) {
    throw new InvalidId("qualified id must contain exactly one literal colon");
  }
  return {
    project: decodeComponent(qualified.slice(0, colon)),
    item: decodeComponent(qualified.slice(colon + 1)),
  };
}

export class InvalidId extends Error {
  readonly code = "invalid-id";
  constructor(message: string) {
    super(message);
    this.name = "InvalidId";
  }
}
