/**
 * Transcript rows of cuckoo_update. Collapsed, a call and its outcome share one line
 * (`cuckoo_update retire AO5 → retired · Superseded by the rewrite`); an error, and the expanded form, show the full
 * text as pi's generic tool rendering does. Only drawing: the result content the model receives is not touched.
 *
 * The row and the mirrors of pi's generic rendering follow ponygirls-codex-goals/src/tool-lines.ts; a third user
 * would justify moving them into @ponygirls/pi-ui.
 */
import { type Component, Container, Text, sliceByColumn, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { UPDATE_TOOL } from './current.ts';

/** The part of pi's Theme the rows use. */
export interface UpdateRowTheme {
  fg(color: 'toolTitle' | 'toolOutput' | 'muted' | 'success' | 'text', text: string): string;
  bold(text: string): string;
}
/** The part of pi's tool render context the rows read. */
export interface UpdateRowContext { readonly args: unknown; readonly expanded: boolean; readonly isPartial: boolean; readonly isError: boolean }
export interface ResultContent { readonly type: string; readonly text?: string }
/** One collapsed row: styled text shown whole, then optional free text that takes the rest of the width. */
export interface RowLine { readonly head: string; readonly tail: { readonly joint: string; readonly text: string } | null }

const ELLIPSIS = '…';
/** Below this many columns free text says nothing; the row ends before it. */
const MIN_TEXT_WIDTH = 4;

/** Unstyled text cut to `width` columns. truncateToWidth ends its cut with a style reset, which would also end the row's background inside pi's tool box. */
function cut(plain: string, width: number): string {
  if (visibleWidth(plain) <= width) return plain;
  return `${sliceByColumn(plain, 0, width - visibleWidth(ELLIPSIS), true)}${ELLIPSIS}`;
}

/** A row that is never wrapped: its free text is cut with an ellipsis. */
class Row implements Component {
  private readonly line: RowLine;
  private readonly theme: UpdateRowTheme;
  constructor(line: RowLine, theme: UpdateRowTheme) { this.line = line; this.theme = theme; }
  invalidate(): void {}
  render(width: number): string[] {
    const w = Math.max(1, Math.floor(width));
    const { head, tail } = this.line;
    if (tail !== null) {
      const room = w - visibleWidth(head) - visibleWidth(tail.joint);
      if (room >= MIN_TEXT_WIDTH) return [`${head}${tail.joint}${this.theme.fg('muted', cut(tail.text, room))}`];
    }
    return [truncateToWidth(head, w, ELLIPSIS)];
  }
}

function field(args: unknown, key: string): unknown {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>)[key] : undefined;
}
/** Free text on one line: whitespace runs collapsed, control characters shown as escapes instead of reaching the terminal. */
function flat(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().replace(/[\u0000-\u001f\u007f-\u009f]/g, control => `\\x${control.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
const title = (theme: UpdateRowTheme): string => theme.fg('toolTitle', theme.bold(UPDATE_TOOL));
const UPDATE_FIELDS = ['objective', 'rule', 'progress', 'issues', 'eta', 'source', 'scope'] as const;

/** What the call says in words, by action: the text a reader recognises the entry or the change by. */
function callText(args: unknown): string {
  switch (field(args, 'action')) {
    case 'add_objective': return flat(field(args, 'objective'));
    case 'add_rule': return flat(field(args, 'rule'));
    case 'complete': return flat(field(args, 'progress'));
    case 'retire': return flat(field(args, 'reason'));
    case 'update': {
      for (const name of UPDATE_FIELDS) { const text = flat(field(args, name)); if (text !== '') return text; }
      return '';
    }
    default: return '';
  }
}
/** `cuckoo_update retire AO5`: the tool, the action and the entry it names. Arguments may be partial while the call streams. */
function callHead(args: unknown, theme: UpdateRowTheme): string {
  const out = (text: string): string => theme.fg('toolOutput', text);
  const action = flat(field(args, 'action')); const id = flat(field(args, 'id'));
  return [title(theme), ...(action === '' ? [] : [out(action)]), ...(id === '' ? [] : [out(id)])].join(' ');
}

/** The call alone, shown until its outcome is known and above an error. */
export function collapsedCall(args: unknown, theme: UpdateRowTheme): RowLine {
  const text = callText(args);
  return { head: callHead(args, theme), tail: text === '' ? null : { joint: theme.fg('toolOutput', ' · '), text } };
}

interface Outcome { readonly id: string; readonly kind: 'objective' | 'rule'; readonly status: 'active' | 'complete' | 'retired' }
/** The outcome the tool reported, or null for details this version does not produce. */
function outcome(details: unknown): Outcome | null {
  const id = field(details, 'id'), kind = field(details, 'kind'), status = field(details, 'status');
  if (typeof id !== 'string' || (kind !== 'objective' && kind !== 'rule') || (status !== 'active' && status !== 'complete' && status !== 'retired')) return null;
  return { id, kind, status };
}

/**
 * A successful call and its outcome on one line, or null when the details have no short form:
 * `cuckoo_update add_objective → AO5 · Port the harness`, `cuckoo_update add_rule → AR4 user · Mockup first`,
 * `cuckoo_update update AO4 → progress, eta · Mockup published`, `cuckoo_update complete AO1 → complete · Surveyed`.
 */
export function collapsedOutcome(args: unknown, details: unknown, theme: UpdateRowTheme): RowLine | null {
  const result = outcome(details);
  if (result === null) return null;
  const out = (text: string): string => theme.fg('toolOutput', text);
  const head = `${callHead(args, theme)}${out(' → ')}`;
  const text = callText(args);
  const tail = text === '' ? null : { joint: out(' · '), text };
  switch (field(args, 'action')) {
    case 'add_objective': return { head: `${head}${theme.bold(theme.fg('text', flat(result.id)))}`, tail };
    case 'add_rule': { const source = flat(field(args, 'source')); return { head: `${head}${theme.bold(theme.fg('text', flat(result.id)))}${source === '' ? '' : out(` ${source}`)}`, tail }; }
    case 'update': return { head: `${head}${out(UPDATE_FIELDS.filter(name => field(args, name) !== undefined).join(', '))}`, tail };
    case 'complete': return { head: `${head}${theme.fg('success', result.status)}`, tail };
    case 'retire': case 'reopen': return { head: `${head}${out(result.status)}`, tail };
    default: return null;
  }
}

// Mirrors of pi's generic tool rendering (formatToolCallWithArgs and the result fallback of its tool row), which pi does not export.
const EXPANDED_TAB = '   ';
// ANSI escape sequences (CSI, OSC and other ESC forms), removed like pi's stripAnsi.
const ANSI_SEQUENCE = /[\u001b\u009b](?:\][\s\S]*?(?:\u0007|\u001b\\|\u009c)|\[[0-?]*[ -/]*[@-~]|[ -/]*[0-~])/g;
const BINARY_CONTROLS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g;

/** pi's expanded generic call header: the title, then one `key: value` line per argument. */
export function expandedCall(args: unknown, theme: UpdateRowTheme): string {
  const header = title(theme);
  if (args === null || args === undefined) return header;
  const entries: Array<[string, unknown]> = typeof args === 'object' && !Array.isArray(args) ? Object.entries(args) : [['args', args]];
  if (entries.length === 0) return header;
  const lines = entries.map(([key, value]) => {
    const encoded: string | undefined = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const body = encoded === undefined ? String(value) : encoded;
    return `  ${key}: ${body.replace(/\t/g, EXPANDED_TAB).replace(/\r/g, '').split('\n').join('\n    ')}`;
  });
  return `${header}\n${theme.fg('muted', lines.join('\n'))}`;
}
/** pi's text output of a tool result (text blocks only; the tool returns no images). */
export function resultText(content: readonly ResultContent[]): string {
  return content.filter(part => part.type === 'text').map(part => (part.text === undefined ? '' : part.text).replace(ANSI_SEQUENCE, '').replace(BINARY_CONTROLS, '').replace(/\r/g, '')).join('\n');
}
/** pi's expanded result fallback: every output line in the tool output colour. */
function fullResult(output: string, theme: UpdateRowTheme): Component {
  if (output === '') return new Container();
  return new Text(output.split('\n').map(line => theme.fg('toolOutput', line)).join('\n'), 0, 0);
}

/** The call's part of a tool row. Collapsed, a successful outcome takes the row over. */
export function renderUpdateCall(args: unknown, theme: UpdateRowTheme, context: UpdateRowContext): Component {
  if (context.expanded) return new Text(expandedCall(args, theme), 0, 0);
  if (!context.isPartial && !context.isError) return new Container();
  return new Row(collapsedCall(args, theme), theme);
}

/** The result's part of a tool row: one line for a successful outcome while collapsed, otherwise the full text. */
export function renderUpdateResult(result: { readonly content: readonly ResultContent[]; readonly details?: unknown }, options: { readonly expanded: boolean }, theme: UpdateRowTheme, context: UpdateRowContext): Component {
  const output = resultText(result.content);
  if (options.expanded || context.isPartial || context.isError) return fullResult(output, theme);
  const line = collapsedOutcome(context.args, result.details, theme);
  if (line !== null) return new Row(line, theme);
  // The call's part is empty here, so the tool is named above text that has no short form.
  const named = new Container();
  named.addChild(new Row(collapsedCall(context.args, theme), theme));
  named.addChild(fullResult(output, theme));
  return named;
}
