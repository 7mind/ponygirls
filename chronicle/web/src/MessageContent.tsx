import { useEffect, useState, type ReactNode } from 'react';
import type { Span } from './api.ts';
import { highlightUtf8 } from './highlight.ts';
import { diffLines, inlineParts, messageBlocks } from './message-format.ts';
import { Icon } from './Icon.tsx';
import './message-content.css';

const COPIED_FEEDBACK_MS = 2000;
const MAX_FORMATTED_CHARACTERS = 20_000;
const MAX_FORMATTED_LINES = 500;

function formattingLimit(text: string): boolean {
  if (text.length > MAX_FORMATTED_CHARACTERS) return true;
  let lines = 1;
  for (const char of text) { if (char === '\n' && ++lines > MAX_FORMATTED_LINES) return true; }
  return false;
}

/** Copies `text`; the visible label is an icon for in-header actions (`compact`), text otherwise. */
export function CopyButton({ text, label, done, compact }: { text: string; label: string; done: string; compact: boolean }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    setCopied(false);
    try { await navigator.clipboard.writeText(text); setCopied(true); setError(null); }
    catch { setError('Clipboard unavailable. Select and copy the text manually.'); }
  }
  return <span className="message-copy"><button type="button" className={compact ? 'btn btn-ghost btn-icon btn-sm' : 'btn btn-sm'} aria-label={label} title={label} onClick={() => void copy()}>{compact ? <Icon name={copied ? 'check' : 'copy'} small={true}/> : copied ? 'Copied' : label}</button><span className="sr-only" role="status" aria-label="Clipboard status">{copied ? done : ''}</span>{error !== null && <span className="copy-error" role="alert">{error}</span>}</span>;
}
function InlineText({ text }: { text: string }) {
  return <>{inlineParts(text).map((part, index) => part.kind === 'code' ? <code key={index}>{part.text}</code> : part.kind === 'strong' ? <strong key={index}>{part.text}</strong> : part.kind === 'emphasis' ? <em key={index}>{part.text}</em> : <span key={index}>{part.text}</span>)}</>;
}
function FormattedText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/), listPattern = /^[ \t]*([-+*]|\d+\.)[ \t]+(.+)$/;
  const formatted = lines.some(line => /^(?:#{1,6}[ \t]+|>[ \t]?)/.test(line) || listPattern.test(line) || inlineParts(line).some(part => part.kind !== 'text'));
  if (!formatted) return <pre className="message-plain-text">{text}</pre>;
  const content: ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!, heading = /^(#{1,6})[ \t]+(.+)$/.exec(line), quote = /^>[ \t]?(.*)$/.exec(line), list = listPattern.exec(line);
    if (heading !== null) content.push(<div key={index} className="message-markdown-heading" role="heading" aria-level={Math.min(6, heading[1]!.length + 2)}><InlineText text={heading[2]!}/></div>);
    else if (quote !== null) content.push(<div key={index} className="message-markdown-quote"><InlineText text={quote[1]!}/></div>);
    else if (list !== null) {
      const start = index, ordered = /\d/.test(list[1]!), items: ReactNode[] = [];
      let item: RegExpExecArray | null = list;
      while (item !== null && /\d/.test(item[1]!) === ordered) {
        items.push(<li key={index} value={ordered ? Number.parseInt(item[1]!, 10) : undefined}><InlineText text={item[2]!}/></li>);
        index++; item = index < lines.length ? listPattern.exec(lines[index]!) : null;
      }
      index--;
      content.push(ordered ? <ol key={start} start={Number.parseInt(list[1]!, 10)}>{items}</ol> : <ul key={start}>{items}</ul>);
    } else content.push(<div key={index}>{line.length === 0 ? <br/> : <InlineText text={line}/>}</div>);
  }
  return <div className="message-formatted-text">{content}</div>;
}
/** Large or highlighted messages are shown as unchanged source text; formatting would not bound the DOM or the byte offsets. */
export function sourceOnly(text: string, spans: readonly Span[]): boolean { return spans.length > 0 || formattingLimit(text); }
/** The body of one message: formatted (inert Markdown subset) or its exact source text with UTF-8 highlights; tool output marks diff lines. */
export function MessageContent({ text, spans, sourceText, tool }: { text: string; spans: readonly Span[]; sourceText: boolean; tool: boolean }) {
  let error: string | null = null;
  let parts;
  try { parts = highlightUtf8(text, spans); }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid source span'; parts = [{ text, highlighted: false }]; }
  return <div className="message-content">
    {error !== null && <p className="copy-error" role="alert">{error}. Showing unchanged source without highlighting.</p>}
    {sourceText || sourceOnly(text, spans) ? <pre className="message-source-text">{tool && spans.length === 0 ? diffLines(text).map((line, index) => <span key={index} className={line.kind === 'added' ? 'diff-add' : line.kind === 'deleted' ? 'diff-del' : undefined}>{line.text}</span>) : parts.map((part, index) => part.highlighted ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</pre> : messageBlocks(text).map((block, index) => block.kind === 'code' ? <div className="message-code" key={index}><div className="message-code-bar"><span>{block.language || 'code'}</span><CopyButton text={block.text} label="Copy code" done="Code copied" compact={false}/></div><pre><code>{block.text}</code></pre></div> : <FormattedText key={index} text={block.text}/>)}
  </div>;
}
