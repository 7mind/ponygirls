// Haystack storage: hand-written in-memory repository (dual-tests dummy).
// Small, strict, behaviorally close to the PG adapter for the shared suite.
// Exact-concurrency semantics ( Advisory locks, simultaneous identical ids )
// are PG-leg-only tests in Step 3 — this dummy is sequential by construction.
import type {
  HumanAttention,
  ItemMetadata,
  Principal,
  RevisionMeta,
  StoredItem,
} from "../domain/document.js";
import { corpusSegmentStrings, corpusWords } from "../query/text.js";
import { evaluate, type SearchCandidate } from "../query/evaluate.js";
import { decodeKey, encodeKey } from "../domain/qid.js";
import type {
  SearchableRepository,
  SearchPage,
  SearchRequest,
  SearchSummary,
} from "./search.js";
import {
  ConflictFault,
  NotFoundFault,
  ReplayConflictFault,
  type ItemRepository,
  type TerminalKind,
  type ValidatedPut,
} from "./repository.js";

interface ItemRecord {
  current: StoredItem;
  history: StoredItem[];
}

interface ReplayOutcomeCommitted {
  kind: "committed";
  revision: number;
  metadata: ItemMetadata;
}

interface ReplayOutcomeTerminal {
  kind: TerminalKind;
  detail: string;
  currentRevision: number | null;
}

type ReplayOutcome = ReplayOutcomeCommitted | ReplayOutcomeTerminal;

export class InMemoryItemRepository implements SearchableRepository {
  private readonly items = new Map<string, ItemRecord>();
  private readonly replays = new Map<string, { digest: string; outcome: ReplayOutcome }>();
  private readonly tokens = new Map<string, string>();
  private readonly projections = new Map<string, { words: string[]; segments: string[] }>();

  private static itemKey(project: string, item: string): string {
    return `${project}${item}`;
  }

  private static replayKey(principal: Principal, requestId: string): string {
    return `${principal.userId}${principal.tokenId}${requestId}`;
  }

  async getCurrent(project: string, item: string): Promise<StoredItem | null> {
    return this.items.get(InMemoryItemRepository.itemKey(project, item))?.current ?? null;
  }

  async getRevision(project: string, item: string, revision: number): Promise<StoredItem | null> {
    const record = this.items.get(InMemoryItemRepository.itemKey(project, item));
    if (!record) return null;
    if (record.current.revision === revision) return record.current;
    return record.history.find((s) => s.revision === revision) ?? null;
  }

  async listRevisions(project: string, item: string): Promise<RevisionMeta[]> {
    const record = this.items.get(InMemoryItemRepository.itemKey(project, item));
    if (!record) return [];
    return [...record.history, record.current]
      .sort((a, b) => b.revision - a.revision)
      .map((s) => ({
        revision: s.revision,
        modifiedAt: s.metadata.modifiedAt,
        modifiedBy: s.metadata.modifiedBy,
        tokenId: this.tokens.get(revisionId(project, item, s.revision)) ?? "",
      }));
  }

