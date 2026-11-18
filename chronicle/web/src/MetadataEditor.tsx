import { Popover } from './Popover.tsx';
import { useId } from 'react';
import type { ReactNode, RefObject } from 'react';
import './expression.css';
import { ExpressionInput, type CompletionContext } from './ExpressionInput.tsx';
import { Icon } from './Icon.tsx';

const MAX_EXPRESSION_CHARACTERS = 4096;
interface Props { completion: CompletionContext; inputRef: RefObject<HTMLInputElement | null>; name: string; placeholder: string; value: string; applied: string; change(value: string): void; submit(value: string): void; disabled: boolean }
/** The metadata query bar of an Activity view bar (spec §2.2): expression input with completion and clear, then Filter. Ctrl/⌘ K is the shell's (App). */
export function MetadataQueryBar({ name, placeholder, value, applied, change, submit, disabled, completion, inputRef }: Props) {
  const id = useId(), label = `Search ${name.toLowerCase()} metadata`;
  return <form role="search" aria-label={`${name} metadata search`} className="querybar" onSubmit={event => { event.preventDefault(); submit(value); }}>
    <Icon name="search" small={false}/>
    <ExpressionInput context={completion} id={`${id}-expression`} inputRef={inputRef} maxLength={MAX_EXPRESSION_CHARACTERS} value={value} change={change} clear={() => { change(''); submit(''); }} canClear={value.length > 0 || applied.length > 0} label={label} placeholder={placeholder}/>
    <button className="btn btn-primary" disabled={disabled}>Filter</button>
  </form>;
}
/** Field reference of a metadata expression, at the right end of the shortcut row. */
export function MetadataHelp({ children }: { children: ReactNode }) {
  return <Popover className="expression-help" label="Metadata fields" panelClassName="expression-help-content">{children}<p>Boolean AND / OR / NOT, quotes and parentheses are supported. Search modes and conversation text are not supported.</p></Popover>;
}
