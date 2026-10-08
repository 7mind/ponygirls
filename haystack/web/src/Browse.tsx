import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, AuthError, NetworkError, summaryKey, type Summary } from "./api";
import { useLiveUpdates } from "./Live";
import { Icon } from "./Icon";
import { QueryInput } from "./QueryInput";

export type ArchiveMode = "hide" | "show" | "only";

export interface BrowseState {
  query: string;
  project: string;
  archive: ArchiveMode;
}

/** Compose the archive control with the query AST (never a contradictory
 *  appended filter): an explicit selector anywhere disables the default. */
export function composedQuery(state: BrowseState): string {
  const q = state.query.trim();
  if (state.archive === "hide") return q;
  if (state.archive === "show") return q === "" ? "archived:all" : `archived:all (${q})`;
  return q === "" ? "archived:true" : `archived:true (${q})`;
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
  const [items, setItems] = useState<Summary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  // Cursors that produced each visited page; trail[0] is the first page.
  const [trail, setTrail] = useState<Array<string | undefined>>([undefined]);
  const [diagnostics, setDiagnostics] = useState<Array<{ message: string; start: number; end: number }>>([]);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const applied = useRef(initial);
  const live = useLiveUpdates();

  const run = useCallback(async (state: BrowseState, cursorValue: string | undefined) => {
    const request = ++sequence.current;
    setBusy(true);
    setStatus("Searching…");
    setDiagnostics([]);
    try {
      const page = await api.search(composedQuery(state), {
        project: state.project.trim() === "" ? undefined : state.project.trim(),
        limit: 20,
        cursor: cursorValue,
      });
      if (request !== sequence.current) return;
      setItems(page.items);
      setCursor(page.cursor);
      setStatus(page.items.length === 0 ? "No matching items." : "");
    } catch (err) {
      if (request !== sequence.current) return;
      if (err instanceof AuthError) {
        onAuthLost();
        return;
      }
      if (err instanceof NetworkError) {
        setStatus("Server unreachable — the service may be down.");
        return;
      }
      if (err instanceof ApiError && err.code === "invalid-query") {
        setDiagnostics(err.spans ?? []);
        setItems([]);
        setStatus("");
        return;
      }
      setStatus(`Search failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }, [onAuthLost]);

  useEffect(() => {
    const state = { query: initial.query, project: initial.project, archive: initial.archive };
    // A submitted route can arrive after the user starts a newer draft.
    const submitted = state.query === applied.current.query && state.project === applied.current.project && state.archive === applied.current.archive;
    if (!submitted) { setQuery(state.query); setProject(state.project); setArchive(state.archive); }
    applied.current = state; setTrail([undefined]);
    void run(state, undefined);
  }, [initial.query, initial.project, initial.archive, run]);

  useEffect(() => {
    if (live.version === 0) return;
    setTrail([undefined]);
    void run(applied.current, undefined);
  }, [live.version, run]);
  useEffect(() => () => { sequence.current++; }, []);

  function submit() {
    const state = { query, project, archive };
    applied.current = state;
    if (!inbox) {
      const params = new URLSearchParams();
      if (query !== "") params.set("q", query);
      if (project !== "") params.set("project", project);
      if (archive !== "hide") params.set("archive", archive);
      const hash = `#/browse${params.size > 0 ? `?${params.toString()}` : ""}`;
      if (location.hash !== hash) { location.hash = hash; return; }
    }
    setTrail([undefined]); void run(state, undefined);
  }

  return (
    <section className="browse-view" aria-label="Browse" aria-busy={busy}>
      <div className="page-heading"><div>
        <h1>{inbox ? "Attention inbox" : initial.query === "type:skill-draft" ? "Skill candidates" : initial.archive === "only" ? "Archive" : initial.query.includes("github-") ? "Upstream activity" : "Records"}</h1>
        <p>{inbox ? "Records requiring review." : "Search by text, metadata, or project."}</p></div></div>
      <form
        className="search-panel"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <QueryInput value={query} onChange={setQuery} onAuthLost={onAuthLost} />
        <label>
          Project scope
          <input placeholder="All projects" value={project} onChange={(e) => setProject(e.target.value)} autoComplete="off" />
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
      <div className="results-heading"><h2>{inbox ? "Waiting for review" : "Records"} <span className="count-badge">{items.length}{cursor !== undefined && "+"}</span></h2><span>Page {trail.length} · ordered by record key</span></div>
      {status !== "" && <p role="status" className="notice">{status}</p>}
      {items.length === 0 && !busy && diagnostics.length === 0 && <div className="empty-state"><Icon name={inbox ? "inbox" : "search"} /><h3>{inbox ? "No records requiring review" : "No records found"}</h3><p>{inbox ? "Records requiring attention appear here." : "Try a different query or include archived records."}</p></div>}
      {items.length > 0 && (
        <div className="records-panel"><table>
          <thead>
            <tr>
              <th scope="col">Record</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Priority</th>
              <th scope="col">Attention</th>
              <th scope="col">Modified</th>
              <th scope="col">Rev</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={summaryKey(item)}>
                <td>
                  <button className="record-open" type="button" aria-label={summaryKey(item)} onClick={() => onOpen(summaryKey(item))}>
                    <span className={`record-icon type-${item.type}`}><Icon name={item.type === "skill-draft" ? "spark" : item.type.startsWith("github-") ? "branch" : "stack"} /></span>
                    <span><strong>{item.title}</strong><small>{item.project}:{item.item}</small></span>
                  </button>
                </td>
                <td data-label="Type"><span className="type-badge">{item.type}</span></td>
                <td data-label="Status"><span className={`status-badge ${item.status === "archived" ? "archived" : ""}`}>{item.status}</span></td>
                <td data-label="Priority"><span className={`priority ${item.importance === "high" ? "high" : ""}`}>{item.importance}</span></td>
                <td data-label="Attention"><span className={`attention-badge ${item.humanAttention === "required" ? "required" : ""}`}>{item.humanAttention === "required" ? "Needs review" : "Reviewed"}</span></td>
                <td data-label="Modified" className="modified-cell">
                  <span>{item.modifiedBy}</span><time dateTime={item.modifiedAt} title={item.modifiedAt}>{new Date(item.modifiedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
                </td>
                <td data-label="Revision">{item.revision}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <div className="pagination">
        <button
          type="button"
          disabled={trail.length <= 1}
          onClick={() => {
            const next = trail.slice(0, -1);
            setTrail(next);
            void run(applied.current, next[next.length - 1]);
          }}
        >
          Back
        </button>
        <button
          type="button"
          disabled={cursor === undefined}
          onClick={() => {
            if (cursor !== undefined) {
              setTrail((t) => [...t, cursor]);
              void run(applied.current, cursor);
            }
          }}
        >
          Next
        </button>
      </div>
    </section>
  );
}
