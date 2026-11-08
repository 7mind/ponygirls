import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { UiFg, UiTheme } from '@ponygirls/pi-ui';
import { checkpoints, historyText, REPORT_TYPE, reportText, type Checkpoint } from './report.ts';

export interface CuckooContent {
  title: string;
  plain: string;
  render(theme: UiTheme): string;
}

export function terminalText(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

function heading(theme: UiTheme, text: string): string {
  return theme.fg('accent', theme.bold(terminalText(text)));
}

function field(theme: UiTheme, label: string, value: string | null, color: UiFg): string {
  const body = value === null ? theme.fg('muted', 'Not recorded (legacy report)') : terminalText(value);
  return `${theme.fg(color, theme.bold(label))}\n${body}`;
}

function checkpointBody(theme: UiTheme, value: Checkpoint): string {
  if (value.report === null) return [
    theme.fg('error', theme.bold('Invalid report')),
    terminalText(value.error === null ? 'No validated report' : value.error),
    '', theme.fg('muted', 'Raw output (unvalidated; retained verbatim apart from terminal controls)'),
    terminalText(value.raw),
  ].join('\n');
  if (value.report.objectives.length === 0) return theme.fg('muted', 'No current objectives.');
  const count = value.report.objectives.length;
  return `${theme.fg('muted', `${count} objective${count === 1 ? '' : 's'} · saved checkpoint, not live verification`)}\n\n` +
    value.report.objectives.map((item, index) => [
      heading(theme, `${index + 1}. ${item.objective}`),
      field(theme, 'Progress', item.progress, 'accent'),
      field(theme, 'Obstacles', item.obstacles, 'warning'),
      field(theme, 'Issues', item.issues, 'warning'),
      field(theme, 'Bottlenecks', item.bottlenecks, 'warning'),
      field(theme, 'ETA', item.eta, 'accent'),
    ].join('\n\n')).join('\n\n');
}

function introText(theme: UiTheme, intro: string): string {
  return intro.split('\n').map(line => {
    if (line.startsWith('Error: ')) return theme.fg('error', terminalText(line));
    const colon = line.indexOf(':');
    return colon === -1 ? theme.fg('muted', terminalText(line)) :
      `${theme.fg('muted', terminalText(line.slice(0, colon + 1)))}${terminalText(line.slice(colon + 1))}`;
  }).join('\n');
}

export function reportContent(reports: readonly Checkpoint[], intro: string): CuckooContent {
  return {
    title: 'Cuckoo objectives and progress',
    plain: `${intro === '' ? '' : `${intro}\n\n`}${reportText(reports)}`,
    render: theme => {
      const body = reports.length === 0 ? theme.fg('muted', 'No Cuckoo reports on this branch yet.') :
        [...reports].reverse().map((value, index) => [
          heading(theme, `Checkpoint ${reports.length - index}`),
          theme.fg('muted', terminalText(value.requestId)),
          checkpointBody(theme, value),
        ].join('\n\n')).join('\n\n');
      if (intro.startsWith('Error: ')) return `${introText(theme, intro)}\n\n${body}`;
      return intro === '' ? body : `${body}\n\n${heading(theme, 'Status and configuration')}\n${introText(theme, intro)}`;
    },
  };
}

export function historyContent(entries: readonly SessionEntry[], branch: readonly SessionEntry[]): CuckooContent {
  const current = new Set(branch.map(entry => entry.id));
  const answers = entries.filter(entry => entry.type === 'custom' && entry.customType === REPORT_TYPE);
  return {
    title: 'Cuckoo answer history',
    plain: historyText(entries, branch),
    render: theme => answers.length === 0 ? theme.fg('muted', 'No Cuckoo answers in this session yet.') :
      `${theme.fg('muted', 'This session · all branches · newest first · saved answers, not live verification')}\n\n` +
      [...answers].reverse().map(entry => {
        const value = checkpoints([entry])[0];
        return [
          heading(theme, entry.timestamp),
          theme.fg('muted', terminalText(value.requestId)),
          theme.fg('muted', terminalText(`Entry ${entry.id} (${current.has(entry.id) ? 'current branch' : 'other branch'})`)),
          checkpointBody(theme, value),
        ].join('\n\n');
      }).join('\n\n'),
  };
}
