import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { ID_PREFIX, parseEntryId, type EntryKind, type NextNumbers } from './ids.ts';
import { COMPLETE_ETA, MAX_COMPLETED_TITLES, MAX_COMPLETED_TITLE_CHARS, MAX_FIELD_CHARS, MAX_ISSUES, MAX_OBJECTIVES, MAX_RULES, REPORT_TYPE, checkpoints, completedObjectives, savedNumbering,
  type Assigned, type Checkpoint, type KnownIds, type Report } from './report.ts';

/** One edit of the current set made with the model's tool; never part of model context by itself. */
export const EDIT_TYPE = 'cuckoo.edit';
/** The model's tool that writes edits; reading stays with cuckoo_recall. */
export const UPDATE_TOOL = 'cuckoo_update';
export const MAX_REASON_CHARS = MAX_FIELD_CHARS;
/** What the tool writes as the estimate of an objective it completes: the form a checkpoint reply uses. */
const COMPLETE = 'Complete';

export type ObjectiveStatus = 'active' | 'complete' | 'retired';
export type RuleStatus = 'active' | 'retired';
export type RuleSource = 'user' | 'assistant';
interface SavedEvent { readonly entryId: string; readonly timestamp: string; readonly position: number }
/**
 * The saved event that created an entry or last stated it; `position` is that event's place on the branch. A
 * checkpoint also carries its number: the place of its report among the saved checkpoints of the branch, as the
 * report list counts them.
 */
export type Change = (SavedEvent & { readonly via: 'checkpoint'; readonly checkpoint: number }) | (SavedEvent & { readonly via: 'tool' });
/** `reason` is what the model gave when it retired the entry with the tool; null otherwise, also for an entry a checkpoint left out. */
export interface CurrentObjective {
  readonly id: string; readonly objective: string; readonly progress: string | null; readonly issues: readonly string[] | null; readonly eta: string | null;
  readonly status: ObjectiveStatus; readonly reason: string | null; readonly created: Change; readonly stated: Change;
}
export interface CurrentRule {
  readonly id: string; readonly rule: string; readonly source: RuleSource; readonly scope: string;
  readonly status: RuleStatus; readonly reason: string | null; readonly created: Change; readonly stated: Change;
}
/** The numbered objectives and rules of one branch, in ID order. `events` counts the numbered reports and edits behind it; none means no set yet. */
export interface CurrentSet { readonly objectives: readonly CurrentObjective[]; readonly rules: readonly CurrentRule[]; readonly events: number; readonly last: Change | null }

export interface ObjectiveFields { readonly objective?: string; readonly progress?: string; readonly issues?: readonly string[]; readonly eta?: string }
export interface RuleFields { readonly rule?: string; readonly source?: RuleSource; readonly scope?: string }
/** An addition carries the ID Cuckoo gave it. `update` changes content only; the other actions change status. */
export type Edit =
  | { readonly action: 'add_objective'; readonly id: string; readonly objective: string; readonly progress: string | null; readonly issues: readonly string[] | null; readonly eta: string | null }
  | { readonly action: 'add_rule'; readonly id: string; readonly rule: string; readonly source: RuleSource; readonly scope: string }
  | { readonly action: 'update'; readonly id: string; readonly fields: ObjectiveFields | RuleFields }
  | { readonly action: 'complete'; readonly id: string; readonly progress: string; readonly issues: readonly string[] }
  | { readonly action: 'retire'; readonly id: string; readonly reason: string }
  | { readonly action: 'reopen'; readonly id: string };
/** What an edit did, as the tool reports it. */
export interface EditOutcome { readonly id: string; readonly kind: EntryKind; readonly status: ObjectiveStatus; readonly activeObjectives: number; readonly activeRules: number }

