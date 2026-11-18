import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { api, ApiError, AuthError, NetworkError, buildDocumentJson, uuidv7, summaryKey, type DocumentBody, type Item, type RevisionMeta, type Summary } from "./api";
import { useLiveUpdates } from "./Live";
import { FieldsJson, FieldsView, type CopyText } from "./FieldsView";
import { RecordEdit } from "./RecordEdit";
import { drafts } from "./edit-drafts";
import { UiIcon } from "./Masthead";
import { ConfirmDialog } from "./ConfirmDialog";
import { browseHash, DEFAULT_SORT, PRESETS, type Preset } from "./browse-state";
import { appendFilter } from "./query-edit";
import { focusMenu, menuKeys, useOverlay } from "./overlay";
import { itemHash } from "./router";
import { parseFields } from "./fields";
import { changedParts, compareRevisions, type Comparison, type DiffLine, type TextDiff } from "./revision-diff";

/** Incoming links are one search page (no server-side link summary; spec §9 decision 13). */
const INCOMING_LIMIT = 100;
const TYPE_ICONS: ReadonlyMap<string, string> = new Map([["fact", "layers"], ["todo", "list"], ["decision", "shield"], ["note", "file"],
  ["skill-draft", "sparkle"], ["github-issue", "hash"], ["github-pr", "branch"]]);
const DEFAULT_TYPE_ICON = "layers";
const TYPE_FAMILIES: ReadonlyMap<string, string> = new Map([["skill-draft", "work"], ["github-issue", "upstream"], ["github-pr", "upstream"]]);
/** Blank lines separate description paragraphs; single line breaks stay inside a paragraph. */
const PARAGRAPH_BREAK = /\n\s*\n/;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Load = { kind: "loading" } | { kind: "ready"; item: Item } | { kind: "missing" } | { kind: "failed"; message: string };
type Incoming = { kind: "loading" } | { kind: "loaded"; items: readonly Summary[]; more: boolean } | { kind: "unavailable" };
type History = { kind: "loading" } | { kind: "loaded"; revisions: readonly RevisionMeta[] } | { kind: "unavailable" };
/** A revision viewed read-only, and the revision it is compared with (null: shown alone). */
interface Snapshot { readonly item: Item; readonly compare: Item | null }
interface Toast { readonly text: string; readonly action: { readonly label: string; readonly run: () => void } | null }

