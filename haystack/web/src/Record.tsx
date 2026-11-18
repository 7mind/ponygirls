import { useCallback, useEffect, useState } from "react";
import { api, AuthError, NetworkError, buildDocumentJson, uuidv7, summaryKey, type Item, type RevisionMeta, type Summary } from "./api";
import { useLiveUpdates } from "./Live";
import { Icon } from "./Icon";
import { FieldsView } from "./FieldsView";
import { RecordEdit } from "./RecordEdit";

export function RecordPage({ itemKey, edit, onBack, onEdit, onEditDone, onAuthLost }: {
  itemKey: string;
  /** The edit route (#/item/<key>/edit) is current: the editor opens once the record is loaded. */
  edit: boolean;
  onBack: () => void;
  onEdit: () => void;
  onEditDone: () => void;
  onAuthLost: () => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [editing, setEditing] = useState(false);
  const [incoming, setIncoming] = useState<Summary[]>([]);
  const [incomingNote, setIncomingNote] = useState("");
  const [history, setHistory] = useState<RevisionMeta[]>([]);
  const [snapshot, setSnapshot] = useState<Item | null>(null);
  const [compareWith, setCompareWith] = useState<Item | null>(null);
  const [status, setStatus] = useState("");
  const [targetStatus, setTargetStatus] = useState("");
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
    setEditing(false);
    setSnapshot(null);
    setCompareWith(null);
    void load();
  }, [itemKey, load]);

  useEffect(() => {
    if (live.version === 0) return;
    // An open editor reports remote changes itself; the record is not reloaded under it.
    if (editing) return;
    void load(true);
  }, [live.version, load]);

  const loaded = item !== null;
  useEffect(() => {
    if (!edit) setEditing(false);
    else if (loaded) setEditing(true);
  }, [edit, loaded]);

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
      tags: item.document.tags,
    });
    try {
      await api.put(item.key, documentJson, item.revision, uuidv7());
      setStatus("Attention cleared (attributed revision).");
      await load(true);
    } catch (err) {
      if (err instanceof AuthError) { onAuthLost(); return; }
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
        tags: snap.document.tags,
      });
      const out = await api.put(item.key, documentJson, item.revision, uuidv7());
      setStatus(`Restored revision ${revision} as new revision ${out.revision}.`);
      await load(true);
    } catch (err) {
      if (err instanceof AuthError) { onAuthLost(); return; }
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
      {!editing ? (
        <div className="record-content">
          <p className="record-description">{item.document.description}</p>
          <dl className="metadata-grid">
            <dt>Type</dt><dd>{item.document.type}</dd>
            <dt>Status</dt><dd>{item.document.status}</dd>
            <dt>Importance</dt><dd>{item.document.importance}</dd>
            <dt>Attention</dt><dd>{item.document.humanAttention}</dd>
            <dt>Tags</dt><dd>{item.document.tags.length === 0 ? "None." : item.document.tags.join(", ")}</dd>
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
          </div></div><div className="record-actions"><button className="primary" type="button" onClick={onEdit}>Edit</button>
          {item.document.humanAttention === "required" && (
            <button type="button" onClick={() => void clearAttention()}>Clear attention</button>
          )}
          </div>
        </div>
      ) : (
        <RecordEdit itemKey={itemKey} item={item} onItem={setItem} onStatus={setStatus} onAuthLost={onAuthLost}
          onSaved={async (saved) => { setEditing(false); onEditDone(); setStatus(saved); await load(true); }}
          onCancel={() => { setEditing(false); onEditDone(); }}
          onDiscard={() => { setEditing(false); onEditDone(); void load(); }} />
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
