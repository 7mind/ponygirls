import type { ContentView } from './api.ts';
export function sameContentView(expected: ContentView, actual: ContentView): boolean {
  return expected.revision === actual.revision && expected.generationId === actual.generationId;
}
export function contentViewKey(view: ContentView | undefined): string {
  return view === undefined ? 'choose' : `${view.revision}:${view.generationId ?? 'archive'}`;
}
export function requireContentView(expected: ContentView, actual: ContentView): void {
  if (!sameContentView(expected, actual)) throw new Error('Source revision or annotation generation changed unexpectedly; reload the source snapshot.');
}
