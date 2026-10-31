import { ArchiveMatchKind, ArchiveTextScope, Span, type ArchiveSearchResult, type ContentView, type ContextExcerpt, type MessageContextResult } from './api.ts';
import { highlightUtf8, type TextPart } from './highlight.ts';
import { requireContentView, sameContentView } from './source-view.ts';
export const SEARCH_PAGE_SIZE = 10;
export const SNIPPET_BYTES = 512;
export const CONTEXT_BYTES = 2048;
const MAX_CONTEXT_EXCERPTS = 9;
export interface SearchSourceFailure { code: string | null; message: string }
export function sourceFailureAffectsView(failed: ContentView, selected: ContentView, code: string | null): boolean {
  return sameContentView(failed, selected) || (code !== null && ['forbidden', 'not-found', 'unauthorized', 'authorization-changed'].includes(code));
}
const MAX_REPRESENTATIVE_MATCHES = 2;
const MAX_ARCHIVE_TOTAL = 9_223_372_036_854_775_807n;
function validateView(view: ContentView): void {
  if (!Number.isSafeInteger(view.revision) || view.revision <= 0 || (view.generationId !== undefined && (typeof view.generationId !== 'string' || view.generationId.length === 0))) throw new Error('Invalid archive search source view.');
}
export function validateArchiveSearchPage(result: ArchiveSearchResult, cursor: string | undefined): ArchiveSearchResult {
  const page = result.page;
  if (typeof page.total !== 'bigint' || page.total < 0n || page.total > MAX_ARCHIVE_TOTAL || page.rows.length > SEARCH_PAGE_SIZE || BigInt(page.rows.length) > page.total) throw new Error('Invalid archive search page count.');
  if (typeof page.relevanceOrdered !== 'boolean' || (page.nextCursor !== undefined && (typeof page.nextCursor !== 'string' || page.nextCursor.length === 0 || page.nextCursor === cursor || page.rows.length === 0))) throw new Error('Invalid archive search ordering or cursor.');
  if (page.textScope === ArchiveTextScope.ExactLexical) {
    if (page.annChunkLimitPerOperand !== undefined) throw new Error('Exact archive search unexpectedly returned an ANN limit.');
  } else if (page.textScope !== ArchiveTextScope.BoundedCandidateSets || !Number.isSafeInteger(page.annChunkLimitPerOperand) || page.annChunkLimitPerOperand! <= 0) throw new Error('Invalid archive search candidate scope.');
  if (result.evidence.length !== page.rows.length) throw new Error('Archive search evidence does not cover its result page.');
  const ids = new Set<string>();
  for (const [index, row] of page.rows.entries()) {
    const evidence = result.evidence[index]!;
    validateView(row.head.view);
    if (!row.head.id || ids.has(row.head.id) || row.head.view.revision !== row.head.revision || row.head.view.generationId !== undefined || evidence.sessionId !== row.head.id) throw new Error('Invalid or duplicate archive search source identity.');
    ids.add(row.head.id);
    if (row.publishedView !== undefined) {
      validateView(row.publishedView);
      if (row.publishedView.generationId === undefined || row.publishedView.revision > row.head.revision || row.head.indexedRevision !== row.publishedView.revision) throw new Error('Invalid archive search published view.');
    }
    if (row.matchedView !== undefined) {
      validateView(row.matchedView);
      if (!sameContentView(row.matchedView, row.head.view) && (row.publishedView === undefined || !sameContentView(row.matchedView, row.publishedView))) throw new Error('Invalid archive search representative view.');
    }
    if (evidence.matches.length > MAX_REPRESENTATIVE_MATCHES) throw new Error('Archive search returned too many representative matches.');
    for (const match of evidence.matches) {
      validateView(match.view); snippetAnchor(match.span);
      if (typeof match.operand !== 'string' || match.operand.length === 0 || (match.summary !== undefined && typeof match.summary !== 'string')) throw new Error('Invalid archive search operand or annotation.');
      if (match.kind === ArchiveMatchKind.Literal) {
        if (!sameContentView(match.view, row.head.view) || match.summary !== undefined) throw new Error('Literal archive search evidence must retain its HEAD source pin.');
      } else if (match.kind !== ArchiveMatchKind.Semantic || row.publishedView === undefined || !sameContentView(match.view, row.publishedView)) throw new Error('Semantic archive search evidence must retain its published source pin.');
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
