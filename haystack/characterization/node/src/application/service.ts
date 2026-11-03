// Haystack application service: the single implementation behind MCP
// (Step 6) and browser API (Step 5) transports. Search arrives in Step 4.
import { decodeKey, InvalidId } from "../domain/qid.js";
import { parseRaw, canonicalize, BadEnvelope } from "../domain/json.js";
import { validateDocument, InvalidDocument, type Principal, type StoredItem, type RevisionMeta, type ItemMetadata } from "../domain/document.js";
import { operationDigest } from "../domain/digest.js";
import { decodeKey as decodeLinkTarget } from "../domain/qid.js";
import {
  ConflictFault,
  NotFoundFault,
  type ItemRepository,
} from "../storage/repository.js";
import type { Clock } from "./clock.js";

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PutInput {
  key: string;
  documentJson: string;
  expectedRevision: number;
  requestId: string;
}

export interface PutResult {
  key: string;
  revision: number;
  metadata: ItemMetadata;
  replayed: boolean;
}

export class ItemService {
  constructor(
    private readonly repo: ItemRepository,
    private readonly clock: Clock,
  ) {}

  async get(qualifiedKey: string, revision?: number): Promise<StoredItem> {
    const key = decodeKey(qualifiedKey);
    const found =
      revision === undefined
        ? await this.repo.getCurrent(key.project, key.item)
        : await this.repo.getRevision(key.project, key.item, revision);
    if (!found) throw new NotFoundFault();
    return found;
  }

  async history(qualifiedKey: string): Promise<RevisionMeta[]> {
    const key = decodeKey(qualifiedKey);
    return this.repo.listRevisions(key.project, key.item);
  }

  async put(input: PutInput, principal: Principal): Promise<PutResult> {
    const key = decodeKey(input.key); // invalid-id: unrecorded
    if (!REQUEST_ID_RE.test(input.requestId)) {
      throw new BadEnvelope("request_id must be a UUIDv7");
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new BadEnvelope("expected_revision must be a nonnegative integer");
    }
    const qualifiedKey = input.key;
    const now = this.clock.now().toISOString();
    const raw = parseRaw(input.documentJson); // bad-envelope: unrecorded
    const documentCanonical = canonicalize(raw);
    const digest = operationDigest(qualifiedKey, input.expectedRevision, documentCanonical);
    let document;
    try {
      document = validateDocument(raw);
    } catch (err) {
      if (err instanceof InvalidDocument) {
        await this.repo.recordTerminal({
          principal,
          requestId: input.requestId,
          digest,
          kind: "invalid-document",
          detail: err.message,
          now,
        });
      }
      throw err;
    }
    // Link targets must be well-formed qualified ids (dangling is fine).
    for (const [, target] of document.links) {
      try {
        decodeLinkTarget(target);
      } catch (err) {
        const detail = `link target is not a qualified id: ${target}`;
        await this.repo.recordTerminal({
          principal,
          requestId: input.requestId,
          digest,
          kind: "invalid-document",
          detail,
          now,
        });
        throw new InvalidDocument(detail);
      }
    }
    const committed = await this.repo.commit({
      key,
      qualifiedKey,
      expectedRevision: input.expectedRevision,
      document,
      documentCanonical,
      digest,
      principal,
      requestId: input.requestId,
      now,
    });
    return { key: qualifiedKey, revision: committed.revision, metadata: committed.metadata, replayed: committed.replayed };
  }
}

export { InvalidId, BadEnvelope, InvalidDocument, ConflictFault, NotFoundFault };
