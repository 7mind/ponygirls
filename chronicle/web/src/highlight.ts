export interface TextPart { text: string; highlighted: boolean }
export interface ByteRange { start: number; end: number }
export function highlightUtf8(text: string, ranges: readonly ByteRange[]): TextPart[] {
  const bytes = new TextEncoder().encode(text), decoder = new TextDecoder('utf-8', { fatal: true });
  const merged: ByteRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end > bytes.length) throw new Error('Chunk span is outside the source byte range');
    try { decoder.decode(bytes.slice(0, range.start)); decoder.decode(bytes.slice(range.start, range.end)); }
    catch { throw new Error('Chunk span is not on a UTF-8 boundary'); }
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  const parts: TextPart[] = []; let offset = 0;
  for (const range of merged) {
    if (range.start > offset) parts.push({ text: decoder.decode(bytes.slice(offset, range.start)), highlighted: false });
    if (range.end > range.start) parts.push({ text: decoder.decode(bytes.slice(range.start, range.end)), highlighted: true });
    offset = range.end;
  }
  if (offset < bytes.length || parts.length === 0) parts.push({ text: decoder.decode(bytes.slice(offset)), highlighted: false });
  return parts;
}
