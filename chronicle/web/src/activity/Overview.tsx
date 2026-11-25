import type { ReactNode } from 'react';
import { ActivityJobScope, ModelPurpose, type ActivityCollector, type ActivityResult, type JobCounts, type ModelUsageResult, type UserInfo } from '../api.ts';
import { addExpressionFilter, addMetadataFilter } from '../expression.ts';
import type { InfiniteResource } from '../infinite.ts';
import { RouteParams, formatRoute, viewRouteWith, type Route } from '../router.ts';
import { Icon } from '../Icon.tsx';
import { Glyph } from '../Glyph.tsx';
import type { ModelUsageState } from '../ModelUsage.tsx';
import { collectorsRouteFor, jobsRouteFor } from './state.ts';
import { count } from './list.tsx';

// Overview (spec §3.1 Activity): what needs attention first, each item linking to the filtered list that explains it.
export const STALE_EXPRESSION = addMetadataFilter('', 'freshness', 'stale');
export const UNREPORTED_EXPRESSION = addMetadataFilter('', 'freshness', 'unknown');
const RECENT_EXPRESSION = addMetadataFilter('', 'freshness', 'recent');
const PERCENT = 100;
export interface Snapshots { readonly summary: InfiniteResource<ActivityCollector, ActivityResult>; readonly stale: InfiniteResource<ActivityCollector, ActivityResult>; readonly unreported: InfiniteResource<ActivityCollector, ActivityResult> }
const href = (route: Route) => formatRoute(route);
const jobsWith = (attribute: string, value: string) => href(jobsRouteFor(addMetadataFilter('', attribute, value), ActivityJobScope.Current));
function archiveWith(owner: string, status: string | null): string {
  const mine = addExpressionFilter('', 'user', owner);
  return href(viewRouteWith('archive', new RouteParams([['q', status === null ? mine : addExpressionFilter(mine, 'status', status)]])));
}
const number = (value: bigint | null) => value === null ? '—' : value.toLocaleString();

function Tile({ label, value, note, link, variant }: { label: string; value: bigint | null; note: string; link: string; variant: string }) {
  return <a className={`tile ${variant}`} href={link}><span className="tile-label">{label}</span><span className="tile-value">{number(value)}</span><span className="tile-note">{note}</span></a>;
}
interface Attention { readonly key: string; readonly status: string; readonly label: string; readonly detail: string; readonly link: string }
function AttentionItem({ item }: { item: Attention }) {
  return <a className="attention-item" href={item.link} data-attention={item.key}><span className={item.status}>{item.label}</span><span className="grow muted truncate">{item.detail}</span><Icon name="chevron-down" small={true}/></a>;
}
// Segment widths are dynamic geometry: set through the CSSOM (shared/ui-web rules).
function share(part: bigint, whole: bigint): string { return whole === 0n ? '0%' : `${(Number(part) * PERCENT / Number(whole)).toFixed(2)}%`; }
function JobBar({ label, note, counts, legend }: { label: string; note: string; counts: JobCounts; legend: boolean }) {
  const segments = [['bar-ok', counts.complete, 'complete'], ['bar-run', counts.running, 'running'], ['bar-queue', counts.queued, 'queued'], ['bar-fail', counts.failed, 'failed']] as const;
  return <div className="stack-sm">
    <div className="row row-between small"><strong>{label} · {counts.total.toLocaleString()}</strong><span className="muted">{note}</span></div>
    <div className="bar" role="img" aria-label={`${label}: ${segments.map(([, value, name]) => `${value.toLocaleString()} ${name}`).join(', ')}`}>{segments.map(([variant, value]) => <span key={variant} className={variant} ref={element => { if (element !== null) element.style.setProperty('width', share(value, counts.total)); }}/>)}</div>
    {legend && <div className="legend" aria-hidden="true"><span className="status status-ok">Complete</span><span className="status status-info">Running</span><span className="status">Queued</span><span className="status status-danger">Failed</span></div>}
  </div>;
}
function completion(counts: JobCounts): string { return counts.total === 0n ? 'no jobs' : `${Math.floor(Number(counts.complete) * PERCENT / Number(counts.total))}% complete`; }
function leases(counts: JobCounts): string { return `${counts.activeRunning.toLocaleString()} active · ${counts.expiredRunning.toLocaleString()} expired · ${counts.unleasedRunning.toLocaleString()} unleased`; }
function JobTotals({ summary }: { summary: ActivityResult }) {
  const fields = ['total', 'queued', 'running', 'failed', 'complete'] as const;
  return <table className="table table-static table-inset" aria-label="Job totals"><thead><tr><th scope="col">Jobs</th>{fields.map(field => <th key={field} scope="col" className="col-num">{field[0]!.toUpperCase() + field.slice(1)}</th>)}</tr></thead>
    <tbody>{([['Current', summary.current], ['Historical', summary.historical]] as const).map(([label, counts]) => <tr key={label}><th scope="row">{label}</th>{fields.map(field => <td key={field} className="col-num">{label === 'Current' && field === 'failed' && counts.failed > 0n ? <a className="status-danger" href={jobsWith('status', 'failed')}>{counts.failed.toLocaleString()}</a> : counts[field].toLocaleString()}</td>)}</tr>)}</tbody></table>;
}

