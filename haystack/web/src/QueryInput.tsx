import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, AuthError } from "./api";
import { Icon } from "./Icon";
import { completionEdit, completionRange } from "./query-edit";

interface Completion { stamp: string; start: number; end: number; values: string[] }
const COMPLETION_DELAY_MS = 180;
const COMPLETION_LIMIT = 20;

export function QueryInput({ value, onChange, onAuthLost, onCompositionChange }: {
  value: string; onChange: (value: string) => void; onAuthLost: () => void; onCompositionChange: (value: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const busy = useRef(false);
  const serial = useRef(0);
  const pump = useRef<() => void>(() => {});
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [request, setRequest] = useState(0);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const stamp = JSON.stringify([value, caret, focused, dismissed, composing, request]);
  const current = useRef(stamp);
  current.current = stamp;
  const values = completion?.stamp === stamp ? completion.values : [];
  const expanded = focused && !dismissed && !composing && (values.length > 0 || loading || error !== "");

  useEffect(() => {
    const token = ++serial.current;
    let ready = false, mounted = true;
    setCompletion(null); setActive(0); setLoading(false); setError("");
    const range = focused && !dismissed && !composing ? completionRange(value, caret, caret) : null;
    pump.current = () => {
      if (!mounted || !ready || busy.current || current.current !== stamp || range === null) return;
      busy.current = true; ready = false; setLoading(true);
      void api.complete(range.fragment, range.fragment.length).then((result) => {
        if (mounted && serial.current === token && current.current === stamp)
          setCompletion({ stamp, start: range.start, end: range.end, values: result.suggestions
            .filter((suggestion) => completionEdit(value, range, suggestion) !== null).slice(0, COMPLETION_LIMIT) });
      }).catch((err: unknown) => {
        if (!mounted || serial.current !== token || current.current !== stamp) return;
        if (err instanceof AuthError) onAuthLost();
        else setError("Query suggestions unavailable.");
      }).finally(() => { busy.current = false; if (mounted && serial.current === token) setLoading(false); pump.current(); });
    };
    const timer = window.setTimeout(() => { ready = true; pump.current(); }, COMPLETION_DELAY_MS);
    return () => { mounted = false; window.clearTimeout(timer); };
  }, [stamp, value, caret, focused, dismissed, composing, request, onAuthLost]);

  useLayoutEffect(() => {
    if (pendingCaret.current === null || input.current === null) return;
    input.current.focus();
    input.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current); pendingCaret.current = null;
  }, [value]);

  useEffect(() => {
    if (!expanded || list.current === null) return;
    list.current.children.item(active)?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);

  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]') || target?.closest('[role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault(); input.current?.focus(); input.current?.select();
      setCaret(-1); setDismissed(true);
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function locate(element: HTMLInputElement) {
    const start = element.selectionStart;
    setCaret(start !== null && start === element.selectionEnd ? start : -1);
    setDismissed(false);
  }

  function edit(next: string, position: number, continueHints: boolean) {
    pendingCaret.current = next === value ? null : position;
    setCompletion(null); setDismissed(!continueHints); setActive(0);
    onChange(next);
    input.current?.focus(); input.current?.setSelectionRange(position, position);
    setCaret(position);
  }

  function accept(suggestion: string) {
    if (completion?.stamp !== stamp) return;
    const next = completionEdit(value, completion, suggestion);
    if (next === null) return;
    edit(next.query, next.caret, suggestion.endsWith(":") || /^(AND|OR|NOT)$/i.test(suggestion));
  }

  function clear() { setComposing(false); onCompositionChange(false); edit("", 0, false); }

  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || composing) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      if (expanded) { event.preventDefault(); event.stopPropagation(); setDismissed(true); setCompletion(null); }
      else if (value !== "") { event.preventDefault(); event.stopPropagation(); clear(); }
    } else if (event.key === " " && event.ctrlKey) {
      event.preventDefault(); locate(event.currentTarget); setRequest((current) => current + 1);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && values.length > 0 && expanded) {
      event.preventDefault();
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : values.length - 1)) % values.length);
    } else if (event.key === "Enter" && expanded && values.length > 0) {
      event.preventDefault(); accept(values[active]!);
    } else if (event.key === "Tab") setDismissed(true);
  }

  return <div className="query-control">
    <label htmlFor={`${id}-input`}>Query</label>
    <div className="query-field">
      <span className="search-input"><Icon name="search" />
        <input id={`${id}-input`} ref={input} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
          aria-controls={expanded ? `${id}-options` : undefined} aria-activedescendant={expanded && values.length > 0 ? `${id}-option-${active}` : undefined}
          placeholder='Search text or type:todo · Ctrl/⌘ K' maxLength={4096} value={value} autoComplete="off" spellCheck={false}
          onChange={(event) => { setCompletion(null); locate(event.currentTarget); onChange(event.currentTarget.value); }}
          onFocus={(event) => { setFocused(true); locate(event.currentTarget); }} onClick={(event) => locate(event.currentTarget)}
          onSelect={(event) => { const element = event.currentTarget; setCaret(element.selectionStart === element.selectionEnd ? element.selectionStart ?? -1 : -1); }}
          onBlur={() => { setFocused(false); setDismissed(true); }} onKeyDown={keydown}
          onCompositionStart={() => { setComposing(true); onCompositionChange(true); setCompletion(null); }}
          onCompositionEnd={(event) => { setComposing(false); onCompositionChange(false); locate(event.currentTarget); }} />
        <button type="button" className="query-clear" aria-label="Clear search expression" title="Clear query · Escape after dismissing suggestions" disabled={value === ""}
          onMouseDown={(event) => event.preventDefault()} onClick={clear}>×</button>
      </span>
      {expanded && <div className="query-popup">
        <div ref={list} id={`${id}-options`} role="listbox" aria-label="Query suggestions" className="query-options">
          {values.map((suggestion, index) => <button key={`${index}:${suggestion}`} id={`${id}-option-${index}`} type="button" role="option"
            tabIndex={-1} aria-selected={active === index} onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(index)} onClick={() => accept(suggestion)}>{suggestion}</button>)}
        </div>
        {loading && <p role="status">Loading suggestions…</p>}
        {error !== "" && <p role="status">{error}</p>}
        {values.length > 0 && <div className="query-shortcuts">↑ ↓ select · Enter insert · Tab next field · Esc dismiss</div>}
      </div>}
    </div>
    <details className="query-help"><summary>Search syntax</summary><p>Combine text and filters with <code>AND</code>, <code>OR</code>, <code>NOT</code> or parentheses. Spaces mean AND; quote values with spaces or colons.</p><p><code>(type:todo OR type:fact) tag:"machine learning"</code> · <code>modified-at &gt;= "2026-10-01T00:00:00Z"</code></p><p>All filters belong in this expression: <code>project:example tag:mcp archived:all</code>. Press Search to apply the exact visible query. Unquoted text matches normalized words; quoted text matches a phrase.</p></details>
  </div>;
}
