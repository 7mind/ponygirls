import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { api, ApiError, AuthError, NetworkError, summaryKey, type SearchSort, type SearchSortField, type Summary } from "./api";
import { browseHash, PRESETS, sameBrowseState, type BrowseState, type Preset } from "./browse-state";
import { useLiveUpdates } from "./Live";
import { UiIcon } from "./Masthead";
import { QueryInput } from "./QueryInput";
import { appendField, appendFilter, hasConjunct, toggleConjunct } from "./query-edit";

const PAGE_SIZE = 20;
/** The next page is requested when the end of the list comes this close to the viewport (the document scrolls). */
const PREFETCH_MARGIN = "0px 0px 240px 0px";
/** Largest page the search API serves (limit 1–100); a refresh reloads the loaded chain in pages of this size. */
const SEARCH_LIMIT_MAX = 100;
const SKELETON_ROWS = 14;
/**
 * first: a new query or sort (the list restarts); append: the next page of the chain; refresh: reload the first
 * `rows` rows of the same query in place — rows stay until the new chain arrives and the first visible row keeps
 * its position (live updates, spec §5 rule 6).
 */
type Load = { kind: "first" } | { kind: "append"; cursor: string } | { kind: "refresh"; rows: number };
/** The load whose failure is shown: its Retry repeats it. */
type Failure = { load: Load["kind"]; message: string };
interface Anchor { key: string; top: number }
type Diagnostic = { message: string; start: number; end: number };
/**
 * A route this list showed before another query or sort replaced it (spec §5 rule 2). Only a settled search is kept:
 * `complete` — its settled chain (`cursor` undefined: the end was reached), an append or refresh failure exactly as
 * shown, whether live changes were pending, and where the reader was; `failed` — the initial search failed, with its
 * error and diagnostics exactly as shown. A route left while its initial search was in flight is not kept: it
 * searches again on return. Returning (Back, Forward, an address or link) restores a kept route without searching;
 * an explicit Search or sort runs anew. `version` is the live-update count when kept: later changes are announced.
 */
type Kept =
  | { tag: "complete"; items: Summary[]; cursor: string | undefined; failure: Failure | null; changesPending: boolean; version: number;
      pageTop: number; focus: Element | null }
  | { tag: "failed"; failure: Failure; diagnostics: Diagnostic[]; pageTop: number; focus: Element | null };
/** Settlement of the initial search of the route shown: only a settled route may be kept. */
type Phase = "loading" | "settled" | "failed";
const MAX_KEPT_ROUTES = 6;
const INVALID_QUERY = "Invalid search query.";

/** One table column; `hide` names the shared responsive class that drops it at narrower widths (spec §3.2). */
/** Skeleton cell of the loading state (mockup "loading"): bar widths as shared classes, `record` the icon tile + two lines. */
type Skeleton = "record" | "two-line" | "bar" | "short" | "full" | "none";
interface Column { label: string; sort: { field: SearchSortField; name: string } | null; col: string; hide: "" | "hide-md" | "hide-sm"; skeleton: Skeleton }
const COLUMNS: readonly Column[] = [
  { label: "Record", sort: { field: "title", name: "Record" }, col: "", hide: "", skeleton: "record" },
  { label: "Type", sort: { field: "type", name: "Type" }, col: "col-type", hide: "hide-sm", skeleton: "bar" },
  { label: "Project", sort: { field: "project", name: "Project" }, col: "col-project", hide: "hide-md", skeleton: "bar" },
  { label: "Tags", sort: null, col: "col-tags", hide: "hide-sm", skeleton: "full" },
  { label: "Attention", sort: { field: "human-attention", name: "Attention" }, col: "col-attn", hide: "hide-sm", skeleton: "none" },
  { label: "Importance", sort: { field: "importance", name: "Importance" }, col: "col-imp", hide: "hide-sm", skeleton: "short" },
  { label: "Modified", sort: { field: "modified-at", name: "Modified" }, col: "col-mod", hide: "", skeleton: "two-line" },
  { label: "Rev", sort: { field: "revision", name: "Revision" }, col: "col-rev", hide: "hide-md", skeleton: "none" },
];
/** Filter toggles: on while their term is a conjunct of the draft (query-edit `hasConjunct`). */
const TOGGLES: ReadonlyArray<{ label: string; term: string }> = [
  { label: "Needs review", term: PRESETS.inbox.query },
  { label: "Archived", term: PRESETS.archive.query },
];
const FIELD_INSERTERS: ReadonlyArray<{ field: string; hide: "" | "hide-md" }> = [
  { field: "type", hide: "" }, { field: "project", hide: "" }, { field: "tag", hide: "" }, { field: "status", hide: "" },
  { field: "importance", hide: "" }, { field: "modified-by", hide: "hide-md" }, { field: "created-by", hide: "hide-md" },
];
const TYPE_ICONS: Readonly<Record<string, string>> = {
  fact: "layers", todo: "list", decision: "shield", note: "file", "skill-draft": "sparkle", "github-issue": "hash", "github-pr": "branch",
};
const TYPE_FAMILIES: Readonly<Record<string, string>> = { "skill-draft": "work", "github-issue": "upstream", "github-pr": "upstream" };
const DEFAULT_TYPE_ICON = "layers";
const VISIBLE_TAGS = 2;
const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

