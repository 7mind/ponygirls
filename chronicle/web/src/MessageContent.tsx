import { useEffect, useState } from 'react';
import type { Span } from './api.ts';
import { highlightUtf8 } from './highlight.ts';
import { inlineParts, messageBlocks } from './message-format.ts';
import './message-content.css';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setError(null); }
    catch { setError('Clipboard unavailable. Select and copy the text manually.'); }
  }
  return <span className="message-copy"><button type="button" className="small-button" aria-label={label} onClick={() => void copy()}>{copied ? 'Copied' : label}</button>{error !== null && <span className="copy-error" role="alert">{error}</span>}</span>;
}
function InlineText({ text }: { text: string }) {
  return <>{inlineParts(text).map((part, index) => part.kind === 'code' ? <code key={index}>{part.text}</code> : part.kind === 'strong' ? <strong key={index}>{part.text}</strong> : part.kind === 'emphasis' ? <em key={index}>{part.text}</em> : <span key={index}>{part.text}</span>)}</>;
}
function FormattedText({ text }: { text: string }) {
  if (!/^(?:#{1,6}\s|>\s?|\s*(?:[-+*]|\d+\.)\s)|`[^`\n]+`|\*[^*\n]+\*/m.test(text)) return <pre>{text}</pre>;
  return <div className="message-formatted-text">{text.split('\n').map((line, index) => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line), quote = /^>\s?(.*)$/.exec(line), list = /^(\s*)([-+*]|\d+\.)\s+(.+)$/.exec(line);
    if (heading !== null) return <div key={index} className="message-markdown-heading" role="heading" aria-level={Math.min(6, heading[1]!.length + 2)}><InlineText text={heading[2]!}/></div>;
    if (quote !== null) return <div key={index} className="message-markdown-quote"><InlineText text={quote[1]!}/></div>;
    if (list !== null) return <div key={index} className="message-markdown-item"><span aria-hidden="true">{list[1]}{list[2]} </span><InlineText text={list[3]!}/></div>;
    return <div key={index}>{line.length === 0 ? <br/> : <InlineText text={line}/>}</div>;
  })}</div>;
}
export function MessageContent({ text, spans }: { text: string; spans: readonly Span[] }) {
  const [source, setSource] = useState(false);
  let error: string | null = null;
  let parts;
  try { parts = highlightUtf8(text, spans); }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid source span'; parts = [{ text, highlighted: false }]; }
  const highlighting = spans.length > 0;
  return <div className="message-content"><div className="message-content-actions"><CopyButton text={text} label="Copy message"/>{highlighting ? <span className="message-highlight-label">Source highlights</span> : <button type="button" className="small-button" onClick={() => setSource(value => !value)}>{source ? 'Formatted view' : 'Source text'}</button>}</div>
    {error !== null && <p className="copy-error" role="alert">{error}. Showing unchanged source without highlighting.</p>}
    {source || highlighting ? <pre className="message-source-text">{parts.map((part, index) => part.highlighted ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</pre> : messageBlocks(text).map((block, index) => block.kind === 'code' ? <div className="message-code" key={index}><div className="message-code-bar"><span>{block.language || 'code'}</span><CopyButton text={block.text} label="Copy code"/></div><pre><code>{block.text}</code></pre></div> : <FormattedText key={index} text={block.text}/>)}
  </div>;
}
