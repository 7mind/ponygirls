import { useEffect, useRef } from "react";

const ROUTE_PREFIX = "#/";
const PRIMARY_BUTTON = 0;

/**
 * Guards leaving an edit page (spec §5 rule 7). While `unsaved`, a click on an in-app route link (`#/…`; a new tab
 * and the account fragments are left alone) is handed to `onNavigate` instead of navigating, so the page can ask
 * first. While `unsaved` or `unconfirmed` (a write whose outcome is unknown), closing or reloading the tab asks the
 * browser to confirm.
 */
export function useLeaveGuard(unsaved: boolean, unconfirmed: boolean, onNavigate: (hash: string) => void): void {
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
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
}
