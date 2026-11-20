import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatJson, formatJsonLines, JsonSyntaxError, JsonFormatLimitError, JSON_DEPTH_LIMIT, JSON_FORMAT_LIMIT } from '../src/json.js';

// Behavioral / Active / Blackbox / Atomic; RFC 8259 validation and lexeme-preserving re-indentation.
const fault = (text, format = formatJson) => { try { format(text); } catch (error) { return error; } throw new Error(`accepted ${JSON.stringify(text)}`); };

test('valid JSON is re-indented by two spaces with empty containers kept closed', () => {
  assert.equal(formatJson('{"a":[1,{"b":null,"c":[]},{}],"d":"x"}'),
    '{\n  "a": [\n    1,\n    {\n      "b": null,\n      "c": []\n    },\n    {}\n  ],\n  "d": "x"\n}\n');
  assert.equal(formatJson(' [ ] '), '[]\n');
  assert.equal(formatJson('\t{\r\n}\n'), '{}\n');
  for (const scalar of ['0', '-0', 'true', 'false', 'null', '"text"', '1e5', '-12.50E-3']) assert.equal(formatJson(` ${scalar}\n`), scalar + '\n');
});

test('numbers and strings are copied as written, not re-serialised', () => {
  const lexemes = ['12345678901234567890', '1.0', '1E+2', '0.10000000000000000001', '-0', '"\\u00e9\\n\\/"', '"é 東京 \u{1f600}"', '"a\\\\"', '"\\""'];
  const formatted = formatJson(`[${lexemes.join(',')}]`);
  assert.equal(formatted, `[\n  ${lexemes.join(',\n  ')}\n]\n`);
  assert.equal(formatJson('{"k":1,"k":2}'), '{\n  "k": 1,\n  "k": 2\n}\n', 'duplicate names are kept');
});

test('formatting a formatted text changes nothing, and the result parses to the same value', () => {
  const text = '{"run":"x","rows":[{"n":1.50,"ok":true,"tags":["a","b"],"none":null}],"empty":{},"list":[]}';
  const once = formatJson(text);
  assert.equal(formatJson(once), once);
  assert.deepEqual(JSON.parse(once), JSON.parse(text));
});

test('faults are reported with the line and column of the first offending character', () => {
  const cases = [
    ['{\n  "a": 1,\n}', 3, 1, /"}": a member name was expected/],
    ['[1, 2,]', 1, 7, /"]": a value was expected/],
    ['{"a" 1}', 1, 6, /"1": ":" was expected/],
    ['{"a": 1 "b": 2}', 1, 9, /"," or "}" was expected/],
    ['[1 2]', 1, 4, /"," or "]" was expected/],
    ['{a: 1}', 1, 2, /"a": a member name or "}" was expected/],
    ["['x']", 1, 2, /"'": a value or "]" was expected/],
    ['01', 1, 2, /"1": the end of the text was expected/],
    ['1.', 1, 2, /"\.": the end of the text was expected/],
    ['+1', 1, 1, /"\+": a value was expected/],
    ['nul', 1, 1, /"n": a value was expected/],
    ['NaN', 1, 1, /a value was expected/],
    ['{} {}', 1, 4, /the end of the text was expected/],
    ['', 1, 1, /end of text: a value was expected/],
    [' \n ', 2, 2, /end of text: a value was expected/],
    ['[1,\n [2,\n  3', 3, 4, /end of text: "," or "]" was expected/],
    ['{"a":', 1, 6, /end of text: a value was expected/],
    ['"open', 1, 6, /end of text: the closing quote of the string was expected/],
    ['"bad \\x escape"', 1, 6, /"\\": a valid escape sequence was expected/],
    ['"\\u12G4"', 1, 2, /a valid escape sequence was expected/],
    ['"line\nbreak"', 1, 6, /control character U\+000A: the closing quote of the string was expected/],
    ['"tab\there"', 1, 5, /control character U\+0009/],
    ['// comment\n{}', 1, 1, /"\/": a value was expected/],
    ['{"a": 1} trailing', 1, 10, /"t": the end of the text was expected/],
  ];
  for (const [text, line, column, message] of cases) {
    const error = fault(text);
    assert.ok(error instanceof JsonSyntaxError, `${JSON.stringify(text)}: ${error}`);
    assert.deepEqual([error.line, error.column], [line, column], JSON.stringify(text));
    assert.match(error.message, message, JSON.stringify(text));
  }
});

test('the formatter accepts exactly what JSON.parse accepts', () => {
  const samples = ['{}', '[]', '[[]]', '{"a":{"b":{"c":[1,2,3]}}}', '"\\ud83d\\ude00"', '1e-7', '[1,]', '{"a":1,}', '[,1]', '{,}', '{"a"}', '{"a":}', '[1 1]', 'tru', 'truefalse',
    '-', '1e', '1e+', '.5', '00', '-01', '0x10', '"\\v"', '"\u0000"', '[', ']', '{', '}', ':', ',', '{"a":1}}', '[1]]', '\ufeff{}', '{"a":1}\n\n', 'null null', '[null,true,false]', '"\\u00E9"', '{"":""}', ' 1 '];
  for (const text of samples) {
    let parses = true;
    try { JSON.parse(text); } catch { parses = false; }
    let formats = true;
    try { formatJson(text); } catch (error) { assert.ok(error instanceof JsonSyntaxError, text); formats = false; }
    assert.equal(formats, parses, JSON.stringify(text));
  }
});

test('nesting and output size are bounded with a distinct error, without deep recursion', () => {
  const nested = depth => '['.repeat(depth) + ']'.repeat(depth);
  assert.equal(formatJson(nested(JSON_DEPTH_LIMIT)).split('\n').length, 2 * JSON_DEPTH_LIMIT);
  const deep = fault(nested(JSON_DEPTH_LIMIT + 1));
  assert.ok(deep instanceof JsonFormatLimitError && !(deep instanceof JsonSyntaxError));
  assert.match(deep.message, /256 levels/);
  assert.ok(fault(nested(200000)) instanceof JsonFormatLimitError, 'bounded before any deep recursion');
  // Indentation multiplies the size: 100 levels deep, each of 80,000 one-character members gets 200 spaces.
  const wide = '['.repeat(100) + Array(80000).fill('1').join(',') + ']'.repeat(100);
  assert.ok(wide.length < JSON_FORMAT_LIMIT / 4);
  assert.match(fault(wide).message, /8 MiB/);
  assert.ok(fault(wide) instanceof JsonFormatLimitError);
});

test('a long string or number run does not exhaust the regular-expression stack', () => {
  const long = JSON.stringify('é\\"'.repeat(400000));
  assert.equal(formatJson(long), long + '\n');
  assert.equal(formatJson('[' + '1,'.repeat(300000) + '1]').split('\n').length, 300004);
});

test('JSON Lines: every non-blank line is formatted; a fault names the line of the file', () => {
  assert.equal(formatJsonLines('{"a":1}\r\n\r\n[true]\n"x"\n'), '{\n  "a": 1\n}\n[\n  true\n]\n"x"\n');
  assert.equal(formatJsonLines(''), '');
  const error = fault('{"a":1}\n\n{"b":2,}\n', formatJsonLines);
  assert.ok(error instanceof JsonSyntaxError);
  assert.deepEqual([error.line, error.column], [3, 8]);
  assert.ok(fault('{"a":1} {"b":2}\n', formatJsonLines) instanceof JsonSyntaxError, 'one value per line');
});
