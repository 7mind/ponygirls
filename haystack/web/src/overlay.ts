import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

export interface Overlay {
  readonly open: boolean;
  readonly anchor: RefObject<HTMLDivElement | null>;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  toggle(): void;
  /** Opens from elsewhere on the page and moves focus to the trigger, so that Escape and Tab work as after a click on it. */
  show(): void;
  /** Closes; `restoreFocus` returns focus to the trigger (Escape, an activated item). */
  close(restoreFocus: boolean): void;
}

/** One anchored menu or popover: a pointer press or focus outside the anchor, Escape and navigation close it. */
export function useOverlay(): Overlay {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus && trigger.current !== null) trigger.current.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) => !(target instanceof Node) || anchor.current === null || !anchor.current.contains(target);
    const pointer = (event: PointerEvent) => { if (outside(event.target)) close(false); };
    const focus = (event: FocusEvent) => { if (event.target !== null && outside(event.target)) close(false); };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    const navigated = () => close(false);
    window.addEventListener("hashchange", navigated);
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("focusin", focus);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("hashchange", navigated);
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("keydown", key);
    };
  }, [open, close]);
  const show = useCallback(() => {
    if (trigger.current === null) throw new Error("Overlay.show requires its trigger in the document");
    setOpen(true);
    trigger.current.focus();
  }, []);
  return { open, anchor, trigger, toggle: () => setOpen((value) => !value), show, close };
}

const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/** Moves focus between the items of an open `role="menu"` with the arrow, Home and End keys. */
export function menuKeys(event: KeyboardEvent<HTMLElement>): void {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEMS)];
  const current = items.findIndex((item) => item === document.activeElement);
  const next = event.key === "ArrowDown" ? (current + 1) % items.length : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length :
    event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
  if (next === null || items.length === 0) return;
  event.preventDefault();
  items[next]!.focus();
}

/** Focuses the checked item of a menu that just opened, else its first item. */
export function focusMenu(menu: HTMLElement | null): void {
  if (menu === null) return;
  const target = menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.querySelector<HTMLElement>(MENU_ITEMS);
  if (target !== null) target.focus();
}
