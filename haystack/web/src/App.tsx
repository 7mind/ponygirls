import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, AuthError, type Principal } from "./api";
import { Login } from "./Login";
import { Browse } from "./Browse";
import { browseHash, DEFAULT_SORT, PRESETS } from "./browse-state";
import { RecordPage } from "./Record";
import { Retrieve } from "./Retrieve";
import { LiveProvider, useLiveUpdates } from "./Live";
import { Masthead, SignedOutMasthead, type Identity, type NavState } from "./Masthead";
import { adoptItem, closeEdit, isAccountHash, leaveItem, originOf, parseRoute, pushEdit, pushItem, type Origin, type Route } from "./router";

type ListRoute = Extract<Route, { name: "list" }>;
type SearchRoute = Extract<Route, { name: "search" }>;
/** Where the reader was in a list when it was hidden: restored when its route is shown again. */
interface Position { scrollY: number; focus: Element | null }
/**
 * A mounted list (one Browse instance per preset) and the route it shows. Lists stay mounted, hidden, while another
 * list, a record or the account page is shown, so that returning to a list route keeps its query draft, loaded rows,
 * scroll and focus (spec §5 rule 2); routes of the same preset that the list showed before are kept by the list.
 */
interface ListEntry { id: number; route: ListRoute; position: Position | null }
/** The one Search view, retained like a list; it shows every search route itself. */
interface SearchEntry { route: SearchRoute; position: Position | null }
interface View { route: Route; lists: readonly ListEntry[]; shown: number | null; search: SearchEntry | null }
/** What the next layout pass does with the document scroll. */
type ScrollAction = { kind: "restore"; position: Position } | { kind: "top" } | null;

const INBOX_COUNT_LIMIT = 100;
const ACCOUNT_PROFILE_PATH = "/api/account/v1/profile";

function routeKey(route: Route): string {
  return route.name === "item" ? `item:${route.key}:${route.edit}:${route.origin}` : `${route.name}:${route.hash}`;
}

/** Reads the current non-account route; legacy URL filters are rewritten to their canonical expression. */
function currentRoute(): Route {
  const route = parseRoute(location.hash, history.state);
  if (route.name !== "list") return route;
  const start = route.hash.indexOf("?");
  const params = new URLSearchParams(start === -1 ? "" : route.hash.slice(start + 1));
  if (route.state.migrationError !== null || !["project", "tag", "archive"].some((field) => params.has(field))) return route;
  const hash = browseHash(route.state, route.preset);
  history.replaceState(history.state, "", hash);
  return { ...route, hash };
}

const FIRST_LIST_ID = 0;
function initialView(): View {
  // A first load on an account fragment shows the account page above the default list.
  const route = isAccountHash(location.hash) ? parseRoute("", null) : currentRoute();
  if (route.name === "list") return { route, lists: [{ id: FIRST_LIST_ID, route, position: null }], shown: FIRST_LIST_ID, search: null };
  return { route, lists: [], shown: null, search: route.name === "search" ? { route, position: null } : null };
}

/** The view after navigating to `route`, and what to do with the scroll; `position` is where the shown list was. */
function navigate(previous: View, route: Route, position: Position, nextId: () => number): { view: View; scroll: ScrollAction } {
  const leaving = previous.route.name === "list" ? previous.lists.find((entry) => entry.id === previous.shown) : undefined;
  let lists = previous.lists.map((entry) => (leaving !== undefined && entry.id === leaving.id ? { ...entry, position } : entry));
  const search = previous.route.name === "search" && previous.search !== null ? { ...previous.search, position } : previous.search;
  if (route.name === "item") return { view: { route, lists, shown: previous.shown, search }, scroll: { kind: "top" } };
  if (route.name === "search") {
    // Another search from the Search view starts at the top by itself; returning to the route it showed restores the reader's place.
    const scroll: ScrollAction = previous.route.name === "search" ? null
      : search !== null && search.route.hash === route.hash && search.position !== null ? { kind: "restore", position: search.position } : { kind: "top" };
    return { view: { route, lists, shown: previous.shown, search: { route, position: null } }, scroll };
  }
  // One list per preset. It keeps every route it showed (Browse's kept routes), so another query or sort of
  // the same preset is shown by that list, which restores the route if it showed it before.
  const same = lists.find((entry) => entry.route.preset === route.preset);
  let target: ListEntry;
  let scroll: ScrollAction;
  if (same === undefined) {
    target = { id: nextId(), route, position: null };
    scroll = { kind: "top" };
  } else if (leaving !== undefined && same.id === leaving.id) {
    target = { ...same, route, position: null };
    scroll = null;
  } else if (same.route.hash === route.hash) {
    target = { ...same, route, position: null };
    scroll = same.position === null ? { kind: "top" } : { kind: "restore", position: same.position };
  } else {
    target = { ...same, route, position: null };
    scroll = { kind: "top" };
  }
  lists = same === undefined ? [...lists, target] : lists.map((entry) => (entry.id === target.id ? target : entry));
  return { view: { route, lists, shown: target.id, search }, scroll };
}

