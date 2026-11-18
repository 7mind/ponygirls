import { useEffect, useId, useState } from "react";
import { api, ApiError, AuthError } from "./api";
import { UiIcon } from "./Masthead";
import { linkAnchor, type LinkRow, type Problem } from "./edit-draft";

const RELATIONS = ["supersedes", "motivated-by", "relates-to", "blocked-by", "mentions"];
const DEFAULT_RELATION = "relates-to";
const CUSTOM_RELATION = "";

type Resolution = { kind: "found"; title: string; archived: boolean } | { kind: "missing" } | { kind: "unknown" };

/** What the target key names, looked up when the row opens and when its key field is left (not on every keystroke). */
function useResolution(target: string, onAuthLost: () => void): Resolution | null {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  useEffect(() => {
    if (target === "") { setResolution(null); return; }
    let current = true;
    api.get(target).then(
      (item) => { if (current) setResolution({ kind: "found", title: item.document.title, archived: item.document.status === "archived" }); },
      (error: unknown) => {
        if (error instanceof AuthError) { onAuthLost(); return; }
        if (current) setResolution(error instanceof ApiError && error.code === "not-found" ? { kind: "missing" } : { kind: "unknown" });
      });
    return () => { current = false; };
  }, [target, onAuthLost]);
  return resolution;
}

function LinkRowEditor({ link, index, problems, onChange, onRemove, onAuthLost }: {
  link: LinkRow; index: number; problems: readonly Problem[]; onChange: (link: LinkRow) => void; onRemove: () => void; onAuthLost: () => void;
}) {
  const relations = useId();
  const [checked, setChecked] = useState(link.target.trim());
  const resolution = useResolution(checked, onAuthLost);
  const row = index + 1;
  const errorId = `${linkAnchor(link.id)}-error`;
  const known = RELATIONS.includes(link.relation);
  const removeLabel = `Remove link ${row}`;
  return <div className="link-edit-row" role="group" aria-label={`Link ${row}`}>
    {known ? <select className="select" aria-label={`Link type, row ${row}`} value={link.relation} onChange={(event) => onChange({ ...link, relation: event.target.value })}>
      {RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
      <option value={CUSTOM_RELATION}>Custom…</option>
    </select> : <input className="input" aria-label={`Link type, row ${row}`} list={relations} value={link.relation} placeholder="relation" autoFocus={link.relation === CUSTOM_RELATION}
      autoComplete="off" spellCheck={false} onChange={(event) => onChange({ ...link, relation: event.target.value })} />}
    <input className="input input-mono" id={linkAnchor(link.id)} aria-label={`Target key, row ${row}`} placeholder="project:item" autoComplete="off" spellCheck={false}
      value={link.target} aria-invalid={problems.length > 0} aria-describedby={problems.length > 0 ? errorId : undefined}
      onChange={(event) => onChange({ ...link, target: event.target.value })} onBlur={() => setChecked(link.target.trim())} />
    <span className={resolution !== null && resolution.kind === "missing" ? "link-resolved is-missing" : "link-resolved"} aria-live="polite">
      {resolution !== null && resolution.kind === "found" && <><UiIcon name="check" small /><span className="truncate">{resolution.title}</span>{resolution.archived && <span className="chip">archived</span>}</>}
      {resolution !== null && resolution.kind === "missing" && <><UiIcon name="alert" small /><span className="truncate">No record has this key</span></>}
    </span>
    <button type="button" className="btn btn-ghost btn-icon" aria-label={removeLabel} title={removeLabel} onClick={onRemove}><UiIcon name="trash" /></button>
    {problems.length > 0 && <div className="field-error" id={errorId}><UiIcon name="alert" small /><span>{problems.map((problem) => problem.message).join(" ")}</span></div>}
    {!known && <datalist id={relations}>{RELATIONS.map((relation) => <option key={relation} value={relation} />)}</datalist>}
  </div>;
}

export function LinksEditor({ links, nextId, problems, onChange, onFocusRequest, onAuthLost }: {
  links: readonly LinkRow[];
  nextId: () => number;
  problems: readonly Problem[];
  onChange: (links: LinkRow[]) => void;
  onFocusRequest: (anchor: string) => void;
  onAuthLost: () => void;
}) {
  const add = () => {
    const link = { id: nextId(), relation: DEFAULT_RELATION, target: "" };
    onChange([...links, link]);
    onFocusRequest(linkAnchor(link.id));
  };
  return <section className="section" aria-label="Links editor">
    <div className="section-head"><h2 className="section-title">Links</h2><span className="xs muted">Outgoing links of this record · incoming links are set on the other record</span></div>
    {links.length > 0 && <div className="link-edit">
      <div className="field-edit-cols eyebrow" aria-hidden="true"><span>Relation</span><span>Target key</span><span>Resolves to</span><span /></div>
      <div className="card">{links.map((link, index) => <LinkRowEditor key={link.id} link={link} index={index} problems={problems.filter((problem) => problem.anchor === linkAnchor(link.id))}
        onChange={(next) => onChange(links.map((candidate) => candidate.id === link.id ? next : candidate))}
        onRemove={() => onChange(links.filter((candidate) => candidate.id !== link.id))} onAuthLost={onAuthLost} />)}</div>
    </div>}
    <div className="row"><button type="button" className="btn" onClick={add}><UiIcon name="plus" />Add link</button></div>
  </section>;
}
