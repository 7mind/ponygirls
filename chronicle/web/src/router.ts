import { createContext, useCallback, useContext, useReducer, useSyncExternalStore } from 'react';
import type { Dispatch, SetStateAction } from 'react';

// Fragment routes of the dashboard (redesign spec §5): `#/<view>[/<segment>][?<query>]`.
// Fragments starting with `#account` belong to the shared account module and are never routed here.
export const VIEWS = ['archive', 'search', 'activity', 'access', 'mcp', 'session'] as const;
export type View = (typeof VIEWS)[number];
export const ACTIVITY_SECTIONS = ['overview', 'collectors', 'jobs', 'usage', 'maintenance'] as const;
const ROUTE_PREFIX = '#/';
const ACCOUNT_PREFIX = '#account';
const QUERY_SEPARATOR = '?';
const HISTORY_INDEX_KEY = 'chronicleRouteIndex';

/** Immutable query parameters of a route. */
export class RouteParams {
  private readonly values: URLSearchParams;
  constructor(entries: readonly (readonly [string, string])[]) { this.values = new URLSearchParams(entries.map(([name, value]) => [name, value])); this.values.sort(); }
  get(name: string): string | null { return this.values.get(name); }
  entries(): readonly (readonly [string, string])[] { return [...this.values.entries()]; }
  toString(): string { return this.values.toString(); }
}
export const NO_PARAMS = new RouteParams([]);

export interface Route { readonly view: View; readonly segments: readonly string[]; readonly params: RouteParams }
export function viewRoute(view: Exclude<View, 'session'>): Route { return { view, segments: [], params: NO_PARAMS }; }
export function sessionRoute(sessionId: string): Route {
  if (sessionId.length === 0) throw new Error('A session route needs a session id');
  return { view: 'session', segments: [sessionId], params: NO_PARAMS };
}
export function sessionIdOf(route: Route): string {
  const [sessionId] = route.segments;
  if (route.view !== 'session' || sessionId === undefined) throw new Error('Not a session route');
  return sessionId;
}
export const DEFAULT_ROUTE = viewRoute('search');
/** In-page Back without in-app history goes to the parent list (spec §5 rule 3). */
export function parentRoute(route: Route): Route { return route.view === 'session' ? viewRoute('archive') : route; }

export type Fragment = { readonly kind: 'route'; readonly route: Route } | { readonly kind: 'account' } | { readonly kind: 'empty' } | { readonly kind: 'invalid' };

function validSegments(view: View, segments: readonly string[]): boolean {
  const [first] = segments;
  switch (view) {
    case 'session': return segments.length === 1 && first !== undefined && first.length > 0;
    case 'activity': return segments.length === 0 || (segments.length === 1 && first !== undefined && (ACTIVITY_SECTIONS as readonly string[]).includes(first));
    default: return segments.length === 0;
  }
}
export function parseFragment(hash: string): Fragment {
  if (hash === '' || hash === '#') return { kind: 'empty' };
  if (hash.startsWith(ACCOUNT_PREFIX)) return { kind: 'account' };
  if (!hash.startsWith(ROUTE_PREFIX)) return { kind: 'invalid' };
  const body = hash.slice(ROUTE_PREFIX.length), separator = body.indexOf(QUERY_SEPARATOR);
  const path = separator < 0 ? body : body.slice(0, separator), query = separator < 0 ? '' : body.slice(separator + 1);
  let parts: string[];
  try { parts = path.split('/').map(part => decodeURIComponent(part)); } catch { return { kind: 'invalid' }; }
  const [view, ...segments] = parts;
  if (view === undefined || !(VIEWS as readonly string[]).includes(view) || !validSegments(view as View, segments)) return { kind: 'invalid' };
  return { kind: 'route', route: { view: view as View, segments, params: new RouteParams([...new URLSearchParams(query).entries()]) } };
}
export function formatRoute(route: Route): string {
  if (!validSegments(route.view, route.segments)) throw new Error(`Invalid route segments for ${route.view}`);
  const query = route.params.toString();
  return `${ROUTE_PREFIX}${[route.view, ...route.segments].map(part => encodeURIComponent(part)).join('/')}${query === '' ? '' : `${QUERY_SEPARATOR}${query}`}`;
}
export function sameRoute(left: Route, right: Route): boolean { return formatRoute(left) === formatRoute(right); }

