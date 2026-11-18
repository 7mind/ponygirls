import { useContext, useRef } from 'react';
import { ActivityCollectorSort, ActivityJobScope, ActivityQuery, CollectorPhase, ExpressionHintTarget_ActivityCollectors, Operation_Activity, Result_Activity, type ActivityCollector, type ActivityResult, type CollectorStatus, type JobCounts, type UserInfo } from '../api.ts';
import { read, type ChronicleConnection } from '../client.ts';
import { useSettledInfiniteResource } from '../infinite.ts';
import { addMetadataFilter, validateMetadataExpression } from '../expression.ts';
import { RouteStateContext, formatRoute, useRouteState } from '../router.ts';
import type { ManagerStats } from '../transport/types.ts';
import { FilterBar, type FilterField } from '../FilterShortcuts.tsx';
import { MetadataHelp, MetadataQueryBar } from '../MetadataEditor.tsx';
import { ColumnMenu } from '../TableColumns.tsx';
import { Icon } from '../Icon.tsx';
import { Glyph } from '../Glyph.tsx';
import { formatBytes } from '../progress.ts';
import { ACTIVITY_INSTANCE, COLLECTOR_CHAINS, COLLECTORS_DRAFT, COLLECTORS_STATE, jobsRouteFor } from './state.ts';
import { withCollector } from './collector-filter.ts';
import { ListTable, count, nextOrder, useListTable, type Column } from './list.tsx';
import { When } from './time.tsx';

