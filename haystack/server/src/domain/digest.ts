// Haystack domain: versioned canonical operation encoding + replay digest.
// Normative: haystack/docs/model.md §3.6 (`haystack-op-v1`).
import { createHash } from "node:crypto";


export const OP_FORMAT = "haystack-op-v1";
export const API_VERSION = "v1";

/** Canonical bytes of an operation envelope. Strings exact, object keys
 *  sorted (via canonicalize), array order kept, numbers lossless. */
export function canonicalOperationBytes(
  qualifiedKey: string,
  expectedRevision: number,
  documentCanonical: string,
): string {
  // documentCanonical is already canonical; embed it raw so no second
  // parse can drift the bytes.
  return `["haystack-op-v1","v1",${JSON.stringify(qualifiedKey)},${expectedRevision},${documentCanonical}]`;
}

export function operationDigest(
  qualifiedKey: string,
  expectedRevision: number,
  documentCanonical: string,
): string {
  return createHash("sha256").update(canonicalOperationBytes(qualifiedKey, expectedRevision, documentCanonical), "utf-8").digest("hex");
}


