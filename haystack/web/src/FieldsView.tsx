import { useMemo, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { common, createLowlight } from "lowlight";
import nix from "highlight.js/lib/languages/nix";
import scala from "highlight.js/lib/languages/scala";
import { stringify } from "lossless-json";
import { parseFields, type FieldEntry, type FieldValue } from "./fields";
import { parseRaw } from "./lossless-json";
import { fieldLabel, fieldText } from "./revision-diff";
import { UiIcon } from "./Masthead";

type SyntaxHighlighter = ReturnType<typeof createLowlight>;
type SyntaxNode = ReturnType<SyntaxHighlighter["highlight"]>["children"][number];
/** Copies `text` to the clipboard and reports the outcome under the name `what`. */
export type CopyText = (text: string, what: string) => void;

function renderSyntax(node: SyntaxNode, index: number): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || node.tagName !== "span") throw new Error("Unexpected syntax-highlight node");
  const classes = node.properties.className;
  return <span key={index} className={Array.isArray(classes) ? classes.join(" ") : ""}>
    {node.children.map(renderSyntax)}
  </span>;
}

function useHighlighter(): SyntaxHighlighter {
  return useMemo(() => createLowlight({ ...common, nix, scala }), []);
}

function HighlightedText({ content, language, highlighter }: {
  content: string; language: string; highlighter: SyntaxHighlighter;
}) {
  const name = language.toLowerCase();
  const supported = highlighter.registered(name);
  const nodes = useMemo(() => supported ? highlighter.highlight(name, content).children : null,
    [content, name, supported, highlighter]);
  return <code className="hljs" data-language={name} title={supported ? undefined : `Unsupported language: ${language}; displaying plain text`}>
    {nodes === null ? content : nodes.map(renderSyntax)}
  </code>;
}

function SourceDisclosure({ label, content, language, highlighter }: {
  label: string; content: string; language: string; highlighter: SyntaxHighlighter;
}) {
  const [open, setOpen] = useState(false);
  return <details className="field-source" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{label}</summary>
    {open && <pre className="code-block"><HighlightedText content={content} language={language} highlighter={highlighter} /></pre>}
  </details>;
}

// Markdown headings stay below the page title and the field names (h1–h3): "#" becomes h4, "##" h5, deeper h6.
const DEMOTED_HEADINGS = {
  h1: ({ children }: { children?: ReactNode }) => <h4 className="md-h1">{children}</h4>,
  h2: ({ children }: { children?: ReactNode }) => <h5 className="md-h2">{children}</h5>,
  h3: ({ children }: { children?: ReactNode }) => <h6 className="md-h3">{children}</h6>,
  h4: ({ children }: { children?: ReactNode }) => <h6 className="md-h4">{children}</h6>,
  h5: ({ children }: { children?: ReactNode }) => <h6 className="md-h4">{children}</h6>,
  h6: ({ children }: { children?: ReactNode }) => <h6 className="md-h4">{children}</h6>,
};

function MarkdownContent({ content, highlighter }: { content: string; highlighter: SyntaxHighlighter }) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  const body = frontmatter === null ? content : content.slice(frontmatter[0].length);
  return <div className="md">
    {frontmatter !== null && <div className="md-frontmatter"><span className="eyebrow">Front matter</span><pre className="code-block" aria-label="YAML frontmatter">
      <HighlightedText content={frontmatter[1]!} language="yaml" highlighter={highlighter} />
    </pre></div>}
    <Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    ...DEMOTED_HEADINGS,
    pre: ({ children }) => <pre className="code-block">{children}</pre>,
    code: ({ children, className }) => {
      const language = /(?:^|\s)language-([^\s]+)/.exec(className === undefined ? "" : className);
      return language !== null && typeof children === "string" ?
        <HighlightedText content={children} language={language[1]!} highlighter={highlighter} /> : <code>{children}</code>;
    },
    a: ({ href, children, title }) => href === undefined || href === "" ? <span>{children}</span> :
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt, src }) => <span className="md-image">{alt === undefined || alt === "" ? "Image" : alt}
      {src !== undefined && src !== "" && <> · <a href={src} target="_blank" rel="noopener noreferrer">Open image</a></>}</span>,
  }}>{body}</Markdown></div>;
}

function UnsupportedNotice({ value, highlighter }: { value: FieldValue; highlighter: SyntaxHighlighter }) {
  if (value.kind === "code" && !highlighter.registered(value.language.toLowerCase()))
    return <p className="field-notice">Unsupported language: {value.language}. Displaying plain text.</p>;
  if (value.kind === "json" && value.notice !== null) return <p className="field-notice">{value.notice}</p>;
  return null;
}

/** The content of a block field (Markdown rendered or as source, code, text, JSON) inside its card. */
function BlockContent({ value, source, highlighter }: { value: FieldValue; source: boolean; highlighter: SyntaxHighlighter }) {
  switch (value.kind) {
    case "md": return source ?
      <pre className="code-block"><HighlightedText content={value.content} language="markdown" highlighter={highlighter} /></pre> :
      <div className="card-body"><MarkdownContent content={value.content} highlighter={highlighter} /></div>;
    case "code": return <pre className="code-block"><HighlightedText content={value.content} language={value.language} highlighter={highlighter} /></pre>;
    case "json": return <pre className="code-block"><HighlightedText content={value.text} language="json" highlighter={highlighter} /></pre>;
    case "text": return <pre className="code-block">{value.content}</pre>;
    default: throw new Error(`Not a block field: ${value.kind}`);
  }
}

