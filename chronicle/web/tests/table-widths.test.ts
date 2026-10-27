import assert from 'node:assert/strict';
import test from 'node:test';
import { clampColumn, fitTableColumns, type TableColumnSpec } from '../src/table-widths.ts';
const title: TableColumnSpec = { id: 'title', label: 'Conversation', min: 150, ideal: 300, max: 900, compact: true, required: true, grow: true };
const state: TableColumnSpec = { id: 'state', label: 'State', min: 65, ideal: 100, max: 200, compact: true, required: false, grow: false };
test('BA specified: table widths clamp finite resizing and reject invalid dimensions', () => {
  assert.equal(clampColumn(title, -100), 150); assert.equal(clampColumn(title, 1000), 900); assert.equal(clampColumn(title, 253), 253);
  for (const width of [NaN, Infinity, -Infinity]) assert.throws(() => clampColumn(title, width));
  assert.throws(() => clampColumn({ ...title, min: 0 }, 100)); assert.throws(() => clampColumn({ ...title, max: 20 }, 100));
});
test('BA specified: content widths fit available space without violating readable minima or mutating inputs', () => {
  const input = [{ spec: title, width: 300 }, { spec: state, width: 100 }], saved = structuredClone(input);
  for (const available of [0, 100, 215, 216, 350, 400, 700, 1100, 2000]) {
    const fitted = fitTableColumns(input, available), total = fitted.reduce((sum, column) => sum + column.width, 0);
    assert.deepEqual(fitted.map(column => column.spec.id), ['title', 'state']);
    for (const column of fitted) assert.ok(column.width >= column.spec.min - 1e-9 && column.width <= column.spec.max + 1e-9);
    if (available >= 215) assert.ok(total <= available + 1e-9); else assert.equal(total, 215, 'narrow screens use contained scrolling rather than unreadable widths');
  }
  assert.deepEqual(input, saved); assert.deepEqual(fitTableColumns([], 0), []); assert.throws(() => fitTableColumns(input, -1));
});
test('BA specified: fitting clips flexible conversation text before narrowing compact scalar columns', () => {
  const fitted = fitTableColumns([{ spec: title, width: 900 }, { spec: state, width: 100 }], 600);
  assert.deepEqual(fitted.map(column => column.width), [500, 100]);
});
test('BA specified: extra space goes to the conversation before compact scalar columns', () => {
  const fitted = fitTableColumns([{ spec: title, width: 300 }, { spec: state, width: 100 }], 600);
  assert.deepEqual(fitted.map(column => column.width), [500, 100]);
});
