import { useMemo, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { common, createLowlight } from "lowlight";
import nix from "highlight.js/lib/languages/nix";
import scala from "highlight.js/lib/languages/scala";
import { parseFields, type FieldValue } from "./fields";

type SyntaxHighlighter = ReturnType<typeof createLowlight>;
type SyntaxNode = ReturnType<SyntaxHighlighter["highlight"]>["children"][number];

function renderSyntax(node: SyntaxNode, index: number): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || node.tagName !== "span") throw new Error("Unexpected syntax-highlight node");
  const classes = node.properties.className;
  return <span key={index} className={Array.isArray(classes) ? classes.join(" ") : ""}>
    {node.children.map(renderSyntax)}
  </span>;
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
    {open && <pre><HighlightedText content={content} language={language} highlighter={highlighter} /></pre>}
  </details>;
}

function MarkdownContent({ content, highlighter }: { content: string; highlighter: SyntaxHighlighter }) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  const body = frontmatter === null ? content : content.slice(frontmatter[0].length);
  return <div className="markdown-content">
    {frontmatter !== null && <pre className="markdown-frontmatter" aria-label="YAML frontmatter">
      <HighlightedText content={frontmatter[1]!} language="yaml" highlighter={highlighter} />
    </pre>}
    <Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    code: ({ children, className }) => {
      const language = /(?:^|\s)language-([^\s]+)/.exec(className === undefined ? "" : className);
      return language !== null && typeof children === "string" ?
        <HighlightedText content={children} language={language[1]!} highlighter={highlighter} /> : <code>{children}</code>;
    },
    a: ({ href, children, title }) => href === undefined || href === "" ? <span>{children}</span> :
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt, src }) => <span className="markdown-image">{alt === undefined || alt === "" ? "Image" : alt}
      {src !== undefined && src !== "" && <> · <a href={src} target="_blank" rel="noopener noreferrer">Open image</a></>}</span>,
  }}>{body}</Markdown></div>;
}

function FieldContent({ value, highlighter }: { value: FieldValue; highlighter: SyntaxHighlighter }) {
  switch (value.kind) {
    case "string": return <div className="field-string">{value.text === "" ? <span className="muted">Empty string</span> : value.text}</div>;
    case "number": return <span className="field-number">{value.text}</span>;
    case "boolean": return <span className="field-boolean">{String(value.value)}</span>;
    case "null": return <span className="field-null">null</span>;
    case "json": return <>{value.notice !== null && <p className="field-notice">{value.notice}</p>}
      <pre><HighlightedText content={value.text} language="json" highlighter={highlighter} /></pre></>;
    case "text": return <pre className="field-text">{value.content}</pre>;
    case "code": return <>{!highlighter.registered(value.language.toLowerCase()) &&
      <p className="field-notice">Unsupported language: {value.language}. Displaying plain text.</p>}
      <pre><HighlightedText content={value.content} language={value.language} highlighter={highlighter} /></pre></>;
    case "md": return <><MarkdownContent content={value.content} highlighter={highlighter} />
      <SourceDisclosure label="Markdown source" content={value.content} language="markdown" highlighter={highlighter} /></>;
  }
}

export function FieldPreview({ value }: { value: FieldValue }) {
  const highlighter = useMemo(() => createLowlight({ ...common, nix, scala }), []);
  return <div className="field-content"><FieldContent value={value} highlighter={highlighter} /></div>;
}

export function FieldsView({ fieldsJson }: { fieldsJson: string }) {
  const fields = useMemo(() => parseFields(fieldsJson), [fieldsJson]);
  const highlighter = useMemo(() => createLowlight({ ...common, nix, scala }), []);
  return <div className="fields-view">
    {fields.length === 0 && <p className="muted">No fields.</p>}
    {fields.map((field) => {
      const name = field.name === null ? "Value" : field.name === "" ? '""' : field.name;
      const label = field.value.kind === "json" ? field.value.jsonType : field.value.kind === "md" ? "Markdown" :
        field.value.kind === "code" ? field.value.language : field.value.kind;
      return <section key={field.name} className="field-entry" aria-label={`Field: ${name}`} data-kind={field.value.kind}>
        <header className="field-heading"><h4>{name}</h4><span>{label}</span></header>
        <div className="field-content"><FieldContent value={field.value} highlighter={highlighter} /></div>
      </section>;
    })}
    <SourceDisclosure label="Raw JSON" content={fieldsJson} language="json" highlighter={highlighter} />
  </div>;
}
