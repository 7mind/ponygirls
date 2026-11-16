import { CliError } from './errors.js';
import { isObject } from './json.js';
export function terminalSafe(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export function human(value: unknown): string {
  const lines: string[] = [];
  function render(item: unknown, label: string, indent: string): void {
    if (Array.isArray(item)) { lines.push(`${indent}${label}${item.length === 0 ? ' (none)' : ''}`); for (let i = 0; i < item.length; i++) render(item[i], `[${i + 1}]`, `${indent}  `); }
    else if (isObject(item)) { if (label !== '') lines.push(`${indent}${label}`); const next = label === '' ? indent : `${indent}  `; for (const [key, child] of Object.entries(item)) render(child, `${terminalSafe(key).replaceAll('\n', '\\n').replaceAll('\t', '\\t')}:`, next); }
    else { const text = item === null ? '(none)' : String(item); const pieces = terminalSafe(text).split('\n'); lines.push(`${indent}${label}${label === '' ? '' : ' '}${pieces[0]}`); for (const piece of pieces.slice(1)) lines.push(`${indent}  ${piece}`); }
  }
  render(value, '', ''); return `${lines.join('\n')}\n`;
}
export function output(value: unknown, json: boolean): string {
  try { return json ? `${terminalSafe(JSON.stringify(value))}\n` : human(value); } catch { throw new CliError('protocol-error', 'Output was not encoded by the current generated codec.'); }
}
