import { CliError, terminalSafe } from './errors.js';
import { isObject } from './json.js';
export { terminalSafe };
import type { Environment } from './files.js';
export type ColorMode = 'auto' | 'always' | 'never';
export function useColor(mode: ColorMode, json: boolean, tty: boolean, env: Environment): boolean {
  if (json || mode === 'never') return false;
  if (mode === 'always') return true;
  return tty && (env['NO_COLOR'] === undefined || env['NO_COLOR'] === '') && env['TERM'] !== 'dumb';
}
const STYLE = { heading: '1;36', label: '36', muted: '2', error: '1;31' } as const;
export class Presentation {
  constructor(private readonly colored: boolean) {}
  style(role: keyof typeof STYLE, text: string): string { return this.colored && text !== '' ? `\u001b[${STYLE[role]}m${text}\u001b[0m` : text; }
  help(text: string): string { return text.split('\n').map(line => line !== '' && (!line.startsWith(' ') && (line.endsWith(':') || line.startsWith('Usage:') || line.startsWith('chronicle —'))) ? this.style('heading', line) : line).join('\n'); }
  failure(error: CliError, hint: string): string { return `${this.style('error', `chronicle: ${error.code}:`)} ${terminalSafe(error.message)}\n${hint === '' ? '' : `${this.style('muted', hint)}\n`}`; }
  output(value: unknown, json: boolean): string {
    try { return json ? `${terminalSafe(JSON.stringify(value))}\n` : renderHuman(value, this); } catch { throw new CliError('protocol-error', 'Output was not encoded by the current generated codec.'); }
  }
}
function renderHuman(value: unknown, presentation: Presentation): string {
  const lines: string[] = [];
  function render(item: unknown, label: string, indent: string): void {
    const styledLabel = presentation.style('label', label);
    if (Array.isArray(item)) { lines.push(`${indent}${styledLabel}${item.length === 0 ? ` ${presentation.style('muted', '(none)')}` : ''}`); for (let i = 0; i < item.length; i++) render(item[i], `[${i + 1}]`, `${indent}  `); }
    else if (isObject(item)) { if (label !== '') lines.push(`${indent}${styledLabel}`); const next = label === '' ? indent : `${indent}  `; for (const [key, child] of Object.entries(item)) render(child, `${terminalSafe(key).replaceAll('\n', '\\n').replaceAll('\t', '\\t')}:`, next); }
    else { const text = item === null ? '(none)' : String(item); const pieces = terminalSafe(text).split('\n'); lines.push(`${indent}${styledLabel}${label === '' ? '' : ' '}${item === null ? presentation.style('muted', pieces[0]!) : pieces[0]}`); for (const piece of pieces.slice(1)) lines.push(`${indent}  ${piece}`); }
  }
  render(value, '', ''); return `${lines.join('\n')}\n`;
}
export function human(value: unknown): string { return new Presentation(false).output(value, false); }
export function output(value: unknown, json: boolean): string { return new Presentation(false).output(value, json); }
