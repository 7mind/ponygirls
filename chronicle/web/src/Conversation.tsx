import { useEffect, useRef, useState } from 'react';
import { ContentView, Scope, Operation_GetSession, Operation_GetChunks, Operation_GetMessages, Operation_GetRaw, Operation_Related, Result_Session, Result_Chunks, Result_Messages, Result_Raw, Result_Related, type UserInfo, type SearchHit, type Chunk, type Message, type Span } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useResource } from './hooks.ts';
import { ErrorNotice, SessionMeta, Tags, formatDate } from './App.tsx';
import { highlightUtf8 } from './highlight.ts';
import { contentViewKey, sameContentView, requireContentView } from './source-view.ts';
import type { ManagerStats } from './transport/types.ts';
const MESSAGE_PAGE_SIZE = 40;
const ANNOTATION_PAGE_SIZE = 20;
const SEEK_PAGE_SIZE = 100;
const MAX_SOURCE_MESSAGES = 10_000;
function OriginalMessage({ message, spans }: { message: Message; spans: readonly Span[] }) {
  let error: string | null = null;
  let parts;
  try { parts = highlightUtf8(message.text, spans.filter(s => s.messageId === message.id)); }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid source span'; parts = [{ text: message.text, highlighted: false }]; }
  const text = <pre>{parts.map((part, i) => part.highlighted ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}</pre>;
  return <article id={`message-${message.id}`} className={`original-message ${spans.some(s => s.messageId === message.id) ? 'highlighted-message' : ''}`}><header><strong>{message.role}</strong><span>{message.timestamp ? new Date(message.timestamp).toLocaleString() : 'time not recorded'}</span><code>#{message.recordIndex}</code></header>{error && <ErrorNotice>{error}. Showing the unchanged source without highlighting.</ErrorNotice>}{message.text.length > 20_000 ? <details><summary>Read full message ({message.text.length.toLocaleString()} characters)</summary>{text}</details> : text}<footer><code>{message.id}</code>{message.parentId && <span>parent: {message.parentId}</span>}</footer></article>;
}
interface ConversationProps {
  connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; sessionId: string;
  match: SearchHit | null; select: (id: string) => void; close: () => void; refresh: number;
}
export function Conversation(props: ConversationProps) {
  const [view, setView] = useState<ContentView | undefined>(() => props.match === null ? undefined : props.match.session.view);
  return <ConversationSnapshot key={contentViewKey(view)} {...props} view={view} chooseView={setView}/>;
}
function ConversationSnapshot({ connection, stats, user, sessionId, match, select, close, refresh, view, chooseView }: ConversationProps & { view: ContentView | undefined; chooseView: (view: ContentView | undefined) => void }) {
  const [offset, setOffset] = useState(0), [annotationOffset, setAnnotationOffset] = useState(0), [raw, setRaw] = useState(false), [chunk, setChunk] = useState<Chunk | null>(null);
  const [seekError, setSeekError] = useState<string | null>(null), [seeking, setSeeking] = useState(false);
  const navigation = useRef(0);
  useEffect(() => { setOffset(0); setAnnotationOffset(0); setRaw(false); setChunk(null); setSeekError(null); navigation.current++; }, [sessionId]);
  useEffect(() => connection.onInvalidate(() => { setChunk(null); setRaw(false); navigation.current++; setSeeking(false); setSeekError(null); }), [connection]);
  const session = useResource(connection, stats, `${sessionId}:${refresh}`, true,
    async () => {
      const result = await read(connection, new Operation_GetSession(sessionId, view), r => r instanceof Result_Session ? r.result : null);
      if (view !== undefined) requireContentView(view, result.session.view);
      return result;
    });
  useEffect(() => { if (view === undefined && session.data !== null) chooseView(session.data.session.view); }, [view, session.data, chooseView]);
  const snapshot = view !== undefined ? session.data : null;
  const annotations = useResource(connection, stats, `${sessionId}:${annotationOffset}:${refresh}`, snapshot !== null,
    async () => {
      const result = await read(connection, new Operation_GetChunks(sessionId, annotationOffset, ANNOTATION_PAGE_SIZE, view), r => r instanceof Result_Chunks ? r.result : null);
      requireContentView(view!, result.view); return result;
    });
  useEffect(() => { if (annotations.error !== null) setChunk(null); }, [annotations.error]);
  const matchingChunks = match !== null && view !== undefined && sameContentView(view, match.session.view) ? match.chunks : [];
  const offPageMatches = annotations.error === null ? matchingChunks.filter(item => !annotations.data?.chunks.some(chunk => chunk.id === item.id)) : [];
  const messages = useResource(connection, stats, `${sessionId}:${offset}:${refresh}`, !raw && snapshot !== null,
    async () => {
      const result = await read(connection, new Operation_GetMessages(sessionId, offset, MESSAGE_PAGE_SIZE, view), r => r instanceof Result_Messages ? r.result : null);
      requireContentView(view!, result.view); return result;
    });
  const rawSource = useResource(connection, stats, `${sessionId}:${refresh}`, raw && snapshot !== null && user.scopes.includes(Scope.Raw),
    async () => {
      const result = await read(connection, new Operation_GetRaw(sessionId, view!.revision), r => r instanceof Result_Raw ? r.result : null);
      if (result.revision !== view!.revision) throw new Error('Raw source revision changed unexpectedly; no raw records are retained.');
      return result;
    });
  const related = useResource(connection, stats, `${sessionId}:${refresh}`, snapshot !== null,
    () => read(connection, new Operation_Related(sessionId, 6), r => r instanceof Result_Related ? r.result : null));
  useEffect(() => {
    if (chunk === null || messages.data === null) return;
    const target = document.getElementById(`message-${chunk.spans[0]?.messageId}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chunk, messages.data]);
  async function showChunk(selected: Chunk) {
    setRaw(false); setChunk(selected); setSeekError(null);
    const target = selected.spans[0]?.messageId;
    if (!target) { setSeekError('This passage has no source span.'); return; }
    if (messages.data?.messages.some(m => m.id === target)) return;
    const operation = ++navigation.current; setSeeking(true);
    try {
      for (let start = 0; start < MAX_SOURCE_MESSAGES; start += SEEK_PAGE_SIZE) {
        const page = await read(connection, new Operation_GetMessages(sessionId, start, SEEK_PAGE_SIZE, view), r => r instanceof Result_Messages ? r.result : null);
        if (navigation.current !== operation) return;
        requireContentView(view!, page.view);
        const index = page.messages.findIndex(m => m.id === target);
        if (index >= 0) { setOffset(Math.floor((start + index) / MESSAGE_PAGE_SIZE) * MESSAGE_PAGE_SIZE); return; }
        if (start + SEEK_PAGE_SIZE >= page.total) break;
      }
      setSeekError('The annotated source message was not found in the permitted archive.');
    } catch (error) { if (navigation.current === operation) setSeekError(error instanceof Error ? error.message : 'Source navigation failed'); }
    finally { if (navigation.current === operation) setSeeking(false); }
  }
  return <><div className="section-heading source-heading"><h2>Source conversation</h2><button className="text-button" aria-label="Close conversation" onClick={close}>Close ×</button></div>
    {(session.loading || (snapshot === null && session.error === null)) && <div className="loading-line" role="status">Rechecking source access…</div>}{session.error && <ErrorNotice>{session.error}. Source content has been cleared.</ErrorNotice>}
    {snapshot && <><div className="conversation-intro"><SessionMeta session={snapshot.session}/><h2>{snapshot.session.metadata.title || 'Untitled session'}</h2><Tags tags={snapshot.session.metadata.tags}/><div className="provenance"><span>Owner <strong>{snapshot.session.ownerId}</strong></span><span>Head r{snapshot.session.revision} / index {snapshot.session.indexedRevision === undefined ? 'pending' : `r${snapshot.session.indexedRevision}`}</span><span>Viewing source r{view!.revision}</span>{view!.generationId === undefined && <span>Unindexed archive view · no annotations</span>}<span>{snapshot.session.completion === 'Quiescent' ? 'Quiescent snapshot · may resume' : 'Closed source'}</span>{snapshot.session.redacted && <span>Redacted before upload</span>}</div><div className="button-row source-view-actions"><button className="small-button" onClick={() => chooseView(undefined)}>Reload source snapshot ↻</button>{snapshot.session.revision > view!.revision && <button className="small-button" onClick={() => chooseView(new ContentView(snapshot.session.revision, undefined))}>View latest archived revision</button>}</div>
      <details className="provenance-details"><summary>Provenance & metadata</summary><dl><dt>Source identity</dt><dd>{snapshot.session.source.discoveryRootId} / {snapshot.session.source.collectorNamespace} / {snapshot.session.source.producerSessionId}</dd><dt>Producer / model</dt><dd>{snapshot.session.metadata.producer} / {snapshot.session.metadata.model ?? 'not recorded'}</dd><dt>Work directory</dt><dd>{snapshot.session.metadata.workdir ?? 'not recorded'}</dd><dt>Git remote</dt><dd>{snapshot.session.metadata.gitRemote ?? 'not recorded'}</dd><dt>Branch / commit</dt><dd>{snapshot.session.metadata.gitBranch ?? 'not recorded'} / {snapshot.session.metadata.gitCommit ?? 'not recorded'}</dd><dt>Source dates</dt><dd>{formatDate(snapshot.session.metadata.startedAt)} – {formatDate(snapshot.session.metadata.endedAt)}</dd><dt>Annotation generation</dt><dd><code>{view!.generationId ?? 'none · archive-only view'}</code></dd><dt>Archive identity</dt><dd><code>{sessionId}</code></dd></dl></details>
    </div>{offPageMatches.length > 0 && <section className="matched-passages" aria-label="Matching search passages"><h3>Matched in your search</h3>{offPageMatches.map(item => <button className={`passage ${chunk?.id === item.id ? 'selected-passage' : ''}`} key={item.id} onClick={() => void showChunk(item)}><span className="passage-number" aria-hidden="true">↗</span><span><strong>{item.summary || 'Matching source passage'}</strong><Tags tags={item.tags}/><span className="tiny">Read matching original messages ↙</span></span></button>)}</section>}<details className="passages" open><summary>Annotated passages <span>{annotations.data?.total ?? (annotations.loading ? 'Loading…' : 'Unavailable')}</span></summary>
        {annotations.loading && <p className="tiny" role="status">Loading this annotation page…</p>}{annotations.error && <ErrorNotice>{annotations.error}. Annotation content has been cleared.</ErrorNotice>}
        {annotations.data && <><div className="passage-list">{annotations.data.chunks.map((item, index) => <button key={item.id} className={`passage ${chunk?.id === item.id ? 'selected-passage' : ''}`} onClick={() => void showChunk(item)}><span className="passage-number">{String(annotations.data!.offset + index + 1).padStart(2, '0')}</span><span><strong>{item.summary || 'Source passage'}</strong><Tags tags={item.tags}/><span className="tiny">Read original messages ↙</span></span></button>)}{annotations.data.total === 0 && <p className="tiny">{view!.generationId === undefined ? 'This unindexed archive view has no annotations. Original messages and permitted raw records remain readable.' : 'No passages in this annotation generation.'}</p>}</div>
          <nav className="pagination" aria-label="Annotation pages"><button disabled={annotations.data.offset === 0} onClick={() => setAnnotationOffset(Math.max(0, annotations.data!.offset - ANNOTATION_PAGE_SIZE))}>← Previous passages</button><span>{annotations.data.total === 0 ? '0 / 0' : `${annotations.data.offset + 1}–${Math.min(annotations.data.offset + ANNOTATION_PAGE_SIZE, annotations.data.total)} / ${annotations.data.total}`}</span><button disabled={annotations.data.offset + ANNOTATION_PAGE_SIZE >= annotations.data.total} onClick={() => setAnnotationOffset(annotations.data!.offset + ANNOTATION_PAGE_SIZE)}>Next passages →</button></nav>
        </>}
      </details>
      <div className="transcript-toolbar"><h3>{raw ? 'Permitted raw records' : 'Original messages'}</h3><button className={raw ? 'small-button toggled' : 'small-button'} disabled={!user.scopes.includes(Scope.Raw)} onClick={() => setRaw(v => !v)} aria-pressed={raw}>{raw ? 'Back to messages' : 'Request raw records'}</button></div>
      {!user.scopes.includes(Scope.Raw) && <p className="tiny raw-permission">Raw access requires the separate Raw permission.</p>}
      {seekError && <ErrorNotice>{seekError}</ErrorNotice>}{seeking && <div className="loading-line" role="status">Locating the original message in bounded source pages…</div>}
      {raw ? <div className="raw-source"><p className="notice">Original records from source r{view!.revision} may contain sensitive fields. Raw authorization is rechecked by the server.</p>{rawSource.loading && <p role="status">Requesting raw permission…</p>}{rawSource.error && <ErrorNotice>{rawSource.error}. No raw records are retained.</ErrorNotice>}{rawSource.data?.files.map(file => <details key={file.path}><summary>{file.path}</summary><p className="tiny">SHA-256 {file.sha256}</p><pre>{file.content}</pre></details>)}</div> : <><div className="transcript" aria-busy={messages.loading}>{messages.error && <ErrorNotice>{messages.error}. Message content has been cleared.</ErrorNotice>}{messages.loading && <div className="loading-line" role="status">Loading original messages…</div>}{messages.data?.messages.map(message => <OriginalMessage key={message.id} message={message} spans={chunk?.spans ?? []}/>)}{messages.data?.messages.length === 0 && <p className="tiny">No messages in this source page.</p>}</div>{messages.data && <nav className="pagination" aria-label="Source message pages"><button disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - MESSAGE_PAGE_SIZE))}>← Earlier</button><span>{messages.data.total === 0 ? 0 : offset + 1}–{Math.min(offset + MESSAGE_PAGE_SIZE, messages.data.total)} / {messages.data.total}</span><button disabled={offset + MESSAGE_PAGE_SIZE >= messages.data.total} onClick={() => setOffset(n => n + MESSAGE_PAGE_SIZE)}>Later →</button></nav>}</>}
      <section className="related"><div className="section-heading"><h3>Nearby threads</h3><span className="eyebrow">AUTHORIZED ONLY</span></div>{related.error && <ErrorNotice>{related.error}</ErrorNotice>}{related.loading && <p className="tiny" role="status">Resolving related conversations…</p>}{related.data?.sessions.map(hit => <button className="related-link" key={hit.session.id} onClick={() => select(hit.session.id)}><span>{hit.session.metadata.title}</span><span aria-hidden="true">↗</span></button>)}{related.data?.sessions.length === 0 && <p className="tiny">No related conversations available.</p>}</section>
    </>}
  </>;
}