function invalid(message: string): never { throw new Error(`Invalid Cuckoo edit: ${message}`); }
function plain(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(`${what} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: readonly string[], what: string): void {
  if (Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) invalid(`${what} must contain only ${fields.join(', ')}`);
}
function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) invalid(`${name} must be a nonempty string of at most ${maximum} characters`);
  return value;
}
function issueList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ISSUES) invalid(`issues must be an array of at most ${MAX_ISSUES} strings`);
  return value.map(item => text(item, 'an issue', MAX_FIELD_CHARS));
}
function ruleSource(value: unknown): RuleSource {
  if (value !== 'user' && value !== 'assistant') invalid('source must be user or assistant');
  return value;
}
function idOf(value: unknown, kind: EntryKind | null): { id: string; kind: EntryKind } {
  const parsed = parseEntryId(value);
  if (parsed === null) invalid(`id must be an objective id (${ID_PREFIX.objective}…) or a rule id (${ID_PREFIX.rule}…)`);
  if (kind !== null && parsed.kind !== kind) invalid(kind === 'objective' ? `${String(value)} is a rule; only an objective can be completed or added as one` : `${String(value)} is an objective, not a rule`);
  return { id: value as string, kind: parsed.kind };
}
/** An estimate the tool may store: completion has its own action, so that status and estimate cannot disagree. */
function openEta(value: unknown): string {
  const eta = text(value, 'eta', MAX_FIELD_CHARS);
  if (COMPLETE_ETA.test(eta)) invalid('an eta cannot say Complete; use the complete action to close an objective');
  return eta;
}
const OBJECTIVE_FIELDS = ['objective', 'progress', 'issues', 'eta'] as const;
const RULE_FIELDS = ['rule', 'source', 'scope'] as const;

/** Decode an edit, strictly: the tool's own output and what a session file holds go through the same check. */
export function decodeEdit(value: unknown): Edit {
  const data = plain(value, 'an edit');
  switch (data.action) {
    case 'add_objective': {
      exact(data, ['action', 'id', ...OBJECTIVE_FIELDS], 'add_objective');
      return { action: 'add_objective', id: idOf(data.id, 'objective').id, objective: text(data.objective, 'objective', MAX_FIELD_CHARS),
        progress: data.progress === null ? null : text(data.progress, 'progress', MAX_FIELD_CHARS), issues: data.issues === null ? null : issueList(data.issues),
        eta: data.eta === null ? null : openEta(data.eta) };
    }
    case 'add_rule':
      exact(data, ['action', 'id', ...RULE_FIELDS], 'add_rule');
      return { action: 'add_rule', id: idOf(data.id, 'rule').id, rule: text(data.rule, 'rule', MAX_FIELD_CHARS), source: ruleSource(data.source), scope: text(data.scope, 'scope', MAX_FIELD_CHARS) };
    case 'update': {
      exact(data, ['action', 'id', 'fields'], 'update');
      const { id, kind } = idOf(data.id, null);
      const fields = plain(data.fields, 'fields');
      const allowed: readonly string[] = kind === 'objective' ? OBJECTIVE_FIELDS : RULE_FIELDS;
      const names = Object.keys(fields);
      if (names.length === 0) invalid(`update of ${id} must change at least one of ${allowed.join(', ')}`);
      for (const name of names) if (!allowed.includes(name)) invalid(`${id} is ${kind === 'objective' ? 'an objective' : 'a rule'}; update accepts ${allowed.join(', ')}`);
      if (kind === 'objective') return { action: 'update', id, fields: {
        ...('objective' in fields ? { objective: text(fields.objective, 'objective', MAX_FIELD_CHARS) } : {}),
        ...('progress' in fields ? { progress: text(fields.progress, 'progress', MAX_FIELD_CHARS) } : {}),
        ...('issues' in fields ? { issues: issueList(fields.issues) } : {}),
        ...('eta' in fields ? { eta: openEta(fields.eta) } : {}) } };
      return { action: 'update', id, fields: {
        ...('rule' in fields ? { rule: text(fields.rule, 'rule', MAX_FIELD_CHARS) } : {}),
        ...('source' in fields ? { source: ruleSource(fields.source) } : {}),
        ...('scope' in fields ? { scope: text(fields.scope, 'scope', MAX_FIELD_CHARS) } : {}) } };
    }
    case 'complete':
      exact(data, ['action', 'id', 'progress', 'issues'], 'complete');
      return { action: 'complete', id: idOf(data.id, 'objective').id, progress: text(data.progress, 'progress', MAX_FIELD_CHARS), issues: issueList(data.issues) };
    case 'retire':
      exact(data, ['action', 'id', 'reason'], 'retire');
      return { action: 'retire', id: idOf(data.id, null).id, reason: text(data.reason, 'reason', MAX_REASON_CHARS) };
    case 'reopen':
      exact(data, ['action', 'id'], 'reopen');
      return { action: 'reopen', id: idOf(data.id, null).id };
    default: return invalid('action must be add_objective, add_rule, update, complete, retire or reopen');
  }
}

/** The persisted form of one edit. */
export function editRecord(edit: unknown): { readonly version: 1; readonly edit: Edit } {
  return { version: 1, edit: decodeEdit(edit) };
}
function savedEdit(entry: SessionEntry): Edit | null {
  if (entry.type !== 'custom' || entry.customType !== EDIT_TYPE) return null;
  try {
    const data = plain(entry.data, 'a saved edit'); exact(data, ['version', 'edit'], 'a saved edit');
    if (data.version !== 1) invalid('unsupported version');
    return decodeEdit(data.edit);
  } catch (error) { throw new Error(`Invalid saved Cuckoo edit at entry ${entry.id}: ${error instanceof Error ? error.message : String(error)}`); }
}

/** The set while it is being folded. Entries are replaced, never changed in place, so a finished set can be shared. */
class Builder {
  readonly objectives = new Map<string, CurrentObjective>();
  readonly rules = new Map<string, CurrentRule>();
  events = 0;
  last: Change | null = null;

  static from(set: CurrentSet): Builder {
    const builder = new Builder();
    for (const item of set.objectives) builder.objectives.set(item.id, item);
    for (const item of set.rules) builder.rules.set(item.id, item);
    builder.events = set.events; builder.last = set.last;
    return builder;
  }

  private active(kind: EntryKind): number {
    let count = 0;
    for (const item of kind === 'objective' ? this.objectives.values() : this.rules.values()) if (item.status === 'active') count++;
    return count;
  }
  private room(kind: EntryKind): void {
    const maximum = kind === 'objective' ? MAX_OBJECTIVES : MAX_RULES;
    if (this.active(kind) >= maximum) throw new Error(`The record holds at most ${maximum} active ${kind}s; ${kind === 'objective' ? 'complete or retire' : 'retire'} one first`);
  }
  private objective(id: string): CurrentObjective {
    const item = this.objectives.get(id);
    if (item === undefined) throw new Error(`${id} is not in the record of this branch; read the record with cuckoo_recall action current`);
    return item;
  }
  private rule(id: string): CurrentRule {
    const item = this.rules.get(id);
    if (item === undefined) throw new Error(`${id} is not in the record of this branch; read the record with cuckoo_recall action current`);
    return item;
  }
  private done(change: Change): void { this.events++; this.last = change; }

  /**
   * A full restatement: what it lists is as it says, and what it leaves out is closed, except objectives already
   * complete. `assigned` are the IDs the report introduced; one that the record already holds would name two entries.
   */
  report(report: Report, assigned: Assigned, change: Change): void {
    for (const id of [...assigned.objectives, ...assigned.rules]) {
      if (this.objectives.has(id) || this.rules.has(id)) throw new Error(`Invalid saved Cuckoo checkpoint numbering at entry ${change.entryId}: ${id} is already in the record`);
    }
    const listed = new Set<string>();
    for (const item of report.objectives) {
      if (item.id === null) throw new Error('A numbered report holds an objective without an id');
      const previous = this.objectives.get(item.id);
      listed.add(item.id);
      this.objectives.set(item.id, { id: item.id, objective: item.objective, progress: item.progress, issues: item.issues, eta: item.eta,
        status: item.eta !== null && COMPLETE_ETA.test(item.eta) ? 'complete' : 'active', reason: null, created: previous === undefined ? change : previous.created, stated: change });
    }
    for (const item of this.objectives.values()) if (item.status === 'active' && !listed.has(item.id)) this.objectives.set(item.id, { ...item, status: 'retired', reason: null, stated: change });
    for (const item of report.rules === null ? [] : report.rules) {
      if (item.id === null) throw new Error('A numbered report holds a rule without an id');
      const previous = this.rules.get(item.id);
      listed.add(item.id);
      this.rules.set(item.id, { id: item.id, rule: item.rule, source: item.source, scope: item.scope, status: 'active', reason: null, created: previous === undefined ? change : previous.created, stated: change });
    }
    for (const item of this.rules.values()) if (item.status === 'active' && !listed.has(item.id)) this.rules.set(item.id, { ...item, status: 'retired', reason: null, stated: change });
    this.done(change);
  }

  /** Apply one edit, or throw the reason it does not fit the record. */
  edit(edit: Edit, change: Change): EditOutcome {
    const kind = idOf(edit.id, null).kind;
    let status: ObjectiveStatus;
    switch (edit.action) {
      case 'add_objective':
        if (this.objectives.has(edit.id)) throw new Error(`${edit.id} is already in the record`);
        this.room('objective');
        this.objectives.set(edit.id, { id: edit.id, objective: edit.objective, progress: edit.progress, issues: edit.issues, eta: edit.eta, status: 'active', reason: null, created: change, stated: change });
        status = 'active'; break;
      case 'add_rule':
        if (this.rules.has(edit.id)) throw new Error(`${edit.id} is already in the record`);
        this.room('rule');
        this.rules.set(edit.id, { id: edit.id, rule: edit.rule, source: edit.source, scope: edit.scope, status: 'active', reason: null, created: change, stated: change });
        status = 'active'; break;
      case 'update': {
        // A retired entry changes only by being reopened, so what it says is what it said when it was retired.
        if ((kind === 'objective' ? this.objective(edit.id) : this.rule(edit.id)).status === 'retired') throw new Error(`${edit.id} is retired; reopen it before changing it`);
        if (kind === 'objective') {
          const item = this.objective(edit.id);
          if ('eta' in edit.fields && item.status === 'complete') throw new Error(`${edit.id} is complete; reopen it before giving it an estimate`);
          this.objectives.set(edit.id, { ...item, ...(edit.fields as ObjectiveFields), stated: change });
          status = item.status;
        } else {
          const item = this.rule(edit.id);
          this.rules.set(edit.id, { ...item, ...(edit.fields as RuleFields), stated: change });
          status = item.status;
        }
        break;
      }
      case 'complete': {
        const item = this.objective(edit.id);
        if (item.status === 'complete') throw new Error(`${edit.id} is already complete; use update to correct what it says`);
        if (item.status === 'retired') throw new Error(`${edit.id} is retired, not active; reopen it first`);
        this.objectives.set(edit.id, { ...item, progress: edit.progress, issues: edit.issues, eta: COMPLETE, status: 'complete', reason: null, stated: change });
        status = 'complete'; break;
      }
      case 'retire': {
        const item = kind === 'objective' ? this.objective(edit.id) : this.rule(edit.id);
        if (item.status === 'retired') throw new Error(`${edit.id} is already retired`);
        if (item.status === 'complete') throw new Error(`${edit.id} is complete, not active; a completed objective is not retired`);
        if (kind === 'objective') this.objectives.set(edit.id, { ...this.objective(edit.id), status: 'retired', reason: edit.reason, stated: change });
        else this.rules.set(edit.id, { ...this.rule(edit.id), status: 'retired', reason: edit.reason, stated: change });
        status = 'retired'; break;
      }
      case 'reopen': {
        const item = kind === 'objective' ? this.objective(edit.id) : this.rule(edit.id);
        if (item.status === 'active') throw new Error(`${edit.id} is active; only a completed or retired entry can be reopened`);
        this.room(kind);
        // A completed objective loses the estimate that said so; nothing else about it is known to have changed.
        if (kind === 'objective') { const objective = this.objective(edit.id); this.objectives.set(edit.id, { ...objective, eta: objective.status === 'complete' ? null : objective.eta, status: 'active', reason: null, stated: change }); }
        else this.rules.set(edit.id, { ...this.rule(edit.id), status: 'active', reason: null, stated: change });
        status = 'active'; break;
      }
    }
    this.done(change);
    return { id: edit.id, kind, status, activeObjectives: this.active('objective'), activeRules: this.active('rule') };
  }

  set(): CurrentSet {
    const number = (id: string): number => { const parsed = parseEntryId(id); if (parsed === null) throw new Error('Invalid Cuckoo entry id'); return parsed.number; };
    const ordered = <T extends { id: string }>(items: Iterable<T>): T[] => [...items].sort((left, right) => number(left.id) - number(right.id));
    return { objectives: ordered(this.objectives.values()), rules: ordered(this.rules.values()), events: this.events, last: this.last };
  }
}

/** The current set of a branch: its numbered reports and edits, folded in branch order. */
export function currentSet(branch: readonly SessionEntry[]): CurrentSet {
  const builder = new Builder();
  let saved = 0;
  branch.forEach((entry, position) => {
    if (entry.type !== 'custom') return;
    if (entry.customType === REPORT_TYPE) {
      saved++;
      const [value] = checkpoints([entry]);
      // Reports saved before numbering name no entries; an invalid reply states nothing.
      if (value.assigned === null || value.report === null) return;
      builder.report(value.report, value.assigned, { entryId: entry.id, timestamp: entry.timestamp, via: 'checkpoint', position, checkpoint: saved });
      return;
    }
    const edit = savedEdit(entry);
    if (edit === null) return;
    try { builder.edit(edit, { entryId: entry.id, timestamp: entry.timestamp, via: 'tool', position }); }
    catch (error) { throw new Error(`Invalid saved Cuckoo edit at entry ${entry.id}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  return builder.set();
}

/** The set of a branch without numbered reports or edits. */
export const EMPTY_SET: CurrentSet = currentSet([]);

/** What `edit` would do to `set`, without saving anything; throws the reason when it does not fit. */
export function previewEdit(set: CurrentSet, edit: unknown): EditOutcome {
  // The placeholder is never returned: an outcome carries no provenance.
  return Builder.from(set).edit(decodeEdit(edit), { entryId: '', timestamp: '', via: 'tool', position: -1 });
}

/** Closed entries shown with the current set, newest first; older ones are counted. */
export const MAX_CLOSED_SHOWN = 20;
/** The completed and retired entries, most recently closed first: the ones to show, and how many older ones there are. */
export function closedEntries(set: CurrentSet): { readonly shown: readonly (CurrentObjective | CurrentRule)[]; readonly older: number } {
  const closed = [...set.objectives.filter(item => item.status !== 'active'), ...set.rules.filter(item => item.status !== 'active')]
    .sort((left, right) => right.stated.position - left.stated.position);
  return { shown: closed.slice(0, MAX_CLOSED_SHOWN), older: Math.max(0, closed.length - MAX_CLOSED_SHOWN) };
}

/** Every ID the record of this branch ever held: what a checkpoint reply may refer to. */
export function knownIds(set: CurrentSet): KnownIds {
  return { objectives: new Set(set.objectives.map(item => item.id)), rules: new Set(set.rules.map(item => item.id)) };
}

/** The next free number of each kind: numbering is per session, so every branch counts. */
export function nextNumbers(entries: readonly SessionEntry[]): NextNumbers {
  const highest: Record<EntryKind, number> = { objective: 0, rule: 0 };
  const seen = (id: string): void => {
    const parsed = parseEntryId(id);
    if (parsed === null) throw new Error('Invalid saved Cuckoo entry id');
    highest[parsed.kind] = Math.max(highest[parsed.kind], parsed.number);
  };
  for (const entry of entries) {
    if (entry.type !== 'custom') continue;
    if (entry.customType === REPORT_TYPE) {
      const assigned = savedNumbering(entry);
      if (assigned !== null) for (const id of [...assigned.objectives, ...assigned.rules]) seen(id);
    } else {
      const edit = savedEdit(entry);
      if (edit !== null && (edit.action === 'add_objective' || edit.action === 'add_rule')) seen(edit.id);
    }
  }
  return { objective: highest.objective + 1, rule: highest.rule + 1 };
}

/**
 * Titles that reports saved before numbering reported as complete and that no entry of the record carries. An entry
 * with such a title continues that objective under an ID, and the record then says whether it is complete.
 */
export function unnumberedCompleted(reports: readonly Checkpoint[], set: CurrentSet): string[] {
  const numbered = new Set(set.objectives.map(item => item.objective.slice(0, MAX_COMPLETED_TITLE_CHARS)));
  return completedObjectives(reports).filter(title => !numbered.has(title));
}

export interface InquiryRecord {
  readonly objectives: readonly { readonly id: string; readonly objective: string }[];
  readonly completed: readonly { readonly id: string; readonly objective: string }[];
  readonly rules: readonly { readonly id: string; readonly rule: string; readonly source: RuleSource; readonly scope: string }[];
}
/**
 * The record as a checkpoint request states it: what the model has to restate, and which completions it must not
 * report again (the most recently stated ones, oldest first, bounded like the list for reports saved before numbering).
 */
export function inquiryRecord(set: CurrentSet): InquiryRecord {
  const completed = set.objectives.filter(item => item.status === 'complete').sort((left, right) => left.stated.position - right.stated.position).slice(-MAX_COMPLETED_TITLES);
  return {
    objectives: set.objectives.filter(item => item.status === 'active').map(item => ({ id: item.id, objective: item.objective })),
    completed: completed.map(item => ({ id: item.id, objective: item.objective.slice(0, MAX_COMPLETED_TITLE_CHARS) })),
    rules: set.rules.filter(item => item.status === 'active').map(item => ({ id: item.id, rule: item.rule, source: item.source, scope: item.scope })),
  };
}
