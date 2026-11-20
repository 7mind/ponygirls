// Delimiter-separated records with RFC 4180 quoting (the dialect of spreadsheets and of pandas, also with a tab).

export const TABLE_ROW_LIMIT = 2000;
export const TABLE_CELL_LIMIT = 100000;
export const TABLE_COLUMN_LIMIT = 500;
/** In the leading part of a larger file, a quoted field left open this close to the end (in characters) was split
 * by the cut; one left open further back is a fault of the file. Cells are rarely this long, stray quotes rarely
 * this late. */
export const CUT_DAMAGE_WINDOW = 64 * 1024;
const QUOTE = '"';
const NUMERIC_CELL = /^[+-]?(?:[0-9]+(?:[.,][0-9]+)*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?%?$/;

export class CsvSyntaxError extends Error {
  /** `line` is the 1-based line of the text where the fault starts; lines end at a line feed, as in the text view. */
  constructor(message, line) { super(message); this.name = 'CsvSyntaxError'; this.line = line; }
}

/**
 * Records of `text`. A quote opens a quoted field only at the start of a field; inside it `""` is a quote and
 * delimiters and line breaks are data. Empty lines are not records. At most TABLE_ROW_LIMIT records after the
 * first and TABLE_CELL_LIMIT cells are kept; `total` counts every record. Throws CsvSyntaxError for an unclosed
 * quoted field, for text after a closing quote, and for more than TABLE_COLUMN_LIMIT fields in a record.
 */
export function parseCsv(text, delimiter) { return parse(text, delimiter, false); }

/**
 * Records of the leading part of a larger text, as parseCsv, with what the cut did set apart from faults: a record
 * is complete, kept and counted only when its line break is in the part, and a quoted field left open within
 * CUT_DAMAGE_WINDOW of the end belongs to the incomplete last record. One left open further back is a fault.
 */
export function parseCsvPart(text, delimiter) { return parse(text, delimiter, true); }

function parse(text, delimiter, isPart) {
  const records = [];
  let total = 0, cells = 0, line = 1, at = 0, full = false;
  const length = text.length;
  while (at < length) {
    // Skip empty lines between records.
    if (text[at] === '\n') { line++; at++; continue; }
    if (text[at] === '\r') { at++; continue; }
    const record = [];
    const recordLine = line;
    let cutShort = false;
    for (;;) {
      let field;
      if (text[at] === QUOTE) {
        const opened = line, openedAt = at;
        let value = '';
        at++;
        for (;;) {
          const close = text.indexOf(QUOTE, at);
          if (close < 0 && isPart && length - openedAt <= CUT_DAMAGE_WINDOW) { cutShort = true; break; }
          if (close < 0) throw new CsvSyntaxError(`The quoted field that starts on line ${opened} is not closed.`, opened);
          const part = text.slice(at, close);
          value += part;
          line += (part.match(/\n/g) || []).length;
          at = close + 1;
          if (text[at] !== QUOTE) break;
          value += QUOTE; at++;
        }
        if (cutShort) break;
        if (at < length && text[at] !== delimiter && text[at] !== '\n' && text[at] !== '\r')
          throw new CsvSyntaxError(`Line ${line} has text after the closing quote of a field.`, line);
        field = value;
      } else {
        let end = at;
        while (end < length && text[end] !== delimiter && text[end] !== '\n' && text[end] !== '\r') end++;
        field = text.slice(at, end);
        at = end;
      }
      record.push(field);
      if (record.length > TABLE_COLUMN_LIMIT) throw new CsvSyntaxError(`Line ${recordLine} has more than ${TABLE_COLUMN_LIMIT} fields.`, recordLine);
      if (text[at] !== delimiter) break;
      at++;
    }
    // The last record of a part has no line break after it: the cut is somewhere inside it.
    if (cutShort || (isPart && at === length)) break;
    total++;
    // Only a prefix is kept: once a record does not fit, later ones are counted but not kept.
    full ||= records.length > TABLE_ROW_LIMIT || cells + record.length > TABLE_CELL_LIMIT;
    if (!full) { records.push(record); cells += record.length; }
  }
  return { records, total };
}

/** Per column: whether every non-empty cell below the header is a number (and at least one is). */
export function numericColumns(records) {
  const width = records.reduce((most, record) => Math.max(most, record.length), 0);
  return Array.from({ length: width }, (_, column) => {
    let seen = false;
    for (let row = 1; row < records.length; row++) {
      const cell = records[row][column];
      if (cell === undefined || cell === '') continue;
      if (!NUMERIC_CELL.test(cell)) return false;
      seen = true;
    }
    return seen;
  });
}