const PAGE_SIZE = 50;
const COLUMN_CHOICES_KEY = 'chronicle.activity.collectors.columns';
const PLACEHOLDER = 'Filter collectors — freshness:stale OR phase:uploading';
const fields: readonly FilterField[] = [{ attribute: 'collector', label: 'Collector' }, { attribute: 'phase', label: 'Phase' }, { attribute: 'freshness', label: 'Freshness' }, { attribute: 'after', label: 'After' }, { attribute: 'before', label: 'Before' }];
const presets = [{ attribute: 'freshness', label: 'Stale', value: 'stale' }];
type CountField = 'total' | 'queued' | 'running' | 'failed' | 'complete' | 'activeRunning' | 'expiredRunning' | 'unleasedRunning';
const COUNTS: readonly { field: CountField; label: string; current: ActivityCollectorSort; historical: ActivityCollectorSort; compact: boolean }[] = [
  { field: 'queued', label: 'Queued', current: ActivityCollectorSort.CurrentQueued, historical: ActivityCollectorSort.HistoricalQueued, compact: true },
  { field: 'running', label: 'Running', current: ActivityCollectorSort.CurrentRunning, historical: ActivityCollectorSort.HistoricalRunning, compact: true },
  { field: 'failed', label: 'Failed', current: ActivityCollectorSort.CurrentFailed, historical: ActivityCollectorSort.HistoricalFailed, compact: true },
  { field: 'complete', label: 'Complete', current: ActivityCollectorSort.CurrentComplete, historical: ActivityCollectorSort.HistoricalComplete, compact: true },
  { field: 'total', label: 'Total', current: ActivityCollectorSort.CurrentTotal, historical: ActivityCollectorSort.HistoricalTotal, compact: false },
  { field: 'activeRunning', label: 'Active leases', current: ActivityCollectorSort.CurrentActiveRunning, historical: ActivityCollectorSort.HistoricalActiveRunning, compact: false },
  { field: 'expiredRunning', label: 'Expired leases', current: ActivityCollectorSort.CurrentExpiredRunning, historical: ActivityCollectorSort.HistoricalExpiredRunning, compact: false },
  { field: 'unleasedRunning', label: 'Unleased', current: ActivityCollectorSort.CurrentUnleasedRunning, historical: ActivityCollectorSort.HistoricalUnleasedRunning, compact: false },
];
export function freshness(row: ActivityCollector): { label: string; status: string } {
  return row.status === undefined ? { label: 'Unknown', status: 'status status-idle' } : row.status.stale ? { label: 'Stale', status: 'status status-warn' } : { label: 'Recent', status: 'status status-ok' };
}
// A collector's jobs: `collector:"<id>"` last, so that the Jobs view shows it as its removable chip (collector-filter.ts).
const jobsOf = (id: string, status: string | null) => formatRoute(jobsRouteFor(withCollector(status === null ? '' : addMetadataFilter('', 'status', status), id), ActivityJobScope.Current));
const NUMBER = { min: 72, ideal: 88, max: 140 };
const columns: readonly Column<ActivityCollector, ActivityCollectorSort>[] = [
  { sort: ActivityCollectorSort.CollectorId, label: 'Collector', cell: undefined, width: { min: 160, ideal: 260, max: 400 }, compact: true, narrow: true, required: true, title: row => row.collectorId, render: row => <span className="cell-title mono">{row.collectorId}</span> },
  { sort: ActivityCollectorSort.Phase, label: 'Phase', cell: undefined, width: { min: 96, ideal: 120, max: 200 }, compact: true, narrow: false, required: false, title: row => row.status === undefined ? 'No stored report' : row.status.report.phase, render: row => row.status === undefined ? <span className="muted">—</span> : <span className={row.status.report.phase === CollectorPhase.Failed ? 'status status-danger' : undefined}>{row.status.report.phase}</span> },
  { sort: ActivityCollectorSort.Freshness, label: 'Freshness', cell: undefined, width: { min: 100, ideal: 120, max: 200 }, compact: true, narrow: true, required: false, title: row => row.status === undefined ? 'No stored report' : undefined, render: row => { const value = freshness(row); return <span className={value.status}>{value.label}</span>; } },
  { sort: ActivityCollectorSort.ReceivedAt, label: 'Last report', cell: undefined, width: { min: 150, ideal: 200, max: 260 }, compact: true, narrow: false, required: false, title: row => row.status === undefined ? undefined : row.status.receivedAt, render: (row, now) => <When value={row.status === undefined ? undefined : row.status.receivedAt} now={now} relative="inline" missing="—"/> },
  { sort: ActivityCollectorSort.ArchiveHeads, label: 'HEADs', cell: 'col-num', width: NUMBER, compact: true, narrow: false, required: false, title: () => 'Archive HEADs', render: row => row.archiveHeads.toLocaleString() },
  { sort: ActivityCollectorSort.HeadsWithoutTargetJob, label: 'No target job', cell: 'col-num', width: { min: 96, ideal: 112, max: 160 }, compact: false, narrow: false, required: false, title: () => 'HEADs without a target-profile job', render: row => row.headsWithoutTargetJob.toLocaleString() },
  ...COUNTS.map(item => ({ sort: item.current, label: item.label, cell: 'col-num' as const, width: NUMBER, compact: item.compact, narrow: false, required: false, title: () => `Current ${item.label.toLowerCase()}`,
    render: (row: ActivityCollector) => item.field === 'failed' && row.current.failed > 0n ? <a className="status-danger" href={jobsOf(row.collectorId, 'failed')} aria-label={`${count(row.current.failed, 'failed current job', 'failed current jobs')} of ${row.collectorId}`}>{row.current.failed.toLocaleString()}</a> : row.current[item.field].toLocaleString() })),
  ...COUNTS.map(item => ({ sort: item.historical, label: `History ${item.label.toLowerCase()}`, cell: 'col-num' as const, width: { min: 96, ideal: 120, max: 180 }, compact: false, narrow: false, required: false, title: () => `Historical ${item.label.toLowerCase()}`, render: (row: ActivityCollector) => row.historical[item.field].toLocaleString() })),
];
function leaseLine(counts: JobCounts): string { return `${counts.activeRunning.toLocaleString()} active · ${counts.expiredRunning.toLocaleString()} expired · ${counts.unleasedRunning.toLocaleString()} unleased`; }
function counters(status: CollectorStatus): readonly [string, string][] {
  const { report } = status, values = report.counters;
  return [
    ['Scanned / discovered sessions', `${values.scanned} / ${values.discovered}`], ['Scanned bytes', formatBytes(values.scannedBytes)], ['Enqueued sessions', values.enqueued.toString()],
    ['Uploaded sessions (archive receipts)', values.uploaded.toString()], ['Acknowledged bytes / queued payload bytes', `${formatBytes(report.uploadedBytes)} / ${formatBytes(report.totalUploadBytes)}`],
    ...(report.phase === CollectorPhase.Uploading ? [['Current payload size (not acknowledged progress)', formatBytes(report.currentUploadTotalBytes)] as [string, string]] : []),
    ['Waiting for quiet', values.waiting.toString()], ['Pending upload queue', values.pending.toString()], ['Quarantined', values.quarantined.toString()], ['Stopped', values.stopped.toString()],
    ['Conflicts', values.conflicts.toString()], ['Upload failures', values.uploadFailures.toString()], ['Excluded', values.excluded.toString()], ['Unchanged', values.unchanged.toString()],
  ];
}
function CollectorDetail({ row }: { row: ActivityCollector }) {
  const status = row.status;
  return <div className="activity-detail" aria-label={`Collector ${row.collectorId}`} role="region">
    <div className="activity-detail-main">
      <dl className="dl activity-detail-list">
        <dt>Last report</dt><dd>{status === undefined ? 'No stored report · collection progress unknown. This does not establish health, configuration or completion.' : <><span className={status.stale || status.report.phase === CollectorPhase.Failed ? 'status status-warn' : 'status status-ok'}>{status.report.phase} · {status.stale ? 'Stale report' : 'Recent report'}</span> · received <time dateTime={status.receivedAt}>{status.receivedAt}</time></>}</dd>
        {status !== undefined && status.stale && <><dt>Progress</dt><dd className="activity-warning">Last known snapshot only; current collection progress is unknown.</dd></>}
        {status !== undefined && status.report.error !== undefined && <><dt>Error</dt><dd className="activity-failure">Collector error: {status.report.error}</dd></>}
        {status !== undefined && <><dt>Run</dt><dd><code>{status.report.runId}</code> · sequence {status.report.sequence.toString()} · started <time dateTime={status.report.startedAt}>{status.report.startedAt}</time></dd></>}
        <dt>Leases</dt><dd>current {leaseLine(row.current)}; historical {leaseLine(row.historical)}</dd>
        <dt>Jobs</dt><dd>{row.current.total.toLocaleString()} current · {row.historical.total.toLocaleString()} historical</dd>
      </dl>
      {status !== undefined && <div className="stack-sm"><dl className="activity-counters" aria-label="Per-run collector counters">{counters(status).map(([label, value]) => <div key={label} data-counter={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className="xs muted">Per-run discovery and upload counters, not indexing-job totals. Receipts may include a queue from earlier runs and do not establish index publication.</p></div>}
    </div>
    <div className="row activity-detail-actions"><a className="btn btn-sm" href={jobsOf(row.collectorId, null)}>Jobs of this collector</a></div>
  </div>;
}

export function Collectors({ connection, stats, user, refresh, refreshNow }: { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; refresh: string; refreshNow: () => void }) {
  const cache = useContext(RouteStateContext);
  if (cache === null) throw new Error('Collectors requires a RouteStateContext provider');
  const [state, setState] = useRouteState(COLLECTORS_STATE, ACTIVITY_INSTANCE), [draft, setDraft] = useRouteState(COLLECTORS_DRAFT, ACTIVITY_INSTANCE), input = useRef<HTMLInputElement>(null);
  const resource = useSettledInfiniteResource<ActivityCollector, ActivityResult, string>(cache.read(COLLECTOR_CHAINS, ACTIVITY_INSTANCE), connection, stats, JSON.stringify([user.id, state.submitted, state.sort, state.direction]), refresh, true, undefined, async cursor => {
    validateMetadataExpression(state.submitted);
    const result = await read(connection, new Operation_Activity(new ActivityQuery(state.submitted, state.sort, state.direction, cursor, PAGE_SIZE)), reply => reply instanceof Result_Activity ? reply.result : null);
    if (result.user.id !== user.id) throw new Error('Activity response belongs to a different account');
    return { items: result.collectors, next: result.nextCursor, previous: undefined, meta: result };
  }, collector => collector.collectorId);
  const table = useListTable(columns, COLUMN_CHOICES_KEY, 'Actions', resource.items.length);
  const meta = resource.meta, failed = resource.error !== null && resource.appendError === null;
  function submit(expression: string) { setState(value => ({ ...value, submitted: expression, expanded: null })); if (expression === state.submitted) refreshNow(); }
  const counter = resource.loading ? 'Loading collectors…' : meta === null ? 'Not loaded' : <><strong>{meta.totalCollectors.toLocaleString()}</strong>{state.submitted === '' ? ` collector${meta.allCollectors === 1n ? '' : 's'}` : ` of ${count(meta.allCollectors, 'collector', 'collectors')}`} · {resource.hasMore ? `${resource.items.length.toLocaleString()} loaded` : 'all loaded'}</>;
  return <section className="activity-list" aria-label="Collectors" data-view="activity-collectors">
    <div className="viewbar activity-viewbar">
      <MetadataQueryBar inputRef={input} name="Collector" placeholder={PLACEHOLDER} value={draft} applied={state.submitted} change={setDraft} submit={submit} disabled={stats.activeId === null} completion={{ connection, stats, owner: user.id, target: new ExpressionHintTarget_ActivityCollectors() }}/>
      <div className="viewbar-meta" role="status" aria-label="Collectors status">{counter}</div>
      <ColumnMenu name="Collectors" layout={table.layout}/>
    </div>
    <FilterBar expression={draft} change={setDraft} input={input} fields={fields} presets={presets} metadata={true} trailing={<div className="sortline"><MetadataHelp><p>collector (exact ID), phase, freshness (recent / stale / unknown), after, before. Dates use report received time. Missing reports do not establish collector health.</p></MetadataHelp></div>}/>
    {failed && <div className="page activity-notice"><div className="notice notice-danger" role="alert"><Glyph name="alert"/><div><div className="notice-title">Collectors could not be loaded</div>{resource.error}<div className="notice-actions"><button type="button" className="btn btn-sm" onClick={refreshNow}>Retry</button></div></div></div></div>}
    {resource.updateAvailable && <div className="update-pill"><button type="button" onClick={resource.applyUpdates}><Icon name="arrow-up" small={true}/>Updated collectors · show latest</button></div>}
    <ListTable name="Collectors" list="activity-collectors" twoLine={false} table={table} resource={resource} rowId={row => row.collectorId} rowClass="activity-collector-row" rowState={row => freshness(row).label.toLowerCase()} state={state}
      sortBy={sort => setState(value => ({ ...value, ...nextOrder(value, sort) }))} toggle={id => setState(value => ({ ...value, expanded: value.expanded === id ? null : id }))}
      detail={row => <CollectorDetail row={row}/>} actions={row => <a className="btn btn-sm btn-ghost" href={jobsOf(row.collectorId, null)} aria-label={`Jobs of ${row.collectorId}`}>Jobs<Icon name="arrow-right" small={true}/></a>}
      empty={<div className="empty" data-list-state="empty"><Icon name="search" small={false}/><h2>No matching collectors</h2><p>{state.submitted === '' ? 'No collector has registered for your account yet.' : <>Nothing matches <code>{state.submitted}</code>.</>}</p>{state.submitted !== '' && <div className="row"><button type="button" className="btn" onClick={() => { setDraft(''); submit(''); }}>Clear filter</button></div>}</div>}
      noun={total => count(total, 'collector', 'collectors')} total={meta === null ? null : meta.totalCollectors} pageSize={PAGE_SIZE}/>
  </section>;
}
