import type { ContentView } from './api.ts';

// Source-authority notices between the views that read a pinned source (Search excerpts, the opened session). A view that
// receives a denial or retirement of a pinned source reports it; every other view that retains data of that source decides
// for itself with `sourceFailureAffectsView` / `sourceDenialAffectsResults` (search-source.ts). Document events, like the
// shell's `account:*` events, so that no view needs a reference to another.
export const SOURCE_UNAVAILABLE_EVENT = 'chronicle:source-unavailable';
export type SourceUnavailableOrigin = 'search' | 'session';
export interface SourcePin { readonly revision: number; readonly generationId: string | null }
export interface SourceUnavailable { readonly origin: SourceUnavailableOrigin; readonly sessionId: string; readonly view: SourcePin; readonly code: string | null; readonly message: string }
export function sourcePin(view: ContentView): SourcePin { return { revision: view.revision, generationId: view.generationId ?? null }; }
export function reportSourceUnavailable(target: EventTarget, detail: SourceUnavailable): void {
  target.dispatchEvent(new CustomEvent(SOURCE_UNAVAILABLE_EVENT, { detail }));
}
function readDetail(event: Event): SourceUnavailable {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null;
  if (detail === null || typeof detail !== 'object') throw new Error('A source-unavailable notice carries no detail');
  const { origin, sessionId, view, code, message } = detail as Record<string, unknown>;
  const pin = view as Record<string, unknown> | null;
  if ((origin !== 'search' && origin !== 'session') || typeof sessionId !== 'string' || sessionId.length === 0 || typeof message !== 'string' || (code !== null && typeof code !== 'string')
    || pin === null || typeof pin !== 'object' || !Number.isSafeInteger(pin.revision) || (pin.generationId !== null && typeof pin.generationId !== 'string')) throw new Error('A source-unavailable notice is malformed');
  return { origin, sessionId, view: { revision: pin.revision as number, generationId: pin.generationId as string | null }, code, message };
}
export function listenSourceUnavailable(target: EventTarget, listener: (detail: SourceUnavailable) => void): () => void {
  const handler = (event: Event) => listener(readDetail(event));
  target.addEventListener(SOURCE_UNAVAILABLE_EVENT, handler);
  return () => target.removeEventListener(SOURCE_UNAVAILABLE_EVENT, handler);
}
