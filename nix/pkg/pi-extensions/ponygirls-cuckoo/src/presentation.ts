import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { PLAIN_THEME, formatAgo, type UiFg, type UiTheme } from '@ponygirls/pi-ui';
import { checkpoints, historyText, issuesText, REPORT_TYPE, reportText, type Checkpoint } from './report.ts';
import { commentsOn, savedComments, type NodeRef, type ShownComment } from './comments.ts';
import { UPDATE_TOOL, closedEntries, type Change, type ClosedEntry, type CurrentRule, type CurrentSet } from './current.ts';

export interface CuckooContent {
  title: string;
  plain: string;
  render(theme: UiTheme, width: number): string;
}

const FIELD_INDENT = '   ';
const RULE_COMMENT_INDENT = '     ';
const LABEL_WIDTH = 13;
const MIN_INLINE_VALUE_WIDTH = 16;
const LEGACY_ABSENT = 'Not recorded (legacy report)';
const UNSTATED = 'Not stated';
/**
 * Where a field stands: its indent, what a missing value reads, and an optional tag (an entry ID) in a column of
 * `tagWidth` before the label, on the first line only.
 */
interface FieldPlace { readonly indent: string; readonly absent: string; readonly tag: string; readonly tagWidth: number }
const REPORT_FIELD: FieldPlace = { indent: FIELD_INDENT, absent: LEGACY_ABSENT, tag: '', tagWidth: 0 };
const CURRENT_FIELD: FieldPlace = { ...REPORT_FIELD, absent: UNSTATED };

