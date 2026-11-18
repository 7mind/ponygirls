import { useCallback, useEffect, useRef } from "react";

const ROUTE_PREFIX = "#/";
const PRIMARY_BUTTON = 0;

/** What the page does to keep its own history entry in order around the guard. */
export interface LeaveGuard {
  /**
   * Called before every way out of the editor (confirmed or not): removes the guard's history entry if there is one, so
   * the router's entry arithmetic (`history.back()` to the record, `history.go(-n)` to the list) is as if the guard had
   * never existed. Resolves when that is done.
   */
  release(): Promise<void>;
  /** Puts the guard entry back after a release that did not lead out after all (unsaved changes appeared meanwhile). */
  rearm(): void;
}

/**
 * Asks before leaving an edit page, on the ways a page can intercept (spec §5 rule 7). It is a courtesy, not the safety:
 * the draft itself outlives the editor (edit-drafts.ts), so the ways it cannot intercept lose nothing.
 * - In-app links: while `unsaved`, a click on a route link (`#/…`; a new tab and the account fragments are left alone) is
 *   handed to `onNavigate` instead of navigating.
 * - Browser Back by one entry: the first unsaved change pushes one history entry of the same URL (the guard entry) on top
 *   of the editor's own. Back pops only that entry, which does not change the route, so the editor stays mounted; the entry
 *   is pushed again at once and `onTraverse` asks the reader. Leaving for good is `history.back()` from the editor's own
 *   entry (the guard entry is released first). A traversal of several entries lands on another route and is not held.
 * - Closing the tab: while `unsaved` or `unconfirmed` (a write whose outcome is unknown), the browser confirms.
 * A pristine editor passes traversals straight through.
 */
export function useLeaveGuard(unsaved: boolean, unconfirmed: boolean, onNavigate: (hash: string) => void, onTraverse: () => void): LeaveGuard {
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const traverse = useRef(onTraverse);
  traverse.current = onTraverse;
  const isUnsaved = useRef(unsaved);
  isUnsaved.current = unsaved;
  /** A guard entry sits above the editor's own entry. */
  const armed = useRef(false);
  const editHash = useRef("");
  /** Set while `release` waits for the traversal that removes the guard entry. */
  const released = useRef<(() => void) | null>(null);

  const arm = useCallback(() => {
    editHash.current = location.hash;
    history.pushState(history.state, "", location.href);
    armed.current = true;
  }, []);
  useEffect(() => { if (unsaved && !armed.current) arm(); }, [unsaved, arm]);
  useEffect(() => {
    const onPopState = () => {
      if (released.current !== null) {
        const done = released.current;
        released.current = null;
        armed.current = false;
        done();
        return;
      }
      if (!armed.current) return;
      if (location.hash !== editHash.current) { armed.current = false; return; }
      // One entry back: the guard entry was popped; put it back and ask (or let a pristine editor go on).
      if (isUnsaved.current) { arm(); traverse.current(); }
      else { armed.current = false; history.back(); }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [arm]);

  useEffect(() => {
    if (!unsaved) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== PRIMARY_BUTTON || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (anchor === null || (anchor.getAttribute("target") ?? "") !== "") return;
      const href = anchor.getAttribute("href")!;
      if (!href.startsWith(ROUTE_PREFIX) || href === location.hash) return;
      event.preventDefault();
      event.stopPropagation();
      navigate.current(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [unsaved]);

  const closing = unsaved || unconfirmed;
  useEffect(() => {
    if (!closing) return;
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [closing]);

  const release = useCallback(() => new Promise<void>((resolve) => {
    if (!armed.current) { resolve(); return; }
    released.current = resolve;
    history.back();
  }), []);
  const rearm = useCallback(() => { if (isUnsaved.current && !armed.current) arm(); }, [arm]);
  return { release, rearm };
}
