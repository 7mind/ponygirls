import { Fragment, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { SortDirection } from '../api.ts';
import type { InfiniteResource } from '../infinite.ts';
import { useInfiniteSentinel } from '../InfiniteTrigger.tsx';
import { ScrollAnchor } from '../ScrollAnchor.tsx';
import { browserColumnChoices, ColumnResize, TableColumnGroup, useStoredTableColumns, type TableLayout } from '../TableColumns.tsx';
import type { TableColumnSpec } from '../table-widths.ts';
import { Icon } from '../Icon.tsx';
import type { ListState } from './state.ts';

// One list per sub-view in the document scroller (spec §1 model A): sticky header under the view bar, rows that expand in
// place, infinite loading with an explicit end marker. Shared by Collectors and Jobs.
export interface ColumnWidth { readonly min: number; readonly ideal: number; readonly max: number }
export interface Column<Row, S extends string> {
  readonly sort: S; readonly label: string; readonly cell: 'col-num' | 'col-mono' | undefined; readonly width: ColumnWidth;
  /** Shown by default on wide viewports / on phones; `required` columns cannot be hidden. */
  readonly compact: boolean; readonly narrow: boolean; readonly required: boolean;
  title(row: Row): string | undefined; render(row: Row, now: number): ReactNode;
}
const ACTIONS_COLUMN = 'actions';
const ACTIONS_WIDTH: ColumnWidth = { min: 56, ideal: 64, max: 160 };
// Phone widths (the shared 720 px breakpoint) start with their own short column choice, fitted to the viewport (spec §8 item 9).
const NARROW_QUERY = '(max-width: 720px)';
const SKELETON_ROWS = 10;
function useNarrow(): boolean {
  const query = useMemo(() => window.matchMedia(NARROW_QUERY), []);
  return useSyncExternalStore(listener => { query.addEventListener('change', listener); return () => query.removeEventListener('change', listener); }, () => query.matches);
}
function specs<Row, S extends string>(columns: readonly Column<Row, S>[], actionsLabel: string, narrow: boolean): TableColumnSpec[] {
  return [...columns.map(column => ({ id: column.sort, label: column.label, ...column.width, grow: column.required, required: column.required, compact: narrow ? column.narrow : column.compact })),
    { id: ACTIONS_COLUMN, label: actionsLabel, ...ACTIONS_WIDTH, grow: false, required: true, compact: true }];
}
export interface ListTableLayout<Row, S extends string> { readonly layout: TableLayout; readonly shown: readonly Column<Row, S>[] }
/** Column layout of a list, with the visible columns remembered per browser (spec §5 rule 8), separately for phones. */
export function useListTable<Row, S extends string>(columns: readonly Column<Row, S>[], storageKey: string, actionsLabel: string, rowCount: number): ListTableLayout<Row, S> {
  const narrow = useNarrow();
  const choices = useMemo(() => browserColumnChoices(window.localStorage, storageKey), [storageKey]), narrowChoices = useMemo(() => browserColumnChoices(window.localStorage, `${storageKey}.narrow`), [storageKey]);
  const wideSpecs = useMemo(() => specs(columns, actionsLabel, false), [columns, actionsLabel]), narrowSpecs = useMemo(() => specs(columns, actionsLabel, true), [columns, actionsLabel]);
  const wide = useStoredTableColumns(choices, wideSpecs, rowCount, !narrow), phone = useStoredTableColumns(narrowChoices, narrowSpecs, rowCount, narrow);
  const layout = narrow ? phone : wide;
  return { layout, shown: columns.filter(column => layout.columns.some(item => item.spec.id === column.sort)) };
}

export interface ListTableProps<Row, S extends string> {
  name: string; list: string; twoLine: boolean; table: ListTableLayout<Row, S>; resource: InfiniteResource<Row, unknown>; rowId(row: Row): string; rowClass: string;
  rowState(row: Row): string | undefined; state: ListState<S>; sortBy(sort: S): void; toggle(id: string): void;
  detail(row: Row): ReactNode; actions(row: Row): ReactNode; empty: ReactNode; noun(count: bigint): string; total: bigint | null; pageSize: number;
}
export function ListTable<Row, S extends string>({ name, list, twoLine, table, resource, rowId, rowClass, rowState, state, sortBy, toggle, detail, actions, empty, noun, total, pageSize }: ListTableProps<Row, S>) {
  const { layout, shown } = table;
  useLayoutEffect(() => { const element = layout.table.current; if (element !== null) element.style.setProperty('width', `${layout.width}px`); });
  const failed = resource.error !== null && resource.appendError === null;
  const sentinel = useInfiniteSentinel<HTMLDivElement>(resource.hasMore && resource.error === null, resource.loadingMore || resource.refreshing, resource.loadMore);
  const colgroup = <TableColumnGroup layout={layout}/>, span = shown.length + 1, now = Date.now();
  const remaining = total === null ? 0 : Math.min(pageSize, Number(total) - resource.items.length);
  return <ScrollAnchor><div className="activity-table-frame" ref={layout.container} data-scroll-container="">
    <table className={twoLine ? 'table table-2line activity-table' : 'table activity-table'} ref={layout.table} aria-label={name} data-list={list} aria-busy={resource.loading || resource.refreshing || resource.loadingMore} hidden={failed}>{colgroup}
      <thead><tr>{shown.map(column => { const sorted = state.sort === column.sort; return <th key={column.sort} scope="col" className={column.cell === 'col-num' ? 'col-num' : undefined} data-column-id={column.sort} data-sort={column.sort} aria-sort={sorted ? state.direction === SortDirection.Asc ? 'ascending' : 'descending' : undefined}>
        <button type="button" className="th-sort" onClick={() => sortBy(column.sort)} aria-label={`Sort by ${column.label}`}>{column.label}</button><ColumnResize column={layout.columns.find(item => item.spec.id === column.sort)!} layout={layout}/>
      </th>; })}<th scope="col" className="col-actions" data-column-id={ACTIONS_COLUMN}><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{resource.items.map(row => {
        const id = rowId(row), open = state.expanded === id, detailId = `${list}-detail-${id}`;
        return <Fragment key={id}>
          <tr className={rowClass} data-row-id={id} data-scroll-anchor={id} data-state={rowState(row)} aria-selected={open ? true : undefined}>
            {shown.map(column => <td key={column.sort} className={column.cell} data-column-id={column.sort} title={column.title(row)}>{column.render(row, now)}</td>)}
            <td className="col-actions" data-column-id={ACTIONS_COLUMN}><span className="row-actions always">{actions(row)}
              <button type="button" className="btn btn-ghost btn-icon btn-sm row-toggle" aria-label="Details" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => toggle(id)}><Icon name="chevron-down" small={true}/></button></span></td>
          </tr>
          {open && <tr className="row-detail" id={detailId} data-detail-for={id}><td colSpan={span}>{detail(row)}</td></tr>}
        </Fragment>;
      })}</tbody>
    </table>
    {resource.loading && resource.items.length === 0 && <table className={twoLine ? 'table table-2line activity-skeleton' : 'table activity-skeleton'} aria-hidden="true">{colgroup}<tbody>{Array.from({ length: SKELETON_ROWS }, (_, index) => <tr key={index}>{shown.map(column => <td key={column.sort}><span className="skeleton sk-60"/></td>)}<td/></tr>)}</tbody></table>}
    {resource.meta !== null && resource.items.length === 0 && !resource.updateAvailable && !failed && empty}
    {resource.meta !== null && resource.items.length > 0 && total !== null && (resource.appendError !== null
      ? <div className="list-foot" data-list-state="append-error"><span role="alert">Could not load more: {resource.appendError}</span><button type="button" className="btn btn-sm" onClick={resource.retryAppend}>Retry</button></div>
      : resource.hasMore ? <div className="list-foot" ref={sentinel} data-list-state="more"><span className="spinner" aria-hidden="true"/>Loading {remaining.toLocaleString()} more…<span className="list-foot-count">({resource.items.length.toLocaleString()} of {total.toLocaleString()})</span></div>
      : <div className="list-foot list-end" data-list-state="end">End of list · {noun(total)}</div>)}
  </div></ScrollAnchor>;
}
/** The order after a header click: the same column reverses an ascending order, any other column starts ascending. */
export function nextOrder<S>(state: ListState<S>, sort: S): { sort: S; direction: SortDirection } { return { sort, direction: state.sort === sort && state.direction === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc }; }
/** `N <noun>` with the noun in the plural unless N is one. */
export function count(value: bigint, singular: string, plural: string): string { return `${value.toLocaleString()} ${value === 1n ? singular : plural}`; }
