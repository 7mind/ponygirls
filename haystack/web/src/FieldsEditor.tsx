import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { stringify } from "lossless-json";
import { FieldPreview } from "./FieldsView";
import { UiIcon } from "./Masthead";
import { updateTypedField, type TypedContent } from "./fields";
import { editingOf, newFieldName, retype, serializeRows, type FieldKind, type FieldRow, type RowValue } from "./fields-edit";
import { fieldAnchor, fieldNameAnchor, RAW_FIELDS_ANCHOR, type FieldsDraft, type Problem } from "./edit-draft";
import { isLosslessNumber, parseRaw } from "./lossless-json";

const CODE_LANGUAGES = ["bash", "css", "go", "html", "java", "javascript", "json", "nix", "python", "rust", "scala", "sql", "typescript", "yaml"];
const KINDS: ReadonlyArray<{ kind: FieldKind; label: string }> = [
  { kind: "md", label: "Markdown" }, { kind: "text", label: "Text" }, { kind: "code", label: "Code" }, { kind: "string", label: "String" },
  { kind: "number", label: "Number" }, { kind: "boolean", label: "Boolean" }, { kind: "null", label: "Null" }, { kind: "json", label: "JSON" },
];
const INDENT = 2;
const isBlock = (value: RowValue): value is TypedContent => value.kind === "md" || value.kind === "text" || value.kind === "code";
const displayName = (row: FieldRow): string => row.name === "" ? '""' : row.name;

type Update = (fields: FieldsDraft) => void;

function withRows(fields: FieldsDraft, rows: FieldRow[]): FieldsDraft {
  const serialized = serializeRows(rows);
  return { view: "typed", text: serialized.ok ? serialized.raw : fields.text, editing: { shape: "rows", rows } };
}

function rootSummary(text: string): string {
  let value;
  try { value = parseRaw(text); } catch { return "invalid JSON"; }
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  if (Array.isArray(value)) return `array · ${count(value.length, "item")}`;
  if (value !== null && typeof value === "object" && !isLosslessNumber(value)) return `object · ${count(Object.keys(value).length, "key")}`;
  return "value";
}

function FieldError({ id, problems }: { id: string; problems: readonly Problem[] }) {
  if (problems.length === 0) return null;
  return <div className="field-error" id={id}><UiIcon name="alert" small /><span>{problems.map((problem) => problem.message).join(" ")}</span></div>;
}

export function FieldsEditor({ fields, nextId, problems, onChange, onFocusRequest }: {
  fields: FieldsDraft;
  nextId: () => number;
  /** Everything that blocks saving; this editor shows the problems of its own controls next to them. */
  problems: readonly Problem[];
  onChange: Update;
  /** Asks for the control with this id to be focused once it is rendered. */
  onFocusRequest: (anchor: string) => void;
}) {
  const addButton = useRef<HTMLButtonElement>(null);
  const [previews, setPreviews] = useState<ReadonlyMap<number, boolean>>(new Map());
  const typed = fields.view === "typed" && fields.editing !== null ? fields.editing : null;
  const canType = useMemo(() => {
    if (fields.view !== "raw") return true;
    const editing = editingOf(fields.text, () => 0);
    return editing !== null && editing.shape !== "raw-only";
  }, [fields.view, fields.text]);
  const canRaw = typed === null || typed.shape !== "rows" || serializeRows(typed.rows).ok;
  const modeLabels = { typed: "Typed content", raw: "Raw JSON" } as const;

  function switchTo(view: "typed" | "raw") {
    if (view === fields.view) return;
    if (view === "typed") { onChange({ view, text: fields.text, editing: editingOf(fields.text, nextId) }); return; }
    const pretty = stringify(parseRaw(fields.text), null, INDENT);
    if (pretty === undefined) throw new Error("Fields serialization returned no value");
    onChange({ view, text: pretty, editing: null });
  }

  const previewOf = (row: FieldRow): boolean => previews.get(row.id) ?? true;
  const setPreview = (id: number, on: boolean) => setPreviews(new Map(previews).set(id, on));
  const problemsAt = (anchor: string) => problems.filter((problem) => problem.anchor === anchor);

  return <section className="section" aria-label="Fields editor">
    <div className="section-head"><h2 className="section-title">Fields</h2>
      {fields.view === "typed" && <span className="xs muted hide-md">Raw JSON edits the whole fields object</span>}
      <div className="segmented" role="group" aria-label="Field editing mode">
        {(["typed", "raw"] as const).map((view) => <button key={view} type="button" aria-pressed={fields.view === view}
          disabled={view === "typed" ? !canType : !canRaw} onClick={() => switchTo(view)}>{modeLabels[view]}</button>)}
      </div>
    </div>
    {fields.view === "raw" ? <RawFields text={fields.text} problems={problemsAt(RAW_FIELDS_ANCHOR)}
      onChange={(text) => onChange({ view: "raw", text, editing: null })} /> :
      typed !== null && typed.shape === "root" ? <TypedNode name="Value" value={typed.value} preview={previews.get(0) ?? true}
        onPreview={(on) => setPreview(0, on)} onChange={(value) => onChange({ view: "typed", text: updateTypedField(fields.text, null, value), editing: { shape: "root", value } })} /> :
      typed !== null && typed.shape === "rows" ? <Rows rows={typed.rows} previewOf={previewOf} onPreview={setPreview} problemsAt={problemsAt} addButton={addButton}
        onRows={(rows) => onChange(withRows(fields, rows))} onAdd={(row) => { onChange(withRows(fields, [...typed.rows, row])); onFocusRequest(fieldNameAnchor(row.id)); }}
        nextId={nextId} /> : null}
  </section>;
}

