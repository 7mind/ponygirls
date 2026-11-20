import { useEffect, useRef, useState } from 'react';
import type { ResourceConnection } from './hooks.ts';
import type { ManagerStats } from './transport/types.ts';

export interface InfinitePage<T, M, C> { items: readonly T[]; next: C | undefined; previous: C | undefined; meta: M }
interface LoadedPage<T, M, C> { cursor: C | undefined; page: InfinitePage<T, M, C> }
interface InfiniteState<T, M, C> {
  connection: ResourceConnection; generation: number; activeId: number | null; key: string; initialCursor: C | undefined;
  pages: readonly LoadedPage<T, M, C>[]; items: readonly T[]; meta: M | null;
  loading: boolean; refreshing: boolean; loadingMore: boolean; loadingPrevious: boolean; error: string | null; updateAvailable: boolean;
  // The edge (previous: true) whose append failed; the loaded rows stay (spec §1 principle 3) until a retry or refresh.
  failedEdge: boolean | null;
}
export interface InfiniteResource<T, M> {
  items: readonly T[]; meta: M | null; loading: boolean; refreshing: boolean; loadingMore: boolean; loadingPrevious: boolean;
  /** Any failure of the current chain; `appendError` is set as well when an append failed and the loaded rows were kept. */
  error: string | null; appendError: string | null; updateAvailable: boolean; hasMore: boolean; hasPrevious: boolean;
  loadMore: () => void; loadPrevious: () => void; applyUpdates: () => void; retryAppend: () => void;
}
/**
 * A settled chain (no read in flight, no failure) kept outside the view, so that returning to a query shows its loaded rows at
 * once instead of only its first page after a read (spec §5 rule 2). Entries belong to one connection generation and session;
 * an invalidated connection clears the store.
 */
