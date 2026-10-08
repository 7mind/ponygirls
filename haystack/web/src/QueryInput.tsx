import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, AuthError } from "./api";
import { Icon } from "./Icon";

interface Completion { source: string; start: number; end: number; values: string[] }
const COMPLETION_DELAY_MS = 180;
const COMPLETION_LIMIT = 20;

function tokenRange(query: string, caret: number): { start: number; end: number } {
  let start = 0;
  let quoted = false;
  let escaped = false;
  const boundary = (char: string) => /[\s()]/.test(char);
  for (let i = 0; i < caret; i++) {
    const char = query[i]!;
    if (escaped) { escaped = false; continue; }
    if (char === "\\") escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && boundary(char)) start = i + 1;
  }
  let end = caret;
  for (; end < query.length; end++) {
    const char = query[end]!;
    if (escaped) { escaped = false; continue; }
    if (char === "\\") escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && boundary(char)) break;
  }
  return { start, end };
}

export function QueryInput({ value, onChange, onAuthLost }: {
  value: string; onChange: (value: string) => void; onAuthLost: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(value.length);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [request, setRequest] = useState(0);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const values = completion !== null && completion.source === value ? completion.values : [];
  const expanded = focused && !dismissed && !composing && (values.length > 0 || loading || error !== "");

  useEffect(() => {
    setCompletion(null); setActive(-1); setLoading(false); setError("");
    if (!focused || dismissed || composing) return;
    let cancelled = false;
    const position = Math.min(caret, value.length);
    const range = tokenRange(value, position);
    const fragment = value.slice(range.start, position);
    const timer = window.setTimeout(() => {
      setLoading(true);
      void api.complete(fragment, fragment.length).then((result) => {
        if (!cancelled) setCompletion({ source: value, ...range, values: result.suggestions.slice(0, COMPLETION_LIMIT) });
      }).catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof AuthError) onAuthLost();
        else setError("Query suggestions unavailable.");
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, COMPLETION_DELAY_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [value, caret, focused, dismissed, composing, request, onAuthLost]);

  useLayoutEffect(() => {
    if (pendingCaret.current === null || input.current === null) return;
    input.current.focus();
    input.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current); pendingCaret.current = null;
  }, [value]);

  useEffect(() => {
    if (active < 0 || list.current === null) return;
    const option = list.current.children.item(active);
    if (option !== null) option.scrollIntoView({ block: "nearest" });
  }, [active]);

  function locate(element: HTMLInputElement) {
    setCaret(element.selectionStart === null ? element.value.length : element.selectionStart);
    setDismissed(false);
  }

  function accept(suggestion: string) {
    if (completion === null || completion.source !== value) return;
    const position = completion.start + suggestion.length;
    const next = value.slice(0, completion.start) + suggestion + value.slice(completion.end);
    pendingCaret.current = next === value ? null : position;
    if (next === value) setCaret(position);
    setDismissed(true); setCompletion(null); setActive(-1);
    onChange(next);
    if (input.current !== null) {
      input.current.focus();
      input.current.setSelectionRange(position, position);
    }
  }

  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing) return;
    if (event.key === "Escape") {
      event.preventDefault(); setDismissed(true); setCompletion(null);
    } else if (event.key === " " && event.ctrlKey) {
      event.preventDefault(); locate(event.currentTarget); setRequest((current) => current + 1);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && values.length > 0 && expanded) {
      event.preventDefault();
      setActive((current) => current < 0 ? event.key === "ArrowDown" ? 0 : values.length - 1 :
        (current + (event.key === "ArrowDown" ? 1 : -1) + values.length) % values.length);
    } else if ((event.key === "Enter" || event.key === "Tab") && expanded && active >= 0) {
      event.preventDefault(); accept(values[active]!);
    } else if (event.key === "Enter" || event.key === "Tab") setDismissed(true);
  }

  return <div className="query-control">
    <label htmlFor={`${id}-input`}>Query</label>
    <div className="query-field">
      <span className="search-input"><Icon name="search" />
        <input id={`${id}-input`} ref={input} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
          aria-controls={`${id}-options`} aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
          placeholder="Search records…" value={value} autoComplete="off" spellCheck={false}
          onChange={(event) => { setCompletion(null); locate(event.currentTarget); onChange(event.currentTarget.value); }}
          onFocus={(event) => { setFocused(true); locate(event.currentTarget); }} onClick={(event) => locate(event.currentTarget)}
          onBlur={() => { setFocused(false); setDismissed(true); }} onKeyDown={keydown}
          onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) locate(event.currentTarget); }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => { setComposing(false); locate(event.currentTarget); }} />
      </span>
      {expanded && <div className="query-popup">
        <div ref={list} id={`${id}-options`} role="listbox" aria-label="Query suggestions" className="query-options">
          {values.map((suggestion, index) => <button key={suggestion} id={`${id}-option-${index}`} type="button" role="option"
            tabIndex={-1} aria-selected={active === index} onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(index)} onClick={() => accept(suggestion)}>{suggestion}</button>)}
        </div>
        {loading && <p role="status">Loading suggestions…</p>}
        {error !== "" && <p role="status">{error}</p>}
        {values.length > 0 && <div className="query-shortcuts">↑ ↓ select · Enter / Tab insert · Esc dismiss</div>}
      </div>}
    </div>
  </div>;
}