const records = (count: number) => `${count} ${count === 1 ? "record" : "records"}`;
const visible = (element: Element | null) => element !== null && element.getClientRects().length > 0;

function SkeletonCell({ shape }: { shape: Skeleton }) {
  switch (shape) {
    case "record": return <div className="rec"><span className="rec-icon" /><div className="grow"><span className="skeleton sk-60" /><span className="skeleton sk-30" /></div></div>;
    case "two-line": return <><span className="skeleton sk-60" /><span className="skeleton sk-30" /></>;
    case "bar": return <span className="skeleton sk-60" />;
    case "short": return <span className="skeleton sk-30" />;
    case "full": return <span className="skeleton" />;
    case "none": return null;
  }
}

/** The query with every diagnostic span marked, and one caret line per diagnostic (mockup "invalid"). */
function QueryDiagnostics({ query, diagnostics }: { query: string; diagnostics: readonly Diagnostic[] }) {
  const marked = (index: number) => diagnostics.some((d) => index >= d.start && index < Math.max(d.end, d.start + 1));
  const segments: Array<{ text: string; marked: boolean }> = [];
  // A span at the end of the query marks the position after it.
  const text = diagnostics.some((d) => d.start >= query.length) ? `${query} ` : query;
  for (let index = 0; index < text.length; index++) {
    const last = segments.at(-1);
    if (last !== undefined && last.marked === marked(index)) last.text += text[index];
    else segments.push({ text: text[index]!, marked: marked(index) });
  }
  return <div className="query-diag">
    <div aria-hidden="true">{segments.map((segment, index) => segment.marked ? <span key={index} className="diag-span">{segment.text}</span> : segment.text)}</div>
    <ul className="diag-caret" aria-label="Search errors">{diagnostics.map((d, index) => <li key={index}>
      <span aria-hidden="true">{" ".repeat(d.start)}^ </span>position {d.start + 1}: {d.message}</li>)}</ul>
  </div>;
}

function Tags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return <span className="none">—</span>;
  const sorted = [...tags].sort();
  // At most two chips then "+N"; one chip below 1100 px (the narrow counter replaces the wide one there).
  return <div className="tags">
    {sorted.slice(0, VISIBLE_TAGS).map((tag) => <span key={tag} className="chip" title={tag}>{tag}</span>)}
    {sorted.length > VISIBLE_TAGS && <span className="tags-more tags-more-wide" title={sorted.slice(VISIBLE_TAGS).join(", ")}>+{sorted.length - VISIBLE_TAGS}</span>}
    {sorted.length > 1 && <span className="tags-more tags-more-narrow" title={sorted.slice(1).join(", ")}>+{sorted.length - 1}</span>}
  </div>;
}

function Importance({ value }: { value: string }) {
  return value === "critical" ? <span className="status status-danger">critical</span> : <span className={`importance importance-${value}`}>{value}</span>;
}