function ScalarValue({ value, highlighter }: { value: FieldValue; highlighter: SyntaxHighlighter }) {
  const json = inlineJson(value);
  if (json !== null) return <HighlightedText content={json} language="json" highlighter={highlighter} />;
  switch (value.kind) {
    case "string": return value.text === "" ? <span className="muted">Empty string</span> : <>{value.text}</>;
    case "number": return <>{value.text}</>;
    case "boolean": return <>{String(value.value)}</>;
    case "null": return <span className="muted">null</span>;
    default: throw new Error(`Not a scalar field: ${value.kind}`);
  }
}

/** Field content in the editor's preview (spec §3.2 Edit; owned by the edit page). */
export function FieldPreview({ value }: { value: FieldValue }) {
  const highlighter = useHighlighter();
  return <div className="field-content">
    {value.kind === "md" ? <>
      <MarkdownContent content={value.content} highlighter={highlighter} />
      <SourceDisclosure label="Markdown source" content={value.content} language="markdown" highlighter={highlighter} />
    </> : isScalar(value) ?
      <div className="field-value"><ScalarValue value={value} highlighter={highlighter} /></div> :
      <><UnsupportedNotice value={value} highlighter={highlighter} /><BlockContent value={value} source={false} highlighter={highlighter} /></>}
  </div>;
}

/** Objects and arrays whose exact compact JSON is at most this long are shown as rows, like scalars. */
const INLINE_JSON_MAX_CHARS = 80;
function inlineJson(value: FieldValue): string | null {
  if (value.kind !== "json" || value.notice !== null) return null;
  const compact = stringify(parseRaw(value.text));
  if (compact === undefined) throw new Error("JSON field serialization returned no value");
  return compact.length <= INLINE_JSON_MAX_CHARS ? compact : null;
}
const isScalar = (value: FieldValue) => value.kind === "string" || value.kind === "number" || value.kind === "boolean" || value.kind === "null" || inlineJson(value) !== null;
const displayName = (field: FieldEntry) => field.name === null ? "Value" : field.name === "" ? '""' : field.name;

/** One card per Markdown, code, text and JSON field; consecutive scalar fields share one card as rows. */
export function FieldsView({ fieldsJson, onCopy }: { fieldsJson: string; onCopy: CopyText }) {
  const fields = useMemo(() => parseFields(fieldsJson), [fieldsJson]);
  const highlighter = useHighlighter();
  const [sources, setSources] = useState<ReadonlySet<string>>(new Set());
  const groups: FieldEntry[][] = [];
  for (const field of fields) {
    const last = groups.at(-1);
    if (last !== undefined && isScalar(field.value) && isScalar(last[0]!.value)) last.push(field);
    else groups.push([field]);
  }
  const toggle = (name: string, source: boolean) => setSources((current) => {
    const next = new Set(current);
    if (source) next.add(name); else next.delete(name);
    return next;
  });
  if (fields.length === 0) return <p className="muted">No fields.</p>;
  return <>{groups.map((group) => {
    const first = group[0]!;
    if (isScalar(first.value)) return <div key={displayName(first)} className="card">
      {group.map((field) => <section key={displayName(field)} className="field-row" aria-label={`Field: ${displayName(field)}`} data-kind={field.value.kind}>
        <div className="field-id"><h3 className="field-name">{displayName(field)}</h3><span className="chip">{fieldLabel(field.value)}</span></div>
        <div className={field.value.kind === "string" ? "field-value" : "field-value mono"} data-field-value="">
          <ScalarValue value={field.value} highlighter={highlighter} />
        </div>
      </section>)}
    </div>;
    const name = displayName(first);
    const source = sources.has(name);
    return <section key={name} className="card field-card" aria-label={`Field: ${name}`} data-kind={first.value.kind}>
      <div className="card-head">
        <h3 className="field-name">{name}</h3><span className="chip">{fieldLabel(first.value)}</span><span className="spacer" />
        {first.value.kind === "md" && <div className="segmented" role="group" aria-label={`View of ${name}`}>
          <button type="button" aria-pressed={!source} onClick={() => toggle(name, false)}>Rendered</button>
          <button type="button" aria-pressed={source} onClick={() => toggle(name, true)}>Source</button>
        </div>}
        <button type="button" className="btn btn-ghost btn-icon" aria-label={`Copy ${name}`} title="Copy content"
          onClick={() => onCopy(fieldText(first.value), name)}><UiIcon name="copy" /></button>
      </div>
      <UnsupportedNotice value={first.value} highlighter={highlighter} />
      <BlockContent value={first.value} source={source} highlighter={highlighter} />
    </section>;
  })}</>;
}

/** The whole fields object as indented JSON; numbers keep their exact text. */
export function FieldsJson({ fieldsJson, onCopy }: { fieldsJson: string; onCopy: CopyText }) {
  const highlighter = useHighlighter();
  const text = useMemo(() => {
    const pretty = stringify(parseRaw(fieldsJson), null, 2);
    if (pretty === undefined) throw new Error("Fields JSON serialization returned no value");
    return pretty;
  }, [fieldsJson]);
  return <section className="card field-card" aria-label="Fields JSON">
    <div className="card-head">
      <h3 className="field-name">fields</h3><span className="chip">JSON</span><span className="spacer" />
      <button type="button" className="btn btn-ghost btn-icon" aria-label="Copy JSON" title="Copy JSON" onClick={() => onCopy(text, "JSON")}><UiIcon name="copy" /></button>
    </div>
    <pre className="code-block"><HighlightedText content={text} language="json" highlighter={highlighter} /></pre>
  </section>;
}
