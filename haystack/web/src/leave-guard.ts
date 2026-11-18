import { useCallback, useEffect, useRef } from "react";

const ROUTE_PREFIX = "#/";
const PRIMARY_BUTTON = 0;
const ONE_ENTRY_BACK = -1;

/** What the page does to keep its own history entry in order around the guard. */
export interface LeaveGuard {
  /**
   * Called before every way out of the editor (confirmed or not): lets the confirmed history traversal through and
   * removes the guard's history entry if there is one, so the router's entry arithmetic (`history.back()` to the record,
   * `history.go(-n)` to the list) is as if the guard had never existed. Resolves when that is done.
   */
  release(): Promise<void>;
}

interface NavigateEvent extends Event { readonly navigationType: string; readonly destination: { readonly index: number } }
interface NavigationApi {
  readonly currentEntry: { readonly index: number } | null;
  addEventListener(type: "navigate", listener: (event: NavigateEvent) => void): void;
  removeEventListener(type: "navigate", listener: (event: NavigateEvent) => void): void;
}
/** The Navigation API (Chromium, Safari 26.2+); null in browsers without it. */
function navigationApi(): NavigationApi | null {
  return (window as unknown as { navigation?: NavigationApi }).navigation ?? null;
}

/**
 * Guards leaving an edit page (spec §5 rule 7), in three places.
 * - In-app links: while `unsaved`, a click on a route link (`#/…`; a new tab and the account fragments are left alone) is
 *   handed to `onNavigate` instead of navigating.
 * - Browser history. The first unsaved change pushes one history entry of the same URL (the guard entry) on top of the
 *   editor's own. Back pops only that entry, which does not change the route, so the router does not move and the editor
 *   stays mounted; the entry is pushed again at once and `onTraverse(steps)` asks the reader. Repeated Back, with the
 *   dialog open or not, only pops and re-pushes it: the reader is never moved before deciding. Leaving for good is
 *   `history.go(steps)` from the editor's own entry (the guard entry is released first).
 *   A traversal of several entries (the history menu, `history.go(-n)`) would land on another route; with the Navigation
 *   API it is cancelled before the route changes and asked about the same way. The browser decides whether a page may
 *   cancel a traversal (it requires user activation and refuses repeated cancellations without it): a traversal it
 *   refuses to let the page hold reaches the router and cannot be stopped. Without the API (Firefox) several-entry
 *   traversals are not guarded.
 * - Closing the tab: while `unsaved` or `unconfirmed` (a write whose outcome is unknown), the browser confirms.
 * A pristine editor passes traversals straight through.
 */
export function useLeaveGuard(unsaved: boolean, unconfirmed: boolean, onNavigate: (hash: string) => void, onTraverse: (steps: number) => void): LeaveGuard {
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const traverse = useRef(onTraverse);
  traverse.current = onTraverse;
  const isUnsaved = useRef(unsaved);
  isUnsaved.current = unsaved;
  /** The reader confirmed leaving: the traversal that follows is not held. */
  const allowed = useRef(false);
  /** A guard entry sits above the editor's own entry. */
  const armed = useRef(false);
  const editHash = useRef("");
  /** Set while `release` waits for the traversal that removes the guard entry. */
  const released = useRef<(() => void) | null>(null);

  useEffect(() => {
    const api = navigationApi();
    if (!unsaved || api === null) return;
    const onNavigateEvent = (event: NavigateEvent) => {
      if (event.navigationType !== "traverse" || allowed.current || !event.cancelable) return;
      const current = api.currentEntry!.index;
      // One entry back from the guard entry is the editor's own entry: the history entry logic below handles it.
      if (event.destination.index >= current - 1) return;
      event.preventDefault();
      traverse.current(event.destination.index - (current - (armed.current ? 1 : 0)));
    };
    api.addEventListener("navigate", onNavigateEvent);
    return () => api.removeEventListener("navigate", onNavigateEvent);
  }, [unsaved]);

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
      if (isUnsaved.current) { arm(); traverse.current(ONE_ENTRY_BACK); }
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
    allowed.current = true;
    if (!armed.current) { resolve(); return; }
    released.current = resolve;
    history.back();
  }), []);
  return { release };
}