export function terminalText(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

function heading(theme: UiTheme, text: string, color: UiFg): string {
  return theme.fg(color, theme.bold(terminalText(text)));
}

function field(theme: UiTheme, label: string, value: string | null, color: UiFg, width: number, place: FieldPlace): string {
  const body = value === null ? theme.fg('muted', place.absent) : terminalText(value).replace(/\t/g, '   ');
  const name = `${label}:`;
  const tag = place.tagWidth === 0 ? '' : `${terminalText(place.tag).padEnd(place.tagWidth)} `;
  const prefix = `${place.indent}${tag}${heading(theme, name, color)}${' '.repeat(Math.max(1, LABEL_WIDTH - name.length))}`;
  const prefixWidth = place.indent.length + tag.length + Math.max(LABEL_WIDTH, name.length + 1);
  if (width < prefixWidth + MIN_INLINE_VALUE_WIDTH) {
    const indent = place.indent.slice(0, Math.max(0, width - MIN_INLINE_VALUE_WIDTH));
    const lines = wrapTextWithAnsi(`${indent}${tag}${heading(theme, name, color)}`, Math.max(1, width));
    return [...lines, ...wrapTextWithAnsi(body, Math.max(1, width - indent.length)).map(line => `${indent}${line}`)].join('\n');
  }
  return wrapTextWithAnsi(body, width - prefixWidth).map((line, index) => `${index === 0 ? prefix : ' '.repeat(prefixWidth)}${line}`).join('\n');
}

function numberedHeading(theme: UiTheme, title: string, prefix: string, width: number, color: UiFg): string {
  return wrapTextWithAnsi(terminalText(title).replace(/\t/g, '   '), Math.max(1, width - prefix.length))
    .map((line, lineIndex) => heading(theme, `${lineIndex === 0 ? prefix : ' '.repeat(prefix.length)}${line}`, color)).join('\n');
}

/** The width of the ID column of a list of rules: none when no rule has an ID (reports saved before numbering). */
function idColumn(rules: readonly { readonly id: string | null }[]): number {
  return Math.max(0, ...rules.map(item => item.id === null ? 0 : item.id.length));
}

/** One rule as a field: its source is the label, its ID the tag. `place` carries the list's ID column. */
function ruleField(theme: UiTheme, item: { readonly id: string | null; readonly rule: string; readonly source: 'user' | 'assistant'; readonly scope: string }, color: UiFg, width: number, place: FieldPlace): string[] {
  return field(theme, item.source, `${item.rule} (scope: ${item.scope})`, color, width, { ...place, tag: item.id === null ? '' : item.id }).split('\n');
}

/** One run of detail lines; `node` marks the lines of a commentable rule, objective or answer. */
export interface DetailBlock { readonly node: NodeRef | null; readonly lines: readonly string[] }

function commentFields(theme: UiTheme, comments: readonly ShownComment[], value: Checkpoint, target: NodeRef, width: number, indent: string): string[] {
  return commentsOn(comments, value.requestId, target).flatMap(item =>
    field(theme, 'Comment', `[${item.createdAt === null ? 'new' : item.createdAt}] ${item.text}`, 'success', width, { ...REPORT_FIELD, indent }).split('\n'));
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
  const ruleIds = value.report.rules === null ? 0 : idColumn(value.report.rules);
  if (value.report.rules !== null) value.report.rules.forEach((item, index) => {
    const node: NodeRef = { kind: 'rule', index };
    blocks.push({ node, lines: [
      ...ruleField(theme, item, item.source === 'user' ? 'accent' : 'muted', width, { ...REPORT_FIELD, tagWidth: ruleIds }),
      ...commentFields(theme, comments, value, node, width, RULE_COMMENT_INDENT)] });
  });
  blocks.push({ node: null, lines: [''] });
  if (value.report.objectives.length === 0) blocks.push({ node: null, lines: [theme.fg('muted', 'No current objectives.')] });
  value.report.objectives.forEach((item, index) => {
    const node: NodeRef = { kind: 'objective', index };
    if (index > 0) blocks.push({ node: null, lines: [''] });
    blocks.push({ node, lines: [
      ...numberedHeading(theme, item.objective, `${item.id === null ? index + 1 : item.id}. `, width, 'accent').split('\n'),
      ...field(theme, 'Progress', item.progress, 'accent', width, REPORT_FIELD).split('\n'),
      ...field(theme, 'Issues', issuesText(item.issues), 'warning', width, REPORT_FIELD).split('\n'),
      ...field(theme, 'ETA', item.eta, 'accent', width, REPORT_FIELD).split('\n'),
      ...commentFields(theme, comments, value, node, width, FIELD_INDENT)] });
  });
  if (value.report.answers !== null) {
    blocks.push({ node: null, lines: ['', heading(theme, 'Standing questions', 'warning')] });
    value.report.answers.forEach((item, index) => {
      const node: NodeRef = { kind: 'answer', index };
      if (index > 0) blocks.push({ node: null, lines: [''] });
      blocks.push({ node, lines: [
        ...numberedHeading(theme, `${item.question} (${item.scope}, ${item.id})`, `Q${index + 1}. `, width, 'accent').split('\n'),
        ...field(theme, 'Answer', item.answer, 'accent', width, REPORT_FIELD).split('\n'),
        ...commentFields(theme, comments, value, node, width, FIELD_INDENT)] });
    });
  }
  return blocks;
}

/** Where and when an entry was stated: `checkpoint 3 · 14m ago`, or the tool's name and the age. */
function statedText(change: Change, nowMs: number): string {
  const instant = Date.parse(change.timestamp);
  const age = Number.isFinite(instant) ? formatAgo(instant, nowMs) : terminalText(change.timestamp);
  return `${change.via === 'tool' ? UPDATE_TOOL : `checkpoint ${change.checkpoint}`} · ${age}`;
}

/** One line that says what the current set holds and how fresh it is. */
export function currentSummary(set: CurrentSet, nowMs: number): string {
  const objectives = set.objectives.filter(item => item.status === 'active').length;
  const rules = set.rules.filter(item => item.status === 'active').length;
  const counts = `${objectives} active objective${objectives === 1 ? '' : 's'} · ${rules} active rule${rules === 1 ? '' : 's'}`;
  return set.last === null ? counts : `${counts} · last change: ${statedText(set.last, nowMs)}`;
}

/** A statement made about a closed entry after it was closed, such as a caveat found later; nothing when there was none. */
function laterStatement(theme: UiTheme, item: ClosedEntry, width: number, nowMs: number, place: FieldPlace): string[] {
  return item.stated.position === item.closed.position ? [] : field(theme, 'As of', statedText(item.stated, nowMs), 'muted', width, place).split('\n');
}

function closedObjective(theme: UiTheme, item: Exclude<ClosedEntry, CurrentRule>, width: number, nowMs: number): string[] {
  const lines = numberedHeading(theme, item.objective, `${item.id}. `, width, 'muted').split('\n');
  if (item.status === 'complete') return [...lines,
    ...field(theme, 'Complete', statedText(item.closed, nowMs), 'success', width, CURRENT_FIELD).split('\n'),
    ...field(theme, 'Delivered', item.progress, 'muted', width, CURRENT_FIELD).split('\n'),
    ...field(theme, 'Caveats', issuesText(item.issues), 'warning', width, CURRENT_FIELD).split('\n'),
    ...laterStatement(theme, item, width, nowMs, CURRENT_FIELD)];
  return [...lines, ...retiredFields(theme, item, width, nowMs, CURRENT_FIELD)];
}

/** How and why an entry was retired: the model's reason, or the checkpoint that no longer listed it. */
function retiredFields(theme: UiTheme, item: ClosedEntry, width: number, nowMs: number, place: FieldPlace): string[] {
  const reason = item.reason === null ? (item.closed.via === 'checkpoint' ? 'Left out of that checkpoint; no reason was given' : 'No reason was given') : item.reason;
  return [...field(theme, 'Retired', statedText(item.closed, nowMs), 'muted', width, place).split('\n'), ...field(theme, 'Reason', reason, 'muted', width, place).split('\n'),
    ...laterStatement(theme, item, width, nowMs, place)];
}

/** One run of lines of the current set; `entry` is the ID of the entry they show, null for headings and spacing. */
export interface CurrentBlock { readonly entry: string | null; readonly lines: readonly string[] }

/**
 * The current set as blocks: active objectives, active rules, then the entries closed most recently. Objectives come
 * first here, unlike in a report: this view answers what the model is working on now, and a session holds many rules.
 */
export function currentBlocks(theme: UiTheme, set: CurrentSet, width: number, nowMs: number): CurrentBlock[] {
  const rules = set.rules.filter(item => item.status === 'active');
  const objectives = set.objectives.filter(item => item.status === 'active');
  const { shown, older } = closedEntries(set);
  const ruleIds = idColumn([...rules, ...shown.filter(item => 'rule' in item)]);
  const blocks: CurrentBlock[] = [];
  if (objectives.length === 0) blocks.push({ entry: null, lines: [theme.fg('muted', 'No active objectives.')] });
  objectives.forEach((item, index) => {
    if (index > 0) blocks.push({ entry: null, lines: [''] });
    // An objective added with the tool, or reopened, may not say everything yet: one line names what it leaves unstated.
    const unstated = [...(item.progress === null ? ['progress'] : []), ...(item.issues === null ? ['issues'] : []), ...(item.eta === null ? ['ETA'] : [])];
    blocks.push({ entry: item.id, lines: [
      ...numberedHeading(theme, item.objective, `${item.id}. `, width, 'accent').split('\n'),
      ...(item.progress === null ? [] : field(theme, 'Progress', item.progress, 'accent', width, CURRENT_FIELD).split('\n')),
      ...(item.issues === null ? [] : field(theme, 'Issues', issuesText(item.issues), 'warning', width, CURRENT_FIELD).split('\n')),
      ...(item.eta === null ? [] : field(theme, 'ETA', item.eta, 'accent', width, CURRENT_FIELD).split('\n')),
      ...(unstated.length === 0 ? [] : field(theme, UNSTATED, unstated.join(', '), 'muted', width, CURRENT_FIELD).split('\n')),
      ...field(theme, 'As of', statedText(item.stated, nowMs), 'muted', width, CURRENT_FIELD).split('\n')] });
  });
  blocks.push({ entry: null, lines: ['', heading(theme, 'Session-local rules', 'warning'),
    ...(rules.length === 0 ? [theme.fg('muted', '  No active session-local rules.')] : [])] });
  for (const item of rules) blocks.push({ entry: item.id,
    lines: ruleField(theme, item, item.source === 'user' ? 'accent' : 'muted', width, { ...CURRENT_FIELD, tagWidth: ruleIds }) });
  if (shown.length === 0) return blocks;
  blocks.push({ entry: null, lines: ['', `${heading(theme, 'Closed', 'muted')}${theme.fg('muted', ` · newest first${older === 0 ? '' : ` · ${older} older not shown`}`)}`] });
  shown.forEach((item, index) => {
    if (index > 0) blocks.push({ entry: null, lines: [''] });
    if ('rule' in item) {
      const place: FieldPlace = { ...CURRENT_FIELD, tagWidth: ruleIds };
      // The fields of a closed rule line up under its source label, past the ID column.
      const under: FieldPlace = { ...CURRENT_FIELD, indent: ' '.repeat(FIELD_INDENT.length + (ruleIds === 0 ? 0 : ruleIds + 1)) };
      blocks.push({ entry: item.id, lines: [...ruleField(theme, item, 'muted', width, place), ...retiredFields(theme, item, width, nowMs, under)] });
    } else blocks.push({ entry: item.id, lines: closedObjective(theme, item, width, nowMs) });
  });
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

/** Width at which the plain form of the current set is laid out: wide enough that a field value is not wrapped. */
const PLAIN_WIDTH = 100000;
/** The current set as text under its own heading, or nothing for a branch that has none. */
function currentSection(theme: UiTheme, set: CurrentSet, width: number, nowMs: number): string {
  if (set.events === 0) return '';
  return [`${heading(theme, 'Current set', 'accent')}${theme.fg('muted', ` · ${currentSummary(set, nowMs)} · the model's own account, not live verification`)}`,
    '', ...currentBlocks(theme, set, width, nowMs).flatMap(block => block.lines)].join('\n');
}

/** Reports of one branch, preceded by its current set when it has one; `nowMs` is the time the ages in the set are counted from. */
export function reportContent(reports: readonly Checkpoint[], intro: string, comments: readonly ShownComment[], current: CurrentSet, nowMs: number): CuckooContent {
  const plainCurrent = currentSection(PLAIN_THEME, current, PLAIN_WIDTH, nowMs);
  return {
    title: 'Cuckoo objectives and progress',
    plain: `${intro === '' ? '' : `${intro}\n\n`}${plainCurrent === '' ? '' : `${plainCurrent}\n\n`}${reportText(reports, comments)}`,
    render: (theme, width) => {
      const themedCurrent = currentSection(theme, current, width, nowMs);
      const checkpointsBody = reports.length === 0 ? theme.fg('muted', 'No Cuckoo reports on this branch yet.') :
        [...reports].reverse().map((value, index) => [
          `${heading(theme, `Checkpoint ${reports.length - index}`, 'accent')}${qualifier(theme, value)}`,
          theme.fg('muted', terminalText(`  Request: ${value.requestId}`)),
          '', checkpointDetail(theme, value, width, comments),
        ].join('\n')).join('\n\n');
      const body = themedCurrent === '' ? checkpointsBody : `${themedCurrent}\n\n${checkpointsBody}`;
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