import type { ContentView } from './api.ts';
import { sameContentView } from './source-view.ts';

/*
 * Source-authority contract between the views that read a pinned source (Search excerpts, the opened session).
 * A view reports a source denial or an unavailable indexed view; other views retaining data of that source decide for
 * themselves with `sourceFailureAffectsView`. Document events (like the shell's `account:*` events) let the views do this
 * without holding references to one another. Search implements both halves (Search.tsx); the shell's session host (App.tsx)
 * implements them for the routed session page (Conversation.tsx SessionPage).
 *
 * A SESSION VIEW MUST
 *  1. Publish, whenever a read of its source fails with an authority or indexed view failure — get session, locate
 *     message, passages, message pages, nested Find (`SearchSessionMessages`); a related session is a session page of its
 *     own (`isIndexedViewUnavailable` or `isAuthorityDenial`):
 *       reportSourceUnavailable(document, { origin: 'session', sessionId, view: sourcePin(pinOfTheFailedRead), code: failure.code, message: failure.message })
 *     `view` is the pin the FAILED read used (an archive-only HEAD view has `generationId: null`; null when the read asked
 *     for the session's default view, before any pin was chosen), `sessionId` the session that read addressed, `code` the
 *     service code (null only for a client-side validation failure). Publish only for the current read: a reply of an
 *     abandoned or superseded read must not publish.
 *  2. React to notices of `origin: 'search'` for its own session: when `sourceFailureAffectsView(failedView, itsPin, code)`
 *     holds, clear the displayed source (messages, passages, Find hits) and show the failure, without a fallback read. A
 *     view-local failure of another pin (same revision with another generation, another revision) must not clear it; an
 *     authority code clears every pin of that session. Ignore notices of other sessions and of `origin: 'session'`.
 * SEARCH publishes the same notice (origin 'search') for every failed excerpt read and, on a notice of origin 'session',
 * clears its results when `sourceDenialAffectsResults` holds (same session displayed, and an authority code or a retained pin
 * equal to the failed view), keeping the draft and re-reading nothing.
 */
const AUTHORITY_DENIALS = ['forbidden', 'not-found', 'unauthorized', 'authorization-changed'];
export function isAuthorityDenial(code: string | null): boolean { return code !== null && AUTHORITY_DENIALS.includes(code); }
export type IndexedViewUnavailable = 'indexed-view-retired' | 'indexed-view-disabled';
export function isIndexedViewUnavailable(code: string | null): code is IndexedViewUnavailable {
  return code === 'indexed-view-retired' || code === 'indexed-view-disabled';
}
/**
 * Authority denials concern the whole source of a session; every other failure concerns only the pin that failed (a failure
 * of the default view, `failed` null, then concerns no known pin).
 */
export function sourceFailureAffectsView(failed: ContentView | null, selected: ContentView, code: string | null): boolean {
  return (failed !== null && sameContentView(failed, selected)) || isAuthorityDenial(code);
}
export const SOURCE_UNAVAILABLE_EVENT = 'chronicle:source-unavailable';
export type SourceUnavailableOrigin = 'search' | 'session';
export interface SourcePin { readonly revision: number; readonly generationId: string | null }
export interface SourceUnavailable { readonly origin: SourceUnavailableOrigin; readonly sessionId: string; readonly view: SourcePin | null; readonly code: string | null; readonly message: string }
export function sourcePin(view: ContentView): SourcePin { return { revision: view.revision, generationId: view.generationId ?? null }; }
export function reportSourceUnavailable(target: EventTarget, detail: SourceUnavailable): void {
  target.dispatchEvent(new CustomEvent(SOURCE_UNAVAILABLE_EVENT, { detail }));
}
export function readSourceUnavailable(event: Event): SourceUnavailable {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null;
  if (detail === null || typeof detail !== 'object') throw new Error('A source-unavailable notice carries no detail');
  const { origin, sessionId, view, code, message } = detail as Record<string, unknown>;
  const pin = view as Record<string, unknown> | null;
  if ((origin !== 'search' && origin !== 'session') || typeof sessionId !== 'string' || sessionId.length === 0 || typeof message !== 'string' || (code !== null && typeof code !== 'string')
    || (pin !== null && (typeof pin !== 'object' || !Number.isSafeInteger(pin.revision) || (pin.generationId !== null && typeof pin.generationId !== 'string')))) throw new Error('A source-unavailable notice is malformed');
  return { origin, sessionId, view: pin === null ? null : { revision: pin.revision as number, generationId: pin.generationId as string | null }, code, message };
}
export function listenSourceUnavailable(target: EventTarget, listener: (detail: SourceUnavailable) => void): () => void {
  const handler = (event: Event) => listener(readSourceUnavailable(event));
  target.addEventListener(SOURCE_UNAVAILABLE_EVENT, handler);
  return () => target.removeEventListener(SOURCE_UNAVAILABLE_EVENT, handler);
}
