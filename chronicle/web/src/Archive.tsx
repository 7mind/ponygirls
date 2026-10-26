import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ArchiveQuery, ArchiveSort, ArchiveTextScope, SortDirection, Operation_Archive, Result_Archive, type ArchiveResult, type ArchiveRow, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useInfiniteResource } from './infinite.ts';
import { InfiniteTrigger } from './InfiniteTrigger.tsx';
import { ScrollAnchor } from './ScrollAnchor.tsx';
import { ExpressionEditor } from './ExpressionEditor.tsx';
import type { QuickFilterField } from './ExpressionEditor.tsx';
import { Dialog } from './Dialog.tsx';
import { Conversation } from './Conversation.tsx';
import { Blank, ErrorNotice, Tags } from './App.tsx';
import type { ManagerStats } from './transport/types.ts';
import './archive.css';
const ARCHIVE_PAGE_SIZE = 50;
const ARCHIVE_REFRESH_MS = 20_000;
export interface ArchiveState { submitted: string; sort: ArchiveSort; direction: SortDirection; selection: string | null; selectionKey: number }
export function emptyArchive(): ArchiveState { return { submitted: '', sort: ArchiveSort.LastTimestamp, direction: SortDirection.Desc, selection: null, selectionKey: 0 }; }
const columns: readonly { sort: ArchiveSort; label: string }[] = [
  { sort: ArchiveSort.LastTimestamp, label: 'Last activity' }, { sort: ArchiveSort.Title, label: 'Conversation' }, { sort: ArchiveSort.Owner, label: 'User' },
  { sort: ArchiveSort.Project, label: 'Project' }, { sort: ArchiveSort.Branch, label: 'Branch' }, { sort: ArchiveSort.Producer, label: 'Producer' },
  { sort: ArchiveSort.Format, label: 'Format' }, { sort: ArchiveSort.Model, label: 'Model' }, { sort: ArchiveSort.Status, label: 'Index status' },
  { sort: ArchiveSort.MessageCount, label: 'Messages' }, { sort: ArchiveSort.Tags, label: 'Tags' },
];
function loadedFields(rows: readonly ArchiveRow[]): QuickFilterField[] {
  const values = (readValue: (row: ArchiveRow) => readonly string[]) => [...new Set(rows.flatMap(readValue))].filter(value => value.length > 0).sort((left, right) => left.localeCompare(right));
  return [
    { attribute: 'user', label: 'User', values: values(row => [row.head.ownerId]) }, { attribute: 'project', label: 'Project', values: values(row => [row.head.metadata.project ?? '']) },
    { attribute: 'branch', label: 'Branch', values: values(row => [row.head.metadata.gitBranch ?? '']) }, { attribute: 'tag', label: 'Tag', values: values(row => row.tags) },
    { attribute: 'producer', label: 'Producer', values: values(row => [row.head.metadata.producer]) }, { attribute: 'format', label: 'Format', values: values(row => [row.head.source.format.toLowerCase()]) },
    { attribute: 'model', label: 'Model', values: values(row => [row.head.metadata.model ?? '']) }, { attribute: 'status', label: 'Index status', values: values(row => [row.headJob === undefined ? 'unscheduled' : row.headJob.state.toLowerCase()]) },
    { attribute: 'after', label: 'After (inclusive UTC)', values: [] }, { attribute: 'before', label: 'Before (exclusive UTC)', values: [] },
  ];
}
function timestamp(value: string | undefined): string { return value === undefined ? 'Not recorded' : new Date(value).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
export function Archive({ connection, stats, user, draft, setDraft, archive, setArchive }: { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; draft: string; setDraft: (value: string) => void; archive: ArchiveState; setArchive: Dispatch<SetStateAction<ArchiveState>> }) {
  const [refresh, setRefresh] = useState(0), [relatedSelection, setRelatedSelection] = useState<string | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setRefresh(value => value + 1), ARCHIVE_REFRESH_MS); return () => window.clearInterval(timer); }, []);
  const results = useInfiniteResource<ArchiveRow, ArchiveResult, string>(connection, stats, `${user.id}:${JSON.stringify([archive.submitted, archive.sort, archive.direction])}`, `${refresh}`, true, undefined, async cursor => {
    const result = await read(connection, new Operation_Archive(new ArchiveQuery(archive.submitted, archive.sort, archive.direction, cursor, ARCHIVE_PAGE_SIZE)), value => value instanceof Result_Archive ? value.result : null);
    return { items: result.rows, next: result.nextCursor, previous: undefined, meta: result };
  }, row => row.head.id);
  const selected = results.items.find(row => row.head.id === archive.selection);
  useEffect(() => {
    if (archive.selection !== null && results.meta !== null && selected === undefined) { setArchive(value => ({ ...value, selection: null })); setRelatedSelection(null); }
  }, [archive.selection, results.meta, selected, setArchive]);
  function choose(id: string) { setRelatedSelection(null); setArchive(value => ({ ...value, selection: id, selectionKey: value.selectionKey + 1 })); }
  function close() { setRelatedSelection(null); setArchive(value => ({ ...value, selection: null })); }
  function submit(expression: string) { setArchive(value => ({ ...value, submitted: expression, selection: null })); setRelatedSelection(null); setRefresh(value => value + 1); }
  return <main className="archive archive-table-page"><ExpressionEditor value={draft} change={setDraft} submit={submit} disabled={stats.activeId === null} fields={loadedFields(results.items)} help={results.meta?.textScope === ArchiveTextScope.BoundedCandidateSets ? <p>This result uses up to {results.meta.annChunkLimitPerOperand} authorized published chunks per distinct text operand before session deduplication, not a row limit. Its total is exact under those bounded candidate sets.</p> : null}/> 
    <ScrollAnchor><div className="archive-context"><button className="text-button" aria-label="Refresh archive" onClick={() => setRefresh(value => value + 1)}>Refresh ↻</button><span role="status">{results.loading ? 'Loading conversations…' : results.meta === null ? 'Archive unavailable' : `${results.meta.total.toString()} conversations · ${results.items.length} shown`}{results.refreshing ? ' · Checking access…' : ''}</span>{results.updateAvailable && <button className="text-button" onClick={results.applyUpdates}>Updates available · show latest</button>}<span className="tiny">HEAD metadata · server-sorted · UUID tie-breaker</span></div>
      {results.error !== null && <ErrorNotice>{results.error} No fallback search was used.</ErrorNotice>}
      <div className="archive-table-scroll" data-scroll-container><table className="archive-table" aria-label="Conversations" aria-busy={results.loading || results.refreshing}><thead><tr>{columns.map(column => <th key={column.sort} scope="col" aria-sort={archive.sort === column.sort ? archive.direction === SortDirection.Asc ? 'ascending' : 'descending' : 'none'}><button onClick={() => setArchive(value => ({ ...value, sort: column.sort, direction: value.sort === column.sort ? value.direction === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc : column.sort === ArchiveSort.LastTimestamp ? SortDirection.Desc : SortDirection.Asc, selection: null }))} aria-label={`Sort by ${column.label}`}>{column.label}<span aria-hidden="true">{archive.sort === column.sort ? archive.direction === SortDirection.Asc ? ' ↑' : ' ↓' : ' ↕'}</span></button></th>)}</tr></thead><tbody>{results.items.map(row => <tr className="archive-row" key={row.head.id} data-session-id={row.head.id} data-scroll-anchor={row.head.id} onClick={event => { if ((event.target as Element).closest('button,a,input,select,summary') === null) choose(row.head.id); }}>
        <td className="timestamp-cell"><time dateTime={row.lastTimestamp}>{timestamp(row.lastTimestamp)}</time></td><td className="title-cell"><button className="table-title" onClick={() => choose(row.head.id)}>{row.head.metadata.title || 'Untitled conversation'}</button><span className="row-lineage">HEAD r{row.head.revision} · {row.publishedView === undefined ? 'Not indexed' : `published r${row.publishedView.revision}`}{row.publishedView !== undefined && row.publishedView.revision < row.head.revision ? ' · indexing lag' : ''}</span></td>
        <td>{row.head.ownerId}</td><td>{row.head.metadata.project ?? '—'}</td><td>{row.head.metadata.gitBranch ?? '—'}</td><td>{row.head.metadata.producer}</td><td>{row.head.source.format}</td><td>{row.head.metadata.model ?? '—'}</td><td><span className={`job-state state-${row.headJob === undefined ? 'unscheduled' : row.headJob.state.toLowerCase()}`}>{row.headJob === undefined ? 'Unscheduled' : row.headJob.state}</span></td><td className="number-cell">{row.messageCount.toLocaleString()}</td><td><Tags tags={row.tags}/></td>
      </tr>)}</tbody></table>{results.loading && <div className="loading-line" role="status">Retrieving an authorized archive page…</div>}{results.meta !== null && results.items.length === 0 && !results.updateAvailable && <Blank title="No matching conversations">Change the expression or clear it to browse every authorized archive HEAD.</Blank>}<InfiniteTrigger enabled={results.hasMore && results.error === null} loading={results.loadingMore || results.refreshing} load={results.loadMore} label="Loading more conversations…"/></div>
    </ScrollAnchor>{selected !== undefined && <Dialog title="Source conversation" close={close}><Conversation key={`${relatedSelection ?? selected.head.id}:${archive.selectionKey}`} connection={connection} stats={stats} user={user} sessionId={relatedSelection ?? selected.head.id} initialView={relatedSelection === null ? selected.matchedView ?? selected.publishedView ?? selected.head.view : undefined} archiveHead={relatedSelection === null ? selected : null} select={setRelatedSelection} refresh={refresh}/></Dialog>}
  </main>;
}
