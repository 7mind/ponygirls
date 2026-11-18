import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { RevisionMeta } from "./api";
import { UiIcon } from "./Masthead";
import { addTag, type Draft } from "./edit-draft";

const TYPE_SUGGESTIONS = ["todo", "fact", "decision", "note", "github-issue", "github-pr", "skill-draft"];
const STATUS_SUGGESTIONS = ["actual", "archived"];
const IMPORTANCES = ["low", "normal", "high", "critical"];
const HISTORY_ROWS = 5;
const TAG_SEPARATOR = ",";
const NO_OPTION = -1;
const WHEN: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

type Metadata = Pick<Draft, "type" | "status" | "importance" | "needsReview" | "tags" | "tagInput">;

function TagInput({ id, tags, input, onChange }: { id: string; tags: readonly string[]; input: string; onChange: (tags: string[], input: string) => void }) {
  const change = (value: string) => {
    const separator = value.lastIndexOf(TAG_SEPARATOR);
    if (separator === -1) onChange([...tags], value);
    else onChange(addTag(tags, value.slice(0, separator)), value.slice(separator + 1));
  };
  const commit = () => onChange(addTag(tags, input), "");
  const key = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); commit(); } };
  return <div className="tag-input">
    {tags.map((tag) => <span key={tag} className="chip chip-removable">{tag}
      <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((candidate) => candidate !== tag), input)}><UiIcon name="x" small /></button></span>)}
    <input id={id} placeholder="Add tag…" autoComplete="off" spellCheck={false} value={input} onChange={(event) => change(event.target.value)} onKeyDown={key} onBlur={commit} />
  </div>;
}

/** Free text with suggestions: the field takes any value; the list offers the usual ones. */
function Combo({ id, value, suggestions, onChange }: { id: string; value: string; suggestions: readonly string[]; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(NO_OPTION);
  const list = `${id}-options`;
  const option = (index: number) => `${id}-option-${index}`;
  const choose = (suggestion: string) => { onChange(suggestion); setOpen(false); setActive(NO_OPTION); };
  const move = (step: number) => { setOpen(true); setActive((current) => (current + step + suggestions.length) % suggestions.length); };
  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Enter" && open && active !== NO_OPTION) { event.preventDefault(); choose(suggestions[active]!); }
    else if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); }
  };
  return <div className="combo">
    <input ref={input} id={id} className="input" role="combobox" aria-expanded={open} aria-controls={open ? list : undefined} aria-autocomplete="list"
      aria-activedescendant={open && active !== NO_OPTION ? option(active) : undefined} autoComplete="off" spellCheck={false} value={value}
      onChange={(event) => onChange(event.target.value)} onKeyDown={key} onBlur={() => setOpen(false)} />
    <button type="button" tabIndex={-1} className="combo-toggle" aria-label="Show suggestions" onMouseDown={(event) => event.preventDefault()}
      onClick={() => { input.current!.focus(); setOpen(!open); }}><UiIcon name="chevron-down" small /></button>
    {open && <ul id={list} className="query-suggest" role="listbox" aria-label="Suggestions">
      {suggestions.map((suggestion, index) => <li key={suggestion} id={option(index)} role="option" aria-selected={index === active}
        onMouseDown={(event) => { event.preventDefault(); choose(suggestion); }}>{suggestion}</li>)}
    </ul>}
  </div>;
}

export function MetadataCard({ project, metadata, onChange }: { project: string; metadata: Metadata; onChange: (patch: Partial<Metadata>) => void }) {
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;
  const importances = IMPORTANCES.includes(metadata.importance) ? IMPORTANCES : [metadata.importance, ...IMPORTANCES];
  return <section className="card" aria-label="Metadata"><div className="card-head"><h2>Metadata</h2></div><div className="card-body rail-form">
    <div className="field"><label className="label" htmlFor={id("project")}>Project</label>
      <input className="input input-mono" id={id("project")} value={project} readOnly /><span className="hint">Part of the key; cannot be changed.</span></div>
    <div className="field"><label className="label" htmlFor={id("type")}>Type</label>
      <Combo id={id("type")} value={metadata.type} suggestions={TYPE_SUGGESTIONS} onChange={(type) => onChange({ type })} /></div>
    <div className="field"><label className="label" htmlFor={id("status")}>Status</label>
      <Combo id={id("status")} value={metadata.status} suggestions={STATUS_SUGGESTIONS} onChange={(status) => onChange({ status })} />
      <span className="hint">Free text with suggestions: actual, archived.</span></div>
    <div className="field"><label className="label" htmlFor={id("importance")}>Importance</label>
      <select className="select" id={id("importance")} value={metadata.importance} onChange={(event) => onChange({ importance: event.target.value })}>
        {importances.map((importance) => <option key={importance} value={importance}>{importance}</option>)}</select></div>
    <label className="switch"><input type="checkbox" checked={metadata.needsReview} onChange={(event) => onChange({ needsReview: event.target.checked })} />Needs review</label>
    <div className="field"><label className="label" htmlFor={id("tags")}>Tags</label>
      <TagInput id={id("tags")} tags={metadata.tags} input={metadata.tagInput} onChange={(tags, tagInput) => onChange({ tags, tagInput })} />
      <span className="hint">Enter or comma adds a tag.</span></div>
  </div></section>;
}

/** The latest revisions with their authors, as context for the edit; opening one leaves the editor for the record page. */
export function HistoryCard({ revisions, onView }: { revisions: readonly RevisionMeta[] | null; onView: (revision: number) => void }) {
  if (revisions === null) return null;
  const latest = Math.max(...revisions.map((revision) => revision.revision));
  const shown = revisions.slice(0, HISTORY_ROWS);
  const earlier = revisions.map((revision) => revision.revision).filter((revision) => revision !== latest);
  return <section className="card" aria-label="History"><div className="card-head"><h2>History</h2>
    <span className="xs muted">{revisions.length} {revisions.length === 1 ? "revision" : "revisions"}</span></div>
    <ul>{shown.map((revision) => {
      const at = new Date(revision.modifiedAt);
      const valid = !Number.isNaN(at.getTime());
      return <li key={revision.revision} className="hist-row">
        <span className="hist-rev">r{revision.revision}</span>
        <span className="hist-who" title={revision.modifiedAt}>{revision.modifiedBy} <span>· {valid ? new Intl.DateTimeFormat(undefined, WHEN).format(at) : revision.modifiedAt}</span></span>
        {revision.revision === latest ? <span className="chip">Current</span> :
          <button type="button" className="btn btn-sm btn-ghost hist-view" aria-label={`View revision ${revision.revision}`} onClick={() => onView(revision.revision)}>View</button>}</li>;
    })}</ul>
    {earlier.length > 0 && <div className="card-foot"><button type="button" className="link-button" onClick={() => onView(Math.max(...earlier))}>Compare revisions…</button>
      {revisions.length > shown.length && <span className="xs muted">{revisions.length - shown.length} older not listed</span>}</div>}
  </section>;
}
