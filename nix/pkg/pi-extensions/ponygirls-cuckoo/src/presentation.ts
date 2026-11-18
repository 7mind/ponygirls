import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { UiFg, UiTheme } from '@ponygirls/pi-ui';
import { checkpoints, historyText, issuesText, REPORT_TYPE, reportText, type Checkpoint } from './report.ts';
import { commentsOn, savedComments, type NodeRef, type ShownComment } from './comments.ts';

export interface CuckooContent {
  title: string;
  plain: string;
  render(theme: UiTheme, width: number): string;
}

const FIELD_INDENT = '   ';
const RULE_COMMENT_INDENT = '     ';
const LABEL_WIDTH = 13;
const MIN_INLINE_VALUE_WIDTH = 16;

export function terminalText(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

function heading(theme: UiTheme, text: string, color: UiFg): string {
  return theme.fg(color, theme.bold(terminalText(text)));
}

function field(theme: UiTheme, label: string, value: string | null, color: UiFg, width: number, fieldIndent: string): string {
  const body = value === null ? theme.fg('muted', 'Not recorded (legacy report)') : terminalText(value).replace(/\t/g, '   ');
  const name = `${label}:`;
  const prefix = `${fieldIndent}${heading(theme, name, color)}${' '.repeat(Math.max(1, LABEL_WIDTH - name.length))}`;
  const prefixWidth = fieldIndent.length + Math.max(LABEL_WIDTH, name.length + 1);
  if (width < prefixWidth + MIN_INLINE_VALUE_WIDTH) {
    const indent = fieldIndent.slice(0, Math.max(0, width - MIN_INLINE_VALUE_WIDTH));
    const lines = wrapTextWithAnsi(`${indent}${heading(theme, name, color)}`, Math.max(1, width));
    return [...lines, ...wrapTextWithAnsi(body, Math.max(1, width - indent.length)).map(line => `${indent}${line}`)].join('\n');
  }
  return wrapTextWithAnsi(body, width - prefixWidth).map((line, index) => `${index === 0 ? prefix : ' '.repeat(prefixWidth)}${line}`).join('\n');
}

function numberedHeading(theme: UiTheme, title: string, prefix: string, width: number): string {
  return wrapTextWithAnsi(terminalText(title).replace(/\t/g, '   '), Math.max(1, width - prefix.length))
    .map((line, lineIndex) => heading(theme, `${lineIndex === 0 ? prefix : ' '.repeat(prefix.length)}${line}`, 'accent')).join('\n');
}

/** One run of detail lines; `node` marks the lines of a commentable rule, objective or answer. */
export interface DetailBlock { readonly node: NodeRef | null; readonly lines: readonly string[] }

function commentFields(theme: UiTheme, comments: readonly ShownComment[], value: Checkpoint, target: NodeRef, width: number, indent: string): string[] {
  return commentsOn(comments, value.requestId, target).flatMap(item =>
    field(theme, 'Comment', `[${item.createdAt === null ? 'new' : item.createdAt}] ${item.text}`, 'success', width, indent).split('\n'));
}

/** A checkpoint's body as blocks, so the panel can select nodes and place comments under them. */
export function checkpointBlocks(theme: UiTheme, value: Checkpoint, width: number, comments: readonly ShownComment[]): DetailBlock[] {
  if (value.report === null) return [{ node: null, lines: [
    heading(theme, 'Invalid report', 'error'),
    terminalText(value.error === null ? 'No validated report' : value.error),
    ...(value.questions.length === 0 ? [] : ['', theme.fg('muted', 'Standing questions asked'),
      ...value.questions.map(item => terminalText(`  ${item.id} (${item.scope}): ${item.question}`))]),
    '', theme.fg('muted', 'Raw output (unvalidated; retained verbatim apart from terminal controls)'),
    ...terminalText(value.raw).split('\n'),
  ] }];
  const blocks: DetailBlock[] = [{ node: null, lines: [heading(theme, 'Session-local rules', 'warning'),
    ...(value.report.rules === null ? [theme.fg('muted', '  Session rules not recorded (legacy report)')] :
      value.report.rules.length === 0 ? [theme.fg('muted', '  No session-local rules reported.')] : [])] }];
  if (value.report.rules !== null) value.report.rules.forEach((item, index) => {
    const node: NodeRef = { kind: 'rule', index };
    blocks.push({ node, lines: [
      ...field(theme, item.source, `${item.rule} (scope: ${item.scope})`, item.source === 'user' ? 'accent' : 'muted', width, FIELD_INDENT).split('\n'),
      ...commentFields(theme, comments, value, node, width, RULE_COMMENT_INDENT)] });
  });
  blocks.push({ node: null, lines: [''] });
  if (value.report.objectives.length === 0) blocks.push({ node: null, lines: [theme.fg('muted', 'No current objectives.')] });
  value.report.objectives.forEach((item, index) => {
    const node: NodeRef = { kind: 'objective', index };
    if (index > 0) blocks.push({ node: null, lines: [''] });
    blocks.push({ node, lines: [
      ...numberedHeading(theme, item.objective, `${index + 1}. `, width).split('\n'),
      ...field(theme, 'Progress', item.progress, 'accent', width, FIELD_INDENT).split('\n'),
      ...field(theme, 'Issues', issuesText(item.issues), 'warning', width, FIELD_INDENT).split('\n'),
      ...field(theme, 'ETA', item.eta, 'accent', width, FIELD_INDENT).split('\n'),
      ...commentFields(theme, comments, value, node, width, FIELD_INDENT)] });
  });
  if (value.report.answers !== null) {
    blocks.push({ node: null, lines: ['', heading(theme, 'Standing questions', 'warning')] });
    value.report.answers.forEach((item, index) => {
      const node: NodeRef = { kind: 'answer', index };
      if (index > 0) blocks.push({ node: null, lines: [''] });
      blocks.push({ node, lines: [
        ...numberedHeading(theme, `${item.question} (${item.scope}, ${item.id})`, `Q${index + 1}. `, width).split('\n'),
        ...field(theme, 'Answer', item.answer, 'accent', width, FIELD_INDENT).split('\n'),
        ...commentFields(theme, comments, value, node, width, FIELD_INDENT)] });
    });
  }
  return blocks;
}

/** Render a single checkpoint's body as text. */
export function checkpointDetail(theme: UiTheme, value: Checkpoint, width: number, comments: readonly ShownComment[]): string {
  return checkpointBlocks(theme, value, width, comments).flatMap(block => block.lines).join('\n');
}

function qualifier(theme: UiTheme, value: Checkpoint): string {
  if (value.report === null) return theme.fg('muted', ' · saved attempt');
  const count = value.report.objectives.length;
  return theme.fg('muted', ` · ${count} objective${count === 1 ? '' : 's'} · saved self-report, not live verification`);
}

function introText(theme: UiTheme, intro: string): string {
  return intro.split('\n').map(line => {
    if (line.startsWith('Error: ')) return theme.fg('error', terminalText(line));
    const colon = line.indexOf(':');
    return colon === -1 ? theme.fg('muted', terminalText(line)) :
      `${theme.fg('muted', terminalText(line.slice(0, colon + 1)))}${terminalText(line.slice(colon + 1))}`;
  }).join('\n');
}

export function reportContent(reports: readonly Checkpoint[], intro: string, comments: readonly ShownComment[]): CuckooContent {
  return {
    title: 'Cuckoo objectives and progress',
    plain: `${intro === '' ? '' : `${intro}\n\n`}${reportText(reports, comments)}`,
    render: (theme, width) => {
      const body = reports.length === 0 ? theme.fg('muted', 'No Cuckoo reports on this branch yet.') :
        [...reports].reverse().map((value, index) => [
          `${heading(theme, `Checkpoint ${reports.length - index}`, 'accent')}${qualifier(theme, value)}`,
          theme.fg('muted', terminalText(`  Request: ${value.requestId}`)),
          '', checkpointDetail(theme, value, width, comments),
        ].join('\n')).join('\n\n');
      if (intro.startsWith('Error: ')) return `${introText(theme, intro)}\n\n${body}`;
      return intro === '' ? body : `${body}\n\n${heading(theme, 'Status and configuration', 'muted')}\n${introText(theme, intro)}`;
    },
  };
}

export function historyContent(entries: readonly SessionEntry[], branch: readonly SessionEntry[]): CuckooContent {
  const current = new Set(branch.map(entry => entry.id));
  const answers = entries.filter(entry => entry.type === 'custom' && entry.customType === REPORT_TYPE);
  const comments = savedComments(entries);
  return {
    title: 'Cuckoo answer history',
    plain: historyText(entries, branch),
    render: (theme, width) => answers.length === 0 ? theme.fg('muted', 'No Cuckoo answers in this session yet.') :
      `${theme.fg('muted', 'This session · all branches · newest first · saved answers, not live verification')}\n\n` +
      [...answers].reverse().map(entry => {
        const value = checkpoints([entry])[0];
        return [
          `${heading(theme, entry.timestamp, 'accent')}${qualifier(theme, value)}`,
          theme.fg('muted', terminalText(`  Request: ${value.requestId}`)),
          theme.fg('muted', terminalText(`  Entry ${entry.id} (${current.has(entry.id) ? 'current branch' : 'other branch'})`)),
          '', checkpointDetail(theme, value, width, comments),
        ].join('\n');
      }).join('\n\n'),
  };
}