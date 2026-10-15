import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, AuthError, NetworkError, summaryKey, type SearchSort, type SearchSortField, type Summary } from "./api";
import { browseHash, sameBrowseState, type ArchiveMode, type BrowseState } from "./browse-state";
import { useLiveUpdates } from "./Live";
import { Icon } from "./Icon";
import { QueryInput } from "./QueryInput";

const PAGE_SIZE = 20;
const PREFETCH_MARGIN = "200px";
const SORT_COLUMNS: ReadonlyArray<{ field: SearchSortField; label: string }> = [
  { field: "title", label: "Record" }, { field: "project", label: "Project" },
  { field: "type", label: "Type" }, { field: "status", label: "Status" },
  { field: "importance", label: "Priority" }, { field: "human-attention", label: "Attention" },
  { field: "modified-at", label: "Modified" }, { field: "revision", label: "Rev" },
];

function tagPredicate(tag: string): string {
  const t = tag.trim();
  if (/^[A-Za-z0-9._~\-]+$/.test(t)) return `tag:${t}`;
  return `tag:${JSON.stringify(t)}`;
}

/** Compose tag + archive controls with the query AST (never a contradictory
 *  appended filter): an explicit selector anywhere disables the default. */
export function composedQuery(state: BrowseState): string {
  const q = state.query.trim();
  const tag = (state.tag ?? "").trim();
  const base = tag === "" ? q : q === "" ? tagPredicate(tag) : `(${q}) ${tagPredicate(tag)}`;
  if (state.archive === "hide") return base;
  if (state.archive === "show") return base === "" ? "archived:all" : `archived:all (${base})`;
  return base === "" ? "archived:true" : `archived:true (${base})`;
}

