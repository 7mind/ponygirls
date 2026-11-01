import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './mutation-toast.css';

const NOTIFICATION_DURATION_MS = 6000;

function notificationHost() { return document.querySelector<HTMLDialogElement>('dialog:modal') ?? document.body; }

export function MutationToast({ message, dismiss }: { message: string; dismiss(): void }) {
  const [host, setHost] = useState(notificationHost);
  useLayoutEffect(() => {
    // A body portal is inert behind a native modal. Follow its lifecycle without
    // opening another top-layer popup or dismissing the user's table/help menu.
    const update = () => setHost(notificationHost());
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    update();
    return () => observer.disconnect();
  }, []);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const remaining = useRef(NOTIFICATION_DURATION_MS), onDismiss = useRef(dismiss);
  onDismiss.current = dismiss;
  const paused = hovered || focused;
  useEffect(() => {
    if (paused) return;
    const started = performance.now(), timer = window.setTimeout(() => onDismiss.current(), remaining.current);
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (performance.now() - started)); };
  }, [paused]);
  return createPortal(<section className="mutation-toast" aria-label="Notifications" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <p role="status" aria-live="polite" aria-atomic="true">{message}</p>
    <button type="button" aria-label="Dismiss notification" onClick={dismiss}><span aria-hidden="true">×</span></button>
  </section>, host);
}
