import { useCallback, useEffect, useRef } from "react";

const ROUTE_PREFIX = "#/";
const PRIMARY_BUTTON = 0;

/** What the page does to keep its own history entry in order around the guard. */
export interface LeaveGuard {
  /**
   * Removes the guard's history entry. Every way out of the editor (confirmed or not) runs through it before the router
   * moves, so the router's entry arithmetic (`history.back()` to the record, `history.go(-n)` to the list) is as if the
   * guard had never existed. Resolves at once when there is no entry.
   */
  release(): Promise<void>;
  /** After the reader chose to stay in the editor on a history traversal: puts the guard's entry back. */
  rearm(): void;
}

/**
 * Guards leaving an edit page (spec §5 rule 7), in three places.
 * - In-app links: while `unsaved`, a click on a route link (`#/…`; a new tab and the account fragments are left alone) is
 *   handed to `onNavigate` instead of navigating.
 * - Browser Back: the first unsaved change pushes one history entry of the same URL on top of the editor's own. Back then
 *   only pops that entry (the route does not change, so the router does not move and the editor stays mounted) and
 *   `onTraverse` asks the reader; leaving for good is `history.back()` again. A pristine editor with that entry left
 *   over passes Back straight through. Forward cannot reach the entry again once the reader stayed, because pushing
 *   drops the forward entries. A traversal of several entries at once (the history menu) skips the guard.
 * - Closing the tab: while `unsaved` or `unconfirmed` (a write whose outcome is unknown), the browser confirms.
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
  /** Set while `release` waits for the traversal it started. */
  const released = useRef<(() => void) | null>(null);

  const arm = useCallback(() => {
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
      armed.current = false;
      if (isUnsaved.current) traverse.current(); else history.back();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