// Users is offered to administrators only; servers without GET /profile (404) have no administrators to offer it to.
async function readAdmin(userId: string): Promise<boolean> {
  let response: Response;
  try { response = await fetch(ACCOUNT_PROFILE_PATH, { headers: { Accept: "application/json" } }); } catch { return false; }
  if (!response.ok) return false;
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null) return false;
  const { admin, user } = body as { admin?: unknown; user?: unknown };
  return admin === true && typeof user === "object" && user !== null && (user as { id?: unknown }).id === userId;
}

export function App() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [admin, setAdmin] = useState(false);
  const [boot, setBoot] = useState<"loading" | "login" | "ready" | "unreachable">("loading");
  const [notice, setNotice] = useState("");
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++refreshSequence.current;
    try {
      const who = await api.whoami(() => request === refreshSequence.current);
      if (request !== refreshSequence.current) return;
      // In-memory identity only; clear stale UI state on identity change.
      setPrincipal((prev) => {
        if (prev !== null && (prev.userId !== who.userId || prev.tokenId !== who.tokenId)) {
          document.dispatchEvent(new Event("account:invalidate"));
          setNotice("Signed-in identity changed — views reloaded.");
        }
        return who;
      });
      setBoot("ready");
    } catch (err) {
      if (request !== refreshSequence.current) return;
      if (err instanceof AuthError) {
        document.dispatchEvent(new Event("account:invalidate"));
        setPrincipal(null);
        setBoot("login");
      } else {
        setBoot("unreachable");
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    // The shared account module signs out and reports account changes; Haystack revalidates its identity.
    const onAccountChanged = () => { void refresh(); };
    document.addEventListener("account:changed", onAccountChanged);
    return () => document.removeEventListener("account:changed", onAccountChanged);
  }, [refresh]);

  const userId = principal === null ? null : principal.userId;
  useEffect(() => {
    setAdmin(false);
    if (userId === null) return;
    let current = true;
    void readAdmin(userId).then((value) => { if (current) setAdmin(value); });
    return () => { current = false; };
  }, [userId]);

  // Stable identity: RecordPage's data effect depends on this. An inline closure
  // would remount item data (and wipe save outcomes) on every App render.
  const handleAuthLost = useCallback(() => {
    refreshSequence.current++;
    document.dispatchEvent(new Event("account:invalidate"));
    api.clearSessionWrites();
    setPrincipal(null);
    setBoot("login");
  }, []);

  if (boot === "loading") return <><SignedOutMasthead /><main id="main" className="auth-page"><p role="status">Loading…</p></main></>;
  if (boot === "unreachable") {
    return <><SignedOutMasthead /><main id="main" className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Server unreachable</h1>
        <p role="alert" className="notice notice-danger">Server unreachable — the service may be down. This is a connection failure, not an authentication failure.</p>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => void refresh()}>Retry</button>
      </div>
    </main></>;
  }
  if (boot === "login" || principal === null) return <Login />;

  return (
    <LiveProvider key={`${principal.userId}:${principal.tokenId}`} onAuthLost={handleAuthLost}>
      <Workspace identity={{ userId: principal.userId, type: principal.type, activityProjectId: principal.activityProjectId, admin }}
        notice={notice} onAuthLost={handleAuthLost} />
    </LiveProvider>
  );
}

/** Number of records awaiting review, bounded by one search page (no backend totals; spec §9 decision 5). */
function useInboxCount(onAuthLost: () => void): NavState["inbox"] {
  const live = useLiveUpdates();
  const [count, setCount] = useState<NavState["inbox"]>(null);
  const running = useRef(false);
  const again = useRef(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do {
        again.current = false;
        try {
          const page = await api.search(PRESETS.inbox.query, { limit: INBOX_COUNT_LIMIT, sort: DEFAULT_SORT });
          if (alive.current) setCount({ count: page.items.length, more: page.cursor !== undefined });
        } catch (error) {
          if (!alive.current) return;
          if (error instanceof AuthError) { onAuthLost(); return; }
          setCount(null);
        }
      } while (again.current && alive.current);
    } finally { running.current = false; }
  }, [onAuthLost]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  // The count was just loaded: the resync of the first connection does not reload it; later ones and changes do.
  useEffect(() => { if (live.key !== null || live.version > 1) void load(); }, [live.version, live.key, load]);
  return count;
}

