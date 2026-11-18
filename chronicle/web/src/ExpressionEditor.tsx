import { Popover } from './Popover.tsx';
import { useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { FilterBar, type FilterField } from './FilterShortcuts.tsx';
import './expression.css';
import { ExpressionInput, type CompletionContext } from './ExpressionInput.tsx';
import { Icon } from './Icon.tsx';

// Shortcut-row order (FilterBar folds from the sixth field on narrow viewports and keeps the last ones in "more…").
export const archiveFields: readonly FilterField[] = [
  { attribute: 'project', label: 'Project' }, { attribute: 'branch', label: 'Branch' }, { attribute: 'tag', label: 'Tag' }, { attribute: 'user', label: 'User' },
  { attribute: 'producer', label: 'Producer' }, { attribute: 'model', label: 'Model' }, { attribute: 'agent', label: 'Agent' }, { attribute: 'status', label: 'Status' },
  { attribute: 'after', label: 'After' }, { attribute: 'before', label: 'Before' }, { attribute: 'format', label: 'Format' }, { attribute: 'yolo-profile', label: 'Recorded yolo profile' },
];
const MAX_EXPRESSION_CHARACTERS = 4096;
const LEGACY_PLACEHOLDER = 'Search conversations · project:"chronicle" AND NOT tag:"archived"';
export interface QueryBarProps { composing: boolean; compositionChange: (composing: boolean) => void; completion: CompletionContext; value: string; applied: string; change: (value: string) => void; submit: (value: string) => void; disabled: boolean; submission: 'live' | 'explicit' }
/** The query bar of a view bar (spec §2.2): expression input with completion and clear, the Ctrl K hint and Search. Ctrl/⌘ K is the shell's (App). */
export function QueryBar({ value, applied, change, submit, disabled, completion, compositionChange, composing, submission, inputRef, label, placeholder }: QueryBarProps & { inputRef: RefObject<HTMLInputElement | null>; label: string; placeholder: string }) {
  const valuesId = useId();
  return <form className="querybar" role="search" aria-label={label} onSubmit={event => { event.preventDefault(); if (!composing) submit(value); }}>
    <Icon name="search" small={false}/>
    <ExpressionInput context={completion} inputRef={inputRef} id={`${valuesId}-expression`} label="Search conversations" placeholder={placeholder} value={value} change={change} clear={() => { change(''); if (submission === 'live') submit(''); }} canClear={value.length > 0 || applied.length > 0} maxLength={MAX_EXPRESSION_CHARACTERS} compositionChange={compositionChange}/>
    <span className="kbd hide-md" aria-hidden="true">Ctrl K</span>
    <button className="btn btn-primary" disabled={disabled || composing}>Search</button>
  </form>;
}
/** "Search syntax" help for conversation expressions; `extra` adds result-specific notes. */
export function SyntaxHelp({ extra }: { extra: ReactNode }) {
  return <Popover className="expression-help" label="Search syntax" panelClassName="expression-help-content"><p>Combine terms with <code>AND</code>, <code>OR</code>, <code>NOT</code> and <code>(…)</code> or <code>{'{…}'}</code>. Quote values containing spaces.</p><p><code>project:"chronicle" AND (tag:"architecture" OR tag:"migration")</code></p><p>Modes: <code>mode:lexical</code>, <code>mode:semantic</code>, <code>mode:hybrid</code> (default). Place the mode outside groups: <code>(A OR B) mode:lexical</code>. Unavailable modes return an error, not a fallback.</p><p>Lexical uses case-insensitive literal substring matching in source and metadata. Semantic uses bounded published-chunk candidates; Hybrid also includes exact lexical HEAD matches. <code>NOT text</code> means outside retrieved candidates, not proof of unrelatedness. Boolean rewrites can change semantic results. Semantic and Hybrid searches use query embeddings; suggestions do not.</p><p><code>producer:</code>, <code>format:</code> and <code>model:</code> match recorded source metadata. <code>agent:main</code> has no recorded subagent ID; <code>agent:subagent</code> has one. <code>yolo-profile:</code> is a case-sensitive recorded source-root claim, not launch attestation.</p>{extra}</Popover>;
}
export const conversationPresets = (owner: string) => [{ attribute: 'user', label: 'Mine', value: owner }, { attribute: 'status', label: 'Failed', value: 'failed' }, { attribute: 'status', label: 'Unscheduled', value: 'unscheduled' }, { attribute: 'agent', label: 'Main agents', value: 'main' }, { attribute: 'agent', label: 'Subagents', value: 'subagent' }];
/** Query bar and shortcut row as one block (Search); Archive composes the parts into its view bar. */
export function ExpressionEditor({ value, applied, change, submit, disabled, fields, help, completion, compositionChange, composing, submission }: QueryBarProps & { fields: readonly FilterField[]; help: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  return <section className="expression-editor" aria-label={submission === 'live' ? 'Archive search' : 'Conversation search'}>
    <QueryBar inputRef={input} label={submission === 'live' ? 'Archive search' : 'Conversation search'} placeholder={LEGACY_PLACEHOLDER} value={value} applied={applied} change={change} submit={submit} disabled={disabled} completion={completion} compositionChange={compositionChange} composing={composing} submission={submission}/>
    <FilterBar expression={value} change={change} input={input} fields={fields} metadata={false} presets={conversationPresets(completion.owner)} trailing={<div className="sortline"><SyntaxHelp extra={help}/></div>}/>
  </section>;
}
