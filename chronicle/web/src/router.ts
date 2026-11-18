import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
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
export function viewRouteWith(view: Exclude<View, 'session'>, params: RouteParams): Route { return { view, segments: [], params }; }
export function sessionRoute(sessionId: string): Route {
  if (sessionId.length === 0) throw new Error('A session route needs a session id');
  return { view: 'session', segments: [sessionId], params: NO_PARAMS };
}
export function sessionIdOf(route: Route): string {
  const [sessionId] = route.segments;
  if (route.view !== 'session' || sessionId === undefined) throw new Error('Not a session route');
  return sessionId;
}
/**
 * Reading place of a session route (spec §5): the pinned source view (`rev`, and `gen` for an annotation generation), the
 * message at the top of the transcript (`at`, a message id), a Find literal to run on arrival (`find`), the side pane
 * (`pane`), the selected passage (`passage`) and the exact matched bytes of a Search landing in the `at` message (`span`,
 * UTF-8 byte offsets `start-end`, end exclusive). The pin is the complete source view: `rev`, and `gen` for a published
 * (annotated) view; a link without `gen` names the archive-only view of that revision. A malformed pin is an error, never a
 * default view, and so is a malformed span or a span without `at`; other absent or malformed values are null.
 */
export const SESSION_PANES = ['outline', 'find', 'related', 'info', 'closed'] as const;
export type SessionPane = (typeof SESSION_PANES)[number];
export interface SessionPin { readonly revision: number; readonly generationId: string | null }
export interface SessionSpan { readonly start: number; readonly end: number }
export interface SessionPlace { readonly pin: SessionPin | null; readonly at: string | null; readonly find: string | null; readonly pane: SessionPane | null; readonly passage: string | null; readonly span: SessionSpan | null }
const SESSION_PARAM = { revision: 'rev', generation: 'gen', at: 'at', find: 'find', pane: 'pane', passage: 'passage', span: 'span' } as const;
const SOURCE_REVISION = /^[1-9][0-9]*$/, BYTE_SPAN = /^(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/;
/** A session address whose source pin is malformed. */
export class InvalidSessionAddress extends Error {}
export function sessionPlaceRoute(sessionId: string, place: SessionPlace): Route {
  const entries: [string, string][] = [];
  if (place.pin !== null) {
    if (!Number.isSafeInteger(place.pin.revision) || place.pin.revision < 1) throw new Error('A session pin needs a source revision');
    if (place.pin.generationId === '') throw new Error('A session pin names an empty generation');
    entries.push([SESSION_PARAM.revision, String(place.pin.revision)]);
    if (place.pin.generationId !== null) entries.push([SESSION_PARAM.generation, place.pin.generationId]);
  }
  for (const [name, value] of [[SESSION_PARAM.at, place.at], [SESSION_PARAM.find, place.find], [SESSION_PARAM.pane, place.pane], [SESSION_PARAM.passage, place.passage]] as const) if (value !== null) entries.push([name, value]);
  if (place.span !== null) {
    if (place.at === null || !Number.isSafeInteger(place.span.start) || !Number.isSafeInteger(place.span.end) || place.span.start < 0 || place.span.end <= place.span.start) throw new Error('A session span needs its message and a non-empty byte range');
    entries.push([SESSION_PARAM.span, `${place.span.start}-${place.span.end}`]);
  }
  return { ...sessionRoute(sessionId), params: new RouteParams(entries) };
}
function sessionPinOf(params: RouteParams): SessionPin | null {
  const revision = params.get(SESSION_PARAM.revision), generation = params.get(SESSION_PARAM.generation);
  if (revision === null) {
    if (generation !== null) throw new InvalidSessionAddress('The session address names a generation without a source revision');
    return null;
  }
  if (!SOURCE_REVISION.test(revision) || !Number.isSafeInteger(Number(revision))) throw new InvalidSessionAddress('The session address names an invalid source revision');
  if (generation === '') throw new InvalidSessionAddress('The session address names an empty generation');
  return { revision: Number(revision), generationId: generation };
}
function sessionSpanOf(params: RouteParams): SessionSpan | null {
  const span = params.get(SESSION_PARAM.span);
  if (span === null) return null;
  const match = BYTE_SPAN.exec(span), at = params.get(SESSION_PARAM.at);
  if (match === null || at === null || at.length === 0) throw new InvalidSessionAddress('The session address names an invalid matched byte range');
  const start = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) throw new InvalidSessionAddress('The session address names an invalid matched byte range');
  return { start, end };
}
/** The reading place of a session route; throws InvalidSessionAddress for a malformed pin or span. */
export function sessionPlaceOf(route: Route): SessionPlace {
  const text = (name: string) => { const value = route.params.get(name); return value === null || value.length === 0 ? null : value; };
  const pane = text(SESSION_PARAM.pane);
  return {
    pin: sessionPinOf(route.params), span: sessionSpanOf(route.params),
    at: text(SESSION_PARAM.at), find: text(SESSION_PARAM.find), passage: text(SESSION_PARAM.passage),
    pane: SESSION_PANES.find(value => value === pane) ?? null,
  };
}
export const DEFAULT_ROUTE = viewRoute('search');

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
type Arrival = NavigationMode | 'traversal';
/** The scroll identity of a route: its view (and Activity section); null for a session page, whose panes scroll instead of the document. */
function scrollKey(route: Route): string | null { return route.view === 'session' ? null : [route.view, ...route.segments].join('/'); }
export interface RouterSnapshot { readonly route: Route; readonly account: boolean }
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