function RecordRow({ item, onOpen }: { item: Summary; onOpen: (key: string) => void }) {
  const key = summaryKey(item);
  const archived = item.status === "archived";
  const review = item.humanAttention === "required";
  const modified = new Date(item.modifiedAt);
  // The whole row opens the record; its button is the keyboard path and keeps text selection usable.
  const open = (event: MouseEvent<HTMLTableRowElement>) => {
    if (event.target instanceof Element && event.target.closest("button, a") !== null) return;
    if (window.getSelection()?.isCollapsed === false) return;
    onOpen(key);
  };
  return <tr data-row-id={key} className={archived ? "is-archived" : undefined} onClick={open}>
    <td><div className="rec">
      <span className="rec-icon" data-family={TYPE_FAMILIES[item.type]}><UiIcon name={TYPE_ICONS[item.type] ?? DEFAULT_TYPE_ICON} /></span>
      <button type="button" className="rec-open" aria-label={key} onClick={() => onOpen(key)}>
        <span className="cell-title" title={item.title}>{item.title}</span>
        <span className="cell-sub"><span className="rec-key" title={key}>{key}</span>
          {archived ? <span className="chip">archived</span> : item.status !== "actual" && <span className="chip chip-outline">{item.status}</span>}
          {review && <span className="chip chip-warn show-sm">Needs review</span>}</span>
      </button>
    </div></td>
    <td className="hide-sm"><span className="chip chip-outline" title={item.type}>{item.type}</span></td>
    <td className="hide-md" title={item.project}>{item.project}</td>
    <td className="hide-sm"><Tags tags={item.tags ?? []} /></td>
    <td className="hide-sm">{review && <span className="chip chip-warn">Needs review</span>}</td>
    <td className="hide-sm"><Importance value={item.importance} /></td>
    <td><time dateTime={item.modifiedAt} title={item.modifiedAt}>{modified.toLocaleString(undefined, DATE_FORMAT)}</time>
      <span className="cell-sub" title={item.modifiedBy}><span>by {item.modifiedBy}</span></span></td>
    <td className="col-num hide-md" title={String(item.revision)}>{item.revision}</td>
  </tr>;
}

