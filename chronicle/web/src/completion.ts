import type { ExpressionHint, ExpressionHintsResult } from './api.ts';
export function scalarBoundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}
export function scalarUtf8Bytes(text: string): number {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = text.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Text contains an unpaired Unicode surrogate.'); }
    else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('Text contains an unpaired Unicode surrogate.');
  }
  return new TextEncoder().encode(text).length;
}
export function acceptExpressionHint(expression: string, result: ExpressionHintsResult, hint: ExpressionHint): { expression: string; caret: number } {
  const start = result.replaceStartUtf16, end = result.replaceEndUtf16;
  if (!scalarBoundary(expression, start) || !scalarBoundary(expression, end) || start > end || !scalarBoundary(hint.insertText, hint.caretOffsetUtf16)) throw new Error('The completion contains an invalid Unicode replacement range.');
  scalarUtf8Bytes(hint.insertText);
  return { expression: expression.slice(0, start) + hint.insertText + expression.slice(end), caret: start + hint.caretOffsetUtf16 };
}
