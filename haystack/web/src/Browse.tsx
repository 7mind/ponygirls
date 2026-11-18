import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, AuthError, NetworkError, summaryKey, type SearchSort, type SearchSortField, type Summary } from "./api";
import { browseHash, sameBrowseState, type BrowseState, type Preset } from "./browse-state";
import { useLiveUpdates } from "./Live";
import { Icon } from "./Icon";
import { QueryInput } from "./QueryInput";

const PAGE_SIZE = 20;
const HEADINGS: Record<Preset, string> = { browse: "Records", inbox: "Attention inbox", upstream: "Upstream activity", skills: "Skill candidates", archive: "Archive" };
const PREFETCH_MARGIN = "200px";
/** Largest page the search API serves (limit 1–100); a refresh reloads the loaded chain in pages of this size. */
const SEARCH_LIMIT_MAX = 100;
/**
 * first: a new query or sort (the list restarts); append: the next page of the chain; refresh: reload the first
 * `rows` rows of the same query in place — rows stay until the new chain arrives and the first visible row keeps
 * its position (live updates, spec §5 rule 6).
 */
type Load = { kind: "first" } | { kind: "append"; cursor: string } | { kind: "refresh"; rows: number };
interface Anchor { key: string; top: number }
const SORT_COLUMNS: ReadonlyArray<{ field: SearchSortField; label: string }> = [
  { field: "title", label: "Record" }, { field: "project", label: "Project" },
  { field: "type", label: "Type" }, { field: "status", label: "Status" },
  { field: "importance", label: "Priority" }, { field: "human-attention", label: "Attention" },
  { field: "modified-at", label: "Modified" }, { field: "revision", label: "Rev" },
];

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
  const [diagnostics, setDiagnostics] = useState<Array<{ message: string; start: number; end: number }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const sequence = useRef(0);
  const composing = useRef(false);
  const blockedSearchPointer = useRef(false);
  const pending = useRef<number | null>(null);
  const continuation = useRef<string | undefined>(undefined);
  const applied = useRef(initial);
  const panel = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [changed, setChanged] = useState(false);
  const anchor = useRef<Anchor | null>(null);
  const helpId = useId();
  const live = useLiveUpdates();
  const inbox = preset === "inbox";

  // The first row visible in the scrolled results panel and its offset, so that a refreshed chain keeps it in place.
  function captureAnchor(): Anchor | null {
    const container = panel.current;
    if (container === null || container.scrollTop === 0) return null;
    const top = container.getBoundingClientRect().top;
    for (const row of container.querySelectorAll<HTMLElement>("tbody tr[data-row-id]")) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > top) return { key: row.dataset.rowId!, top: rect.top };
    }
    return null;
  }
  useLayoutEffect(() => {
    const kept = anchor.current;
    anchor.current = null;
    const container = panel.current;
    if (kept === null || container === null) return;
    const row = [...container.querySelectorAll<HTMLElement>("tbody tr[data-row-id]")].find((candidate) => candidate.dataset.rowId === kept.key);
    if (row !== undefined) container.scrollTop += row.getBoundingClientRect().top - kept.top;
  }, [items]);

  const run = useCallback(async (state: BrowseState, load: Load) => {
    if (load.kind === "append" && (pending.current !== null || load.cursor !== continuation.current)) return;
    const request = ++sequence.current;
    pending.current = request;
    setBusy(true);
    setError("");
    setDiagnostics([]);
    if (load.kind !== "append") setChanged(false);
    if (load.kind === "first") {
      setItems([]);
      continuation.current = undefined;
      setCursor(undefined);
      if (panel.current !== null) panel.current.scrollTop = 0;
    }
    try {
      if (state.migrationError !== null) { setError(state.migrationError); return; }
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
    } catch (err) {
      if (request !== sequence.current) return;
      if (err instanceof AuthError) {
        onAuthLost();
        return;
      }
      if (err instanceof ApiError && err.code === "invalid-query") {
        setDiagnostics(err.spans ?? []);
        setError("Invalid search query.");
        return;
      }
      setError(err instanceof NetworkError ? "Server unreachable — the service may be down." : `Search failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      if (request === sequence.current) { pending.current = null; setBusy(false); }
    }
  }, [onAuthLost]);

  useEffect(() => {
    // A submitted route can arrive after the user starts a newer draft.
    if (!sameBrowseState(initial, applied.current)) {
      setQuery(initial.query);
    }
    setSort(initial.sort);
    applied.current = initial;
    void run(initial, { kind: "first" });
  }, [initial.query, initial.migrationError, initial.sort.field, initial.sort.direction, run]);

  // A live change never resets a list: an untouched first page reloads in place; a list the reader has scrolled or
  // extended announces the change, and Show reloads the whole loaded chain in place (spec §1.5, §5 rule 6).
  const refresh = () => run(applied.current, { kind: "refresh", rows: Math.max(items.length, PAGE_SIZE) });
  useEffect(() => {
    if (live.version === 0) return;
    const untouched = (panel.current === null || panel.current.scrollTop === 0) && items.length <= PAGE_SIZE;
    if (untouched) void refresh();
    else setChanged(true);
  }, [live.version, run]);
  useEffect(() => () => { sequence.current++; }, []);

  useEffect(() => {
    if (cursor === undefined || busy || error !== "" || sentinel.current === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void run(applied.current, { kind: "append", cursor });
    }, { root: panel.current, rootMargin: PREFETCH_MARGIN });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [cursor, busy, error, run]);

  function apply(state: BrowseState) {
    if (state.migrationError !== null) return;
    // Invalidate an in-flight page before the hashchange event can arrive.
    pending.current = ++sequence.current;
    continuation.current = undefined;
    setBusy(true);
    applied.current = state;
    const hash = browseHash(state, preset);
    if (location.hash !== hash) { location.hash = hash; return; }
    void run(state, { kind: "first" });
  }

  function changeSort(field: SearchSortField) {
    const direction = sort.field === field ? sort.direction === "asc" ? "desc" : "asc" : field === "modified-at" || field === "revision" ? "desc" : "asc";
    const next: SearchSort = { field, direction };
    setSort(next);
    apply({ ...applied.current, sort: next });
  }

  function sortHeader(field: SearchSortField, label: string) {
    return <th key={field} scope="col" aria-sort={sort.field === field ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
      <button type="button" className="sort-header" disabled={initial.migrationError !== null} aria-label={`Sort by ${label}`} onClick={() => changeSort(field)}>
        {label}<span aria-hidden="true">{sort.field === field ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span>
      </button>
    </th>;
  }

  return (<>
    {changed && <div className="update-pill"><button type="button" onClick={() => void refresh()}>Records changed · Show</button></div>}
    <section className="browse-view" aria-label="Browse" aria-busy={busy}>
      <div className="page-heading"><div>
        <h1>{HEADINGS[preset]}</h1>
        <p>{inbox ? "Records requiring review." : "Search by text, metadata, tags, or project."}</p></div></div>
      <form
        className="search-panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (composing.current) return;
          apply({ query, sort, migrationError: initial.migrationError });
        }}
      >
        <QueryInput value={query} onChange={setQuery} onAuthLost={onAuthLost} onCompositionChange={(state) => { composing.current = state; }} />
        <div className="search-actions"><button className="primary" type="submit" disabled={initial.migrationError !== null}
          onPointerDownCapture={(event) => { blockedSearchPointer.current = composing.current; if (composing.current) event.preventDefault(); }}
          onClickCapture={(event) => { if (composing.current || blockedSearchPointer.current) { event.preventDefault(); event.stopPropagation(); } blockedSearchPointer.current = false; }}>Search</button></div>
      </form>
      {(initial.migrationError === null && query !== applied.current.query) && <p className="draft-status" role="status">Draft changed · press Search to update results.</p>}
      {diagnostics.length > 0 && (
        <ul aria-label="Search errors">
          {diagnostics.map((d, i) => (
            <li key={i}>
              {d.message} [{d.start},{d.end})
            </li>
          ))}
        </ul>
      )}
      <div className="results-heading"><h2>{inbox ? "Waiting for review" : "Records"} <span className="count-badge">{items.length}{cursor !== undefined && "+"}</span></h2><span>Sorted by {SORT_COLUMNS.find((column) => column.field === sort.field)?.label ?? "record key"} {sort.direction === "asc" ? "↑" : "↓"}</span></div>
      <p id={helpId} className="scroll-help">Scroll the table to load more records. Select a column heading to sort all results.</p>
      {error !== "" && <p role="alert">{error} {diagnostics.length === 0 && initial.migrationError === null && <button type="button" onClick={() => void run(applied.current, cursor === undefined ? { kind: "first" } : { kind: "append", cursor })}>Retry loading records</button>}</p>}
      {items.length === 0 && !busy && error === "" && <div className="empty-state"><Icon name={inbox ? "inbox" : "search"} /><h3>{inbox ? "No records requiring review" : "No records found"}</h3><p>{inbox ? "Records requiring attention appear here." : "Try a different query or include archived records."}</p></div>}
        <div className="records-panel" ref={panel} role="region" aria-label="Record results" aria-describedby={helpId} tabIndex={0}><table>
          <thead>
            <tr>
              {SORT_COLUMNS.slice(0, 6).map((column) => sortHeader(column.field, column.label))}
              <th scope="col">Tags</th>
              {SORT_COLUMNS.slice(6).map((column) => sortHeader(column.field, column.label))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={summaryKey(item)} data-row-id={summaryKey(item)}>
                <td>
                  <button className="record-open" type="button" aria-label={summaryKey(item)} onClick={() => onOpen(summaryKey(item))}>
                    <span className={`record-icon type-${item.type}`}><Icon name={item.type === "skill-draft" ? "spark" : item.type.startsWith("github-") ? "branch" : "stack"} /></span>
                    <span><strong>{item.title}</strong><small>{item.item}</small></span>
                  </button>
                </td>
                <td data-label="Project" className="project-cell">{item.project}</td>
                <td data-label="Type"><span className="type-badge">{item.type}</span></td>
                <td data-label="Status"><span className={`status-badge ${item.status === "archived" ? "archived" : ""}`}>{item.status}</span></td>
                <td data-label="Priority"><span className={`priority ${item.importance === "high" ? "high" : ""}`}>{item.importance}</span></td>
                <td data-label="Attention"><span className={`attention-badge ${item.humanAttention === "required" ? "required" : ""}`}>{item.humanAttention === "required" ? "Needs review" : "Reviewed"}</span></td>
                <td data-label="Tags">{(item.tags ?? []).length === 0 ? <span className="empty-tags">—</span> : (item.tags ?? []).join(", ")}</td>
                <td data-label="Modified" className="modified-cell">
                  <span>{item.modifiedBy}</span><time dateTime={item.modifiedAt} title={item.modifiedAt}>{new Date(item.modifiedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
                </td>
                <td data-label="Revision">{item.revision}</td>
              </tr>
            ))}
          </tbody>
        </table><div ref={sentinel} className="scroll-sentinel" aria-hidden="true" /></div>
      <div className="results-footer">
        <span role="status" aria-live="polite">{busy ? items.length === 0 ? "Searching…" : "Loading more records…" : error === "" && items.length > 0 && cursor === undefined ? `All ${items.length} records loaded.` : `${items.length} records loaded.`}</span>
        {cursor !== undefined && error === "" && <button type="button" disabled={busy} onClick={() => void run(applied.current, { kind: "append", cursor })}>Load more records</button>}
      </div>
    </section>
  </>);
}