/** Model-usage figures of the Overview: requests in flight now and the summed provider-reported token rates of the window. */
function rateSum(data: ModelUsageResult, pick: (slice: ModelUsageResult['samples'][number]) => ModelUsageResult['samples'][number]['output']): string {
  const windows = data.samples.map(pick).filter(window => window !== undefined);
  if (windows.every(window => window.reportedCalls === 0n && window.unknownCalls === 0n)) return 'No reports';
  if (windows.some(window => window.tokensPerSecond === undefined && (window.reportedCalls > 0n || window.unknownCalls > 0n))) return 'Unknown';
  return windows.reduce((sum, window) => sum + (window.tokensPerSecond === undefined ? 0 : window.tokensPerSecond), 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}
const PURPOSE_NOUNS: Readonly<Record<ModelPurpose, string>> = { [ModelPurpose.Annotation]: 'annotation', [ModelPurpose.DocumentEmbedding]: 'document embedding', [ModelPurpose.QueryEmbedding]: 'query embedding', [ModelPurpose.McpTest]: 'MCP test' };
function UsageCard({ usage }: { usage: ModelUsageState }) {
  const data = usage.data;
  const inFlight = data === null ? null : data.samples.reduce((sum, sample) => sum + sample.inFlight, 0);
  const busy = data === null ? [] : data.samples.filter(sample => sample.inFlight > 0).map(sample => `${sample.inFlight} ${PURPOSE_NOUNS[sample.purpose]}`);
  return <section className="card" aria-labelledby="activity-usage-summary"><div className="card-head"><h2 id="activity-usage-summary">Model usage{data === null ? '' : ` · last ${(data.coveredMillis / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`}</h2><a className="btn btn-sm btn-ghost" href={href({ view: 'activity', segments: ['usage'], params: new RouteParams([]) })}>Details<Icon name="arrow-right" small={true}/></a></div>
    <div className="card-body">{usage.error !== null ? <div className="notice notice-danger" role="alert"><Glyph name="alert"/><div>{usage.error}</div></div> : data === null ? <p className="muted small" role="status">Reading completed-call usage…</p> : <div className="tiles">
      <div className="tile"><span className="tile-label">In flight</span><span className="tile-value">{inFlight!.toLocaleString()}</span><span className="tile-note">{busy.length === 0 ? 'no requests now' : busy.join(' · ')}</span></div>
      <div className="tile"><span className="tile-label">Input</span><span className="tile-value">{rateSum(data, sample => sample.input)}</span><span className="tile-note">tokens per second</span></div>
      <div className="tile"><span className="tile-label">Output</span><span className="tile-value">{rateSum(data, sample => sample.output)}</span><span className="tile-note">tokens per second</span></div>
    </div>}</div></section>;
}
function names(collectors: readonly ActivityCollector[], total: bigint): string {
  const shown = collectors.map(collector => collector.collectorId), more = total - BigInt(shown.length);
  return more > 0n ? `${shown.join(', ')} and ${more.toLocaleString()} more` : shown.join(', ');
}
function CollectorsCard({ summary, stale, unreported }: { summary: ActivityResult | null; stale: ActivityResult | null; unreported: ActivityResult | null }) {
  const all = summary === null ? null : summary.allCollectors, staleCount = stale === null ? null : stale.totalCollectors, unknown = unreported === null ? null : unreported.totalCollectors;
  const recent = all === null || staleCount === null || unknown === null ? null : all - staleCount - unknown;
  return <section className="card" aria-labelledby="activity-collectors-summary"><div className="card-head"><h2 id="activity-collectors-summary">Collectors</h2><a className="btn btn-sm btn-ghost" href={href(collectorsRouteFor(''))}>All {number(all)}<Icon name="arrow-right" small={true}/></a></div>
    <div className="attention-list">
      <AttentionItem item={{ key: 'recent', status: 'status status-ok', label: `${number(recent)} reporting`, detail: 'recent report received', link: href(collectorsRouteFor(RECENT_EXPRESSION)) }}/>
      <AttentionItem item={{ key: 'stale', status: staleCount !== null && staleCount > 0n ? 'status status-warn' : 'status', label: `${number(staleCount)} stale`, detail: stale === null || stale.collectors.length === 0 ? 'last report is too old to describe current progress' : names(stale.collectors, stale.totalCollectors), link: href(collectorsRouteFor(STALE_EXPRESSION)) }}/>
      <AttentionItem item={{ key: 'unreported', status: 'status status-idle', label: `${number(unknown)} without a report`, detail: 'no stored report; progress unknown', link: href(collectorsRouteFor(UNREPORTED_EXPRESSION)) }}/>
    </div></section>;
}
function attention(summary: ActivityResult, stale: ActivityResult | null, owner: string): readonly Attention[] {
  const items: Attention[] = [];
  if (summary.current.failed > 0n) items.push({ key: 'failed', status: 'status status-danger', label: count(summary.current.failed, 'failed indexing job', 'failed indexing jobs'), detail: 'current jobs · retry one in its details or all of them in Maintenance', link: jobsWith('status', 'failed') });
  if (summary.current.expiredRunning > 0n) items.push({ key: 'expired', status: 'status status-warn', label: count(summary.current.expiredRunning, 'expired Running lease', 'expired Running leases'), detail: 'the worker stopped renewing; these jobs are not actively processed', link: jobsWith('lease', 'expired') });
  if (stale !== null && stale.totalCollectors > 0n) items.push({ key: 'stale', status: 'status status-warn', label: count(stale.totalCollectors, 'stale collector', 'stale collectors'), detail: 'last report too old to describe current collection progress', link: href(collectorsRouteFor(STALE_EXPRESSION)) });
  if (summary.headsWithoutTargetJob > 0n) items.push({ key: 'unscheduled', status: 'status status-idle', label: count(summary.headsWithoutTargetJob, 'conversation without a target job', 'conversations without a target job'), detail: 'not scheduled for the current profile; not Queued', link: archiveWith(owner, 'unscheduled') });
  return items;
}
function Notice({ children }: { children: ReactNode }) { return <div className="notice notice-danger" role="alert"><Glyph name="alert"/><div>{children}</div></div>; }

export function Overview({ user, snapshots, usage }: { user: UserInfo; snapshots: Snapshots; usage: ModelUsageState }) {
  const { summary: summaryResource, stale: staleResource, unreported: unreportedResource } = snapshots;
  const summary = summaryResource.meta, stale = staleResource.meta, current = summary === null ? null : summary.current;
  // The all-clear needs every count it summarises: an unread or failed stale count leaves the list incomplete, never clear.
  const staleKnown = stale !== null && staleResource.error === null, items = summary === null ? null : attention(summary, staleKnown ? stale : null, user.id);
  const unknownStale: Attention = { key: 'unknown-stale', status: 'status status-idle', label: 'Stale collectors unknown', detail: staleResource.error === null ? 'reading the stale collector count…' : `count unavailable: ${staleResource.error}`, link: href(collectorsRouteFor(STALE_EXPRESSION)) };
  const attentionNote = items === null ? 'summary unknown' : !staleKnown ? `${items.length === 0 ? 'no known issues' : count(BigInt(items.length), 'known issue', 'known issues')} · incomplete` : items.length === 0 ? 'nothing to do' : `${count(BigInt(items.length), 'issue', 'issues')} · most severe first`;
  return <section className="page page-narrow stack-lg activity-overview" aria-label="Overview" data-view="activity-overview">
    {summaryResource.error !== null && <Notice>Owner summary unavailable: {summaryResource.error}</Notice>}
    {staleResource.error !== null && <Notice>Stale collector count unavailable: {staleResource.error}</Notice>}
    {unreportedResource.error !== null && <Notice>Unreported collector count unavailable: {unreportedResource.error}</Notice>}
    <div className="tiles activity-tiles">
      <Tile label="Archive HEADs" value={summary === null ? null : summary.archiveHeads} note="conversations you own" link={archiveWith(user.id, null)} variant=""/>
      <Tile label="Without target job" value={summary === null ? null : summary.headsWithoutTargetJob} note="unscheduled · not Queued" link={archiveWith(user.id, 'unscheduled')} variant={summary !== null && summary.headsWithoutTargetJob > 0n ? 'tile-warn' : ''}/>
      <Tile label="Queued" value={current === null ? null : current.queued} note="current jobs" link={jobsWith('status', 'queued')} variant=""/>
      <Tile label="Running" value={current === null ? null : current.activeRunning} note={current === null ? 'current jobs · active lease' : `active lease · ${(current.running - current.activeRunning).toLocaleString()} more stored Running without one`} link={jobsWith('lease', 'active')} variant=""/>
      <Tile label="Failed" value={current === null ? null : current.failed} note="current · retry available" link={jobsWith('status', 'failed')} variant={current !== null && current.failed > 0n ? 'tile-danger' : ''}/>
      <Tile label="Complete" value={current === null ? null : current.complete} note={current === null ? 'current jobs' : `of ${current.total.toLocaleString()} current jobs`} link={jobsWith('status', 'complete')} variant=""/>
    </div>
    <div className="grid-2">
      <section className="card" aria-labelledby="activity-attention"><div className="card-head"><h2 id="activity-attention">Needs attention</h2><span className="xs muted">{attentionNote}</span></div>
        <div className="attention-list" data-list="attention">{items === null ? <p className="attention-item muted">{summaryResource.loading ? 'Reading the owner summary…' : 'Unknown: the owner summary is not loaded.'}</p>
          : !staleKnown ? [...items, unknownStale].map(item => <AttentionItem key={item.key} item={item}/>)
          : items.length === 0 ? <p className="attention-item"><span className="status status-ok">Nothing needs attention</span><span className="grow muted truncate">no failed jobs, expired leases, stale collectors or unscheduled conversations</span></p>
          : items.map(item => <AttentionItem key={item.key} item={item}/>)}</div></section>
      <section className="card" aria-labelledby="activity-job-totals"><div className="card-head"><h2 id="activity-job-totals">Indexing jobs</h2><span className="xs muted">unfiltered totals of stored states</span></div>
        <div className="card-body stack">{summary === null ? <p className="muted small">Totals unknown.</p> : <>
          <JobBar label="Current" note={completion(summary.current)} counts={summary.current} legend={false}/>
          <JobBar label="Historical" note="superseded revisions and profiles" counts={summary.historical} legend={true}/>
          <JobTotals summary={summary}/>
          <p className="xs muted">Running leases — current: {leases(summary.current)}; historical: {leases(summary.historical)}.</p>
        </>}</div></section>
    </div>
    <div className="grid-2">
      <CollectorsCard summary={summary} stale={stale} unreported={unreportedResource.meta}/>
      <UsageCard usage={usage}/>
    </div>
  </section>;
}