/** A timestamp as shown (spec §5 rule 9): local `Nov 17, 21:08`, a relative sub-line, ISO with the zone for the tooltip. */
interface When { readonly absolute: string; readonly relative: string; readonly iso: string }
function when(value: string, now: number): When {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { absolute: value, relative: "", iso: value };
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const absolute = new Intl.DateTimeFormat(undefined, { year: sameYear ? undefined : "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  const age = now - date.getTime();
  const relative = age < MINUTE_MS ? "just now" : age < HOUR_MS ? `${Math.floor(age / MINUTE_MS)} min ago` :
    age < DAY_MS ? `${Math.floor(age / HOUR_MS)} h ago` : `${Math.floor(age / DAY_MS)} ${age < 2 * DAY_MS ? "day" : "days"} ago`;
  return { absolute, relative, iso };
}

function failureText(error: unknown): string {
  if (error instanceof NetworkError) return "server unreachable — the service may be down";
  return error instanceof Error ? error.message : "unknown";
}

const browseQueryHash = (query: string) => browseHash({ query, sort: DEFAULT_SORT, migrationError: null }, "browse");
/** The Browse route filtered by `field:value`; null when the value cannot be written as a query term. */
function filterHash(field: string, value: string): string | null {
  const query = appendFilter("", field, value);
  return query === null ? null : browseQueryHash(query);
}
function decoded(component: string): string {
  try { return decodeURIComponent(component); } catch { return component; }
}
const projectOf = (key: string) => decodeURIComponent(key.slice(0, key.indexOf(":")));
const incomingQuery = (key: string) => `linked-to:"${key}"`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function documentJsonOf(document: DocumentBody, attention: string): string {
  return buildDocumentJson({
    title: document.title, description: document.description, fieldsRaw: document.fieldsJson, type: document.type, status: document.status,
    importance: document.importance, attention, links: document.links, tags: document.tags,
  });
}

function TypeTile({ type }: { type: string }) {
  const family = TYPE_FAMILIES.get(type);
  return <span className="record-type" data-family={family} aria-hidden="true"><UiIcon name={TYPE_ICONS.get(type) ?? DEFAULT_TYPE_ICON} /></span>;
}

function Importance({ value }: { value: string }) {
  if (value === "critical") return <span className="status status-danger">critical</span>;
  return <span className={`importance-${value}`}>{value}</span>;
}

export function RecordPage({ itemKey, edit, origin, onBack, onEdit, onEditDone, onAuthLost }: {
  itemKey: string;
  /** The edit route (#/item/<key>/edit) is current: the editor opens once the record is loaded. */
  edit: boolean;
  /** The list the record was opened from: Back returns to it. */
  origin: Preset;
  onBack: () => void;
  onEdit: () => void;
  onEditDone: () => void;
  onAuthLost: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [incoming, setIncoming] = useState<Incoming>({ kind: "loading" });
  const [history, setHistory] = useState<History>({ kind: "loading" });
  const [refreshFailure, setRefreshFailure] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotOnly, setSnapshotOnly] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [rawFields, setRawFields] = useState(false);
  const [editing, setEditing] = useState(false);
  /** The unsaved draft of this record that an earlier visit of the editor left behind (see edit-drafts.ts). */
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.get(itemKey));
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const live = useLiveUpdates();
  const openedAt = useRef(live.version);
  const links = useRef<HTMLElement>(null);
  /** The latest revision shown, for actions that run after a reload (the saved toast's "View changes"). */
  const latestItem = useRef<Item | null>(null);
  /** The record changed (announced, or a confirmed write) while the editor was open: it is reloaded once the editor closes. */
  const stale = useRef(false);

  const reload = useCallback(async (refresh: boolean) => {
    stale.current = false;
    if (!refresh) setLoad({ kind: "loading" });
    let item: Item;
    try {
      item = await api.get(itemKey);
    } catch (error) {
      if (error instanceof AuthError) { onAuthLost(); return; }
      if (refresh) setRefreshFailure(`Could not refresh the record: ${failureText(error)}.`);
      else setLoad(error instanceof ApiError && error.code === "not-found" ? { kind: "missing" } : { kind: "failed", message: failureText(error) });
      return;
    }
    setLoad({ kind: "ready", item });
    setRefreshFailure(null);
    await Promise.all([
      api.search(incomingQuery(item.key), { limit: INCOMING_LIMIT }).then(
        (page) => setIncoming({ kind: "loaded", items: page.items, more: page.cursor !== undefined }),
        (error: unknown) => { if (error instanceof AuthError) onAuthLost(); else setIncoming({ kind: "unavailable" }); }),
      api.history(itemKey).then(
        (result) => setHistory({ kind: "loaded", revisions: result.revisions }),
        (error: unknown) => { if (error instanceof AuthError) onAuthLost(); else setHistory({ kind: "unavailable" }); }),
    ]);
  }, [itemKey, onAuthLost]);

  useEffect(() => { void reload(false); }, [reload]);

  useEffect(() => {
    // Only changes announced after the page opened; an open editor reports them itself and is not reloaded under.
    if (live.version === openedAt.current) return;
    if (editing) stale.current = true;
    else void reload(true);
  }, [live.version]);
  useEffect(() => { if (!editing && stale.current) void reload(true); }, [editing]);
  // A confirmed write of this record (a save, or a replay through a retry notice) makes the page stale whether or not it is
  // announced live; an open editor is not reloaded under.
  const editingNow = useRef(editing);
  editingNow.current = editing;
  useEffect(() => api.subscribeConfirmedWrite((operation) => {
    if (latestItem.current === null || operation.key !== latestItem.current.key) return;
    if (editingNow.current) stale.current = true;
    else void reload(true);
  }), [reload]);

  const ready = load.kind === "ready";
  useEffect(() => {
    if (!edit) { setEditing(false); return; }
    if (!ready) return;
    showLatest();
    setEditing(true);
  }, [edit, ready]);

  const copy: CopyText = useCallback((text, what) => {
    setFailure(null);
    // navigator.clipboard is absent outside secure contexts (a plain-HTTP preview).
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) { setFailure(`Copy failed: the clipboard is not available on this connection. ${what} was not copied.`); return; }
    clipboard.writeText(text).then(() => setToast({ text: `Copied ${what}`, action: null }),
      (error: unknown) => setFailure(`Copy failed: ${failureText(error)}.`));
  }, []);

  async function clearAttention(item: Item) {
    setBusy(true); setFailure(null);
    try {
      const out = await api.put(item.key, documentJsonOf(item.document, "cleared"), item.revision, uuidv7());
      setToast({ text: `Attention cleared · saved as revision ${out.revision}`, action: null });
      await reload(true);
    } catch (error) {
      if (error instanceof AuthError) { onAuthLost(); return; }
      setFailure(`Clear failed: ${failureText(error)}`);
    } finally { setBusy(false); }
  }

  async function openSnapshot(latest: Item, revision: number, compareTo: number | null) {
    setFailure(null);
    try {
      const [item, compare] = await Promise.all([api.historyGet(itemKey, revision),
        compareTo === null ? null : compareTo === latest.revision ? latest : api.historyGet(itemKey, compareTo)]);
      setSnapshot({ item, compare });
      setSnapshotOnly(compare === null);
      setRawFields(false);
      window.scrollTo(0, 0);
    } catch (error) {
      if (error instanceof AuthError) { onAuthLost(); return; }
      setFailure(`Revision ${revision} is unreadable: ${failureText(error)}`);
    }
  }

  function showLatest() {
    setSnapshot(null);
    setRawFields(false);
  }

  async function restore(latest: Item, revision: Item) {
    setBusy(true); setFailure(null);
    try {
      const out = await api.put(latest.key, documentJsonOf(revision.document, revision.document.humanAttention), latest.revision, uuidv7());
      setRestoring(false); showLatest();
      setToast({ text: `Restored revision ${revision.revision} as new revision ${out.revision}`, action: null });
      await reload(true);
    } catch (error) {
      if (error instanceof AuthError) { onAuthLost(); return; }
      setRestoring(false);
      setFailure(`Restore failed: ${failureText(error)}`);
    } finally { setBusy(false); }
  }

  const back = <button type="button" className="btn btn-ghost record-back" onClick={onBack} aria-label={`Back to ${PRESETS[origin].label}`}
    title={`Back to ${PRESETS[origin].label}`}><UiIcon name="arrow-left" /><span className="record-back-label">{PRESETS[origin].label}</span></button>;
  const toasts = <div className="toasts" role="status" aria-live="polite">
    {toast !== null && <div className="toast"><UiIcon name="check" /><span>{toast.text}</span>
      {toast.action !== null && <button type="button" className="btn btn-sm" onClick={() => { const action = toast.action!; setToast(null); action.run(); }}>{toast.action.label}</button>}
      <button type="button" className="btn btn-sm btn-icon" aria-label="Dismiss" onClick={() => setToast(null)}><UiIcon name="x" /></button>
    </div>}
  </div>;

  if (load.kind === "loading") return <div className="record-view" data-record="loading">
    <div className="viewbar record-bar">{back}<span className="bar-divider" /><span className="record-type" />
      <div className="record-head" aria-busy="true"><span className="skeleton sk-head" /><span className="skeleton sk-sub" /></div></div>
    <p className="sr-only" role="status">Loading record…</p>
    <div className="page"><div className="page-narrow with-rail" aria-hidden="true">
      <div className="record-main"><div><span className="skeleton" /><span className="skeleton" /><span className="skeleton sk-60" /></div>
        <div className="card"><div className="card-body"><span className="skeleton sk-30" /><span className="skeleton" /><span className="skeleton" /><span className="skeleton sk-60" /></div></div>
        <div className="card"><div className="card-body"><span className="skeleton sk-30" /><span className="skeleton sk-60" /></div></div></div>
      <aside className="rail"><div className="card"><div className="card-body"><span className="skeleton sk-30" /><span className="skeleton" /><span className="skeleton" /><span className="skeleton sk-60" /><span className="skeleton" /></div></div>
        <div className="card"><div className="card-body"><span className="skeleton sk-30" /><span className="skeleton" /><span className="skeleton" /></div></div></aside>
    </div></div>
  </div>;

  if (load.kind === "missing" || load.kind === "failed") {
    const item = decoded(itemKey.slice(itemKey.indexOf(":") + 1));
    return <div className="record-view" data-record={load.kind}>
      <div className="viewbar record-bar">{back}<span className="bar-divider" /><span className="record-type"><UiIcon name={load.kind === "missing" ? "search" : "alert"} /></span>
        <div className="record-head"><h1 className="record-title mono">{itemKey}</h1>
          <div className="record-sub">{load.kind === "missing" ? "No record has this key" : "The record could not be read"}</div></div></div>
      {load.kind === "missing" ? <div className="empty">
        <UiIcon name="search" />
        <h2>Record not found</h2>
        <p>There is no record with the key <code>{itemKey}</code>. It may have been renamed, or the link is mistyped. Archived records still open by key.</p>
        <div className="row"><button type="button" className="btn btn-primary" onClick={onBack}>Back to {PRESETS[origin].label}</button>
          <a className="btn" href={browseQueryHash(item)}>Search for “{item}”</a></div>
      </div> : <div className="page"><div className="page-narrow">
        <div className="notice notice-danger" role="alert"><UiIcon name="alert" /><div className="grow"><span className="notice-title">Record unreadable.</span> {load.message}.</div>
          <button type="button" className="btn btn-sm" onClick={() => void reload(false)}>Retry</button></div>
      </div></div>}
      {toasts}
    </div>;
  }

  const latest = load.item;
  latestItem.current = latest;
  if (editing) return <RecordEdit itemKey={itemKey} item={latest} revisions={history.kind === "loaded" ? history.revisions : null} origin={origin}
    onItem={(item) => setLoad({ kind: "ready", item })} onAuthLost={onAuthLost} onBack={onBack}
    onSaved={async (revision) => {
      setEditing(false); onEditDone();
      setToast({ text: `Saved as revision ${revision}`, action: revision > 1 ? { label: "View changes", run: () => {
        const current = latestItem.current!;
        void openSnapshot(current, revision - 1, current.revision);
      } } : null });
      await reload(true);
    }}
    onCancel={() => { setEditing(false); onEditDone(); }}
    onViewRevision={(revision) => { setEditing(false); onEditDone(); void openSnapshot(latestItem.current!, revision, latestItem.current!.revision); }}
    onDiscard={() => { setEditing(false); onEditDone(); void reload(true); }} />;

  const viewed = snapshot === null ? latest : snapshot.item;
  const attention = snapshot === null && latest.document.humanAttention === "required";
  const revisions = history.kind === "loaded" ? history.revisions : null;
  return <div className={snapshot === null ? "record-view" : "record-view has-banner"} data-record={snapshot === null ? "ready" : "snapshot"}>
    <div className="viewbar record-bar">
      {back}<span className="bar-divider" /><TypeTile type={viewed.document.type} />
      <div className="record-head"><h1 className="record-title" title={viewed.document.title}>{viewed.document.title}</h1>
        <div className="record-sub"><span className="mono">{latest.key}</span>
          {snapshot === null ? <span className="sep">Revision {latest.revision}</span> : <span className="chip chip-accent">Snapshot · revision {snapshot.item.revision} of {latest.revision}</span>}
          {viewed.document.status === "archived" && <span className="chip">archived</span>}</div></div>
      {attention && <button type="button" className="btn record-clear" disabled={busy} onClick={() => void clearAttention(latest)}><UiIcon name="check" />Clear attention</button>}
      {snapshot === null && <button type="button" className="btn btn-primary" onClick={onEdit}><UiIcon name="edit" />Edit</button>}
      <MoreMenu raw={!rawFields || (snapshot !== null && !snapshotOnly)} onRaw={() => { setRawFields(true); setSnapshotOnly(true); }}
        onCopyKey={() => copy(latest.key, "key")} onCopyLink={() => copy(`${location.origin}${location.pathname}${itemHash(latest.key, false)}`, "link")} />
    </div>
    {snapshot !== null && <SnapshotBanner snapshot={snapshot} latest={latest} revisions={revisions} now={Date.now()}
      onCompare={(compareTo) => void openSnapshot(latest, snapshot.item.revision, compareTo)}
      onLatest={showLatest} onRestore={() => setRestoring(true)} />}
    <div className="page"><div className="page-narrow with-rail">
      <div className="record-main">
        {draft !== undefined && <div className="notice notice-row" role="note"><UiIcon name="edit" /><div className="grow">
          <span className="notice-title">You have an unsaved draft of this record</span> · started from revision {draft.baseRevision}.</div>
          <button type="button" className="btn btn-sm btn-primary" onClick={onEdit}>Continue editing</button>
          <button type="button" className="btn btn-sm" onClick={() => setDiscardingDraft(true)}>Discard</button></div>}
        {failure !== null && <div className="notice notice-danger notice-row" role="alert"><UiIcon name="alert" /><div className="grow">{failure}</div>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label="Dismiss" onClick={() => setFailure(null)}><UiIcon name="x" /></button></div>}
        {refreshFailure !== null && <div className="notice notice-danger notice-row" role="alert"><UiIcon name="alert" /><div className="grow">{refreshFailure}</div>
          <button type="button" className="btn btn-sm" onClick={() => void reload(true)}>Retry</button></div>}
        {snapshot !== null ? <SnapshotMain snapshot={snapshot} only={snapshotOnly} raw={rawFields} onTyped={() => setRawFields(false)} onCopy={copy}
          onOnly={(only) => { setSnapshotOnly(only); if (!only) setRawFields(false); }} /> : <>
          {latest.document.status === "archived" && <div className="notice notice-neutral notice-row" role="note"><UiIcon name="archive" /><div className="grow">
            <span className="notice-title">Archived record.</span> Hidden from lists and search unless the query includes <code>archived:true</code>. To bring it back, edit it and set Status to <code>actual</code>.</div></div>}
          {attention && <div className="notice notice-warn notice-row" role="note"><UiIcon name="alert" /><div className="grow">
            <span className="notice-title">Needs review.</span> This record asks for a human review; clearing the attention saves a new revision.</div>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void clearAttention(latest)}><UiIcon name="check" />Clear attention</button></div>}
          {latest.document.type === "skill-draft" && <div className="notice notice-row" role="note"><UiIcon name="sparkle" /><div className="grow">
            <span className="notice-title">Skill draft awaiting human review.</span> Not installed, not active.</div></div>}
          <RecordBody item={latest} raw={rawFields} onTyped={() => setRawFields(false)} onCopy={copy} />
          <LinksSection ref={links} item={latest} incoming={incoming} />
        </>}
      </div>
      <aside className="rail rail-sticky" aria-label="Record metadata and history">
        <MetadataCard item={viewed} created={latest.metadata} latestRevision={latest.revision} now={Date.now()}
          links={snapshot === null ? { outgoing: latest.document.links.length, incoming, jump: () => links.current!.scrollIntoView() } : null} />
        <HistoryCard revisions={revisions} latest={latest.revision} viewing={snapshot === null ? null : snapshot.item.revision} now={Date.now()}
          onView={(revision) => revision === latest.revision ? showLatest() : void openSnapshot(latest, revision, latest.revision)} />
      </aside>
    </div></div>
    {restoring && snapshot !== null && <RestoreDialog latest={latest} revision={snapshot.item} busy={busy}
      onConfirm={() => void restore(latest, snapshot.item)} onCancel={() => setRestoring(false)} />}
    {discardingDraft && <ConfirmDialog title="Discard your draft?" confirmLabel="Discard draft" cancelLabel="Keep my draft" danger busy={false}
      onConfirm={() => { setDiscardingDraft(false); drafts.drop(itemKey); }} onCancel={() => setDiscardingDraft(false)}>
      <p>Your unsaved changes to <span className="mono nowrap">{itemKey}</span> are dropped. Nothing of the draft was saved.</p>
    </ConfirmDialog>}
    {toasts}
  </div>;
}

