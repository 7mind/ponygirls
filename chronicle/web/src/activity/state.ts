import { ActivityCollectorSort, ActivityCollectorSort_values, ActivityJobScope, ActivityJobSort, ActivityJobSort_values, SortDirection, type ActivityCollector, type ActivityJob, type ActivityJobsResult, type ActivityResult } from '../api.ts';
import { SettledChainCache } from '../infinite.ts';
import { ACTIVITY_SECTIONS, RouteParams, routeSlot, type Route, type RouteStateCache } from '../router.ts';

// Activity routes (redesign spec §5): `#/activity/<section>?q=&scope=&sort=&dir=`; `#/activity` is the Overview.
export type ActivitySection = (typeof ACTIVITY_SECTIONS)[number];
export const DEFAULT_SECTION: ActivitySection = 'overview';
export function sectionOf(route: Route): ActivitySection {
  const [segment] = route.segments;
  return segment === undefined ? DEFAULT_SECTION : ACTIVITY_SECTIONS.find(section => section === segment) ?? DEFAULT_SECTION;
}
// The Overview keeps the bare `#/activity` address, so that every link to it names one route (and one scroll position).
export function activityRoute(section: ActivitySection, params: RouteParams): Route { return { view: 'activity', segments: section === DEFAULT_SECTION ? [] : [section], params }; }

/** Submitted state of a list sub-view; `expanded` is the row whose details are open. */
export interface ListState<S> { readonly submitted: string; readonly sort: S; readonly direction: SortDirection; readonly expanded: string | null }
export type CollectorsState = ListState<ActivityCollectorSort>;
export type JobScope = ActivityJobScope.Current | ActivityJobScope.Historical;
export interface JobsState extends ListState<ActivityJobSort> { readonly scope: JobScope }
export function emptyCollectors(): CollectorsState { return { submitted: '', sort: ActivityCollectorSort.CollectorId, direction: SortDirection.Asc, expanded: null }; }
// Oldest wait first (claim-order spec §7, approved mockup): the order the claim order itself follows within a class.
export function emptyJobs(): JobsState { return { submitted: '', scope: ActivityJobScope.Current, sort: ActivityJobSort.WaitingSince, direction: SortDirection.Asc, expanded: null }; }

const QUERY_PARAM = 'q', SCOPE_PARAM = 'scope', SORT_PARAM = 'sort', DIRECTION_PARAM = 'dir', HISTORY = 'history';
function listParams<S>(state: ListState<S>, defaults: ListState<S>, extra: readonly [string, string][]): RouteParams {
  const entries: [string, string][] = [...extra];
  if (state.submitted !== '') entries.push([QUERY_PARAM, state.submitted]);
  if (state.sort !== defaults.sort) entries.push([SORT_PARAM, String(state.sort)]);
  if (state.direction !== defaults.direction) entries.push([DIRECTION_PARAM, state.direction]);
  return new RouteParams(entries);
}
function directionOf(params: RouteParams, fallback: SortDirection): SortDirection {
  const value = params.get(DIRECTION_PARAM);
  return value === SortDirection.Asc || value === SortDirection.Desc ? value : fallback;
}
export function collectorsParams(state: CollectorsState): RouteParams { return listParams(state, emptyCollectors(), []); }
export function jobsParams(state: JobsState): RouteParams { return listParams(state, emptyJobs(), state.scope === ActivityJobScope.Historical ? [[SCOPE_PARAM, HISTORY]] : []); }
// Unknown or malformed values fall back to the defaults; the URL is then rewritten from the state.
export function collectorsFromParams(params: RouteParams): Omit<CollectorsState, 'expanded'> {
  const defaults = emptyCollectors(), sort = params.get(SORT_PARAM);
  return { submitted: params.get(QUERY_PARAM) ?? '', sort: ActivityCollectorSort_values.find(value => value === sort) ?? defaults.sort, direction: directionOf(params, defaults.direction) };
}
export function jobsFromParams(params: RouteParams): Omit<JobsState, 'expanded'> {
  const defaults = emptyJobs(), sort = params.get(SORT_PARAM);
  return { submitted: params.get(QUERY_PARAM) ?? '', scope: params.get(SCOPE_PARAM) === HISTORY ? ActivityJobScope.Historical : ActivityJobScope.Current, sort: ActivityJobSort_values.find(value => value === sort) ?? defaults.sort, direction: directionOf(params, defaults.direction) };
}
export function jobsRouteFor(submitted: string, scope: JobScope): Route { return activityRoute('jobs', jobsParams({ ...emptyJobs(), submitted, scope })); }
export function collectorsRouteFor(submitted: string): Route { return activityRoute('collectors', collectorsParams({ ...emptyCollectors(), submitted })); }

// One instance per owner: the shell replaces the route cache when the owner changes.
const INSTANCE = 'activity';
// Settled chains per query, so that Back and tab round trips show the loaded rows at once (spec §5 rule 2).
const CHAIN_LIMIT = 8;
export const COLLECTORS_STATE = routeSlot<CollectorsState>('activity-collectors', emptyCollectors);
export const COLLECTORS_DRAFT = routeSlot<string>('activity-collectors-draft', () => '');
export const JOBS_STATE = routeSlot<JobsState>('activity-jobs', emptyJobs);
export const JOBS_DRAFT = routeSlot<string>('activity-jobs-draft', () => '');
// The job whose conversation was opened last: focus returns to its row when the list is shown again (spec §8 item 4).
export const JOBS_OPENED = routeSlot<string | null>('activity-jobs-opened', () => null);
export const SECTION = routeSlot<ActivitySection>('activity-section', () => DEFAULT_SECTION);
export const COLLECTOR_CHAINS = routeSlot('activity-collector-chains', () => new SettledChainCache<ActivityCollector, ActivityResult, string>(CHAIN_LIMIT));
export const JOB_CHAINS = routeSlot('activity-job-chains', () => new SettledChainCache<ActivityJob, ActivityJobsResult, string>(CHAIN_LIMIT));
export const ACTIVITY_INSTANCE = INSTANCE;
export function sectionParams(section: ActivitySection, cache: RouteStateCache): RouteParams {
  switch (section) {
    case 'collectors': return collectorsParams(cache.read(COLLECTORS_STATE, INSTANCE));
    case 'jobs': return jobsParams(cache.read(JOBS_STATE, INSTANCE));
    default: return new RouteParams([]);
  }
}
/** The Activity route an in-app link returns to: the last shown section with its submitted query and order. */
export function retainedActivityRoute(cache: RouteStateCache): Route {
  const section = cache.read(SECTION, INSTANCE);
  return activityRoute(section, sectionParams(section, cache));
}
