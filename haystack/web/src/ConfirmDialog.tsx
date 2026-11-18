import { useEffect, useId, useRef, type ReactNode } from "react";
import { UiIcon } from "./Masthead";

/**
 * In-app confirmation (spec §1.8, §8 item 7): a modal `dialog` with Cancel focused by default and a named confirming
 * button. Escape, the close button and Cancel call `onCancel`; focus returns to the element that opened it.
 */
export function ConfirmDialog({ title, confirmLabel, danger, busy, onConfirm, onCancel, children }: {
  title: string;
  confirmLabel: string;
  danger: boolean;
  /** The confirmed action is running: the buttons are disabled until the owner closes the dialog. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element === null) throw new Error("Confirmation dialog was not mounted");
    const opener = document.activeElement;
    element.showModal();
    cancel.current!.focus();
    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="dialog-head"><h2 id={titleId}>{title}</h2>
      <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" disabled={busy} onClick={onCancel}><UiIcon name="x" /></button>
    </div>
    <div className="dialog-body">{children}</div>
    <div className="dialog-foot">
      <button type="button" ref={cancel} className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className={danger ? "btn btn-danger" : "btn btn-primary"} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>;
}
