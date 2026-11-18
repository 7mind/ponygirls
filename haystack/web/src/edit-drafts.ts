// Unsaved drafts of the record editor, kept outside the editor component (spec §5 rule 7). The router unmounts the editor on
// every way of leaving, including history traversals a page cannot veto, so the draft must not live in the component: leaving
// never loses it, and entering the edit route of the record restores it. In memory only — the tab's lifetime is the right
// scope for content that may be sensitive; nothing is written to web storage.
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

export class DraftStore {
  private readonly drafts = new Map<string, StoredDraft>();
  private readonly listeners = new Set<() => void>();
  get = (key: string): StoredDraft | undefined => this.drafts.get(key);
  put(key: string, draft: StoredDraft): void { this.drafts.set(key, draft); this.publish(); }
  /** Ends the draft of `key`: a confirmed save or an explicit discard. */
  drop(key: string): void { if (this.drafts.delete(key)) this.publish(); }
  /** Ends every draft: the signed-in identity ended. */
  clear(): void { if (this.drafts.size > 0) { this.drafts.clear(); this.publish(); } }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(): void { for (const listener of this.listeners) listener(); }
}

/**
 * Events after which a draft can no longer belong to whoever sees the page: the shared account module's `account:changed`
 * (signed out, or the account changed under the page) and the host's `account:invalidate` (authentication lost, identity changed).
 */
const IDENTITY_ENDED = ["account:changed", "account:invalidate"] as const;

/** Clears `store` whenever the signed-in identity ends; returns the unbinding. */
export function clearOnIdentityEnd(store: DraftStore, target: EventTarget): () => void {
  const clear = () => store.clear();
  for (const type of IDENTITY_ENDED) target.addEventListener(type, clear);
  return () => { for (const type of IDENTITY_ENDED) target.removeEventListener(type, clear); };
}

/** The page's drafts. */
export const drafts = new DraftStore();
// Markup checks render server-side, without a document.
if (typeof document !== "undefined") clearOnIdentityEnd(drafts, document);
