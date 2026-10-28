import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './popover.css';

export function closePopovers() {
  for (const panel of document.querySelectorAll<HTMLElement>('.transient-popover:popover-open')) panel.hidePopover();
}

// Focus entering another control dismisses transient help, not persistent disclosures.
// Scoped to the application rather than a document-wide focus/click listener.
export function dismissPopoverOnExternalFocus(event: { target: EventTarget | null }) {
  if (!(event.target instanceof Element)) return;
  const target = event.target;
  for (const panel of document.querySelectorAll<HTMLElement>('.transient-popover:popover-open')) {
    if (!panel.contains(target) && !target.closest(`[popovertarget="${panel.id}"]`)) panel.hidePopover();
  }
}

export function Popover({ label, children, className, panelClassName, ariaLabel, describedBy, dataState }: {
  label: ReactNode; children: ReactNode; className?: string; panelClassName?: string; ariaLabel?: string; describedBy?: string | undefined; dataState?: string;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const button = trigger.current!, element = panel.current!;
    let frame = 0;
    function place() {
      frame = 0;
      if (!element.matches(':popover-open')) return;
      const rect = button.getBoundingClientRect();
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
      // Every clipping ancestor matters: a sticky Actions cell can remain visible
      // while its row scrolls out of the actual table viewport.
      for (let ancestor = button.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left + ancestor.clientLeft); right = Math.min(right, clip.left + ancestor.clientLeft + ancestor.clientWidth); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top + ancestor.clientTop); bottom = Math.min(bottom, clip.top + ancestor.clientTop + ancestor.clientHeight); }
      }
      if (rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right) { element.hidePopover(); return; }
      if (innerWidth <= 640) { element.style.removeProperty('left'); element.style.removeProperty('top'); element.style.removeProperty('max-height'); return; }
      const margin = 8, gap = 8, below = innerHeight - rect.bottom - gap - margin, above = rect.top - gap - margin;
      // Read intrinsic overflow without expanding the live scroll container:
      // temporarily removing its constraint can clamp scrollTop back to zero.
      const desired = element.scrollHeight + element.offsetHeight - element.clientHeight;
      const flip = desired > below && above > below;
      const available = Math.max(0, flip ? above : below);
      element.style.maxHeight = `${available}px`;
      const size = element.getBoundingClientRect();
      element.style.left = `${Math.max(margin, Math.min(rect.right - size.width, innerWidth - size.width - margin))}px`;
      element.style.top = `${Math.max(margin, flip ? rect.top - gap - size.height : rect.bottom + gap)}px`;
    }
    function schedule() { if (frame === 0) frame = requestAnimationFrame(place); }
    const observer = new ResizeObserver(schedule);
    observer.observe(button); observer.observe(element);
    for (let ancestor = button.parentElement; ancestor !== null; ancestor = ancestor.parentElement) observer.observe(ancestor);
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    place();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [open]);
  return <div className={className} data-state={dataState}><button type="button" ref={trigger} popoverTarget={id} aria-expanded={open} aria-controls={id} aria-label={ariaLabel} aria-describedby={describedBy}>{label}</button><div id={id} ref={panel} popover="auto" className={panelClassName === undefined ? 'transient-popover' : `transient-popover ${panelClassName}`} onToggle={event => setOpen(event.newState === 'open')}><button type="button" className="popover-close" popoverTarget={id} popoverTargetAction="hide">Close</button>{children}</div></div>;
}
