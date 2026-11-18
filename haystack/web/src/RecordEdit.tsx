import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, AuthError, buildDocumentJson, parseTagsInput, uuidv7, type Item } from "./api";
import { useLiveUpdates } from "./Live";
import { FieldsEditor } from "./FieldsEditor";
import { inspectFields } from "./fields";

interface Draft {
  title: string;
  description: string;
  type: string;
  status: string;
  importance: string;
  attention: string;
  fieldsJson: string;
  linksText: string;
  tagsText: string;
}

interface Conflict {
  currentRevision: number;
  currentTitle: string;
  currentModifiedBy: string;
  currentModifiedAt: string;
}

export function RecordEdit({ itemKey, item, onItem, onStatus, onSaved, onCancel, onDiscard, onAuthLost }: {
  /** The route's key; live change announcements name records by it. */
  itemKey: string;
  /** The record being edited; replaced through `onItem` when a conflicting save reads the latest revision. */
  item: Item;
  onItem: (item: Item) => void;
  onStatus: (status: string) => void;
  /** A save succeeded as `revision`. */
  onSaved: (revision: number) => Promise<void>;
  onCancel: () => void;
  onDiscard: () => void;
  onAuthLost: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    title: item.document.title,
    description: item.document.description,
    type: item.document.type,
    status: item.document.status,
    importance: item.document.importance,
    attention: item.document.humanAttention,
    fieldsJson: item.document.fieldsJson,
    linksText: item.document.links.map(([t, target]) => `${t} ${target}`).join("\n"),
    tagsText: item.document.tags.join(", "),
  }));
  const fieldsInspection = useMemo(() => inspectFields(draft.fieldsJson), [draft.fieldsJson]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [remoteUpdate, setRemoteUpdate] = useState(false);
  const editRevision = useRef<number>(item.revision);
  const live = useLiveUpdates();
  // Only changes announced after the editor opened can concern this draft.
  const openedAt = useRef(live.version);

  useEffect(() => {
    if (live.version === openedAt.current) return;
    if (live.key === null || (live.key === itemKey && live.revision !== null && live.revision > item.revision)) setRemoteUpdate(true);
  }, [live.version]);

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
    onStatus("Saving…");
    let links: Array<[string, string]>;
    try {
      links = parseLinks(draft.linksText);
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Bad links.");
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
        tags: parseTagsInput(draft.tagsText),
      });
    } catch {
      onStatus("fields is not valid JSON.");
      return;
    }
    try {
      const out = await api.put(item.key, documentJson, editRevision.current, uuidv7());
      setConflict(null);
      setRemoteUpdate(false);
      await onSaved(out.revision);
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
          onItem(latest);
          onStatus("Someone else saved first — your draft is preserved below.");
        } catch {
          onStatus("Save conflicted and the latest revision is unreadable.");
        }
        return;
      }
      onStatus(`Save failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function retryOnLatest() {
    // Certain-conflict retry is a NEW operation (fresh id) on the latest rev.
    setConflict(null);
    onStatus("Saving…");
    editRevision.current = item.revision;
    await saveWithRevision(item.revision);
  }

  async function saveWithRevision(revision: number) {
    let links: Array<[string, string]>;
    try {
      links = parseLinks(draft.linksText);
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Bad links.");
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
        tags: parseTagsInput(draft.tagsText),
      });
    } catch {
      onStatus("fields is not valid JSON.");
      return;
    }
    try {
      const out = await api.put(item.key, documentJson, revision, uuidv7());
      setConflict(null);
      setRemoteUpdate(false);
      await onSaved(out.revision);
    } catch (err) {
      if (err instanceof AuthError) { onAuthLost(); return; }
      if (err instanceof ApiError && err.code === "conflict") {
        onStatus("Conflicted again — reload and reconcile manually.");
        return;
      }
      onStatus(`Save failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  return (
    <>
      {remoteUpdate && <p className="notice" role="status">This record may have changed elsewhere. Your draft is preserved; saving will check its original revision.</p>}
      {conflict !== null && (
        <div role="alert">
          <p>
            Conflict: revision {conflict.currentRevision} by {conflict.currentModifiedBy} at {conflict.currentModifiedAt} —
            “{conflict.currentTitle}”. Your draft text is preserved.
          </p>
          <button type="button" disabled={fieldsInspection.error !== null} onClick={() => void retryOnLatest()}>
            Save my draft on top of revision {conflict.currentRevision}
          </button>
          <button type="button" onClick={() => { setConflict(null); onDiscard(); }}>
            Discard draft and reload
          </button>
        </div>
      )}
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
        <FieldsEditor raw={draft.fieldsJson} inspection={fieldsInspection} onChange={(fieldsJson) => setDraft({ ...draft, fieldsJson })} />
        <label>
          Tags (comma-separated)
          <input value={draft.tagsText} onChange={(e) => setDraft({ ...draft, tagsText: e.target.value })} placeholder="mcp, urgent" autoComplete="off" />
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
        <button className="primary" type="submit" disabled={fieldsInspection.error !== null}>Save as new revision</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </form>
    </>
  );
}
