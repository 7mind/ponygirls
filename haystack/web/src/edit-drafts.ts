// Unsaved drafts of the record editor, kept outside the editor component (spec §5 rule 7). The router unmounts the editor on
// every way of leaving, including history traversals a page cannot veto, so the draft must not live in the component: leaving
// never loses it, and entering the edit route of the record restores it. In memory only — the tab's lifetime is the right
// scope for content that may be sensitive; nothing is written to web storage.
//
// A draft ends only by a confirmed save of it, an explicit discard, reverting every change, the end of the signed-in identity
// that wrote it, or a reload. Each draft is bound to that identity (its owner): only the same signed-in user sees it, and
// observing anyone else, or nobody (signed out), ends it.
//
// Bound: there is at most one draft per record, each holds two copies of one document (the edit and what it started
// from), and only a person's edits create one — editing a record and leaving it unsaved. Growth is therefore linear in
// what the reader typed in this tab, the same as the editors themselves; a cap would have to drop a draft, which is the
// loss this store exists to prevent.
import { api } from "./api.ts";
import type { Draft } from "./edit-draft.ts";

/** Everything needed to restore the editor: the edit in its current mode and what it was started from. */
export interface StoredDraft {
  /** The revision's own draft the edit started from: what "changed" is measured against. */
  readonly base: Draft;
  /** The edit: typed rows or raw JSON text (`fields.view`), whichever was active. */
  readonly draft: Draft;
  /** The revision the edit was started from: the draft still saves with this expected revision. */
  readonly baseRevision: number;
  /** Highest row id in use, so ids of rows added after restoring stay unique. */
  readonly lastId: number;
}

/** A draft as kept: whose it is, and where it stands in its line of edits. */
export interface KeptDraft extends StoredDraft {
  /** The signed-in user who wrote it. */
  readonly owner: string;
  /** The line of edits it belongs to: started by an editor that restored nothing, continued by every editor that restores it. */
  readonly lineage: number;
  /** Advances with every new edit (another `draft`) of the lineage. */
  readonly generation: number;
}

/** The save of a lineage's generation, confirmed: `draft` is stored as `revision`; `kept` when later edits of the lineage remain. */
export interface Confirmation {
  readonly key: string;
  readonly lineage: number;
  readonly draft: Draft;
  readonly revision: number;
  readonly kept: boolean;
}

/** The editor's write of one generation, until its outcome is confirmed. */
interface Submission {
  readonly key: string;
  readonly lineage: number;
  readonly generation: number;
  readonly requestId: string;
  readonly draft: Draft;
}

export class DraftStore {
  private readonly drafts = new Map<string, KeptDraft>();
  private readonly listeners = new Set<() => void>();
  private readonly confirmations = new Set<(confirmation: Confirmation) => void>();
  /** The signed-in user last observed; null before the first observation and once signed out. */
  private owner: string | null = null;
  /**
   * The editor's latest write. The write lane admits one write at a time and a new one only after the previous one's
   * outcome is settled (pending-write.ts), so no earlier write can still be confirmed.
   */
  private submission: Submission | null = null;
  private lineages = 0;
  private generations = 0;

  /** The draft of `key`, if the signed-in user wrote it. */
  get = (key: string): KeptDraft | undefined => {
    const kept = this.drafts.get(key);
    return kept !== undefined && kept.owner === this.owner ? kept : undefined;
  };
  /** A new line of edits, for an editor that restores no draft. */
  lineage(): number { return ++this.lineages; }
  /** Writes the draft of `key` through for the signed-in user; returns its generation. */
  put(key: string, lineage: number, stored: StoredDraft): number {
    const owner = this.owner;
    if (owner === null) throw new Error("A draft is written only while a signed-in user is known");
    const kept = this.drafts.get(key);
    const generation = kept !== undefined && kept.lineage === lineage && kept.draft === stored.draft ? kept.generation : ++this.generations;
    this.drafts.set(key, { ...stored, owner, lineage, generation });
    this.publish();
    return generation;
  }
  /** Ends the draft of `key`: an explicit discard, or every change reverted. */
  drop(key: string): void { if (this.drafts.delete(key)) this.publish(); }
  /** Writes `stored` through and records that it is being saved as `requestId`; its confirmation reconciles it (`confirmed`). */
  submit(key: string, lineage: number, requestId: string, stored: StoredDraft): void {
    const generation = this.put(key, lineage, stored);
    this.submission = { key, lineage, generation, requestId, draft: stored.draft };
  }
  /**
   * The write `requestId` was confirmed as `revision`, however it was confirmed (its own answer or a replay). The generation
   * it sent ends. A later generation of the same lineage (edits made after submitting) stays, now based on what was saved —
   * the submitted draft as revision `revision` — so it saves on top of the reader's own write instead of conflicting with it.
   * Another lineage of the record (started after the submitted one was discarded) is not the saved one's and is untouched.
   */
  confirmed(requestId: string, revision: number): void {
    const submission = this.submission;
    if (submission === null || submission.requestId !== requestId) return;
    this.submission = null;
    const { key, lineage, generation, draft } = submission;
    const kept = this.drafts.get(key);
    const same = kept !== undefined && kept.lineage === lineage;
    const later = same && kept.generation > generation;
    if (later) this.drafts.set(key, { ...kept, base: draft, baseRevision: revision });
    else if (same) this.drafts.delete(key);
    if (same) this.publish();
    for (const listener of this.confirmations) listener({ key, lineage, draft, revision, kept: later });
  }
  /** The signed-in user as observed. Anyone else, or nobody (signed out), ends every draft: they are all the previous user's. */
  observeOwner(owner: string | null): void {
    if (owner === this.owner) return;
    this.owner = owner;
    this.submission = null;
    this.drafts.clear();
    this.publish();
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeConfirmed = (listener: (confirmation: Confirmation) => void): (() => void) => {
    this.confirmations.add(listener); return () => { this.confirmations.delete(listener); };
  };
  private publish(): void { for (const listener of this.listeners) listener(); }
}

const OUTLET = "[data-account-outlet]";
const USER_ATTRIBUTE = "data-account-user-id";
const SIGNED_OUT = "[data-account-auth], form[data-account-login]";

/**
 * Tells `store` the signed-in user, as the shell publishes it for the shared account module (its host contract): the
 * outlet's `data-account-user-id` while signed in, the sign-in mount while signed out. The shell publishes a user only
 * after the server confirmed it, so a routine `account:invalidate`, after which the same user is confirmed again, changes
 * nothing. A page with neither (loading, server unreachable) tells nothing.
 */
export function observeOwner(store: DraftStore, root: Document): () => void {
  const read = () => {
    const outlet = root.querySelector(OUTLET);
    if (outlet !== null) {
      const owner = outlet.getAttribute(USER_ATTRIBUTE);
      if (owner === null) throw new Error(`${OUTLET} requires ${USER_ATTRIBUTE}`);
      store.observeOwner(owner);
    } else if (root.querySelector(SIGNED_OUT) !== null) store.observeOwner(null);
  };
  const observer = new MutationObserver(read);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: [USER_ATTRIBUTE] });
  read();
  return () => observer.disconnect();
}

/** The page's drafts. */
export const drafts = new DraftStore();
api.subscribeConfirmedWrite((operation, result) => drafts.confirmed(operation.requestId, result.revision));
// Markup checks render server-side, without a document.
if (typeof document !== "undefined") observeOwner(drafts, document);
