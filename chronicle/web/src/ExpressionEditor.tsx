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
    <p className="tiny">{submission === 'live' ? 'Search updates after you pause · Enter searches now.' : 'Edits clear results · Enter or Search submits the expression.'} Semantic and hybrid text searches use query embeddings; suggestions do not.</p>
    <div className="expression-tools"><FilterShortcuts expression={value} change={change} input={input} fields={fields} metadata={false} presets={[{ attribute: 'user', label: 'Mine', value: completion.owner }, { attribute: 'status', label: 'Failed', value: 'failed' }, { attribute: 'status', label: 'Unscheduled', value: 'unscheduled' }, { attribute: 'agent', label: 'Main agents', value: 'main' }, { attribute: 'agent', label: 'Subagents', value: 'subagent' }]}/>
      <Popover className="expression-help" label="Search syntax" panelClassName="expression-help-content"><p>Combine terms with <code>AND</code>, <code>OR</code>, <code>NOT</code> and groups <code>(…)</code> or <code>{'{…}'}</code>. Quote values containing spaces.</p><p><code>project:"chronicle" AND (tag:"architecture" OR tag:"migration")</code></p><p>Set search mode in the expression: <code>mode:lexical</code>, <code>mode:semantic</code> or <code>mode:hybrid</code>. Keep the mode outside groups at the outer AND level: <code>(A OR B) mode:lexical</code>. The server validates the full expression; unavailable search modes return an error, not a fallback.</p><p>Lexical search is case-insensitive literal substring matching in authorized normalized source and metadata, not raw files. Semantic text operands use bounded published-chunk candidate sets. Hybrid includes every exact lexical HEAD match. <code>NOT text</code> means outside the retrieved semantic set, not proof of unrelatedness. Metadata-only outer AND subtrees restrict candidate discovery; arbitrary Boolean rewrites can change approximate membership.</p><p><code>producer:</code> identifies the recorded harness; <code>format:</code> the source format; <code>model:</code> the recorded source model, not the annotator model. <code>agent:main</code> means no recorded subagent ID; <code>agent:subagent</code> means one is present. This uses recorded source identity, not titles, tags, parent links, cryptographic lineage or a legacy backfill.</p><p><code>yolo-profile:</code> matches the case-sensitive named profile recorded in the source root ID. Native/default and unrecognized roots have no recorded yolo profile. This is a recorded claim, not host or launch attestation; tags and transcript text are not profile signals.</p>{help}</Popover>
    </div></section>;
}
