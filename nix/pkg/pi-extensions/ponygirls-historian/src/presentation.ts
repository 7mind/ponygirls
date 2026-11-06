import type { UiTheme } from '@ponygirls/pi-ui';

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
