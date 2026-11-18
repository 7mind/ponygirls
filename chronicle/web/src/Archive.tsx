import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { ExpressionHintTarget_Archive, ArchiveQuery, ArchiveSort, ArchiveTextScope, JobState, SortDirection, Operation_Archive, Result_Archive, type ArchiveResult, type ArchiveRow, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { SettledChainCache, useSettledInfiniteResource } from './infinite.ts';
import type { ArchiveReadLane } from './archive-requests.ts';
import { incompleteExpression } from './expression.ts';
import { useInfiniteSentinel } from './InfiniteTrigger.tsx';
import { ScrollAnchor } from './ScrollAnchor.tsx';
import { QueryBar, SyntaxHelp, archiveFields, conversationPresets } from './ExpressionEditor.tsx';
import { FilterBar } from './FilterShortcuts.tsx';
import { useStoredTableColumns, browserColumnChoices, ColumnMenu, TableColumnGroup, ColumnResize } from './TableColumns.tsx';
import type { TableColumnSpec } from './table-widths.ts';
import type { SessionFindReadGate } from './session-find.ts';
import { Icon } from './Icon.tsx';
import { RouteStateContext, formatRoute, parseFragment, routeSlot, sessionIdOf, sessionRoute, useRouteState } from './router.ts';
import type { ManagerStats } from './transport/types.ts';
import './archive.css';
const ARCHIVE_PAGE_SIZE = 50;
const ARCHIVE_REFRESH_MS = 20_000;
const ARCHIVE_DEBOUNCE_MS = 350;
// Settled query chains kept per owner, so that Back to an earlier query shows its loaded rows (spec §5 rule 2).
const ARCHIVE_CHAIN_LIMIT = 8;
const ARCHIVE_CHAINS = routeSlot('archive-chains', () => new SettledChainCache<ArchiveRow, ArchiveResult, string>(ARCHIVE_CHAIN_LIMIT));
const ARCHIVE_CHAINS_INSTANCE = 'archive';
const COLUMN_CHOICES_KEY = 'chronicle.archive.columns';
const SKELETON_ROWS = 12;
const MINUTE_MS = 60_000, HOUR_MS = 60 * MINUTE_MS, DAY_MS = 24 * HOUR_MS;
const PLACEHOLDER = 'Filter conversations — text, or project:chronicle AND NOT tag:archived';
// Phone widths (the shared 720 px breakpoint) show Conversation and Last activity only, fitted to the viewport: no sideways
// document scroll at 390 px (spec §8 item 9). Column choice and resizing apply from that width up.
const NARROW_QUERY = '(max-width: 720px)';
const NARROW_COLUMNS: readonly ArchiveSort[] = [ArchiveSort.Title, ArchiveSort.LastTimestamp];
function useNarrow(): boolean {
  const query = useMemo(() => window.matchMedia(NARROW_QUERY), []);
  return useSyncExternalStore(listener => { query.addEventListener('change', listener); return () => query.removeEventListener('change', listener); }, () => query.matches);
}
/**
 * The conversation last opened from the Archive: its latest authorized row and the Archive's refresh count. A session view of
 * that conversation reads it (owner's route cache, instance ARCHIVE_OPENED_INSTANCE) for the row's HEAD, its matched or
 * published view as the initial view, and the refresh count to revalidate with the list, as the Archive's dialog did.
 */
export interface OpenedArchiveRow { readonly row: ArchiveRow; readonly refresh: number }
export const ARCHIVE_OPENED = routeSlot<OpenedArchiveRow | null>('archive-opened', () => null);
export const ARCHIVE_OPENED_INSTANCE = 'archive';
// sort/direction are the remembered column order; the server applies relevance only when preferRelevance is set and the expression has positive text.
// `selection` is the conversation last opened from the list: focus returns to its row when the list is shown again.
export interface ArchiveState { submitted: string; sort: ArchiveSort; direction: SortDirection; preferRelevance: boolean; selection: string | null }
export function emptyArchive(): ArchiveState { return { submitted: '', sort: ArchiveSort.LastTimestamp, direction: SortDirection.Desc, preferRelevance: true, selection: null }; }
interface When { absolute: string; relative: string }
function when(value: string | undefined, now: number): When | null {
  if (value === undefined) return null;
  const date = new Date(value), age = now - date.getTime();
  // `Nov 17, 21:08` in the browser's zone; dates of another year show the year instead of the time (spec §5 rule 9).
  const absolute = date.getFullYear() === new Date(now).getFullYear() ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const relative = age < MINUTE_MS ? 'just now' : age < HOUR_MS ? `${Math.round(age / MINUTE_MS)} min ago` : age < DAY_MS ? `${Math.round(age / HOUR_MS)} h ago` : `${Math.round(age / DAY_MS)} d ago`;
  return { absolute, relative };
}
const JOB_STATUS: Readonly<Record<JobState, { label: string; variant: string }>> = {
  [JobState.Complete]: { label: 'Complete', variant: 'status status-ok' }, [JobState.Queued]: { label: 'Queued', variant: 'status' },
  [JobState.Running]: { label: 'Running', variant: 'status status-run' }, [JobState.Failed]: { label: 'Failed', variant: 'status status-danger' },
};
const UNSCHEDULED = { label: 'Unscheduled', variant: 'status status-idle' };
const jobStatus = (row: ArchiveRow) => row.headJob === undefined ? UNSCHEDULED : JOB_STATUS[row.headJob.state];
// The sub-line shows the first tags; the cell tooltip lists all of them.
const SUBLINE_TAGS = 3;
const chips = (tags: readonly string[]) => tags.map(tag => <span className="chip" key={tag}>{tag}</span>);
const tagPreview = (tags: readonly string[]) => tags.length === 0 ? <span>No tags</span> : <>{chips(tags.slice(0, SUBLINE_TAGS))}{tags.length > SUBLINE_TAGS && <span className="chip chip-outline">+{tags.length - SUBLINE_TAGS}</span>}</>;
interface ArchiveColumn { sort: ArchiveSort; label: string; cell: string | undefined; title(row: ArchiveRow): string | undefined; render(row: ArchiveRow, now: number, open: (id: string) => void): ReactNode }
const columns: readonly ArchiveColumn[] = [
  { sort: ArchiveSort.LastTimestamp, label: 'Last activity', cell: undefined, title: row => row.lastTimestamp, render: (row, now) => { const time = when(row.lastTimestamp, now); return time === null ? 'Not recorded' : <><time dateTime={row.lastTimestamp}>{time.absolute}</time><span className="when-rel">{time.relative}</span></>; } },
  { sort: ArchiveSort.Title, label: 'Conversation', cell: 'col-pin', title: row => `${row.head.metadata.title}\nHEAD r${row.head.revision} · ${row.publishedView === undefined ? 'Not indexed' : `published r${row.publishedView.revision}`}`, render: (row, _now, open) => <>
    <a className="cell-title table-title" href={formatRoute(sessionRoute(row.head.id))} onClick={() => open(row.head.id)}>{row.head.metadata.title || 'Untitled conversation'}</a>
    <div className="cell-sub row-tags" title={row.tags.join(', ')}>{tagPreview(row.tags)}<span className="cell-sep">{row.head.metadata.producer}</span></div>
  </> },
  { sort: ArchiveSort.Owner, label: 'User', cell: undefined, title: row => row.head.ownerId, render: row => row.head.ownerId },
  { sort: ArchiveSort.Project, label: 'Project', cell: undefined, title: row => row.head.metadata.project, render: row => row.head.metadata.project ?? '—' },
  { sort: ArchiveSort.Branch, label: 'Branch', cell: 'col-mono', title: row => row.head.metadata.gitBranch, render: row => row.head.metadata.gitBranch ?? '—' },
  { sort: ArchiveSort.Producer, label: 'Producer', cell: undefined, title: row => row.head.metadata.producer, render: row => row.head.metadata.producer },
  { sort: ArchiveSort.Format, label: 'Format', cell: undefined, title: row => row.head.source.format, render: row => row.head.source.format },
  { sort: ArchiveSort.Model, label: 'Model', cell: undefined, title: row => row.head.metadata.model, render: row => row.head.metadata.model ?? '—' },
  { sort: ArchiveSort.Status, label: 'Index status', cell: undefined, title: row => jobStatus(row).label, render: row => { const status = jobStatus(row); return <span className={status.variant}>{status.label}</span>; } },
  { sort: ArchiveSort.MessageCount, label: 'Messages', cell: 'col-num', title: row => row.messageCount.toLocaleString(), render: row => row.messageCount.toLocaleString() },
  { sort: ArchiveSort.Tags, label: 'Tags', cell: undefined, title: row => row.tags.join(', '), render: row => <span className="cell-chips">{chips(row.tags)}</span> },
];
// Widths include the cell padding; Conversation takes the remaining width (spec §3.1: six default columns of the eleven).
const COLUMN_WIDTHS: Readonly<Partial<Record<ArchiveSort, { min: number; ideal: number; max: number }>>> = {
  [ArchiveSort.LastTimestamp]: { min: 136, ideal: 150, max: 170 }, [ArchiveSort.Title]: { min: 220, ideal: 420, max: 2400 }, [ArchiveSort.Project]: { min: 130, ideal: 150, max: 200 },
  [ArchiveSort.Branch]: { min: 160, ideal: 230, max: 240 }, [ArchiveSort.Status]: { min: 124, ideal: 140, max: 160 }, [ArchiveSort.MessageCount]: { min: 104, ideal: 110, max: 120 },
};
const OTHER_COLUMN = { min: 80, ideal: 140, max: 240 };
const DEFAULT_COLUMNS: readonly ArchiveSort[] = [ArchiveSort.LastTimestamp, ArchiveSort.Title, ArchiveSort.Project, ArchiveSort.Branch, ArchiveSort.Status, ArchiveSort.MessageCount];
const archiveColumns: readonly TableColumnSpec[] = columns.map(column => ({ id: column.sort, label: column.label, ...(COLUMN_WIDTHS[column.sort] ?? OTHER_COLUMN),
  grow: column.sort === ArchiveSort.Title, required: column.sort === ArchiveSort.Title, compact: DEFAULT_COLUMNS.includes(column.sort) }));
const columnLabel = (sort: ArchiveSort) => columns.find(column => column.sort === sort)!.label;
const plural = (count: bigint, noun: string) => `${count.toLocaleString()} ${noun}${count === 1n ? '' : 's'}`;
export function Archive({ connection, requests, stats, user, draft, setDraft, archive, setArchive }: { connection: ChronicleConnection; requests: ArchiveReadLane; findReads: SessionFindReadGate; stats: ManagerStats; user: UserInfo; draft: string; setDraft: (value: string) => void; archive: ArchiveState; setArchive: Dispatch<SetStateAction<ArchiveState>> }) {
  const [refresh, setRefresh] = useState(0), [composing, setComposing] = useState(false);
  const [readScope] = useState(() => Symbol('Archive mount')), mounted = useRef(true), timer = useRef<number | null>(null), input = useRef<HTMLInputElement>(null), main = useRef<HTMLElement>(null);
  const cache = useContext(RouteStateContext);
  if (cache === null) throw new Error('Archive requires a RouteStateContext provider');
  const chains = cache.read(ARCHIVE_CHAINS, ARCHIVE_CHAINS_INSTANCE), choices = useMemo(() => browserColumnChoices(window.localStorage, COLUMN_CHOICES_KEY), []);
  const queryStamp = JSON.stringify([user.id, stats.generation, stats.activeId, archive.submitted, archive.sort, archive.direction, archive.preferRelevance]);
  const currentQuery = useRef(queryStamp); currentQuery.current = queryStamp;
  const liveStamp = JSON.stringify([queryStamp, draft, composing]), currentLive = useRef(liveStamp); currentLive.current = liveStamp;
  const incomplete = incompleteExpression(draft);
  function cancelTimer() { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } }
  function refreshArchive() { if (!requests.queued(readScope)) setRefresh(value => value + 1); }
  function change(value: string) { cancelTimer(); setDraft(value); }
  function compositionChange(value: boolean) { cancelTimer(); setComposing(value); }
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelTimer(); requests.cancel(readScope); }; }, [requests, readScope]);
  useEffect(() => {
    cancelTimer();
    if (composing || incomplete || stats.activeId === null || draft === archive.submitted) return;
    timer.current = window.setTimeout(() => { timer.current = null; if (mounted.current && currentLive.current === liveStamp) submit(draft); }, ARCHIVE_DEBOUNCE_MS);
    return cancelTimer;
  }, [connection, requests, liveStamp, incomplete]);
  useEffect(() => { const timer = window.setInterval(refreshArchive, ARCHIVE_REFRESH_MS); return () => window.clearInterval(timer); }, [requests, readScope]);
  const results = useSettledInfiniteResource<ArchiveRow, ArchiveResult, string>(chains, connection, stats, `${user.id}:${JSON.stringify([archive.submitted, archive.sort, archive.direction, archive.preferRelevance])}`, `${refresh}`, true, undefined, async cursor => {
    const query = new ArchiveQuery(archive.submitted, archive.sort, archive.direction, cursor, ARCHIVE_PAGE_SIZE, archive.preferRelevance);
    const result = await requests.request(readScope, () => mounted.current && currentQuery.current === queryStamp, () => read(connection, new Operation_Archive(query), value => value instanceof Result_Archive ? value.result : null));
    return { items: result.rows, next: result.nextCursor, previous: undefined, meta: result };
  }, row => row.head.id);
  const narrow = useNarrow(), table = useStoredTableColumns(choices, archiveColumns, results.items.length, !narrow);
  const shownColumns = narrow ? NARROW_COLUMNS.map(sort => columns.find(column => column.sort === sort)!) : columns.filter(column => table.columns.some(item => item.spec.id === column.sort));
  useLayoutEffect(() => { const element = table.table.current; if (element !== null) element.style.setProperty('width', narrow ? '100%' : `${table.width}px`); });
  const colgroup = narrow ? <colgroup><col/><col className="archive-col-when"/></colgroup> : <TableColumnGroup layout={table}/>;
  const relevanceOrdered = results.meta !== null && results.meta.relevanceOrdered, columnOrdered = !relevanceOrdered;
  const failed = results.error !== null && results.appendError === null;
  const sentinel = useInfiniteSentinel<HTMLDivElement>(results.hasMore && results.error === null, results.loadingMore || results.refreshing, results.loadMore);
  // Focus returns to the row last opened when the list is shown again (Back from the session page, a tab round trip): the
  // shell hides a retained view (`hidden` on an ancestor) and renders it again when it is shown.
  const shown = useRef(false);
  useLayoutEffect(() => {
    const element = main.current;
    if (element === null) throw new Error('Archive main element missing');
    const visible = element.closest('[hidden]') === null, id = archive.selection;
    if (visible && !shown.current && id !== null && !element.contains(document.activeElement)) {
      const link = element.querySelector<HTMLAnchorElement>(`tr[data-row-id="${CSS.escape(id)}"] a.cell-title`);
      if (link !== null) link.focus({ preventScroll: true });
    }
    shown.current = visible;
  });
  // The list is the access fence of a conversation opened from it: when a settled refresh no longer lists that conversation
  // (access revoked), its session view is left as Back would (the entry was pushed from this list).
  useEffect(() => {
    const id = archive.selection;
    if (id === null || results.meta === null || results.loading || results.refreshing || results.error !== null || results.items.some(row => row.head.id === id)) return;
    const fragment = parseFragment(window.location.hash);
    if (fragment.kind === 'route' && fragment.route.view === 'session' && sessionIdOf(fragment.route) === id) window.history.back();
    setArchive(value => value.selection === id ? { ...value, selection: null } : value);
  }, [archive.selection, results.items, results.meta, results.loading, results.refreshing, results.error]);
  const [, setOpened] = useRouteState(ARCHIVE_OPENED, ARCHIVE_OPENED_INSTANCE);
  useEffect(() => {
    const row = archive.selection === null ? undefined : results.items.find(item => item.head.id === archive.selection);
    setOpened(row === undefined ? null : { row, refresh });
  }, [archive.selection, results.items, refresh, setOpened]);
  function open(id: string) { setArchive(value => ({ ...value, selection: id })); }
  function submit(expression: string) { cancelTimer(); if (expression !== archive.submitted) requests.cancel(readScope); else refreshArchive(); setArchive(value => ({ ...value, submitted: expression, selection: null })); }
  function sortBy(sort: ArchiveSort) { setArchive(value => ({ ...value, sort, direction: columnOrdered && value.sort === sort ? value.direction === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc : sort === ArchiveSort.LastTimestamp ? SortDirection.Desc : SortDirection.Asc, preferRelevance: false, selection: null })); }
  // The order toggle is offered for queries with text (the server orders them by relevance) and while a manual column order
  // replaces relevance; it stays while a changed order is read.
  const [textQuery, setTextQuery] = useState<string | null>(null);
  useEffect(() => { if (results.meta !== null && (results.meta.relevanceOrdered || archive.preferRelevance)) setTextQuery(results.meta.relevanceOrdered ? archive.submitted : null); }, [results.meta]);
  const orderShown = archive.submitted !== '' && (!archive.preferRelevance || relevanceOrdered || textQuery === archive.submitted);
  const pending = draft === archive.submitted ? null : composing ? 'Finish composing to update the search.' : incomplete ? 'Complete the expression to update the search.' : 'Waiting for typing to pause…';
  const total = results.meta === null ? null : results.meta.total;
  const counter = pending !== null ? <span data-state="pending">{pending}</span>
    : results.loading ? 'Loading conversations…' : total === null ? 'Not loaded' : total === 0n ? archive.submitted === '' ? 'No conversations' : 'No matches'
    : <><strong>{total.toLocaleString()}</strong> conversation{total === 1n ? '' : 's'} · {results.hasMore ? `${results.items.length.toLocaleString()} loaded` : 'all loaded'}</>;
  const boundedHelp = results.meta?.textScope === ArchiveTextScope.BoundedCandidateSets ? <p>This result uses up to {results.meta.annChunkLimitPerOperand} authorized published chunks per distinct text operand before session deduplication, not a row limit. Its total is exact under those bounded candidate sets.</p> : null;
  const remaining = total === null ? 0 : Math.min(ARCHIVE_PAGE_SIZE, Number(total) - results.items.length);
  const now = Date.now();
  return <main className="archive-view" aria-label="Archive" ref={main}>
    <div className="viewbar archive-viewbar">
      <QueryBar inputRef={input} label="Archive search" placeholder={PLACEHOLDER} value={draft} applied={archive.submitted} change={change} submit={submit} disabled={stats.activeId === null} completion={{ connection, stats, owner: user.id, target: new ExpressionHintTarget_Archive() }} compositionChange={compositionChange} composing={composing} submission="live"/>
      <div className="viewbar-meta" role="status" aria-label="Archive status">{counter}</div>
      <button type="button" className="btn btn-ghost btn-icon" aria-label="Refresh archive" title="Refresh" onClick={refreshArchive}><Icon name="refresh" small={false}/></button>
      {!narrow && <ColumnMenu name="Conversations" layout={table}/>}
    </div>
    <FilterBar expression={draft} change={change} input={input} fields={archiveFields} metadata={false} presets={conversationPresets(user.id)} trailing={<div className="sortline">
      {orderShown && <><span aria-hidden="true">Order</span><div className="segmented" role="group" aria-label="Result order">
        <button type="button" aria-pressed={archive.preferRelevance} title="Order expressions with positive text by relevance. Metadata-only expressions keep the column order." onClick={() => setArchive(value => value.preferRelevance ? value : { ...value, preferRelevance: true, selection: null })}>Relevance</button>
        <button type="button" aria-pressed={!archive.preferRelevance} onClick={() => setArchive(value => value.preferRelevance ? { ...value, preferRelevance: false, selection: null } : value)}>{columnLabel(archive.sort)}</button>
      </div></>}
      <SyntaxHelp extra={boundedHelp}/>
    </div>}/>
    {failed && <div className="page archive-notice"><div className="notice notice-danger" role="alert"><Icon name="alert" small={false}/><div><div className="notice-title">Conversations could not be loaded</div>{results.error} No fallback search was used.<div className="notice-actions"><button type="button" className="btn btn-sm" onClick={refreshArchive}>Retry</button></div></div></div></div>}
    {results.updateAvailable && <div className="update-pill"><button type="button" onClick={results.applyUpdates}><Icon name="arrow-up" small={true}/>Updates available · show latest</button></div>}
    {!failed && <ScrollAnchor><div className="archive-table-frame" ref={table.container} data-scroll-container="">
      <table className="table table-2line archive-table" ref={table.table} aria-label="Conversations" data-list="archive" aria-busy={results.loading || results.refreshing}>{colgroup}
        <thead><tr>{shownColumns.map(column => { const sorted = columnOrdered && archive.sort === column.sort; return <th key={column.sort} className={column.cell === 'col-mono' ? undefined : column.cell} data-column-id={column.sort} scope="col" aria-sort={sorted ? archive.direction === SortDirection.Asc ? 'ascending' : 'descending' : undefined}>
          <button type="button" className="th-sort" onClick={() => sortBy(column.sort)} aria-label={`Sort by ${column.label}`}>{column.label}</button>{!narrow && <ColumnResize column={table.columns.find(item => item.spec.id === column.sort)!} layout={table}/>}
        </th>; })}</tr></thead>
        <tbody>{results.items.map(row => { const href = formatRoute(sessionRoute(row.head.id)); return <tr className="archive-row" key={row.head.id} data-row-id={row.head.id} data-scroll-anchor={row.head.id} onClick={event => { if ((event.target as Element).closest('button,a,input,select,summary') === null) { open(row.head.id); window.location.hash = href; } }}>
          {shownColumns.map(column => <td key={column.sort} className={column.cell} data-column-id={column.sort} title={column.title(row)}>{column.render(row, now, open)}</td>)}
        </tr>; })}</tbody>
      </table>
      {results.loading && results.items.length === 0 && <table className="table table-2line archive-skeleton" aria-hidden="true">{colgroup}<tbody>{Array.from({ length: SKELETON_ROWS }, (_, index) => <tr key={index}>{shownColumns.map(column => <td key={column.sort}><span className={column.sort === ArchiveSort.Title || column.sort === ArchiveSort.LastTimestamp ? 'skeleton sk-60' : 'skeleton'}/>{column.sort === ArchiveSort.Title && <span className="skeleton sk-30"/>}</td>)}</tr>)}</tbody></table>}
      {results.meta !== null && results.items.length === 0 && !results.updateAvailable && <div className="empty" data-list-state="empty"><Icon name="search" small={false}/><h2>No matching conversations</h2>
        <p>{archive.submitted === '' ? 'No conversations are archived for you yet.' : <>Nothing matches <code>{archive.submitted}</code>. Check the spelling of field values or remove a condition.</>}</p>
        {archive.submitted !== '' && <div className="row"><button type="button" className="btn" onClick={() => { change(''); submit(''); }}>Clear filter</button></div>}</div>}
      {results.meta !== null && results.items.length > 0 && (results.appendError !== null
        ? <div className="list-foot" data-list-state="append-error"><span role="alert">Could not load more conversations: {results.appendError}</span><button type="button" className="btn btn-sm" onClick={results.retryAppend}>Retry</button></div>
        : results.hasMore ? <div className="list-foot" ref={sentinel} data-list-state="more"><span className="spinner" aria-hidden="true"/>Loading {remaining.toLocaleString()} more…<span className="list-foot-count">({results.items.length.toLocaleString()} of {total!.toLocaleString()})</span></div>
        : <div className="list-foot list-end" data-list-state="end">End of list · {plural(total!, 'conversation')}</div>)}
    </div></ScrollAnchor>}
  </main>;
}
