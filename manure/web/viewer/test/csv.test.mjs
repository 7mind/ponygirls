import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvPart, numericColumns, CsvSyntaxError, TABLE_ROW_LIMIT, TABLE_CELL_LIMIT, TABLE_COLUMN_LIMIT, CUT_DAMAGE_WINDOW } from '../src/csv.js';

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

// Specified: the leading part of a larger file (cut at a line end) is tabulated as a part. The cut may split the last
// record; that is not a fault of the file, but an unclosed quote far from the cut is.
const partFault = text => { try { parseCsvPart(text, ','); } catch (error) { return error; } throw new Error(`accepted a part ending ${JSON.stringify(text.slice(-40))}`); };

test('part of a file: a record is complete only when its terminator is in the part', () => {
  assert.deepEqual(parseCsvPart('a,b\n1,2\n3,4\n', ','), { records: [['a', 'b'], ['1', '2'], ['3', '4']], total: 3 });
  assert.deepEqual(parseCsvPart('a,b\r\n1,2\r\n', ',').records, [['a', 'b'], ['1', '2']]);
  // A part without a final line break ends inside its last record, whatever that record looks like.
  assert.deepEqual(parseCsvPart('a,b\n1,2\n3,4', ','), { records: [['a', 'b'], ['1', '2']], total: 2 });
  assert.deepEqual(parseCsvPart('a,b\n1,2\n3,"closed"', ','), { records: [['a', 'b'], ['1', '2']], total: 2 });
  assert.deepEqual(parseCsvPart('one line without an end', ','), { records: [], total: 0 });
  assert.deepEqual(parseCsvPart('', ','), { records: [], total: 0 });
  // The whole-file parser keeps a last record without a line break.
  assert.deepEqual(parseCsv('a,b\n1,2\n3,4', ',').total, 3);
});

test('part of a file: a quoted cell split by the cut is dropped with its record, not reported', () => {
  const part = 'id,note\n1,plain\n2,"first line of a cell\nsecond line, and the cut comes here\n';
  assert.deepEqual(parseCsvPart(part, ','), { records: [['id', 'note'], ['1', 'plain']], total: 2 });
  assert.match(String(fault(part).message), /starts on line 3 is not closed/, 'the same text as a whole file is faulty');
  assert.deepEqual(parseCsvPart('id\tnote\n1\t"cut\n', '\t'), { records: [['id', 'note']], total: 1 });
});

test('part of a file: an unclosed quote counts as cut damage only within the last 64 KiB', () => {
  assert.equal(CUT_DAMAGE_WINDOW, 64 * 1024);
  const head = 'id,note\n1,plain\n';
  const open = '2,"';
  // The opening quote is the last character of `head + open`; `tail` is what follows it in the part.
  const part = tail => head + open + tail;
  const tailOf = distance => 'x'.repeat(distance - 2) + '\n';   // distance from the quote to the end of the part
  assert.deepEqual(parseCsvPart(part(tailOf(CUT_DAMAGE_WINDOW)), ','), { records: [['id', 'note'], ['1', 'plain']], total: 2 }, 'exactly the window');
  const far = partFault(part(tailOf(CUT_DAMAGE_WINDOW + 1)));
  assert.ok(far instanceof CsvSyntaxError);
  assert.equal(far.line, 3);
  assert.match(far.message, /starts on line 3 is not closed/);
  // A stray quote early in a large part hides nothing: it is a fault, with its line.
  const stray = partFault('a,b\n1,"stray\n' + 'x,y\n'.repeat(30000));
  assert.equal(stray.line, 2);
});

test('part of a file: other faults and the retention caps are those of a whole file', () => {
  assert.match(partFault('a,b\n"x"y,1\n2,3\n').message, /Line 2 has text after the closing quote/);
  assert.match(partFault(Array(TABLE_COLUMN_LIMIT + 1).fill('v').join(',') + '\n').message, /more than 500 fields/);
  const tall = parseCsvPart('n\n' + Array.from({ length: 5000 }, (_, i) => i).join('\n') + '\n5000,"cut\n', ',');
  assert.equal(tall.total, 5001, 'complete records are counted, the cut one is not');
  assert.equal(tall.records.length, TABLE_ROW_LIMIT + 1);
  const kept = parseCsvPart('n\n1\n2\n3,"cut\n', ',');
  assert.deepEqual(kept, { records: [['n'], ['1'], ['2']], total: 3 });
});
