import { parse } from 'lossless-json';

const MAX_DEPTH = 96;
const MIN_INTEGER = -(1n << 63n);
const MAX_INTEGER = (1n << 63n) - 1n;
const MAX_INTEGER_DIGITS = 19;

function numberToken(token: string): number | bigint {
  if (/^-?(0|[1-9]\d*)$/.test(token)) {
    if (token.replace('-', '').length > MAX_INTEGER_DIGITS) throw new Error('Integer outside protocol range');
    const value = BigInt(token);
    if (value < MIN_INTEGER || value > MAX_INTEGER) throw new Error('Integer outside protocol range');
    const ordinary = Number(value);
    return Number.isSafeInteger(ordinary) ? ordinary : value;
  }
  const value = Number(token);
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Unsafe noncanonical numeric token');
  return value;
}

// lossless-json accepts duplicate keys when their values compare equal. Enforce
// the protocol's stricter field membership before handing it valid JSON syntax.
function uniqueKeys(text: string): void {
  const stack: (Set<string> | null)[] = [];
  let keyExpected = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      for (index++; index < text.length && text[index] !== '"'; index++) if (text[index] === '\\') index++;
      if (keyExpected) {
        const keys = stack[stack.length - 1];
        if (keys === undefined || keys === null) throw new Error('Object key outside object');
        const key: unknown = JSON.parse(text.slice(start, index + 1));
        if (typeof key !== 'string' || keys.has(key)) throw new Error('Duplicate object key');
        keys.add(key);
      }
    } else if (character === '{' || character === '[') {
      stack.push(character === '{' ? new Set<string>() : null);
      if (stack.length > MAX_DEPTH) throw new Error('JSON nesting limit');
      keyExpected = character === '{';
    } else if (character === '}' || character === ']') {
      stack.pop();
      keyExpected = false;
    } else if (character === ':') keyExpected = false;
    else if (character === ',') keyExpected = stack.length > 0 && stack[stack.length - 1] !== null;
  }
}

export function parseJson(text: string): unknown {
  uniqueKeys(text);
  return parse(text, undefined, numberToken);
}
