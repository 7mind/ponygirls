// Haystack domain: item/health shape, validation, principals, faults.
// Normative: haystack/docs/model.md §2.
import { isLosslessNumber, type JsonValue } from "./json.js";

export type UserType = "human" | "agent";
export type HumanAttention = "required" | "cleared";

export interface Principal {
  readonly userId: string;
  readonly type: UserType;
  readonly tokenId: string;
}

export type LinkTuple = readonly [linkType: string, target: string];

export interface ItemDocument {
  readonly title: string;
  readonly description: string;
  readonly fields: JsonValue;
  readonly type: string;
  readonly status: string;
  readonly importance: string;
  readonly humanAttention: HumanAttention;
  readonly links: readonly LinkTuple[];
  readonly tags: readonly string[];
}

export interface ItemMetadata {
  readonly createdAt: string;
  readonly createdBy: string;
  readonly modifiedAt: string;
  readonly modifiedBy: string;
}

export interface StoredItem {
  readonly project: string;
  readonly item: string;
  readonly revision: number;
  readonly document: ItemDocument;
  /** Canonical JSON of the document (models storage/projection form). */
  readonly documentCanonical: string;
  readonly metadata: ItemMetadata;
}

export interface RevisionMeta {
  readonly revision: number;
  readonly modifiedAt: string;
  readonly modifiedBy: string;
  readonly tokenId: string;
}

export const TITLE_MAX = 512;
export const DESCRIPTION_MAX = 64 * 1024;
export const DOCUMENT_MAX_BYTES = 1024 * 1024;
export const FIELDS_DEPTH_MAX = 64;
export const LINKS_MAX = 256;
export const LINK_TYPE_MAX = 128;
export const META_VALUE_MAX = 128;
export const STRING_LEAF_MAX = 256 * 1024;
export const TAG_VALUE_MAX = 128;
export const TAGS_MAX = 64;

export class InvalidDocument extends Error {
  readonly code = "invalid-document";
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocument";
  }
}

/** Validate a parsed (lossless) document value. Returns the typed document.
 *  Client-supplied authorship is never read — the service stamps it. */
export function validateDocument(value: JsonValue): ItemDocument {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidDocument("document must be a JSON object");
  }
  const obj = value as { [key: string]: JsonValue };
  const allowed = new Set([
    "title",
    "description",
    "fields",
    "type",
    "status",
    "importance",
    "human-attention",
    "links",
    "tags",
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw new InvalidDocument(`unknown document field: ${key}`);
  }
  const title = requiredString(obj["title"], "title", TITLE_MAX);
  const description = requiredString(obj["description"], "description", DESCRIPTION_MAX);
  if (!("fields" in obj)) throw new InvalidDocument("document.fields is required");
  checkValue(obj["fields"]!, "fields", 0);
  const type = requiredString(obj["type"], "type", META_VALUE_MAX);
  const status = requiredString(obj["status"], "status", META_VALUE_MAX);
  const importance = requiredString(obj["importance"], "importance", META_VALUE_MAX);
  const attention = obj["human-attention"];
  if (attention !== "required" && attention !== "cleared") {
    throw new InvalidDocument('document["human-attention"] must be "required" or "cleared"');
  }
  const links = validateLinks(obj["links"]);
  const tags = validateTags(obj["tags"]);
  return {
    title,
    description,
    fields: obj["fields"]!,
    type,
    status,
    importance,
    humanAttention: attention,
    links,
    tags,
  };
}

function requiredString(value: JsonValue | undefined, name: string, max: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidDocument(`document.${name} must be a nonempty string`);
  }
  if (value.length > max) throw new InvalidDocument(`document.${name} exceeds ${max} chars`);
  if (value.includes("\0")) throw new InvalidDocument(`document.${name} contains NUL`);
  return value;
}

function validateTags(value: JsonValue | undefined): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidDocument("document.tags must be an array");
  if (value.length > TAGS_MAX) throw new InvalidDocument(`more than ${TAGS_MAX} tags`);
  return value.map((entry, i) => {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > TAG_VALUE_MAX) {
      throw new InvalidDocument(`document.tags[${i}] must be a nonempty string \u2264 ${TAG_VALUE_MAX}`);
    }
    if (entry.includes("\0")) throw new InvalidDocument(`document.tags[${i}] contains NUL`);
    if (entry !== entry.trim()) throw new InvalidDocument(`document.tags[${i}] has leading/trailing whitespace`);
    return entry;
  });
}

function validateLinks(value: JsonValue | undefined): LinkTuple[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidDocument("document.links must be an array");
  if (value.length > LINKS_MAX) throw new InvalidDocument(`more than ${LINKS_MAX} links`);
  return value.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new InvalidDocument(`document.links[${i}] must be a [type, target] pair`);
    }
    const [linkType, target] = entry as JsonValue[];
    if (typeof linkType !== "string" || linkType.length === 0 || linkType.length > LINK_TYPE_MAX) {
      throw new InvalidDocument(`document.links[${i}][0] must be a nonempty string ≤ ${LINK_TYPE_MAX}`);
    }
    if (typeof target !== "string" || target.length === 0) {
      throw new InvalidDocument(`document.links[${i}][1] must be a nonempty qualified id`);
    }
    return [linkType, target] as LinkTuple;
  });
}

/** Structural JSON check: depth, string-leaf size, no unsupported values.
 *  lossless-json only produces plain JSON values, but belt and suspenders
 *  at the trust boundary (the same validator guards the PG adapter path). */
function checkValue(value: JsonValue, path: string, depth: number): void {
  if (depth > FIELDS_DEPTH_MAX) throw new InvalidDocument(`${path}: exceeds depth ${FIELDS_DEPTH_MAX}`);
  if (typeof value === "string") {
    if (value.includes("\0")) throw new InvalidDocument(`${path}: NUL in string`);
    if (value.length > STRING_LEAF_MAX) throw new InvalidDocument(`${path}: string exceeds limit`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkValue(v, `${path}[${i}]`, depth + 1));
    return;
  }
  if (value !== null && typeof value === "object") {
    if (isLosslessNumber(value)) return;
    for (const [k, v] of Object.entries(value)) {
      if (k.includes("\0")) throw new InvalidDocument(`${path}: NUL in object key`);
      checkValue(v, `${path}.${k}`, depth + 1);
    }
    return;
  }
}
