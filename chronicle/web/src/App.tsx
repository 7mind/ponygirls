import './styles.css';
import { Anchored, dismissPopoverOnExternalFocus } from './Popover.tsx';
import { memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ThemeControl } from './ThemeControl.tsx';
import type { ThemeController } from './theme.ts';
import { ActivityCollectorSort, ActivityQuery, ArchiveSort, ArchiveSort_values, Operation_Activity, Operation_Whoami, Result_Activity, Result_Whoami, Scope, SortDirection, type ActivityResult, type SessionInfo, type UserInfo } from './api.ts';
import type { ChronicleConnection } from './client.ts';
import { read } from './client.ts';
import { useConnection, useResource } from './hooks.ts';
import { useSessionRenewal } from './use-session-renewal.ts';
import { ConnectionHealth } from './ConnectionHealth.tsx';
import { Search } from './Search.tsx';
import { Archive, emptyArchive } from './Archive.tsx';
import type { ArchiveState } from './Archive.tsx';
import { Dialog } from './Dialog.tsx';
import { Conversation } from './Conversation.tsx';
import { Icon } from './Icon.tsx';
import { DEFAULT_ROUTE, HashRouter, RouteParams, RouteStateCache, RouteStateContext, formatRoute, routeSlot, sessionIdOf, sessionRoute, useRouteState, useRouteSync, useRouter, viewRoute, viewRouteWith, type Route, type View } from './router.ts';
import type { ManagerStats } from './transport/types.ts';
import { ArchiveReadLane } from './archive-requests.ts';
import { SessionFindReadGate } from './session-find.ts';
import { ReindexProgress, useRebuildProgress } from './ReindexProgress.tsx';
import { Access } from './Access.tsx';
import { McpTester, useMcpTester } from './McpTester.tsx';
import { Activity } from './activity/Activity.tsx';
import { retainedActivityRoute } from './activity/state.ts';
import { useMutations } from './mutations.ts';
import { MutationNotice } from './MutationNotice.tsx';
export function ErrorNotice({ children }: { children: React.ReactNode }) { return <div className="notice error" role="alert">{children}</div>; }
export function Blank({ title, children }: { title: string; children: React.ReactNode }) { return <div className="blank"><span className="blank-icon" aria-hidden="true">⌁</span><h2>{title}</h2><p>{children}</p></div>; }
export function Tags({ tags }: { tags: readonly string[] }) { return <span className="tags">{tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}</span>; }
export function formatDate(value: string | undefined): string { if (!value) return 'date unavailable'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
export function SessionMeta({ session }: { session: SessionInfo }) { return <span className="meta"><span>{session.source.format}</span><span>{session.metadata.project ?? 'No project'}</span><span>{formatDate(session.metadata.startedAt)}</span></span>; }
type NavView = Exclude<View, 'session'>;
const NAV_ITEMS: readonly { readonly view: NavView; readonly label: string }[] = [
  { view: 'archive', label: 'Archive' }, { view: 'search', label: 'Search' }, { view: 'activity', label: 'Activity' }, { view: 'access', label: 'Access' }, { view: 'mcp', label: 'MCP' },
];
// Document-like views sit on the canvas; list views are full-bleed on the surface (spec §2.2 Layout).
const CANVAS_VIEWS: readonly View[] = ['access', 'mcp'];
// The brand links to the default route (router DEFAULT_ROUTE) with its retained parameters.
const HOME_VIEW: NavView = 'search';
const MAIN_CONTENT_ID = 'main-content';
const ARCHIVE_STATE = routeSlot<ArchiveState>('archive', emptyArchive);
const ARCHIVE_DRAFT = routeSlot<string>('archive-draft', () => '');
const ARCHIVE_INSTANCE = 'archive';
const SEARCH_SUBMITTED = routeSlot<string | null>('search', () => null);
const SEARCH_DRAFT = routeSlot<string>('search-draft', () => '');
const SEARCH_INSTANCE = 'search';
// Combobox focused by Ctrl/⌘ K in each view that has one (the views register the same shortcut; see App).
const SHORTCUT_TARGETS: Readonly<Partial<Record<NavView, string>>> = { archive: 'Search conversations', search: 'Search conversations', activity: 'Search indexing job metadata' };
// One collector page is enough to see stale collectors next to the owner-wide failure and lease counts.
const ATTENTION_COLLECTOR_LIMIT = 50;
const ACCOUNT_PROFILE_URL = '/api/account/v1/profile';
interface OwnerScope { readonly owner: string | null; readonly cache: RouteStateCache }
function newOwnerScope(owner: string | null): OwnerScope { return { owner, cache: new RouteStateCache() }; }

function plural(count: bigint, noun: string): string { return `${count} ${noun}${count === 1n ? '' : 's'}`; }
/** The Activity nav dot: failed current jobs, expired leases or stale collectors (null: nothing needs attention). */
export function activityAttention(activity: ActivityResult): string | null {
  const stale = BigInt(activity.collectors.filter(collector => collector.status !== undefined && collector.status.stale).length);
  const parts = [[activity.current.failed, 'failed job'], [activity.current.expiredRunning, 'expired lease'], [stale, 'stale collector']] as const;
  const shown = parts.filter(([count]) => count > 0n).map(([count, noun]) => plural(count, noun));
  return shown.length === 0 ? null : `${shown.join(', ')} need attention`;
}
// Users is offered to administrators only; servers without GET /profile (404) have no administrators to offer it to.
function useAccountAdmin(userId: string | null): boolean {
  const [admin, setAdmin] = useState<{ userId: string; admin: boolean } | null>(null);
  useEffect(() => {
    if (userId === null) return;
    const controller = new AbortController();
    void window.fetch(ACCOUNT_PROFILE_URL, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal })
      .then(async response => response.ok ? await response.json() as unknown : null)
      .then(profile => {
        const value = profile !== null && typeof profile === 'object' ? profile as { user?: { id?: unknown }; admin?: unknown } : null;
        setAdmin({ userId, admin: value !== null && value.user !== undefined && value.user.id === userId && value.admin === true });
      }, () => { if (!controller.signal.aborted) setAdmin({ userId, admin: false }); });
    return () => controller.abort();
  }, [userId]);
  return admin !== null && admin.userId === userId && admin.admin;
}
function UserMenu({ user, admin }: { user: UserInfo; admin: boolean }) {
  return <Anchored className="user-menu" buttonClassName="user-button" buttonState={undefined} ariaLabel={user.login} describedBy={undefined} panel="menu" panelClassName="menu" panelLabel={undefined}
    label={<><span className="avatar" aria-hidden="true">{user.login.charAt(0)}</span><span className="user-name">{user.login}</span><Icon name="chevron-down" small={true}/></>}>
    <div className="menu-label">Signed in as <strong>{user.login}</strong>{admin ? ' · admin' : ''}</div>
    <button type="button" role="menuitem" className="menu-item" data-account-settings=""><Icon name="user" small={false}/>Account settings</button>
    <button type="button" role="menuitem" className="menu-item" data-account-settings="tokens"><Icon name="key" small={false}/>Access tokens</button>
    {admin && <button type="button" role="menuitem" className="menu-item" data-account-settings="users"><Icon name="users" small={false}/>Users</button>}
    <div className="menu-sep" role="separator"/>
    <button type="button" role="menuitem" className="menu-item" data-account-logout=""><Icon name="arrow-right" small={false}/>Sign out</button>
  </Anchored>;
}
// Route parameters of the list views (spec §5): the submitted query and order, never the draft.
const QUERY_PARAM = 'q', SORT_PARAM = 'sort', DIRECTION_PARAM = 'dir', RELEVANCE_PARAM = 'rel', RELEVANCE_OFF = '0';
function archiveParams(state: ArchiveState): RouteParams {
  const defaults = emptyArchive(), entries: [string, string][] = [];
  if (state.submitted !== '') entries.push([QUERY_PARAM, state.submitted]);
  if (state.sort !== defaults.sort) entries.push([SORT_PARAM, state.sort]);
  if (state.direction !== defaults.direction) entries.push([DIRECTION_PARAM, state.direction]);
  if (state.preferRelevance !== defaults.preferRelevance) entries.push([RELEVANCE_PARAM, RELEVANCE_OFF]);
  return new RouteParams(entries);
}
// Unknown or malformed values fall back to the defaults; the URL is then rewritten from the state.
function archiveFromParams(params: RouteParams): Pick<ArchiveState, 'submitted' | 'sort' | 'direction' | 'preferRelevance'> {
  const defaults = emptyArchive(), sort = params.get(SORT_PARAM), direction = params.get(DIRECTION_PARAM);
  return {
    submitted: params.get(QUERY_PARAM) ?? defaults.submitted,
    sort: ArchiveSort_values.find(value => value === sort) ?? defaults.sort,
    direction: direction === SortDirection.Asc || direction === SortDirection.Desc ? direction : defaults.direction,
    preferRelevance: params.get(RELEVANCE_PARAM) !== RELEVANCE_OFF,
  };
}
function searchParams(submitted: string | null): RouteParams { return new RouteParams(submitted === null || submitted === '' ? [] : [[QUERY_PARAM, submitted]]); }
// A hidden view keeps its state and its own subscriptions but is not re-rendered for the shell's updates (transport
// statistics, other routes) until it is shown again, so retained views add no rendering work.
const RetainedView = memo(function RetainedView({ render }: { active: boolean; render: () => ReactNode }) { return render(); }, (previous, next) => !previous.active && !next.active);
// In-app links carry a list view's retained submitted state, so following one never changes it; addresses that
// arrive otherwise (history, deep links, edits) are authoritative (useRouteSync).
function retainedRoute(view: NavView, cache: RouteStateCache): Route {
  switch (view) {
    case 'archive': return viewRouteWith('archive', archiveParams(cache.read(ARCHIVE_STATE, ARCHIVE_INSTANCE)));
    case 'search': return viewRouteWith('search', searchParams(cache.read(SEARCH_SUBMITTED, SEARCH_INSTANCE)));
    case 'activity': return retainedActivityRoute(cache);
    default: return viewRoute(view);
  }
}
function useRetainedHref(view: NavView): string {
  const cache = useContext(RouteStateContext);
  if (cache === null) throw new Error('useRetainedHref requires a RouteStateContext provider');
  return useSyncExternalStore(cache.subscribe, () => formatRoute(retainedRoute(view, cache)), () => formatRoute(retainedRoute(view, cache)));
}
function NavLink({ view, label, current, attention }: { view: NavView; label: string; current: boolean; attention: string | null }) {
  return <a href={useRetainedHref(view)} aria-current={current ? 'page' : undefined} title={attention ?? undefined}>{label}{attention !== null && <span className="nav-dot" title={attention} aria-hidden="true"/>}</a>;
}
function MainNavigation({ current, attention }: { current: NavView | null; attention: string | null }) {
  return <nav className="nav" aria-label="Main navigation">{NAV_ITEMS.map(item => <NavLink key={item.view} view={item.view} label={item.label} current={current === item.view} attention={item.view === 'activity' ? attention : null}/>)}</nav>;
}
function Brand() {
  return <a href={useRetainedHref(HOME_VIEW)} className="brand" aria-label="Chronicle home"><span className="brand-mark"><Icon name="book" small={false}/></span><span className="brand-name">chronicle</span></a>;
}
interface ViewRouting { readonly active: boolean; readonly route: Route; readonly router: HashRouter }
function ArchiveView({ routing, ...props }: { connection: ChronicleConnection; requests: ArchiveReadLane; findReads: SessionFindReadGate; stats: ManagerStats; user: UserInfo; routing: ViewRouting }) {
  const [archive, setArchive] = useRouteState(ARCHIVE_STATE, ARCHIVE_INSTANCE), [draft, setDraft] = useRouteState(ARCHIVE_DRAFT, ARCHIVE_INSTANCE);
  const fromUrl = archiveParams({ ...archive, ...archiveFromParams(routing.route.params) }).toString(), fromState = archiveParams(archive).toString();
  useRouteSync('archive', routing.active && routing.route.view === 'archive', fromUrl, fromState, () => {
    const applied = archiveFromParams(routing.route.params);
    props.requests.invalidate(); setArchive(value => ({ ...value, ...applied, selection: null })); setDraft(applied.submitted);
  }, () => routing.router.navigate(viewRouteWith('archive', archiveParams(archive)), 'replace'));
  return <Archive {...props} draft={draft} setDraft={setDraft} archive={archive} setArchive={setArchive}/>;
}
function SearchView({ routing, ...props }: { connection: ChronicleConnection; findReads: SessionFindReadGate; stats: ManagerStats; user: UserInfo; routing: ViewRouting }) {
  const [submitted, setSubmitted] = useRouteState(SEARCH_SUBMITTED, SEARCH_INSTANCE), [draft, setDraft] = useRouteState(SEARCH_DRAFT, SEARCH_INSTANCE);
  const query = routing.route.params.get(QUERY_PARAM);
  useRouteSync('search', routing.active, searchParams(query).toString(), searchParams(submitted).toString(), () => { setSubmitted(query); setDraft(query ?? ''); },
    () => routing.router.navigate(viewRouteWith('search', searchParams(submitted)), 'replace'));
  return <Search key={JSON.stringify([props.user.id, props.stats.generation, props.stats.activeId])} {...props} query={{ draft, setDraft, submitted, setSubmitted }}/>;
}
export function App({ connection, theme }: { connection: ChronicleConnection; theme: ThemeController }) {
  const stats = useConnection(connection);
  const router = useMemo(() => new HashRouter(window), []), location = useRouter(router), route = location.route;
  useEffect(() => router.start(), [router]);
  useLayoutEffect(() => router.rendered(), [router, location]);
  // Register transport lifecycle verification before renewal's return/focus listener.
  useEffect(() => { connection.start(); return () => connection.dispose(); }, [connection]);
  const archiveRequests = useMemo(() => new ArchiveReadLane(), [connection]);
  const findReads = useMemo(() => new SessionFindReadGate(), [connection]);
  useEffect(() => {
    const unsubscribe = connection.onInvalidate(() => { archiveRequests.invalidate(); document.dispatchEvent(new Event('account:invalidate')); });
    return () => { unsubscribe(); archiveRequests.invalidate(); };
  }, [connection, archiveRequests]);
  const [scope, setScope] = useState<OwnerScope>(() => newOwnerScope(null));
  // A new owner gets a new per-route cache; switching from one account to another also leaves its route.
  function resetOwner(owner: string | null) {
    archiveRequests.invalidate();
    if (scope.owner !== null && owner !== null) router.navigate(DEFAULT_ROUTE, 'replace');
    router.forgetRoutePositions();
    setScope(newOwnerScope(owner));
  }
  const identity = useResource(connection, stats, 'identity', '', true, () => read(connection, new Operation_Whoami(), r => r instanceof Result_Whoami ? r.user : null));
  useEffect(() => {
    // Expired or revoked credentials: the next sign-in starts at the default route like a new session.
    if (stats.terminal === 'unauthorized') { if (scope.owner !== null) { resetOwner(null); router.navigate(DEFAULT_ROUTE, 'replace'); } return; }
    if (identity.data !== null && identity.data.id !== scope.owner) resetOwner(identity.data.id);
  }, [identity.data?.id, scope.owner, stats.terminal]);
  const user = identity.data !== null && identity.data.id === scope.owner ? identity.data : null;
  const [logoutGeneration, setLogoutGeneration] = useState<number | null>(null);
  const renewal = useSessionRenewal(connection, stats, logoutGeneration === stats.generation ? null : user?.id ?? null);
  const tester = useMcpTester(connection, stats, user === null ? null : user.id, route.view === 'mcp');
  const actions = useMutations(connection, identity.data?.id ?? null);
  const canRead = user !== null && user.scopes.includes(Scope.Read);
  const rebuild = useRebuildProgress(connection, stats, user === null ? null : user.id, canRead, actions.ownerReindexed);
  const attention = useResource(connection, stats, `attention:${user === null ? '' : user.id}`, '', canRead, () => read(connection, new Operation_Activity(new ActivityQuery('', ActivityCollectorSort.CollectorId, SortDirection.Asc, undefined, ATTENTION_COLLECTOR_LIMIT)), r => r instanceof Result_Activity ? r.result : null));
  const attentionText = attention.data === null ? null : activityAttention(attention.data);
  const admin = useAccountAdmin(user === null ? null : user.id);
  // The account module signs out and reports another owner or a teardown; the identity is then read again.
  const renewalSuspend = renewal.suspend;
  useEffect(() => {
    const changed = () => { renewalSuspend(); setLogoutGeneration(stats.generation); resetOwner(null); router.navigate(DEFAULT_ROUTE, 'replace'); connection.retry(); };
    document.addEventListener('account:changed', changed);
    return () => document.removeEventListener('account:changed', changed);
  });
  // The account module reports its routed page (`account:route`); it covers the view, which stays mounted, and no
  // main navigation item is current meanwhile. Registered before the module can route the outlet of this commit.
  const [accountSection, setAccountSection] = useState<string | null>(null);
  useLayoutEffect(() => {
    const routed = (event: Event) => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : null;
      const section = detail !== null && typeof detail === 'object' && 'section' in detail ? detail.section : null;
      if (section !== null && typeof section !== 'string') throw new Error('account:route carries an invalid section');
      setAccountSection(section);
    };
    document.addEventListener('account:route', routed);
    return () => document.removeEventListener('account:route', routed);
  }, []);
  const accountShown = user !== null && accountSection !== null;
  const canvas = user === null || CANVAS_VIEWS.includes(route.view);
  useEffect(() => { document.body.classList.toggle('on-canvas', canvas); }, [canvas]);
  function skipToContent(event: React.MouseEvent) {
    event.preventDefault();
    const target = document.getElementById(MAIN_CONTENT_ID);
    if (target === null) throw new Error('Missing main content');
    target.focus();
  }
  const current: NavView = route.view === 'session' ? 'archive' : route.view;
  // Visited views stay mounted (hidden) for the owner, so their loaded lists, drafts, selection and scroll survive
  // tab switches and Back/Forward (spec §5 rule 2); a new owner starts with none.
  const [visited, setVisited] = useState<{ owner: string | null; views: ReadonlySet<NavView> }>({ owner: null, views: new Set() });
  const mounted = visited.owner === scope.owner && visited.views.has(current) ? visited.views : new Set([...(visited.owner === scope.owner ? visited.views : []), current]);
  useEffect(() => { if (mounted !== visited.views) setVisited({ owner: scope.owner, views: mounted }); });
  // A hidden view must not keep a modal open: leaving a view cancels its dialogs as Escape would.
  const panels = useRef(new Map<NavView, HTMLDivElement>()), shown = useRef<NavView>(current);
  useLayoutEffect(() => {
    const left = shown.current; shown.current = current;
    if (left === current) return;
    for (const dialog of panels.current.get(left)?.querySelectorAll('dialog[open]') ?? []) dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  }, [current]);
  // Every mounted view registers Ctrl/⌘ K for its own editor; the shown view's editor gets it.
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || document.querySelector('dialog[open]') !== null) return;
      event.stopImmediatePropagation();
      const label = SHORTCUT_TARGETS[current], panel = panels.current.get(current);
      const target = label === undefined || panel === undefined ? null : panel.querySelector<HTMLInputElement>(`input[role="combobox"][aria-label="${label}"]`);
      if (target === null) return;
      event.preventDefault(); target.focus(); target.select();
    };
    window.addEventListener('keydown', shortcut, true);
    return () => window.removeEventListener('keydown', shortcut, true);
  }, [current]);
  function view(item: NavView, user: UserInfo) {
    const routing: ViewRouting = { active: item === current, route, router };
    switch (item) {
      case 'archive': return <ArchiveView connection={connection} requests={archiveRequests} findReads={findReads} stats={stats} user={user} routing={routing}/>;
      case 'search': return <SearchView connection={connection} stats={stats} user={user} findReads={findReads} routing={routing}/>;
      case 'activity': return <Activity connection={connection} stats={stats} user={user} actions={actions} routing={routing}/>;
      case 'mcp': return <McpTester tester={tester}/>;
      case 'access': return <Access connection={connection} stats={stats} user={user} actions={actions}/>;
    }
  }
  function views(user: UserInfo) {
    return NAV_ITEMS.filter(item => mounted.has(item.view)).map(item => <div key={`${scope.owner ?? ''}:${item.view}`} className="app-route" data-view={item.view} hidden={item.view !== current} ref={element => { if (element === null) panels.current.delete(item.view); else panels.current.set(item.view, element); }}><RetainedView active={item.view === current} render={() => view(item.view, user)}/></div>);
  }
  // Until the session becomes a routed page (UX-C3) a session route opens the dialog over its parent list.
  function sessionDialog(user: UserInfo) {
    if (route.view !== 'session') return null;
    const sessionId = sessionIdOf(route);
    return <div className="legacy-view"><Dialog title="Source conversation" close={() => router.back(retainedRoute('archive', scope.cache))}><Conversation key={sessionId} connection={connection} stats={stats} user={user} sessionId={sessionId} initialView={undefined} archiveHead={null} select={id => router.navigate(sessionRoute(id), 'push')} refresh={0} findReads={findReads}/></Dialog></div>;
  }
  return <RouteStateContext.Provider value={scope.cache}><div className="app-shell" onFocusCapture={dismissPopoverOnExternalFocus}><a className="skip-link" href={`#${MAIN_CONTENT_ID}`} onClick={skipToContent}>Skip to content</a>
    <header className="masthead"><Brand/>
      {user && <MainNavigation current={accountShown ? null : current} attention={attentionText}/>}
      <div className="masthead-end">{stats.terminal !== 'unauthorized' && <ConnectionHealth connection={connection} stats={stats}/>}<ThemeControl controller={theme}/>{user && <UserMenu user={user} admin={admin}/>}</div></header>
    <div id={MAIN_CONTENT_ID} className="app-views" tabIndex={-1}><div className="global-mutation-notices"><MutationNotice actions={actions}/><ReindexProgress progress={rebuild}/></div>
      {identity.error && stats.terminal !== 'unauthorized' && <div className="page shell-notice"><div className="notice notice-danger" role="alert">{identity.error}</div></div>}
      {renewal.error && <div className="page shell-notice"><div className="notice notice-danger" role="alert"><div>{renewal.error}. Your credentials have not been rejected. <div className="notice-actions"><button type="button" className="btn btn-sm" onClick={renewal.retry}>Retry session renewal</button></div></div></div></div>}
      {stats.terminal === 'unauthorized' ? <main data-account-auth=""/> : stats.terminal === 'update-required' ? <ShellState title="Dashboard update required" status="This dashboard version is no longer supported. Reload to update before checking your session." action="Reload dashboard" run={() => window.location.reload()}/> : identity.data === null ? <ShellState title={identity.error || stats.terminal !== null ? 'Session unavailable' : stats.activeId === null ? 'Reconnecting' : 'Checking session'} status={identity.error || stats.terminal !== null ? 'Session unavailable. Retry without entering credentials.' : stats.activeId === null ? 'Reconnecting and checking your existing session…' : 'Checking your existing session…'} action="Retry session" run={() => connection.retry()}/> : user === null ? <main className="page shell-state"><p className="muted" role="status">Preparing an account-scoped archive…</p></main> : <><div className="app-view" hidden={accountShown}>{views(user)}{sessionDialog(user)}</div><div data-account-outlet="" data-account-user-id={user.id} hidden/></>}</div>
  </div></RouteStateContext.Provider>;
}
function ShellState({ title, status, action, run }: { title: string; status: string; action: string; run: () => void }) {
  return <main className="page shell-state"><div className="empty"><h2>{title}</h2><p role="status">{status}</p><div className="row"><button type="button" className="btn" onClick={run}>{action}</button></div></div></main>;
}