  async commit(put: ValidatedPut): Promise<{ revision: number; metadata: ItemMetadata; replayed: boolean }> {
    const replayKey = InMemoryItemRepository.replayKey(put.principal, put.requestId);
    const seen = this.replays.get(replayKey);
    if (seen) {
      if (seen.digest !== put.digest) throw new ReplayConflictFault();
      if (seen.outcome.kind !== "committed") {
        throw terminalFault(seen.outcome);
      }
      return { revision: seen.outcome.revision, metadata: seen.outcome.metadata, replayed: true };
    }

    const storeKey = InMemoryItemRepository.itemKey(put.key.project, put.key.item);
    const record = this.items.get(storeKey);

    if (put.expectedRevision === 0) {
      if (record) {
        const outcome: ReplayOutcome = {
          kind: "conflict",
          detail: "item already exists",
          currentRevision: record.current.revision,
        };
        this.replays.set(replayKey, { digest: put.digest, outcome });
        throw new ConflictFault(record.current.revision);
      }
      const metadata: ItemMetadata = {
        createdAt: put.now,
        createdBy: put.principal.userId,
        modifiedAt: put.now,
        modifiedBy: put.principal.userId,
      };
      const stored: StoredItem = {
        project: put.key.project,
        item: put.key.item,
        revision: 1,
        document: put.document,
        documentCanonical: put.documentCanonical,
        metadata,
      };
      this.items.set(storeKey, { current: stored, history: [] });
      this.tokens.set(revisionId(put.key.project, put.key.item, 1), put.principal.tokenId);
      this.writeProjection(storeKey, stored);
      this.replays.set(replayKey, { digest: put.digest, outcome: { kind: "committed", revision: 1, metadata } });
      return { revision: 1, metadata, replayed: false };
    }

    if (!record) {
      const outcome: ReplayOutcome = { kind: "not-found", detail: "item does not exist", currentRevision: null };
      this.replays.set(replayKey, { digest: put.digest, outcome });
      throw new NotFoundFault();
    }
    if (record.current.revision !== put.expectedRevision) {
      const outcome: ReplayOutcome = {
        kind: "conflict",
        detail: `expected ${put.expectedRevision}, current is ${record.current.revision}`,
        currentRevision: record.current.revision,
      };
      this.replays.set(replayKey, { digest: put.digest, outcome });
      throw new ConflictFault(record.current.revision);
    }
    const revision = record.current.revision + 1;
    const metadata: ItemMetadata = {
      ...record.current.metadata,
      modifiedAt: put.now,
      modifiedBy: put.principal.userId,
    };
    const stored: StoredItem = {
      project: put.key.project,
      item: put.key.item,
      revision,
      document: put.document,
      documentCanonical: put.documentCanonical,
      metadata,
    };
    record.history.push(record.current);
    record.current = stored;
    this.tokens.set(revisionId(put.key.project, put.key.item, revision), put.principal.tokenId);
    this.writeProjection(storeKey, stored);
    this.replays.set(replayKey, { digest: put.digest, outcome: { kind: "committed", revision, metadata } });
    return { revision, metadata, replayed: false };
  }

  async recordTerminal(record: {
    principal: Principal;
    requestId: string;
    digest: string;
    kind: TerminalKind;
    detail: string;
    currentRevision?: number | null;
    now: string;
  }): Promise<void> {
    void record.now;
    const replayKey = InMemoryItemRepository.replayKey(record.principal, record.requestId);
    const seen = this.replays.get(replayKey);
    if (seen) {
      if (seen.digest !== record.digest) throw new ReplayConflictFault();
      return;
    }
    const outcome: ReplayOutcome =
      record.kind === "conflict" || record.kind === "not-found"
        ? { kind: record.kind, detail: record.detail, currentRevision: record.currentRevision ?? null }
        : { kind: "invalid-document", detail: record.detail, currentRevision: null };
    this.replays.set(replayKey, { digest: record.digest, outcome });
  }

  private writeProjection(storeKey: string, stored: StoredItem): void {
    const doc = stored.document;
    const tags = [...(doc.tags ?? [])];
    this.projections.set(storeKey, {
      words: corpusWords(doc.title, doc.description, doc.fields, tags),
      segments: corpusSegmentStrings(doc.title, doc.description, doc.fields, tags),
    });
  }

