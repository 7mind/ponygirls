import { CliError } from './errors.js';
export type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export function isObject(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function parseJson(text: string): Json {
  let at = 0;
  const fail = (): never => { throw new CliError('invalid', 'Invalid JSON (duplicate keys, depth, encoding or syntax).'); };
  const space = () => { while (/\s/.test(text[at] ?? '') && at < text.length) { if (!' \t\r\n'.includes(text[at]!)) fail(); at++; } };
  function string(): string {
    const start = at++; let escaped = false;
    while (at < text.length) { const c = text[at++]!; if (!escaped && c === '"') { try { return JSON.parse(text.slice(start, at)) as string; } catch { fail(); } } if (!escaped && c === '\\') escaped = true; else escaped = false; }
    return fail();
  }
  function value(depth: number): Json {
    if (depth > 64) fail(); space(); const c = text[at];
    if (c === '"') return string();
    if (c === '{') { at++; const result: JsonObject = Object.create(null) as JsonObject; space(); if (text[at] === '}') { at++; return result; }
      for (;;) { space(); if (text[at] !== '"') fail(); const key = string(); if (Object.hasOwn(result, key)) fail(); space(); if (text[at++] !== ':') fail(); result[key] = value(depth + 1); space(); const end = text[at++]; if (end === '}') return result; if (end !== ',') fail(); }
    }
    if (c === '[') { at++; const result: Json[] = []; space(); if (text[at] === ']') { at++; return result; } for (;;) { result.push(value(depth + 1)); space(); const end = text[at++]; if (end === ']') return result; if (end !== ',') fail(); } }
    const token = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (token === null) return fail(); at += token[0].length; const result: unknown = JSON.parse(token[0]);
    if (typeof result === 'number' && !Number.isFinite(result)) fail(); return result as Json;
  }
  const result = value(0); space(); if (at !== text.length) fail(); return result;
}
