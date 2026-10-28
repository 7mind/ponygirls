import type { ContentView, SessionMessageSearchResult } from './api.ts';
import { requireContentView } from './source-view.ts';
export const FIND_PAGE_SIZE = 40;
export const FIND_LITERAL_MAX_BYTES = 2048;
// Owned by App per connection, not a process global. A remounted finder cannot
// overlap a still-unsettled read; there is deliberately no queue or replay.
export class SessionFindReadGate {
  private busy = false;
  private readonly listeners = new Set<() => void>();
  readonly getSnapshot = () => this.busy;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  acquire(): (() => void) | null {
    if (this.busy) return null;
    this.busy = true; for (const listener of this.listeners) listener();
    let released = false;
    return () => { if (released) return; released = true; this.busy = false; for (const listener of this.listeners) listener(); };
  }
}
function scalarBytes(value: string): number {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Find requires scalar Unicode.');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('Find requires scalar Unicode.');
  }
  return new TextEncoder().encode(value).length;
}
function locatorText(value: string): boolean { return value.length > 0 && !value.includes('\u0000') && scalarBytes(value) > 0; }
export function validateFindLiteral(literal: string): void {
  if (literal.length === 0 || scalarBytes(literal) > FIND_LITERAL_MAX_BYTES) throw new Error(`Enter a nonempty literal of at most ${FIND_LITERAL_MAX_BYTES} UTF-8 bytes. Spaces are preserved.`);
}
export function validateFindPage(result: SessionMessageSearchResult, view: ContentView, sentCursor: string | undefined, afterPosition: number, seenIds: ReadonlySet<string>, seenCursors: ReadonlySet<string>): SessionMessageSearchResult {
  requireContentView(view, result.view);
  if (result.hits.length > FIND_PAGE_SIZE) throw new Error('Find returned an oversized locator page.');
  const ids = new Set<string>(); let previous = afterPosition;
  for (const hit of result.hits) {
    if (typeof hit.messageId !== 'string' || !locatorText(hit.messageId) || ids.has(hit.messageId) || seenIds.has(hit.messageId) || !Number.isSafeInteger(hit.position) || hit.position < 0 || hit.position <= previous) throw new Error('Find returned invalid, duplicate or unordered message locators.');
    ids.add(hit.messageId); previous = hit.position;
  }
  const cursor = result.nextCursor;
  if (cursor !== undefined && (typeof cursor !== 'string' || !locatorText(cursor) || cursor === sentCursor || seenCursors.has(cursor) || result.hits.length === 0)) throw new Error('Find returned an invalid or nonprogressing cursor.');
  return result;
}