function historyIndex(state: unknown): number | null {
  if (state === null || typeof state !== 'object' || !(HISTORY_INDEX_KEY in state)) return null;
  const value = (state as Record<typeof HISTORY_INDEX_KEY, unknown>)[HISTORY_INDEX_KEY];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export type NavigationMode = 'push' | 'replace';
export interface RouterSnapshot { readonly route: Route; readonly account: boolean }
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

/**
 * Owns the fragment, the in-app history index and the document scroll position of every history entry.
 * Every history entry gets an index in `history.state`: an entry without one is new (a link click,
 * `location.hash`, the account module), an entry with one was reached by Back/Forward or reload.
 * New entries start at the top; traversed entries get their remembered `scrollY` back once their view has
 * rendered and the document is tall enough (rows may still be loading). The position is held while the
 * reloaded view settles (every document resize re-applies it) until the user scrolls, clicks or types.
 */
export class HashRouter {
  private snapshot: RouterSnapshot;
  private index = 0;
  private readonly positions = new Map<number, number>();
  // Scroll position held for a traversed entry (see the class comment).
  private pendingScroll: { readonly target: number; rendered: boolean } | null = null;
  private readonly listeners = new Set<() => void>();
  private replacing = false;
  constructor(private readonly window: Window) {
    this.snapshot = { route: DEFAULT_ROUTE, account: false };
  }
  getSnapshot = (): RouterSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  start(): () => void {
    const window = this.window, history = window.history;
    history.scrollRestoration = 'manual';
    const known = historyIndex(history.state);
    this.index = known ?? 0;
    if (known === null) this.stamp();
    this.apply(false);
    const changed = () => {
      if (this.replacing) return;
      const index = historyIndex(history.state);
      const traversal = index !== null;
      this.index = index ?? this.index + 1;
      if (!traversal) this.stamp();
      this.apply(traversal);
    };
    const scrolled = () => { if (this.pendingScroll === null) this.positions.set(this.index, window.scrollY); };
    const userScroll = () => { this.pendingScroll = null; };
    const resized = new ResizeObserver(() => this.restore());
    resized.observe(window.document.documentElement);
    window.addEventListener('hashchange', changed);
    window.addEventListener('scroll', scrolled, { passive: true });
    for (const name of USER_SCROLL_EVENTS) window.addEventListener(name, userScroll, { passive: true, capture: true });
    return () => {
      resized.disconnect();
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('scroll', scrolled);
      for (const name of USER_SCROLL_EVENTS) window.removeEventListener(name, userScroll, { capture: true });
    };
  }
  /**
   * Push opens a new history entry through the fragment; replace rewrites the current one and announces it with a
   * `hashchange` event as well, because the account module re-routes on every fragment change it observes.
   */
  navigate(route: Route, mode: NavigationMode): void {
    const target = formatRoute(route);
    if (mode === 'push') { if (this.window.location.hash !== target) this.window.location.hash = target; return; }
    const previous = this.window.location.href;
    this.window.history.replaceState({ [HISTORY_INDEX_KEY]: this.index }, '', target);
    this.replacing = true;
    try { this.window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: previous, newURL: this.window.location.href })); } finally { this.replacing = false; }
    this.apply(false);
  }
  /** In-page Back: the previous entry when it belongs to this page, otherwise the parent list. */
  back(parent: Route): void {
    if (this.index > 0) this.window.history.back(); else this.navigate(parent, 'replace');
  }
  private stamp(): void { this.window.history.replaceState({ [HISTORY_INDEX_KEY]: this.index }, ''); }
  private apply(traversal: boolean): void {
    const fragment = parseFragment(this.window.location.hash);
    if (fragment.kind === 'account') { this.pendingScroll = null; void this.publish({ route: this.snapshot.route, account: true }); return; }
    if (fragment.kind !== 'route') { this.navigate(DEFAULT_ROUTE, 'replace'); return; }
    this.pendingScroll = traversal ? { target: this.positions.get(this.index) ?? 0, rendered: false } : null;
    if (!traversal) this.window.scrollTo(0, 0);
    if (!this.publish({ route: fragment.route, account: false })) this.window.requestAnimationFrame(() => this.rendered());
  }
  /** The view of the current route has committed; a pending restoration may now apply. */
  rendered(): void {
    if (this.pendingScroll === null) return;
    this.pendingScroll.rendered = true;
    this.restore();
  }
  private restore(): void {
    const pending = this.pendingScroll;
    if (pending === null || !pending.rendered) return;
    const document = this.window.document.documentElement;
    if (document.scrollHeight - this.window.innerHeight < pending.target) return;
    this.positions.set(this.index, pending.target);
    if (this.window.scrollY !== pending.target) this.window.scrollTo(0, pending.target);
  }
  /** True when the snapshot changed (the views render again and report `rendered()`). */
  private publish(snapshot: RouterSnapshot): boolean {
    if (snapshot.account === this.snapshot.account && sameRoute(snapshot.route, this.snapshot.route)) return false;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
    return true;
  }
}
export function useRouter(router: HashRouter): RouterSnapshot { return useSyncExternalStore(router.subscribe, router.getSnapshot, router.getSnapshot); }

/**
 * Per-route view state that outlives the view component (spec §5 rule 2): a view keeps its loaded
 * chain, draft and selection here instead of in `useState`, keyed by its route plus query and sort.
 * One cache per signed-in owner; App replaces it when the owner changes, so nothing leaks across accounts.
 */
export interface RouteSlot<T> { readonly name: string; initial(): T }
export function routeSlot<T>(name: string, initial: () => T): RouteSlot<T> { return { name, initial }; }
export class RouteStateCache {
  private readonly slots = new Map<RouteSlot<unknown>, Map<string, unknown>>();
  read<T>(slot: RouteSlot<T>, key: string): T {
    const entries = this.entries(slot);
    if (!entries.has(key)) entries.set(key, slot.initial());
    return entries.get(key) as T;
  }
  write<T>(slot: RouteSlot<T>, key: string, value: T): void { this.entries(slot).set(key, value); }
  private entries<T>(slot: RouteSlot<T>): Map<string, unknown> {
    let entries = this.slots.get(slot as RouteSlot<unknown>);
    if (entries === undefined) { entries = new Map(); this.slots.set(slot as RouteSlot<unknown>, entries); }
    return entries;
  }
}
export const RouteStateContext = createContext<RouteStateCache | null>(null);
/** `useState` whose value lives in the owner's RouteStateCache under (slot, key). */
export function useRouteState<T>(slot: RouteSlot<T>, key: string): [T, Dispatch<SetStateAction<T>>] {
  const cache = useContext(RouteStateContext);
  if (cache === null) throw new Error('useRouteState requires a RouteStateContext provider');
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const update = useCallback((action: SetStateAction<T>) => {
    const next = typeof action === 'function' ? (action as (previous: T) => T)(cache.read(slot, key)) : action;
    cache.write(slot, key, next); rerender();
  }, [cache, slot, key]);
  return [cache.read(slot, key), update];
}
