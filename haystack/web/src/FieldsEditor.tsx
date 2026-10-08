import { useId, useState } from "react";
import { FieldPreview } from "./FieldsView";
import { updateTypedField, type FieldsInspection, type TypedContent } from "./fields";

const CODE_LANGUAGES = ["bash", "css", "go", "html", "java", "javascript", "json", "nix", "python", "rust", "scala", "sql", "typescript", "yaml"];
const CONTENT_ROWS = { md: 10, code: 8, text: 4 };

export function FieldsEditor({ raw, inspection, onChange }: {
  raw: string; inspection: FieldsInspection; onChange: (raw: string) => void;
}) {
  const errorId = useId();
  const typed = inspection.fields === null ? [] : inspection.fields.filter(
    (field): field is { name: string | null; value: TypedContent } =>
      field.value.kind === "md" || field.value.kind === "code" || field.value.kind === "text");
  const [mode, setMode] = useState<"content" | "json">(() => typed.length === 0 ? "json" : "content");
  const [preview, setPreview] = useState(true);
  return <section className="fields-editor" aria-label="Fields editor">
    <div className="fields-editor-toolbar"><h3>Fields</h3>
      <div className="editor-modes" role="group" aria-label="Field editing mode">
        <button type="button" aria-pressed={mode === "content"} disabled={typed.length === 0} onClick={() => setMode("content")}>Typed content</button>
        <button type="button" aria-pressed={mode === "json"} onClick={() => setMode("json")}>Raw JSON</button>
      </div>
      {mode === "content" && <label className="preview-toggle"><input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} />Preview</label>}
    </div>
    {mode === "json" ? <label>Fields JSON
      <textarea value={raw} onChange={(event) => onChange(event.target.value)} rows={12} cols={60} spellCheck={false}
        aria-label="Fields JSON" aria-invalid={inspection.error !== null} aria-describedby={inspection.error === null ? undefined : errorId} />
    </label> : <>
      <p className="muted">Edit Markdown, code, and text here. Use Raw JSON for other fields.</p>
      {typed.map((field) => {
        const name = field.name === null ? "Value" : field.name === "" ? '""' : field.name;
        const value = field.value;
        return <section className="typed-field-editor" key={field.name} aria-label={`Edit field: ${name}`}>
          <header className="field-heading"><h4>{name}</h4><span>{value.kind === "md" ? "Markdown" : value.kind === "code" ? "Code" : "Text"}</span>
            {value.kind === "code" && <label>Language<select aria-label={`Language: ${name}`} value={value.language}
              onChange={(event) => onChange(updateTypedField(raw, field.name, { ...value, language: event.target.value }))}>
              {!CODE_LANGUAGES.includes(value.language) && <option value={value.language}>{value.language}</option>}
              {CODE_LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
            </select></label>}
          </header>
          <div className={`typed-editor-panes ${preview ? "with-preview" : ""}`}>
            <label>Content<textarea aria-label={`Content: ${name}`} rows={CONTENT_ROWS[value.kind]} spellCheck={false} value={value.content}
              onChange={(event) => onChange(updateTypedField(raw, field.name, { ...value, content: event.target.value }))} /></label>
            {preview && <section className="typed-editor-preview" aria-label={`Preview: ${name}`}><h5>Preview</h5><FieldPreview value={value} /></section>}
          </div>
        </section>;
      })}
    </>}
    {inspection.error !== null && <p id={errorId} role="alert" className="fields-json-error">{inspection.error}</p>}
  </section>;
}
