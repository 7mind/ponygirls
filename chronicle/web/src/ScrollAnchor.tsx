import { Component, createRef } from 'react';
import type { ReactNode } from 'react';
interface Anchor { element: HTMLElement; top: number }
interface ContainerSnapshot { container: HTMLElement; scroller: HTMLElement | null; anchors: Anchor[] }
type ScrollSnapshot = ContainerSnapshot[];
function scrollRoot(element: HTMLElement): HTMLElement | null {
  let parent: HTMLElement | null = element;
  while (parent !== null && parent !== document.body) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
    parent = parent.parentElement;
  }
  return null;
}
export class ScrollAnchor extends Component<{ children: ReactNode }, Record<never, never>, ScrollSnapshot> {
  private root = createRef<HTMLDivElement>();
  getSnapshotBeforeUpdate(): ScrollSnapshot {
    if (this.root.current === null) return [];
    return [...this.root.current.querySelectorAll<HTMLElement>('[data-scroll-container]')].map(container => {
      const scroller = scrollRoot(container), rect = scroller === null ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      const anchors = [...container.querySelectorAll<HTMLElement>('[data-scroll-anchor]')].flatMap(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.height > 0 && bounds.bottom > Math.max(0, rect.top) && bounds.top < Math.min(window.innerHeight, rect.bottom) ? [{ element, top: bounds.top }] : [];
      });
      return { container, scroller, anchors };
    });
  }
  componentDidUpdate(_props: { children: ReactNode }, _state: Record<never, never>, snapshot: ScrollSnapshot) {
    for (const { container, scroller, anchors } of snapshot) {
      const anchor = anchors.find(item => item.element.isConnected && container.contains(item.element));
      if (anchor === undefined) continue;
      const delta = anchor.element.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) < .5) continue;
      if (scroller !== null) scroller.scrollTop += delta;
      else if (document.body.style.position !== 'fixed') window.scrollBy({ top: delta, behavior: 'instant' });
    }
  }
  render() { return <div className="scroll-preserver" ref={this.root}>{this.props.children}</div>; }
}
