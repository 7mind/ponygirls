export type MessageBlock = { kind: 'text'; text: string } | { kind: 'code'; text: string; language: string };
export type InlinePart = { kind: 'text' | 'strong' | 'emphasis' | 'code'; text: string };

export function messageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [], lines = text.split('\n');
  let offset = 0, pending = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!, start = offset;
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
    if (opening === null || index === lines.length - 1) continue;
    const fence = opening[1]!, language = opening[2]!.trim();
    if (fence[0] === '`' && language.includes('`')) continue;
    const contentStart = offset;
    let closed = false;
    for (let next = index + 1; next < lines.length; next++) {
      const candidate = lines[next]!, closing = /^ {0,3}([`~]+)[ \t]*$/.exec(candidate.replace(/\r$/, ''));
      const contentEnd = offset;
      offset += candidate.length + (next < lines.length - 1 ? 1 : 0);
      if (closing === null || closing[1]!.length < fence.length || [...closing[1]!].some(char => char !== fence[0])) continue;
      if (start > pending) blocks.push({ kind: 'text', text: text.slice(pending, start) });
      blocks.push({ kind: 'code', text: text.slice(contentStart, contentEnd), language });
      pending = offset; index = next; closed = true; break;
    }
    if (!closed) break;
  }
  if (pending < text.length || blocks.length === 0) blocks.push({ kind: 'text', text: text.slice(pending) });
  return blocks;
}

function delimiterParts(text: string, mode: 'code' | 'emphasis'): InlinePart[] {
  const parts: InlinePart[] = [], tokens = [...text.matchAll(mode === 'code' ? /`+|\n/g : /\*+|\n/g)];
  const closers = new Map<string, number>(), nextClosing = new Map<number, number>();
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index]!, delimiter = token[0], start = token.index;
    if (delimiter === '\n') { closers.clear(); continue; }
    if (text[start - 1] === '\\') continue;
    const next = closers.get(delimiter);
    if (next !== undefined) nextClosing.set(index, next);
    if (delimiter[0] === '`' || (delimiter.length <= 2 && start > 0 && !/\s/.test(text[start - 1]!) && !/[\p{L}\p{N}_]/u.test(text[start + delimiter.length] ?? ''))) closers.set(delimiter, index);
  }
  let offset = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!, delimiter = token[0], start = token.index, closingIndex = nextClosing.get(index);
    if (delimiter === '\n' || closingIndex === undefined || text[start - 1] === '\\') continue;
    if (delimiter[0] === '*' && (delimiter.length > 2 || /\s/.test(text[start + delimiter.length] ?? '') || /[\p{L}\p{N}_]/u.test(text[start - 1] ?? ''))) continue;
    const closing = tokens[closingIndex]!;
    if (start > offset) parts.push({ kind: 'text', text: text.slice(offset, start) });
    parts.push({ kind: delimiter[0] === '`' ? 'code' : delimiter.length === 2 ? 'strong' : 'emphasis', text: text.slice(start + delimiter.length, closing.index) });
    offset = closing.index + delimiter.length; index = closingIndex;
  }
  if (offset < text.length || parts.length === 0) parts.push({ kind: 'text', text: text.slice(offset) });
  return parts;
}

export function inlineParts(text: string): InlinePart[] {
  // Code bodies are opaque: emphasis delimiters inside them are literal source.
  return delimiterParts(text, 'code').flatMap(part => part.kind === 'text' ? delimiterParts(part.text, 'emphasis') : [part]);
}
