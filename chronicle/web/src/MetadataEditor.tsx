import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { addMetadataFilter } from './expression.ts';
import type { QuickFilterField } from './ExpressionEditor.tsx';
import './expression.css';

const MAX_EXPRESSION_CHARACTERS = 4096;
interface Props { name: string; value: string; change(value: string): void; submit(value: string): void; fields: readonly QuickFilterField[]; disabled: boolean; shortcut: boolean; help: ReactNode }
export function MetadataEditor({ name, value, change, submit, fields, disabled, shortcut, help }: Props) {
  const input = useRef<HTMLInputElement>(null), menu = useRef<HTMLDetailsElement>(null), id = useId();
  const [field, setField] = useState(fields[0]!.attribute), [literal, setLiteral] = useState(''), [error, setError] = useState<string | null>(null);
  const selected = fields.find(item => item.attribute === field);
  if (selected === undefined) throw new Error('Metadata filter field is not available.');
  useEffect(() => {
    if (!shortcut) return;
    const focus = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (input.current !== null) input.current.focus(); } };
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus);
  }, [shortcut]);
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { const next = addMetadataFilter(value, field, literal); setError(null); change(next); submit(next); if (menu.current !== null) menu.current.open = false; if (input.current !== null) input.current.focus(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply metadata filter'); }
  }
  return <section className="expression-editor metadata-editor" aria-label={`${name} metadata search`}>
    <form role="search" aria-label={`${name} metadata search`} className="search-form search-line" onSubmit={event => { event.preventDefault(); setError(null); submit(value); }}>
      <label className="sr-only" htmlFor={`${id}-expression`}>Search {name.toLowerCase()} metadata</label>
      <input id={`${id}-expression`} ref={input} maxLength={MAX_EXPRESSION_CHARACTERS} autoComplete="off" spellCheck={false} value={value} onChange={event => { change(event.target.value); setError(null); }} placeholder="Metadata expression · AND / OR / NOT"/>
      <button className="primary" disabled={disabled}>Filter</button>
    </form>
    <div className="expression-tools"><details ref={menu} className="quick-filters"><summary>Quick filter</summary><form className="quick-filter-menu" onSubmit={apply}>
      <label>Field<select value={field} onChange={event => { setField(event.target.value); setLiteral(''); }}>{fields.map(item => <option key={item.attribute} value={item.attribute}>{item.label}</option>)}</select></label>
      <label>Value<input list={`${id}-values`} value={literal} onChange={event => setLiteral(event.target.value)} placeholder="Literal metadata value"/></label>
      <datalist id={`${id}-values`}>{selected.values.map(item => <option key={item} value={item}/>)}</datalist>
      <p className="tiny">Suggestions use loaded metadata or known states, not global facet counts. This filter is ANDed with the entire expression.</p><button className="primary" disabled={disabled || literal.length === 0}>Apply filter</button>
    </form></details><details className="expression-help"><summary>Metadata fields</summary><div className="expression-help-content">{help}<p>Boolean AND / OR / NOT, quotes and parentheses are supported. Search modes and conversation text are not supported.</p></div></details><span className="tiny">Metadata only{shortcut && ' · ⌘/Ctrl K'}</span></div>
    {error !== null && <div className="notice error" role="alert">{error}</div>}
  </section>;
}
