import { PassageFormat, type ContentView, type PassagesResult, type PassageSpansResult } from './api.ts';
import { requireContentView } from './source-view.ts';
export const PASSAGE_PAGE_SIZE = 40;
function point(position: number, offset: number) { if (!Number.isInteger(position) || position < 0 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid passage source point.'); }
export function validatePassages(result: PassagesResult, view: ContentView, offset: number): PassagesResult {
  requireContentView(view, result.view);
  if (!Object.values(PassageFormat).includes(result.format) || result.total < 0n || result.offset !== offset || result.passages.length > PASSAGE_PAGE_SIZE || BigInt(offset + result.passages.length) > result.total) throw new Error('Unverified passage metadata format or page.');
  if (result.format !== PassageFormat.ContiguousProblems && result.passages.length !== 0) throw new Error('Unexpected logical passages in a non-contiguous annotation format.');
  for (const passage of result.passages) {
    point(passage.start.messagePosition, passage.start.byteOffset); point(passage.end.messagePosition, passage.end.byteOffset);
    if (passage.start.messagePosition > passage.end.messagePosition || (passage.start.messagePosition === passage.end.messagePosition && passage.start.byteOffset >= passage.end.byteOffset) || passage.sourceBytes <= 0n || passage.spanCount <= 0n || passage.pieceCount <= 0n) throw new Error('Invalid logical passage extent.');
  }
  return result;
}
export function validatePassageSpans(result: PassageSpansResult, view: ContentView, passageId: string, offset: number): PassageSpansResult {
  requireContentView(view, result.view);
  if (result.passageId !== passageId || result.offset !== offset || result.total < 0n || result.spans.length > PASSAGE_PAGE_SIZE || BigInt(offset + result.spans.length) > result.total) throw new Error('Passage span identity or page mismatch.');
  for (const span of result.spans) { point(span.messagePosition, span.start); point(span.messagePosition, span.end); if (span.start >= span.end) throw new Error('Invalid passage source span.'); }
  return result;
}
