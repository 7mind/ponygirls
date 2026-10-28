import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { ExpressionHintTarget_Archive, ArchiveQuery, ArchiveSort, ArchiveTextScope, SortDirection, Operation_Archive, Result_Archive, type ArchiveResult, type ArchiveRow, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useInfiniteResource } from './infinite.ts';
import type { ArchiveReadLane } from './archive-requests.ts';
import { incompleteExpression } from './expression.ts';
import { InfiniteTrigger } from './InfiniteTrigger.tsx';
import { ScrollAnchor } from './ScrollAnchor.tsx';
import { ExpressionEditor } from './ExpressionEditor.tsx';
import type { FilterField } from './FilterShortcuts.tsx';
import { useTableColumns, TableControls, TableColumnGroup, ColumnResize } from './TableColumns.tsx';
import type { TableColumnSpec } from './table-widths.ts';
import { Dialog } from './Dialog.tsx';
import { Conversation } from './Conversation.tsx';
import type { SessionFindReadGate } from './session-find.ts';
import { Blank, ErrorNotice, Tags } from './App.tsx';
import type { ManagerStats } from './transport/types.ts';
import './archive.css';
const ARCHIVE_PAGE_SIZE = 50;
const ARCHIVE_REFRESH_MS = 20_000;
const ARCHIVE_DEBOUNCE_MS = 350;
export interface ArchiveState { submitted: string; sort: ArchiveSort; direction: SortDirection; selection: string | null; selectionKey: number }
export function emptyArchive(): ArchiveState { return { submitted: '', sort: ArchiveSort.LastTimestamp, direction: SortDirection.Desc, selection: null, selectionKey: 0 }; }
interface ArchiveColumn { sort: ArchiveSort; label: string; title(row: ArchiveRow): string | undefined; render(row: ArchiveRow, choose: (id: string) => void): ReactNode }
const columns: readonly ArchiveColumn[] = [
  { sort: ArchiveSort.LastTimestamp, label: 'Last activity', title: row => row.lastTimestamp, render: row => <time dateTime={row.lastTimestamp}>{timestamp(row.lastTimestamp)}</time> },
  { sort: ArchiveSort.Title, label: 'Conversation', title: row => `${row.head.metadata.title}\nHEAD r${row.head.revision} · ${row.publishedView === undefined ? 'Not indexed' : `published r${row.publishedView.revision}`}`, render: (row, choose) => <><button className="table-title" onClick={() => choose(row.head.id)}>{row.head.metadata.title || 'Untitled conversation'}</button><span className="row-tags" title={row.tags.join(', ')}>{row.tags.length === 0 ? 'No tags' : row.tags.join(' · ')}</span></> },
  { sort: ArchiveSort.Owner, label: 'User', title: row => row.head.ownerId, render: row => row.head.ownerId },
  { sort: ArchiveSort.Project, label: 'Project', title: row => row.head.metadata.project, render: row => row.head.metadata.project ?? '—' },
  { sort: ArchiveSort.Branch, label: 'Branch', title: row => row.head.metadata.gitBranch, render: row => row.head.metadata.gitBranch ?? '—' },
  { sort: ArchiveSort.Producer, label: 'Producer', title: row => row.head.metadata.producer, render: row => row.head.metadata.producer },
  { sort: ArchiveSort.Format, label: 'Format', title: row => row.head.source.format, render: row => row.head.source.format },
  { sort: ArchiveSort.Model, label: 'Model', title: row => row.head.metadata.model, render: row => row.head.metadata.model ?? '—' },
  { sort: ArchiveSort.Status, label: 'Index status', title: row => row.headJob === undefined ? 'Unscheduled' : row.headJob.state, render: row => <><span className={`job-state state-${row.headJob === undefined ? 'unscheduled' : row.headJob.state.toLowerCase()}`}>{row.headJob === undefined ? 'Unscheduled' : row.headJob.state}</span></> },
  { sort: ArchiveSort.MessageCount, label: 'Messages', title: row => row.messageCount.toLocaleString(), render: row => row.messageCount.toLocaleString() },
  { sort: ArchiveSort.Tags, label: 'Tags', title: row => row.tags.join(', '), render: row => <Tags tags={row.tags}/> },
];
const archiveFields: readonly FilterField[] = [
  { attribute: 'project', label: 'Project' }, { attribute: 'branch', label: 'Branch' }, { attribute: 'tag', label: 'Tag' }, { attribute: 'user', label: 'User' },
  { attribute: 'producer', label: 'Producer' }, { attribute: 'format', label: 'Format' }, { attribute: 'model', label: 'Model' }, { attribute: 'agent', label: 'Agent' }, { attribute: 'yolo-profile', label: 'Recorded yolo profile' }, { attribute: 'status', label: 'Status' },
  { attribute: 'after', label: 'After' }, { attribute: 'before', label: 'Before' },
];
const archiveColumns: readonly TableColumnSpec[] = columns.map(column => ({ id: column.sort, label: column.label,
  min: column.sort === ArchiveSort.Title ? 180 : column.sort === ArchiveSort.LastTimestamp ? 110 : 65,
  ideal: column.sort === ArchiveSort.Title ? 300 : column.sort === ArchiveSort.LastTimestamp ? 155 : 110,
  max: column.sort === ArchiveSort.Title ? 950 : 400, grow: column.sort === ArchiveSort.Title, required: column.sort === ArchiveSort.Title,
  compact: [ArchiveSort.LastTimestamp, ArchiveSort.Title, ArchiveSort.Project, ArchiveSort.Branch, ArchiveSort.Status, ArchiveSort.MessageCount].includes(column.sort),
}));
function timestamp(value: string | undefined): string { return value === undefined ? 'Not recorded' : new Date(value).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
export function Archive({ connection, requests, findReads, stats, user, draft, setDraft, archive, setArchive }: { connection: ChronicleConnection; requests: ArchiveReadLane; findReads: SessionFindReadGate; stats: ManagerStats; user: UserInfo; draft: string; setDraft: (value: string) => void; archive: ArchiveState; setArchive: Dispatch<SetStateAction<ArchiveState>> }) {
  const [refresh, setRefresh] = useState(0), [relatedSelection, setRelatedSelection] = useState<string | null>(null), [composing, setComposing] = useState(false);
  const [readScope] = useState(() => Symbol('Archive mount')), mounted = useRef(true), timer = useRef<number | null>(null);
  const queryStamp = JSON.stringify([user.id, stats.generation, stats.activeId, archive.submitted, archive.sort, archive.direction]);
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
  const results = useInfiniteResource<ArchiveRow, ArchiveResult, string>(connection, stats, `${user.id}:${JSON.stringify([archive.submitted, archive.sort, archive.direction])}`, `${refresh}`, true, undefined, async cursor => {
    const query = new ArchiveQuery(archive.submitted, archive.sort, archive.direction, cursor, ARCHIVE_PAGE_SIZE);
    const result = await requests.request(readScope, () => mounted.current && currentQuery.current === queryStamp, () => read(connection, new Operation_Archive(query), value => value instanceof Result_Archive ? value.result : null));
    return { items: result.rows, next: result.nextCursor, previous: undefined, meta: result };
  }, row => row.head.id);
  const table = useTableColumns(archiveColumns, results.items.length, true), shownColumns = columns.filter(column => table.columns.some(item => item.spec.id === column.sort));
  const selected = results.items.find(row => row.head.id === archive.selection);
  useEffect(() => {
    if (archive.selection !== null && results.meta !== null && selected === undefined) { setArchive(value => ({ ...value, selection: null })); setRelatedSelection(null); }
  }, [archive.selection, results.meta, selected, setArchive]);
  function choose(id: string) { setRelatedSelection(null); setArchive(value => ({ ...value, selection: id, selectionKey: value.selectionKey + 1 })); }
  function close() { setRelatedSelection(null); setArchive(value => ({ ...value, selection: null })); }
  function submit(expression: string) { cancelTimer(); if (expression !== archive.submitted) requests.cancel(readScope); else refreshArchive(); setArchive(value => ({ ...value, submitted: expression, selection: null })); setRelatedSelection(null); }
  return <main className="archive archive-table-page"><ExpressionEditor completion={{ connection, stats, owner: user.id, target: new ExpressionHintTarget_Archive() }} value={draft} applied={archive.submitted} change={change} submit={submit} compositionChange={compositionChange} composing={composing} disabled={stats.activeId === null} fields={archiveFields} help={results.meta?.textScope === ArchiveTextScope.BoundedCandidateSets ? <p>This result uses up to {results.meta.annChunkLimitPerOperand} authorized published chunks per distinct text operand before session deduplication, not a row limit. Its total is exact under those bounded candidate sets.</p> : null}/>
    {draft !== archive.submitted && <p className="tiny" role="status">{composing ? 'Finish composing to update the search.' : incomplete ? 'Complete the expression to update the search.' : 'Waiting for typing to pause…'} The last submitted expression is unchanged.</p>}
    <ScrollAnchor><div className="archive-context"><button className="text-button" aria-label="Refresh archive" onClick={refreshArchive}>Refresh ↻</button><span role="status">{results.loading ? 'Loading conversations…' : results.meta === null ? 'Archive unavailable' : `${results.meta.total.toString()} conversations · ${results.items.length} shown`}{results.refreshing ? ' · Checking access…' : ''}</span>{results.updateAvailable && <button className="text-button" onClick={results.applyUpdates}>Updates available · show latest</button>}</div>
      {results.error !== null && <ErrorNotice>{results.error} No fallback search was used.</ErrorNotice>}
      <TableControls name="Conversations" layout={table}/>
      <div className="archive-table-scroll" ref={table.container} data-scroll-container tabIndex={0} role="region" aria-label="Archive conversations"><table className="archive-table" ref={table.table} style={{ width: table.width }} aria-label="Conversations" aria-busy={results.loading || results.refreshing}><TableColumnGroup layout={table}/><thead><tr>{shownColumns.map(column => <th key={column.sort} data-column-id={column.sort} scope="col" aria-sort={archive.sort === column.sort ? archive.direction === SortDirection.Asc ? 'ascending' : 'descending' : 'none'}><button onClick={() => setArchive(value => ({ ...value, sort: column.sort, direction: value.sort === column.sort ? value.direction === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc : column.sort === ArchiveSort.LastTimestamp ? SortDirection.Desc : SortDirection.Asc, selection: null }))} aria-label={`Sort by ${column.label}`}>{column.label}<span aria-hidden="true">{archive.sort === column.sort ? archive.direction === SortDirection.Asc ? ' ↑' : ' ↓' : ' ↕'}</span></button><ColumnResize column={table.columns.find(item => item.spec.id === column.sort)!} layout={table}/></th>)}</tr></thead><tbody>{results.items.map(row => <tr className="archive-row" key={row.head.id} data-session-id={row.head.id} data-scroll-anchor={row.head.id} onClick={event => { if ((event.target as Element).closest('button,a,input,select,summary') === null) choose(row.head.id); }}>
        {shownColumns.map(column => <td key={column.sort} data-column-id={column.sort} title={column.title(row)}>{column.render(row, choose)}</td>)}
      </tr>)}</tbody></table>{results.loading && <div className="loading-line" role="status">Retrieving an authorized archive page…</div>}{results.meta !== null && results.items.length === 0 && !results.updateAvailable && <Blank title="No matching conversations">Change the expression or clear it to browse every authorized archive HEAD.</Blank>}<InfiniteTrigger enabled={results.hasMore && results.error === null} loading={results.loadingMore || results.refreshing} load={results.loadMore} label="Loading more conversations…"/></div>
    </ScrollAnchor>{selected !== undefined && <Dialog title="Source conversation" close={close}><Conversation key={`${relatedSelection ?? selected.head.id}:${archive.selectionKey}`} connection={connection} stats={stats} user={user} sessionId={relatedSelection ?? selected.head.id} initialView={relatedSelection === null ? selected.matchedView ?? selected.publishedView ?? selected.head.view : undefined} archiveHead={relatedSelection === null ? selected : null} select={setRelatedSelection} refresh={refresh} findReads={findReads}/></Dialog>}
  </main>;
}
