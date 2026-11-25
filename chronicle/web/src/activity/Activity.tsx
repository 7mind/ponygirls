import { useContext, useEffect, useState } from 'react';
import { ActivityCollectorSort, ActivityQuery, Operation_Activity, Result_Activity, Scope, SortDirection, type ActivityCollector, type ActivityResult, type UserInfo } from '../api.ts';
import { read, type ChronicleConnection } from '../client.ts';
import { useInfiniteResource } from '../infinite.ts';
import { validateMetadataExpression } from '../expression.ts';
import type { MutationState } from '../mutations.ts';
import { ACTIVITY_POLL_INTERVAL_MS } from '../progress.ts';
import { RouteStateContext, formatRoute, useRouteState, useRouteSync, type HashRouter, type Route } from '../router.ts';
import type { ManagerStats } from '../transport/types.ts';
import { Anchored } from '../Popover.tsx';
import { Icon } from '../Icon.tsx';
import { Glyph } from '../Glyph.tsx';
import { useModelUsage, ModelUsageView } from '../ModelUsage.tsx';
import { ACTIVITY_INSTANCE, COLLECTORS_DRAFT, COLLECTORS_STATE, JOBS_DRAFT, JOBS_STATE, SECTION, activityRoute, collectorsFromParams, collectorsParams, jobsFromParams, jobsParams, sectionOf, sectionParams, type ActivitySection } from './state.ts';
import { Overview, STALE_EXPRESSION, UNREPORTED_EXPRESSION, type Snapshots } from './Overview.tsx';
import { Collectors } from './Collectors.tsx';
import { Jobs } from './Jobs.tsx';
import { Maintenance } from './Maintenance.tsx';
import { clockTime } from './time.tsx';
import { count } from './list.tsx';
import '../activity.css';

/** Routing of a retained view (App): whether it is shown, the current route and the router. */
export interface ActivityRouting { readonly active: boolean; readonly route: Route; readonly router: HashRouter }
interface ActivityProps { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState; routing: ActivityRouting }
const SECTIONS: readonly { readonly section: ActivitySection; readonly label: string }[] = [
  { section: 'overview', label: 'Overview' }, { section: 'collectors', label: 'Collectors' }, { section: 'jobs', label: 'Jobs' }, { section: 'usage', label: 'Model usage' }, { section: 'maintenance', label: 'Maintenance' },
];
const POLL_SECONDS = ACTIVITY_POLL_INTERVAL_MS / 1000;
// The summary read needs the owner-wide counts only; the stale read also names the first stale collectors (Overview).
const SUMMARY_LIMIT = 1, STALE_NAMES = 3, COUNT_LIMIT = 1;
async function readCollectors(connection: ChronicleConnection, user: UserInfo, expression: string, limit: number) {
  validateMetadataExpression(expression);
  const result = await read(connection, new Operation_Activity(new ActivityQuery(expression, ActivityCollectorSort.CollectorId, SortDirection.Asc, undefined, limit)), reply => reply instanceof Result_Activity ? reply.result : null);
  if (result.user.id !== user.id) throw new Error('Activity response belongs to a different account');
  return { items: result.collectors, next: undefined, previous: undefined, meta: result };
}
function useCollectorSnapshot(connection: ChronicleConnection, stats: ManagerStats, user: UserInfo, name: string, expression: string, limit: number, refresh: string, enabled: boolean) {
  return useInfiniteResource<ActivityCollector, ActivityResult, string>(connection, stats, `${name}:${user.id}`, refresh, enabled, undefined, () => readCollectors(connection, user, expression, limit), collector => collector.collectorId);
}

