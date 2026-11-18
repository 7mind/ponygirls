import { basename, dirname } from 'node:path';
import { FactsView, formatAgo, formatCount, homeRelative, shortId, type Fact, type FactGroup, type FactSegment, type FactsState, type FactsViewOptions, type UiTheme } from '@ponygirls/pi-ui';
import type { AttemptSummary } from './attempt.ts';
import type { HistorianChronicleStatus, HistorianStatus } from './controller.ts';

export function styleHistorianStatus(text: string, theme: UiTheme): string {
  return text.split('\n').map(line => {
    if (line.startsWith('Historian ')) return theme.bold(theme.fg(line.startsWith('Historian ERROR') ? 'error' : line.startsWith('Historian ON') ? 'success' : 'muted', line));
    const field = /^([^:]+): (.*)$/.exec(line);
    if (field === null) return theme.fg('muted', line);
    const [, label, value] = field;
    const error = label === 'Error' || label === 'Markdown projection error';
    const color = error ? (value === 'none' ? 'muted' : 'error') : label === 'Coverage' ? 'warning' : 'text';
    const gap = ['Project', 'Activity', 'Attempt totals', 'Attempt diagnostics', 'Error', 'Coverage'].includes(label) ? '\n' : '';
    return `${gap}${theme.fg('accent', label + ':')} ${theme.fg(color, value)}`;
  }).join('\n');
}