  private candidateOf(record: ItemRecord): SearchCandidate {
    const doc = record.current.document;
    const key = InMemoryItemRepository.itemKey(record.current.project, record.current.item);
    const projection = this.projections.get(key) ?? { words: [], segments: [] };
    return {
      project: record.current.project,
      item: record.current.item,
      title: doc.title,
      description: doc.description,
      fields: doc.fields,
      type: doc.type,
      status: doc.status,
      importance: doc.importance,
      humanAttention: doc.humanAttention,
      createdBy: record.current.metadata.createdBy,
      modifiedBy: record.current.metadata.modifiedBy,
      createdAt: record.current.metadata.createdAt,
      modifiedAt: record.current.metadata.modifiedAt,
      links: doc.links.map(([t, target]) => [t, target] as const),
      tags: [...(doc.tags ?? [])],
      words: projection.words,
      segments: projection.segments,
    };
  }

  async search(request: SearchRequest): Promise<SearchPage> {
    const records = [...this.items.values()].sort((a, b) =>
      a.current.project < b.current.project
        ? -1
        : a.current.project > b.current.project
          ? 1
          : a.current.item < b.current.item
            ? -1
            : a.current.item > b.current.item
              ? 1
              : 0,
    );
    const incoming = (targetProject: string, targetItem: string) => {
      const sources: Array<{ project: string; item: string }> = [];
      for (const record of this.items.values()) {
        for (const [, target] of record.current.document.links) {
          try {
            const key = decodeKey(target);
            if (key.project === targetProject && key.item === targetItem) {
              sources.push({ project: record.current.project, item: record.current.item });
            }
          } catch {
            // Malformed stored targets cannot exist (validated at write).
          }
        }
      }
      return sources;
    };
    const matched: SearchSummary[] = [];
    for (const record of records) {
      const cur = record.current;
      if (request.scope !== undefined && cur.project !== request.scope) continue;
      if (request.after !== undefined) {
        if (cur.project < request.after.project) continue;
        if (cur.project === request.after.project && cur.item <= request.after.item) continue;
      }
      if (request.ast !== null && !evaluate(request.ast, this.candidateOf(record), incoming)) continue;
      matched.push({
        project: cur.project,
        item: cur.item,
        revision: cur.revision,
        title: cur.document.title,
        type: cur.document.type,
        status: cur.document.status,
        importance: cur.document.importance,
        humanAttention: cur.document.humanAttention as HumanAttention,
        tags: [...(cur.document.tags ?? [])],
        modifiedAt: cur.metadata.modifiedAt,
        modifiedBy: cur.metadata.modifiedBy,
      });
      if (matched.length >= request.limit) break;
    }
    if (matched.length < request.limit) return { items: matched };
    const last = matched[matched.length - 1]!;
    return { items: matched, next: { project: last.project, item: last.item } };
  }

  async observedValues(field: "type" | "status" | "importance" | "tags"): Promise<string[]> {
    const values = new Set<string>();
    for (const record of this.items.values()) {
      if (field === "tags") {
        for (const t of record.current.document.tags ?? []) {
          values.add(t);
          if (values.size >= 100) break;
        }
      } else {
        values.add(record.current.document[field]);
      }
      if (values.size >= 100) break;
    }
    return [...values].sort();
  }

  async suggestIds(fragment: string, limit: number): Promise<string[]> {
    // Match on the raw pair (fragments may be partial), but always emit the
    // canonical ENCODED qualified id — raw interpolation would mint
    // malformed ids for projects/items containing ':' or '%'.
    const out: string[] = [];
    for (const record of this.items.values()) {
      if (`${record.current.project}:${record.current.item}`.includes(fragment)) {
        out.push(encodeKey({ project: record.current.project, item: record.current.item }));
        if (out.length >= limit) break;
      }
    }
    return out.sort();
  }
}
function terminalFault(outcome: ReplayOutcomeTerminal): Error {
  if (outcome.kind === "conflict") return new ConflictFault(outcome.currentRevision);
  if (outcome.kind === "not-found") return new NotFoundFault();
  const err = new Error(outcome.detail);
  (err as Error & { code: string }).code = "invalid-document";
  err.name = "InvalidDocument";
  return err;
}

function revisionId(project: string, item: string, revision: number): string {
  return `${project}${item}#${revision}`;
}
