import { closePopovers } from './Popover.tsx';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import './dialog.css';

const TopBar = createContext<HTMLDivElement | null>(null);
// Live snapshot chrome belongs in the modal header, but is owned by the pinned read.
export function DialogTopBar({ children }: { children: ReactNode }) {
  const target = useContext(TopBar);
  return target === null ? null : createPortal(children, target);
}

export function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId(), [topBar, setTopBar] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) throw new Error('Dialog was not mounted');
    const opener = document.activeElement, top = window.scrollY, left = window.scrollX;
    const body = document.body, previous = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.position = 'fixed'; body.style.top = `${-top}px`; body.style.left = `${-left}px`; body.style.width = '100%'; body.style.overflow = 'hidden';
    body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`;
    closePopovers();
    dialog.showModal();
    const initial = dialog.querySelector<HTMLButtonElement>('.dialog-close');
    if (initial !== null) initial.focus({ preventScroll: true });
    return () => {
      dialog.close();
      Object.assign(body.style, previous);
      window.scrollTo({ top, left, behavior: 'instant' });
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog className="conversation-dialog" aria-labelledby={titleId} ref={ref} tabIndex={-1} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]')].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && element.closest('[hidden],[inert]') === null);
    const first = focusable[0], last = focusable.at(-1);
    if (first === undefined || last === undefined) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
  }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  }}><header className="dialog-heading"><h2 id={titleId} hidden>{title}</h2><div className="dialog-top-bar" ref={setTopBar}/><button className="dialog-close" onClick={close} aria-label="Close conversation" title="Close conversation">×</button></header><div className="dialog-content"><TopBar.Provider value={topBar}>{children}</TopBar.Provider></div></dialog>;
}
