import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, ApiError, AuthError, NetworkError, uuidv7, type Item, type RevisionMeta } from "./api";
import { useLiveUpdates } from "./Live";
import { UiIcon } from "./Masthead";
import { ConfirmDialog } from "./ConfirmDialog";
import { FieldsEditor } from "./FieldsEditor";
import { LinksEditor } from "./LinksEditor";
import { HistoryCard, MetadataCard } from "./RecordEditRail";
import { PRESETS, type Preset } from "./browse-state";
import { drafts } from "./edit-drafts";
import { changedParts, documentJsonOf, draftOf, isRemoteChange, problemsOf, type Draft } from "./edit-draft";
import { useLeaveGuard } from "./leave-guard";
import { itemHash } from "./router";

interface Conflict {
  currentRevision: number;
  currentTitle: string;
  currentModifiedBy: string;
  currentModifiedAt: string;
}

const WHEN: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const projectOf = (key: string): string => decodeURIComponent(key.slice(0, key.indexOf(":")));
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const listOf = (parts: readonly string[]): string => parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
function failureText(error: unknown): string {
  if (error instanceof NetworkError) return "server unreachable — the service may be down";
  return error instanceof Error ? error.message : "unknown";
}

export function RecordEdit({ itemKey, item, revisions, origin, onItem, onSaved, onBack, onCancel, onViewRevision, onDiscard, onAuthLost }: {
  /** The route's key; live change announcements name records by it. */
  itemKey: string;
  /** The latest revision known; replaced through `onItem` when a conflicting save reads the winner. */
  item: Item;
  /** The record's history, for context; null when it could not be read. */
  revisions: readonly RevisionMeta[] | null;
  /** The list the record was opened from. */
  origin: Preset;
  onItem: (item: Item) => void;
  /** A save succeeded as `revision`. */
  onSaved: (revision: number) => Promise<void>;
  /** Leaves for the originating list. */
  onBack: () => void;
  /** Closes the editor for the record page. */
  onCancel: () => void;
  /** Closes the editor and shows an earlier revision of the record page, compared with the latest. */
  onViewRevision: (revision: number) => void;
  /** Drops the draft and reloads the record. */
  onDiscard: () => void;
  onAuthLost: () => void;
}) {
  // A draft left behind by an earlier visit (the router unmounts the editor however the reader left) is restored.
  const [restored] = useState(() => drafts.get(itemKey));
  const lastId = useRef(restored === undefined ? 0 : restored.lastId);
  const nextId = useCallback(() => ++lastId.current, []);
  const [lineage] = useState(() => restored === undefined ? drafts.lineage() : restored.lineage);
  const [base, setBase] = useState<Draft>(() => restored === undefined ? draftOf(item, nextId) : restored.base);
  const [draft, setDraft] = useState<Draft>(() => restored === undefined ? draftOf(item, nextId) : restored.draft);
  const [baseRevision, setBaseRevision] = useState(restored === undefined ? item.revision : restored.baseRevision);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // The record moved on while the draft was away: the remote-change presentation, never a silent rebase.
  const [remote, setRemote] = useState<{ revision: number | null } | null>(() => restored !== undefined && item.revision > restored.baseRevision ? { revision: item.revision } : null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [leaving, setLeaving] = useState<{ run: () => void } | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const pending = useSyncExternalStore(api.subscribePendingWrite, api.pendingWrite);
  const live = useLiveUpdates();
  // Only changes announced after the editor opened can concern this draft.
  const openedAt = useRef(live.version);
  const formId = useId();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const parts = useMemo(() => changedParts(base, draft), [base, draft]);
  const problems = useMemo(() => problemsOf(draft), [draft]);
  const dirty = parts.length > 0;
  const canSave = dirty && problems.length === 0 && conflict === null && pending === undefined && !saving;
  // A write is pending from the moment it is sent; it is unconfirmed once its attempt has ended without an answer.
  const unconfirmed = saving ? undefined : pending;

  useEffect(() => {
    if (live.version === openedAt.current) return;
    // The draft's base may be newer than `item`: the reader's own save that the editor stayed open after.
    if (isRemoteChange(live, { key: itemKey, revision: Math.max(item.revision, baseRevision) }, pending)) setRemote({ revision: live.revision });
  }, [live.version]);

  // Written through on every change; nothing removes it but a confirmed save or an explicit discard (not unmounting).
  useEffect(() => {
    if (dirty) drafts.put(itemKey, lineage, { base, draft, baseRevision, lastId: lastId.current });
    else drafts.drop(itemKey);
  }, [dirty, draft, base, baseRevision]);

  // A save of this draft was confirmed, by its own answer or a replay, possibly sent by an earlier editor of the draft: what
  // was saved is the new base, so that later edits save on top of it.
  useEffect(() => drafts.subscribeConfirmed((confirmation) => {
    if (confirmation.key !== itemKey || confirmation.lineage !== lineage) return;
    setBase(confirmation.draft); setBaseRevision(confirmation.revision);
    if (confirmation.kept) setReconciled(`Saved as revision ${confirmation.revision}. Your later changes are kept and are now based on it.`);
  }), [itemKey, lineage]);

  useEffect(() => {
    if (focusId === null) return;
    const control = document.getElementById(focusId);
    if (control === null) throw new Error(`No control ${focusId} to focus`);
    control.focus();
    setFocusId(null);
  }, [focusId]);

  // Every way out first removes the guard's history entry, so that the router's own history arithmetic is undisturbed.
  const guard = useLeaveGuard(dirty, unconfirmed !== undefined, (hash) => leave(() => { location.hash = hash; }), () => setLeaving({ run: () => history.back() }));
  const exit = (action: () => void) => { void guard.release().then(action); };
  const leave = (action: () => void) => { if (dirty) setLeaving({ run: action }); else exit(action); };

  async function submit(revision: number) {
    setSaving(true); setFailure(null); setReconciled(null);
    try {
      const requestId = uuidv7();
      drafts.submit(itemKey, lineage, requestId, { base, draft, baseRevision: revision, lastId: lastId.current });
      // The fields text is spliced raw into the document: edited big integers never round-trip.
      const out = await api.put(item.key, documentJsonOf(draft), revision, requestId);
      // The store ended the saved draft (`drafts.confirmed`). Edits made since keep the editor open; one that was left stays closed.
      if (!mounted.current || drafts.get(itemKey) !== undefined) return;
      await guard.release();
      await onSaved(out.revision);
    } catch (error) {
      if (error instanceof AuthError) { onAuthLost(); return; }
      if (error instanceof ApiError && error.code === "conflict") {
        // Stale save: keep the draft, show the winner.
        try {
          const latest = await api.get(item.key);
          setConflict({ currentRevision: latest.revision, currentTitle: latest.document.title, currentModifiedBy: latest.metadata.modifiedBy, currentModifiedAt: latest.metadata.modifiedAt });
          onItem(latest);
        } catch (readError) {
          if (readError instanceof AuthError) { onAuthLost(); return; }
          setFailure("Save conflicted and the latest revision is unreadable.");
        }
        return;
      }
      // A failure that leaves the outcome unknown is shown by the unconfirmed-write notice, not as a failure of its own.
      if (api.pendingWrite() === undefined) setFailure(`Save failed: ${failureText(error)}`);
    } finally { setSaving(false); }
  }

  /** Certain conflict: saving on top of the winner is a NEW operation (fresh id) based on the latest revision. */
  function overwrite() {
    setConflict(null); setBaseRevision(item.revision);
    void submit(item.revision);
  }

  async function retryOriginal() {
    setRetrying(true); setFailure(null); setReconciled(null);
    try {
      const result = await api.retryPendingWrite();
      setReconciled(`Original write confirmed as revision ${result.revision}. Any newer draft is preserved; review it before saving.`);
    } catch (error) {
      if (error instanceof AuthError) { onAuthLost(); return; }
      setFailure(`Replay did not complete: ${failureText(error)}`);
    } finally { setRetrying(false); }
  }

  const modifiedAt = (value: string) => { const at = new Date(value); return Number.isNaN(at.getTime()) ? value : new Intl.DateTimeFormat(undefined, WHEN).format(at); };
  const status = unconfirmed !== undefined ? <span className="chip"><span className="status status-warn">Save not confirmed</span></span> :
    conflict !== null ? <span className="chip chip-danger">Conflict with revision {conflict.currentRevision}</span> :
    problems.length > 0 ? <span className="chip chip-danger">{plural(problems.length, "problem")}</span> :
    dirty ? <span className="chip"><span className="status">Unsaved changes</span></span> : <span>No changes yet</span>;
  const backLabel = `Back to ${PRESETS[origin].label}`;

  return <div className="edit-page" data-record="editing">
    <div className="viewbar record-bar edit-bar" role="toolbar" aria-label="Edit record">
      <button type="button" className="btn btn-ghost btn-icon record-back" aria-label={backLabel} title={`${backLabel} — asks before discarding unsaved changes`}
        onClick={() => leave(onBack)}><UiIcon name="arrow-left" /></button>
      <span className="bar-divider" />
      <span className="record-type" data-family="work" aria-hidden="true"><UiIcon name="edit" /></span>
      <div className="record-head"><h1 className="record-title" title={base.title}>{base.title}</h1>
        <div className="record-sub"><span className="chip chip-accent">Editing</span><span className="mono">{itemKey}</span><span className="sep">based on revision {baseRevision}</span></div></div>
      <div className="bar-status" role="status">{status}</div>
      <button type="button" className="btn" onClick={() => leave(onCancel)}>Cancel</button>
      <button type="submit" form={formId} className="btn btn-primary" disabled={!canSave}>
        {saving ? <span className="spinner" aria-hidden="true" /> : <UiIcon name="check" />}<span>Save<span className="edit-save-rest"> as new revision</span></span></button>
    </div>
    <div className="page"><div className="page-narrow with-rail">
      <form id={formId} className="record-main" aria-label="Record" onSubmit={(event) => { event.preventDefault(); if (canSave) void submit(baseRevision); }}>
        {problems.length > 0 && <div className="notice notice-danger" role="alert"><UiIcon name="alert" /><div className="grow">
          <div className="notice-title">{plural(problems.length, "problem")} prevent{problems.length === 1 ? "s" : ""} saving</div>
          Nothing was sent to the server. Fix {problems.length === 1 ? "it" : "these"} and save again:
          <ul className="error-list">{problems.map((problem, index) => <li key={index}>
            <button type="button" className="link-button" onClick={() => setFocusId(problem.anchor)}>{problem.where}: {problem.message}</button></li>)}</ul></div></div>}
        {restored !== undefined && <div className="notice notice-row" role="status"><UiIcon name="info" /><div className="grow">
          <span className="notice-title">Unsaved draft restored — started from revision {restored.baseRevision}.</span> It was kept when this page was left.</div>
          <button type="button" className="btn btn-sm" onClick={() => setDiscarding(true)}>Discard draft</button></div>}
        {failure !== null && unconfirmed === undefined && <div className="notice notice-danger" role="alert"><UiIcon name="alert" /><div className="grow">{failure}</div></div>}
        {remote !== null && conflict === null && <div className="notice" role="status"><UiIcon name="info" /><div className="grow">
          <span className="notice-title">{remote.revision === null ? "This record may have changed elsewhere." : `Revision ${remote.revision} was saved elsewhere.`}</span>{" "}
          Your draft is kept and is still based on revision {baseRevision}; saving checks that revision and asks how to combine the two if the record has moved on.
          <div className="notice-actions"><a className="btn btn-sm" href={itemHash(itemKey, false)} target="_blank" rel="noopener noreferrer" title="Opens the record in a new tab">Review their changes</a></div></div></div>}
        {conflict !== null && <div className="notice notice-warn" role="alert"><UiIcon name="alert" /><div className="grow">
          <div className="notice-title">Revision {conflict.currentRevision} was saved by {conflict.currentModifiedBy} while you were editing</div>
          {modifiedAt(conflict.currentModifiedAt)} · title now “{conflict.currentTitle}”. Your draft was <strong>not</strong> saved; it is kept below and is still based on revision {baseRevision}.
          <div className="notice-actions">
            <a className="btn btn-sm btn-primary" href={itemHash(itemKey, false)} target="_blank" rel="noopener noreferrer" title="Opens the record in a new tab">Review their changes</a>
            <button type="button" className="btn btn-sm" disabled={saving || problems.length > 0} onClick={overwrite}>Overwrite as revision {conflict.currentRevision + 1}</button>
            <button type="button" className="btn btn-sm btn-danger-quiet" onClick={() => setDiscarding(true)}>Discard mine</button></div></div></div>}
        {unconfirmed !== undefined && <div className="notice notice-warn" role="alert"><UiIcon name="alert" /><div className="grow">
          <div className="notice-title">The outcome of your save is unknown</div>
          The write to <span className="mono">{unconfirmed.key}</span> was sent but no answer arrived, so it may or may not be stored as revision {unconfirmed.expectedRevision + 1}.
          Other writes are blocked until this is settled; your draft is kept. Retrying sends exactly the same payload and request id, so it cannot save twice.
          {failure !== null && <p className="notice-detail">{failure}</p>}
          <div className="notice-actions"><button type="button" className="btn btn-sm btn-primary" disabled={retrying} onClick={() => void retryOriginal()}>
            <UiIcon name="refresh" small />Retry original write</button></div></div></div>}
        {reconciled !== null && unconfirmed === undefined && <div className="notice notice-ok" role="status"><UiIcon name="check-circle" /><div className="grow">{reconciled}</div></div>}

        <div className="form-stack">
          <div className="field"><label className="label" htmlFor={`${formId}-title`}>Title</label>
            <input className="input input-title" id={`${formId}-title`} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div>
          <div className="field"><label className="label" htmlFor={`${formId}-description`}>Description</label>
            <textarea className="textarea textarea-auto" id={`${formId}-description`} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            <span className="hint">Plain text. Shown in full on the record page and searched.</span></div>
        </div>

        <FieldsEditor fields={draft.fields} nextId={nextId} problems={problems} onChange={(fields) => setDraft({ ...draft, fields })} onFocusRequest={setFocusId} />
        <LinksEditor links={draft.links} nextId={nextId} problems={problems} onChange={(links) => setDraft({ ...draft, links })} onFocusRequest={setFocusId} onAuthLost={onAuthLost} />
      </form>
      <aside className="rail rail-sticky" aria-label="Metadata and history">
        <MetadataCard project={projectOf(itemKey)} metadata={draft} onChange={(patch) => setDraft({ ...draft, ...patch })} />
        <HistoryCard revisions={revisions} onView={(revision) => leave(() => onViewRevision(revision))} />
      </aside>
    </div></div>
    {leaving !== null && <ConfirmDialog title="Discard unsaved changes?" confirmLabel="Discard changes" cancelLabel="Keep editing" danger busy={false}
      onConfirm={() => { const { run } = leaving; setLeaving(null); drafts.drop(itemKey); exit(run); }} onCancel={() => setLeaving(null)}>
      <p>You changed <strong>{listOf(parts)}</strong> of <span className="mono nowrap">{itemKey}</span>. Leaving now loses these changes; nothing has been saved.</p>
    </ConfirmDialog>}
    {discarding && <ConfirmDialog title="Discard your draft?" confirmLabel="Discard draft and reload" cancelLabel="Keep my draft" danger busy={false}
      onConfirm={() => { setDiscarding(false); drafts.drop(itemKey); exit(onDiscard); }} onCancel={() => setDiscarding(false)}>
      <p>Your changes to <span className="mono nowrap">{itemKey}</span> are dropped and revision {item.revision} is loaded. Nothing of your draft was saved.</p>
    </ConfirmDialog>}
  </div>;
}
