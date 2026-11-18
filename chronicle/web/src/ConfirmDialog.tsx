import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Glyph } from './Glyph.tsx';

/**
 * In-app confirmation (spec §1.8, §8 item 7): a modal `dialog` with Cancel focused and a named confirming button.
 * Escape, the close button and Cancel call `onCancel`; a press on the backdrop does nothing; only the confirming
 * button calls `onConfirm`. Focus returns to the element that opened it.
 */
export function ConfirmDialog({ title, wide, confirmLabel, danger, confirmDisabled, onConfirm, onCancel, children }: {
  title: string; /** A form-like confirmation (wider, with a close button). */ wide: boolean; confirmLabel: string; danger: boolean; confirmDisabled: boolean; onConfirm: () => void; onCancel: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), titleId = useId();
  useEffect(() => {
    const element = dialog.current, initial = cancel.current;
    if (element === null || initial === null) throw new Error('Confirmation dialog was not mounted');
    const opener = document.activeElement;
    element.showModal();
    initial.focus();
    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={wide ? 'dialog dialog-wide' : 'dialog'} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onCancel(); }}>
    <div className="dialog-head"><h2 id={titleId}>{title}</h2>{wide && <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onCancel}><Glyph name="x"/></button>}</div>
    <div className="dialog-body">{children}</div>
    <div className="dialog-foot">
      <button type="button" ref={cancel} className="btn" onClick={onCancel}>Cancel</button>
      <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>;
}
