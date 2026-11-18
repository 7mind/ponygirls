import { Anchored, Popover } from './Popover.tsx';
import { Icon } from './Icon.tsx';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { clampColumn, fitTableColumns, type SizedColumn, type TableColumnSpec } from './table-widths.ts';
import './table-columns.css';
interface ColumnState extends SizedColumn { visible: boolean }
export interface TableLayout { columns: readonly SizedColumn[]; specs: readonly TableColumnSpec[]; visibilityKey: string; width: number; canPinEnds: boolean; container: RefObject<HTMLDivElement | null>; table: RefObject<HTMLTableElement | null>; resize(id: string, width: number): void; toggle(id: string, visible: boolean): void; fitContent(): void; fitWidth(): void; showAll(): void; compact(): void }
const RESIZE_STEP = 16, MIN_UNPINNED_WIDTH = 120;
// Canvas metrics ignore font-variant-numeric (e.g. tabular-nums), so such text is measured as rendered.
function renderedWidth(text: string, style: CSSStyleDeclaration, document: Document): number {
  const probe = document.createElement('span');
  for (const property of ['font-style', 'font-weight', 'font-stretch', 'font-size', 'font-family', 'font-variant-numeric', 'letter-spacing'] as const) probe.style.setProperty(property, style.getPropertyValue(property));
  probe.style.setProperty('position', 'absolute'); probe.style.setProperty('visibility', 'hidden'); probe.style.setProperty('white-space', 'pre'); probe.textContent = text;
  document.body.append(probe); try { return probe.getBoundingClientRect().width; } finally { probe.remove(); }
}
function contentWidth(node: Node, context: CanvasRenderingContext2D): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement; if (parent === null) throw new Error('Table text has no element.');
    const style = getComputedStyle(parent);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    let text = node.textContent!.replace(/\r\n?/g, '\n');
    if (style.whiteSpace === 'normal' || style.whiteSpace === 'nowrap') text = text.replace(/[ \t\n\f]+/g, ' ');
    else if (style.whiteSpace === 'pre-line') text = text.replace(/[ \t\f]+/g, ' ');
    let width = 0; for (const line of text.split('\n')) width = Math.max(width, style.fontVariantNumeric === 'normal' ? context.measureText(line).width : renderedWidth(line, style, parent.ownerDocument)); return width;
  }
  if (!(node instanceof HTMLElement)) return node instanceof Element ? node.getBoundingClientRect().width : 0;
  const style = getComputedStyle(node);
  if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') return 0;
  let line = 0, width = 0;
  for (const child of node.childNodes) {
    if (node instanceof HTMLDetailsElement && !node.open && child !== node.querySelector(':scope > summary')) continue;
    const childWidth = contentWidth(child, context), display = child instanceof Element ? getComputedStyle(child).display : 'inline';
    if (display.startsWith('inline') || display === 'contents' || style.display.includes('flex')) line += childWidth;
    else { width = Math.max(width, line, childWidth); line = 0; }
  }
  return Math.max(width, line) + [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth, style.marginLeft, style.marginRight].reduce((sum, value) => sum + Number.parseFloat(value), 0);
}
/** The visible column IDs remembered per browser (spec §5 rule 8); null when nothing usable is stored. */
export interface ColumnChoiceStore { read(): readonly string[] | null; write(ids: readonly string[]): void }
// A stored value that is not a list of strings (another version, a manual edit) is treated as absent and replaced at the next choice.
export function browserColumnChoices(storage: Storage, key: string): ColumnChoiceStore {
  return {
    read() {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { return null; }
      return Array.isArray(value) && value.every(item => typeof item === 'string') ? value as string[] : null;
    },
    write(ids) { storage.setItem(key, JSON.stringify(ids)); },
  };
}
export function useTableColumns(specs: readonly TableColumnSpec[], rowCount: number, enabled: boolean): TableLayout { return useStoredTableColumns(null, specs, rowCount, enabled); }
/** As `useTableColumns`; the chosen columns are read from and written to `choices`. */
export function useStoredTableColumns(choices: ColumnChoiceStore | null, specs: readonly TableColumnSpec[], rowCount: number, enabled: boolean): TableLayout {
  const container = useRef<HTMLDivElement>(null), table = useRef<HTMLTableElement>(null), automatic = useRef(true), measured = useRef(false);
  const [available, setAvailable] = useState(0), [state, setState] = useState<ColumnState[]>(() => {
    if (new Set(specs.map(spec => spec.id)).size !== specs.length || !specs.some(spec => spec.required)) throw new Error('Table requires unique column IDs and a required column.');
    const stored = choices === null ? null : choices.read();
    return specs.map(spec => ({ spec, width: clampColumn(spec, spec.ideal), visible: spec.required || (stored === null ? spec.compact : stored.includes(spec.id)) }));
  });
  function viewport() { return container.current === null ? available : container.current.clientWidth; }
  function fit(previous: readonly ColumnState[], width: number): ColumnState[] {
    const fitted = fitTableColumns(previous.filter(column => column.visible), width);
    return previous.map(column => { const match = fitted.find(item => item.spec.id === column.spec.id); return match === undefined ? column : { ...column, width: match.width }; });
  }
  function natural(previous: readonly ColumnState[]): ColumnState[] {
    const element = table.current; if (element === null) throw new Error('Cannot fit unmounted table.');
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d'); if (context === null) throw new Error('Table content measurement is unavailable.');
    return previous.map(column => {
      if (!column.visible) return column;
      let width = column.spec.min;
      for (const cell of element.querySelectorAll<HTMLElement>('[data-column-id]')) if (cell.dataset.columnId === column.spec.id) {
        width = Math.max(width, contentWidth(cell, context));
      }
      return { ...column, width: clampColumn(column.spec, width) };
    });
  }
  useLayoutEffect(() => {
    if (!enabled) return;
    const element = container.current; if (element === null) throw new Error('Table viewport is missing.');
    const observer = new ResizeObserver(() => setAvailable(element.clientWidth)); observer.observe(element); setAvailable(element.clientWidth); return () => observer.disconnect();
  }, [enabled]);
  useLayoutEffect(() => { if (enabled && automatic.current && available > 0) setState(previous => fit(previous, available)); }, [available, enabled]);
  useLayoutEffect(() => { if (enabled && !measured.current && rowCount > 0 && available > 0) { measured.current = true; if (automatic.current) setState(fit(natural(state), available)); } }, [rowCount, available, enabled]);
  function updateVisibility(test: (column: ColumnState) => boolean) {
    automatic.current = true; const width = viewport(), next = state.map(column => ({ ...column, visible: column.spec.required || test(column) }));
    if (choices !== null) choices.write(next.filter(column => column.visible).map(column => column.spec.id));
    setState(fit(next, width));
  }
  const columns = useMemo(() => state.filter(column => column.visible), [state]);
  return { columns, specs, visibilityKey: JSON.stringify(columns.map(column => column.spec.id)), width: columns.reduce((sum, column) => sum + column.width, 0), canPinEnds: columns[0]!.width + columns[columns.length - 1]!.width + MIN_UNPINNED_WIDTH <= available, container, table,
    resize(id, width) { automatic.current = false; setState(previous => { if (!previous.some(column => column.spec.id === id)) throw new Error('Unknown table column.'); return previous.map(column => column.spec.id === id ? { ...column, width: clampColumn(column.spec, width) } : column); }); },
    toggle(id, visible) { if (!specs.some(spec => spec.id === id)) throw new Error('Unknown table column.'); updateVisibility(column => column.spec.id === id ? visible : column.visible); },
    fitContent() { automatic.current = false; setState(natural(state)); },
    fitWidth() { automatic.current = true; const width = viewport(); setState(previous => fit(previous, width)); },
    showAll() { updateVisibility(() => true); }, compact() { updateVisibility(column => column.spec.compact); },
  };
}
// Column widths are dynamic geometry: set through the CSSOM, never as style attributes (shared/ui-web rules).
export function TableColumnGroup({ layout }: { layout: TableLayout }) { return <colgroup>{layout.columns.map(column => <col key={column.spec.id} ref={element => { if (element !== null) element.style.setProperty('width', `${column.width}px`); }}/>)}</colgroup>; }
export function ColumnResize({ column, layout }: { column: SizedColumn; layout: TableLayout }) {
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  return <button type="button" className="column-resizer" role="separator" aria-label={`Resize ${column.spec.label} column`} aria-orientation="vertical" aria-valuemin={column.spec.min} aria-valuemax={column.spec.max} aria-valuenow={Math.round(column.width)} title="Drag or use ← / → to resize" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); drag.current = { pointer: event.pointerId, x: event.clientX, width: column.width }; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus({ preventScroll: true }); }} onPointerMove={event => { const start = drag.current; if (start !== null && start.pointer === event.pointerId) layout.resize(column.spec.id, start.width + event.clientX - start.x); }} onPointerUp={event => { if (drag.current !== null && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onClick={event => event.stopPropagation()} onKeyDown={event => {
    const delta = event.shiftKey ? RESIZE_STEP * 4 : RESIZE_STEP;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') { event.preventDefault(); event.stopPropagation(); layout.resize(column.spec.id, event.key === 'Home' ? column.spec.min : event.key === 'End' ? column.spec.max : column.width + (event.key === 'ArrowRight' ? delta : -delta)); }
  }}/>;
}
export function TableControls({ name, layout }: { name: string; layout: TableLayout }) {
  return <div className="table-controls" role="region" aria-label={`${name} table controls`}>
    <Popover className="table-options" label={<span aria-hidden="true">⋮</span>} ariaLabel={`${name} table options`} panelClassName="table-options-panel">
      <div role="group" aria-label={`${name} table options`}>
        <button type="button" onClick={layout.fitWidth}>Fit to width</button>
        <button type="button" onClick={layout.fitContent}>Fit to content</button>
        <details className="table-column-options"><summary>Columns</summary>
          <button type="button" onClick={layout.showAll}>Show all columns</button>
          <button type="button" onClick={layout.compact}>Compact columns</button>
          {layout.specs.map(spec => <label key={spec.id}><input type="checkbox" checked={layout.columns.some(column => column.spec.id === spec.id)} disabled={spec.required} onChange={event => layout.toggle(spec.id, event.target.checked)}/>{spec.label}</label>)}
        </details>
      </div>
    </Popover>
  </div>;
}
/** The table-options menu of a view bar (spec §3.1 Archive): column choice and fit modes. Choosing a column keeps the menu open. */
export function ColumnMenu({ name, layout }: { name: string; layout: TableLayout }) {
  return <Anchored className="column-menu" buttonClassName="btn btn-ghost btn-icon" buttonState={undefined} label={<Icon name="columns" small={false}/>} ariaLabel={`${name} table options`} describedBy={undefined} panel="menu" panelClassName="menu column-menu-panel" panelLabel={`${name} table options`}>
    <div className="menu-label" aria-hidden="true">Columns</div>
    <div role="group" aria-label="Columns">{layout.specs.map(spec => {
      const shown = layout.columns.some(column => column.spec.id === spec.id);
      return <button type="button" role="menuitemcheckbox" className="menu-item" key={spec.id} aria-checked={shown} aria-disabled={spec.required ? true : undefined} title={spec.required ? 'Always shown' : undefined} onClick={event => { event.stopPropagation(); if (!spec.required) layout.toggle(spec.id, !shown); }}>{spec.label}</button>;
    })}</div>
    <div className="menu-sep" role="separator"/>
    <button type="button" role="menuitem" className="menu-item" onClick={layout.fitWidth}>Fit columns to width</button>
    <button type="button" role="menuitem" className="menu-item" onClick={layout.fitContent}>Fit columns to content</button>
    <button type="button" role="menuitem" className="menu-item" onClick={layout.showAll}>Show all columns</button>
    <button type="button" role="menuitem" className="menu-item" onClick={layout.compact}>Reset columns</button>
  </Anchored>;
}
