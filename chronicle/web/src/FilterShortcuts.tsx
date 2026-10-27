import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { addExpressionField, addExpressionFilter, addMetadataField, addMetadataFilter } from './expression.ts';
export interface FilterField { attribute: string; label: string }
export interface FilterShortcut extends FilterField { value: string }
interface Props { expression: string; change(value: string): void; input: RefObject<HTMLInputElement | null>; fields: readonly FilterField[]; presets: readonly FilterShortcut[]; metadata: boolean }
const MAX_EXPRESSION_CHARACTERS = 4096;
export function FilterShortcuts({ expression, change, input, fields, presets, metadata }: Props) {
  const pending = useRef(false), [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => { setError(null); if (pending.current && input.current !== null) { pending.current = false; input.current.focus({ preventScroll: true }); input.current.setSelectionRange(expression.length, expression.length); } }, [expression, input]);
  function insert(field: FilterField, literal: string | null) {
    try {
      const next = literal === null ? (metadata ? addMetadataField : addExpressionField)(expression, field.attribute) : (metadata ? addMetadataFilter : addExpressionFilter)(expression, field.attribute, literal);
      if (next.length > MAX_EXPRESSION_CHARACTERS) throw new Error('The shortcut would exceed the search expression limit.');
      setError(null); pending.current = true; change(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not insert this filter.'); }
  }
  return <div className="filter-shortcuts"><div role="group" aria-label="Filter shortcuts"><span className="tiny">Filters</span>{presets.map(field => <button type="button" key={field.label} onClick={() => insert(field, field.value)}>{field.label}</button>)}{fields.map(field => <button type="button" key={field.attribute} aria-label={`Add ${field.label} filter`} onClick={() => insert(field, null)}>{field.label}<span aria-hidden="true">:</span></button>)}</div>{error !== null && <p className="tiny quick-filter-error" role="alert">{error}</p>}</div>;
}