function MoreMenu({ raw, onRaw, onCopyKey, onCopyLink }: { raw: boolean; onRaw: () => void; onCopyKey: () => void; onCopyLink: () => void }) {
  const overlay = useOverlay();
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (overlay.open) focusMenu(menu.current); }, [overlay.open]);
  const run = (action: () => void) => () => { overlay.close(true); action(); };
  return <div className="anchor" ref={overlay.anchor}>
    <button type="button" ref={overlay.trigger} className="btn btn-ghost btn-icon" aria-label="More actions" title="More actions" aria-haspopup="menu"
      aria-expanded={overlay.open} onClick={overlay.toggle}><UiIcon name="more" /></button>
    {overlay.open && <div className="menu" role="menu" aria-label="More actions" ref={menu} onKeyDown={menuKeys}>
      <button type="button" className="menu-item" role="menuitem" tabIndex={-1} onClick={run(onCopyKey)}><UiIcon name="copy" />Copy key</button>
      <button type="button" className="menu-item" role="menuitem" tabIndex={-1} onClick={run(onCopyLink)}><UiIcon name="link" />Copy link</button>
      {raw && <button type="button" className="menu-item" role="menuitem" tabIndex={-1} onClick={run(onRaw)}><UiIcon name="terminal" />View raw JSON</button>}
    </div>}
  </div>;
}

