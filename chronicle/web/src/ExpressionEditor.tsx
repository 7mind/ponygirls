import { Popover } from './Popover.tsx';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { FilterShortcuts, type FilterField } from './FilterShortcuts.tsx';
import './expression.css';
import { ExpressionInput, type CompletionContext } from './ExpressionInput.tsx';

export const archiveFields: readonly FilterField[] = [
  { attribute: 'project', label: 'Project' }, { attribute: 'branch', label: 'Branch' }, { attribute: 'tag', label: 'Tag' }, { attribute: 'user', label: 'User' },
  { attribute: 'producer', label: 'Producer' }, { attribute: 'format', label: 'Format' }, { attribute: 'model', label: 'Model' }, { attribute: 'agent', label: 'Agent' }, { attribute: 'yolo-profile', label: 'Recorded yolo profile' }, { attribute: 'status', label: 'Status' },
  { attribute: 'after', label: 'After' }, { attribute: 'before', label: 'Before' },
];

export function ExpressionEditor({ value, applied, change, submit, disabled, fields, help, completion, compositionChange, composing, submission }: { composing: boolean; compositionChange: (composing: boolean) => void; completion: CompletionContext; value: string; applied: string; change: (value: string) => void; submit: (value: string) => void; disabled: boolean; fields: readonly FilterField[]; help: ReactNode; submission: 'live' | 'explicit' }) {
  const input = useRef<HTMLInputElement>(null), valuesId = useId();
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.defaultPrevented && document.querySelector('dialog[open]') === null) { event.preventDefault(); if (input.current !== null) { input.current.focus(); input.current.select(); } }
    };
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus);
  }, []);
  return <section className="expression-editor" aria-label={submission === 'live' ? 'Archive search' : 'Conversation search'}><form className="search-form" onSubmit={event => { event.preventDefault(); if (!composing) submit(value); }}><div className="search-line"><span aria-hidden="true" className="search-symbol">⌕</span><ExpressionInput context={completion} inputRef={input} id={`${valuesId}-expression`} label="Search conversations" placeholder='Search conversations · project:"chronicle" AND NOT tag:"archived"' value={value} change={change} clear={() => { change(''); if (submission === 'live') submit(''); }} canClear={value.length > 0 || applied.length > 0} maxLength={4096} compositionChange={compositionChange}/><kbd>⌘ / Ctrl K</kbd><button className="primary" disabled={disabled || composing}>Search</button></div></form>
    <div className="expression-tools"><FilterShortcuts expression={value} change={change} input={input} fields={fields} metadata={false} presets={[{ attribute: 'user', label: 'Mine', value: completion.owner }, { attribute: 'status', label: 'Failed', value: 'failed' }, { attribute: 'status', label: 'Unscheduled', value: 'unscheduled' }, { attribute: 'agent', label: 'Main agents', value: 'main' }, { attribute: 'agent', label: 'Subagents', value: 'subagent' }]}/>
      <Popover className="expression-help" label="Search syntax" panelClassName="expression-help-content"><p>Combine terms with <code>AND</code>, <code>OR</code>, <code>NOT</code> and <code>(…)</code> or <code>{'{…}'}</code>. Quote values containing spaces.</p><p><code>project:"chronicle" AND (tag:"architecture" OR tag:"migration")</code></p><p>Modes: <code>mode:lexical</code>, <code>mode:semantic</code>, <code>mode:hybrid</code> (default). Place the mode outside groups: <code>(A OR B) mode:lexical</code>. Unavailable modes return an error, not a fallback.</p><p>Lexical matches source and metadata substrings. Semantic uses bounded published-chunk candidates; Hybrid also includes exact lexical HEAD matches. <code>NOT text</code> excludes retrieved candidates, not all related content. Boolean rewrites can change semantic results. Semantic and Hybrid searches use query embeddings; suggestions do not.</p><p><code>producer:</code>, <code>format:</code> and <code>model:</code> match recorded source metadata. <code>agent:main</code> has no recorded subagent ID; <code>agent:subagent</code> has one. <code>yolo-profile:</code> is a case-sensitive recorded source-root claim, not launch attestation.</p>{help}</Popover>
    </div></section>;
}