export interface SettledChain<T, M, C> { readonly generation: number; readonly activeId: number | null; readonly initialCursor: C | undefined; readonly pages: readonly LoadedPage<T, M, C>[]; readonly items: readonly T[]; readonly meta: M; readonly updateAvailable: boolean }
export interface SettledChainStore<T, M, C> { read(key: string): SettledChain<T, M, C> | undefined; write(key: string, chain: SettledChain<T, M, C>): void; clear(): void }
/** Keeps the most recently settled `limit` chains. */
export class SettledChainCache<T, M, C> implements SettledChainStore<T, M, C> {
  private readonly chains = new Map<string, SettledChain<T, M, C>>();
  constructor(private readonly limit: number) { if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid settled chain cache limit.'); }
  read(key: string): SettledChain<T, M, C> | undefined { return this.chains.get(key); }
  write(key: string, chain: SettledChain<T, M, C>): void {
    this.chains.delete(key); this.chains.set(key, chain);
    for (const oldest of this.chains.keys()) { if (this.chains.size <= this.limit) break; this.chains.delete(oldest); }
  }
  clear(): void { this.chains.clear(); }
}
export function uniqueItems<T>(items: readonly T[], id: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(item => { const key = id(item); if (seen.has(key)) return false; seen.add(key); return true; });
}
export function authorizedSurvivors<T>(visible: readonly T[], authorized: readonly T[], id: (item: T) => string): T[] {
  const current = new Map(authorized.map(item => [id(item), item]));
  return visible.flatMap(item => { const value = current.get(id(item)); return value === undefined ? [] : [value]; });
}
function sameOrder<T>(left: readonly T[], right: readonly T[], id: (item: T) => string): boolean { return left.length === right.length && left.every((item, index) => id(item) === id(right[index]!)); }
/** One read of a positional list: the items from the requested offset on (a server may return fewer than requested) and the list's length. */
export interface PositionalRead<T> { readonly items: readonly T[]; readonly total: number }
/** Where a page of a positional list starts, and the list's length. */
export interface PositionalMeta { readonly offset: number; readonly total: number }
/**
 * Reads at most `limit` items from `offset`: while the items end before `through` and before the list's end, the next read
 * continues where they end and asks for the rest. A read returns at least one item where any exist, so there are at most
 * `through - offset` reads; an empty read where items remain is an error.
 */
async function readPositions<T>(read: (offset: number, limit: number) => Promise<PositionalRead<T>>, offset: number, limit: number, through: number): Promise<PositionalRead<T>> {
  if (through > offset + limit) throw new Error('A positional read must end within its limit.');
  const items: T[] = [];
  for (;;) {
    const next = offset + items.length, page = await read(next, offset + limit - next);
    items.push(...page.items);
    if (offset + items.length >= Math.min(through, page.total)) return { items, total: page.total };
    if (page.items.length === 0) throw new Error(`The server returned an empty page at position ${next + 1} of ${page.total}`);
  }
}
/**
 * The pages of a positional list (cursor: a page's offset) as one contiguous range, each item at its position, although the
 * server may return fewer items than requested: a page asks for `pageSize` items; the first page, at `start`, reads on until
 * it holds position `target`; a page before the loaded ones (`before`: the first of them) reads on until it ends where they begin.
 */
export function positionalPages<T>(read: (offset: number, limit: number) => Promise<PositionalRead<T>>, pageSize: number, start: number, target: number): (cursor: number | undefined, before: InfinitePage<T, PositionalMeta, number> | undefined) => Promise<InfinitePage<T, PositionalMeta, number>> {
  return async (cursor, before) => {
    const offset = cursor ?? start;
    const page = before === undefined ? await readPositions(read, offset, pageSize, offset === start ? target + 1 : offset + 1) : await readPositions(read, offset, before.meta.offset - offset, before.meta.offset);
    const end = offset + page.items.length;
    return { items: page.items, next: end < page.total ? end : undefined, previous: offset > 0 ? Math.max(0, offset - pageSize) : undefined, meta: { offset, total: page.total } };
  };
}

/** `load(cursor, before)` reads the page at `cursor`; `before` is set for the page before the loaded ones: their first page, where it must end. */
export function useInfiniteResource<T, M, C extends string | number>(connection: ResourceConnection, stats: ManagerStats, key: string, refresh: string, enabled: boolean, initialCursor: C | undefined, load: (cursor: C | undefined, before: InfinitePage<T, M, C> | undefined) => Promise<InfinitePage<T, M, C>>, id: (item: T) => string): InfiniteResource<T, M> {
  return useSettledInfiniteResource(null, connection, stats, key, refresh, enabled, initialCursor, load, id);
}
/** As `useInfiniteResource`; settled chains are also kept in `store`, and a key whose settled chain is there shows it while it is read again. */
export function useSettledInfiniteResource<T, M, C extends string | number>(store: SettledChainStore<T, M, C> | null, connection: ResourceConnection, stats: ManagerStats, key: string, refresh: string, enabled: boolean, initialCursor: C | undefined, load: (cursor: C | undefined, before: InfinitePage<T, M, C> | undefined) => Promise<InfinitePage<T, M, C>>, id: (item: T) => string): InfiniteResource<T, M> {
  const ready = enabled && stats.activeId !== null;
  const scope = { connection, generation: stats.generation, activeId: stats.activeId, key, initialCursor };
  const cleared = { pages: [], items: [], meta: null, loading: false, refreshing: false, loadingMore: false, loadingPrevious: false, error: null, updateAvailable: false, failedEdge: null };
  function stored(): InfiniteState<T, M, C> | null {
    if (store === null || !ready) return null;
    const chain = store.read(key);
    if (chain === undefined || chain.generation !== stats.generation || chain.activeId !== stats.activeId || chain.initialCursor !== initialCursor) return null;
    return { ...scope, ...cleared, pages: chain.pages, items: chain.items, meta: chain.meta, updateAvailable: chain.updateAvailable };
  }
  const [state, setState] = useState<InfiniteState<T, M, C>>(() => stored() ?? { ...scope, ...cleared, loading: ready });
  const currentState = useRef(state); currentState.current = state;
  const loader = useRef(load), identity = useRef(id); loader.current = load; identity.current = id;
  const sequence = useRef(0), inFlight = useRef<number | null>(null), requestedRefresh = useRef(refresh), queuedRefresh = useRef(false);
  const [reload, setReload] = useState(0);
  const matches = (value: InfiniteState<T, M, C>) => value.connection === connection && value.generation === stats.generation && value.activeId === stats.activeId && value.key === key && value.initialCursor === initialCursor;
  useEffect(() => connection.onInvalidate(() => {
    sequence.current++; inFlight.current = null; queuedRefresh.current = false;
    if (store !== null) store.clear();
    setState(previous => ({ ...previous, ...cleared }));
  }), [connection, store]);
  useEffect(() => {
    const operation = ++sequence.current; let mounted = true;
    requestedRefresh.current = refresh; queuedRefresh.current = false;
    // A key with a settled chain in the store shows it at once and reads it again like a refresh (stale while revalidating).
    const restored = ready && !matches(currentState.current) ? stored() : null, previous = restored ?? currentState.current, retain = ready && matches(previous);
    const count = retain ? Math.max(1, previous.pages.length) : 1;
    const first = retain && previous.pages.length > 0 ? previous.pages[0]!.cursor : initialCursor;
    inFlight.current = ready ? operation : null;
    setState(value => restored !== null ? { ...restored, refreshing: true } : retain ? { ...value, loading: value.meta === null && ready, refreshing: value.meta !== null && ready, loadingMore: false, loadingPrevious: false, error: null, failedEdge: null } : { ...scope, ...cleared, loading: ready });
    if (ready) void (async () => {
      const pages: LoadedPage<T, M, C>[] = [], seen = new Set<C | undefined>();
      let cursor = first;
      for (let index = 0; index < count; index++) {
        if (seen.has(cursor)) throw new Error('The server repeated a paging cursor.');
        seen.add(cursor);
        const page = await loader.current(cursor, undefined);
        if (!mounted || sequence.current !== operation) return;
        pages.push({ cursor, page });
        if (page.next === undefined) break;
        cursor = page.next;
      }
      if (!mounted || sequence.current !== operation) return;
      const fresh = uniqueItems(pages.flatMap(item => item.page.items), identity.current);
      setState(value => {
        const survivors = value.meta === null ? fresh : authorizedSurvivors(value.items, fresh, identity.current);
        const changedOrder = !sameOrder(survivors, fresh, identity.current);
        return { ...scope, ...cleared, pages, items: changedOrder ? survivors : fresh, meta: pages[0]!.page.meta, updateAvailable: changedOrder };
      });
    })().catch((cause: unknown) => {
      if (mounted && sequence.current === operation) setState({ ...scope, ...cleared, error: cause instanceof Error ? cause.message : 'Request failed' });
    }).finally(() => { if (mounted) finish(operation); });
    return () => { mounted = false; sequence.current++; };
  }, [connection, stats.generation, stats.activeId, key, reload, enabled, initialCursor]);
  useEffect(() => {
    if (requestedRefresh.current === refresh) return;
    requestedRefresh.current = refresh;
    if (!ready) return;
    if (inFlight.current !== null) queuedRefresh.current = true;
    else setReload(value => value + 1);
  }, [refresh]);
  // Only a settled chain is kept: an unfinished or failed read is never restored as a complete list.
  useEffect(() => {
    if (store === null || !ready || !matches(state) || state.meta === null || state.loading || state.refreshing || state.loadingMore || state.loadingPrevious || state.error !== null) return;
    store.write(key, { generation: state.generation, activeId: state.activeId, initialCursor: state.initialCursor, pages: state.pages, items: state.items, meta: state.meta, updateAvailable: state.updateAvailable });
  }, [state, store]);
  function finish(operation: number) {
    if (inFlight.current !== operation || sequence.current !== operation) return;
    if (queuedRefresh.current) { queuedRefresh.current = false; setReload(value => value + 1); }
    else inFlight.current = null;
  }
  function edge(previous: boolean, retry: boolean) {
    const snapshot = currentState.current;
    if (!ready || !matches(snapshot) || inFlight.current !== null || snapshot.pages.length === 0) return;
    if (snapshot.error !== null && !(retry && snapshot.failedEdge === previous)) return;
    const first = snapshot.pages[0]!, cursor = previous ? first.page.previous : snapshot.pages.at(-1)!.page.next;
    if (cursor === undefined) return;
    const operation = sequence.current; inFlight.current = operation;
    setState(value => ({ ...value, loadingMore: !previous, loadingPrevious: previous, error: null, failedEdge: null }));
    void loader.current(cursor, previous ? first.page : undefined).then(page => {
      if (sequence.current !== operation) return;
      if (snapshot.pages.some(item => item.cursor === cursor)) throw new Error('The server repeated a paging cursor.');
      if (previous && page.next !== first.cursor) throw new Error('The earlier page does not end where the loaded pages begin');
      setState(value => {
        const loaded = { cursor, page }, pages = previous ? [loaded, ...value.pages] : [...value.pages, loaded];
        const items = uniqueItems(previous ? [...page.items, ...value.items] : [...value.items, ...page.items], identity.current);
        return { ...value, pages, items, meta: previous ? page.meta : value.meta, loadingMore: false, loadingPrevious: false };
      });
    }).catch((cause: unknown) => {
      if (sequence.current === operation) setState(value => ({ ...value, loadingMore: false, loadingPrevious: false, error: cause instanceof Error ? cause.message : 'Request failed', failedEdge: previous }));
    }).finally(() => finish(operation));
  }
  function applyUpdates() {
    if (!ready || !matches(currentState.current)) return;
    setState(value => ({ ...value, items: uniqueItems(value.pages.flatMap(item => item.page.items), identity.current), updateAvailable: false }));
  }
  function retryAppend() { const snapshot = currentState.current; if (snapshot.failedEdge !== null) edge(snapshot.failedEdge, true); }
  const visible = enabled && matches(state) ? state : stored() ?? { ...state, ...cleared, loading: ready };
  return { ...visible, appendError: visible.failedEdge === null ? null : visible.error, hasMore: visible.pages.at(-1)?.page.next !== undefined, hasPrevious: visible.pages[0]?.page.previous !== undefined, loadMore: () => edge(false, false), loadPrevious: () => edge(true, false), applyUpdates, retryAppend };
}
