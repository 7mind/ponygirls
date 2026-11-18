import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
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

const MENU_ITEM = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';
export type AnchoredPanel = 'menu' | 'dialog';
/**
 * A trigger with a panel anchored below it (shared `.anchor` + `.menu`/`.popover`), not in the top layer.
 * Closes on Escape (focus returns to the trigger), on a pointer press or focus outside, and after a menu item
 * was chosen. A `menu` panel is labelled by its trigger and supports the arrow, Home and End keys.
 */
export function Anchored({ className, buttonClassName, buttonState, label, ariaLabel, describedBy, panel, panelClassName, panelLabel, children }: {
  className: string; buttonClassName: string; buttonState: string | undefined; label: ReactNode; ariaLabel: string | undefined; describedBy: string | undefined;
  panel: AnchoredPanel; panelClassName: string; panelLabel: string | undefined; children: ReactNode;
}) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panelRef = useRef<HTMLDivElement>(null), triggerId = useId(), panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !anchor.current!.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    if (panel === 'menu') panelRef.current!.querySelector<HTMLElement>(MENU_ITEM)?.focus();
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open, panel]);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current!.focus(); return; }
    if (panel !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...panelRef.current!.querySelectorAll<HTMLElement>(MENU_ITEM)], at = items.indexOf(document.activeElement as HTMLElement);
    if (items.length === 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    const target = items[next];
    if (target === undefined) throw new Error('Menu item index out of range');
    target.focus();
  }
  function chosen(event: MouseEvent<HTMLDivElement>) { if (event.target instanceof Element && event.target.closest(MENU_ITEM) !== null) setOpen(false); }
  return <div className={`anchor ${className}`} ref={anchor} onKeyDown={keyDown} onBlur={event => { if (event.relatedTarget instanceof Node && !anchor.current!.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" id={triggerId} ref={trigger} className={buttonClassName} data-state={buttonState} aria-label={ariaLabel} aria-describedby={describedBy} aria-haspopup={panel} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>{label}</button>
    <div id={panelId} ref={panelRef} className={panelClassName} role={panel} aria-labelledby={panelLabel === undefined ? triggerId : undefined} aria-label={panelLabel} hidden={!open} onClick={chosen}>{children}</div>
  </div>;
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
