import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, numericColumns, CsvSyntaxError, TABLE_ROW_LIMIT, TABLE_CELL_LIMIT, TABLE_COLUMN_LIMIT } from '../src/csv.js';

// Behavioral / Active / Blackbox / Atomic; RFC 4180 records with either delimiter.
const records = (text, delimiter = ',') => parseCsv(text, delimiter).records;
const fault = text => { try { parseCsv(text, ','); } catch (error) { return error; } throw new Error(`accepted ${JSON.stringify(text)}`); };

test('plain and quoted fields, embedded delimiters, quotes and line breaks', () => {
  assert.deepEqual(records('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(records('name,note\r\n"Smith, J","said ""hi"""\r\n"two\r\nlines",x'), [['name', 'note'], ['Smith, J', 'said "hi"'], ['two\r\nlines', 'x']]);
  assert.deepEqual(records('a,"",c\n,,\n"",\n'), [['a', '', 'c'], ['', '', ''], ['', '']]);
  assert.deepEqual(records('x'), [['x']]);
  assert.deepEqual(records(''), []);
});

test('a quote inside an unquoted field is data; a quote opens a field only at its start', () => {
  assert.deepEqual(records('5" disk,a"b"c\n'), [['5" disk', 'a"b"c']]);
  assert.deepEqual(records(' "x",y\n'), [[' "x"', 'y']]);
});

test('line endings: LF, CRLF and a lone CR end a record; empty lines are not records', () => {
  assert.deepEqual(records('a,b\rc,d\r\ne,f\n\n\r\ng,h'), [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']]);
  assert.equal(parseCsv('\n\na\n\n', ',').total, 1);
});

test('tab-separated values use the same quoting', () => {
  assert.deepEqual(records('id\ttext\n1\t"tab\there"\n2\ta,b\n', '\t'), [['id', 'text'], ['1', 'tab\there'], ['2', 'a,b']]);
});

test('ragged records keep their own field counts', () => {
  assert.deepEqual(records('a,b,c\n1\n1,2,3,4\n'), [['a', 'b', 'c'], ['1'], ['1', '2', '3', '4']]);
});

test('an unclosed quoted field and text after a closing quote are faults with their line', () => {
  const open = fault('a,b\n1,"never closed\n2,3\n');
  assert.ok(open instanceof CsvSyntaxError);
  assert.equal(open.line, 2);
  assert.match(open.message, /starts on line 2 is not closed/);
  const after = fault('a,b\n"x\ny"z,1\n');
  assert.ok(after instanceof CsvSyntaxError);
  assert.equal(after.line, 3);
  assert.match(after.message, /Line 3 has text after the closing quote/);
});

// Regression (review F6): a lone CR ends a record but is not a line of the text view, which splits at LF only.
test('fault lines count line feeds, as the text view does', () => {
  assert.equal(fault('a,b\rc,d\r1,"open\r').line, 1);
  assert.equal(fault('a,b\r\nc,"x\ry"z\r\n').line, 2);
  assert.equal(fault('a\n\n\n"x\ny\rz" w\n').line, 5);
});

test('only a leading part of a large table is kept; every record is counted', () => {
  const tall = parseCsv('n\n' + Array.from({ length: 5000 }, (_, i) => i).join('\n') + '\n', ',');
  assert.equal(tall.total, 5001);
  assert.equal(tall.records.length, TABLE_ROW_LIMIT + 1);
  assert.deepEqual(tall.records.at(-1), [String(TABLE_ROW_LIMIT - 1)]);
  const columns = 400;
  const row = Array(columns).fill('v').join(',');
  const wide = parseCsv(Array(1000).fill(row).join('\n') + '\nshort\n', ',');
  assert.equal(wide.total, 1001);
  assert.equal(wide.records.length, TABLE_CELL_LIMIT / columns, 'the short last record is not kept after the cut');
  const error = fault(Array(TABLE_COLUMN_LIMIT + 1).fill('v').join(','));
  assert.ok(error instanceof CsvSyntaxError);
  assert.match(error.message, /more than 500 fields/);
  assert.equal(records(Array(TABLE_COLUMN_LIMIT).fill('v').join(','))[0].length, TABLE_COLUMN_LIMIT);
});

test('numeric columns: every filled cell below the header is a number', () => {
  const table = [['name', 'n', 'ratio', 'share', 'mixed', 'empty', 'date'], ['a', '1', '0.5', '12%', '1', '', '2026-11-20'], ['b', '-2', '1e-3', '7.5%', 'x', '', '2026-11-21'], ['c', '', '1,234.5', '', '', '', '']];
  assert.deepEqual(numericColumns(table), [false, true, true, true, false, false, false]);
  assert.deepEqual(numericColumns([['only header']]), [false]);
  assert.deepEqual(numericColumns([['h'], ['1', '2']]), [true, true], 'a ragged row widens the table');
});
