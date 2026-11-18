import { useEffect, useRef, useState } from 'react';
import type { ArchiveResult, ArchiveSearchResult } from './api.ts';
import type { ResourceConnection } from './hooks.ts';
import type { ManagerStats } from './transport/types.ts';
import { appendResultRows, resultRows, type SearchResultRow } from './search-source.ts';

export interface SearchChain {
  rows: readonly SearchResultRow[];
  // The first page's result: total, text scope and ordering of the whole chain.
  meta: ArchiveResult | null;
  loading: boolean;
  loadingMore: boolean;
  // The first page failed: nothing is shown. An append failure keeps the rows (appendError) and is retried by loadMore.
  error: string | null;
  appendError: string | null;
  hasMore: boolean;
  loadMore: () => void;
}
interface Scope { connection: ResourceConnection; generation: number; activeId: number | null; key: string }
interface ChainState extends Scope {
  rows: readonly SearchResultRow[]; meta: ArchiveResult | null; next: string | undefined; seen: readonly string[];
  loading: boolean; loadingMore: boolean; error: string | null; appendError: string | null;
}
const REPEATED_CURSOR = 'The server repeated a paging cursor.';
function empty(scope: Scope, loading: boolean): ChainState {
  return { ...scope, rows: [], meta: null, next: undefined, seen: [], loading, loadingMore: false, error: null, appendError: null };
}
function failure(cause: unknown): string { return cause instanceof Error ? cause.message : 'Request failed'; }

/**
 * The cursor chain of one submitted search: the first page, then one append per `loadMore`. A page is validated by `load`
 * before it is shown; replies of an earlier search, connection generation or invalidation are dropped, and only a settled
 * chain is ever shown (a failed or unfinished first page leaves no rows behind).
 */
export function useSearchChain(connection: ResourceConnection, stats: ManagerStats, key: string | null, load: (cursor: string | undefined) => Promise<ArchiveSearchResult>): SearchChain {
  const ready = key !== null && stats.activeId !== null, scopeKey = key ?? '';
  const scope: Scope = { connection, generation: stats.generation, activeId: stats.activeId, key: scopeKey };
  const [state, setState] = useState<ChainState>(() => empty(scope, ready));
  const current = useRef(state); current.current = state;
  const loader = useRef(load); loader.current = load;
  const sequence = useRef(0), appending = useRef(false);
  const matches = (value: ChainState) => value.connection === connection && value.generation === stats.generation && value.activeId === stats.activeId && value.key === scopeKey;
  useEffect(() => connection.onInvalidate(() => { sequence.current++; appending.current = false; setState(previous => empty(previous, false)); }), [connection]);
  useEffect(() => {
    const operation = ++sequence.current; appending.current = false;
    setState(empty(scope, ready));
    if (ready) void loader.current(undefined).then(result => {
      if (sequence.current !== operation) return;
      setState({ ...scope, rows: resultRows(result), meta: result.page, next: result.page.nextCursor, seen: [], loading: false, loadingMore: false, error: null, appendError: null });
    }).catch((cause: unknown) => {
      if (sequence.current === operation) setState({ ...empty(scope, false), error: failure(cause) });
    });
    return () => { sequence.current++; appending.current = false; };
  }, [connection, stats.generation, stats.activeId, scopeKey, ready]);
  function loadMore() {
    const snapshot = current.current, cursor = snapshot.next;
    if (!ready || !matches(snapshot) || snapshot.meta === null || cursor === undefined || snapshot.loadingMore || appending.current) return;
    const operation = sequence.current; appending.current = true;
    setState(value => ({ ...value, loadingMore: true, appendError: null }));
    void loader.current(cursor).then(result => {
      if (sequence.current !== operation) return;
      const seen = [...snapshot.seen, cursor];
      if (result.page.nextCursor !== undefined && seen.includes(result.page.nextCursor)) throw new Error(REPEATED_CURSOR);
      appending.current = false;
      setState(value => ({ ...value, rows: appendResultRows(value.rows, resultRows(result)), next: result.page.nextCursor, seen, loadingMore: false }));
    }).catch((cause: unknown) => {
      if (sequence.current !== operation) return;
      appending.current = false;
      setState(value => ({ ...value, loadingMore: false, appendError: failure(cause) }));
    });
  }
  const visible = matches(state) && ready ? state : empty(scope, ready);
  return { rows: visible.rows, meta: visible.meta, loading: visible.loading, loadingMore: visible.loadingMore, error: visible.error, appendError: visible.appendError, hasMore: visible.next !== undefined, loadMore };
}