export function Browse({ initial, inbox, onOpen, onAuthLost }: {
  initial: BrowseState;
  inbox: boolean;
  onOpen: (key: string) => void;
  onAuthLost: () => void;
}) {
  const [query, setQuery] = useState(initial.query);
  const [project, setProject] = useState(initial.project);
  const [archive, setArchive] = useState<ArchiveMode>(initial.archive);
  const [tag, setTag] = useState(initial.tag);
  const [sort, setSort] = useState<SearchSort>(initial.sort);
  const [items, setItems] = useState<Summary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [diagnostics, setDiagnostics] = useState<Array<{ message: string; start: number; end: number }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const sequence = useRef(0);
  const pending = useRef<number | null>(null);
  const continuation = useRef<string | undefined>(undefined);
  const applied = useRef(initial);
  const panel = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const live = useLiveUpdates();

  const run = useCallback(async (state: BrowseState, cursorValue: string | undefined) => {
    const append = cursorValue !== undefined;
    if (append && (pending.current !== null || cursorValue !== continuation.current)) return;
    const request = ++sequence.current;
    pending.current = request;
    setBusy(true);
    setError("");
    setDiagnostics([]);
    if (!append) {
      setItems([]);
      continuation.current = undefined;
      setCursor(undefined);
      if (panel.current !== null) panel.current.scrollTop = 0;
    }
    try {
      const page = await api.search(composedQuery(state), {
        project: state.project.trim() === "" ? undefined : state.project.trim(),
        limit: PAGE_SIZE,
        cursor: cursorValue,
        sort: state.sort,
      });
      if (request !== sequence.current) return;
      if (append && page.cursor === cursorValue) throw new Error("Search returned a repeated continuation cursor.");
      setItems((previous) => [...new Map([...(append ? previous : []), ...page.items].map((item) => [summaryKey(item), item])).values()]);
      continuation.current = page.cursor;
      setCursor(page.cursor);
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
      setQuery(initial.query); setProject(initial.project); setArchive(initial.archive); setTag(initial.tag);
    }
    setSort(initial.sort);
    applied.current = initial;
    void run(initial, undefined);
  }, [initial.query, initial.project, initial.archive, initial.tag, initial.sort.field, initial.sort.direction, run]);

  useEffect(() => {
    if (live.version !== 0) void run(applied.current, undefined);
  }, [live.version, run]);
  useEffect(() => () => { sequence.current++; }, []);

  useEffect(() => {
    if (cursor === undefined || busy || error !== "" || sentinel.current === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void run(applied.current, cursor);
    }, { root: panel.current, rootMargin: PREFETCH_MARGIN });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [cursor, busy, error, run]);

  function apply(state: BrowseState) {
    // Invalidate an in-flight page before the hashchange event can arrive.
    pending.current = ++sequence.current;
    continuation.current = undefined;
    setBusy(true);
    applied.current = state;
    const hash = browseHash(state, inbox);
    if (location.hash !== hash) { location.hash = hash; return; }
    void run(state, undefined);
  }

  function changeSort(field: SearchSortField) {
    const direction = sort.field === field ? sort.direction === "asc" ? "desc" : "asc" : field === "modified-at" || field === "revision" ? "desc" : "asc";
    const next: SearchSort = { field, direction };
    setSort(next);
    apply({ ...applied.current, sort: next });
  }

  function sortHeader(field: SearchSortField, label: string) {
    return <th key={field} scope="col" aria-sort={sort.field === field ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
      <button type="button" className="sort-header" aria-label={`Sort by ${label}`} onClick={() => changeSort(field)}>
        {label}<span aria-hidden="true">{sort.field === field ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span>
      </button>
    </th>;
  }

  return (
    <section className="browse-view" aria-label="Browse" aria-busy={busy}>
      <div className="page-heading"><div>
        <h1>{inbox ? "Attention inbox" : initial.query === "type:skill-draft" ? "Skill candidates" : initial.archive === "only" ? "Archive" : initial.query.includes("github-") ? "Upstream activity" : "Records"}</h1>
        <p>{inbox ? "Records requiring review." : "Search by text, metadata, tags, or project."}</p></div></div>
      <form
        className="search-panel"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ query, project, archive, tag, sort });
        }}
      >
        <QueryInput value={query} onChange={setQuery} onAuthLost={onAuthLost} />
        <label>
          Project scope
          <input placeholder="All projects" value={project} onChange={(e) => setProject(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Tag filter
          <input placeholder="tag name (exact)" value={tag} onChange={(e) => setTag(e.target.value)} autoComplete="off" />
        </label>
        <fieldset className="archive-control">
          <legend>Archived</legend>
          <label>
            <input type="radio" name="archive" checked={archive === "hide"} onChange={() => setArchive("hide")} />
            Hide
          </label>
          <label>
            <input type="radio" name="archive" checked={archive === "show"} onChange={() => setArchive("show")} />
            Show
          </label>
          <label>
            <input type="radio" name="archive" checked={archive === "only"} onChange={() => setArchive("only")} />
            Only archived
          </label>
        </fieldset>
        <div className="search-actions"><button className="primary" type="submit">Search</button></div>
      </form>
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
      <p id="records-scroll-help" className="scroll-help">Scroll the table to load more records. Select a column heading to sort all results.</p>
      {error !== "" && <p role="alert">{error} {diagnostics.length === 0 && <button type="button" onClick={() => void run(applied.current, cursor)}>Retry loading records</button>}</p>}
      {items.length === 0 && !busy && error === "" && <div className="empty-state"><Icon name={inbox ? "inbox" : "search"} /><h3>{inbox ? "No records requiring review" : "No records found"}</h3><p>{inbox ? "Records requiring attention appear here." : "Try a different query or include archived records."}</p></div>}
        <div className="records-panel" ref={panel} role="region" aria-label="Record results" aria-describedby="records-scroll-help" tabIndex={0}><table>
          <thead>
            <tr>
              {SORT_COLUMNS.slice(0, 6).map((column) => sortHeader(column.field, column.label))}
              <th scope="col">Tags</th>
              {SORT_COLUMNS.slice(6).map((column) => sortHeader(column.field, column.label))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={summaryKey(item)}>
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
        {cursor !== undefined && error === "" && <button type="button" disabled={busy} onClick={() => void run(applied.current, cursor)}>Load more records</button>}
      </div>
    </section>
  );
}
