import { ContentView } from './api.ts';
import { RouteParams, formatRoute, sessionRoute } from './router.ts';

// The link from a Search hit to the session route carries the complete source pin: the revision and, for a published
// (annotated) view, its generation. A link without `gen` pins the archive-only view of that revision, so a published and an
// archive-only source of the same revision stay distinguishable and the session can fail closed when the generation retires.
const REVISION_PARAM = 'rev', GENERATION_PARAM = 'gen', MESSAGE_PARAM = 'at', FIND_PARAM = 'find';
const REVISION = /^[1-9][0-9]*$/;
export interface SessionLanding { readonly messageId: string; readonly find: string }
export function sessionLink(sessionId: string, view: ContentView, landing: SessionLanding | undefined): string {
  const entries: [string, string][] = [[REVISION_PARAM, String(view.revision)]];
  if (view.generationId !== undefined) entries.push([GENERATION_PARAM, view.generationId]);
  if (landing !== undefined) entries.push([MESSAGE_PARAM, landing.messageId], [FIND_PARAM, landing.find]);
  return formatRoute({ ...sessionRoute(sessionId), params: new RouteParams(entries) });
}
/** The pin a session link names, null when it names none; a malformed pin is an error, never a default. */
export function sessionPin(params: RouteParams): ContentView | null {
  const revision = params.get(REVISION_PARAM), generation = params.get(GENERATION_PARAM);
  if (revision === null) {
    if (generation !== null) throw new Error('A session link names a generation without a revision.');
    return null;
  }
  if (!REVISION.test(revision) || !Number.isSafeInteger(Number(revision))) throw new Error('A session link names an invalid revision.');
  if (generation === '') throw new Error('A session link names an empty generation.');
  return new ContentView(Number(revision), generation ?? undefined);
}
export function sessionLanding(params: RouteParams): SessionLanding | null {
  const messageId = params.get(MESSAGE_PARAM), find = params.get(FIND_PARAM);
  if (messageId === null || find === null) return null;
  return { messageId, find };
}