function RawFields({ text, problems, onChange }: { text: string; problems: readonly Problem[]; onChange: (text: string) => void }) {
  const errorId = `${RAW_FIELDS_ANCHOR}-error`;
  const invalid = problems.length > 0;
  return <div className="card field-card">
    <div className="card-head"><label className="field-name" htmlFor={RAW_FIELDS_ANCHOR}>Fields JSON</label><span className="chip">{rootSummary(text)}</span><span className="spacer" />
      <span className="xs muted">{invalid ? "Not valid yet" : "Valid JSON · numbers are kept exactly as written"}</span></div>
    <textarea id={RAW_FIELDS_ANCHOR} className="textarea textarea-auto code-edit" spellCheck={false} value={text} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
      onChange={(event) => onChange(event.target.value)} />
    {invalid && <div className="field-error edit-card-error" id={errorId}><UiIcon name="alert" small /><span>{problems[0]!.message}</span></div>}
  </div>;
}

function Rows({ rows, previewOf, onPreview, problemsAt, addButton, onRows, onAdd, nextId }: {
  rows: readonly FieldRow[]; previewOf: (row: FieldRow) => boolean; onPreview: (id: number, on: boolean) => void; problemsAt: (anchor: string) => readonly Problem[];
  addButton: RefObject<HTMLButtonElement | null>; onRows: (rows: FieldRow[]) => void; onAdd: (row: FieldRow) => void; nextId: () => number;
}) {
  const change = (id: number, patch: Partial<Omit<FieldRow, "id">>) => onRows(rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  const remove = (id: number) => { onRows(rows.filter((row) => row.id !== id)); addButton.current!.focus(); };
  const groups: FieldRow[][] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last !== undefined && !isBlock(row.value) && !isBlock(last[0]!.value)) last.push(row); else groups.push([row]);
  }
  const common = (row: FieldRow) => ({
    nameProblems: problemsAt(fieldNameAnchor(row.id)), valueProblems: problemsAt(fieldAnchor(row.id)),
    onName: (name: string) => change(row.id, { name }), onKind: (kind: FieldKind) => change(row.id, { value: retype(row.value, kind) }),
    onValue: (value: RowValue) => change(row.id, { value }), onRemove: () => remove(row.id),
  });
  return <>
    {rows.length === 0 && <p className="muted small">This record has no fields yet.</p>}
    {groups.map((group) => isBlock(group[0]!.value) ?
      <BlockField key={group[0]!.id} row={group[0]!} preview={previewOf(group[0]!)} onPreview={(on) => onPreview(group[0]!.id, on)} {...common(group[0]!)} /> :
      <div key={group[0]!.id} className="card">{group.map((row) => <ScalarField key={row.id} row={row} {...common(row)} />)}</div>)}
    <div className="row"><button type="button" ref={addButton} className="btn" onClick={() => onAdd({ id: nextId(), name: newFieldName(rows), value: { kind: "string", text: "" } })}>
      <UiIcon name="plus" />Add field</button></div>
  </>;
}

interface RowControls {
  nameProblems: readonly Problem[]; valueProblems: readonly Problem[];
  onName: (name: string) => void; onKind: (kind: FieldKind) => void; onValue: (value: RowValue) => void; onRemove: () => void;
}

function NameInput({ row, problems, onName }: { row: FieldRow; problems: readonly Problem[]; onName: (name: string) => void }) {
  return <input className="input input-mono" id={fieldNameAnchor(row.id)} aria-label="Field name" value={row.name} spellCheck={false}
    aria-invalid={problems.length > 0} onChange={(event) => onName(event.target.value)} />;
}

