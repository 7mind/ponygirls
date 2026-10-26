import { useEffect, useRef } from 'react';
function scrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent !== null && parent !== document.body) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
    parent = parent.parentElement;
  }
  return null;
}
export function InfiniteTrigger({ enabled, loading, load, label }: { enabled: boolean; loading: boolean; load: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null), loader = useRef(load); loader.current = load;
  useEffect(() => {
    const element = ref.current;
    if (element === null || !enabled || loading) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) loader.current(); }, { root: scrollParent(element), rootMargin: '150px 0px' });
    observer.observe(element); return () => observer.disconnect();
  }, [enabled, loading]);
  return <div className="infinite-trigger" ref={ref} role="status" aria-live="polite">{loading ? label : enabled ? 'Scroll to load more' : null}</div>;
}
