import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { addExpressionFilter } from './expression.ts';
import './expression.css';
import { ExpressionInput, type CompletionContext } from './ExpressionInput.tsx';

export interface QuickFilterField { attribute: string; label: string; values: readonly string[] }
export function ExpressionEditor({ value, change, submit, disabled, fields, help, completion }: { completion: CompletionContext; value: string; change: (value: string) => void; submit: (value: string) => void; disabled: boolean; fields: readonly QuickFilterField[]; help: ReactNode }) {
  const input = useRef<HTMLInputElement>(null), filters = useRef<HTMLDetailsElement>(null), valuesId = useId();
  const [attribute, setAttribute] = useState(''), [filterValue, setFilterValue] = useState(''), [error, setError] = useState<string | null>(null);
  const field = fields.find(item => item.attribute === attribute) ?? fields[0];
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (input.current !== null) { input.current.focus(); input.current.select(); } }
    };
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus);
  }, []);
  return <section className="expression-editor" aria-label="Archive search"><form className="search-form" onSubmit={event => { event.preventDefault(); submit(value); }}><div className="search-line"><span aria-hidden="true" className="search-symbol">⌕</span><ExpressionInput context={completion} inputRef={input} id={`${valuesId}-expression`} label="Search conversations" placeholder='Search conversations · project:"chronicle" AND NOT tag:"archived"' value={value} change={change} maxLength={4096}/><kbd>⌘ / Ctrl K</kbd><button className="primary" disabled={disabled}>Search</button></div></form>
    <div className="expression-tools"><details className="quick-filters" ref={filters}><summary>Quick filter</summary><form className="quick-filter-menu" onSubmit={event => {
      event.preventDefault(); if (field === undefined) return;
      try {
        const next = addExpressionFilter(value, field.attribute, filterValue);
        setError(null); change(next); submit(next); setFilterValue(''); if (filters.current !== null) filters.current.open = false;
        if (input.current !== null) input.current.focus({ preventScroll: true });
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply the quick filter.'); }
    }}><label>Attribute<select aria-label="Attribute" value={field === undefined ? '' : field.attribute} onChange={event => { setAttribute(event.target.value); setFilterValue(''); setError(null); }}>{fields.map(item => <option key={item.attribute} value={item.attribute}>{item.label}</option>)}</select></label><label>Value<input list={valuesId} value={filterValue} onChange={event => setFilterValue(event.target.value)} required maxLength={1000}/></label><datalist id={valuesId}>{field === undefined ? null : field.values.map(item => <option key={item} value={item}/>)}</datalist><p className="tiny">Loaded values are suggestions from the rows currently shown, not all matching values. Enter another value to filter the whole archive.</p><button disabled={disabled || field === undefined || filterValue.trim().length === 0}>Apply filter</button>{error !== null && <p className="quick-filter-error" role="alert">{error}</p>}</form></details>
      <details className="expression-help"><summary>Search syntax</summary><div className="expression-help-content"><p>Combine terms with <code>AND</code>, <code>OR</code>, <code>NOT</code> and groups <code>(…)</code> or <code>{'{…}'}</code>. Quote values containing spaces.</p><p><code>project:"chronicle" AND (tag:"architecture" OR tag:"migration")</code></p><p>Set search mode in the expression: <code>mode:lexical</code>, <code>mode:semantic</code> or <code>mode:hybrid</code>. Keep the mode outside groups at the outer AND level: <code>(A OR B) mode:lexical</code>. The server validates the full expression; unavailable search modes return an error, not a fallback.</p><p>Lexical search is case-insensitive literal substring matching in authorized normalized source and metadata, not raw files. Semantic text operands use bounded published-chunk candidate sets. Hybrid includes every exact lexical HEAD match. <code>NOT text</code> means outside the retrieved semantic set, not proof of unrelatedness. Metadata-only outer AND subtrees restrict candidate discovery; arbitrary Boolean rewrites can change approximate membership.</p>{help}</div></details>
    </div></section>;
}
