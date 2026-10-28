import { closePopovers } from './Popover.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ExpressionHintQuery, Operation_ExpressionHints, Result_ExpressionHints, type ExpressionHintsResult, type ExpressionHintTarget } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import type { ManagerStats } from './transport/types.ts';
import { acceptExpressionHint, scalarBoundary } from './completion.ts';
export interface CompletionContext { connection: ChronicleConnection; stats: ManagerStats; owner: string; target: ExpressionHintTarget }
interface Props { context: CompletionContext; inputRef: RefObject<HTMLInputElement | null>; id: string; label: string; placeholder: string; value: string; change(value: string): void; clear(): void; canClear: boolean; maxLength: number; compositionChange?: (composing: boolean) => void }
const HINT_DEBOUNCE_MS = 180, HINT_LIMIT = 12;
export function ExpressionInput({ context, inputRef, id, label, placeholder, value, change, clear, canClear, maxLength, compositionChange }: Props) {
  const { connection, stats, owner, target } = context, listId = useId();
  const [caret, setCaret] = useState(0), [focused, setFocused] = useState(false), [composing, setComposing] = useState(false), [choice, setChoice] = useState(0);
  const [result, setResult] = useState<{ stamp: string; data: ExpressionHintsResult } | null>(null), [error, setError] = useState<string | null>(null), [epoch, setEpoch] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null), busy = useRef(false), serial = useRef(0), pendingCaret = useRef<number | null>(null);
  const targetKey = JSON.stringify(target.toJSON()), stamp = JSON.stringify([owner, stats.generation, stats.activeId, epoch, targetKey, value, caret, focused, composing]);
  const current = useRef(stamp); current.current = stamp;
  const pump = useRef<() => void>(() => {}), ready = useRef(false);
  useEffect(() => connection.onInvalidate(() => { serial.current++; ready.current = false; setResult(null); setError(null); setEpoch(n => n + 1); }), [connection]);
  useEffect(() => {
    let mounted = true;
    const request = ++serial.current; ready.current = false; setResult(null); setError(null); setChoice(0);
    const eligible = focused && !composing && stats.activeId !== null && scalarBoundary(value, caret);
    pump.current = () => {
      if (!mounted || !eligible || busy.current || !ready.current || current.current !== stamp) return;
      busy.current = true; ready.current = false;
      void read(connection, new Operation_ExpressionHints(new ExpressionHintQuery(target, value, caret, HINT_LIMIT)), reply => reply instanceof Result_ExpressionHints ? reply.result : null).then(data => {
        if (mounted && serial.current === request && current.current === stamp) {
          if (data.hints.length > HINT_LIMIT || data.queryHash.length === 0 || data.observedAt.length === 0) throw new Error('Invalid completion response.');
          for (const hint of data.hints) acceptExpressionHint(value, data, hint);
          setResult({ stamp, data });
        }
      }).catch((cause: unknown) => { if (mounted && serial.current === request && current.current === stamp) setError(cause instanceof Error ? cause.message : 'Completions unavailable'); }).finally(() => { busy.current = false; pump.current(); });
    };
    const timer = window.setTimeout(() => { ready.current = true; pump.current(); }, HINT_DEBOUNCE_MS);
    return () => { mounted = false; window.clearTimeout(timer); };
  }, [connection, stamp]);
  useLayoutEffect(() => { if (inputRef.current === null) return; if (pendingCaret.current !== null) { inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current); pendingCaret.current = null; } const input = inputRef.current; setCaret(input.selectionStart === input.selectionEnd && input.selectionStart !== null ? input.selectionStart : -1); }, [value, inputRef]);
  const hints = result !== null && result.stamp === stamp && dismissed !== stamp ? result.data : null;
  const open = hints !== null && hints.hints.length > 0;
  function selection(input: HTMLInputElement) { const start = input.selectionStart; setCaret(start !== null && start === input.selectionEnd ? start : -1); }
  function accept(index: number) {
    if (hints === null) return;
    const hint = hints.hints[index]; if (hint === undefined) return;
    const next = acceptExpressionHint(value, hints, hint); pendingCaret.current = next.caret; if (next.expression === value && inputRef.current !== null) { inputRef.current.setSelectionRange(next.caret, next.caret); setCaret(next.caret); pendingCaret.current = null; } setResult(null); setDismissed(stamp); change(next.expression);
  }
  function composition(value: boolean) { setComposing(value); if (compositionChange !== undefined) compositionChange(value); }
  function reset() { composition(false); setResult(null); setError(null); setDismissed(stamp); pendingCaret.current = null; clear(); if (inputRef.current !== null) { inputRef.current.focus({ preventScroll: true }); inputRef.current.setSelectionRange(0, 0); setCaret(0); } }
  return <div className="expression-composer"><input id={id} ref={inputRef} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open ? `${listId}-${choice}` : undefined} autoComplete="off" spellCheck={false} maxLength={maxLength} value={value} placeholder={placeholder}
    onFocus={event => { closePopovers(); setFocused(true); selection(event.currentTarget); }} onBlur={() => { setFocused(false); setResult(null); }} onChange={event => { setDismissed(null); change(event.target.value); selection(event.currentTarget); }} onSelect={event => selection(event.currentTarget)}
    onCompositionStart={() => { composition(true); setResult(null); }} onCompositionEnd={event => { composition(false); selection(event.currentTarget); }}
    onKeyDown={event => {
      if (composing || event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setDismissed(stamp); }
      else if (event.key === 'Escape' && canClear) { event.preventDefault(); event.stopPropagation(); reset(); }
      else if (event.key === 'Tab') setDismissed(stamp);
      else if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setChoice(index => (index + (event.key === 'ArrowDown' ? 1 : hints.hints.length - 1)) % hints.hints.length); }
      else if (open && event.key === 'Enter') { event.preventDefault(); accept(choice); }
    }}/><button type="button" className="expression-clear" aria-label={`Clear ${label}`} title="Clear search · Escape (after closing suggestions)" aria-keyshortcuts="Escape" disabled={!canClear} onClick={reset}>×</button>
    {open && <div className="expression-hints" id={listId} role="listbox" aria-label="Expression suggestions">{hints.hints.map((hint, index) => <div role="option" id={`${listId}-${index}`} key={`${index}:${hint.insertText}`} aria-selected={index === choice} onMouseDown={event => { event.preventDefault(); accept(index); }}><span>{hint.label}</span><small>{hint.kind}</small></div>)}<p className="tiny">Authorized metadata · {hints.truncated ? 'more suggestions available · ' : ''}↑↓ select · Enter insert · Escape close</p></div>}
    {focused && error !== null && <span className="completion-error tiny" role="status">Completions unavailable: {error}</span>}
  </div>;
}
