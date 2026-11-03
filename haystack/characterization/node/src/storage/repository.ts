// Haystack storage: narrow repository contract with atomic CAS/replay.
// The application never touches tables; the PG adapter (Step 3) and the
// hand-written dummy implement this interface. Dual-tests: the abstract
// suite in tests/ runs against both legs.
import type {
  ItemMetadata,
  Principal,
  RevisionMeta,
  StoredItem,
  ItemDocument,
} from "../domain/document.js";
import type { ItemKey } from "../domain/qid.js";

export interface ValidatedPut {
  readonly key: ItemKey;
  readonly qualifiedKey: string;
  readonly expectedRevision: number;
  readonly document: ItemDocument;
  readonly documentCanonical: string;
  readonly digest: string;
  readonly principal: Principal;
  readonly requestId: string;
  /** RFC3339 server timestamp for this write. */
  readonly now: string;
}

export type TerminalKind = "conflict" | "not-found" | "invalid-document";

export interface CommitSuccess {
  readonly revision: number;
  readonly metadata: ItemMetadata;
  readonly replayed: boolean;
}

export class ConflictFault extends Error {
  readonly code = "conflict";
  constructor(readonly currentRevision: number | null) {
    super(
      currentRevision === null
        ? "item already exists (create-only)"
        : `revision conflict: current is ${currentRevision}`,
    );
    this.name = "ConflictFault";
  }
}

export class NotFoundFault extends Error {
  readonly code = "not-found";
  constructor() {
    super("item not found");
    this.name = "NotFoundFault";
  }
}

export class ReplayConflictFault extends Error {
  readonly code = "replay-conflict";
  constructor() {
    super("request_id reused with a different operation");
    this.name = "ReplayConflictFault";
  }
}

export interface ItemRepository {
  getCurrent(project: string, item: string): Promise<StoredItem | null>;
  getRevision(project: string, item: string, revision: number): Promise<StoredItem | null>;
  listRevisions(project: string, item: string): Promise<RevisionMeta[]>;

  /** Atomic: replay-check → CAS → append revision → update current →
   *  record replay. Terminal failures are recorded before throwing. */
  commit(put: ValidatedPut): Promise<CommitSuccess>;

  /** Record a terminal application failure (e.g. domain validation) under
   *  a request id. Replay-aware: identical digest returns the original
   *  outcome; different digest throws ReplayConflictFault. */
  recordTerminal(record: {
    principal: Principal;
    requestId: string;
    digest: string;
    kind: TerminalKind;
    detail: string;
    currentRevision?: number | null;
    now: string;
  }): Promise<void>;
}