/** Description and fields of one revision. */
function RecordBody({ item, raw, onTyped, onCopy }: { item: Item; raw: boolean; onTyped: () => void; onCopy: CopyText }) {
  const fieldsTitle = useId();
  const count = useMemo(() => parseFields(item.document.fieldsJson).length, [item.document.fieldsJson]);
  return <>
    <section className="section-tight" aria-label="Description"><span className="eyebrow">Description</span>
      {item.document.description === "" ? <p className="muted">No description.</p> :
        <div className="prose record-description">{item.document.description.split(PARAGRAPH_BREAK).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>}
    </section>
    <section className="section" aria-labelledby={fieldsTitle}>
      <div className="section-head"><h2 className="section-title" id={fieldsTitle}>Fields{!raw && <span className="count">{count}</span>}</h2>
        {raw && <button type="button" className="btn btn-sm" onClick={onTyped}><UiIcon name="arrow-left" />Typed view</button>}</div>
      {raw ? <FieldsJson fieldsJson={item.document.fieldsJson} onCopy={onCopy} /> : <FieldsView fieldsJson={item.document.fieldsJson} onCopy={onCopy} />}
    </section>
  </>;
}

function OutgoingLink({ relation, target }: { relation: string; target: string }) {
  const [resolved, setResolved] = useState<{ title: string; archived: boolean } | "missing" | null>(null);
  useEffect(() => {
    let current = true;
    api.get(target).then(
      (item) => { if (current) setResolved({ title: item.document.title, archived: item.document.status === "archived" }); },
      () => { if (current) setResolved("missing"); },
    );
    return () => { current = false; };
  }, [target]);
  return <li><span className="chip chip-outline link-rel">{relation}</span><a className="link-key" href={itemHash(target, false)}>{target}</a>
    <span className="link-title">{resolved === null ? "" : resolved === "missing" ? "No record has this key" : resolved.title}</span>
    {resolved === "missing" ? <span className="chip chip-danger">dangling</span> : resolved !== null && resolved.archived ? <span className="chip">archived</span> : <span />}</li>;
}

function LinksSection({ ref, item, incoming }: { ref: Ref<HTMLElement>; item: Item; incoming: Incoming }) {
  const title = useId();
  const outgoing = item.document.links;
  return <section className="section record-links" ref={ref} aria-labelledby={title}>
    <div className="section-head"><h2 className="section-title" id={title}>Links</h2></div>
    <div className="card" aria-label="Outgoing links"><div className="card-head"><h3>Outgoing <span className="muted">· {outgoing.length}</span></h3></div>
      {outgoing.length === 0 ? <div className="card-body small muted">This record links to nothing.</div> :
        <ul className="link-list">{outgoing.map(([relation, target], index) => <OutgoingLink key={index} relation={relation} target={target} />)}</ul>}
    </div>
    <div className="card" aria-label="Incoming links"><div className="card-head"><h3>Incoming {incoming.kind === "loaded" && <span className="muted">· {incoming.items.length}{incoming.more && "+"}</span>}</h3></div>
      {incoming.kind === "loading" ? <div className="card-body small muted">Loading incoming links…</div> :
        incoming.kind === "unavailable" ? <div className="card-body small muted">Incoming links unavailable.</div> :
        incoming.items.length === 0 ? <div className="card-body small muted">No record links here.</div> :
        <ul className="link-list link-list-incoming">{incoming.items.map((summary) => <li key={summaryKey(summary)}>
          <a className="link-key" href={itemHash(summaryKey(summary), false)}>{summaryKey(summary)}</a><span className="link-title">{summary.title}</span>
          {summary.status === "archived" ? <span className="chip">archived</span> : <span />}</li>)}</ul>}
      {incoming.kind === "loaded" && incoming.more && <div className="card-foot"><span>First {incoming.items.length} shown · more exist</span>
        <a className="push" href={browseQueryHash(incomingQuery(item.key))}>Open all in Browse <UiIcon name="arrow-right" small /></a></div>}
    </div>
  </section>;
}

function FilterLink({ className, field, value }: { className: string; field: string; value: string }) {
  const href = filterHash(field, value);
  return href === null ? <span className={className}>{value}</span> : <a className={className} href={href} title={`${field}:${value}`}>{value}</a>;
}

function MetadataCard({ item, created, latestRevision, now, links }: {
  item: Item; created: Item["metadata"]; latestRevision: number; now: number;
  /** Link counts of the latest revision with a jump to its Links section; null for a snapshot. */
  links: { outgoing: number; incoming: Incoming; jump: () => void } | null;
}) {
  const modified = when(item.metadata.modifiedAt, now), first = when(created.createdAt, now);
  const status = item.document.status === "actual" ? "status-ok" : item.document.status === "archived" ? "status-idle" : "status-info";
  return <section className="card" aria-label="Metadata"><div className="card-head"><h2>Metadata</h2></div><div className="card-body"><dl className="dl dl-fixed">
    <dt>Type</dt><dd><span className="chip chip-outline">{item.document.type}</span></dd>
    <dt>Status</dt><dd><span className={`status ${status}`}>{item.document.status}</span></dd>
    <dt>Importance</dt><dd><Importance value={item.document.importance} /></dd>
    <dt>Attention</dt><dd>{item.document.humanAttention === "required" ? <span className="chip chip-warn">Needs review</span> : <span className="muted">Not flagged</span>}</dd>
    <dt>Tags</dt><dd>{item.document.tags.length === 0 ? <span className="muted">None</span> :
      item.document.tags.map((tag) => <FilterLink key={tag} className="chip" field="tag" value={tag} />)}</dd>
    <dt>Project</dt><dd><FilterLink className="" field="project" value={projectOf(item.key)} /></dd>
    {links !== null && <><dt>Links</dt><dd><button type="button" className="link-button" onClick={links.jump}>
      {links.outgoing} outgoing · {links.incoming.kind === "loaded" ? `${links.incoming.items.length}${links.incoming.more ? "+" : ""}` : "?"} incoming</button></dd></>}
    <dt>Revision</dt><dd>{item.revision} of {latestRevision}</dd>
    <dt>Modified</dt><dd><time dateTime={item.metadata.modifiedAt} title={modified.iso}>{modified.absolute}</time>
      <span className="dd-sub">{modified.relative} · by {item.metadata.modifiedBy}</span></dd>
    <dt>Created</dt><dd><time dateTime={created.createdAt} title={first.iso}>{first.absolute}</time><span className="dd-sub">by {created.createdBy}</span></dd>
  </dl></div></section>;
}

function HistoryCard({ revisions, latest, viewing, now, onView }: {
  revisions: readonly RevisionMeta[] | null; latest: number; viewing: number | null; now: number; onView: (revision: number) => void;
}) {
  const current = viewing ?? latest;
  return <section className="card" aria-label="History"><div className="card-head"><h2>History</h2>
    {revisions !== null && <span className="xs muted">{plural(revisions.length, "revision")}</span>}</div>
    {revisions === null ? <div className="card-body small muted">History unavailable.</div> : <ul>{revisions.map((revision) => {
      const at = when(revision.modifiedAt, now);
      return <li key={revision.revision} className="hist-row" aria-current={viewing === revision.revision ? "true" : undefined}>
        <span className="hist-rev">r{revision.revision}</span>
        <span className="hist-who" title={at.iso}>{revision.modifiedBy} <span>· {at.absolute}</span></span>
        {revision.revision === current ? <span className={viewing === null ? "chip" : "chip chip-accent"}>{viewing === null ? "Current" : "Viewing"}</span> :
          <button type="button" className="btn btn-sm btn-ghost hist-view" aria-label={`View revision ${revision.revision}`} onClick={() => onView(revision.revision)}>View</button>}
      </li>;
    })}</ul>}
    {revisions !== null && revisions.length > 1 && <div className="card-foot">
      <button type="button" className="link-button" onClick={() => onView(viewing ?? Math.max(...revisions.map((revision) => revision.revision).filter((revision) => revision !== latest)))}>Compare revisions…</button></div>}
  </section>;
}

const COMPARE_NONE = "none";

function SnapshotBanner({ snapshot, latest, revisions, now, onCompare, onLatest, onRestore }: {
  snapshot: Snapshot; latest: Item; revisions: readonly RevisionMeta[] | null; now: number;
  onCompare: (revision: number | null) => void; onLatest: () => void; onRestore: () => void;
}) {
  const compareId = useId();
  const saved = when(snapshot.item.metadata.modifiedAt, now);
  const others = (revisions ?? []).map((revision) => revision.revision).filter((revision) => revision !== snapshot.item.revision);
  return <div className="banner record-banner" role="region" aria-label="Snapshot">
    <UiIcon name="clock" />
    <span><strong>Viewing revision {snapshot.item.revision} of {latest.revision}</strong> — saved by {snapshot.item.metadata.modifiedBy} · <time dateTime={snapshot.item.metadata.modifiedAt} title={saved.iso}>{saved.absolute}</time>. Read-only.</span>
    <label className="record-compare" htmlFor={compareId}>Compare with
      <select className="select" id={compareId} value={snapshot.compare === null ? COMPARE_NONE : String(snapshot.compare.revision)}
        onChange={(event) => onCompare(event.target.value === COMPARE_NONE ? null : Number(event.target.value))}>
        {others.map((revision) => <option key={revision} value={revision}>Revision {revision}{revision === latest.revision ? " (latest)" : ""}</option>)}
        <option value={COMPARE_NONE}>Nothing — show revision {snapshot.item.revision} only</option>
      </select>
    </label>
    <div className="banner-end">
      <button type="button" className="btn btn-sm" onClick={onLatest}><UiIcon name="arrow-left" />Back to latest</button>
      <button type="button" className="btn btn-sm btn-primary" onClick={onRestore}>Restore as new revision</button>
    </div>
  </div>;
}

function SnapshotMain({ snapshot, only, raw, onOnly, onTyped, onCopy }: {
  snapshot: Snapshot; only: boolean;
  /** The revision's fields are shown as raw JSON (in the revision-only view). */
  raw: boolean; onOnly: (only: boolean) => void; onTyped: () => void; onCopy: CopyText;
}) {
  const title = useId();
  const { item, compare } = snapshot;
  const pair = useMemo(() => compare === null ? null : compare.revision < item.revision ? { older: compare, newer: item } : { older: item, newer: compare }, [item, compare]);
  const comparison = useMemo(() => pair === null ? null : compareRevisions(pair.older, pair.newer), [pair]);
  const toggle = <div className="segmented" role="group" aria-label="Snapshot view">
    <button type="button" aria-pressed={!only} disabled={pair === null} onClick={() => onOnly(false)}>Changes</button>
    <button type="button" aria-pressed={only} onClick={() => onOnly(true)}>Revision {item.revision} only</button>
  </div>;
  if (pair === null || comparison === null || only) return <>
    <div className="section-head"><h2 className="section-title" id={title}>Revision {item.revision}</h2>{toggle}</div>
    <RecordBody item={item} raw={raw} onTyped={onTyped} onCopy={onCopy} />
    <section className="card" aria-label="Outgoing links"><div className="card-head"><h3>Outgoing links <span className="muted">· {item.document.links.length}</span></h3></div>
      {item.document.links.length === 0 ? <div className="card-body small muted">This revision links to nothing.</div> :
        <ul className="link-list">{item.document.links.map(([relation, target], index) => <OutgoingLink key={index} relation={relation} target={target} />)}</ul>}
    </section>
  </>;
  return <section className="section" aria-labelledby={title}>
    <div className="section-head"><h2 className="section-title" id={title}>Changes from revision {pair.older.revision} to revision {pair.newer.revision}</h2>
      <div className="diff-legend"><span className="diff-swatch diff-swatch-del">only in revision {pair.older.revision}</span><span className="diff-swatch">added in revision {pair.newer.revision}</span></div>
      {toggle}</div>
    <ComparisonView comparison={comparison} />
  </section>;
}

function diffSummary(diff: TextDiff): string {
  if (diff.kind === "too-large") return "changed";
  const parts: string[] = [];
  if (diff.added > 0) parts.push(`${plural(diff.added, "line")} added`);
  if (diff.removed > 0) parts.push(diff.added > 0 ? `${diff.removed} removed` : `${plural(diff.removed, "line")} removed`);
  return parts.join(" · ");
}

function DiffText({ line }: { line: Extract<DiffLine, { text: string }> }) {
  if (line.mark === null) return <>{line.text}</>;
  return <>{line.text.slice(0, line.mark.start)}<mark>{line.text.slice(line.mark.start, line.mark.end)}</mark>{line.text.slice(line.mark.end)}</>;
}

const DIFF_LABELS = { add: "Added: ", del: "Removed: ", same: "" } as const;

function DiffBody({ diff, prose }: { diff: TextDiff; prose: boolean }) {
  if (diff.kind === "too-large") return <div className="card-body small muted">Too large to compare line by line ({plural(diff.beforeLines, "line")} and {plural(diff.afterLines, "line")}).</div>;
  return <div className={prose ? "diff diff-prose" : "diff"}>{diff.lines.map((line, index) => line.kind === "skip" ?
    <div key={index} className="diff-skip">⋯ {plural(line.count, "unchanged line")}</div> :
    <div key={index} className={line.kind === "same" ? "diff-line" : `diff-line diff-${line.kind}`} data-diff={line.kind}>
      <span>{DIFF_LABELS[line.kind] !== "" && <span className="sr-only">{DIFF_LABELS[line.kind]}</span>}<DiffText line={line} /></span></div>)}</div>;
}

function DiffCard({ name, label, note, children }: { name: string; label: string; note: string; children: ReactNode }) {
  return <section className="card field-card" aria-label={`Changes: ${name}`}><div className="card-head">
    <h3 className="field-name">{name}</h3><span className="chip">{label}</span><span className="spacer" /><span className="xs muted">{note}</span></div>
    {children}</section>;
}

function ComparisonView({ comparison }: { comparison: Comparison }) {
  const nothing = changedParts(comparison).length === 0;
  return <>
    {comparison.description !== null && <DiffCard name="description" label="text" note={diffSummary(comparison.description)}><DiffBody diff={comparison.description} prose /></DiffCard>}
    {comparison.metadata.length > 0 && <section className="card" aria-label="Changes: metadata"><div className="card-head"><h3>Metadata</h3>
      <span className="xs muted">{plural(comparison.metadata.length, "value")} changed</span></div>
      {comparison.metadata.map((change) => <div key={change.name} className="field-row"><div className="field-id"><span className="field-name">{change.name}</span></div>
        <div className="field-value"><del className="diff-val diff-del-val">{change.before === "" ? "(empty)" : change.before}</del> <span className="change-arrow" aria-hidden="true">→</span> <ins className="diff-val diff-add-val">{change.after === "" ? "(empty)" : change.after}</ins></div></div>)}
    </section>}
    {comparison.links !== null && <DiffCard name="links" label="outgoing" note={diffSummary(comparison.links)}><DiffBody diff={comparison.links} prose={false} /></DiffCard>}
    {comparison.fields.map((field) => <DiffCard key={field.name} name={field.name} label={field.label} note={field.state === "changed" ? diffSummary(field.diff) : field.state}>
      <DiffBody diff={field.diff} prose={false} /></DiffCard>)}
    {nothing ? <p className="small muted">The two revisions are identical.</p> :
      comparison.unchanged.length > 0 && <p className="small muted">Unchanged in both revisions: {comparison.unchanged.join(", ")}.</p>}
  </>;
}

function RestoreDialog({ latest, revision, busy, onConfirm, onCancel }: { latest: Item; revision: Item; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const differing = useMemo(() => changedParts(compareRevisions(revision, latest)), [revision, latest]);
  const next = latest.revision + 1;
  return <ConfirmDialog title={`Restore revision ${revision.revision}?`} confirmLabel={`Restore as revision ${next}`} danger={false} busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
    <p>The content of <strong>revision {revision.revision}</strong> of <span className="mono">{latest.key}</span> is saved again as a new <strong>revision {next}</strong>.
      Revisions 1–{latest.revision} stay in the history, so this can be undone the same way.</p>
    <p>{differing.length === 0 ? "It is identical to the latest revision." : `${plural(differing.length, "value")} differ${differing.length === 1 ? "s" : ""} from the latest revision: ${differing.join(", ")}.`}</p>
  </ConfirmDialog>;
}
