import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, AuthError, NetworkError, buildDocumentJson, uuidv7, summaryKey, type Item, type RevisionMeta, type Summary } from "./api";
import { useLiveUpdates } from "./Live";
import { Icon } from "./Icon";
import { FieldsView } from "./FieldsView";

interface Conflict {
  currentRevision: number;
  currentTitle: string;
  currentModifiedBy: string;
  currentModifiedAt: string;
}

export function Detail({ itemKey, onBack, onAuthLost }: {
  itemKey: string;
  onBack: () => void;
  onAuthLost: () => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "", type: "", status: "", importance: "", attention: "cleared", fieldsJson: "", linksText: "" });
  const [incoming, setIncoming] = useState<Summary[]>([]);
  const [incomingNote, setIncomingNote] = useState("");
  const [history, setHistory] = useState<RevisionMeta[]>([]);
  const [snapshot, setSnapshot] = useState<Item | null>(null);
  const [compareWith, setCompareWith] = useState<Item | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [status, setStatus] = useState("");
  const [targetStatus, setTargetStatus] = useState("");
  const [remoteUpdate, setRemoteUpdate] = useState(false);
  const editRevision = useRef<number | null>(null);
  const live = useLiveUpdates();

  const load = useCallback(async (keepStatus = false) => {
    if (!keepStatus) setStatus("Loading…");
    try {
      const got = await api.get(itemKey);
      setItem(got);
      // A refreshing load after save/restore/clear must not wipe the outcome.
      if (!keepStatus) setStatus("");
      try {
        const page = await api.search(`linked-to:"${got.key}"`, { limit: 100 });
        setIncoming(page.items);
        setIncomingNote("");
      } catch {
        setIncoming([]);
        setIncomingNote("Incoming links unavailable.");
      }
      try {
        setHistory((await api.history(itemKey)).revisions);
      } catch {
        setHistory([]);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        onAuthLost();
        return;
      }
      setStatus(err instanceof NetworkError ? "Server unreachable — the service may be down." : "Item not found or unreadable.");
    }
  }, [itemKey, onAuthLost]);

  useEffect(() => {
    location.hash = `#/item/${encodeURIComponent(itemKey)}`;
    setEditing(false);
    setConflict(null);
    setSnapshot(null);
    setCompareWith(null);
    void load();
  }, [itemKey, load]);

  useEffect(() => {
    if (live.version === 0) return;
    if (editing) {
      if (live.key === null || (live.key === itemKey && item !== null && live.revision !== null && live.revision > item.revision)) setRemoteUpdate(true);
      return;
    }
    void load(true);
  }, [live.version, load]);

  function startEdit() {
    if (item === null) return;
    setDraft({
      title: item.document.title,
      description: item.document.description,
      type: item.document.type,
      status: item.document.status,
      importance: item.document.importance,
      attention: item.document.humanAttention,
      fieldsJson: item.document.fieldsJson,
      linksText: item.document.links.map(([t, target]) => `${t} ${target}`).join("\n"),
    });
    setConflict(null);
    editRevision.current = item.revision;
    setRemoteUpdate(false);
    setEditing(true);
  }

  function parseLinks(text: string): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const space = trimmed.search(/\s/);
      if (space < 0) throw new Error(`link line needs "type target": ${trimmed}`);
      out.push([trimmed.slice(0, space), trimmed.slice(space).trim()]);
    }
    return out;
  }

  async function save() {
    if (item === null) return;
    setStatus("Saving…");
    let links: Array<[string, string]>;
    try {
      links = parseLinks(draft.linksText);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Bad links.");
      return;
    }
    let documentJson: string;
    try {
      // fieldsJson spliced raw: edited big integers never round-trip.
      documentJson = buildDocumentJson({
        title: draft.title,
        description: draft.description,
        fieldsRaw: draft.fieldsJson,
        type: draft.type,
        status: draft.status,
        importance: draft.importance,
        attention: draft.attention,
        links,
      });
    } catch {
      setStatus("fields is not valid JSON.");
      return;
    }
    try {
      if (editRevision.current === null) throw new Error("Missing edit revision");
      const out = await api.put(item.key, documentJson, editRevision.current, uuidv7());
      setConflict(null);
      setEditing(false);
      setRemoteUpdate(false);
      setStatus(`Saved as revision ${out.revision}.`);
      await load(true);
    } catch (err) {
      if (err instanceof AuthError) {
        onAuthLost();
        return;
      }
      if (err instanceof ApiError && err.code === "conflict") {
        // Stale save: keep the draft, show the winner.
        try {
          const latest = await api.get(item.key);
          setConflict({
            currentRevision: latest.revision,
            currentTitle: latest.document.title,
            currentModifiedBy: latest.metadata.modifiedBy,
            currentModifiedAt: latest.metadata.modifiedAt,
          });
          setItem(latest);
          setStatus("Someone else saved first — your draft is preserved below.");
        } catch {
          setStatus("Save conflicted and the latest revision is unreadable.");
        }
        return;
      }
      setStatus(`Save failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function retryOnLatest() {
    // Certain-conflict retry is a NEW operation (fresh id) on the latest rev.
    if (item === null) return;
    setConflict(null);
    setStatus("Saving…");
    await saveWithRevision(item.revision);
  }

  async function saveWithRevision(revision: number) {
    if (item === null) return;
    let links: Array<[string, string]>;
    try {
      links = parseLinks(draft.linksText);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Bad links.");
      return;
    }
    let documentJson: string;
    try {
      // fieldsJson spliced raw: edited big integers never round-trip.
      documentJson = buildDocumentJson({
        title: draft.title,
        description: draft.description,
        fieldsRaw: draft.fieldsJson,
        type: draft.type,
        status: draft.status,
        importance: draft.importance,
        attention: draft.attention,
        links,
      });
    } catch {
      setStatus("fields is not valid JSON.");
      return;
    }
    try {
      const out = await api.put(item.key, documentJson, revision, uuidv7());
      setConflict(null);
      setEditing(false);
      setRemoteUpdate(false);
      setStatus(`Saved as revision ${out.revision}.`);
      await load(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") {
        setStatus("Conflicted again — reload and reconcile manually.");
        return;
      }
      setStatus(`Save failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function clearAttention() {
    if (item === null) return;
    const documentJson = buildDocumentJson({
      title: item.document.title,
      description: item.document.description,
      fieldsRaw: item.document.fieldsJson,
      type: item.document.type,
      status: item.document.status,
      importance: item.document.importance,
      attention: "cleared",
      links: item.document.links,
    });
    try {
      await api.put(item.key, documentJson, item.revision, uuidv7());
      setStatus("Attention cleared (attributed revision).");
      await load(true);
    } catch (err) {
      setStatus(`Clear failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function restore(revision: number) {
    if (item === null) return;
    try {
      const snap = await api.historyGet(item.key, revision);
      const documentJson = buildDocumentJson({
        title: snap.document.title,
        description: snap.document.description,
        fieldsRaw: snap.document.fieldsJson,
        type: snap.document.type,
        status: snap.document.status,
        importance: snap.document.importance,
        attention: snap.document.humanAttention,
        links: snap.document.links,
      });
      const out = await api.put(item.key, documentJson, item.revision, uuidv7());
      setStatus(`Restored revision ${revision} as new revision ${out.revision}.`);
      await load(true);
    } catch (err) {
      setStatus(`Restore failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  if (item === null) {
    return (
      <section aria-label="Item">
        <p role="status">{status === "" ? "Loading…" : status}</p>
        <button type="button" onClick={onBack}>Back</button>
      </section>
    );
  }

  return (
    <section className="detail-view" aria-label="Item">
      <button className="back-button quiet" type="button" onClick={onBack}><Icon name="arrow" />Back</button>
      <div className="page-heading"><div><p className="eyebrow">{item.key}</p><h1>{item.document.title}</h1>
      <p className="record-provenance">
        Revision {item.revision} · {item.metadata.modifiedBy} {item.metadata.modifiedAt}
        {item.document.status === "archived" && " · archived"}
      </p>
      </div><span className="heading-symbol"><Icon name={item.document.type === "skill-draft" ? "spark" : item.document.type.startsWith("github-") ? "branch" : "stack"} /></span></div>
      {item.document.type === "skill-draft" && (
        <p role="note">Skill draft awaiting human review — not installed, not active.</p>
      )}
      {status !== "" && <p role="status">{status}</p>}
      {editing && remoteUpdate && <p className="notice" role="status">This record may have changed elsewhere. Your draft is preserved; saving will check its original revision.</p>}
      {conflict !== null && (
        <div role="alert">
          <p>
            Conflict: revision {conflict.currentRevision} by {conflict.currentModifiedBy} at {conflict.currentModifiedAt} —
            “{conflict.currentTitle}”. Your draft text is preserved.
          </p>
          <button type="button" onClick={() => void retryOnLatest()}>
            Save my draft on top of revision {conflict.currentRevision}
          </button>
          <button type="button" onClick={() => { setConflict(null); setEditing(false); void load(); }}>
            Discard draft and reload
          </button>
        </div>
      )}
      {!editing ? (
        <div className="record-content">
          <p className="record-description">{item.document.description}</p>
          <dl className="metadata-grid">
            <dt>Type</dt><dd>{item.document.type}</dd>
            <dt>Status</dt><dd>{item.document.status}</dd>
            <dt>Importance</dt><dd>{item.document.importance}</dd>
            <dt>Attention</dt><dd>{item.document.humanAttention}</dd>
          </dl>
          <div className="detail-panel"><h3>Fields</h3>
          <FieldsView fieldsJson={item.document.fieldsJson} />
          </div><div className="relationship-columns"><div className="detail-panel"><h3>Outgoing links</h3>
          {item.document.links.length === 0 ? (
            <p>None.</p>
          ) : (
            <ul>
              {item.document.links.map(([t, target], i) => (
                <li key={i}>
                  {t} <LinkTarget target={target} />
                </li>
              ))}
            </ul>
          )}
          </div><div className="detail-panel"><h3>Incoming links</h3>
          {incomingNote !== "" ? (
            <p>{incomingNote}</p>
          ) : incoming.length === 0 ? (
            <p>None.</p>
          ) : (
            <ul>
              {incoming.map((s) => (
                <li key={summaryKey(s)}><a href={`#/item/${encodeURIComponent(summaryKey(s))}`}>{s.project}:{s.item} — {s.title}</a></li>
              ))}
            </ul>
          )}
          </div></div><div className="record-actions"><button className="primary" type="button" onClick={startEdit}>Edit</button>
          {item.document.humanAttention === "required" && (
            <button type="button" onClick={() => void clearAttention()}>Clear attention</button>
          )}
          </div>
        </div>
      ) : (
        <form
          className="editor-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>Title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Description<textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <label>Type<input value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} list="haystack-types" /></label>
          <label>Status<input value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} list="haystack-statuses" /></label>
          <label>Importance<input value={draft.importance} onChange={(e) => setDraft({ ...draft, importance: e.target.value })} list="haystack-importances" /></label>
          <label>
            Attention
            <select value={draft.attention} onChange={(e) => setDraft({ ...draft, attention: e.target.value })}>
              <option value="required">required</option>
              <option value="cleared">cleared</option>
            </select>
          </label>
          <label>
            Fields (raw JSON — numbers and Unicode preserved exactly)
            <textarea value={draft.fieldsJson} onChange={(e) => setDraft({ ...draft, fieldsJson: e.target.value })} rows={10} cols={60} aria-label="Fields JSON" />
          </label>
          <label>
            Links (one per line: “type project:item”)
            <textarea value={draft.linksText} onChange={(e) => setDraft({ ...draft, linksText: e.target.value })} rows={4} cols={60} aria-label="Links" />
          </label>
          <datalist id="haystack-types">
            <option value="todo" /><option value="fact" /><option value="github-issue" />
            <option value="github-pr" /><option value="skill-draft" /><option value="actual" />
          </datalist>
          <datalist id="haystack-statuses">
            <option value="actual" /><option value="archived" />
          </datalist>
          <datalist id="haystack-importances">
            <option value="high" /><option value="low" />
          </datalist>
          <button className="primary" type="submit">Save as new revision</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      )}
      <div className="detail-panel history-panel"><h3>Revision history</h3>
      {history.length === 0 ? (
        <p>No history loaded.</p>
      ) : (
        <ul>
          {history.map((h) => (
            <li key={h.revision}>
              r{h.revision} · {h.modifiedBy} {h.modifiedAt}
              <button type="button" onClick={() => void viewSnapshot(h.revision)}>View</button>
              <button type="button" onClick={() => void restore(h.revision)}>Restore as new revision</button>
            </li>
          ))}
        </ul>
      )}
      </div>
      {snapshot !== null && (
        <div>
          <h4>Snapshot r{snapshot.revision}</h4>
          <FieldsView fieldsJson={snapshot.document.fieldsJson} />
          <label>
            Compare with revision
            <select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)}>
              <option value="">—</option>
              {history.filter((h) => h.revision !== snapshot.revision).map((h) => (
                <option key={h.revision} value={h.revision}>r{h.revision}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void compareSelected()}>Compare</button>
          {compareWith !== null && (
            <div>
              <h4>r{snapshot.revision} vs r{compareWith.revision}</h4>
              <section aria-label="Snapshot A"><FieldsView fieldsJson={snapshot.document.fieldsJson} /></section>
              <section aria-label="Snapshot B"><FieldsView fieldsJson={compareWith.document.fieldsJson} /></section>
            </div>
          )}
        </div>
      )}
    </section>
  );

  async function viewSnapshot(revision: number) {
    try {
      setSnapshot(await api.historyGet(itemKey, revision));
      setCompareWith(null);
      setTargetStatus("");
    } catch {
      setStatus("Snapshot unreadable.");
    }
  }

  async function compareSelected() {
    if (targetStatus === "") return;
    try {
      setCompareWith(await api.historyGet(itemKey, Number(targetStatus)));
    } catch {
      setStatus("Comparison snapshot unreadable.");
    }
  }
}

function LinkTarget({ target }: { target: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.get(target).then(
      (item) => {
        if (live) setLabel(`${target} — ${item.document.title}${item.document.status === "archived" ? " (archived)" : ""}`);
      },
      () => {
        if (live) setLabel(`${target} (dangling)`);
      },
    );
    return () => {
      live = false;
    };
  }, [target]);
  return <a href={`#/item/${encodeURIComponent(target)}`}>{label ?? target}</a>;
}
