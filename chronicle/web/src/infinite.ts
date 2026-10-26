import { useEffect, useRef, useState } from 'react';
import type { ResourceConnection } from './hooks.ts';
import type { ManagerStats } from './transport/types.ts';

export interface InfinitePage<T, M, C> { items: readonly T[]; next: C | undefined; previous: C | undefined; meta: M }
interface LoadedPage<T, M, C> { cursor: C | undefined; page: InfinitePage<T, M, C> }
interface InfiniteState<T, M, C> {
  connection: ResourceConnection; generation: number; activeId: number | null; key: string; initialCursor: C | undefined;
  pages: readonly LoadedPage<T, M, C>[]; items: readonly T[]; meta: M | null;
  loading: boolean; refreshing: boolean; loadingMore: boolean; loadingPrevious: boolean; error: string | null; updateAvailable: boolean;
}
export interface InfiniteResource<T, M> {
  items: readonly T[]; meta: M | null; loading: boolean; refreshing: boolean; loadingMore: boolean; loadingPrevious: boolean;
  error: string | null; updateAvailable: boolean; hasMore: boolean; hasPrevious: boolean;
  loadMore: () => void; loadPrevious: () => void; applyUpdates: () => void;
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

export function useInfiniteResource<T, M, C extends string | number>(connection: ResourceConnection, stats: ManagerStats, key: string, refresh: string, enabled: boolean, initialCursor: C | undefined, load: (cursor: C | undefined) => Promise<InfinitePage<T, M, C>>, id: (item: T) => string): InfiniteResource<T, M> {
  const ready = enabled && stats.activeId !== null;
  const scope = { connection, generation: stats.generation, activeId: stats.activeId, key, initialCursor };
  const [state, setState] = useState<InfiniteState<T, M, C>>({ ...scope, pages: [], items: [], meta: null, loading: ready, refreshing: false, loadingMore: false, loadingPrevious: false, error: null, updateAvailable: false });
  const currentState = useRef(state); currentState.current = state;
  const loader = useRef(load), identity = useRef(id); loader.current = load; identity.current = id;
  const sequence = useRef(0), inFlight = useRef<number | null>(null), requestedRefresh = useRef(refresh), queuedRefresh = useRef(false);
  const [reload, setReload] = useState(0);
  const matches = (value: InfiniteState<T, M, C>) => value.connection === connection && value.generation === stats.generation && value.activeId === stats.activeId && value.key === key && value.initialCursor === initialCursor;
  useEffect(() => connection.onInvalidate(() => {
    sequence.current++; inFlight.current = null; queuedRefresh.current = false;
    setState(previous => ({ ...previous, pages: [], items: [], meta: null, loading: false, refreshing: false, loadingMore: false, loadingPrevious: false, error: null, updateAvailable: false }));
  }), [connection]);
  useEffect(() => {
    const operation = ++sequence.current; let mounted = true;
    requestedRefresh.current = refresh; queuedRefresh.current = false;
    const previous = currentState.current, retain = ready && matches(previous);
    const count = retain ? Math.max(1, previous.pages.length) : 1;
    const first = retain && previous.pages.length > 0 ? previous.pages[0]!.cursor : initialCursor;
    inFlight.current = ready ? operation : null;
    setState(value => retain ? { ...value, loading: value.meta === null && ready, refreshing: value.meta !== null && ready, loadingMore: false, loadingPrevious: false, error: null } : { ...scope, pages: [], items: [], meta: null, loading: ready, refreshing: false, loadingMore: false, loadingPrevious: false, error: null, updateAvailable: false });
    if (ready) void (async () => {
      const pages: LoadedPage<T, M, C>[] = [], seen = new Set<C | undefined>();
      let cursor = first;
      for (let index = 0; index < count; index++) {
        if (seen.has(cursor)) throw new Error('The server repeated a paging cursor.');
        seen.add(cursor);
        const page = await loader.current(cursor);
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
        return { ...scope, pages, items: changedOrder ? survivors : fresh, meta: pages[0]!.page.meta, loading: false, refreshing: false, loadingMore: false, loadingPrevious: false, error: null, updateAvailable: changedOrder };
      });
    })().catch((cause: unknown) => {
      if (mounted && sequence.current === operation) setState({ ...scope, pages: [], items: [], meta: null, loading: false, refreshing: false, loadingMore: false, loadingPrevious: false, error: cause instanceof Error ? cause.message : 'Request failed', updateAvailable: false });
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
  function finish(operation: number) {
    if (inFlight.current !== operation || sequence.current !== operation) return;
    if (queuedRefresh.current) { queuedRefresh.current = false; setReload(value => value + 1); }
    else inFlight.current = null;
  }
  function edge(previous: boolean) {
    const snapshot = currentState.current;
    if (!ready || !matches(snapshot) || inFlight.current !== null || snapshot.error !== null || snapshot.pages.length === 0) return;
    const cursor = previous ? snapshot.pages[0]!.page.previous : snapshot.pages.at(-1)!.page.next;
    if (cursor === undefined) return;
    const operation = sequence.current; inFlight.current = operation;
    setState(value => ({ ...value, loadingMore: !previous, loadingPrevious: previous }));
    void loader.current(cursor).then(page => {
      if (sequence.current !== operation) return;
      if (snapshot.pages.some(item => item.cursor === cursor)) throw new Error('The server repeated a paging cursor.');
      setState(value => {
        const loaded = { cursor, page }, pages = previous ? [loaded, ...value.pages] : [...value.pages, loaded];
        const items = uniqueItems(previous ? [...page.items, ...value.items] : [...value.items, ...page.items], identity.current);
        return { ...value, pages, items, meta: previous ? page.meta : value.meta, loadingMore: false, loadingPrevious: false };
      });
    }).catch((cause: unknown) => {
      if (sequence.current === operation) setState({ ...scope, pages: [], items: [], meta: null, loading: false, refreshing: false, loadingMore: false, loadingPrevious: false, error: cause instanceof Error ? cause.message : 'Request failed', updateAvailable: false });
    }).finally(() => finish(operation));
  }
  function applyUpdates() {
    if (!ready || !matches(currentState.current)) return;
    setState(value => ({ ...value, items: uniqueItems(value.pages.flatMap(item => item.page.items), identity.current), updateAvailable: false }));
  }
  const visible = enabled && matches(state) ? state : { ...state, pages: [], items: [], meta: null, loading: ready, refreshing: false, loadingMore: false, loadingPrevious: false, error: null, updateAvailable: false };
  return { ...visible, hasMore: visible.pages.at(-1)?.page.next !== undefined, hasPrevious: visible.pages[0]?.page.previous !== undefined, loadMore: () => edge(false), loadPrevious: () => edge(true), applyUpdates };
}
