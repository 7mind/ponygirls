import { useCallback, useEffect, useState } from "react";
import { api, ApiError, AuthError, NetworkError, type Summary } from "./api";

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

export function Browse({ initial, onOpen, onAuthLost }: {
  initial: BrowseState;
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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");

  const run = useCallback(async (cursorValue?: string) => {
    setStatus("Searching…");
    setDiagnostics([]);
    try {
      const page = await api.search(composedQuery({ query, project, archive }), {
        project: project.trim() === "" ? undefined : project.trim(),
        limit: 20,
        cursor: cursorValue,
      });
      setItems(page.items);
      setCursor(page.cursor);
      setStatus(page.items.length === 0 ? "No matching items." : "");
    } catch (err) {
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
    }
  }, [query, project, archive, onAuthLost]);

  // Persist UI state in the fragment (never sent to the server).
  useEffect(() => {
    const params = new URLSearchParams();
    if (query !== "") params.set("q", query);
    if (project !== "") params.set("project", project);
    if (archive !== "hide") params.set("archive", archive);
    location.hash = `#/browse${params.size > 0 ? `?${params.toString()}` : ""}`;
  }, [query, project, archive]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onComplete() {
    try {
      const out = await api.complete(query, query.length);
      setSuggestions(out.suggestions.slice(0, 20));
    } catch {
      setSuggestions([]);
    }
  }

  return (
    <section aria-label="Browse">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTrail([undefined]);
          void run();
        }}
      >
        <label>
          Query
          <input value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Project scope
          <input value={project} onChange={(e) => setProject(e.target.value)} autoComplete="off" />
        </label>
        <fieldset>
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
        <button type="submit">Search</button>
        <button type="button" onClick={() => void onComplete()}>
          Suggest
        </button>
      </form>
      {suggestions.length > 0 && (
        <ul aria-label="Suggestions">
          {suggestions.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => setQuery(s)}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
      {diagnostics.length > 0 && (
        <ul aria-label="Search errors">
          {diagnostics.map((d, i) => (
            <li key={i}>
              {d.message} [{d.start},{d.end})
            </li>
          ))}
        </ul>
      )}
      {status !== "" && <p role="status">{status}</p>}
      {items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Importance</th>
              <th scope="col">Attention</th>
              <th scope="col">Modified</th>
              <th scope="col">Rev</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.project}:${item.item}`}>
                <td>
                  <button type="button" onClick={() => onOpen(`${item.project}:${item.item}`)}>
                    {item.project}:{item.item}
                  </button>
                </td>
                <td>{item.title}</td>
                <td>{item.type}</td>
                <td>{item.status}</td>
                <td>{item.importance}</td>
                <td>{item.humanAttention}</td>
                <td>
                  {item.modifiedBy} {item.modifiedAt}
                </td>
                <td>{item.revision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        <button
          type="button"
          disabled={trail.length <= 1}
          onClick={() => {
            const next = trail.slice(0, -1);
            setTrail(next);
            void run(next[next.length - 1]);
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
              void run(cursor);
            }
          }}
        >
          Next
        </button>
      </div>
    </section>
  );
}