export function styleHistorianJournal(text: string, theme: UiTheme): string {
  return text.split('\n').map(line => {
    if (/^#{1,3} /.test(line)) return theme.bold(theme.fg(line.startsWith('### ') ? 'accent' : 'success', line));
    if (line.startsWith('- Evidence ') || line.startsWith('Episode ')) return theme.fg('muted', line);
    if (line.includes('Coverage:') || line.startsWith('- Session ')) return theme.fg('warning', line);
    return line;
  }).join('\n');
}

const GIT_DIRECTORY = '.git';
const ATTENTION: FactsState = { text: 'attention', state: 'attention' };

/** A counter with its unit; callers leave out the zero ones. */
function counted(count: number, unit: string): string { return `${formatCount(count)} ${unit}`; }
function errorFact(label: string, message: string): Fact { return { label, value: [{ text: message, state: 'error' }] }; }
/** A repository is named by its directory, not by the `.git` directory that identifies it. */
function projectDirectory(project: string): string { return basename(project) === GIT_DIRECTORY ? dirname(project) : project; }

function chronicleValue(chronicle: HistorianChronicleStatus): FactSegment[] {
  if (chronicle.kind === 'unavailable') return [{ text: 'upload unavailable', state: 'error' }, { text: 'invalid settings', state: 'error' }];
  const upload = `upload ${chronicle.enabled ? 'on' : 'off'}`;
  const value: FactSegment[] = chronicle.endpoint === '' ? [{ text: upload }, { text: 'no destination' }] : [{ text: `${upload} → ${new URL(chronicle.endpoint).host}` }];
  value.push(chronicle.uploading ? { text: 'uploading', state: 'running' } : { text: 'idle' });
  const queue = chronicle.queue;
  if (queue === null) return [...value, { text: 'queue unknown' }];
  value.push({ text: queue.pending === 0 ? 'nothing pending' : counted(queue.pending, 'pending') });
  if (queue.stopped > 0) value.push({ text: counted(queue.stopped, 'stopped'), state: 'attention' });
  if (queue.acknowledged > 0) value.push({ text: counted(queue.acknowledged, 'acknowledged') });
  if (queue.otherDestinations > 0) value.push({ text: counted(queue.otherDestinations, 'for other destinations') });
  return value;
}

function attemptsValue(attempts: AttemptSummary | null): FactSegment[] {
  if (attempts === null) return [{ text: 'journal not open' }];
  if (attempts.total === 0) return [{ text: 'none this session' }];
  const value: FactSegment[] = [{ text: counted(attempts.total, 'this session') }];
  for (const outcome of ['validated', 'failed', 'recovered', 'cancelled', 'interrupted'] as const) {
    if (attempts[outcome] > 0) value.push({ text: counted(attempts[outcome], outcome) });
  }
  if (attempts.running > 0) value.push({ text: counted(attempts.running, 'running'), state: 'running' });
  return value;
}

export interface HistorianFacts { state: FactsState; groups: FactGroup[] }

/** State first, then where it comes from; zero counters become words and errors get their own first row. */
export function historianFacts(status: HistorianStatus, home: string, nowMs: number): HistorianFacts {
  if (status.kind === 'fault') return { state: ATTENTION, groups: [[errorFact('Error', status.message)]] };
  const { chronicle } = status;
  const chronicleError = chronicle.kind === 'ready' ? chronicle.error : null;
  const approvalMissing = status.enabled && !status.disclosureApproved;
  const attention = status.error !== null || status.projectionError !== null || chronicleError !== null || chronicle.kind === 'unavailable' || approvalMissing;
  const enabled = status.enabled ? 'on' : 'off';
  const enabledState = status.enabled ? 'ok' : 'settled';

  const state: FactSegment[] = [{ text: `${enabled} (${status.enabledSource} setting)`, state: enabledState },
    { text: status.capturing ? 'capturing this session' : 'not capturing this session' }];
  if (status.coverageNotices > 0) state.push({ text: counted(status.coverageNotices, status.coverageNotices === 1 ? 'coverage notice' : 'coverage notices') });
  const model: FactSegment[] = status.model === null ? [{ text: 'not configured' }] : [{ text: `${status.model.provider}/${status.model.id}` }, { text: status.model.thinking }];
  model.push(status.disclosureApproved ? { text: 'disclosure approved' }
    : approvalMissing ? { text: 'disclosure approval required', state: 'attention' } : { text: 'disclosure approval required' });
  const journal = homeRelative(status.journal, home).replace(`/${status.projectDigest}/`, `/${shortId(status.projectDigest)}/`);

  const activity: FactSegment[] = [status.activity === 'journaling' ? { text: 'journaling', state: 'running' }
    : status.activity === 'draining' ? { text: 'cancelled, waiting for provider drain', state: 'running' } : { text: 'idle' },
    { text: status.pendingEvents === 0 ? 'nothing pending' : counted(status.pendingEvents, 'pending') },
    { text: status.lastCommit === null ? 'no commits this run' : `last commit ${formatAgo(Date.parse(status.lastCommit), nowMs)}` }];
  if (status.failures > 0) activity.push({ text: `${formatCount(status.failures)} failed of ${formatCount(status.maxFailures)} attempts`, state: 'error' });

  return {
    state: attention ? ATTENTION : { text: `${enabled} · ${status.enabledSource}`, state: enabledState },
    groups: [
      [
        ...(status.error === null ? [] : [errorFact('Error', status.error)]),
        ...(status.projectionError === null ? [] : [errorFact('Markdown error', status.projectionError)]),
        { label: 'State', value: state },
        { label: 'Model', value: model },
        { label: 'Project', value: [{ text: homeRelative(projectDirectory(status.project), home) }] },
        { label: 'Journal', value: [{ text: journal }] },
      ],
      [
        ...(chronicleError === null ? [] : [errorFact('Chronicle error', chronicleError)]),
        { label: 'Activity', value: activity },
        { label: 'Chronicle', value: chronicleValue(chronicle) },
        { label: 'Attempts', value: attemptsValue(status.attempts) },
      ],
    ],
  };
}

/** What the status pane shows: the structured status and the complete text it summarises. */
export interface HistorianStatusContent { status: HistorianStatus; text: string; home: string; nowMs: number }
export type HistorianStatusHost = Pick<FactsViewOptions, 'theme' | 'keys' | 'rows' | 'requestRender' | 'close'>;

/** The one status pane: facts first, the complete status text behind `d`. */
export function historianStatusView(content: HistorianStatusContent, host: HistorianStatusHost): FactsView {
  const facts = historianFacts(content.status, content.home, content.nowMs);
  return new FactsView({ ...host, title: 'Historian', state: facts.state, facts: () => facts.groups,
    details: () => styleHistorianStatus(content.text, host.theme) });
}
