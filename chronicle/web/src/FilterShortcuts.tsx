import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { addExpressionField, addExpressionFilter, addMetadataField, addMetadataFilter } from './expression.ts';
import { Anchored } from './Popover.tsx';
export interface FilterField { attribute: string; label: string }
export interface FilterShortcut extends FilterField { value: string }
interface Props { expression: string; change(value: string): void; input: RefObject<HTMLInputElement | null>; fields: readonly FilterField[]; presets: readonly FilterShortcut[]; metadata: boolean }
const MAX_EXPRESSION_CHARACTERS = 4096;
// Shortcut row (spec §2.2 Query bar): field inserters in their given order. The first ALWAYS_INLINE stay in the row at every
// width, the next ones up to WIDE_INLINE only on wide viewports (folded below the shared 1100 px breakpoint), the rest live in
// the "more…" menu, which also offers the folded ones on narrow viewports.
const ALWAYS_INLINE = 5, WIDE_INLINE = 10;
const fieldName = (field: FilterField) => `Add ${field.label} filter`;
/** Preset filters, a divider and field inserters as one shortcut row; `trailing` is the row's right end (order, help). */
export function FilterBar({ expression, change, input, fields, presets, metadata, trailing }: Props & { trailing: ReactNode }) {
  const pending = useRef(false), [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => { setError(null); if (pending.current && input.current !== null) { pending.current = false; input.current.focus({ preventScroll: true }); input.current.setSelectionRange(expression.length, expression.length); } }, [expression, input]);
  function insert(field: FilterField, literal: string | null) {
    try {
      const next = literal === null ? (metadata ? addMetadataField : addExpressionField)(expression, field.attribute) : (metadata ? addMetadataFilter : addExpressionFilter)(expression, field.attribute, literal);
      if (next.length > MAX_EXPRESSION_CHARACTERS) throw new Error('The shortcut would exceed the search expression limit.');
      setError(null); pending.current = true; change(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not insert this filter.'); }
  }
  const inline = fields.slice(0, WIDE_INLINE), more = fields.slice(ALWAYS_INLINE);
  return <div className="filterbar filter-shortcuts">
    <div className="filter-group" role="group" aria-label="Filter shortcuts">
      {presets.map(field => <button type="button" className="filter" key={field.label} onClick={() => insert(field, field.value)}>{field.label}</button>)}
      {presets.length > 0 && fields.length > 0 && <span className="filter-divider" aria-hidden="true"/>}
      {inline.map((field, index) => <button type="button" className={index < ALWAYS_INLINE ? 'filter filter-field' : 'filter filter-field filter-fold'} key={field.attribute} aria-label={fieldName(field)} title={field.label} onClick={() => insert(field, null)}>{field.attribute}:</button>)}
      {more.length > 0 && <Anchored className={fields.length > WIDE_INLINE ? 'filter-more' : 'filter-more filter-more-narrow'} buttonClassName="filter filter-field" buttonState={undefined} label="more…" ariaLabel="More filter fields" describedBy={undefined} panel="menu" panelClassName="menu filter-more-menu" panelLabel="Insert a field">
        {more.map((field, index) => <button type="button" role="menuitem" className={index + ALWAYS_INLINE < WIDE_INLINE ? 'menu-item filter-menu-item filter-menu-fold' : 'menu-item filter-menu-item'} key={field.attribute} aria-label={fieldName(field)} onClick={() => insert(field, null)}>{field.attribute}:<span>{field.label}</span></button>)}
      </Anchored>}
    </div>
    {trailing}
    {error !== null && <p className="filter-error" role="alert">{error}</p>}
  </div>;
}
/** The shortcut row without a right end (Activity's metadata editors). */
export function FilterShortcuts(props: Props) { return <FilterBar {...props} trailing={null}/>; }