function KindSelect({ row, onKind }: { row: FieldRow; onKind: (kind: FieldKind) => void }) {
  return <select className="select" aria-label={`Type of ${displayName(row)}`} value={row.value.kind} onChange={(event) => onKind(event.target.value as FieldKind)}>
    {KINDS.map((entry) => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}
  </select>;
}

function RemoveButton({ row, onRemove }: { row: FieldRow; onRemove: () => void }) {
  const label = `Remove field ${displayName(row)}`;
  return <button type="button" className="btn btn-ghost btn-icon" aria-label={label} title={label} onClick={onRemove}><UiIcon name="trash" /></button>;
}

function ScalarField({ row, nameProblems, valueProblems, onName, onKind, onValue, onRemove }: { row: FieldRow } & RowControls) {
  const value = row.value;
  const label = `Value: ${displayName(row)}`;
  const errorId = `${fieldAnchor(row.id)}-error`;
  const aria = { id: fieldAnchor(row.id), "aria-label": label, "aria-invalid": valueProblems.length > 0, "aria-describedby": valueProblems.length > 0 ? errorId : undefined };
  let control: ReactNode;
  switch (value.kind) {
    case "string": control = <input className="input" {...aria} value={value.text} onChange={(event) => onValue({ kind: "string", text: event.target.value })} />; break;
    case "number": control = <input className="input input-mono" {...aria} value={value.text} spellCheck={false} inputMode="decimal"
      onChange={(event) => onValue({ kind: "number", text: event.target.value })} />; break;
    case "boolean": control = <select className="select" {...aria} value={String(value.value)} onChange={(event) => onValue({ kind: "boolean", value: event.target.value === "true" })}>
      <option value="true">true</option><option value="false">false</option></select>; break;
    case "null": control = <span className="field-null" id={fieldAnchor(row.id)} aria-label={label} role="note">null</span>; break;
    case "json": control = <textarea className="textarea textarea-auto input-mono" {...aria} rows={1} value={value.text} spellCheck={false}
      onChange={(event) => onValue({ kind: "json", text: event.target.value })} />; break;
    default: throw new Error(`Not a scalar field: ${value.kind}`);
  }
  return <div className="field-edit-row" role="group" aria-label={`Edit field: ${displayName(row)}`} data-field-editor={row.name}>
    <NameInput row={row} problems={nameProblems} onName={onName} /><KindSelect row={row} onKind={onKind} />{control}<RemoveButton row={row} onRemove={onRemove} />
    <FieldError id={errorId} problems={[...nameProblems, ...valueProblems]} />
  </div>;
}

function BlockField({ row, preview, onPreview, nameProblems, valueProblems, onName, onKind, onValue, onRemove }: {
  row: FieldRow; preview: boolean; onPreview: (on: boolean) => void;
} & RowControls) {
  const value = row.value;
  if (!isBlock(value)) throw new Error(`Not a block field: ${value.kind}`);
  return <TypedCard name={displayName(row)} dataName={row.name} value={value} preview={preview} onPreview={onPreview}
    onChange={(next) => onValue(next)} contentId={fieldAnchor(row.id)}
    head={<><NameInput row={row} problems={nameProblems} onName={onName} /><KindSelect row={row} onKind={onKind} /></>}
    remove={<RemoveButton row={row} onRemove={onRemove} />} error={<FieldError id={`${fieldAnchor(row.id)}-error`} problems={[...nameProblems, ...valueProblems]} />} />;
}

function TypedNode({ name, value, preview, onPreview, onChange }: {
  name: string; value: TypedContent; preview: boolean; onPreview: (on: boolean) => void; onChange: (value: TypedContent) => void;
}) {
  const label = value.kind === "md" ? "Markdown" : value.kind === "code" ? "Code" : "Text";
  return <TypedCard name={name} dataName={name} value={value} preview={preview} onPreview={onPreview} onChange={onChange}
    head={<><span className="field-name">{name}</span><span className="chip">{label}</span></>} />;
}

/** One typed node (Markdown, code, text): its heading controls, the content editor and, for Markdown, a live preview. */
function TypedCard({ name, dataName, value, preview, onPreview, onChange, head, remove, error, contentId }: {
  name: string; dataName: string; value: TypedContent; preview: boolean; onPreview: (on: boolean) => void; onChange: (value: TypedContent) => void;
  head: ReactNode; remove?: ReactNode; error?: ReactNode; contentId?: string;
}) {
  const previewable = value.kind === "md";
  const setContent = (content: string) => onChange({ ...value, content });
  const languages = value.kind === "code" && !CODE_LANGUAGES.includes(value.language) ? [value.language, ...CODE_LANGUAGES] : CODE_LANGUAGES;
  return <section className="card field-edit" aria-label={`Edit field: ${name}`} data-field-editor={dataName}>
    <div className="card-head">{head}
      {value.kind === "code" && <select className="select select-sm" aria-label={`Language: ${name}`} value={value.language}
        onChange={(event) => onChange({ kind: "code", content: value.content, language: event.target.value })}>
        {languages.map((language) => <option key={language} value={language}>{language}</option>)}
      </select>}
      <span className="spacer" />
      {previewable && <label className="check"><input type="checkbox" checked={preview} aria-label={`Preview ${name}`} onChange={(event) => onPreview(event.target.checked)} />Preview</label>}
      {remove}
    </div>
    <div className={previewable && preview ? "md-split" : "md-single"}>
      <div className="md-pane">
        {previewable && preview && <span className="eyebrow md-pane-label">Write</span>}
        <textarea id={contentId} className={value.kind === "md" ? "textarea textarea-auto" : "textarea textarea-auto code-edit"} aria-label={`Content: ${name}`} spellCheck={false}
          value={value.content} onChange={(event) => setContent(event.target.value)} />
      </div>
      {previewable && preview && <section className="md-pane" aria-label={`Preview: ${name}`}><span className="eyebrow md-pane-label">Preview</span>
        <div className="md-preview"><FieldPreview value={value} /></div></section>}
    </div>
    {error}
  </section>;
}