/**
 * Owns the fragment, the in-app history index and the document scroll position of every history entry.
 * Every history entry gets an index in `history.state`: an entry without one is new (a link click,
 * `location.hash`, the account module), an entry with one was reached by Back/Forward or reload.
 * Traversed entries get their remembered `scrollY` back; a new entry gets the position its route had when it was
 * last shown (views stay mounted per owner, see App), or the top. A position is applied once the view has rendered
 * and the document is tall enough (rows may still be loading), and held while the view settles (every document
 * resize re-applies it) until the user scrolls, clicks or types. Replacing an entry never scrolls.
 */
export class HashRouter {
  private snapshot: RouterSnapshot;
  private index = 0;
  private readonly positions = new Map<number, number>();
  private readonly routePositions = new Map<string, number>();
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
    this.apply('push');
    const changed = () => {
      if (this.replacing) return;
      const index = historyIndex(history.state);
      const traversal = index !== null;
      this.index = index ?? this.index + 1;
      if (!traversal) this.stamp();
      this.apply(traversal ? 'traversal' : 'push');
    };
    const scrolled = () => {
      if (this.pendingScroll !== null) return;
      this.positions.set(this.index, window.scrollY);
      const key = scrollKey(this.snapshot.route);
      if (!this.snapshot.account && key !== null) this.routePositions.set(key, window.scrollY);
    };
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
    this.apply('replace');
  }
  /** Route positions belong to the mounted views of one owner; App forgets them when it drops those views. */
  forgetRoutePositions(): void { this.routePositions.clear(); }
  /** In-page Back: the previous entry when it belongs to this page, otherwise the parent list. */
  back(parent: Route): void {
    if (this.index > 0) this.window.history.back(); else this.navigate(parent, 'replace');
  }
  private stamp(): void { this.window.history.replaceState({ [HISTORY_INDEX_KEY]: this.index }, ''); }
  private apply(arrival: Arrival): void {
    const fragment = parseFragment(this.window.location.hash);
    if (fragment.kind === 'account') { this.pendingScroll = null; void this.publish({ route: this.snapshot.route, account: true }); return; }
    if (fragment.kind !== 'route') { this.navigate(DEFAULT_ROUTE, 'replace'); return; }
    const key = scrollKey(fragment.route);
    if (arrival !== 'replace' && key !== null) {
      const target = arrival === 'traversal' ? this.positions.get(this.index) ?? this.routePositions.get(key) ?? 0 : this.routePositions.get(key) ?? 0;
      this.pendingScroll = target === 0 ? null : { target, rendered: false };
      if (target === 0) this.window.scrollTo(0, 0);
    }
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
    const key = scrollKey(this.snapshot.route);
    if (key !== null) this.routePositions.set(key, pending.target);
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
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  read<T>(slot: RouteSlot<T>, key: string): T {
    const entries = this.entries(slot);
    if (!entries.has(key)) entries.set(key, slot.initial());
    return entries.get(key) as T;
  }
  write<T>(slot: RouteSlot<T>, key: string, value: T): void {
    const entries = this.entries(slot);
    if (entries.has(key) && entries.get(key) === value) return;
    entries.set(key, value);
    for (const listener of this.listeners) listener();
  }
  private entries<T>(slot: RouteSlot<T>): Map<string, unknown> {
    let entries = this.slots.get(slot as RouteSlot<unknown>);
    if (entries === undefined) { entries = new Map(); this.slots.set(slot as RouteSlot<unknown>, entries); }
    return entries;
  }
}
export const RouteStateContext = createContext<RouteStateCache | null>(null);
/** `useState` whose value lives in the owner's RouteStateCache under (slot, key); every reader follows its writes. */
export function useRouteState<T>(slot: RouteSlot<T>, key: string): [T, Dispatch<SetStateAction<T>>] {
  const cache = useContext(RouteStateContext);
  if (cache === null) throw new Error('useRouteState requires a RouteStateContext provider');
  const value = useSyncExternalStore(cache.subscribe, () => cache.read(slot, key), () => cache.read(slot, key));
  const update = useCallback((action: SetStateAction<T>) => {
    cache.write(slot, key, typeof action === 'function' ? (action as (previous: T) => T)(cache.read(slot, key)) : action);
  }, [cache, slot, key]);
  return [value, update];
}

/**
 * Keeps a view's submitted state (query, sort) and its route parameters equal while the view is shown. `fromUrl` and
 * `fromState` are canonical parameter strings ('' for the defaults). A fragment that changed since this view last saw
 * it (deep link, reload, Back/Forward, an edited address, also to empty parameters) is authoritative and applied to
 * the state; a state change rewrites the fragment (replace). In-app links to a view carry its retained parameters
 * (App's masthead), so they change nothing. The last fragment seen is kept in the owner's route cache: a view
 * remounted after a reconnect does not re-apply a fragment its state has since dropped. Drafts are not parameters.
 */
const SEEN_FRAGMENT = routeSlot<string | null>('route-sync', () => null);
export function useRouteSync(view: View, active: boolean, fromUrl: string, fromState: string, applyUrl: () => void, writeUrl: () => void): void {
  const cache = useContext(RouteStateContext);
  if (cache === null) throw new Error('useRouteSync requires a RouteStateContext provider');
  useEffect(() => {
    if (!active) return;
    const changed = fromUrl !== cache.read(SEEN_FRAGMENT, view);
    cache.write(SEEN_FRAGMENT, view, fromUrl);
    if (fromUrl === fromState) return;
    if (changed) applyUrl(); else writeUrl();
  }, [cache, view, active, fromUrl, fromState]);
}
