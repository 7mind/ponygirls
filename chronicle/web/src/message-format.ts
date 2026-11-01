export type MessageBlock = { kind: 'text'; text: string } | { kind: 'code'; text: string; language: string };
export type InlinePart = { kind: 'text' | 'strong' | 'emphasis' | 'code'; text: string };

export function messageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n/gm;
  let offset = 0, match: RegExpExecArray | null;
  while ((match = opening.exec(text)) !== null) {
    const fence = match[1]!, language = match[2]!.trim();
    if (fence[0] === '`' && language.includes('`')) continue;
    const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`, 'gm');
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(text);
    if (end === null) break;
    if (match.index > offset) blocks.push({ kind: 'text', text: text.slice(offset, match.index) });
    blocks.push({ kind: 'code', text: text.slice(opening.lastIndex, end.index), language });
    offset = closing.lastIndex;
    opening.lastIndex = offset;
  }
  if (offset < text.length || blocks.length === 0) blocks.push({ kind: 'text', text: text.slice(offset) });
  return blocks;
}

export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /(`+)([^\n]*?)\1|\*\*([^*\n]+)\*\*|(?<!\*)\*([^*\n]+)\*(?!\*)/g;
  let offset = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > offset) parts.push({ kind: 'text', text: text.slice(offset, match.index) });
    parts.push(match[2] !== undefined ? { kind: 'code', text: match[2] } : match[3] !== undefined ? { kind: 'strong', text: match[3] } : { kind: 'emphasis', text: match[4]! });
    offset = pattern.lastIndex;
  }
  if (offset < text.length || parts.length === 0) parts.push({ kind: 'text', text: text.slice(offset) });
  return parts;
}
