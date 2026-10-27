import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { FilterShortcuts, type FilterField } from './FilterShortcuts.tsx';
import './expression.css';
import { ExpressionInput, type CompletionContext } from './ExpressionInput.tsx';

export function ExpressionEditor({ value, applied, change, submit, disabled, fields, help, completion }: { completion: CompletionContext; value: string; applied: string; change: (value: string) => void; submit: (value: string) => void; disabled: boolean; fields: readonly FilterField[]; help: ReactNode }) {
  const input = useRef<HTMLInputElement>(null), valuesId = useId();
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (input.current !== null) { input.current.focus(); input.current.select(); } }
    };
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus);
  }, []);
  return <section className="expression-editor" aria-label="Archive search"><form className="search-form" onSubmit={event => { event.preventDefault(); submit(value); }}><div className="search-line"><span aria-hidden="true" className="search-symbol">⌕</span><ExpressionInput context={completion} inputRef={input} id={`${valuesId}-expression`} label="Search conversations" placeholder='Search conversations · project:"chronicle" AND NOT tag:"archived"' value={value} change={change} clear={() => { change(''); submit(''); }} canClear={value.length > 0 || applied.length > 0} maxLength={4096}/><kbd>⌘ / Ctrl K</kbd><button className="primary" disabled={disabled}>Search</button></div></form>
    <div className="expression-tools"><FilterShortcuts expression={value} change={change} input={input} fields={fields} metadata={false} presets={[{ attribute: 'user', label: 'Mine', value: completion.owner }, { attribute: 'status', label: 'Failed', value: 'failed' }, { attribute: 'status', label: 'Unscheduled', value: 'unscheduled' }]}/>
      <details className="expression-help"><summary>Search syntax</summary><div className="expression-help-content"><p>Combine terms with <code>AND</code>, <code>OR</code>, <code>NOT</code> and groups <code>(…)</code> or <code>{'{…}'}</code>. Quote values containing spaces.</p><p><code>project:"chronicle" AND (tag:"architecture" OR tag:"migration")</code></p><p>Set search mode in the expression: <code>mode:lexical</code>, <code>mode:semantic</code> or <code>mode:hybrid</code>. Keep the mode outside groups at the outer AND level: <code>(A OR B) mode:lexical</code>. The server validates the full expression; unavailable search modes return an error, not a fallback.</p><p>Lexical search is case-insensitive literal substring matching in authorized normalized source and metadata, not raw files. Semantic text operands use bounded published-chunk candidate sets. Hybrid includes every exact lexical HEAD match. <code>NOT text</code> means outside the retrieved semantic set, not proof of unrelatedness. Metadata-only outer AND subtrees restrict candidate discovery; arbitrary Boolean rewrites can change approximate membership.</p>{help}</div></details>
    </div></section>;
}