export function Activity(props: ActivityProps) { return <OwnerActivity key={props.user.id} {...props}/>; }
function OwnerActivity({ connection, stats, user, actions, routing }: ActivityProps) {
  const cache = useContext(RouteStateContext);
  if (cache === null) throw new Error('Activity requires a RouteStateContext provider');
  const section = sectionOf(routing.route), canRead = user.scopes.includes(Scope.Read), connected = stats.activeId !== null;
  const [refresh, setRefresh] = useState(0), refreshKey = `${refresh}:${actions.revision}`;
  const [switchPending, setSwitchPending] = useState<string | null>(null);
  // Snapshots poll while the view is shown; new snapshots never move the rows being read (spec §1 principle 5).
  useEffect(() => {
    if (!routing.active || !canRead || !connected) return;
    const timer = window.setInterval(() => setRefresh(value => value + 1), ACTIVITY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connection, routing.active, canRead, connected, stats.generation]);
  useEffect(() => { if (routing.active) cache.write(SECTION, ACTIVITY_INSTANCE, section); }, [cache, routing.active, section]);

  const [collectors, setCollectors] = useRouteState(COLLECTORS_STATE, ACTIVITY_INSTANCE), [, setCollectorDraft] = useRouteState(COLLECTORS_DRAFT, ACTIVITY_INSTANCE);
  const [jobs, setJobs] = useRouteState(JOBS_STATE, ACTIVITY_INSTANCE), [, setJobDraft] = useRouteState(JOBS_DRAFT, ACTIVITY_INSTANCE);
  const params = routing.route.params;
  const fromUrl = section === 'collectors' ? collectorsParams({ ...collectors, ...collectorsFromParams(params) }).toString() : section === 'jobs' ? jobsParams({ ...jobs, ...jobsFromParams(params) }).toString() : '';
  const fromState = section === 'collectors' ? collectorsParams(collectors).toString() : section === 'jobs' ? jobsParams(jobs).toString() : '';
  useRouteSync('activity', routing.active, `${section}?${fromUrl}`, `${section}?${fromState}`, () => {
    if (section === 'collectors') { const applied = collectorsFromParams(params); setCollectors(value => ({ ...applied, expanded: value.submitted === applied.submitted ? value.expanded : null })); setCollectorDraft(applied.submitted); }
    if (section === 'jobs') { const applied = jobsFromParams(params); setJobs(value => ({ ...applied, expanded: value.submitted === applied.submitted && value.scope === applied.scope ? value.expanded : null })); setJobDraft(applied.submitted); }
  }, () => routing.router.navigate(activityRoute(section, sectionParams(section, cache)), 'replace'));

  const summary = useCollectorSnapshot(connection, stats, user, 'activity-summary', '', SUMMARY_LIMIT, refreshKey, canRead);
  const stale = useCollectorSnapshot(connection, stats, user, 'activity-stale', STALE_EXPRESSION, STALE_NAMES, refreshKey, canRead);
  const unreported = useCollectorSnapshot(connection, stats, user, 'activity-unreported', UNREPORTED_EXPRESSION, COUNT_LIMIT, refreshKey, canRead && section === 'overview');
  const usage = useModelUsage(connection, stats, user, routing.active && canRead && (section === 'overview' || section === 'usage'));
  const snapshots: Snapshots = { summary, stale, unreported };
  const refreshNow = () => setRefresh(value => value + 1);
  if (!canRead) return <main className="activity-view" aria-label="Activity"><div className="page"><div className="notice notice-danger" role="alert"><Glyph name="alert"/><div>Read scope is required to view your activity.</div></div></div></main>;
  const failed = summary.meta === null ? null : summary.meta.current.failed, staleCount = stale.meta === null ? null : stale.meta.totalCollectors;
  const badges: Readonly<Record<ActivitySection, { text: string; title: string; variant: string } | undefined>> = { overview: undefined, usage: undefined, maintenance: undefined,
    collectors: staleCount !== null && staleCount > 0n ? { text: `${staleCount.toLocaleString()} stale`, title: count(staleCount, 'stale collector', 'stale collectors'), variant: 'count count-attn' } : undefined,
    jobs: failed !== null && failed > 0n ? { text: `${failed.toLocaleString()} failed`, title: count(failed, 'failed current job', 'failed current jobs'), variant: 'count count-danger' } : undefined,
  };
  return <main className="activity-view has-subnav" aria-label="Activity" data-section={section}>
    <div className="subnav activity-subnav">
      <nav className="tabs" aria-label="Activity sections">{SECTIONS.map(item => { const badge = badges[item.section]; return <a key={item.section} className="tab" href={formatRoute(activityRoute(item.section, sectionParams(item.section, cache)))} aria-current={item.section === section ? 'page' : undefined}>{item.label}{badge !== undefined && <span className={badge.variant} title={badge.title}>{badge.text}</span>}</a>; })}</nav>
      <div className="subnav-end">
        <span className="hide-md" role="status" aria-label="Snapshot time">{summary.meta === null ? summary.loading ? 'Reading snapshot…' : 'Snapshot unknown' : <>Snapshot <strong>{clockTime(summary.meta.observedAt)}</strong> · refreshes every {POLL_SECONDS} s</>}</span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Refresh snapshots" title="Refresh snapshots" disabled={!connected} onClick={refreshNow}><Icon name="refresh" small={true}/></button>
        <Anchored className="activity-about" buttonClassName="btn btn-ghost btn-icon btn-sm" buttonState={undefined} label={<Glyph name="info"/>} ariaLabel="About these snapshots" describedBy={undefined} panel="dialog" panelClassName="popover activity-about-panel" panelLabel="About these snapshots">
          <p className="activity-about-title">About these snapshots</p>
          <p>Only {user.login}'s collectors and jobs are shown. Each section is a snapshot read every {POLL_SECONDS} seconds while it is shown; new snapshots never move the rows you are reading: a pill offers to show them. Browser connectivity is not collector or worker health.</p>
          <p>Current jobs match the source HEAD and target profile; History holds other revisions and profiles. Totals are unfiltered; list counts follow the filter. Missing jobs are not Queued, processed windows are not publication, and unknown totals are not zero.</p>
          <p>Reports use server-received time. Missing, Idle or stale reports do not establish collection completion. Expired or unleased Running jobs are not active workers.</p>
        </Anchored>
      </div>
    </div>
    {section === 'overview' && <Overview user={user} snapshots={snapshots} usage={usage}/>}
    {section === 'collectors' && <Collectors connection={connection} stats={stats} user={user} refresh={refreshKey} refreshNow={refreshNow}/>}
    {section === 'jobs' && <Jobs connection={connection} stats={stats} user={user} actions={actions} refresh={refreshKey} refreshNow={refreshNow} summary={summary.meta}/>}
    {section === 'usage' && <section className="page page-narrow" aria-label="Model usage" data-view="activity-usage"><ModelUsageView usage={usage} connected={connected}/></section>}
    {section === 'maintenance' && <Maintenance connection={connection} stats={stats} user={user} actions={actions} summary={summary.meta} switchPending={switchPending} setSwitchPending={setSwitchPending} refresh={refreshNow}/>}
  </main>;
}
