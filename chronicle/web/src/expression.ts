interface Token { start: number; end: number; text: string; literal: boolean; depth: number }
export interface ExpressionParts { body: string; modeDirective: string | null; mode: 'Lexical' | 'Semantic' | 'Hybrid' }
function scalarText(value: string) {
  for (let index = 0; index < value.length; index++) {
    const char = value.charCodeAt(index);
    if (char === 0) throw new Error('NUL is not permitted in a search expression.');
    if (char >= 0xd800 && char <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Search expressions require scalar Unicode.');
    } else if (char >= 0xdc00 && char <= 0xdfff) throw new Error('Search expressions require scalar Unicode.');
  }
}
function quotedValue(value: string): string {
  let decoded: unknown;
  try { decoded = JSON.parse(value); } catch { throw new Error('Use valid JSON-compatible quoted values before applying a quick filter.'); }
  if (typeof decoded !== 'string') throw new Error('Expected a quoted search value.');
  scalarText(decoded); return decoded;
}
function tokens(expression: string): Token[] {
  scalarText(expression);
  const result: Token[] = [], groups: string[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index]!;
    if (/\s/.test(char)) { index++; continue; }
    const start = index;
    if (char === '(' || char === '{') { result.push({ start, end: ++index, text: char, literal: false, depth: groups.length }); groups.push(char); continue; }
    if (char === ')' || char === '}') {
      if (groups.pop() !== (char === ')' ? '(' : '{')) throw new Error('Close quotes and groups before applying a quick filter.');
      result.push({ start, end: ++index, text: char, literal: false, depth: groups.length }); continue;
    }
    if (char === ':') { result.push({ start, end: ++index, text: char, literal: false, depth: groups.length }); continue; }
    let quoted = false, escaped = false, literal = false, quoteStart = 0;
    while (index < expression.length) {
      const current = expression[index]!;
      if (escaped) { escaped = false; index++; continue; }
      if (current === '\\') { literal = true; escaped = true; index++; continue; }
      if (current === '"') {
        literal = true;
        if (quoted) quotedValue(expression.slice(quoteStart, index + 1)); else quoteStart = index;
        quoted = !quoted; index++; continue;
      }
      if (!quoted && /[\s:(){}]/.test(current)) break;
      index++;
    }
    if (quoted || escaped) throw new Error('Close quotes and groups before applying a quick filter.');
    result.push({ start, end: index, text: expression.slice(start, index), literal, depth: groups.length });
  }
  if (groups.length !== 0) throw new Error('Close quotes and groups before applying a quick filter.');
  return result;
}
function operator(token: Token | undefined, value: string): boolean { return token !== undefined && !token.literal && token.text.toUpperCase() === value; }

// This checks directive placement, not the server's field/Boolean search policy.
export function splitGlobalMode(expression: string): ExpressionParts {
  const scanned = tokens(expression), modes: number[] = [];
  for (let index = 0; index < scanned.length; index++) {
    const token = scanned[index]!;
    if (!token.literal && token.text.toLowerCase() === 'mode' && scanned[index + 1]?.text === ':') modes.push(index);
  }
  if (modes.length > 1) throw new Error('Use only one global mode directive before applying a quick filter.');
  const modeIndex = modes[0];
  if (modeIndex === undefined) return { body: expression.trim(), modeDirective: null, mode: 'Hybrid' };
  const first = scanned[modeIndex]!, last = scanned[modeIndex + 2];
  if (last === undefined || last.text === ':' || last.text === '(' || last.text === '{' || last.text === ')' || last.text === '}') throw new Error('Complete the global mode directive before applying a quick filter.');
  const outerOr = scanned.some((token, index) => token.depth === 0 && operator(token, 'OR') && scanned[index - 1]?.text !== ':');
  if (first.depth !== 0 || outerOr || operator(scanned[modeIndex - 1], 'NOT')) throw new Error('The mode must be an outer AND directive, not inside OR, NOT or groups. Group the Boolean body first, for example (A OR B) mode:lexical.');
  const value = (last.text.startsWith('"') ? quotedValue(last.text) : last.text.replace(/\\(.)/gs, '$1')).toLowerCase();
  const mode = value === 'lexical' ? 'Lexical' : value === 'semantic' ? 'Semantic' : value === 'hybrid' ? 'Hybrid' : null;
  if (mode === null) throw new Error('Search mode must be lexical, semantic or hybrid.');
  let start = first.start, end = last.end;
  const before = scanned[modeIndex - 1], after = scanned[modeIndex + 3];
  if (operator(before, 'AND')) start = before!.start;
  else if (operator(after, 'AND')) end = after!.end;
  const body = [expression.slice(0, start).trim(), expression.slice(end).trim()].filter(Boolean).join(' '), remaining = tokens(body);
  if ((body.length === 0 && (start !== first.start || end !== last.end)) || operator(remaining[0], 'AND') || operator(remaining[0], 'OR') || ['AND', 'OR', 'NOT'].some(value => operator(remaining.at(-1), value))) throw new Error('Complete the expression around the mode directive before applying a quick filter.');
  return { body, modeDirective: expression.slice(first.start, last.end), mode };
}
export function addExpressionFilter(expression: string, attribute: string, value: string): string {
  if (!/^[a-z][a-z0-9_-]*$/i.test(attribute)) throw new Error('Invalid quick-filter attribute.');
  scalarText(value);
  const { body, modeDirective } = splitGlobalMode(expression), clause = `${attribute}:${JSON.stringify(value)}`;
  return [modeDirective, body.length === 0 ? clause : `(${body}) AND ${clause}`].filter(part => part !== null).join(' ');
}
