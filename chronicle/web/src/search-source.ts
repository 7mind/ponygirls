import { SearchCountScope, Span, type ContentView, type ContextExcerpt, type MessageContextResult, type SearchResult } from './api.ts';
import { highlightUtf8, type TextPart } from './highlight.ts';
import { requireContentView } from './source-view.ts';
export const SEARCH_PAGE_SIZE = 10;
export const SNIPPET_BYTES = 512;
export const CONTEXT_BYTES = 2048;
const MAX_CONTEXT_EXCERPTS = 9;
export function searchPageEnd(result: SearchResult): number {
  if (!Number.isSafeInteger(result.total) || result.total < 0 || result.hits.length > SEARCH_PAGE_SIZE) throw new Error('Invalid search page count.');
  if (result.countScope === SearchCountScope.ExactMatches) {
    if (result.rankingLimit !== undefined) throw new Error('Exact search unexpectedly returned a candidate limit.');
    return result.total;
  }
  if (result.countScope !== SearchCountScope.CandidateWindow || result.rankingLimit === undefined || !Number.isSafeInteger(result.rankingLimit) || result.rankingLimit <= 0 || result.total > result.rankingLimit) throw new Error('Invalid bounded search ranking window.');
  return Math.min(result.total, result.rankingLimit);
}
export function validateSearchPage(result: SearchResult, offset: number): SearchResult {
  const end = searchPageEnd(result);
  if ((result.hits.length > 0 && offset + result.hits.length > end) || (result.countScope === SearchCountScope.CandidateWindow && offset >= result.rankingLimit!)) throw new Error('Search page exceeds its ranking window.');
  const ids = new Set<string>();
  for (const hit of result.hits) {
    if (!hit.session.id || ids.has(hit.session.id) || !Number.isSafeInteger(hit.session.view.revision) || hit.session.view.revision <= 0) throw new Error('Invalid or duplicate search session identity.');
    ids.add(hit.session.id);
    for (const chunk of hit.chunks) {
      if (chunk.sessionId !== hit.session.id) throw new Error('Search chunk belongs to another source session.');
      for (const span of chunk.spans) snippetAnchor(span);
    }
  }
  return result;
}
type SourceRange = Pick<Span, 'messageId' | 'start' | 'end'>;
export function snippetAnchor(span: SourceRange): Span {
  if (!span.messageId || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end < span.start) throw new Error('Invalid search source span.');
  return new Span(span.messageId, span.start, span.end - span.start <= CONTEXT_BYTES ? span.end : span.start);
}
function sameSpan(left: SourceRange, right: SourceRange): boolean { return left.messageId === right.messageId && left.start === right.start && left.end === right.end; }
export function contextParts(excerpt: ContextExcerpt, match: Span): TextPart[] {
  const source = excerpt.source, start = Math.max(source.start, match.start), end = Math.min(source.end, match.end);
  return highlightUtf8(excerpt.text, source.messageId === match.messageId && end > start ? [{ start: start - source.start, end: end - source.start }] : []);
}
export function validateContext(result: MessageContextResult, sessionId: string, view: ContentView, anchor: Span, before: number, after: number): MessageContextResult {
  requireContentView(view, result.view);
  if (result.sessionId !== sessionId || !sameSpan(result.anchor, anchor)) throw new Error('Context source identity or anchor changed unexpectedly.');
  if (result.excerpts.length === 0 || result.excerpts.length > MAX_CONTEXT_EXCERPTS) throw new Error('Invalid context excerpt count.');
  let bytes = 0, previousPosition = -1, foundAnchor = false;
  for (const excerpt of result.excerpts) {
    const source = excerpt.source;
    snippetAnchor(source);
    if (!Number.isSafeInteger(source.messagePosition) || source.messagePosition <= previousPosition || !excerpt.role) throw new Error('Invalid context message ordering or role.');
    previousPosition = source.messagePosition;
    const encoded = new TextEncoder().encode(excerpt.text);
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(encoded) !== excerpt.text) throw new Error('Context text contains a non-scalar Unicode value.');
    const size = encoded.length;
    if (size !== source.end - source.start) throw new Error('Context text does not match its UTF-8 source range.');
    bytes += size;
    if (source.messageId === anchor.messageId && source.start <= anchor.start && source.end >= anchor.end && source.messagePosition === result.anchor.messagePosition) {
      highlightUtf8(excerpt.text, [{ start: anchor.start - source.start, end: anchor.end - source.start }]);
      foundAnchor = true;
    }
  }
  if (!foundAnchor || bytes > before + after + anchor.end - anchor.start) throw new Error('Context anchor missing or byte budget exceeded.');
  const first = result.excerpts[0]!.source, last = result.excerpts.at(-1)!.source;
  for (const [cursor, source, boundary] of [[result.previous, first, first.start], [result.next, last, last.end]] as const) {
    if (cursor !== undefined && (cursor.messageId !== source.messageId || cursor.start !== boundary || cursor.end !== boundary)) throw new Error('Context continuation is not at the returned source boundary.');
  }
  if (before > 0 && after === 0 && result.previous !== undefined && sameSpan(result.previous, anchor)) throw new Error('Context continuation did not advance.');
  if (after > 0 && before === 0 && result.next !== undefined && sameSpan(result.next, anchor)) throw new Error('Context continuation did not advance.');
  return result;
}
