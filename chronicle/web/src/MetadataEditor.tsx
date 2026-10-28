import { Popover } from './Popover.tsx';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { FilterShortcuts, type FilterField, type FilterShortcut } from './FilterShortcuts.tsx';
import './expression.css';
import { ExpressionInput, type CompletionContext } from './ExpressionInput.tsx';

const MAX_EXPRESSION_CHARACTERS = 4096;
interface Props { completion: CompletionContext; name: string; value: string; applied: string; change(value: string): void; submit(value: string): void; fields: readonly FilterField[]; presets: readonly FilterShortcut[]; disabled: boolean; shortcut: boolean; help: ReactNode }
export function MetadataEditor({ name, value, applied, change, submit, fields, presets, disabled, shortcut, help, completion }: Props) {
  const input = useRef<HTMLInputElement>(null), id = useId();
  useEffect(() => {
    if (!shortcut) return;
    const focus = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (input.current !== null) input.current.focus(); } };
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus);
  }, [shortcut]);
  return <section className="expression-editor metadata-editor" aria-label={`${name} metadata search`}>
    <form role="search" aria-label={`${name} metadata search`} className="search-form search-line" onSubmit={event => { event.preventDefault(); submit(value); }}>
      <label className="sr-only" htmlFor={`${id}-expression`}>Search {name.toLowerCase()} metadata</label>
      <ExpressionInput context={completion} id={`${id}-expression`} inputRef={input} maxLength={MAX_EXPRESSION_CHARACTERS} value={value} change={change} clear={() => { change(''); submit(''); }} canClear={value.length > 0 || applied.length > 0} label={`Search ${name.toLowerCase()} metadata`} placeholder="Metadata expression · AND / OR / NOT"/>
      <button className="primary" disabled={disabled}>Filter</button>
    </form>
    <div className="expression-tools"><FilterShortcuts expression={value} change={change} input={input} fields={fields} presets={presets} metadata={true}/><Popover className="expression-help" label="Metadata fields" panelClassName="expression-help-content">{help}<p>Boolean AND / OR / NOT, quotes and parentheses are supported. Search modes and conversation text are not supported.</p></Popover><span className="tiny">Metadata only{shortcut && ' · ⌘/Ctrl K'}</span></div>
  </section>;
}