function Workspace({ identity, notice, onAuthLost }: { identity: Identity; notice: string; onAuthLost: () => void }) {
  const [view, setView] = useState<View>(initialView);
  const current = useRef(view);
  current.current = view;
  const scroll = useRef<ScrollAction>(null);
  const lastId = useRef(FIRST_LIST_ID);
  const main = useRef<HTMLElement>(null);
  const inbox = useInboxCount(onAuthLost);
  // The account page covers <main>; while it is open no workspace entry is current. Registered in a layout
  // effect: the module shows a deep-linked account page as soon as the outlet is in the document.
  const [accountOpen, setAccountOpen] = useState(false);
  useLayoutEffect(() => {
    const onRoute = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "object" || event.detail === null || !("section" in event.detail))
        throw new Error("account:route requires detail.section");
      setAccountOpen(event.detail.section !== null);
    };
    document.addEventListener("account:route", onRoute);
    return () => document.removeEventListener("account:route", onRoute);
  }, []);

  const sync = useCallback(() => {
    if (isAccountHash(location.hash)) return;
    const previous = current.current;
    let route = currentRoute();
    if (route.name === "item" && !route.known) {
      const origin = previous.route.name === "item" ? previous.route.origin : previous.route.hash;
      adoptItem(origin);
      route = { ...route, origin, known: true };
    }
    if (routeKey(route) === routeKey(previous.route)) return;
    const focus = document.activeElement;
    const shownView = previous.route.name === "search" ? "[data-search-entry]" : previous.shown === null ? null : `[data-list-entry="${previous.shown}"]`;
    const inShownView = focus !== null && shownView !== null && focus.closest(shownView) !== null;
    const next = navigate(previous, route, { scrollY: window.scrollY, focus: inShownView ? focus : null }, () => ++lastId.current);
    scroll.current = next.scroll;
    setView(next.view);
  }, []);

  useEffect(() => {
    history.scrollRestoration = "manual";
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [sync]);

  // Lists are full-bleed on the surface; document-like record and edit pages sit on the canvas (spec §2.2 Layout).
  const onCanvas = view.route.name === "item";
  useLayoutEffect(() => {
    document.body.classList.toggle("on-canvas", onCanvas);
    return () => document.body.classList.remove("on-canvas");
  }, [onCanvas]);

  useLayoutEffect(() => {
    const action = scroll.current;
    scroll.current = null;
    if (action === null) return;
    if (action.kind === "top") { window.scrollTo(0, 0); return; }
    window.scrollTo(0, action.position.scrollY);
    const focus = action.position.focus;
    if (focus instanceof HTMLElement && focus.isConnected) focus.focus({ preventScroll: true });
  }, [view]);

  const route = view.route;
  const active: Origin | null = accountOpen ? null : route.name === "list" ? route.preset : route.name === "search" ? "search" : originOf(route.origin);
  const openItem = useCallback((key: string) => { pushItem(key, location.hash); sync(); }, [sync]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); main.current!.focus(); }}>Skip to main content</a>
      <Masthead identity={identity} nav={{ active, inbox }} />
      <main ref={main} id="main" className="workspace" tabIndex={-1} data-view={route.name === "item" ? route.edit ? "edit" : "record" : route.name}>
        <PendingWriteNotice />
        {notice !== "" && <p role="status" className="notice">{notice}</p>}
        {view.lists.map((entry) => <div key={entry.id} hidden={route.name !== "list" || entry.id !== view.shown} data-list={entry.route.preset} data-list-entry={entry.id}>
          <Browse preset={entry.route.preset} initial={entry.route.state} userId={identity.userId} activityProjectId={identity.activityProjectId}
            onOpen={openItem} onAuthLost={onAuthLost} />
        </div>)}
        {view.search !== null && <div hidden={route.name !== "search"} data-search-entry="">
          <Retrieve initial={view.search.route.state} onOpen={openItem} onAuthLost={onAuthLost} />
        </div>}
        {route.name === "item" && <RecordPage key={route.key} itemKey={route.key} edit={route.edit} origin={originOf(route.origin)} onAuthLost={onAuthLost}
          onBack={leaveItem}
          onEdit={() => { pushEdit(route.key); sync(); }}
          onEditDone={() => { if (closeEdit(route.key) === "replaced") sync(); }} />}
      </main>
      <div data-account-outlet="" data-account-user-id={identity.userId} hidden />
    </div>
  );
}

function PendingWriteNotice() {
  const pending = useSyncExternalStore(api.subscribePendingWrite, api.pendingWrite);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
  const retry = async () => {
    setBusy(true); setOutcome("");
    try {
      const result = await api.retryPendingWrite();
      setOutcome(`Original write confirmed as revision ${result.revision}. Any newer draft is preserved; review it before saving.`);
    } catch (error) { setOutcome(`Replay did not complete: ${error instanceof Error ? error.message : "unknown"}`); }
    finally { setBusy(false); }
  };
  if (!pending && outcome === "") return null;
  return <div className={pending ? "notice notice-warn" : "notice"} role="status"><div>
    {pending && <><p>A write to <span className="mono">{pending.key}</span> is pending or uncertain. Retry sends the original frozen payload and request ID. Different writes are blocked until it is reconciled.</p>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void retry()}>Retry original write</button></>}
    {outcome !== "" && <p>{outcome}</p>}
  </div></div>;
}
