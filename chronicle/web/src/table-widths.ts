export interface TableColumnSpec { id: string; label: string; min: number; ideal: number; max: number; compact: boolean; required: boolean; grow: boolean }
export interface SizedColumn { spec: TableColumnSpec; width: number }
export function clampColumn(column: TableColumnSpec, width: number): number {
  if (!Number.isFinite(width) || column.min <= 0 || column.min > column.ideal || column.ideal > column.max) throw new Error('Invalid table column dimensions.');
  return Math.max(column.min, Math.min(column.max, width));
}
export function fitTableColumns(columns: readonly SizedColumn[], available: number): SizedColumn[] {
  if (!Number.isFinite(available) || available < 0) throw new Error('Invalid table viewport width.');
  const result = columns.map(column => ({ spec: column.spec, width: clampColumn(column.spec, column.width) }));
  const total = result.reduce((sum, column) => sum + column.width, 0);
  if (total > available) {
    let remaining = total - available;
    for (const grow of [true, false]) {
      const group = result.filter(column => column.spec.grow === grow), room = group.reduce((sum, column) => sum + column.width - column.spec.min, 0), reduction = Math.min(remaining, room);
      if (room > 0) for (const column of group) column.width -= reduction * (column.width - column.spec.min) / room;
      remaining -= reduction;
    }
  } else {
    let remaining = available - total;
    for (const grow of [true, false]) for (const column of result.filter(column => column.spec.grow === grow)) { const extra = Math.min(remaining, column.spec.max - column.width); column.width += extra; remaining -= extra; }
  }
  return result;
}