export function Browse({ initial, preset, onOpen, onAuthLost }: {
  initial: BrowseState;
  preset: Preset;
  onOpen: (key: string) => void;
  onAuthLost: () => void;
}) {
  const [query, setQuery] = useState(initial.query);
  const [sort, setSort] = useState<SearchSort>(initial.sort);
  const [items, setItems] = useState<Summary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(true);
  const sequence = useRef(0);
  const composing = useRef(false);
  const blockedSearchPointer = useRef(false);
  const pending = useRef<number | null>(null);
  const continuation = useRef<string | undefined>(undefined);
  const applied = useRef(initial);
  const table = useRef<HTMLTableElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const queryInput = useRef<HTMLInputElement | null>(null);
  const editedByShortcut = useRef(false);
  const syntax = useRef<HTMLDialogElement>(null);
  // The syntax dialog is rendered only while open: a closed one would still be found by its label ("Query syntax").
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  // A submitted query the server's analyzer rejected: it is not applied, the list keeps the applied query's rows.
  const [rejected, setRejected] = useState<{ query: string; diagnostics: Diagnostic[] } | null>(null);
  const validation = useRef(0);
  const anchor = useRef<Anchor | null>(null);
  const section = useRef<HTMLElement>(null);
  const kept = useRef(new Map<string, Kept>());
  const shown = useRef<BrowseState | null>(null);
  const fresh = useRef(false);
  const restored = useRef<Kept | null>(null);
  const phase = useRef<Phase>("loading");
  // A live-change refresh in flight: if the route is left meanwhile, the change is still pending on return.
  const refreshing = useRef(false);
  // Where the page was while this list was last shown: the list may be hidden when its route changes.
  const pageTop = useRef(0);
  useEffect(() => {
    const onScroll = () => { if (visible(section.current)) pageTop.current = window.scrollY; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const headingId = useId();
  const syntaxId = useId();
  const live = useLiveUpdates();

  // The first row below the sticky table header and its offset, so that a refreshed chain keeps it in place. The
  // header cells are what sticks (components.css `.table th`); <thead> itself scrolls away with the table.
  function captureAnchor(): Anchor | null {
    const element = table.current;
    if (element === null || !visible(element) || window.scrollY === 0) return null;
    const top = element.tHead!.rows[0]!.cells[0]!.getBoundingClientRect().bottom;
    for (const row of element.querySelectorAll<HTMLElement>("tbody tr[data-row-id]")) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > top) return { key: row.dataset.rowId!, top: rect.top };
    }
    return null;
  }
  useLayoutEffect(() => {
    const kept = anchor.current;
    anchor.current = null;
    if (kept === null || table.current === null) return;
    const row = [...table.current.querySelectorAll<HTMLElement>("tbody tr[data-row-id]")].find((candidate) => candidate.dataset.rowId === kept.key);
    if (row !== undefined) window.scrollBy(0, row.getBoundingClientRect().top - kept.top);
  }, [items]);
  // A restored route gets its scroll position and focus back once its rows are rendered.
  useLayoutEffect(() => {
    const route = restored.current;
    restored.current = null;
    if (route === null) return;
    window.scrollTo(0, route.pageTop);
    if (route.focus instanceof HTMLElement && route.focus.isConnected) route.focus.focus({ preventScroll: true });
  }, [items]);
  useLayoutEffect(() => { if (syntaxOpen) syntax.current!.showModal(); }, [syntaxOpen]);
  // A filter shortcut edited the draft: the caret goes to its end so that completions follow the inserted term.
  useLayoutEffect(() => {
    if (!editedByShortcut.current || queryInput.current === null) return;
    editedByShortcut.current = false;
    queryInput.current.setSelectionRange(query.length, query.length);
    queryInput.current.focus({ preventScroll: true });
  }, [query]);

  const run = useCallback(async (state: BrowseState, load: Load) => {
    if (load.kind === "append" && (pending.current !== null || load.cursor !== continuation.current)) return;
    const request = ++sequence.current;
    pending.current = request;
    setBusy(true);
    setFailure(null);
    setDiagnostics([]);
    if (load.kind !== "append") setChanged(false);
    refreshing.current = load.kind === "refresh";
    if (load.kind === "first") {
      phase.current = "loading";
      setItems([]);
      continuation.current = undefined;
      setCursor(undefined);
      // A new query or sort starts at the top of its list.
      if (visible(section.current) && window.scrollY > 0) window.scrollTo(0, 0);
    }
    try {
      if (state.migrationError !== null) { phase.current = "failed"; setFailure({ load: "first", message: state.migrationError }); return; }
      const wanted = load.kind === "refresh" ? load.rows : PAGE_SIZE;
      const rows: Summary[] = [];
      let next = load.kind === "append" ? load.cursor : undefined;
      do {
        const page = await api.search(state.query, {
          limit: Math.min(SEARCH_LIMIT_MAX, wanted - rows.length),
          cursor: next,
          sort: state.sort,
        });
        if (request !== sequence.current) return;
        if (next !== undefined && page.cursor === next) throw new Error("Search returned a repeated continuation cursor.");
        rows.push(...page.items);
        next = page.cursor;
      } while (load.kind === "refresh" && next !== undefined && rows.length < wanted);
      if (load.kind === "refresh") anchor.current = captureAnchor();
      setItems((previous) => [...new Map([...(load.kind === "append" ? previous : []), ...rows].map((item) => [summaryKey(item), item])).values()]);
      continuation.current = next;
      setCursor(next);
      if (load.kind !== "append") phase.current = "settled";
      refreshing.current = false;
    } catch (err) {
      if (request !== sequence.current) return;
      // A failed first search fails the route; a failed append or refresh keeps the settled rows and shows the error.
      if (load.kind === "first") phase.current = "failed";
      // A failed refresh of shown rows announces the change again; a failed route offers Retry instead.
      if (load.kind === "refresh") { refreshing.current = false; if (phase.current === "settled") setChanged(true); }
      if (err instanceof AuthError) {
        onAuthLost();
        return;
      }
      if (err instanceof ApiError && err.code === "invalid-query") {
        setDiagnostics(err.spans ?? []);
        setFailure({ load: load.kind, message: INVALID_QUERY });
        return;
      }
      setFailure({ load: load.kind, message: err instanceof NetworkError ? "Server unreachable — the service may be down." : `Search failed: ${err instanceof Error ? err.message : "unknown"}.` });
    } finally {
      if (request === sequence.current) { pending.current = null; setBusy(false); }
    }
  }, [onAuthLost]);

  useEffect(() => {
    // A submitted route can arrive after the user starts a newer draft.
    if (!sameBrowseState(initial, applied.current)) {
      setQuery(initial.query);
    }
    validation.current++;
    setRejected(null);
    setSort(initial.sort);
    applied.current = initial;
    const outgoing = shown.current;
    shown.current = initial;
    if (outgoing !== null && outgoing.migrationError === null && !sameBrowseState(outgoing, initial)) {
      const key = browseHash(outgoing, preset);
      const focused = document.activeElement;
      const focus = focused !== null && section.current !== null && section.current.contains(focused) ? focused : null;
      const top = visible(section.current) ? window.scrollY : pageTop.current;
      kept.current.delete(key);
      // `cursor` is the settled continuation: an append in flight has not replaced it, so the next append can follow.
      if (phase.current === "settled") kept.current.set(key, { tag: "complete", items, cursor, failure, changesPending: changed || refreshing.current,
        version: live.version, pageTop: top, focus });
      else if (phase.current === "failed" && failure !== null) kept.current.set(key, { tag: "failed", failure, diagnostics, pageTop: top, focus });
      if (kept.current.size > MAX_KEPT_ROUTES) kept.current.delete(kept.current.keys().next().value!);
    }
    const hash = initial.migrationError === null ? browseHash(initial, preset) : null;
    const back = hash === null || fresh.current ? undefined : kept.current.get(hash);
    fresh.current = false;
    if (hash !== null) kept.current.delete(hash);
    if (back === undefined) { void run(initial, { kind: "first" }); return; }
    sequence.current++;
    pending.current = null;
    refreshing.current = false;
    restored.current = back;
    setBusy(false);
    setFailure(back.failure);
    if (back.tag === "failed") {
      phase.current = "failed";
      continuation.current = undefined;
      setItems([]);
      setCursor(undefined);
      setDiagnostics(back.diagnostics);
      setChanged(false);
      return;
    }
    phase.current = "settled";
    continuation.current = back.cursor;
    setItems(back.items);
    setCursor(back.cursor);
    setDiagnostics([]);
    setChanged(back.changesPending || back.version !== live.version);
  }, [initial.query, initial.migrationError, initial.sort.field, initial.sort.direction, run]);

  // A live change never resets a list: an untouched first page reloads in place; a list the reader has scrolled or
  // extended announces the change, and Show reloads the whole loaded chain in place (spec §1.5, §5 rule 6).
  const refresh = () => run(applied.current, { kind: "refresh", rows: Math.max(items.length, PAGE_SIZE) });
  // The first connection's resynchronisation follows the list's own first load and does not refetch it (spec §5
  // rule 6, H-03); a list mounted later starts from the live version it was mounted at.
  const mountedVersion = useRef(live.version);
  useEffect(() => {
    if (live.version === mountedVersion.current || (live.version === 1 && live.key === null)) return;
    const top = visible(section.current) ? window.scrollY : pageTop.current;
    if (top === 0 && items.length <= PAGE_SIZE) void refresh();
    else setChanged(true);
  }, [live.version, run]);
  useEffect(() => () => { sequence.current++; }, []);

  const blocked = failure !== null && failure.load === "append";
  useEffect(() => {
    if (cursor === undefined || busy || blocked || sentinel.current === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void run(applied.current, { kind: "append", cursor });
    }, { rootMargin: PREFETCH_MARGIN });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [cursor, busy, blocked, run]);

  function apply(state: BrowseState) {
    if (state.migrationError !== null) return;
    validation.current++;
    setRejected(null);
    // Invalidate an in-flight page before the hashchange event can arrive.
    pending.current = ++sequence.current;
    continuation.current = undefined;
    setBusy(true);
    applied.current = state;
    const hash = browseHash(state, preset);
    // An explicit Search or sort searches again even where a kept route exists.
    if (location.hash !== hash) { fresh.current = true; location.hash = hash; return; }
    void run(state, { kind: "first" });
  }

  function changeSort(field: SearchSortField) {
    const direction = sort.field === field ? sort.direction === "asc" ? "desc" : "asc" : field === "modified-at" || field === "revision" ? "desc" : "asc";
    const next: SearchSort = { field, direction };
    setSort(next);
    apply({ ...applied.current, sort: next });
  }

  /** Search: a changed expression is checked by the server's analyzer first, so that an invalid one is not applied. */
  async function submit() {
    const state: BrowseState = { query, sort, migrationError: initial.migrationError };
    if (query === applied.current.query) { apply(state); return; }
    const check = ++validation.current;
    // A submission the reader has navigated away from (a record, another list) is dropped.
    const from = location.hash;
    const current = () => check === validation.current && location.hash === from;
    let result: { valid: boolean; diagnostics: Diagnostic[] };
    try { result = await api.analyze(query); }
    catch (err) {
      if (!current()) return;
      if (err instanceof AuthError) { onAuthLost(); return; }
      // The search reports what the analyzer could not.
      apply(state);
      return;
    }
    if (!current()) return;
    if (result.valid) apply(state);
    else setRejected({ query, diagnostics: result.diagnostics });
  }

  function changeDraft(next: string) {
    setRejected(null);
    setQuery(next);
  }

  function editDraft(next: string | null) {
    if (next === null) return;
    editedByShortcut.current = true;
    changeDraft(next);
  }

  function retry(load: Failure["load"]) {
    if (load === "first") void run(applied.current, { kind: "first" });
    else if (load === "refresh") void refresh();
    else if (cursor !== undefined) void run(applied.current, { kind: "append", cursor });
  }

  const migration = initial.migrationError !== null;
  const draft = !migration && query !== applied.current.query;
  const appliedQuery = applied.current.query;
  const firstFailure = failure !== null && items.length === 0 ? failure : null;
  const laterFailure = failure !== null && items.length > 0 ? failure : null;
  const loadingFirst = busy && items.length === 0 && failure === null;
  const empty = !busy && failure === null && items.length === 0;
  const inboxEmpty = empty && preset === "inbox" && appliedQuery === PRESETS.inbox.query;
  const counter = rejected !== null ? `Query not applied · ${items.length} loaded`
    : migration || (firstFailure !== null && diagnostics.length === 0) ? "Not loaded"
    : firstFailure !== null ? "Query not applied"
    : loadingFirst ? "Loading records…"
    : empty ? inboxEmpty ? "Nothing to review" : "No matches"
    : cursor === undefined ? `All ${records(items.length)} loaded` : `${items.length} loaded · more available`;
  const includeArchived = appendFilter(appliedQuery, "archived", "all");

  return (<section ref={section} className="browse" aria-labelledby={headingId} aria-busy={busy}>
    <h1 id={headingId} className="sr-only">{PRESETS[preset].label}</h1>
    <form className="viewbar" role="search" aria-label="Search records" onSubmit={(e) => {
      e.preventDefault();
      if (composing.current) return;
      void submit();
    }}>
      <QueryInput value={query} draft={draft && rejected === null} inputRef={queryInput} onChange={changeDraft} onAuthLost={onAuthLost} onCompositionChange={(state) => { composing.current = state; }}>
        <button className="btn btn-primary" type="submit" disabled={migration}
          onPointerDownCapture={(event) => { blockedSearchPointer.current = composing.current; if (composing.current) event.preventDefault(); }}
          onClickCapture={(event) => { if (composing.current || blockedSearchPointer.current) { event.preventDefault(); event.stopPropagation(); } blockedSearchPointer.current = false; }}>Search</button>
      </QueryInput>
      <div className="viewbar-meta" role="status" aria-live="polite">{counter}</div>
    </form>
    <div className="filterbar" role="group" aria-label="Filter shortcuts">
      {TOGGLES.map(({ label, term }) => <button key={term} type="button" className="filter" aria-pressed={hasConjunct(query, term)} title={term}
        disabled={migration} onClick={() => editDraft(toggleConjunct(query, term))}>{label}</button>)}
      <span className="filter-divider" aria-hidden="true" />
      {FIELD_INSERTERS.map(({ field, hide }) => <button key={field} type="button" className={`filter filter-field ${hide}`} aria-label={`Add ${field} filter`}
        disabled={migration} onClick={() => editDraft(appendField(query, field))}>{field}:</button>)}
      <div className="sortline">
        <button type="button" className="link-button" aria-haspopup="dialog" aria-controls={syntaxOpen ? syntaxId : undefined} onClick={() => setSyntaxOpen(true)}>Query syntax</button>
      </div>
    </div>
    {rejected !== null && <div className="inline-notice">
      <div className="notice notice-danger" role="alert"><UiIcon name="alert" /><div className="grow">
        <div className="notice-title">{INVALID_QUERY}</div>
        The query was not applied; the list below still shows the previous query.
        <QueryDiagnostics query={rejected.query} diagnostics={rejected.diagnostics} />
      </div></div>
    </div>}
    {firstFailure !== null && (migration || diagnostics.length > 0) && <div className="inline-notice">
      <div className="notice notice-danger" role="alert"><UiIcon name="alert" /><div className="grow">
        {migration ? firstFailure.message : <>
          <div className="notice-title">{INVALID_QUERY}</div>
          <QueryDiagnostics query={appliedQuery} diagnostics={diagnostics} />
        </>}
      </div></div>
    </div>}
    {firstFailure !== null && !migration && diagnostics.length === 0 && <div className="page">
      <div className="notice notice-danger" role="alert"><UiIcon name="alert" /><div className="grow">
        <div className="notice-title">Records could not be loaded</div>
        {firstFailure.message} Your query is unchanged and nothing was modified.
        <div className="notice-actions"><button type="button" className="btn btn-sm" onClick={() => retry("first")}>Retry</button></div>
      </div></div>
    </div>}
    {changed && <div className="update-pill" role="status"><button type="button" onClick={() => void refresh()}><UiIcon name="arrow-up" />Records changed · Show</button></div>}
    <div className="records" role="region" aria-label="Record results">
      {(items.length > 0 || loadingFirst) && <table ref={table} className="table table-2line" aria-label="Records">
        <colgroup>{COLUMNS.map((column) => <col key={column.label} className={`${column.col} ${column.hide}`} />)}</colgroup>
        <thead><tr>{COLUMNS.map((column) => {
          const sorted = column.sort !== null && sort.field === column.sort.field;
          return <th key={column.label} scope="col" className={column.label === "Rev" ? `col-num ${column.hide}` : column.hide}
            aria-sort={sorted ? sort.direction === "asc" ? "ascending" : "descending" : undefined}>
            {column.sort === null ? column.label : <button type="button" className="th-sort" disabled={migration} aria-label={`Sort by ${column.sort.name}`}
              onClick={() => changeSort(column.sort!.field)}>{column.label}</button>}
          </th>;
        })}</tr></thead>
        {loadingFirst ? <tbody aria-hidden="true" data-skeleton="">
          {Array.from({ length: SKELETON_ROWS }, (_, row) => <tr key={row}>{COLUMNS.map((column) => <td key={column.label} className={column.hide}>
            <SkeletonCell shape={column.skeleton} /></td>)}</tr>)}
        </tbody> : <tbody>{items.map((item) => <RecordRow key={summaryKey(item)} item={item} onOpen={onOpen} />)}</tbody>}
      </table>}
      {inboxEmpty && <div className="empty">
        <UiIcon name="check-circle" />
        <h2>Inbox zero</h2>
        <p>No record is waiting for human review. Records flagged by agents or people appear here automatically.</p>
        <div className="row"><a className="btn" href="#/browse">Browse all records</a></div>
      </div>}
      {empty && !inboxEmpty && <div className="empty">
        <UiIcon name="search" />
        <h2>No matching records</h2>
        <p>{appliedQuery.trim() === "" ? "There are no records yet." : <>Nothing matches <code>{appliedQuery}</code>.</>} Archived records are not searched unless the query says <code>archived:all</code>.</p>
        <div className="row">
          {appliedQuery !== "" && <button type="button" className="btn" onClick={() => { changeDraft(""); apply({ ...applied.current, query: "" }); }}>Clear query</button>}
          {includeArchived !== null && !/\barchived:/i.test(appliedQuery) && <button type="button" className="btn" onClick={() => { changeDraft(includeArchived); apply({ ...applied.current, query: includeArchived }); }}>Include archived</button>}
          <button type="button" className="btn btn-ghost" onClick={() => setSyntaxOpen(true)}>Query syntax</button>
        </div>
      </div>}
      {items.length > 0 && (laterFailure !== null ? <div className="inline-notice foot-notice">
        <div className="notice notice-danger notice-row" role="alert"><UiIcon name="alert" /><div className="grow">
          <span className="notice-title">{laterFailure.load === "refresh" ? "The changed records could not be loaded." : "The next records could not be loaded."}</span>
          {" "}{laterFailure.message} The {records(items.length)} above {items.length === 1 ? "is" : "are"} kept.{laterFailure.load === "append" && " Automatic loading is paused."}
        </div><button type="button" className="btn btn-sm" onClick={() => retry(laterFailure.load)}>Retry loading records</button></div>
      </div> : cursor === undefined ? <div className="list-foot list-end" data-list-end="">End of list · {records(items.length)}</div>
        : <div ref={sentinel} className="list-foot">{busy && <span className="spinner" aria-hidden="true" />}{busy ? "Loading more records…" : "More records load as you scroll"}</div>)}
    </div>
    {syntaxOpen && <dialog ref={syntax} id={syntaxId} className="dialog dialog-wide" aria-labelledby={`${syntaxId}-title`} onClose={() => setSyntaxOpen(false)}>
      <div className="dialog-head"><h2 id={`${syntaxId}-title`}>Query syntax</h2>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={() => syntax.current!.close()}><UiIcon name="x" /></button></div>
      <div className="dialog-body">
        <p>Unquoted words match normalised text; quoted text matches a phrase. All filters belong in the expression: combine them with <code>AND</code>, <code>OR</code>, <code>NOT</code> and parentheses. A space means <code>AND</code>; quote values that contain spaces or colons.</p>
        <dl className="dl syntax-dl">
          <dt><code>type:todo</code></dt><dd>record type</dd>
          <dt><code>project:example</code></dt><dd>project (namespace) of the record</dd>
          <dt><code>tag:"machine learning"</code></dt><dd>has the tag</dd>
          <dt><code>human-attention:required</code></dt><dd>waiting for human review (the Inbox)</dd>
          <dt><code>importance:high</code></dt><dd>also <code>status:</code>, <code>id:</code></dd>
          <dt><code>modified-by:op</code></dt><dd>author of the latest revision; <code>created-by:</code> of the first</dd>
          <dt><code>archived:true</code></dt><dd>only archived; <code>archived:all</code> includes them (default: hidden)</dd>
        </dl>
        <p>Time comparison: <code>modified-at &gt;= "2026-10-01T00:00:00Z"</code>.</p>
        <p>Example: <code>(type:todo OR type:fact) tag:"machine learning"</code>. Press <span className="kbd">Enter</span> or Search to apply exactly the visible query; <span className="kbd">Ctrl</span> <span className="kbd">Space</span> asks for suggestions.</p>
      </div>
      <div className="dialog-foot"><button type="button" className="btn" onClick={() => syntax.current!.close()}>Close</button></div>
    </dialog>}
  </section>);
}
