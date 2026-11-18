import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
// Distance before the end of the scroller at which the next batch is requested.
const PRELOAD_MARGIN = '150px 0px';
function scrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent !== null && parent !== document.body) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
    parent = parent.parentElement;
  }
  return null;
}
/**
 * Calls `load` whenever the returned element comes within PRELOAD_MARGIN of its scroller's viewport (the document when no
 * ancestor scrolls), while `enabled` and not `loading`; observing again after each load keeps loading until the list fills.
 */
export function useInfiniteSentinel<E extends HTMLElement>(enabled: boolean, loading: boolean, load: () => void): RefObject<E | null> {
  const ref = useRef<E>(null), loader = useRef(load); loader.current = load;
  useEffect(() => {
    const element = ref.current;
    if (element === null || !enabled || loading) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) loader.current(); }, { root: scrollParent(element), rootMargin: PRELOAD_MARGIN });
    observer.observe(element); return () => observer.disconnect();
  }, [enabled, loading]);
  return ref;
}
export function InfiniteTrigger({ enabled, loading, load, label }: { enabled: boolean; loading: boolean; load: () => void; label: string }) {
  const ref = useInfiniteSentinel<HTMLDivElement>(enabled, loading, load);
  return <div className="infinite-trigger" ref={ref} role="status" aria-live="polite">{loading ? label : enabled ? 'Scroll to load more' : null}</div>;
}
