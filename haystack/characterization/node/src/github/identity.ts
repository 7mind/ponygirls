// Haystack GitHub accounting: deterministic identity (normative:
// haystack/docs/github-accounting.md). Pure functions over verified
// GraphQL responses — no network here; fixtures live in tests.
// The agent instruction that drives this lives in the shared HM context
// (nix/hm/haystack.nix); this module pins the algorithm both sides share.
import { createHash } from "node:crypto";
import { encodeKey } from "../domain/qid.js";
import { InvalidDocument } from "../domain/document.js";

export const IDENTITY_VERSION = "github-artifact-v1";
export const TRUSTED_HOST = "github.com";
export type ArtifactKind = "issue" | "pr";

/** Canonical digest input. Opaque node IDs preserved exactly (no trimming,
// no prefix, no URL derivation). */
export function digestFor(kind: ArtifactKind, nodeId: string): string {
  if (nodeId.length === 0) throw new InvalidDocument("empty GitHub node id");
  const canonical = JSON.stringify([IDENTITY_VERSION, TRUSTED_HOST, kind, nodeId]);
  return createHash("sha256").update(canonical, "utf-8").digest("hex");
}

/** Deterministic item component, e.g. github-issue-<64 hex>. */
export function itemComponent(kind: ArtifactKind, nodeId: string): string {
  return `github-${kind}-${digestFor(kind, nodeId)}`;
}

/** Complete key in the authoritative activity namespace. */
export function accountingKey(activityProjectId: string, kind: ArtifactKind, nodeId: string): string {
  return encodeKey({ project: activityProjectId, item: itemComponent(kind, nodeId) });
}

/** Map a trusted GraphQL __typename to an artifact kind. Anything else is
 *  a stop-and-report, never a minted key. */
export function kindFromTypename(typename: string): ArtifactKind {
  if (typename === "Issue") return "issue";
  if (typename === "PullRequest") return "pr";
  throw new InvalidDocument(`unsupported GitHub __typename: ${typename}`);
}

export interface GithubRecordFields {
  readonly kind: ArtifactKind;
  readonly nodeId: string;
  readonly url: string;
  readonly title: string;
  readonly summary: string;
  readonly affected?: string;
}

/** Canonicalize a display/provenance URL: trusted https host, strip query
 *  tracking and fragments, reject anything else. URLs never feed identity. */
export function canonicalUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InvalidDocument("malformed GitHub URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== TRUSTED_HOST) {
    throw new InvalidDocument("GitHub URL must be https://github.com/…");
  }
  if (!/^\/(?:[^/]+\/[^/]+\/(?:issues|pull)\/\d+)\/?$/.test(parsed.pathname)) {
    throw new InvalidDocument("GitHub URL must be an issue or pull URL");
  }
  return `https://github.com${parsed.pathname.replace(/\/$/, "")}`;
}

/** Build the fields.github payload plus fixed metadata for an accounting
 *  write. Importance is chosen by the agent from evidence, not defaulted. */
export function accountingDocument(record: GithubRecordFields, importance: string): Record<string, unknown> {
  if (!record.title) throw new InvalidDocument("GitHub record needs a title");
  return {
    title: record.title,
    description: record.summary,
    fields: {
      github: {
        kind: record.kind,
        node_id: record.nodeId,
        identity_format: IDENTITY_VERSION,
        url: canonicalUrl(record.url),
        ...(record.affected ? { affected: record.affected } : {}),
      },
    },
    type: record.kind === "issue" ? "github-issue" : "github-pr",
    status: "actual",
    importance,
    "human-attention": "required",
    links: [],
  };
}

/** Verify a stored record still describes this identity before CAS. A
 *  different or missing identity is a collision fault, never an overwrite. */
export function checkStoredIdentity(
  stored: { type?: unknown; fields?: { github?: { kind?: unknown; node_id?: unknown } } },
  kind: ArtifactKind,
  nodeId: string,
): void {
  const expectedType = kind === "issue" ? "github-issue" : "github-pr";
  const gh = stored.fields?.github;
  if (stored.type !== expectedType || gh?.kind !== kind || gh?.node_id !== nodeId) {
    throw new InvalidDocument("accounting collision: stored identity differs");
  }
}
