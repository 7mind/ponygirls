import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, AuthError, NetworkError, type Principal } from "./api";
import { Login } from "./Login";
import { Browse } from "./Browse";
import { browseHash, DEFAULT_SORT, PRESETS, type Preset } from "./browse-state";
import { Detail } from "./Detail";
import { LiveProvider, useLiveUpdates } from "./Live";
import { Masthead, SignedOutMasthead, type Identity, type NavState, type SignOut } from "./Masthead";
import { adoptItem, closeEdit, isAccountHash, leaveItem, parseRoute, presetOf, pushEdit, pushItem, type Route } from "./router";

type ListRoute = Extract<Route, { name: "list" }>;
/** The current route and the last list route: the list stays mounted (hidden) while a record is open. */
interface View { route: Route; list: ListRoute | null }
interface SavedList { hash: string; scrollY: number; focus: Element | null }

const INBOX_COUNT_LIMIT = 100;
const ACCOUNT_PROFILE_PATH = "/api/account/v1/profile";

function routeKey(route: Route): string {
  return route.name === "list" ? `list:${route.hash}` : `item:${route.key}:${route.edit}:${route.origin}`;
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

function initialView(): View {
  // A first load on an account fragment shows the account page above the default list.
  const route = isAccountHash(location.hash) ? parseRoute("", null) : currentRoute();
  return { route, list: route.name === "list" ? route : null };
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

  // Stable identity: Detail's data effect depends on this. An inline closure
  // would remount item data (and wipe save outcomes) on every App render.
  const handleAuthLost = useCallback(() => {
    refreshSequence.current++;
    document.dispatchEvent(new Event("account:invalidate"));
    api.clearSessionWrites();
    setPrincipal(null);
    setBoot("login");
  }, []);

  // Insecure contexts (private-network HTTP origins) send neither Origin nor Sec-Fetch-Site on GET, so the account
  // plane rejects the module's sign-out preflight read; there Haystack signs out through its own endpoint and
  // tells the module (contract: account:invalidate with reason signed-out).
  const hostSignOut = async () => {
    try {
      await api.logout();
    } catch (error) {
      if (!(error instanceof AuthError)) {
        setNotice(error instanceof NetworkError ? "Server unreachable — Sign out did not complete. Your session is unchanged." : "Sign out did not complete.");
        return;
      }
    }
    refreshSequence.current++;
    document.dispatchEvent(new CustomEvent("account:invalidate", { detail: { reason: "signed-out" } }));
    setPrincipal(null);
    setBoot("login");
  };
  const signOut: SignOut = window.isSecureContext ? { owner: "module" } : { owner: "host", run: () => void hostSignOut() };

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
        signOut={signOut} notice={notice} onAuthLost={handleAuthLost} />
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

function Workspace({ identity, signOut, notice, onAuthLost }: { identity: Identity; signOut: SignOut; notice: string; onAuthLost: () => void }) {
  const [view, setView] = useState<View>(initialView);
  const current = useRef(view);
  current.current = view;
  const saved = useRef<SavedList | null>(null);
  const shown = useRef<Route["name"]>(view.route.name);
  const list = useRef<HTMLDivElement>(null);
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
      const origin = previous.route.name === "list" ? previous.route.hash : previous.route.origin;
      adoptItem(origin);
      route = { ...route, origin, known: true };
    }
    if (routeKey(route) === routeKey(previous.route)) return;
    if (previous.route.name === "list" && route.name === "item" && previous.list !== null) {
      const focus = document.activeElement;
      saved.current = { hash: previous.list.hash, scrollY: window.scrollY, focus: focus !== null && list.current !== null && list.current.contains(focus) ? focus : null };
    }
    setView({ route, list: route.name === "list" ? route : previous.list });
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
    const route = view.route;
    const previous = shown.current;
    shown.current = route.name;
    if (route.name === "item") { window.scrollTo(0, 0); return; }
    const restore = saved.current;
    saved.current = null;
    if (previous !== "item" || restore === null || restore.hash !== route.hash) return;
    window.scrollTo(0, restore.scrollY);
    if (restore.focus instanceof HTMLElement && restore.focus.isConnected) restore.focus.focus({ preventScroll: true });
  }, [view.route]);

  const route = view.route;
  const active: Preset | null = accountOpen ? null : route.name === "list" ? route.preset : presetOf(route.origin);
  const openItem = useCallback((key: string) => { pushItem(key, location.hash); sync(); }, [sync]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); main.current!.focus(); }}>Skip to main content</a>
      <Masthead identity={identity} signOut={signOut} nav={{ active, inbox }} />
      <main ref={main} id="main" className="workspace" tabIndex={-1} data-view={route.name === "list" ? "list" : route.edit ? "edit" : "record"}>
        <PendingWriteNotice />
        {notice !== "" && <p role="status" className="notice">{notice}</p>}
        {view.list !== null && <div ref={list} hidden={route.name !== "list"} data-list={view.list.preset}>
          <Browse key={view.list.preset} preset={view.list.preset} initial={view.list.state} onOpen={openItem} onAuthLost={onAuthLost} />
        </div>}
        {route.name === "item" && <Detail key={route.key} itemKey={route.key} edit={route.edit} onAuthLost={onAuthLost}
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
